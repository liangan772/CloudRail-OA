import { Module } from '@nestjs/common';
import { InstanceController } from './instance.controller';
import { InstanceAdvanceService } from './instance-advance.service';
import { InstanceService } from './instance.service';
import { VoterDirectoryService } from './voter-directory.service';

@Module({
  controllers: [InstanceController],
  providers: [InstanceService, VoterDirectoryService, InstanceAdvanceService],
  exports: [InstanceService, VoterDirectoryService, InstanceAdvanceService],
})
export class InstanceModule {}
