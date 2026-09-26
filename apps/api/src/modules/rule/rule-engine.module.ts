import { Module } from '@nestjs/common';
import { RuleEngineService } from './rule-engine.service';

/**
 * 只提供规则引擎本身，不依赖任何业务模块 —— 这样 VoteModule 可以安全地引用它，
 * 而 RuleModule（带 Controller、要读实例上下文）再引用 VoteModule，不会形成环。
 */
@Module({
  providers: [RuleEngineService],
  exports: [RuleEngineService],
})
export class RuleEngineModule {}
