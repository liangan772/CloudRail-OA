import request from 'supertest';

/**
 * 真实库全链路 e2e。
 *
 * 覆盖「登录 → 组织/工号 → 模板 → 发起（解析并快照投票人）→ 全员表态 → 人工结论 →
 * 开启下一层 → 跨部门可见性 → 定局停留态 → 条件上报」，
 * 断言的是**真库里的结果**（Decimal 转换、唯一约束、事务边界都在这一层暴露）。
 *
 * 前置：`DATABASE_URL` 指向可达的 PostgreSQL（已迁移 + 已 seed）。
 * 运行：`pnpm --filter @oa/api test:e2e`（由 test/e2e/run.mjs 起服务再跑本文件）
 *
 * 打的是**外部真实服务进程**（`E2E_BASE_URL`，默认 http://127.0.0.1:3099），
 * 而不是在 jest 进程里 in-process 启动应用 —— 后者在本机环境下 Prisma 连接会不稳定，
 * 而且打真实进程本来更接近"联调"的语义。
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3099';
const PASSWORD = 'Oa@12345678';
const ADMIN = 'admin@cloudrail.dev';
const WANGQIANG = 'wangqiang@cloudrail.dev'; // 技术部经理，D1003 工号主责人
const LIJING = 'lijing@cloudrail.dev'; // 产品中心总监，D1001 工号主责人

const tokenCache = new Map<string, string>();

function http() {
  return request(BASE_URL);
}

async function token(email: string): Promise<string> {
  const cached = tokenCache.get(email);
  if (cached) return cached;
  const res = await http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
  const accessToken = res.body.data.tokens.accessToken as string;
  tokenCache.set(email, accessToken);
  return accessToken;
}

/** 取用户id → 邮箱映射（用 admin 的 TENANT 范围看全租户） */
async function userDirectory(): Promise<Map<number, { email: string; name: string }>> {
  const res = await http()
    .get('/org/users')
    .query({ page: 1, pageSize: 100 })
    .set('Authorization', `Bearer ${await token(ADMIN)}`)
    .expect(200);
  const map = new Map<number, { email: string; name: string }>();
  for (const item of res.body.data.items as Array<{ id: number; email: string; name: string }>) {
    map.set(item.id, { email: item.email, name: item.name });
  }
  return map;
}

/** 让指定 id 的投票人各投一票（顺序执行，最后一票会触发节点推进） */
async function castVotesFor(
  instanceId: number,
  voters: number[],
  directory: Map<number, { email: string; name: string }>,
  decision: 'APPROVE' | 'REJECT' = 'APPROVE',
) {
  let last: request.Response | null = null;
  for (const userId of voters) {
    const account = directory.get(userId);
    if (!account) throw new Error(`用户 ${userId} 不在租户用户列表中`);
    const res = await http()
      .post(`/instances/${instanceId}/votes`)
      .set('Authorization', `Bearer ${await token(account.email)}`)
      .send({ decision, comment: `${account.name} ${decision === 'APPROVE' ? '同意' : '反对'}` })
      .expect(201);
    last = res;
  }
  return last!;
}

async function instanceDetail(instanceId: number) {
  const res = await http()
    .get(`/instances/${instanceId}`)
    .set('Authorization', `Bearer ${await token(ADMIN)}`)
    .expect(200);
  return res.body.data;
}

