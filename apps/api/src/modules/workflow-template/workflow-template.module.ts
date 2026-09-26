import { Module } from '@nestjs/common';
import { WorkflowTemplateController } from './workflow-template.controller';
import { WorkflowVersionController } from './workflow-version.controller';
import { WorkflowTemplateService } from './workflow-template.service';

@Module({
  controllers: [WorkflowTemplateController, WorkflowVersionController],
  providers: [WorkflowTemplateService],
  exports: [WorkflowTemplateService],
})
export class WorkflowTemplateModule {}
