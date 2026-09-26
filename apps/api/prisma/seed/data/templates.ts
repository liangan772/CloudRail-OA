import type { Prisma } from '@prisma/client';

/** 节点投票规则的默认值：与阶段 0 已确认结论完全一致 */
export const DEFAULT_VOTE_RULE = {
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
} satisfies Record<string, unknown>;

export interface SeedVoterRule {
  voterType: 'USER' | 'ROLE' | 'DEPARTMENT' | 'VOTE_GROUP' | 'DEPT_WORKNO' | 'DYNAMIC';
  voterValue: Prisma.InputJsonValue;
  weight?: number;
}

export interface SeedTaskTemplate {
  title: string;
  assigneeRule: Prisma.InputJsonValue;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  dueOffset?: number;
  checklist?: string[];
  triggerOn?: 'PASS' | 'ALWAYS';
}

export interface SeedEscalationRule {
  triggerType:
    | 'MANUAL'
    | 'TIMEOUT'
    | 'TIE'
    | 'REPEATED_REJECT'
    | 'OVER_LIMIT'
    | 'CROSS_DEPT_DISPUTE'
    | 'INSUFFICIENT_PERMISSION'
    | 'TASK_BLOCKED'
    | 'TASK_OVERDUE'
    | 'CONCLUSION_TIMEOUT'
    | 'QUORUM_NOT_MET';
  condition?: Prisma.InputJsonValue;
  targetDeptRule?: 'DIRECT_PARENT' | 'LEVEL_UP';
  timeout?: number;
  freezeSource?: boolean;
  acceptMode?: 'AUTO' | 'GRAB' | 'ASSIGNED';
  onMissingWorkNo?: 'ESCALATE_UP' | 'NOTIFY_ADMIN' | 'BLOCK';
  maxLevel?: number;
}

export interface SeedNode {
  nodeKey: string;
  type: 'START' | 'VOTE' | 'TASK' | 'ESCALATION' | 'CONDITION' | 'END';
  name: string;
  order: number;
  layerIndex?: number;
  config?: Prisma.InputJsonValue;
  voterRules?: SeedVoterRule[];
  voteRule?: Record<string, unknown>;
  taskTemplates?: SeedTaskTemplate[];
  escalationRules?: SeedEscalationRule[];
}

export interface SeedEdge {
  from: string;
  to: string;
  condition?: Prisma.InputJsonValue;
  priority?: number;
  label?: string;
}

export interface SeedTemplate {
  code: string;
  name: string;
  category: string;
  description: string;
  formSchema: Prisma.InputJsonValue;
  nodes: SeedNode[];
  edges: SeedEdge[];
}

