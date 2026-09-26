import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { AdminOpsService } from './admin-ops.service';
import { outboxQuerySchema, type OutboxQuery } from './admin.dto';

const replaySchema = z.object({
  ids: z.array(z.string().trim().regex(/^\d+$/, '事件 id 必须是数字字符串')).min(1).max(200),
});

@ApiTags('admin')
@Controller('admin/ops')
@RequirePermissions('SYS_MONITOR', 'AUDIT_READ')
export class AdminOpsController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get('overview')
  @ApiOperation({ summary: '业务概览（用户 / 部门 / 流程 / 任务 / 上报 / 通知计数）' })
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.ops.overview(user.tenantId);
  }

  @Get('runtime')
  @ApiOperation({ summary: '运行态（后台任务模式与周期、发件箱积压、通知渠道开关、存储驱动）' })
  runtime() {
    return this.ops.runtime();
  }

  @Get('outbox')
  @ApiOperation({ summary: '发件箱事件列表（按状态筛选，排查投递失败）' })
  outbox(@Query(new ZodValidationPipe(outboxQuerySchema)) query: OutboxQuery) {
    return this.ops.outbox(query);
  }

  @Post('outbox/replay')
  @ApiOperation({ summary: '人工重放发件箱事件（仅 FAILED / DEAD 会被重置为待投递）' })
  replay(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(replaySchema)) body: { ids: string[] }) {
    return this.ops.replay(user, body.ids);
  }

  @Post('dispatch')
  @ApiOperation({ summary: '立即触发一轮发件箱派发（不等待定时器）' })
  dispatch() {
    return this.ops.dispatchNow();
  }
}
