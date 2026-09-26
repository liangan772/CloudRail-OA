import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createInstanceSchema, type CreateInstanceInput } from '@oa/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { InstanceService } from './instance.service';
import { instanceListQuerySchema, type InstanceListQuery } from './instance.dto';

@ApiTags('instance')
@Controller('instances')
export class InstanceController {
  constructor(private readonly instances: InstanceService) {}

  @Post()
  @RequirePermissions('INSTANCE_CREATE')
  @ApiOperation({ summary: '发起流程（自动解析首层投票人并快照）' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createInstanceSchema)) body: CreateInstanceInput,
  ) {
    return this.instances.createInstance(user, body);
  }

  @Get()
  @RequirePermissions('INSTANCE_READ')
  @ApiOperation({ summary: '流程列表（我发起的 / 数据范围内 / 全租户）' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(instanceListQuerySchema)) query: InstanceListQuery,
  ) {
    return this.instances.listInstances(user, query);
  }

  @Get(':id')
  @RequirePermissions('INSTANCE_READ')
  @ApiOperation({ summary: '流程详情（含各层投票人快照与进度）' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.instances.getInstance(user, id);
  }
}
