import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { paginationQuerySchema } from '@oa/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { ConclusionService } from './conclusion.service';
import { VoteService } from './vote.service';
import {
  castVoteBodySchema,
  markAbsentBodySchema,
  revokeAbsentBodySchema,
  submitConclusionBodySchema,
  type CastVoteBody,
  type MarkAbsentBody,
  type RevokeAbsentBody,
  type SubmitConclusionBody,
} from './vote.dto';

const myPendingQuerySchema = paginationQuerySchema;

@ApiTags('vote')
@Controller('instances/:id')
export class VoteController {
  constructor(
    private readonly votes: VoteService,
    private readonly conclusions: ConclusionService,
  ) {}

  @Post('votes')
  @RequirePermissions('VOTE_CAST')
  @ApiOperation({ summary: '投票 / 改票（结论形成前可反复更改）' })
  cast(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(castVoteBodySchema)) body: CastVoteBody,
  ) {
    return this.votes.castVote(user, id, body);
  }

  @Post('absent')
  @RequirePermissions('VOTE_MARK_ABSENT')
  @ApiOperation({ summary: '标记投票人缺席（剔除出投票池，不算票）' })
  markAbsent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(markAbsentBodySchema)) body: MarkAbsentBody,
  ) {
    return this.votes.markAbsent(user, id, body);
  }

  @Delete('absent/:userId')
  @RequirePermissions('VOTE_MARK_ABSENT')
  @ApiOperation({ summary: '撤销缺席标记（投票池恢复，保留痕迹）' })
  revokeAbsent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body(new ZodValidationPipe(revokeAbsentBodySchema)) body: RevokeAbsentBody,
  ) {
    return this.votes.revokeAbsent(user, id, userId, body);
  }

  @Get('vote-progress')
  @RequirePermissions('VOTE_READ')
  @ApiOperation({ summary: '投票进度（本部门可见明细，跨部门只给聚合计数）' })
  progress(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.votes.getProgress(user, id);
  }


  @Post('conclusion')
  @RequirePermissions('NODE_CONCLUDE')
  @ApiOperation({ summary: '提交本层人工结论（改判需 NODE_CONCLUDE_OVERRIDE）' })
  conclude(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(submitConclusionBodySchema)) body: SubmitConclusionBody,
  ) {
    return this.conclusions.submitConclusion(user, id, body);
  }
}
