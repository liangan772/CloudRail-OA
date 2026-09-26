import { Module } from '@nestjs/common';
import { NodeContextModule } from '../vote/node-context.module';
import { RuleController } from './rule.controller';
import { RuleEngineModule } from './rule-engine.module';

@Module({
  imports: [RuleEngineModule, NodeContextModule],
  controllers: [RuleController],
})
export class RuleModule {}