describe('真实库 e2e · 全链路', () => {
  beforeAll(async () => {
    // 等外部服务就绪（run.mjs 会先起服务；直接跑 jest 时也给 20 秒兜底）
    const deadline = Date.now() + 20_000;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      try {
        const res = await request(BASE_URL).get('/health');
        if (res.status === 200) return;
        lastError = new Error(`/health 返回 ${res.status}`);
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      `e2e 目标服务不可达：${BASE_URL}（请先用 pnpm --filter @oa/api test:e2e 运行，或自行启动服务）。最后错误：${
        (lastError as Error)?.message ?? lastError
      }`,
    );
  });

  let templateId: number;
  let instanceId: number;
  let firstLayerVoterIds: number[] = [];
  let directory: Map<number, { email: string; name: string }>;
  let overLimitInstanceId: number;
  let overLimitEscalationId: number;

  it('登录与身份：admin 为租户管理员，数据范围为 TENANT', async () => {
    const res = await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${await token(ADMIN)}`)
      .expect(200);

    expect(res.body.data.email).toBe(ADMIN);
    expect(res.body.data.scope).toBe('TENANT');
    expect(res.body.data.permissions).toEqual(expect.arrayContaining(['INSTANCE_CREATE', 'VOTE_CAST', 'WF_PUBLISH']));
  });

  it('组织与工号：三层部门树与三个部门工号都在', async () => {
    const tree = await http()
      .get('/org/departments')
      .set('Authorization', `Bearer ${await token(ADMIN)}`)
      .expect(200);
    const names = JSON.stringify(tree.body.data);
    expect(names).toContain('云轨科技');
    expect(names).toContain('产品中心');
    expect(names).toContain('技术部');

    const workNos = await http()
      .get('/org/worknos')
      .set('Authorization', `Bearer ${await token(ADMIN)}`)
      .expect(200);
    const codes = (workNos.body.data as Array<{ workNo: string }>).map((item) => item.workNo);
    expect(codes).toEqual(expect.arrayContaining(['D1000', 'D1001', 'D1003']));
  });

  it('模板：采购申请已发布，含两个投票层', async () => {
    const list = await http()
      .get('/workflow/templates')
      .query({ page: 1, pageSize: 20 })
      .set('Authorization', `Bearer ${await token(ADMIN)}`)
      .expect(200);
    const template = (list.body.data.items as Array<{ id: number; code: string }>).find(
      (item) => item.code === 'PURCHASE_APPROVAL',
    );
    expect(template).toBeDefined();
    templateId = template!.id;

    const detail = await http()
      .get(`/workflow/templates/${templateId}`)
      .set('Authorization', `Bearer ${await token(ADMIN)}`)
      .expect(200);
    const published = (detail.body.data.versions as Array<{ publishedAt: string | null; nodes: Array<{ type: string; layerIndex: number | null }> }>).find(
      (version) => version.publishedAt != null,
    );
    expect(published).toBeDefined();
    const voteLayers = published!.nodes.filter((node) => node.type === 'VOTE').map((node) => node.layerIndex);
    expect(voteLayers.sort()).toEqual([1, 2]);
  });

  it('发起：首层投票人快照 = 技术部 4 人（真库解析 + 落库）', async () => {
    directory = await userDirectory();

    const res = await http()
      .post('/instances')
      .set('Authorization', `Bearer ${await token(WANGQIANG)}`)
      .send({
        templateId,
        title: `e2e 采购申请 ${Date.now()}`,
        summary: '真实库 e2e',
        formData: { amount: 12000, purpose: 'e2e 测试用服务器', vendorCount: 3 },
        priority: 'NORMAL',
        saveAsDraft: false,
      })
      .expect(201);

    instanceId = res.body.data.instanceId as number;
    expect(res.body.data.status).toBe('VOTING');
    expect(res.body.data.code).toMatch(/^OA-\d{6}-\d{4}$/);
    expect(res.body.data.node.status).toBe('VOTING');
    expect(res.body.data.node.layerIndex).toBe(1);
    expect(res.body.data.node.deadline).toBeTruthy();

    // 技术部 4 人：王强/刘洋/陈晨/赵敏
    expect(res.body.data.voters).toHaveLength(4);
    firstLayerVoterIds = (res.body.data.voters as Array<{ userId: number }>).map((voter) => voter.userId);
    const names = firstLayerVoterIds.map((id) => directory.get(id)?.name);
    expect(names).toEqual(expect.arrayContaining(['王强', '刘洋', '陈晨', '赵敏']));
    // 来源可追溯
    for (const voter of res.body.data.voters as Array<{ sourceReason: string }>) {
      expect(voter.sourceReason).toContain('部门');
    }
  });

  it('投票进度：本部门可见明细，聚合计数与应投票人数一致', async () => {
    const res = await http()
      .get(`/instances/${instanceId}/vote-progress`)
      .set('Authorization', `Bearer ${await token(WANGQIANG)}`)
      .expect(200);

    expect(res.body.data.progress).toMatchObject({ expected: 4, pool: 4, absent: 0, stated: 0, quorumSatisfied: true });
    expect(res.body.data.detailsVisible).toBe(true);
    expect(res.body.data.details).toHaveLength(4);
    expect(res.body.data.rule).toContain('必须表态');
  });

  it('全员表态后自动进入待填写结论，系统拟判定为通过', async () => {
    const last = await castVotesFor(instanceId, firstLayerVoterIds, directory);

    expect(last.body.data.appliedEvents).toEqual(['ALL_STATED']);
    expect(last.body.data.nodeStatus).toBe('PENDING_CONCLUSION');
    expect(last.body.data.conclusionStatus).toBe('PENDING');
    expect(last.body.data.systemDecision).toBe('APPROVE');
    expect(last.body.data.progress).toMatchObject({ stated: 4, approve: 4, reject: 0 });
  });

  it('人工结论通过 → 开启第二层（产品中心工号 3 人）', async () => {
    const res = await http()
      .post(`/instances/${instanceId}/conclusion`)
      .set('Authorization', `Bearer ${await token(WANGQIANG)}`)
      .send({ decision: 'APPROVE', content: '技术部初评通过，同意采购' })
      .expect(201);

    expect(res.body.data.nodeStatus).toBe('PASSED');
    expect(res.body.data.instanceStatus).toBe('VOTING');
    expect(res.body.data.nextNode).toMatchObject({ layerIndex: 2, voters: 3 });
    // 本层通过后待派任务数如实报出（任务实体由阶段 3 创建）
    expect(res.body.data.pendingTaskTemplates).toBeGreaterThan(0);

    const detail = await instanceDetail(instanceId);
    expect(detail.status).toBe('VOTING');
    expect(detail.layerIndex).toBe(2);
    const layer2 = (detail.nodes as Array<{ layerIndex: number; status: string; voters: Array<{ userId: number }> }>).find(
      (node) => node.layerIndex === 2,
    );
    expect(layer2).toBeDefined();
    expect(layer2!.status).toBe('VOTING');
    expect(layer2!.voters).toHaveLength(3);
    const layer2Names = layer2!.voters.map((voter) => directory.get(voter.userId)?.name);
    expect(layer2Names).toEqual(expect.arrayContaining(['李静', '孙鹏', '周琳']));
  });

  it('跨部门可见性：技术部的人看第二层只能拿到聚合计数（B2）', async () => {
    const asTech = await http()
      .get(`/instances/${instanceId}/vote-progress`)
      .set('Authorization', `Bearer ${await token(WANGQIANG)}`)
      .expect(200);
    expect(asTech.body.data.progress.expected).toBe(3);
    expect(asTech.body.data.detailsVisible).toBe(false);
    expect(asTech.body.data.details).toEqual([]);

    // 本部门（产品中心）则能看到姓名与选择
    const asProduct = await http()
      .get(`/instances/${instanceId}/vote-progress`)
      .set('Authorization', `Bearer ${await token(LIJING)}`)
      .expect(200);
    expect(asProduct.body.data.detailsVisible).toBe(true);
    expect(asProduct.body.data.details).toHaveLength(3);
  });

  it('第二层全员表态 + 结论通过 → 流程停在 APPROVED（不自动归档）', async () => {
    const detail = await instanceDetail(instanceId);
    const layer2 = (detail.nodes as Array<{ layerIndex: number; voters: Array<{ userId: number }> }>).find(
      (node) => node.layerIndex === 2,
    )!;
    const voters = layer2.voters.map((voter) => voter.userId);

    const last = await castVotesFor(instanceId, voters, directory);
    expect(last.body.data.nodeStatus).toBe('PENDING_CONCLUSION');

    const concluded = await http()
      .post(`/instances/${instanceId}/conclusion`)
      .set('Authorization', `Bearer ${await token(LIJING)}`)
      .send({ decision: 'APPROVE', content: '产品中心复核通过' })
      .expect(201);

    expect(concluded.body.data.nodeStatus).toBe('PASSED');
    expect(concluded.body.data.finalStatus).toBe('APPROVED');
    // 决策 1：停留在结果态，不自动 CLOSED
    expect(concluded.body.data.instanceStatus).toBe('APPROVED');
    expect(concluded.body.data.summary).toContain('待归档');

    const final = await instanceDetail(instanceId);
    expect(final.status).toBe('APPROVED');
    expect(final.endedAt).toBeTruthy();
  });

  it('金额超限：命中上报规则 → 建上报单、冻结原流程、自动开上级投票', async () => {
    const created = await http()
      .post('/instances')
      .set('Authorization', `Bearer ${await token(WANGQIANG)}`)
      .send({
        templateId,
        title: `e2e 超限采购 ${Date.now()}`,
        formData: { amount: 80000, purpose: 'e2e 超限场景', vendorCount: 3 },
        priority: 'HIGH',
        saveAsDraft: false,
      })
      .expect(201);
    const overLimitId = created.body.data.instanceId as number;
    const voters = (created.body.data.voters as Array<{ userId: number }>).map((voter) => voter.userId);

    const last = await castVotesFor(overLimitId, voters, directory);

    expect(last.body.data.appliedEvents).toEqual(['ESCALATE']);
    expect(last.body.data.nodeStatus).toBe('ESCALATED');
    expect(last.body.data.reason).toContain('金额/风险超限');
    // 关键：不能既出结论又上报
    expect(last.body.data.escalation.matched.length).toBeGreaterThan(0);

    // 阶段 3：真的建出了上报单，并投递到上级部门工号
    const escalationCreated = last.body.data.escalationCreated as {
      escalationId: number;
      code: string;
      status: string;
      toWorkNo: string | null;
      frozen: boolean;
      upwardNodeId: number | null;
      upwardVoterCount: number;
    };
    expect(escalationCreated).toBeDefined();
    expect(escalationCreated.code).toMatch(/^ES-\d{6}-\d{4}$/);
    expect(escalationCreated.toWorkNo).toBe('D1001'); // 技术部的直接上级 = 产品中心
    expect(escalationCreated.frozen).toBe(true);
    expect(escalationCreated.upwardNodeId).not.toBeNull();
    expect(escalationCreated.upwardVoterCount).toBe(3); // 产品中心工号成员 3 人

    const detail = await instanceDetail(overLimitId);
    // 上报即冻结（C3/D7）：实例转 ESCALATED，并记录冻结前状态
    expect(detail.status).toBe('ESCALATED');
    expect(detail.suspendedFrom).toBe('VOTING');
    const node = (detail.nodes as Array<{ status: string; pendingEscalation: unknown }>)[0]!;
    expect(node.status).toBe('ESCALATED');
    expect(node.pendingEscalation).not.toBeNull();

    // 上报单详情：逐级链路与上级投票节点都在
    const escalationDetail = await http()
      .get(`/escalations/${escalationCreated.escalationId}`)
      .set('Authorization', `Bearer ${await token(ADMIN)}`)
      .expect(200);
    expect(escalationDetail.body.data.status).toBe('VOTING');
    expect(escalationDetail.body.data.level).toBe(1);
    expect(escalationDetail.body.data.fromWorkNo).toBe('D1003');
    expect(escalationDetail.body.data.toWorkNo).toBe('D1001');
    expect(escalationDetail.body.data.chains).toHaveLength(1);
    expect(escalationDetail.body.data.upwardNodes[0].voters).toHaveLength(3);

    overLimitInstanceId = overLimitId;
    overLimitEscalationId = escalationCreated.escalationId;
  });

  it('上级按同样规则投票并给出结论 → 原流程解冻恢复（CONTINUE）', async () => {
    const detail = await instanceDetail(overLimitInstanceId);
    // 上报后当前节点已切到「上级投票节点」，投票人 = 产品中心工号成员
    const upwardNode = (
      detail.nodes as Array<{ layerIndex: number; status: string; voters: Array<{ userId: number }> }>
    )
      .slice()
      .sort((a, b) => b.layerIndex - a.layerIndex)[0]!;
    expect(upwardNode.voters).toHaveLength(3);

    const votes = await castVotesFor(
      overLimitInstanceId,
      upwardNode.voters.map((voter) => voter.userId),
      directory,
    );
    expect(votes.body.data.nodeStatus).toBe('PENDING_CONCLUSION');

    // 上级结论：同意继续 → 解冻原流程
    const concluded = await http()
      .post(`/escalations/${overLimitEscalationId}/conclusion`)
      .set('Authorization', `Bearer ${await token(LIJING)}`)
      .send({ opinion: 'CONTINUE', content: '产品中心同意继续，按原流程执行' })
      .expect(201);

    expect(concluded.body.data.writeBackAction).toBe('CONTINUE');
    expect(concluded.body.data.escalationStatus).toBe('CLOSED');
    expect(concluded.body.data.instanceStatus).toBe('VOTING');

    const final = await instanceDetail(overLimitInstanceId);
    expect(final.status).toBe('VOTING');
  });

  it('上报规则试算接口：返回命中项与越级开关状态', async () => {
    const detail = await instanceDetail(instanceId);
    void detail;

    const res = await http()
      .get(`/instances/${instanceId}/escalation-preview`)
      .set('Authorization', `Bearer ${await token(ADMIN)}`)
      .expect(200);

    expect(res.body.data.allowCrossLevel).toBe(false);
    expect(Array.isArray(res.body.data.hits)).toBe(true);
    expect(res.body.data.errors).toEqual([]);
  });
});
