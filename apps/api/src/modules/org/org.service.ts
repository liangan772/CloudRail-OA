import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildTree } from '@oa/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { assertVisibleWithPath, resolveScope, type ScopePredicate } from '../../domain/access/data-scope';
import { departmentScopeWhere, userScopeWhere } from '../../domain/access/scope-query';
import type { DepartmentQuery, OrgUserQuery } from './org.dto';

@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService) {}

  /** 范围解析失败必须立刻失败，不能"猜一个" */
  private scopeOf(user: AuthenticatedUser): ScopePredicate {
    const resolved = resolveScope(user);
    if (!resolved.ok) throw AppError.fromDef(resolved.error, resolved.reason);
    return resolved.predicate;
  }

  /**
   * 组织树。范围受限时父部门可能不在结果里，此时被裁成根节点（前端按 parentId 挂不上的都当根渲染）。
   */
  async departmentTree(user: AuthenticatedUser, query: DepartmentQuery) {
    const predicate = this.scopeOf(user);
    const where: Prisma.DepartmentWhereInput = {
      tenantId: user.tenantId,
      ...(query.includeDisabled ? {} : { status: 'ACTIVE' }),
      ...(query.keyword ? { name: { contains: query.keyword, mode: 'insensitive' } } : {}),
      ...(departmentScopeWhere(predicate, user) as Prisma.DepartmentWhereInput),
    };

    const rows = await this.prisma.department.findMany({
      where,
      orderBy: [{ level: 'asc' }, { sort: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        parentId: true,
        name: true,
        path: true,
        level: true,
        code: true,
        workNo: true,
        managerId: true,
        sort: true,
      },
    });

    return buildTree(
      rows.map((row) => ({ ...row })),
      { sort: (a, b) => a.sort - b.sort || a.id - b.id },
    );
  }

  /** 部门详情：含工号成员、负责人、成员数与下级数；越权按 404 语义返回 */
  async departmentDetail(user: AuthenticatedUser, departmentId: number) {
    const row = await this.prisma.department.findFirst({
      where: { id: departmentId, tenantId: user.tenantId },
      include: {
        manager: { select: { id: true, name: true, email: true } },
        workNoMembers: {
          where: { status: 'ACTIVE' },
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
        },
        _count: { select: { members: true, children: true } },
      },
    });
    if (!row) throw AppError.of('SYS_NOT_FOUND');

    const visible = assertVisibleWithPath(user, {
      tenantId: row.tenantId,
      deptId: row.id,
      deptPath: row.path,
    });
    if (!visible.ok) throw AppError.fromDef(visible.error, visible.reason);

    return {
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      path: row.path,
      level: row.level,
      code: row.code,
      workNo: row.workNo,
      status: row.status,
      manager: row.manager,
      memberCount: row._count.members,
      childrenCount: row._count.children,
      workNoMembers: row.workNoMembers.map((member) => ({
        userId: member.userId,
        isPrimary: member.isPrimary,
        receiveNotify: member.receiveNotify,
        name: member.user.name,
        email: member.user.email,
      })),
    };
  }

  /** 部门工号列表：上报统一投递到上级部门的工号，这里供上报页与配置页选目标 */
  async listWorkNos(user: AuthenticatedUser) {
    const predicate = this.scopeOf(user);
    const rows = await this.prisma.department.findMany({
      where: {
        tenantId: user.tenantId,
        status: 'ACTIVE',
        workNo: { not: null },
        ...(departmentScopeWhere(predicate, user) as Prisma.DepartmentWhereInput),
      },
      orderBy: [{ level: 'asc' }, { sort: 'asc' }],
      select: {
        id: true,
        name: true,
        path: true,
        level: true,
        workNo: true,
        workNoMembers: {
          where: { status: 'ACTIVE' },
          orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
          select: { isPrimary: true, user: { select: { id: true, name: true } } },
        },
      },
    });

    return rows.map((row) => {
      const primary = row.workNoMembers.find((m) => m.isPrimary);
      return {
        departmentId: row.id,
        departmentName: row.name,
        path: row.path,
        level: row.level,
        workNo: row.workNo,
        primaryUserId: primary?.user.id ?? null,
        primaryUserName: primary?.user.name ?? null,
        memberCount: row.workNoMembers.length,
        members: row.workNoMembers.map((m) => ({ userId: m.user.id, name: m.user.name, isPrimary: m.isPrimary })),
      };
    });
  }

  /** 用户列表（分页）：按数据范围过滤所属部门 */
  async listUsers(user: AuthenticatedUser, query: OrgUserQuery) {
    const predicate = this.scopeOf(user);
    const where: Prisma.UserWhereInput = {
      tenantId: user.tenantId,
      status: 'ACTIVE',
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword, mode: 'insensitive' } },
              { email: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.deptId ? { departments: { some: { departmentId: query.deptId } } } : {}),
      ...(userScopeWhere(predicate, user) as Prisma.UserWhereInput),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          status: true,
          departments: {
            orderBy: { isPrimary: 'desc' },
            select: {
              isPrimary: true,
              isLeader: true,
              title: true,
              department: { select: { id: true, name: true, path: true } },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        status: row.status,
        departments: row.departments.map((d) => ({
          departmentId: d.department.id,
          departmentName: d.department.name,
          isPrimary: d.isPrimary,
          isLeader: d.isLeader,
          title: d.title,
        })),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
