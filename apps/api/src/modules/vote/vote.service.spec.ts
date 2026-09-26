import { VoteService } from './vote.service';
import { NodeContextService } from './node-context.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';

/**
 * 投票闭环 · 假仓储测试（不连数据库）。
 *
 * 假仓储是**有状态**的：投票写入会真的改变内存里的票与投票人状态，
 * 因此能验证"投到最后一票时自动进入结论阶段"这类跨步骤行为，
 * 而不只是验证某一次调用参数。
 */

const ruleRow = {
  passRule: 'MAJORITY',
  passThreshold: null,
  rejectRule: 'ANY_VETO',
  rejectThreshold: null,
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
};

function voter(userId: number): AuthenticatedUser {
  return {
    tenantId: 1,
    userId,
    email: `u${userId}@cloudrail.dev`,
    name: `用户${userId}`,
    departments: [{ id: 3, path: '/1/2/3/' }],
    primaryDeptId: 3,
    scopeType: 'DEPT',
    roleCodes: ['VOTER'],
    permissions: ['VOTE_CAST', 'VOTE_READ'],
  };
}

function buildFake(options: { deadline?: Date; voterIds?: number[]; nodeStatus?: string } = {}) {
  const state = {
    voters: (options.voterIds ?? [3, 4]).map((userId) => ({ userId, weight: 1, status: 'PENDING' as string })),
    votes: [] as { id: number; voterId: number; decision: string; weight: number; revoteSeq: number; isReplaced: boolean }[],
    nodeStatus: options.nodeStatus ?? 'VOTING',
    vetoLocked: false,
    conclusionStatus: 'NOT_REQUIRED',
    voteResult: null as null | { passed: boolean; isProvisional: boolean },
    instanceStatus: 'VOTING',
    instanceUpdates: [] as Record<string, unknown>[],
  };

  const instanceRow = {
    id: 501,
    tenantId: 1,
    status: 'VOTING',
    initiatorId: 9,
    currentNodeId: 900,
    templateVersionId: 100,
    layerIndex: 1,
  };

  const nodeRow = () => ({
    id: 900,
    nodeId: 2,
    status: state.nodeStatus,
    layerIndex: 1,
    round: 1,
    deadline: options.deadline ?? new Date(Date.now() + 3600_000),
    vetoLocked: state.vetoLocked,
    conclusionStatus: state.conclusionStatus,
    conclusionDeadline: null,
    node: { nodeKey: 'layer1_tech', voteRule: ruleRow },
    voters: state.voters.map((item) => ({ ...item })),
    votes: state.votes.filter((vote) => !vote.isReplaced).map((vote) => ({ ...vote })),
    voteResult: state.voteResult,
  });

  const tx = {
    workflowInstance: {
      findFirst: jest.fn().mockResolvedValue(instanceRow),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.instanceUpdates.push(data);
        if (typeof data.status === 'string') state.instanceStatus = data.status;
        return {};
      }),
    },
    instanceNode: {
      findFirst: jest.fn(async () => nodeRow()),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (typeof data.status === 'string') state.nodeStatus = data.status;
        if (typeof data.vetoLocked === 'boolean') state.vetoLocked = data.vetoLocked;
        if (typeof data.conclusionStatus === 'string') state.conclusionStatus = data.conclusionStatus;
        return {};
      }),
    },
    instanceNodeVoter: {
      findMany: jest.fn(async () => state.voters.map((item) => ({ ...item }))),
      update: jest.fn(
        async ({ where, data }: { where: { instanceNodeId_userId: { userId: number } }; data: Record<string, unknown> }) => {
          const target = state.voters.find((item) => item.userId === where.instanceNodeId_userId.userId);
          if (target && typeof data.status === 'string') target.status = data.status;
          return {};
        },
      ),
    },
    vote: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: state.votes.length + 1,
          voterId: data.voterId as number,
          decision: data.decision as string,
          weight: Number(data.weight),
          revoteSeq: data.revoteSeq as number,
          isReplaced: false,
        };
        state.votes.push(created);
        return { id: created.id, revoteSeq: created.revoteSeq };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const target = state.votes.find((vote) => vote.id === where.id);
        if (target && typeof data.isReplaced === 'boolean') target.isReplaced = data.isReplaced;
        return {};
      }),
      findMany: jest.fn(async () =>
        state.votes
          .filter((vote) => !vote.isReplaced)
          .map((vote) => ({ voterId: vote.voterId, decision: vote.decision, weight: vote.weight })),
      ),
    },
    voteResult: {
      upsert: jest.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const payload = (create ?? update) as { passed: boolean; isProvisional: boolean };
        state.voteResult = { passed: payload.passed, isProvisional: payload.isProvisional };
        return {};
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as unknown[]),
    ),
  };

  return { prisma, tx, state };
}

function buildService(prisma: unknown): VoteService {
  return new VoteService(prisma as never, new NodeContextService(prisma as never));
}

