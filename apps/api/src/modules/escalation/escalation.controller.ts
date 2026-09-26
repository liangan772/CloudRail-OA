import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { EscalationService } from './escalation.service';
import {
  escalationListQuerySchema,
  submitEscalationConclusionSchema,
  upgradeEscalationSchema,
  type EscalationListQuery,
  type SubmitEscalationConclusionBody,
  type UpgradeEscalationBody,
} from './escalation.dto';

@ApiTags('escalation')
@Controller('escalations')
export class EscalationController {
  constructor(private readonly escalations: EscalationService) {}

  @Get()
  @RequirePermissions('ESC_READ')
  @ApiOperation({ summary: '上报列表（我所在工号待处理 / 数据范围内全部）' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(escalationListQuerySchema)) query: EscalationListQuery,
  ) {
    return this.escalations.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('ESC_READ')
  @ApiOperation({ summary: '上报详情（含逐级链路与处理记录）' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.escalations.detail(user, id);
  }

  @Post(':id/conclusion')
  @RequirePermissions('ESC_CONCLUDE')
  @ApiOperation({ summary: '上级填写结论并回写原流程（需目标工号成员身份）' })
  conclude(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(submitEscalationConclusionSchema)) body: SubmitEscalationConclusionBody,
  ) {
    return this.escalations.submitConclusion(user, id, body);
  }

  @Post(':id/upgrade')
  @RequirePermissions('ESC_UPGRADE')
  @ApiOperation({ summary: '继续上报上一级（逐级上溯，受 maxLevel 限制）' })
  upgrade(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upgradeEscalationSchema)) body: UpgradeEscalationBody,
  ) {
    return this.escalations.upgrade(user, id, body.reason);
  }
}
