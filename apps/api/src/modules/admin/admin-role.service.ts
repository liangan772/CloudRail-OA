import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS, PERMISSION_CODE_SET } from '@oa/shared';
import { AppError } from '../../common/errors/app-error';
import { DomainEventService } from '../../infra/events/domain-event.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import type { CreateRoleDto, SetRolePermissionsDto, UpdateRoleDto } from './admin.dto';

/**
 * 角色与权限管理。
 *
 * 权限点是**代码定义**的（`packages/shared` 里的 PERMISSIONS），不是数据表里随便加的，
 * 所以这里只能"给角色分配已有权限"，不能新建权限点 —— 否则前端 `can()` 与后端守卫会立刻漂移。
 * 系统内置角色（isSystem）不允许删除，但允许调整权限（便于按租户微调）。
 */
@Injectable()
export class AdminRoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventService,
  ) {}

  /** 权限点目录：按 module 分组，供前端做勾选面板 */
  permissionCatalog() {
    const grouped = new Map<string, { code: string; name: string; type: string }[]>();
    for (const permission of PERMISSIONS) {
      const list = grouped.get(permission.module) ?? [];
      list.push({ code: permission.code, name: permission.name, type: permission.type });
      grouped.set(permission.module, list);
    }
    return [...grouped.entries()].map(([module, items]) => ({ module, items }));
  }

  /** 角色下拉选项：给用户管理页用（只给 code/name，不含权限明细） */
  async options() {
    return this.prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { id: 'asc' }],
      select: { id: true, code: true, name: true, dataScopeDefault: true, isSystem: true },
    });
  }

  async list(query: { page: number; pageSize: number; keyword?: string }) {
    const where: Prisma.RoleWhereInput = query.keyword
      ? {
          OR: [
            { code: { contains: query.keyword, mode: 'insensitive' } },
            { name: { contains: query.keyword, mode: 'insensitive' } },
          ],
        }
      : {};

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.role.findMany({
        where,
        orderBy: [{ isSystem: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          code: true,
          name: true,
          dataScopeDefault: true,
          isSystem: true,
          createdAt: true,
          permissions: { select: { permission: { select: { code: true, name: true, module: true } } } },
          _count: { select: { users: true } },
        },
      }),
      this.prisma.role.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        dataScopeDefault: row.dataScopeDefault,
        isSystem: row.isSystem,
        createdAt: row.createdAt,
        userCount: row._count.users,
        permissionCount: row.permissions.length,
        permissions: row.permissions
          .map((p) => p.permission)
          .sort((a, b) => a.code.localeCompare(b.code)),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(roleId: number) {
    const row = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: {
        id: true,
        code: true,
        name: true,
        dataScopeDefault: true,
        isSystem: true,
        permissions: { select: { permission: { select: { code: true } } } },
      },
    });
    if (!row) throw AppError.of('SYS_NOT_FOUND', '角色不存在');
    return { ...row, permissionCodes: row.permissions.map((p) => p.permission.code) };
  }

  async create(actor: AuthenticatedUser, dto: CreateRoleDto) {
    const existing = await this.prisma.role.findFirst({
      where: { tenantId: actor.tenantId, code: dto.code },
      select: { id: true },
    });
    if (existing) throw AppError.of('SYS_VALIDATION_FAILED', `角色码 ${dto.code} 已存在`);

    const codes = this.assertPermissionCodes(dto.permissionCodes ?? []);
    const permissionIds = await this.idsOfPermissions(codes);

    const created = await this.prisma.runInTransaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          tenantId: actor.tenantId,
          code: dto.code,
          name: dto.name,
          dataScopeDefault: dto.dataScopeDefault,
          isSystem: false,
        },
      });

      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
          skipDuplicates: true,
        });
      }

      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_ROLE_CREATED',
        aggregateType: 'ROLE',
        aggregateId: role.id,
        payload: { code: dto.code, name: dto.name, permissionCodes: codes },
        audit: {
          actorId: actor.userId,
          action: 'ROLE_CREATE',
          targetType: 'ROLE',
          targetId: role.id,
          after: { code: dto.code, name: dto.name, permissionCodes: codes },
        },
      });

      return role;
    });

    return this.detail(created.id);
  }

  async update(actor: AuthenticatedUser, roleId: number, dto: UpdateRoleDto) {
    const before = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId: actor.tenantId },
      select: { id: true, code: true, name: true, dataScopeDefault: true },
    });
    if (!before) throw AppError.of('SYS_NOT_FOUND', '角色不存在');

    await this.prisma.runInTransaction(async (tx) => {
      await tx.role.update({
        where: { id: roleId },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.dataScopeDefault === undefined ? {} : { dataScopeDefault: dto.dataScopeDefault }),
        },
      });

      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_ROLE_UPDATED',
        aggregateType: 'ROLE',
        aggregateId: roleId,
        payload: { changes: dto },
        audit: { actorId: actor.userId, action: 'ROLE_UPDATE', targetType: 'ROLE', targetId: roleId, before, after: dto },
      });
    });

    return this.detail(roleId);
  }

  /** 整表替换权限：先清后建，保证"界面上勾掉的就是真的没了" */
  async setPermissions(actor: AuthenticatedUser, roleId: number, dto: SetRolePermissionsDto) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId: actor.tenantId },
      select: { id: true, code: true },
    });
    if (!role) throw AppError.of('SYS_NOT_FOUND', '角色不存在');

    const codes = this.assertPermissionCodes(dto.permissionCodes);
    const permissionIds = await this.idsOfPermissions(codes);

    await this.prisma.runInTransaction(async (tx) => {
      const before = await tx.rolePermission.findMany({
        where: { roleId },
        select: { permission: { select: { code: true } } },
      });

      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
          skipDuplicates: true,
        });
      }

      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_ROLE_PERMISSIONS_CHANGED',
        aggregateType: 'ROLE',
        aggregateId: roleId,
        payload: { permissionCodes: codes },
        audit: {
          actorId: actor.userId,
          action: 'ROLE_SET_PERMISSIONS',
          targetType: 'ROLE',
          targetId: roleId,
          before: before.map((p) => p.permission.code).sort(),
          after: codes,
        },
      });
    });

    return this.detail(roleId);
  }

  async remove(actor: AuthenticatedUser, roleId: number) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId: actor.tenantId },
      select: { id: true, code: true, name: true, isSystem: true, _count: { select: { users: true } } },
    });
    if (!role) throw AppError.of('SYS_NOT_FOUND', '角色不存在');
    if (role.isSystem) throw AppError.of('SYS_VALIDATION_FAILED', '内置角色不可删除');
    if (role._count.users > 0) {
      throw AppError.of('SYS_VALIDATION_FAILED', `仍有 ${role._count.users} 个用户使用该角色，请先改派`);
    }

    await this.prisma.runInTransaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.role.delete({ where: { id: roleId } });
      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_ROLE_DELETED',
        aggregateType: 'ROLE',
        aggregateId: roleId,
        payload: { code: role.code, name: role.name },
        audit: {
          actorId: actor.userId,
          action: 'ROLE_DELETE',
          targetType: 'ROLE',
          targetId: roleId,
          before: { code: role.code, name: role.name },
        },
      });
    });

    return { id: roleId, deleted: true };
  }

  /* ------------------------------- 内部 ------------------------------- */

  /** 权限点必须是代码里定义过的，避免写进库之后前端 can() 永远为 false */
  private assertPermissionCodes(codes: string[]): string[] {
    const unique = [...new Set(codes)];
    const unknown = unique.filter((code) => !PERMISSION_CODE_SET.has(code));
    if (unknown.length > 0) {
      throw AppError.of('SYS_VALIDATION_FAILED', `未知权限点：${unknown.join('、')}`);
    }
    return unique;
  }

  private async idsOfPermissions(codes: string[]): Promise<number[]> {
    if (codes.length === 0) return [];
    const rows = await this.prisma.permission.findMany({
      where: { code: { in: codes } },
      select: { id: true },
    });
    if (rows.length !== codes.length) {
      throw AppError.of('SYS_VALIDATION_FAILED', '权限点未初始化，请先执行种子脚本（pnpm db:seed）');
    }
    return rows.map((row) => row.id);
  }
}
