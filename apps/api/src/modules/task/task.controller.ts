import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { TaskService } from './task.service';
import {
  assignTaskSchema,
  checklistItemSchema,
  taskCommentSchema,
  taskListQuerySchema,
  taskReasonSchema,
  transferTaskSchema,
  type AssignTaskBody,
  type ChecklistItemBody,
  type TaskCommentBody,
  type TaskListQuery,
  type TaskReasonBody,
  type TransferTaskBody,
} from './task.dto';

@ApiTags('task')
@Controller('tasks')
export class TaskController {
  constructor(private readonly tasks: TaskService) {}

  @Get()
  @RequirePermissions('TASK_READ')
  @ApiOperation({ summary: '任务列表（我是参与人 / 数据范围内）' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(taskListQuerySchema)) query: TaskListQuery,
  ) {
    return this.tasks.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('TASK_READ')
  @ApiOperation({ summary: '任务详情（参与人、检查项、依赖、日志）' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.detail(user, id);
  }

  @Post(':id/assign')
  @RequirePermissions('TASK_ASSIGN')
  @ApiOperation({ summary: '分配 / 改派（抢单模式的抢单入口）' })
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(assignTaskSchema)) body: AssignTaskBody,
  ) {
    return this.tasks.assign(user, id, body);
  }

  @Post(':id/accept')
  @RequirePermissions('TASK_ACCEPT')
  @ApiOperation({ summary: '负责人接单' })
  accept(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.accept(user, id);
  }

  @Post(':id/reject-assign')
  @RequirePermissions('TASK_ACCEPT')
  @ApiOperation({ summary: '负责人拒绝接单（回到待分配）' })
  rejectAssign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(taskReasonSchema)) body: TaskReasonBody,
  ) {
    return this.tasks.rejectAssign(user, id, body.reason);
  }

  @Post(':id/transfer')
  @RequirePermissions('TASK_TRANSFER')
  @ApiOperation({ summary: '转派给他人' })
  transfer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(transferTaskSchema)) body: TransferTaskBody,
  ) {
    return this.tasks.transfer(user, id, body);
  }

  @Post(':id/submit')
  @RequirePermissions('TASK_SUBMIT')
  @ApiOperation({ summary: '提交验收（检查项需全部完成）' })
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(taskCommentSchema)) body: TaskCommentBody,
  ) {
    return this.tasks.submit(user, id, body.comment);
  }

  @Post(':id/checklist/:itemId')
  @RequirePermissions('TASK_SUBMIT')
  @ApiOperation({ summary: '勾选 / 取消勾选检查项（负责人）' })
  checklist(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body(new ZodValidationPipe(checklistItemSchema)) body: ChecklistItemBody,
  ) {
    return this.tasks.toggleChecklist(user, id, itemId, body.done);
  }

  @Post(':id/acceptance-pass')
  @RequirePermissions('TASK_ACCEPTANCE')
  @ApiOperation({ summary: '验收通过（本层任务全部完成后自动推动下一层）' })
  acceptancePass(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(taskCommentSchema)) body: TaskCommentBody,
  ) {
    return this.tasks.acceptancePass(user, id, body.comment);
  }

  @Post(':id/acceptance-reject')
  @RequirePermissions('TASK_ACCEPTANCE')
  @ApiOperation({ summary: '验收打回（回到进行中）' })
  acceptanceReject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(taskReasonSchema)) body: TaskReasonBody,
  ) {
    return this.tasks.acceptanceReject(user, id, body.reason);
  }

  @Post(':id/block')
  @RequirePermissions('TASK_ASSIGN')
  @ApiOperation({ summary: '标记阻塞' })
  block(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(taskReasonSchema)) body: TaskReasonBody,
  ) {
    return this.tasks.block(user, id, body.reason);
  }

  @Post(':id/unblock')
  @RequirePermissions('TASK_ASSIGN')
  @ApiOperation({ summary: '解除阻塞' })
  unblock(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    return this.tasks.unblock(user, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('TASK_ASSIGN')
  @ApiOperation({ summary: '取消任务（级联取消子任务）' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(taskReasonSchema)) body: TaskReasonBody,
  ) {
    return this.tasks.cancel(user, id, body.reason);
  }

  @Post(':id/reopen')
  @RequirePermissions('TASK_REOPEN')
  @ApiOperation({ summary: '重开已完成的任务' })
  reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(taskReasonSchema)) body: TaskReasonBody,
  ) {
    return this.tasks.reopen(user, id, body.reason);
  }
}
