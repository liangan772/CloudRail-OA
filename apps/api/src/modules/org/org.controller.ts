import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { OrgService } from './org.service';
import { departmentQuerySchema, orgUserQuerySchema, type DepartmentQuery, type OrgUserQuery } from './org.dto';

/**
 * 组织接口：所有登录用户可读（部门选择器、人员选择器都要用），
 * 可见范围由数据范围守卫决定，不做额外的权限点限制。
 */
@ApiTags('org')
@Controller('org')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('departments')
  @ApiOperation({ summary: '组织树（按数据范围裁剪）' })
  departments(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(departmentQuerySchema)) query: DepartmentQuery,
  ) {
    return this.org.departmentTree(user, query);
  }

  @Get('departments/:id')
  @ApiOperation({ summary: '部门详情（含部门工号成员）' })
  department(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.org.departmentDetail(user, id);
  }

  @Get('worknos')
  @ApiOperation({ summary: '部门工号列表（上报投递目标）' })
  workNos(@CurrentUser() user: AuthenticatedUser) {
    return this.org.listWorkNos(user);
  }

  @Get('users')
  @ApiOperation({ summary: '用户列表（按数据范围过滤 + 分页）' })
  users(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(orgUserQuerySchema)) query: OrgUserQuery,
  ) {
    return this.org.listUsers(user, query);
  }
}
