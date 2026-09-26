import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { paginationQuerySchema } from '@oa/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { VoteService } from './vote.service';

// 投票中心的数据源：待我表态 / 待我填结论的流程。
// 单独一个控制器是因为 VoteController 的前缀是 instances/:id（都是"针对某个实例"的动作）。
@ApiTags('vote')
@Controller('votes')
export class MyVotesController {
  constructor(private readonly votes: VoteService) {}

  @Get('pending')
  @RequirePermissions('VOTE_READ')
  @ApiOperation({ summary: '待我表态 / 待我填结论的流程' })
  pending(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: { page: number; pageSize: number },
  ) {
    return this.votes.listMyPending(user, query.page, query.pageSize);
  }
}
