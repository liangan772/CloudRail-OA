import { Module } from '@nestjs/common';
import { InstanceController } from './instance.controller';
import { InstanceService } from './instance.service';

@Module({
  controllers: [InstanceController],
  providers: [InstanceService],
  exports: [InstanceService],
})
export class InstanceModule {}
