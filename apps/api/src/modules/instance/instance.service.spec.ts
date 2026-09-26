import { InstanceService } from './instance.service';
import { VoterDirectoryService } from './voter-directory.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';

/**
 * 实例发起 · 编排测试（假仓储，**不连数据库**）。
 *
 * 锁住三条不变量：
 * 1. 实例与节点状态由状态机算出（SUBMIT → VOTING、OPEN → VOTING），不是硬编码写死；
 * 2. 投票人快照必须落库，且带 sourceReason（审计"为什么他是投票人"）；
 * 3. 首层解析不出投票人时必须报 NODE_VOTER_EMPTY，不允许建出"没人投票的流程"。
 */

const templateRow = {
  id: 10,
  name: '采购申请',
  status: 'PUBLISHED',
  currentVersionId: 100,
  formSchema: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
  deadlineMode: 'CALENDAR_DAY',
};

const versionRow = {
  id: 100,
  nodes: [
    { id: 1, nodeKey: 'start', type: 'START', name: '发起', order: 0, layerIndex: null, voterRules: [], voteRule: null },
    {
      id: 2,
      nodeKey: 'layer1_tech',
      type: 'VOTE',
      name: '技术部初评',
      order: 1,
      layerIndex: 1,
      voterRules: [
        {
          id: 11,
          voterType: 'DEPARTMENT',
          voterValue: { deptRef: 'INITIATOR_DEPT' },
          weight: 1,
          isRequired: true,
          order: 0,
        },
      ],
      voteRule: { timeoutHours: 24, conclusionTimeoutHours: 24 },
    },
    { id: 3, nodeKey: 'end', type: 'END', name: '结束', order: 2, layerIndex: null, voterRules: [], voteRule: null },
  ],
  edges: [
    { fromNodeId: 1, toNodeId: 2 },
    { fromNodeId: 2, toNodeId: 3 },
  ],
};

const actor: AuthenticatedUser = {
  tenantId: 1,
  userId: 9,
  email: 'wangqiang@cloudrail.dev',
  name: '王强',
  departments: [{ id: 3, path: '/1/2/3/' }],
  primaryDeptId: 3,
  scopeType: 'DEPT',
  roleCodes: ['DEPT_MANAGER'],
  permissions: ['INSTANCE_CREATE'],
};

const input = {
  templateId: 10,
  title: '采购服务器',
  summary: '技术部扩容',
  formData: { title: '采购服务器' },
  priority: 'NORMAL' as const,
  saveAsDraft: false,
};

function buildMocks() {
  const tx = {
    numberSequence: { upsert: jest.fn().mockResolvedValue({ nextValue: 1 }) },
    workflowInstance: {
      create: jest.fn().mockResolvedValue({
        id: 501,
        code: 'OA-202609-0001',
        status: 'VOTING',
        title: '采购服务器',
        createdAt: new Date('2026-09-26T03:00:00Z'),
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    instanceNode: {
      create: jest.fn().mockResolvedValue({
        id: 900,
        status: 'VOTING',
        deadline: new Date('2026-09-27T03:00:00Z'),
      }),
    },
    instanceNodeVoter: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };

  const prisma = {
    workflowTemplate: { findFirst: jest.fn().mockResolvedValue(templateRow) },
    workflowVersion: { findFirst: jest.fn().mockResolvedValue(versionRow) },
    department: {
      findMany: jest.fn().mockResolvedValue([
        { id: 1, parentId: null, path: '/1/' },
        { id: 2, parentId: 1, path: '/1/2/' },
        { id: 3, parentId: 2, path: '/1/2/3/' },
      ]),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 3, departments: [{ departmentId: 3, isLeader: true }], roles: [{ role: { code: 'DEPT_MANAGER' } }] },
        { id: 4, departments: [{ departmentId: 3, isLeader: false }], roles: [{ role: { code: 'VOTER' } }] },
      ]),
    },
    voteGroup: { findMany: jest.fn().mockResolvedValue([]) },
    departmentWorkNoMember: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as unknown[]),
    ),
  };

  return { prisma, tx };
}

