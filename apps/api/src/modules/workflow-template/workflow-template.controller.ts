import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { WorkflowTemplateService } from './workflow-template.service';
import {
  publishVersionSchema,
  templateQuerySchema,
  type PublishVersionInput,
  type TemplateQuery,
} from './workflow-template.dto';
import { createVersionSchema as createVersionBodySchema, type CreateVersionInput as CreateVersionBody } from './workflow-graph.dto';

@ApiTags('workflow')
@Controller('workflow/templates')
export class WorkflowTemplateController {
  constructor(private readonly templates: WorkflowTemplateService) {}

  @Get()
  @ApiOperation({ summary: '模板列表（非设计者只看已发布）' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(templateQuerySchema)) query: TemplateQuery,
  ) {
    return this.templates.listTemplates(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '模板详情（全部版本 + 节点/边/投票规则）' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.templates.getTemplate(user, id);
  }

  @Post(':id/publish')
  @RequirePermissions('WF_PUBLISH')
  @ApiOperation({ summary: '发布模板版本（节点图校验 + 投票规则完备性校验）' })
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(publishVersionSchema)) body: PublishVersionInput,
  ) {
    return this.templates.publishVersion(user, id, body);
  }

  @Post(':id/versions')
  @RequirePermissions('WF_DESIGN')
  @ApiOperation({ summary: '从既有版本克隆出新草稿版本（设计器起点）' })
  createVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(createVersionBodySchema)) body: CreateVersionBody,
  ) {
    return this.templates.createVersion(user, id, body);
  }
}
