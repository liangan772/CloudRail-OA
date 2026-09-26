import { Module } from '@nestjs/common';
import { NumberingModule } from '../common/numbering.module';
import { InstanceController } from './instance.controller';
import { InstanceAdvanceService } from './instance-advance.service';
import { InstanceService } from './instance.service';
import { VoterDirectoryService } from './voter-directory.service';

@Module({
  imports: [NumberingModule],
  controllers: [InstanceController],
  providers: [InstanceService, VoterDirectoryService, InstanceAdvanceService],
  exports: [InstanceService, VoterDirectoryService, InstanceAdvanceService],
})
export class InstanceModule {}