/** 装配被测服务：投票人目录服务复用同一份假仓储，因此仍不触达数据库 */
function buildService(prisma: unknown): InstanceService {
  return new InstanceService(prisma as never, new VoterDirectoryService(prisma as never));
}

describe('实例发起 · 编排', () => {
  it('按状态机把实例与节点置为 VOTING，并按单号序列生成流程编号', async () => {
    const { prisma, tx } = buildMocks();
    const service = buildService(prisma);

    const result = await service.createInstance(actor, input);

    const instanceData = tx.workflowInstance.create.mock.calls[0]![0].data;
    expect(instanceData.status).toBe('VOTING');
    expect(instanceData.layerIndex).toBe(1);
    expect(instanceData.startedAt).toBeInstanceOf(Date);
    expect(instanceData.code).toMatch(/^OA-\d{6}-0001$/);

    const nodeData = tx.instanceNode.create.mock.calls[0]![0].data;
    expect(nodeData.status).toBe('VOTING');
    // 结论只在全员表态后才需要填写，开投时不能是 PENDING
    expect(nodeData.conclusionStatus).toBe('NOT_REQUIRED');
    expect(nodeData.deadline).toBeInstanceOf(Date);

    expect(tx.workflowInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentNodeId: 900 } }),
    );
    expect(result.instanceId).toBe(501);
    expect(result.node.layerIndex).toBe(1);
  });

  it('首层投票人解析结果写进快照，带权重与来源理由', async () => {
    const { prisma, tx } = buildMocks();
    const service = buildService(prisma);

    const result = await service.createInstance(actor, input);

    const voters = tx.instanceNodeVoter.createMany.mock.calls[0]![0].data;
    expect(voters).toHaveLength(2);
    expect(voters.map((v: { userId: number }) => v.userId)).toEqual([3, 4]);
    for (const voter of voters) {
      expect(voter.status).toBe('PENDING');
      expect(voter.sourceRuleId).toBe(11);
      expect(String(voter.sourceReason)).toContain('部门');
    }
    expect(result.voters).toHaveLength(2);
    expect(result.reason).toContain('首层节点已创建');
  });

  it('返回状态机产出的副作用清单，供阶段 3 的 Outbox/WS 消费', async () => {
    const { prisma } = buildMocks();
    const service = buildService(prisma);

    const result = await service.createInstance(actor, input);

    expect(result.actions).toEqual(
      expect.arrayContaining([
        'CREATE_NODE',
        'SNAPSHOT_VOTERS',
        'SCHEDULE_VOTE_TIMEOUT',
        'CREATE_NODE_VOTERS',
        'NOTIFY_VOTERS',
      ]),
    );
  });

  it('首层解析不出投票人 → NODE_VOTER_EMPTY，且不写任何数据', async () => {
    const { prisma, tx } = buildMocks();
    // 技术部没有任何用户 → DEPARTMENT 规则解析为空
    prisma.user.findMany.mockResolvedValue([]);
    const service = buildService(prisma);

    await expect(service.createInstance(actor, input)).rejects.toBeInstanceOf(AppError);
    await expect(service.createInstance(actor, input)).rejects.toMatchObject({
      code: 'NODE_VOTER_EMPTY',
    });
    expect(tx.workflowInstance.create).not.toHaveBeenCalled();
    expect(tx.instanceNode.create).not.toHaveBeenCalled();
  });

  it('表单不满足模板必填要求 → WF_FORM_SCHEMA_INVALID', async () => {
    const { prisma, tx } = buildMocks();
    const service = buildService(prisma);

    await expect(
      service.createInstance(actor, { ...input, formData: {} }),
    ).rejects.toMatchObject({ code: 'WF_FORM_SCHEMA_INVALID' });
    expect(tx.workflowInstance.create).not.toHaveBeenCalled();
  });

  it('模板没有已发布版本 → WF_VERSION_NOT_PUBLISHED', async () => {
    const { prisma } = buildMocks();
    prisma.workflowTemplate.findFirst.mockResolvedValue({ ...templateRow, currentVersionId: null });
    const service = buildService(prisma);

    await expect(service.createInstance(actor, input)).rejects.toMatchObject({
      code: 'WF_VERSION_NOT_PUBLISHED',
    });
  });
});
