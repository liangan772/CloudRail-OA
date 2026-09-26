import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { AdminUserService } from './admin-user.service';
import {
  adminUserQuerySchema,
  assignRolesSchema,
  createUserSchema,
  resetPasswordSchema,
  updateUserSchema,
  type AdminUserQuery,
  type AssignRolesDto,
  type CreateUserDto,
  type ResetPasswordDto,
  type UpdateUserDto,
} from './admin.dto';

@ApiTags('admin')
@Controller('admin/users')
@RequirePermissions('USER_MANAGE')
export class AdminUserController {
  constructor(private readonly users: AdminUserService) {}

  @Get()
  @ApiOperation({ summary: '用户列表（关键词 / 部门 / 状态 / 角色筛选）' })
  list(@Query(new ZodValidationPipe(adminUserQuerySchema)) query: AdminUserQuery) {
    return this.users.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '用户详情（含角色与部门）' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.users.detail(user, id);
  }

  @Post()
  @ApiOperation({ summary: '新建用户（可同时分配部门与角色）' })
  create(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserDto) {
    return this.users.create(user, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新用户资料 / 状态 / 所属部门' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserDto,
  ) {
    return this.users.update(user, id, body);
  }

  @Post(':id/reset-password')
  @ApiOperation({ summary: '重置密码（不传则用系统默认口令，返回明文供管理员转告）' })
  resetPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordDto,
  ) {
    return this.users.resetPassword(user, id, body);
  }

  @Post(':id/roles')
  @ApiOperation({ summary: '整表替换用户角色（角色码列表）' })
  assignRoles(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(assignRolesSchema)) body: AssignRolesDto,
  ) {
    return this.users.assignRoles(user, id, body);
  }
}
