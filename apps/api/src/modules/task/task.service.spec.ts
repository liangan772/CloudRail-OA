import { TaskService } from './task.service';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';

// 任务依赖（E3）的假仓储测试：模板声明依赖 → 落 TaskDependency + 任务进 BLOCKED；
// 前置验收通过 → 下游自动解锁回 PENDING_ACCEPT。

const actor: AuthenticatedUser = {
  tenantId: 1,
  userId: 3,
  email: 'wangqiang@cloudrail.dev',
  name: '王强',
  departments: [{ id: 3, path: '/1/2/3/' }],
  primaryDeptId: 3,
  scopeType: 'DEPT',
  roleCodes: ['DEPT_MANAGER'],
  permissions: ['TASK_ASSIGN', 'TASK_ACCEPT', 'TASK_SUBMIT', 'TASK_ACCEPTANCE'],
};

function buildFake() {
  const templates = [
    { id: 1, title: '收集三家报价', priority: 'HIGH', dueOffset: 24, checklist: ['报价单'], assigneeRule: { type: 'MANUAL', value: { userIds: [3] } }, acceptanceRule: null, triggerOn: 'PASS', dependsOn: null },
    { id: 2, title: '归档采购材料', priority: 'NORMAL', dueOffset: 48, checklist: [], assigneeRule: { type: 'MANUAL', value: { userIds: [3] } }, acceptanceRule: null, triggerOn: 'PASS', dependsOn: [0] },
  ];

  let nextTaskId = 100;
  const tasks: Array<{ id: number; status: string; instanceId: number | null; instanceNodeId: number | null; tenantId: number; title: string; assignees: { userId: number; role: string; isActive: boolean }[]; checklists: { id: number; done: boolean }[] }> = [];
  const dependencies: Array<{ taskId: number; dependsOnTaskId: number }> = [];

  const tx = {
    nodeTaskTemplate: { findMany: jest.fn(async () => templates) },
    department: { findMany: jest.fn(async () => [{ id: 3, parentId: 2, path: '/1/2/3/' }]) },
    user: {
      findMany: jest.fn(async () => [
        { id: 3, departments: [{ departmentId: 3, isLeader: true }], roles: [{ role: { code: 'TASK_EXECUTOR' } }] },
      ]),
    },
    voteGroup: { findMany: jest.fn(async () => []) },
    departmentWorkNoMember: { findMany: jest.fn(async () => []) },
    taskAssignee: { groupBy: jest.fn(async () => []), updateMany: jest.fn(), create: jest.fn() },
    numberSequence: { upsert: jest.fn(async () => ({ nextValue: nextTaskId })) },
    task: {
      create: jest.fn(async ({ data }: { data: { title: string } }) => {
        const id = nextTaskId++;
        tasks.push({ id, status: 'PENDING_ASSIGN', instanceId: 501, instanceNodeId: 900, tenantId: 1, title: data.title, assignees: [], checklists: [] });
        return { id };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const task = tasks.find((item) => item.id === where.id)!;
        if (typeof data.status === 'string') task.status = data.status;
        const nested = data as {
          assignees?: { create: { userId: number; role: string }[] };
          checklists?: { create: { content: string }[] };
        };
        if (nested.assignees?.create) {
          task.assignees.push(...nested.assignees.create.map((item) => ({ userId: item.userId, role: item.role, isActive: true })));
        }
        if (nested.checklists?.create) {
          task.checklists.push(...nested.checklists.create.map((item, index) => ({ id: index + 1, done: false })));
        }
        return task;
      }),
      findFirst: jest.fn(async ({ where }: { where: { id: number } }) => tasks.find((item) => item.id === where.id) ?? null),
      count: jest.fn(async ({ where }: { where: { status?: { notIn: string[] } } }) =>
        tasks.filter((task) => (where.status ? !where.status.notIn.includes(task.status) : true)).length,
      ),
    },
    taskDependency: {
      create: jest.fn(async ({ data }: { data: { taskId: number; dependsOnTaskId: number } }) => {
        dependencies.push({ taskId: data.taskId, dependsOnTaskId: data.dependsOnTaskId });
        return data;
      }),
      findMany: jest.fn(async ({ where }: { where: { dependsOnTaskId: number } }) =>
        dependencies.filter((item) => item.dependsOnTaskId === where.dependsOnTaskId).map((item) => ({ taskId: item.taskId })),
      ),
      count: jest.fn(async ({ where }: { where: { taskId: number } }) => {
        const pending = dependencies.filter(
          (item) => item.taskId === where.taskId && tasks.find((task) => task.id === item.dependsOnTaskId)?.status !== 'DONE',
        );
        return pending.length;
      }),
    },
    taskLog: { create: jest.fn() },
  };

  const prisma = {
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as unknown[]),
    ),
    runInTransaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    task: tx.task,
  };

  const service = new TaskService(
    prisma as never,
    { next: jest.fn(async () => `TK-202609-000${nextTaskId}`) } as never,
    { advance: jest.fn() } as never,
    { load: jest.fn() } as never,
    { emit: jest.fn(), emitStandalone: jest.fn() } as never,
  );

  return { service, tx, tasks, dependencies };
}

describe('任务依赖 · 建任务', () => {
  it('模板声明 dependsOn 时：落 TaskDependency，且新任务直接进 BLOCKED（E3）', async () => {
    const { service, tx, tasks, dependencies } = buildFake();

    const result = await service.createFromNodeTemplates(tx as never, {
      tenantId: 1,
      instanceId: 501,
      instanceNodeId: 900,
      workflowNodeId: 2,
      creatorId: 3,
      initiatorId: 3,
    });

    expect(result.taskIds).toHaveLength(2);
    const first = tasks.find((task) => task.title === '收集三家报价')!;
    const second = tasks.find((task) => task.title === '归档采购材料')!;
    // 无依赖的按 ASSIGN 正常落 PENDING_ACCEPT；有依赖的落 BLOCKED
    expect(first.status).toBe('PENDING_ACCEPT');
    expect(second.status).toBe('BLOCKED');
    expect(dependencies).toEqual([{ taskId: second.id, dependsOnTaskId: first.id }]);
  });
});

describe('任务依赖 · 前置完成后自动解锁', () => {
  it('前置验收通过 → 下游 BLOCKED 任务自动回到 PENDING_ACCEPT', async () => {
    const { service, tx, tasks, dependencies } = buildFake();
    await service.createFromNodeTemplates(tx as never, {
      tenantId: 1,
      instanceId: 501,
      instanceNodeId: 900,
      workflowNodeId: 2,
      creatorId: 3,
      initiatorId: 3,
    });
    const first = tasks.find((task) => task.title === '收集三家报价')!;
    const second = tasks.find((task) => task.title === '归档采购材料')!;
    dependencies.forEach((item) => void item);

    // 前置任务推进到待验收，验收人就是王强本人
    first.status = 'PENDING_ACCEPTANCE';
    const result = await service.acceptancePass(actor, first.id, '验收通过');

    expect(first.status).toBe('DONE');
    expect(result.unlockedTasks).toEqual([second.id]);
    expect(second.status).toBe('PENDING_ACCEPT');
    // 下游还没做完，不应推动流程进入下一层
    expect((result as { advanced: boolean }).advanced).toBe(false);
  });
});
