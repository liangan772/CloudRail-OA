import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { JobsService, type JobName } from './jobs.service';

const runJobSchema = z.object({
  job: z.enum(['outbox-dispatch', 'vote-timeout', 'conclusion-timeout', 'escalation-timeout']),
});

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('status')
  @RequirePermissions('AUDIT_READ')
  @ApiOperation({ summary: '后台任务模式、周期与 Outbox 积压' })
  status() {
    return this.jobs.status();
  }

  @Post('run')
  @RequirePermissions('AUDIT_READ')
  @ApiOperation({ summary: '手动触发一次任务（排障与联调用，不依赖队列）' })
  run(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(runJobSchema)) body: { job: JobName },
  ) {
    void user;
    return this.jobs.run(body.job);
  }
}
