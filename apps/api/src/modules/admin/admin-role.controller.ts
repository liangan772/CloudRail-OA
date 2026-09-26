import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { AdminRoleService } from './admin-role.service';
import {
  adminRoleQuerySchema,
  createRoleSchema,
  setRolePermissionsSchema,
  updateRoleSchema,
  type CreateRoleDto,
  type SetRolePermissionsDto,
  type UpdateRoleDto,
} from './admin.dto';

@ApiTags('admin')
@Controller('admin/roles')
@RequirePermissions('ROLE_MANAGE')
export class AdminRoleController {
  constructor(private readonly roles: AdminRoleService) {}

  @Get()
  @ApiOperation({ summary: '角色列表（含权限数与用户数）' })
  list(@Query(new ZodValidationPipe(adminRoleQuerySchema)) query: { page: number; pageSize: number; keyword?: string }) {
    return this.roles.list(query);
  }

  @Get('permissions')
  @ApiOperation({ summary: '权限点目录（按模块分组），供勾选面板使用' })
  permissionCatalog() {
    return this.roles.permissionCatalog();
  }

  /**
   * 角色选项。
   * 方法级 `@RequirePermissions` 会覆盖类级（守卫用的是 getAllAndOverride），
   * 所以只有 USER_MANAGE 的人也能拿到角色下拉 —— 否则分配角色时选不了。
   */
  @Get('options')
  @RequirePermissions('ROLE_MANAGE', 'USER_MANAGE')
  @ApiOperation({ summary: '角色下拉选项（用户管理页分配角色时使用）' })
  options() {
    return this.roles.options();
  }

  @Get(':id')
  @ApiOperation({ summary: '角色详情（含权限码列表）' })
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.roles.detail(id);
  }

  @Post()
  @ApiOperation({ summary: '新建角色' })
  create(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(createRoleSchema)) body: CreateRoleDto) {
    return this.roles.create(user, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新角色名称与默认数据范围' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: UpdateRoleDto,
  ) {
    return this.roles.update(user, id, body);
  }

  @Post(':id/permissions')
  @ApiOperation({ summary: '整表替换角色权限' })
  setPermissions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(setRolePermissionsSchema)) body: SetRolePermissionsDto,
  ) {
    return this.roles.setPermissions(user, id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除角色（内置角色或仍被使用的角色不可删）' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.roles.remove(user, id);
  }
}
