import { Module } from '@nestjs/common';
import { TaskModule } from '../task/task.module';
import { TimeoutService } from '../timeout/timeout.service';
import { EscalationModule } from '../escalation/escalation.module';
import { AuthModule } from '../auth/auth.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [TaskModule, EscalationModule, AuthModule],
  controllers: [JobsController],
  providers: [JobsService, TimeoutService],
  exports: [JobsService, TimeoutService],
})
export class JobsModule {}
