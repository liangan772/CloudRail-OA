import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { WorkflowTemplateService } from './workflow-template.service';
import { saveGraphSchema, type SaveGraphInput } from './workflow-graph.dto';

// 设计器的版本编辑接口：读整图 / 在线校验 / 保存整图。
// 发布仍走 /workflow/templates/:id/publish（发布门槛与校验在那边统一）。
@ApiTags('workflow')
@Controller('workflow/versions')
export class WorkflowVersionController {
  constructor(private readonly templates: WorkflowTemplateService) {}

  @Get(':id/graph')
  @RequirePermissions('WF_DESIGN')
  @ApiOperation({ summary: '读取某个版本的整图（含草稿）' })
  graph(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.templates.getGraph(user, id);
  }

  @Post(':id/validate')
  @RequirePermissions('WF_DESIGN')
  @ApiOperation({ summary: '在线校验整图（不落库，返回全部问题）' })
  validate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(saveGraphSchema)) body: SaveGraphInput,
  ) {
    void id;
    void user;
    return this.templates.validateGraphPayload(body);
  }

  @Put(':id/graph')
  @RequirePermissions('WF_DESIGN')
  @ApiOperation({ summary: '保存整图（先校验，再一次事务整图替换；已发布版本拒绝）' })
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(saveGraphSchema)) body: SaveGraphInput,
  ) {
    return this.templates.saveGraph(user, id, body);
  }
}
