import { Module } from '@nestjs/common';
import { VoteModule } from '../vote/vote.module';
import { RuleController } from './rule.controller';
import { RuleEngineModule } from './rule-engine.module';

@Module({
  imports: [RuleEngineModule, VoteModule],
  controllers: [RuleController],
})
export class RuleModule {}
