import { InstanceAdvanceService } from './instance-advance.service';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import type { NodeContext } from '../vote/node-context.service';

/**
 * 层级推进 · 定局口径（假仓储测试）。
 *
 * 锁住本轮确认的三个决策之一：**流程定局后停留在 APPROVED / REJECTED，不自动归档**，
 * 归档留给后续显式动作或归档任务（状态机里的 CLOSE 路径仍然可用）。
 */

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

function nodeContext(): NodeContext {
  return {
    instance: {
      id: 501,
      tenantId: 1,
      status: 'VOTING',
      initiatorId: 9,
      currentNodeId: 900,
      templateVersionId: 100,
      layerIndex: 1,
      code: 'OA-202609-0001',
      title: '采购服务器',
      priority: 'NORMAL',
      formData: {},
    },
    node: {
      id: 900,
      nodeId: 2,
      status: 'PENDING_CONCLUSION',
      layerIndex: 1,
      round: 1,
      deadline: null,
      vetoLocked: false,
      conclusionStatus: 'PENDING',
      conclusionDeadline: null,
      nodeKey: 'layer1_tech',
    },
    voters: [{ userId: 3, weight: 1, status: 'VOTED' }],
    votes: [{ id: 1, voterId: 3, decision: 'APPROVE', weight: 1, revoteSeq: 1 }],
    rule: {
      passRule: 'MAJORITY',
      rejectRule: 'NONE',
      abstainPolicy: 'EXCLUDE_FROM_DENOMINATOR',
      timeoutPolicy: 'REMIND_ONLY',
      visibility: 'RESULT_ONLY',
      viewScope: 'DEPT_ONLY',
      allowAbstain: false,
      requireAllVote: true,
      revotePolicy: 'UNLIMITED_BEFORE_CONCLUSION',
      vetoTerminates: false,
      tiePolicy: 'ESCALATE',
      conclusionMode: 'MANUAL_CONFIRM',
      timeoutHours: 24,
      remindIntervalHours: 8,
      maxRemindRounds: 3,
      conclusionTimeoutHours: 24,
      quorumPolicy: 'MIN_POOL_RATIO',
      minQuorum: 0.6,
      allowMarkAbsent: true,
    },
    voteResult: { passed: true },
  };
}

/** 单层模板：只有一层投票 → 结论定局后没有下一层 */
const singleLayerVersion = {
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
      voterRules: [],
      voteRule: { timeoutHours: 24 },
    },
    { id: 3, nodeKey: 'end', type: 'END', name: '结束', order: 2, layerIndex: null, voterRules: [], voteRule: null },
  ],
  edges: [
    { fromNodeId: 1, toNodeId: 2 },
    { fromNodeId: 2, toNodeId: 3 },
  ],
};

/** 两层模板：推进时应该开第二层 */
const twoLayerVersion = {
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
      voterRules: [],
      voteRule: { timeoutHours: 24 },
    },
    {
      id: 4,
      nodeKey: 'layer2_product',
      type: 'VOTE',
      name: '产品中心复核',
      order: 2,
      layerIndex: 2,
      voterRules: [
        {
          id: 31,
          voterType: 'USER',
          voterValue: { userIds: [4] },
          weight: 1,
          isRequired: true,
          order: 0,
        },
      ],
      voteRule: { timeoutHours: 24 },
    },
    { id: 3, nodeKey: 'end', type: 'END', name: '结束', order: 3, layerIndex: null, voterRules: [], voteRule: null },
  ],
  edges: [
    { fromNodeId: 1, toNodeId: 2 },
    { fromNodeId: 2, toNodeId: 4 },
    { fromNodeId: 4, toNodeId: 3 },
  ],
};

function buildFake(version: unknown) {
  const updates: Record<string, unknown>[] = [];
  const tx = {
    workflowVersion: { findFirst: jest.fn().mockResolvedValue(version) },
    workflowInstance: {
      findFirst: jest.fn().mockResolvedValue({ formData: {} }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return {};
      }),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue({ departments: [{ isPrimary: true, departmentId: 3 }] }),
    },
    instanceNode: { create: jest.fn().mockResolvedValue({ id: 901 }) },
    instanceNodeVoter: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };

  const prisma = {
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as unknown[]),
    ),
  };
  const directory = {
    load: jest.fn().mockResolvedValue({
      departments: [],
      users: [{ userId: 4, deptIds: [], roleCodes: ['VOTER'] }],
      voteGroups: [],
      workNoMembers: [],
      initiatorDeptId: 3,
      parentDeptId: 2,
    }),
  };

  return {
    service: new InstanceAdvanceService(prisma as never, directory as never),
    tx,
    updates,
  };
}

describe('层级推进 · 定局后停留在结果态', () => {
  it('最后一层通过 → APPROVED（不自动归档），并写入 endedAt', async () => {
    const { service, tx, updates } = buildFake(singleLayerVersion);
    const result = await service.advance(tx as never, nodeContext(), actor, 'PASSED');

    expect(result.instanceStatus).toBe('APPROVED');
    expect(result.finalStatus).toBe('APPROVED');
    expect(result.nextNode).toBeNull();
    expect(updates[0]).toMatchObject({ status: 'APPROVED' });
    expect(updates[0]!.endedAt).toBeInstanceOf(Date);
    expect(result.summary).toContain('待归档');
  });

  it('本层驳回 → REJECTED（不自动归档）', async () => {
    const { service, tx, updates } = buildFake(singleLayerVersion);
    const result = await service.advance(tx as never, nodeContext(), actor, 'REJECTED');

    expect(result.instanceStatus).toBe('REJECTED');
    expect(updates[0]).toMatchObject({ status: 'REJECTED' });
    expect(updates[0]!.endedAt).toBeInstanceOf(Date);
  });

  it('还有下一层时留在 VOTING，回写 currentNodeId 与 layerIndex，且不写 endedAt', async () => {
    const { service, tx, updates } = buildFake(twoLayerVersion);
    const result = await service.advance(tx as never, nodeContext(), actor, 'PASSED');

    expect(result.instanceStatus).toBe('VOTING');
    expect(result.finalStatus).toBe('VOTING');
    expect(result.nextNode).toMatchObject({ id: 901, layerIndex: 2, voters: 1 });
    expect(updates[0]).toMatchObject({ status: 'VOTING', currentNodeId: 901, layerIndex: 2 });
    expect(updates[0]!.endedAt).toBeUndefined();
    // 第二层节点与投票人快照都在同一事务里建好
    expect(tx.instanceNode.create).toHaveBeenCalledTimes(1);
    expect(tx.instanceNodeVoter.createMany).toHaveBeenCalledTimes(1);
    expect(result.summary).toContain('已开启下一层');
  });
});
