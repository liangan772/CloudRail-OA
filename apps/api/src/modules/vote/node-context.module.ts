import { Module } from '@nestjs/common';
import { NodeContextService } from './node-context.service';

/**
 * 节点上下文独立成模块：投票、结论、上报三处都要用，
 * 放在 VoteModule 里会让 EscalationModule 反向依赖它，形成环。
 */
@Module({
  providers: [NodeContextService],
  exports: [NodeContextService],
})
export class NodeContextModule {}
