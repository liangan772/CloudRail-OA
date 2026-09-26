import { Module } from '@nestjs/common';
import { InstanceModule } from '../instance/instance.module';
import { ConclusionService } from './conclusion.service';
import { NodeContextService } from './node-context.service';
import { VoteController } from './vote.controller';
import { VoteService } from './vote.service';

@Module({
  imports: [InstanceModule],
  controllers: [VoteController],
  providers: [VoteService, ConclusionService, NodeContextService],
  exports: [VoteService, ConclusionService, NodeContextService],
})
export class VoteModule {}
