import { Module } from '@nestjs/common';
import { InstanceModule } from '../instance/instance.module';
import { RuleEngineModule } from '../rule/rule-engine.module';
import { ConclusionService } from './conclusion.service';
import { NodeContextModule } from './node-context.module';
import { VoteController } from './vote.controller';
import { VoteService } from './vote.service';
import { EscalationModule } from '../escalation/escalation.module';

@Module({
  imports: [InstanceModule, RuleEngineModule, NodeContextModule, EscalationModule],
  controllers: [VoteController],
  providers: [VoteService, ConclusionService],
  exports: [VoteService, ConclusionService],
})
export class VoteModule {}
