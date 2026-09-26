import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { AdminOrgService } from './admin-org.service';
import {
  addWorkNoMemberSchema,
  createDepartmentSchema,
  moveDepartmentSchema,
  setWorkNoSchema,
  updateDepartmentSchema,
  type AddWorkNoMemberDto,
  type CreateDepartmentDto,
  type MoveDepartmentDto,
  type SetWorkNoDto,
  type UpdateDepartmentDto,
} from './admin.dto';

const includeDisabledSchema = z.object({ includeDisabled: z.coerce.boolean().optional() });

@ApiTags('admin')
@Controller('admin')
export class AdminOrgController {
  constructor(private readonly org: AdminOrgService) {}

  /* ------------------------------ 部门 ------------------------------ */

  @Get('departments')
  @RequirePermissions('ORG_MANAGE', 'DEPT_WORKNO_MANAGE')
  @ApiOperation({ summary: '部门列表（扁平，含成员数与下级数；前端按 parentId 挂树）' })
  listDepartments(@Query(new ZodValidationPipe(includeDisabledSchema)) query: { includeDisabled?: boolean }) {
    return this.org.listDepartments(query.includeDisabled);
  }

  @Post('departments')
  @RequirePermissions('ORG_MANAGE')
  @ApiOperation({ summary: '新建部门' })
  createDepartment(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createDepartmentSchema)) body: CreateDepartmentDto,
  ) {
    return this.org.createDepartment(user, body);
  }

  @Patch('departments/:id')
  @RequirePermissions('ORG_MANAGE')
  @ApiOperation({ summary: '更新部门（名称 / 编码 / 工号 / 负责人 / 排序 / 状态）' })
  updateDepartment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateDepartmentSchema)) body: UpdateDepartmentDto,
  ) {
    return this.org.updateDepartment(user, id, body);
  }

  @Post('departments/:id/move')
  @RequirePermissions('ORG_MANAGE')
  @ApiOperation({ summary: '移动部门（连带整棵子树重写物化路径）' })
  moveDepartment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(moveDepartmentSchema)) body: MoveDepartmentDto,
  ) {
    return this.org.moveDepartment(user, id, body.parentId);
  }

  @Delete('departments/:id')
  @RequirePermissions('ORG_MANAGE')
  @ApiOperation({ summary: '删除部门（有下级或成员时拒绝）' })
  removeDepartment(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.org.removeDepartment(user, id);
  }

  /* ------------------------------ 工号 ------------------------------ */

  @Get('worknos')
  @RequirePermissions('ORG_MANAGE', 'DEPT_WORKNO_MANAGE')
  @ApiOperation({ summary: '部门工号与成员列表' })
  listWorkNos(@Query(new ZodValidationPipe(includeDisabledSchema)) query: { includeDisabled?: boolean }) {
    return this.org.listWorkNos(query.includeDisabled);
  }

  @Post('worknos/:departmentId')
  @RequirePermissions('DEPT_WORKNO_MANAGE')
  @ApiOperation({ summary: '设置或清空部门工号（传 null 清空）' })
  setWorkNo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('departmentId', ParseIntPipe) departmentId: number,
    @Body(new ZodValidationPipe(setWorkNoSchema)) body: SetWorkNoDto,
  ) {
    return this.org.setWorkNo(user, departmentId, body);
  }

  @Post('worknos/:departmentId/members')
  @RequirePermissions('DEPT_WORKNO_MANAGE')
  @ApiOperation({ summary: '添加工号成员（成员即该级投票人）' })
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('departmentId', ParseIntPipe) departmentId: number,
    @Body(new ZodValidationPipe(addWorkNoMemberSchema)) body: AddWorkNoMemberDto,
  ) {
    return this.org.addWorkNoMember(user, departmentId, body);
  }

  @Delete('worknos/:departmentId/members/:userId')
  @RequirePermissions('DEPT_WORKNO_MANAGE')
  @ApiOperation({ summary: '移除工号成员' })
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('departmentId', ParseIntPipe) departmentId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.org.removeWorkNoMember(user, departmentId, userId);
  }

  @Post('worknos/:departmentId/primary/:userId')
  @RequirePermissions('DEPT_WORKNO_MANAGE')
  @ApiOperation({ summary: '指定工号主责人（决定谁默认填结论）' })
  setPrimary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('departmentId', ParseIntPipe) departmentId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.org.setWorkNoPrimary(user, departmentId, userId);
  }
}
