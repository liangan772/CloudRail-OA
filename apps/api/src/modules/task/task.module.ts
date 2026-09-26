import { Module } from '@nestjs/common';
import { InstanceModule } from '../instance/instance.module';
import { NumberingModule } from '../common/numbering.module';
import { NodeContextModule } from '../vote/node-context.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

@Module({
  imports: [NumberingModule, InstanceModule, NodeContextModule],
  controllers: [TaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
