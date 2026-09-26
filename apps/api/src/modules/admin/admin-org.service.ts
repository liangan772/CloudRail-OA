import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildPath, levelOf } from '@oa/shared';
import { AppError } from '../../common/errors/app-error';
import { DomainEventService } from '../../infra/events/domain-event.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import type {
  AddWorkNoMemberDto,
  CreateDepartmentDto,
  SetWorkNoDto,
  UpdateDepartmentDto,
} from './admin.dto';

/**
 * 组织与部门工号管理。
 *
 * 两个容易踩的点在这里集中处理：
 * 1. **物化路径（D1）**：移动部门必须连带重写整棵子树的 `path` 与 `level`，
 *    否则上下级查询（`LIKE '/1/3/%'`）会立刻失真。
 * 2. **工号唯一性（D3）**：上报投递目标是"上级部门的工号"，一个工号只能挂在一个部门上，
 *    否则上报目标解析会出现二义。
 */
@Injectable()
export class AdminOrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventService,
  ) {}

  /* ------------------------------- 部门 ------------------------------- */

  async listDepartments(includeDisabled = false) {
    const rows = await this.prisma.department.findMany({
      where: { ...(includeDisabled ? {} : { status: 'ACTIVE' }) },
      orderBy: [{ level: 'asc' }, { sort: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        parentId: true,
        name: true,
        code: true,
        path: true,
        level: true,
        sort: true,
        workNo: true,
        status: true,
        managerId: true,
        manager: { select: { id: true, name: true } },
        _count: { select: { members: true, children: true, workNoMembers: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      code: row.code,
      path: row.path,
      level: row.level,
      sort: row.sort,
      workNo: row.workNo,
      status: row.status,
      managerId: row.managerId,
      managerName: row.manager?.name ?? null,
      memberCount: row._count.members,
      childrenCount: row._count.children,
      workNoMemberCount: row._count.workNoMembers,
    }));
  }

  async createDepartment(actor: AuthenticatedUser, dto: CreateDepartmentDto) {
    if (dto.workNo) await this.assertWorkNoFree(actor.tenantId, dto.workNo, null);
    if (dto.code) await this.assertDeptCodeFree(actor.tenantId, dto.code, null);
    const parent = dto.parentId ? await this.assertDepartment(actor.tenantId, dto.parentId) : null;

    const created = await this.prisma.runInTransaction(async (tx) => {
      const dept = await tx.department.create({
        data: {
          tenantId: actor.tenantId,
          name: dto.name,
          code: dto.code ?? null,
          parentId: parent?.id ?? null,
          path: '/',
          level: 0,
          workNo: dto.workNo ?? null,
          managerId: dto.managerId ?? null,
          sort: dto.sort ?? 0,
        },
      });

      // path 依赖自身 id，所以必须先建后更（种子脚本里也是这个顺序）
      const path = buildPath(parent?.path ?? '/', dept.id);
      await tx.department.update({ where: { id: dept.id }, data: { path, level: levelOf(path) } });

      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_DEPARTMENT_CREATED',
        aggregateType: 'DEPARTMENT',
        aggregateId: dept.id,
        payload: { name: dto.name, parentId: parent?.id ?? null, path, workNo: dto.workNo ?? null },
        audit: {
          actorId: actor.userId,
          action: 'DEPT_CREATE',
          targetType: 'DEPARTMENT',
          targetId: dept.id,
          after: { name: dto.name, parentId: parent?.id ?? null, workNo: dto.workNo ?? null },
        },
      });

      return { id: dept.id, path };
    });

    return created;
  }

  async updateDepartment(actor: AuthenticatedUser, id: number, dto: UpdateDepartmentDto) {
    const before = await this.assertDepartment(actor.tenantId, id);

    if (dto.workNo !== undefined && dto.workNo !== null) {
      await this.assertWorkNoFree(actor.tenantId, dto.workNo, id);
    }
    if (dto.code !== undefined && dto.code !== null) {
      await this.assertDeptCodeFree(actor.tenantId, dto.code, id);
    }

    await this.prisma.runInTransaction(async (tx) => {
      await tx.department.update({
        where: { id },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.code === undefined ? {} : { code: dto.code }),
          ...(dto.workNo === undefined ? {} : { workNo: dto.workNo }),
          ...(dto.managerId === undefined ? {} : { managerId: dto.managerId }),
          ...(dto.sort === undefined ? {} : { sort: dto.sort }),
          ...(dto.status === undefined ? {} : { status: dto.status }),
        },
      });

      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_DEPARTMENT_UPDATED',
        aggregateType: 'DEPARTMENT',
        aggregateId: id,
        payload: { changes: dto },
        audit: {
          actorId: actor.userId,
          action: 'DEPT_UPDATE',
          targetType: 'DEPARTMENT',
          targetId: id,
          before: { name: before.name, code: before.code, workNo: before.workNo, managerId: before.managerId, sort: before.sort, status: before.status },
          after: dto,
        },
      });
    });

    return { id };
  }

  /**
   * 移动部门（含整棵子树）。禁止移到自己的后代下 —— 那会造出环，
   * 之后 `path` 前缀查询会无限递归。
   */
  async moveDepartment(actor: AuthenticatedUser, id: number, parentId: number | null) {
    const dept = await this.assertDepartment(actor.tenantId, id);
    const parent = parentId ? await this.assertDepartment(actor.tenantId, parentId) : null;

    if (parent && (parent.id === dept.id || parent.path.startsWith(dept.path))) {
      throw AppError.of('SYS_VALIDATION_FAILED', '不能把部门移动到它自己或它的下级部门之下');
    }

    const newPath = buildPath(parent?.path ?? '/', dept.id);
    const delta = levelOf(newPath) - dept.level;

    const moved = await this.prisma.runInTransaction(async (tx) => {
      await tx.department.update({
        where: { id },
        data: { parentId: parent?.id ?? null, path: newPath, level: levelOf(newPath) },
      });

      // 子树：把旧前缀换成新前缀，level 同步平移
      const descendants = await tx.department.findMany({
        where: { tenantId: actor.tenantId, path: { startsWith: dept.path }, id: { not: id } },
        select: { id: true, path: true, level: true },
      });

      for (const node of descendants) {
        const replaced = `${newPath}${node.path.slice(dept.path.length)}`;
        await tx.department.update({
          where: { id: node.id },
          data: { path: replaced, level: node.level + delta },
        });
      }

      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_DEPARTMENT_MOVED',
        aggregateType: 'DEPARTMENT',
        aggregateId: id,
        payload: { from: dept.path, to: newPath, descendants: descendants.length },
        audit: {
          actorId: actor.userId,
          action: 'DEPT_MOVE',
          targetType: 'DEPARTMENT',
          targetId: id,
          before: { parentId: dept.parentId, path: dept.path },
          after: { parentId: parent?.id ?? null, path: newPath, descendants: descendants.length },
        },
      });

      return { id, path: newPath, descendants: descendants.length };
    });

    return moved;
  }

  async removeDepartment(actor: AuthenticatedUser, id: number) {
    const dept = await this.prisma.department.findFirst({
      where: { id, tenantId: actor.tenantId },
      select: { id: true, name: true, path: true, workNo: true, _count: { select: { members: true, children: true } } },
    });
    if (!dept) throw AppError.of('SYS_NOT_FOUND', '部门不存在');
    if (dept._count.children > 0) {
      throw AppError.of('SYS_VALIDATION_FAILED', `该部门还有 ${dept._count.children} 个下级部门，请先移走或删除`);
    }
    if (dept._count.members > 0) {
      throw AppError.of('SYS_VALIDATION_FAILED', `该部门还有 ${dept._count.members} 名成员，请先调整归属`);
    }

    await this.prisma.runInTransaction(async (tx) => {
      await tx.departmentWorkNoMember.deleteMany({ where: { departmentId: id } });
      await tx.department.delete({ where: { id } });
      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_DEPARTMENT_DELETED',
        aggregateType: 'DEPARTMENT',
        aggregateId: id,
        payload: { name: dept.name, path: dept.path, workNo: dept.workNo },
        audit: {
          actorId: actor.userId,
          action: 'DEPT_DELETE',
          targetType: 'DEPARTMENT',
          targetId: id,
          before: { name: dept.name, path: dept.path, workNo: dept.workNo },
        },
      });
    });

    return { id, deleted: true };
  }

  /* ------------------------------- 工号 ------------------------------- */

  async listWorkNos(includeDisabled = false) {
    const rows = await this.prisma.department.findMany({
      where: { ...(includeDisabled ? {} : { status: 'ACTIVE' }) },
      orderBy: [{ level: 'asc' }, { sort: 'asc' }],
      select: {
        id: true,
        name: true,
        path: true,
        level: true,
        workNo: true,
        status: true,
        workNoMembers: {
          where: { status: 'ACTIVE' },
          orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
          select: { userId: true, isPrimary: true, receiveNotify: true, user: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    return rows.map((row) => ({
      departmentId: row.id,
      departmentName: row.name,
      path: row.path,
      level: row.level,
      workNo: row.workNo,
      departmentStatus: row.status,
      primaryUserId: row.workNoMembers.find((m) => m.isPrimary)?.userId ?? null,
      members: row.workNoMembers.map((m) => ({
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        isPrimary: m.isPrimary,
        receiveNotify: m.receiveNotify,
      })),
    }));
  }

  /** 设置 / 清空部门工号 */
  async setWorkNo(actor: AuthenticatedUser, departmentId: number, dto: SetWorkNoDto) {
    const dept = await this.assertDepartment(actor.tenantId, departmentId);
    if (dto.workNo) await this.assertWorkNoFree(actor.tenantId, dto.workNo, departmentId);

    await this.prisma.runInTransaction(async (tx) => {
      await tx.department.update({ where: { id: departmentId }, data: { workNo: dto.workNo } });
      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_WORKNO_UPDATED',
        aggregateType: 'WORKNO',
        aggregateId: departmentId,
        payload: { workNo: dto.workNo },
        audit: {
          actorId: actor.userId,
          action: 'WORKNO_SET',
          targetType: 'DEPARTMENT',
          targetId: departmentId,
          before: { workNo: dept.workNo },
          after: { workNo: dto.workNo },
        },
      });
    });

    return { departmentId, workNo: dto.workNo };
  }

  /** 加工号成员。工号成员即该级投票人（D4），所以这里要限制必须是启用中的用户 */
  async addWorkNoMember(actor: AuthenticatedUser, departmentId: number, dto: AddWorkNoMemberDto) {
    const dept = await this.prisma.department.findFirst({
      where: { id: departmentId, tenantId: actor.tenantId },
      select: { id: true, name: true, workNo: true },
    });
    if (!dept) throw AppError.of('SYS_NOT_FOUND', '部门不存在');
    if (!dept.workNo) throw AppError.of('SYS_VALIDATION_FAILED', '请先为该部门设置工号，再添加成员');

    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, tenantId: actor.tenantId },
      select: { id: true, name: true, status: true },
    });
    if (!user) throw AppError.of('SYS_NOT_FOUND', '用户不存在');
    if (user.status !== 'ACTIVE') throw AppError.of('SYS_VALIDATION_FAILED', `用户「${user.name}」不是启用状态`);

    await this.prisma.runInTransaction(async (tx) => {
      await tx.departmentWorkNoMember.upsert({
        where: { departmentId_userId: { departmentId, userId: dto.userId } },
        update: { status: 'ACTIVE', receiveNotify: true },
        create: {
          tenantId: actor.tenantId,
          departmentId,
          userId: dto.userId,
          isPrimary: dto.isPrimary ?? false,
          receiveNotify: true,
        },
      });

      // 一个工号只能有一个主责人：设了新的就把旧的降下来
      if (dto.isPrimary) {
        await tx.departmentWorkNoMember.updateMany({
          where: { departmentId, userId: { not: dto.userId } },
          data: { isPrimary: false },
        });
      }

      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_WORKNO_MEMBER_ADDED',
        aggregateType: 'WORKNO',
        aggregateId: departmentId,
        payload: { workNo: dept.workNo, userId: dto.userId, userName: user.name, isPrimary: dto.isPrimary ?? false },
        audit: {
          actorId: actor.userId,
          action: 'WORKNO_ADD_MEMBER',
          targetType: 'DEPARTMENT',
          targetId: departmentId,
          after: { workNo: dept.workNo, userId: dto.userId, isPrimary: dto.isPrimary ?? false },
        },
      });
    });

    return { departmentId, userId: dto.userId, added: true };
  }

  async removeWorkNoMember(actor: AuthenticatedUser, departmentId: number, userId: number) {
    const member = await this.prisma.departmentWorkNoMember.findUnique({
      where: { departmentId_userId: { departmentId, userId } },
      select: { id: true, isPrimary: true, user: { select: { name: true } } },
    });
    if (!member) throw AppError.of('SYS_NOT_FOUND', '该用户不是此工号的成员');

    await this.prisma.runInTransaction(async (tx) => {
      await tx.departmentWorkNoMember.delete({ where: { id: member.id } });
      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_WORKNO_MEMBER_REMOVED',
        aggregateType: 'WORKNO',
        aggregateId: departmentId,
        payload: { userId, userName: member.user.name, wasPrimary: member.isPrimary },
        audit: {
          actorId: actor.userId,
          action: 'WORKNO_REMOVE_MEMBER',
          targetType: 'DEPARTMENT',
          targetId: departmentId,
          before: { userId, userName: member.user.name, wasPrimary: member.isPrimary },
        },
      });
    });

    return { departmentId, userId, removed: true };
  }

  /** 指定工号主责人（D5：只决定"谁默认填结论"，不决定"谁才有票"） */
  async setWorkNoPrimary(actor: AuthenticatedUser, departmentId: number, userId: number) {
    const member = await this.prisma.departmentWorkNoMember.findUnique({
      where: { departmentId_userId: { departmentId, userId } },
      select: { id: true },
    });
    if (!member) throw AppError.of('SYS_NOT_FOUND', '该用户不是此工号的成员');

    await this.prisma.runInTransaction(async (tx) => {
      await tx.departmentWorkNoMember.updateMany({ where: { departmentId }, data: { isPrimary: false } });
      await tx.departmentWorkNoMember.update({ where: { id: member.id }, data: { isPrimary: true } });
      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_WORKNO_PRIMARY_CHANGED',
        aggregateType: 'WORKNO',
        aggregateId: departmentId,
        payload: { userId },
        audit: {
          actorId: actor.userId,
          action: 'WORKNO_SET_PRIMARY',
          targetType: 'DEPARTMENT',
          targetId: departmentId,
          after: { userId },
        },
      });
    });

    return { departmentId, primaryUserId: userId };
  }

  /* ------------------------------- 内部 ------------------------------- */

  private async assertDepartment(tenantId: number, id: number) {
    const dept = await this.prisma.department.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, code: true, parentId: true, path: true, level: true, workNo: true, status: true, managerId: true, sort: true },
    });
    if (!dept) throw AppError.of('SYS_NOT_FOUND', '部门不存在');
    return dept;
  }

  private async assertWorkNoFree(tenantId: number, workNo: string, excludeDepartmentId: number | null) {
    const existing = await this.prisma.department.findFirst({
      where: { tenantId, workNo, ...(excludeDepartmentId ? { id: { not: excludeDepartmentId } } : {}) },
      select: { name: true },
    });
    if (existing) throw AppError.of('SYS_VALIDATION_FAILED', `工号 ${workNo} 已被部门「${existing.name}」占用`);
  }

  private async assertDeptCodeFree(tenantId: number, code: string, excludeDepartmentId: number | null) {
    const existing = await this.prisma.department.findFirst({
      where: { tenantId, code, ...(excludeDepartmentId ? { id: { not: excludeDepartmentId } } : {}) },
      select: { name: true },
    });
    if (existing) throw AppError.of('SYS_VALIDATION_FAILED', `部门编码 ${code} 已被「${existing.name}」占用`);
  }
}

/** 供其它服务复用的部门树类型（前端按 parentId 自己挂树，避免后端重复实现） */
export type AdminDepartmentRow = Awaited<ReturnType<AdminOrgService['listDepartments']>>[number];
export type PrismaDepartmentWhere = Prisma.DepartmentWhereInput;