describe('投票闭环 · 记票与自动推进', () => {
  it('第一票只记票：节点仍是 VOTING，不写计票快照', async () => {
    const { prisma, tx, state } = buildFake();
    const service = buildService(prisma);

    const result = await service.castVote(voter(3), 501, { decision: 'APPROVE' });

    expect(tx.vote.create).toHaveBeenCalledTimes(1);
    expect(tx.vote.create.mock.calls[0]![0].data.revoteSeq).toBe(1);
    expect(result.nodeStatus).toBe('VOTING');
    expect(result.appliedEvents).toEqual([]);
    expect(result.progress.stated).toBe(1);
    expect(state.voteResult).toBeNull();
    expect(state.voters[0]!.status).toBe('VOTED');
  });

  it('投到池内最后一票 → 自动进入结论阶段并写系统拟判定快照', async () => {
    const { prisma, tx, state } = buildFake();
    const service = buildService(prisma);

    await service.castVote(voter(3), 501, { decision: 'APPROVE' });
    const result = await service.castVote(voter(4), 501, { decision: 'APPROVE' });

    expect(result.appliedEvents).toEqual(['ALL_STATED']);
    expect(result.nodeStatus).toBe('PENDING_CONCLUSION');
    expect(result.conclusionStatus).toBe('PENDING');
    expect(result.systemDecision).toBe('APPROVE');
    expect(state.voteResult).toEqual({ passed: true, isProvisional: true });
    expect(tx.instanceNode.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING_CONCLUSION', conclusionStatus: 'PENDING' }),
      }),
    );
  });

  it('否决票按默认口径只锁定、仍等其余人表态', async () => {
    const { prisma, state } = buildFake();
    const service = buildService(prisma);

    const result = await service.castVote(voter(3), 501, { decision: 'REJECT' });

    expect(result.appliedEvents).toEqual(['VETO_LOCK']);
    expect(result.vetoLocked).toBe(true);
    expect(result.nodeStatus).toBe('VOTING');
    expect(result.systemDecision).toBe('REJECT');
    expect(state.voteResult).toBeNull();
  });

  it('改票：旧票标记 isReplaced、新票 revoteSeq 递增，计票只算最新票', async () => {
    const { prisma, tx, state } = buildFake();
    const service = buildService(prisma);

    await service.castVote(voter(3), 501, { decision: 'APPROVE' });
    const result = await service.castVote(voter(3), 501, { decision: 'REJECT' });

    expect(result.isRevote).toBe(true);
    expect(result.revoteSeq).toBe(2);
    expect(state.votes.filter((vote) => vote.isReplaced)).toHaveLength(1);
    // 只统计最新票：同意 0、反对 1（而不是同意 1 反对 1）
    expect(result.progress.approve).toBe(0);
    expect(result.progress.reject).toBe(1);
  });
});

describe('投票闭环 · 守卫', () => {
  it('不在投票人名单 → VOTE_NOT_VOTER', async () => {
    const { prisma } = buildFake();
    const service = buildService(prisma);
    await expect(service.castVote(voter(99), 501, { decision: 'APPROVE' })).rejects.toMatchObject({
      code: 'VOTE_NOT_VOTER',
    });
  });

  it('已被标记缺席 → VOTE_ABSENT', async () => {
    const { prisma, state } = buildFake();
    state.voters[0]!.status = 'ABSENT';
    const service = buildService(prisma);
    await expect(service.castVote(voter(3), 501, { decision: 'APPROVE' })).rejects.toMatchObject({
      code: 'VOTE_ABSENT',
    });
  });

  it('已过截止时间 → VOTE_EXPIRED', async () => {
    const { prisma } = buildFake({ deadline: new Date(Date.now() - 60_000) });
    const service = buildService(prisma);
    await expect(service.castVote(voter(3), 501, { decision: 'APPROVE' })).rejects.toMatchObject({
      code: 'VOTE_EXPIRED',
    });
  });

  it('弃权被拒绝（必须表态）', async () => {
    const { prisma } = buildFake();
    const service = buildService(prisma);
    await expect(
      service.castVote(voter(3), 501, { decision: 'ABSTAIN' as never }),
    ).rejects.toMatchObject({ code: 'VOTE_ABSTAIN_NOT_ALLOWED' });
  });

  it('结论已形成（节点不在 VOTING）→ VOTE_CLOSED', async () => {
    const { prisma } = buildFake({ nodeStatus: 'PENDING_CONCLUSION' });
    const service = buildService(prisma);
    await expect(service.castVote(voter(3), 501, { decision: 'APPROVE' })).rejects.toMatchObject({
      code: 'VOTE_CLOSED',
    });
  });

  it('错误类型是 AppError，便于统一异常过滤器转成 code + HTTP 状态', async () => {
    const { prisma } = buildFake();
    const service = buildService(prisma);
    const error = await service.castVote(voter(99), 501, { decision: 'APPROVE' }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).httpStatus).toBe(403);
  });
});
