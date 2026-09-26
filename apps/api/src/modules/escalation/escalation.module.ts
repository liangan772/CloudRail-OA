import { Module } from '@nestjs/common';
import { NumberingModule } from '../common/numbering.module';
import { EscalationController } from './escalation.controller';
import { EscalationService } from './escalation.service';

@Module({
  imports: [NumberingModule],
  controllers: [EscalationController],
  providers: [EscalationService],
  exports: [EscalationService],
})
export class EscalationModule {}
