import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  WS_EVENTS,
  WS_ROOMS,
  type AssigneeRuleType,
  type TaskStatus,
} from '@oa/shared';
import { DomainEventService } from '../../infra/events/domain-event.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import {
  resolveAssignees,
  type AssigneeDirectory,
  type AssigneeRuleSpec,
} from '../../domain/task/assignment';
import {
  transitionTask,
  type TaskActionType,
  type TaskEvent,
  type TaskTransitionContext,
} from '../../domain/task/state-machine';
import { transitionNode } from '../../domain/workflow/state-machines';
import { NumberingService } from '../common/numbering.service';
import { InstanceAdvanceService } from '../instance/instance-advance.service';
import { NodeContextService, type Tx } from '../vote/node-context.service';

export interface CreateTasksParams {
  tenantId: number;
  instanceId: number;
  instanceNodeId: number;
  /** 触发创建的配置节点（WorkflowNode.id） */
  workflowNodeId: number;
  creatorId: number;
  initiatorId: number;
}

export interface CreateTasksResult {
  taskIds: number[];
  /** 解析失败被跳过的模板（不阻断流程，但必须可见） */
  skipped: { title: string; reason: string }[];
  openTasks: number;
}

@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly advance: InstanceAdvanceService,
    private readonly contexts: NodeContextService,
    private readonly events: DomainEventService,
  ) {}

  /**
   * 按 `NodeTaskTemplate` 建任务（E1/E2）。
   *
   * 只建"挂在本层节点上"的任务：解析不出唯一负责人/验收人的模板会被跳过并记录原因，
   * 而不是让整层结论失败 —— 一条配错的模板不该把审批卡死。
   */
  async createFromNodeTemplates(tx: Tx, params: CreateTasksParams): Promise<CreateTasksResult> {
    const templates = await tx.nodeTaskTemplate.findMany({
      where: { tenantId: params.tenantId, nodeId: params.workflowNodeId },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        title: true,
        priority: true,
        dueOffset: true,
        checklist: true,
        assigneeRule: true,
        acceptanceRule: true,
        triggerOn: true,
        dependsOn: true,
      },
    });
    const passTemplates = templates.filter((template) => template.triggerOn === 'PASS');
    if (passTemplates.length === 0) return { taskIds: [], skipped: [], openTasks: 0 };

    const directory = await this.loadAssigneeDirectory(tx, params.tenantId, params.initiatorId);
    const taskIds: number[] = [];
    const skipped: { title: string; reason: string }[] = [];
    const now = new Date();
    // 依赖声明的解析依据：位置（0 起）与标题
    const taskIdByIndex = new Map<number, number>();
    const taskIdByTitle = new Map<string, number>();
    const declaredDeps: { taskIndex: number; refs: (number | string)[] }[] = [];

    for (const [templateIndex, template] of passTemplates.entries()) {
      const refs = Array.isArray(template.dependsOn) ? (template.dependsOn as (number | string)[]) : [];
      const ownerRule = (template.assigneeRule ?? {}) as unknown as AssigneeRuleSpec;
      const acceptance = (template.acceptanceRule ?? {}) as { acceptorRule?: AssigneeRuleSpec };
      // 模板没配验收人规则时的默认：由流程发起人验收（E2 只要求"恰好一个"，没说必须另有其人）
      const acceptorRule: AssigneeRuleSpec =
        acceptance.acceptorRule ?? { type: 'MANUAL' as AssigneeRuleType, value: { userIds: [params.initiatorId] } };

      const assignment = resolveAssignees(
        { type: ownerRule.type ?? 'MANUAL', value: ownerRule.value ?? {} },
        { type: acceptorRule.type ?? 'MANUAL', value: acceptorRule.value ?? {} },
        directory,
      );
      if (!assignment.ok) {
        skipped.push({ title: template.title, reason: assignment.reason });
        continue;
      }

      const code = await this.numbering.next(tx, params.tenantId, 'TASK');
      const dueOffset = template.dueOffset ?? 24;
      const created = await tx.task.create({
        data: {
          tenantId: params.tenantId,
          code,
          instanceId: params.instanceId,
          instanceNodeId: params.instanceNodeId,
          title: template.title,
          priority: template.priority,
          creatorId: params.creatorId,
          dueAt: new Date(now.getTime() + dueOffset * 3600_000),
          // 先落在待分配，再走状态机分配（状态变更只有一个写入者）
          status: 'PENDING_ASSIGN',
        },
        select: { id: true },
      });

      const assigned = transitionTask(
        {
          status: 'PENDING_ASSIGN',
          canAssign: true,
          hasOwner: assignment.ownerId != null,
          hasAcceptor: assignment.acceptorId != null,
          // 声明了依赖就先落阻塞（E3）：等前置任务验收通过后由 autoUnblockDependents 解锁
          hasUnfinishedDependency: refs.length > 0,
        },
        assignment.mode === 'GRAB' ? 'BLOCK' : 'ASSIGN',
      );
      // GRAB 模式：不预指定负责人，任务留在待分配等抢单（验收人先落库）
      const status: TaskStatus = assigned.ok ? (assigned.status as TaskStatus) : 'PENDING_ASSIGN';

      await tx.task.update({
        where: { id: created.id },
        data: {
          status,
          assignees: {
            create: [
              ...(assignment.ownerId != null
                ? [{ tenantId: params.tenantId, userId: assignment.ownerId, role: 'OWNER' as const, assignedBy: params.creatorId }]
                : []),
              ...(assignment.acceptorId != null
                ? [{ tenantId: params.tenantId, userId: assignment.acceptorId, role: 'ACCEPTOR' as const, assignedBy: params.creatorId }]
                : []),
            ],
          },
          checklists: {
            create: (Array.isArray(template.checklist) ? (template.checklist as unknown[]) : []).map((item, index) => ({
              content: String(item).slice(0, 200),
              order: index,
            })),
          },
          logs: {
            create: {
              tenantId: params.tenantId,
              actorId: params.creatorId,
              action: assignment.mode === 'GRAB' ? 'CREATE_GRAB' : 'ASSIGN',
              fromStatus: 'PENDING_ASSIGN',
              toStatus: status,
              payload: {
                owner: assignment.ownerId,
                acceptor: assignment.acceptorId,
                ownerReason: assignment.ownerReason,
                acceptorReason: assignment.acceptorReason,
                candidates: assignment.candidates,
              } as Prisma.InputJsonValue,
            },
          },
        },
      });

      taskIds.push(created.id);
      taskIdByIndex.set(templateIndex, created.id);
      taskIdByTitle.set(template.title, created.id);
      if (refs.length > 0) declaredDeps.push({ taskIndex: templateIndex, refs });

      await this.events.emit(tx, {
        tenantId: params.tenantId,
        eventType: WS_EVENTS.TASK_CREATED,
        aggregateType: 'TASK',
        aggregateId: created.id,
        payload: { code, title: template.title, ownerId: assignment.ownerId, acceptorId: assignment.acceptorId, instanceId: params.instanceId },
        rooms: [WS_ROOMS.instance(params.instanceId)],
        notifications: [
          ...(assignment.ownerId != null
            ? [
                {
                  userId: assignment.ownerId,
                  type: 'TASK_ASSIGNED' as const,
                  title: `待你处理：${template.title}`,
                  content: `来源：${assignment.ownerReason}`,
                  link: `/tasks/${created.id}`,
                },
              ]
            : []),
          ...(assignment.acceptorId != null
            ? [
                {
                  userId: assignment.acceptorId,
                  type: 'TASK_ASSIGNED' as const,
                  title: `待你验收：${template.title}`,
                  content: `来源：${assignment.acceptorReason}`,
                  link: `/tasks/${created.id}`,
                },
              ]
            : []),
        ],
        audit: {
          actorId: params.creatorId,
          action: 'TASK_CREATE',
          targetType: 'Task',
          targetId: created.id,
          after: { code, title: template.title, mode: assignment.mode, owner: assignment.ownerId },
        },
      });
    }

    // 依赖落库：数字按"本层排序后的位置"解析，字符串按标题解析
    for (const declaration of declaredDeps) {
      const taskId = taskIdByIndex.get(declaration.taskIndex);
      if (!taskId) continue;
      for (const ref of declaration.refs) {
        const dependsOnTaskId = typeof ref === 'number' ? taskIdByIndex.get(ref) : taskIdByTitle.get(String(ref));
        if (!dependsOnTaskId || dependsOnTaskId === taskId) continue;
        await tx.taskDependency.create({
          data: { taskId, dependsOnTaskId, type: 'FINISH_TO_START' },
        });
      }
    }

    return { taskIds, skipped, openTasks: taskIds.length };
  }

  /* ------------------------------- 生命周期 ------------------------------- */

  /** 分配 / 改派（GRAB 抢单也走这里：谁抢到谁就是负责人） */
  async assign(user: AuthenticatedUser, taskId: number, input: { ownerId: number; acceptorId?: number }) {
    return this.prisma.runInTransaction(async (tx) => {
      const task = await this.loadTask(tx, user.tenantId, taskId);
      const assignees = task.assignees;
      const acceptorId = input.acceptorId ?? assignees.find((a) => a.role === 'ACCEPTOR')?.userId;
      if (!acceptorId) throw AppError.of('TASK_ACCEPTOR_REQUIRED', '任务必须指定唯一验收人');

      const transition = transitionTask(
        {
          status: task.status as TaskStatus,
          canAssign: user.permissions.includes('TASK_ASSIGN'),
          hasOwner: true,
          hasAcceptor: true,
          hasUnfinishedDependency: await this.hasUnfinishedDependency(tx, task.id),
        },
        'ASSIGN',
      );
      if (!transition.ok) throw AppError.fromDef(transition.error, transition.reason);

      await tx.taskAssignee.deleteMany({ where: { taskId: task.id, role: 'OWNER' } });
      await tx.taskAssignee.createMany({
        data: [
          { tenantId: user.tenantId, taskId: task.id, userId: input.ownerId, role: 'OWNER', assignedBy: user.userId },
          ...(input.acceptorId
            ? [{ tenantId: user.tenantId, taskId: task.id, userId: acceptorId, role: 'ACCEPTOR' as const, assignedBy: user.userId }]
            : []),
        ],
      });
      await this.applyTransition(tx, user, task.id, task.status as TaskStatus, transition.status as TaskStatus, transition.actions, {
        blockedReason: transition.status === 'BLOCKED' ? '存在未完成的前置任务' : null,
      });

      return { taskId: task.id, status: transition.status, ownerId: input.ownerId, acceptorId, reason: transition.reason };
    });
  }

  async accept(user: AuthenticatedUser, taskId: number) {
    return this.mutate(user, taskId, 'ACCEPT', (task) => ({ isOwner: this.isAssignee(task, user.userId, 'OWNER') }), {
      startedAt: new Date(),
    });
  }

  async rejectAssign(user: AuthenticatedUser, taskId: number, reason: string) {
    return this.mutate(user, taskId, 'REJECT_ASSIGN', (task) => ({ isOwner: this.isAssignee(task, user.userId, 'OWNER') }), {
      blockedReason: null,
    }, reason);
  }

  async transfer(user: AuthenticatedUser, taskId: number, input: { ownerId: number; reason: string }) {
    return this.mutate(
      user,
      taskId,
      'TRANSFER',
      (task) => ({
        isOwner: this.isAssignee(task, user.userId, 'OWNER'),
        canTransfer: user.permissions.includes('TASK_TRANSFER'),
        hasOwner: input.ownerId != null,
      }),
      {},
      input.reason,
      async (tx, task) => {
        await tx.taskAssignee.updateMany({ where: { taskId: task.id, role: 'OWNER', isActive: true }, data: { isActive: false } });
        await tx.taskAssignee.create({
          data: { tenantId: user.tenantId, taskId: task.id, userId: input.ownerId, role: 'OWNER', assignedBy: user.userId },
        });
      },
    );
  }

  async submit(user: AuthenticatedUser, taskId: number, comment?: string) {
    return this.mutate(
      user,
      taskId,
      'SUBMIT',
      (task) => ({
        isOwner: this.isAssignee(task, user.userId, 'OWNER'),
        requireChecklist: task.checklists.length > 0,
        checklistComplete: task.checklists.every((item) => item.done),
      }),
      {},
      comment,
    );
  }

  /** 验收通过：任务完成；本层任务**全部完成**时推动流程进入下一层（C1/C3） */
  async acceptancePass(user: AuthenticatedUser, taskId: number, comment?: string) {
    return this.prisma.runInTransaction(async (tx) => {
      const task = await this.loadTask(tx, user.tenantId, taskId);
      const transition = transitionTask(
        {
          status: task.status as TaskStatus,
          isAcceptor: this.isAssignee(task, user.userId, 'ACCEPTOR'),
        },
        'ACCEPTANCE_PASS',
      );
      if (!transition.ok) throw AppError.fromDef(transition.error, transition.reason);

      await this.applyTransition(tx, user, task.id, task.status as TaskStatus, transition.status as TaskStatus, transition.actions, {
        completedAt: new Date(),
        progress: 100,
      }, comment);

      const advanced = await this.maybeAdvanceInstance(tx, user, task);
      // E3：依赖已完成 → 自动解锁下游任务
      const unlocked = await this.autoUnblockDependents(tx, user, task.id);
      await this.events.emit(tx, {
        tenantId: user.tenantId,
        eventType: WS_EVENTS.TASK_UPDATED,
        aggregateType: 'TASK',
        aggregateId: task.id,
        payload: { status: transition.status, instanceId: task.instanceId },
        rooms: [WS_ROOMS.instance(task.instanceId ?? 0)],
        notifications: advanced.advanced
          ? [
              {
                userId: task.assignees[0]?.userId ?? user.userId,
                type: 'TASK_ASSIGNED' as const,
                title: `本层任务已全部完成`,
                content: '流程将自动进入下一层',
                link: `/instances/${task.instanceId}`,
              },
            ]
          : [],
        audit: {
          actorId: user.userId,
          action: 'TASK_ACCEPTANCE_PASS',
          targetType: 'Task',
          targetId: task.id,
          after: { status: transition.status, advanced: advanced.advanced },
        },
      });
      return {
        taskId: task.id,
        status: transition.status,
        ...advanced,
        unlockedTasks: unlocked,
        reason: transition.reason,
      };
    });
  }

  async acceptanceReject(user: AuthenticatedUser, taskId: number, reason: string) {
    return this.mutate(
      user,
      taskId,
      'ACCEPTANCE_REJECT',
      (task) => ({ isAcceptor: this.isAssignee(task, user.userId, 'ACCEPTOR') }),
      { completedAt: null },
      reason,
    );
  }

  async block(user: AuthenticatedUser, taskId: number, reason: string) {
    return this.mutate(user, taskId, 'BLOCK', () => ({}), { blockedReason: reason }, reason);
  }

  async unblock(user: AuthenticatedUser, taskId: number) {
    return this.mutate(
      user,
      taskId,
      'UNBLOCK',
      () => ({}),
      { blockedReason: null },
      undefined,
      async (tx, task, transition) => {
        void transition;
        // 解锁时把下游任务一并解锁（依赖已完成）
        await tx.task.updateMany({
          where: { parentTaskId: task.id, status: 'BLOCKED' },
          data: { status: 'IN_PROGRESS' },
        });
      },
    );
  }

  async cancel(user: AuthenticatedUser, taskId: number, reason: string) {
    return this.mutate(
      user,
      taskId,
      'CANCEL',
      () => ({}),
      {},
      reason,
      async (tx, task) => {
        await tx.task.updateMany({ where: { parentTaskId: task.id }, data: { status: 'CANCELLED' } });
      },
    );
  }

  async reopen(user: AuthenticatedUser, taskId: number, reason: string) {
    return this.mutate(
      user,
      taskId,
      'REOPEN',
      () => ({ canReopen: user.permissions.includes('TASK_REOPEN') }),
      { completedAt: null, progress: 50 },
      reason,
    );
  }

  /** 逾期扫描：只打标记与防重复通知字段，不改状态（E4）。返回被标记的任务 id。 */
  /** 勾选/取消勾选检查项（只有负责人在进行中可操作；进度按完成比例回写） */
  async toggleChecklist(user: AuthenticatedUser, taskId: number, itemId: number, done: boolean) {
    return this.prisma.runInTransaction(async (tx) => {
      const task = await this.loadTask(tx, user.tenantId, taskId);
      if (!this.isAssignee(task, user.userId, 'OWNER')) {
        throw AppError.of('TASK_NOT_ASSIGNEE', '只有负责人可以更新检查项');
      }
      if (task.status !== 'IN_PROGRESS' && task.status !== 'OVERDUE') {
        throw AppError.of('TASK_INVALID_TRANSITION', '只有进行中的任务可以更新检查项');
      }

      const item = await tx.taskChecklist.findFirst({ where: { id: itemId, taskId: task.id } });
      if (!item) throw AppError.of('SYS_NOT_FOUND', '检查项不存在');
      await tx.taskChecklist.update({ where: { id: itemId }, data: { done } });

      const total = await tx.taskChecklist.count({ where: { taskId: task.id } });
      const remaining = await tx.taskChecklist.count({ where: { taskId: task.id, done: false } });
      const progress = total === 0 ? task.progress : Math.round(((total - remaining) / total) * 100);
      await tx.task.update({ where: { id: task.id }, data: { progress } });

      await tx.taskLog.create({
        data: {
          tenantId: user.tenantId,
          taskId: task.id,
          actorId: user.userId,
          action: done ? 'CHECKLIST_DONE' : 'CHECKLIST_UNDONE',
          fromStatus: task.status as never,
          toStatus: task.status as never,
          payload: { itemId, content: item.content } as Prisma.InputJsonValue,
        },
      });

      return { taskId: task.id, itemId, done, remaining, progress };
    });
  }

  async markOverdue(tenantId: number): Promise<number[]> {
    const overdue = await this.prisma.task.findMany({
      where: {
        tenantId,
        dueAt: { lt: new Date() },
        overdueNotifiedAt: null,
        status: { in: ['PENDING_ACCEPT', 'IN_PROGRESS', 'PENDING_ACCEPTANCE'] },
      },
      select: { id: true, status: true },
    });

    for (const task of overdue) {
      const transition = transitionTask({ status: task.status as TaskStatus }, 'OVERDUE');
      if (!transition.ok) continue;
      await this.prisma.task.update({
        where: { id: task.id },
        data: { overdueNotifiedAt: new Date() },
      });
    }
    return overdue.map((task) => task.id);
  }

  /* -------------------------------- 查询 -------------------------------- */

  async list(user: AuthenticatedUser, query: { scope: 'mine' | 'all'; status?: string; instanceId?: number; page: number; pageSize: number }) {
    const where: Prisma.TaskWhereInput = {
      tenantId: user.tenantId,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.instanceId ? { instanceId: query.instanceId } : {}),
      ...(query.scope === 'mine'
        ? { assignees: { some: { userId: user.userId, isActive: true } } }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        orderBy: [{ status: 'asc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          code: true,
          title: true,
          status: true,
          priority: true,
          dueAt: true,
          completedAt: true,
          instanceId: true,
          instanceNodeId: true,
          assignees: { where: { isActive: true }, select: { userId: true, role: true, user: { select: { name: true } } } },
          _count: { select: { checklists: true } },
        },
      }),
      this.prisma.task.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        code: row.code,
        title: row.title,
        status: row.status,
        priority: row.priority,
        dueAt: row.dueAt,
        completedAt: row.completedAt,
        instanceId: row.instanceId,
        instanceNodeId: row.instanceNodeId,
        owner: row.assignees.find((item) => item.role === 'OWNER')?.user.name ?? null,
        acceptor: row.assignees.find((item) => item.role === 'ACCEPTOR')?.user.name ?? null,
        checklistCount: row._count.checklists,
        overdue: row.dueAt != null && row.completedAt == null && row.dueAt.getTime() < Date.now(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(user: AuthenticatedUser, taskId: number) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, tenantId: user.tenantId },
      include: {
        assignees: { select: { userId: true, role: true, isActive: true, weight: true, user: { select: { name: true } } } },
        checklists: { orderBy: { order: 'asc' } },
        dependencies: { select: { dependsOnTaskId: true, type: true } },
        logs: { orderBy: { createdAt: 'asc' }, select: { action: true, fromStatus: true, toStatus: true, createdAt: true, actorId: true } },
        subTasks: { select: { id: true, code: true, title: true, status: true } },
      },
    });
    if (!task) throw AppError.of('SYS_NOT_FOUND');

    const allowed = await this.canView(user, task);
    if (!allowed) throw AppError.of('PERM_OUT_OF_SCOPE', '不在你的数据范围内，视为不存在');

    return {
      ...task,
      overdue: task.dueAt != null && task.completedAt == null && task.dueAt.getTime() < Date.now(),
      checklistProgress: {
        total: task.checklists.length,
        done: task.checklists.filter((item) => item.done).length,
      },
    };
  }

  /* -------------------------------- 内部 -------------------------------- */

  /** 统一的状态迁移执行器：过守卫 → 改状态 → 写日志（状态变更只有一个写入者） */
  private async mutate(
    user: AuthenticatedUser,
    taskId: number,
    event: TaskEvent,
    buildContext: (task: Awaited<ReturnType<TaskService['loadTask']>>) => Partial<TaskTransitionContext>,
    patch: Prisma.TaskUpdateInput,
    comment?: string,
    after?: (
      tx: Tx,
      task: Awaited<ReturnType<TaskService['loadTask']>>,
      transition: { status: string; actions: TaskActionType[] },
    ) => Promise<void>,
  ) {
    return this.prisma.runInTransaction(async (tx) => {
      const task = await this.loadTask(tx, user.tenantId, taskId);
      const transition = transitionTask(
        { status: task.status as TaskStatus, ...buildContext(task) },
        event,
      );
      if (!transition.ok) throw AppError.fromDef(transition.error, transition.reason);

      await this.applyTransition(tx, user, task.id, task.status as TaskStatus, transition.status as TaskStatus, transition.actions, patch, comment);
      if (after) await after(tx, task, transition);

      // 任务的所有生命周期动作都走同一条出口：审计 + 发件箱（WS 广播由派发器完成）
      await this.events.emit(tx, {
        tenantId: user.tenantId,
        eventType: WS_EVENTS.TASK_UPDATED,
        aggregateType: 'TASK',
        aggregateId: task.id,
        payload: { event, status: transition.status, instanceId: task.instanceId, comment },
        rooms: [WS_ROOMS.instance(task.instanceId ?? 0)],
        notifications: this.notificationsFor(event, task, user),
        audit: {
          actorId: user.userId,
          action: `TASK_${event}`,
          targetType: 'Task',
          targetId: task.id,
          before: { status: task.status },
          after: { status: transition.status, comment },
        },
      });

      return { taskId: task.id, status: transition.status, appliedEvents: [event], reason: transition.reason };
    });
  }

  /** 哪些任务动作需要主动通知谁（其余动作只广播，不打扰人） */
  private notificationsFor(
    event: TaskEvent,
    task: { id: number; assignees: { userId: number; role: string; isActive: boolean }[] },
    actor: AuthenticatedUser,
  ): { userId: number; type: 'TASK_ASSIGNED' | 'TASK_OVERDUE'; title: string; link: string }[] {
    const owner = task.assignees.find((item) => item.role === 'OWNER' && item.isActive)?.userId;
    const acceptor = task.assignees.find((item) => item.role === 'ACCEPTOR' && item.isActive)?.userId;
    const target =
      event === 'ASSIGN' || event === 'TRANSFER'
        ? owner
        : event === 'SUBMIT'
          ? acceptor
          : event === 'ACCEPTANCE_REJECT'
            ? owner
            : null;
    if (target == null || target === actor.userId) return [];

    const titles: Partial<Record<TaskEvent, string>> = {
      ASSIGN: '有新任务分配给你',
      TRANSFER: '有任务转派给你',
      SUBMIT: '有任务待你验收',
      ACCEPTANCE_REJECT: '任务验收未通过，已打回',
    };
    return [{ userId: target, type: 'TASK_ASSIGNED', title: titles[event] ?? '任务有更新', link: `/tasks/${task.id}` }];
  }

  private async applyTransition(
    tx: Tx,
    user: AuthenticatedUser,
    taskId: number,
    fromStatus: TaskStatus,
    toStatus: TaskStatus,
    actions: TaskActionType[],
    patch: Prisma.TaskUpdateInput,
    comment?: string,
  ): Promise<void> {
    await tx.task.update({ where: { id: taskId }, data: { ...patch, status: toStatus } });
    await tx.taskLog.create({
      data: {
        tenantId: user.tenantId,
        taskId,
        actorId: user.userId,
        action: actions.join(','),
        fromStatus,
        toStatus,
        payload: (comment ? { comment } : {}) as Prisma.InputJsonValue,
      },
    });
  }

  private async loadTask(tx: Tx, tenantId: number, taskId: number) {
    const task = await tx.task.findFirst({
      where: { id: taskId, tenantId },
      include: {
        assignees: { where: { isActive: true }, select: { userId: true, role: true, isActive: true } },
        checklists: { select: { id: true, done: true } },
      },
    });
    if (!task) throw AppError.of('SYS_NOT_FOUND');
    return task;
  }

  private isAssignee(
    task: { assignees: { userId: number; role: string; isActive: boolean }[] },
    userId: number,
    role: 'OWNER' | 'ACCEPTOR',
  ): boolean {
    return task.assignees.some((item) => item.userId === userId && item.role === role && item.isActive);
  }

  private async hasUnfinishedDependency(tx: Tx, taskId: number): Promise<boolean> {
    const pending = await tx.taskDependency.count({
      where: { taskId, dependsOnTask: { status: { notIn: ['DONE', 'CANCELLED'] } } },
    });
    return pending > 0;
  }

  /**
   * 前置任务完成后自动解锁下游（E3）。
   *
   * 只解锁"所有前置都已完成"的那些 BLOCKED 任务，并回到 PENDING_ACCEPT（任务已分配、等待接单）——
   * 状态变更同样走状态机（UNBLOCK 的 `blockedFrom` 传 PENDING_ACCEPT），不直接写状态。
   */
  private async autoUnblockDependents(tx: Tx, user: AuthenticatedUser, completedTaskId: number): Promise<number[]> {
    const dependents = await tx.taskDependency.findMany({
      where: { dependsOnTaskId: completedTaskId },
      select: { taskId: true },
    });
    if (dependents.length === 0) return [];

    const unlocked: number[] = [];
    for (const dependent of dependents) {
      const task = await tx.task.findFirst({
        where: { id: dependent.taskId },
        select: { id: true, status: true, tenantId: true, instanceId: true },
      });
      if (!task || task.status !== 'BLOCKED') continue;
      if (await this.hasUnfinishedDependency(tx, task.id)) continue;

      const transition = transitionTask(
        { status: 'BLOCKED', dependenciesDone: true, blockedFrom: 'PENDING_ACCEPT' },
        'UNBLOCK',
      );
      if (!transition.ok) continue;

      await this.applyTransition(
        tx,
        { ...user, tenantId: task.tenantId },
        task.id,
        'BLOCKED',
        transition.status as TaskStatus,
        transition.actions,
        { blockedReason: null },
        '前置任务已完成，自动解锁',
      );
      await this.events.emit(tx, {
        tenantId: task.tenantId,
        eventType: WS_EVENTS.TASK_UPDATED,
        aggregateType: 'TASK',
        aggregateId: task.id,
        payload: { event: 'UNBLOCK', status: transition.status, instanceId: task.instanceId, automatic: true },
        rooms: [WS_ROOMS.instance(task.instanceId ?? 0)],
        audit: {
          actorId: null,
          action: 'TASK_UNBLOCK_AUTO',
          targetType: 'Task',
          targetId: task.id,
          after: { reason: '前置任务已完成' },
        },
      });
      unlocked.push(task.id);
    }
    return unlocked;
  }

  /**
   * 本层任务是否全部完成 → 是则把节点置 DONE 并推进流程（C1/C3：任务完成再推动下一层）。
   */
  private async maybeAdvanceInstance(
    tx: Tx,
    user: AuthenticatedUser,
    task: { instanceId: number | null; instanceNodeId: number | null },
  ): Promise<{ advanced: boolean; openTasks?: number; instanceStatus?: string; nextNode?: unknown; summary?: string }> {
    if (!task.instanceId || !task.instanceNodeId) return { advanced: false };

    const open = await tx.task.count({
      where: { instanceNodeId: task.instanceNodeId, status: { notIn: ['DONE', 'CANCELLED'] } },
    });
    if (open > 0) return { advanced: false, openTasks: open };

    const ctx = await this.contexts.load(tx, user.tenantId, task.instanceId);
    const complete = transitionNode({ status: ctx.node.status as never, tasksCreated: true }, 'COMPLETE');
    if (complete.ok) {
      await tx.instanceNode.update({
        where: { id: ctx.node.id },
        data: { status: complete.status, endedAt: new Date() },
      });
    }

    const advanced = await this.advance.advance(tx, ctx, user, 'PASSED');
    return {
      advanced: true,
      instanceStatus: advanced.instanceStatus,
      nextNode: advanced.nextNode,
      summary: advanced.summary,
    };
  }

  /** 任务可见性：本人是参与人 / 同实例的发起人或同层投票人 / 发起人部门在数据范围内 */
  private async canView(
    user: AuthenticatedUser,
    task: { assignees: { userId: number }[]; instanceId: number | null; creatorId: number },
  ): Promise<boolean> {
    if (task.creatorId === user.userId) return true;
    if (task.assignees.some((item) => item.userId === user.userId)) return true;
    if (task.instanceId) {
      const node = await this.prisma.instanceNode.findFirst({
        where: { instanceId: task.instanceId },
        select: { voters: { select: { userId: true } } },
      });
      if (node?.voters.some((voter) => voter.userId === user.userId)) return true;
    }
    // 兜底给数据范围：有 INSTANCE_READ 且范围覆盖发起人部门的管理者仍可查看
    return user.permissions.includes('VOTE_VIEW_ALL');
  }

  /** 分配解析所需的候选数据（含"在手任务数"用于负载均衡） */
  private async loadAssigneeDirectory(tx: Tx, tenantId: number, initiatorId: number): Promise<AssigneeDirectory> {
    const [departments, users, groups, workNoMembers, openByUser] = await Promise.all([
      tx.department.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { id: true, parentId: true, path: true } }),
      tx.user.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: {
          id: true,
          departments: { select: { departmentId: true, isLeader: true } },
          roles: { select: { role: { select: { code: true } } } },
        },
      }),
      tx.voteGroup.findMany({ where: { tenantId }, select: { code: true, members: { select: { userId: true } } } }),
      tx.departmentWorkNoMember.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { departmentId: true, userId: true, isPrimary: true },
      }),
      tx.taskAssignee.groupBy({
        by: ['userId'],
        where: { tenantId, isActive: true, task: { status: { notIn: ['DONE', 'CANCELLED'] } } },
        _count: { _all: true },
      }),
    ]);

    const openTaskCount = new Map(openByUser.map((row) => [row.userId, row._count._all]));
    const initiator = users.find((item) => item.id === initiatorId);
    const initiatorDeptId =
      (initiator?.departments.find((d) => d.isLeader) ?? initiator?.departments[0])?.departmentId ?? null;
    const parentDeptId =
      initiatorDeptId != null ? departments.find((dept) => dept.id === initiatorDeptId)?.parentId ?? null : null;

    return {
      departments,
      users: users.map((item) => ({
        userId: item.id,
        deptIds: item.departments.map((d) => d.departmentId),
        leaderDeptIds: item.departments.filter((d) => d.isLeader).map((d) => d.departmentId),
        roleCodes: item.roles.map((assignment) => assignment.role.code),
        openTaskCount: openTaskCount.get(item.id) ?? 0,
      })),
      voteGroups: groups,
      workNoMembers,
      initiatorDeptId,
      parentDeptId,
      initiatorUserId: initiatorId,
    };
  }
}
