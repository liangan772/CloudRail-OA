import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { hashPassword } from '../../common/crypto/password';
import { DomainEventService } from '../../infra/events/domain-event.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import type { AdminUserQuery, AssignRolesDto, CreateUserDto, ResetPasswordDto, UpdateUserDto } from './admin.dto';

/** 重置密码时的兜底口令。返回值里会带回，方便管理员转告用户后立即要求改密 */
const DEFAULT_RESET_PASSWORD = 'Cloudrail@123';

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  departments: {
    orderBy: { isPrimary: 'desc' },
    select: {
      isPrimary: true,
      isLeader: true,
      title: true,
      department: { select: { id: true, name: true, path: true } },
    },
  },
  roles: {
    select: {
      scopeType: true,
      scopeId: true,
      role: { select: { id: true, code: true, name: true, dataScopeDefault: true, isSystem: true } },
    },
  },
} satisfies Prisma.UserSelect;

/**
 * 用户管理。
 *
 * 与 org 模块的区别：org 只读且按数据范围裁剪（给选择器用），
 * 这里面向管理员，**不做数据范围裁剪但要求 USER_MANAGE 权限**，
 * 且所有写操作走「领域事件 + 审计」同事务（C9）。
 */
@Injectable()
export class AdminUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventService,
  ) {}

  async list(query: AdminUserQuery) {
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword, mode: 'insensitive' } },
              { email: { contains: query.keyword, mode: 'insensitive' } },
              { phone: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.deptId ? { departments: { some: { departmentId: query.deptId } } } : {}),
      ...(query.roleCode ? { roles: { some: { role: { code: query.roleCode } } } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: USER_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items: rows.map((row) => this.toView(row)), total, page: query.page, pageSize: query.pageSize };
  }

  async detail(user: AuthenticatedUser, id: number) {
    const row = await this.prisma.user.findFirst({ where: { id, tenantId: user.tenantId }, select: USER_SELECT });
    if (!row) throw AppError.of('SYS_NOT_FOUND', '用户不存在');
    return this.toView(row);
  }

  async create(actor: AuthenticatedUser, dto: CreateUserDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findFirst({ where: { tenantId: actor.tenantId, email } });
    if (existing) throw AppError.of('SYS_VALIDATION_FAILED', `邮箱 ${email} 已被占用`);

    const passwordHash = await hashPassword(dto.password);
    const dept = dto.deptId ? await this.assertDepartment(actor.tenantId, dto.deptId) : null;
    const roles = await this.resolveRoles(actor.tenantId, dto.roleCodes ?? []);

    const created = await this.prisma.runInTransaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId: actor.tenantId,
          email,
          name: dto.name,
          phone: dto.phone ?? null,
          passwordHash,
          status: 'ACTIVE',
        },
      });

      if (dept) {
        await tx.userDepartment.create({
          data: {
            tenantId: actor.tenantId,
            userId: user.id,
            departmentId: dept.id,
            isPrimary: true,
            isLeader: dto.isLeader ?? false,
            title: dto.title ?? null,
          },
        });
        if (dto.isLeader) {
          await tx.department.update({ where: { id: dept.id }, data: { managerId: user.id } });
        }
      }

      for (const role of roles) {
        await tx.userRole.create({
          data: {
            tenantId: actor.tenantId,
            userId: user.id,
            roleId: role.id,
            scopeType: role.dataScopeDefault === 'TENANT' ? 'TENANT' : 'DEPT',
            scopeId: role.dataScopeDefault === 'TENANT' ? null : (dept?.id ?? null),
          },
        });
      }

      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_USER_CREATED',
        aggregateType: 'USER',
        aggregateId: user.id,
        payload: { email, name: dto.name, deptId: dept?.id ?? null, roleCodes: dto.roleCodes ?? [] },
        audit: {
          actorId: actor.userId,
          action: 'USER_CREATE',
          targetType: 'USER',
          targetId: user.id,
          after: { email, name: dto.name, deptId: dept?.id ?? null, roleCodes: dto.roleCodes ?? [] },
        },
      });

      return user;
    });

    return this.detail(actor, created.id);
  }

  async update(actor: AuthenticatedUser, id: number, dto: UpdateUserDto) {
    const before = await this.prisma.user.findFirst({
      where: { id, tenantId: actor.tenantId },
      select: { id: true, name: true, phone: true, status: true },
    });
    if (!before) throw AppError.of('SYS_NOT_FOUND', '用户不存在');

    // 不允许把自己停用/锁定 —— 否则管理员可能把自己锁在门外
    if (dto.status && dto.status !== 'ACTIVE' && id === actor.userId) {
      throw AppError.of('SYS_VALIDATION_FAILED', '不能停用或锁定当前登录的账号');
    }

    const dept = dto.deptId ? await this.assertDepartment(actor.tenantId, dto.deptId) : null;

    await this.prisma.runInTransaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.phone === undefined ? {} : { phone: dto.phone }),
          ...(dto.status === undefined ? {} : { status: dto.status }),
        },
      });

      // deptId 显式传值时才动部门关系：null 表示移出当前主部门
      if (dto.deptId !== undefined) {
        await tx.userDepartment.deleteMany({ where: { userId: id, tenantId: actor.tenantId } });
        if (dept) {
          await tx.userDepartment.create({
            data: {
              tenantId: actor.tenantId,
              userId: id,
              departmentId: dept.id,
              isPrimary: true,
              isLeader: dto.isLeader ?? false,
              title: dto.title ?? null,
            },
          });
          if (dto.isLeader) {
            await tx.department.update({ where: { id: dept.id }, data: { managerId: id } });
          }
        }
      } else if (dto.isLeader !== undefined || dto.title !== undefined) {
        await tx.userDepartment.updateMany({
          where: { userId: id, tenantId: actor.tenantId, isPrimary: true },
          data: {
            ...(dto.isLeader === undefined ? {} : { isLeader: dto.isLeader }),
            ...(dto.title === undefined ? {} : { title: dto.title }),
          },
        });
      }

      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_USER_UPDATED',
        aggregateType: 'USER',
        aggregateId: id,
        payload: { changes: dto },
        audit: {
          actorId: actor.userId,
          action: 'USER_UPDATE',
          targetType: 'USER',
          targetId: id,
          before,
          after: dto,
        },
      });
    });

    return this.detail(actor, id);
  }

  async resetPassword(actor: AuthenticatedUser, id: number, dto: ResetPasswordDto) {
    const target = await this.prisma.user.findFirst({
      where: { id, tenantId: actor.tenantId },
      select: { id: true, email: true },
    });
    if (!target) throw AppError.of('SYS_NOT_FOUND', '用户不存在');

    const password = dto.password ?? DEFAULT_RESET_PASSWORD;
    const passwordHash = await hashPassword(password);

    await this.prisma.runInTransaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash, status: 'ACTIVE' } });
      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_USER_PASSWORD_RESET',
        aggregateType: 'USER',
        aggregateId: id,
        payload: { email: target.email, explicit: Boolean(dto.password) },
        // 口令本身绝不进审计
        audit: {
          actorId: actor.userId,
          action: 'USER_RESET_PASSWORD',
          targetType: 'USER',
          targetId: id,
          after: { email: target.email, explicit: Boolean(dto.password) },
        },
      });
    });

    return { id, password };
  }

  async assignRoles(actor: AuthenticatedUser, id: number, dto: AssignRolesDto) {
    const target = await this.prisma.user.findFirst({
      where: { id, tenantId: actor.tenantId },
      select: { id: true, departments: { where: { isPrimary: true }, select: { departmentId: true } } },
    });
    if (!target) throw AppError.of('SYS_NOT_FOUND', '用户不存在');

    const roles = await this.resolveRoles(actor.tenantId, dto.roleCodes);
    const deptId = target.departments[0]?.departmentId ?? null;

    await this.prisma.runInTransaction(async (tx) => {
      const before = await tx.userRole.findMany({
        where: { userId: id, tenantId: actor.tenantId },
        select: { roleId: true, scopeType: true, scopeId: true },
      });

      await tx.userRole.deleteMany({ where: { userId: id, tenantId: actor.tenantId } });
      for (const role of roles) {
        await tx.userRole.create({
          data: {
            tenantId: actor.tenantId,
            userId: id,
            roleId: role.id,
            scopeType: role.dataScopeDefault === 'TENANT' ? 'TENANT' : 'DEPT',
            scopeId: role.dataScopeDefault === 'TENANT' ? null : deptId,
          },
        });
      }

      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_USER_ROLES_CHANGED',
        aggregateType: 'USER',
        aggregateId: id,
        payload: { roleCodes: dto.roleCodes },
        audit: {
          actorId: actor.userId,
          action: 'USER_ASSIGN_ROLES',
          targetType: 'USER',
          targetId: id,
          before,
          after: { roleCodes: dto.roleCodes },
        },
      });
    });

    return this.detail(actor, id);
  }

  /* ------------------------------- 内部 ------------------------------- */

  private toView(row: Prisma.UserGetPayload<{ select: typeof USER_SELECT }>) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      status: row.status,
      createdAt: row.createdAt,
      departments: row.departments.map((d) => ({
        departmentId: d.department.id,
        departmentName: d.department.name,
        isPrimary: d.isPrimary,
        isLeader: d.isLeader,
        title: d.title,
      })),
      roles: row.roles.map((r) => ({
        id: r.role.id,
        code: r.role.code,
        name: r.role.name,
        dataScopeDefault: r.role.dataScopeDefault,
        isSystem: r.role.isSystem,
        scopeType: r.scopeType,
        scopeId: r.scopeId,
      })),
    };
  }

  private async assertDepartment(tenantId: number, departmentId: number) {
    const dept = await this.prisma.department.findFirst({
      where: { id: departmentId, tenantId },
      select: { id: true, name: true, status: true },
    });
    if (!dept) throw AppError.of('SYS_NOT_FOUND', '部门不存在');
    if (dept.status !== 'ACTIVE') throw AppError.of('SYS_VALIDATION_FAILED', `部门「${dept.name}」已停用`);
    return dept;
  }

  private async resolveRoles(tenantId: number, roleCodes: string[]) {
    if (roleCodes.length === 0) return [];
    const unique = [...new Set(roleCodes)];
    const roles = await this.prisma.role.findMany({
      where: { tenantId, code: { in: unique } },
      select: { id: true, code: true, dataScopeDefault: true },
    });
    const found = new Set(roles.map((role) => role.code));
    const missing = unique.filter((code) => !found.has(code));
    if (missing.length > 0) {
      throw AppError.of('SYS_VALIDATION_FAILED', `角色不存在：${missing.join('、')}`);
    }
    return roles;
  }
}