/** 模板 1：采购申请审批（2 层投票 + 任务 + 金额超限上报）——对应阶段 0 的 11 步验收场景 */
const PURCHASE: SeedTemplate = {
  code: 'PURCHASE_APPROVAL',
  name: '采购申请审批（两层投票）',
  category: '采购',
  description:
    '技术部初评 → 生成比价任务 → 产品中心复核。金额超 5 万自动上报直接上级部门工号，由上级部门再投票裁定。',
  formSchema: {
    type: 'object',
    required: ['amount', 'purpose', 'vendorCount'],
    properties: {
      amount: { type: 'number', title: '采购金额（元）', minimum: 1 },
      purpose: { type: 'string', title: '采购用途', maxLength: 500 },
      vendorCount: { type: 'number', title: '候选供应商数量', minimum: 1 },
      budget: { type: 'number', title: '该项预算（元）' },
      expectedDate: { type: 'string', title: '期望到货日期', format: 'date' },
    },
  },
  nodes: [
    { nodeKey: 'start', type: 'START', name: '发起', order: 0 },
    {
      nodeKey: 'layer1_tech',
      type: 'VOTE',
      name: '技术部初评',
      order: 1,
      layerIndex: 1,
      config: { description: '技术部全员必须表态，多数通过；任一反对即锁定不予通过' },
      voterRules: [
        {
          voterType: 'DEPARTMENT',
          voterValue: { deptRef: 'INITIATOR_DEPT', includeSub: false, leaderOnly: false },
        },
      ],
      voteRule: {
        passRule: 'MAJORITY',
        rejectRule: 'ANY_VETO',
        conclusionAuthorRule: { type: 'DEPT_WORKNO', deptRef: 'INITIATOR_DEPT' },
      },
      taskTemplates: [
        {
          title: '补充三家供应商比价材料',
          assigneeRule: { type: 'LOAD_BALANCE', deptRef: 'INITIATOR_DEPT', roleCodes: ['TASK_EXECUTOR'] },
          priority: 'HIGH',
          dueOffset: 24,
          checklist: ['收集三家供应商报价单', '填写比价分析表', '上传附件并提交验收'],
          triggerOn: 'PASS',
        },
      ],
      escalationRules: [
        {
          triggerType: 'OVER_LIMIT',
          condition: { gt: ['formData.amount', 50000] },
          targetDeptRule: 'DIRECT_PARENT',
          timeout: 48,
          freezeSource: true,
          acceptMode: 'AUTO',
          onMissingWorkNo: 'ESCALATE_UP',
          maxLevel: 5,
        },
        { triggerType: 'QUORUM_NOT_MET', targetDeptRule: 'DIRECT_PARENT' },
        { triggerType: 'TASK_OVERDUE', targetDeptRule: 'DIRECT_PARENT' },
      ],
    },
    {
      nodeKey: 'layer2_product',
      type: 'VOTE',
      name: '产品中心复核',
      order: 2,
      layerIndex: 2,
      config: { description: '产品中心工号成员投票，≥60% 同意通过；平票上报上级组织裁定' },
      voterRules: [{ voterType: 'DEPT_WORKNO', voterValue: { deptRef: 'PARENT_DEPT' } }],
      voteRule: {
        passRule: 'RATIO',
        passThreshold: 0.6,
        rejectRule: 'ANY_VETO',
        tiePolicy: 'ESCALATE',
        conclusionAuthorRule: { type: 'DEPT_WORKNO', deptRef: 'PARENT_DEPT' },
      },
      escalationRules: [
        { triggerType: 'TIE', targetDeptRule: 'DIRECT_PARENT' },
        { triggerType: 'CONCLUSION_TIMEOUT', targetDeptRule: 'DIRECT_PARENT' },
      ],
    },
    { nodeKey: 'end', type: 'END', name: '结束', order: 3 },
  ],
  edges: [
    { from: 'start', to: 'layer1_tech', priority: 0 },
    { from: 'layer1_tech', to: 'layer2_product', priority: 0 },
    { from: 'layer2_product', to: 'end', priority: 0 },
  ],
};

/** 模板 2：项目立项审批（1 层投票 + 任务） */
const PROJECT: SeedTemplate = {
  code: 'PROJECT_INITIATION',
  name: '项目立项审批（单层投票）',
  category: '研发',
  description: '发起部门负责人全体同意后通过，并要求在 3 天内提交立项材料。',
  formSchema: {
    type: 'object',
    required: ['projectName', 'goal', 'duration'],
    properties: {
      projectName: { type: 'string', title: '项目名称', maxLength: 200 },
      goal: { type: 'string', title: '项目目标', maxLength: 1000 },
      duration: { type: 'number', title: '预计工期（天）', minimum: 1 },
      estimatedCost: { type: 'number', title: '预计成本（元）' },
    },
  },
  nodes: [
    { nodeKey: 'start', type: 'START', name: '发起', order: 0 },
    {
      nodeKey: 'layer1_review',
      type: 'VOTE',
      name: '部门负责人评审',
      order: 1,
      layerIndex: 1,
      config: { description: '发起部门负责人全部同意方可通过；无否决规则' },
      voterRules: [{ voterType: 'ROLE', voterValue: { roleCodes: ['DEPT_MANAGER'], scope: 'INITIATOR_DEPT' } }],
      voteRule: {
        passRule: 'ALL',
        rejectRule: 'NONE',
        conclusionAuthorRule: { type: 'DEPT_WORKNO', deptRef: 'INITIATOR_DEPT' },
      },
      taskTemplates: [
        {
          title: '提交立项材料',
          assigneeRule: { type: 'MANUAL', fallbackTo: 'INITIATOR' },
          priority: 'NORMAL',
          dueOffset: 72,
          checklist: ['编写立项说明书', '附资源与成本预算', '提交部门归档'],
          triggerOn: 'PASS',
        },
      ],
      escalationRules: [
        { triggerType: 'TIMEOUT', targetDeptRule: 'DIRECT_PARENT' },
        { triggerType: 'OVER_LIMIT', condition: { gt: ['formData.estimatedCost', 200000] }, targetDeptRule: 'DIRECT_PARENT' },
      ],
    },
    { nodeKey: 'end', type: 'END', name: '结束', order: 2 },
  ],
  edges: [
    { from: 'start', to: 'layer1_review', priority: 0 },
    { from: 'layer1_review', to: 'end', priority: 0 },
  ],
};

export const SEED_TEMPLATES: SeedTemplate[] = [PURCHASE, PROJECT];
