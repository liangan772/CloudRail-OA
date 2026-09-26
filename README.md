# CloudRail OA

现代化 OA 系统：**按层级组织的多人投票审批 + 任务分配协作 + 上报到上级部门**。

不是传统的「单人逐级审批」——审批被拆成若干层，每层由一组人同时投票，按可配置规则计票；每层通过后派发任务协同执行，任务完成再推动下一层；任何环节搞不定都按组织结构上报到上级部门。

## 当前进度

| 阶段 | 名称 | 状态 |
| --- | --- | --- |
| 0 | 需求澄清、信息架构、技术选型、数据模型草案 | ✅ 已完成 |
| 1 | Prisma Schema、共享类型与枚举、种子数据 | ✅ 已完成（迁移与种子已在宝塔 PostgreSQL 16.3 实跑通过） |
| 2 | 后端核心：Auth / Org / Workflow / VoteEngine / NodeStateMachine / RuleEngine | ✅ 已完成（22 条路由，189 个单测全绿；待真实库 e2e） |
| 3 | 后端扩展：TaskEngine / EscalationEngine / BullMQ / WebSocket / 审计 / Outbox | ⏸ 待开始 |
| 4 | 前端基础：布局、主题、路由、API Client、状态管理、通用组件 | ⏸ 待开始 |
| 5 | 前端业务：工作台、投票中心、流程详情、任务中心、上报中心、流程设计器、统计 | ⏸ 待开始 |
| 6 | 简化部署、联调、测试、文档、验收 | ⏸ 待开始 |

完整计划与验收标准见 [ROADMAP.md](./ROADMAP.md)。

## 核心机制

```
发起 → [第 1 层：N 人投票] --通过--> [任务群：分配/协作/验收] --完成--> [第 2 层：M 人投票]
                                                    |                              |
                                                    | 任务阻塞/逾期                  | 平票/驳回/超限
                                                    v                              v
                                              [上报到上级部门] <--------------------+
                                                    |
                                    上级：受理 / 退回 / 补充 / 上级投票 / 派任务 / 再上报 / 终审
                                                    |
                                              结果回写原流程（继续 / 退回 / 终审 / 关闭）
```

三层引擎各司其职：

| 引擎 | 回答的问题 |
| --- | --- |
| `VoteEngine` | 这一层谁同意才算通过？（5 种通过规则 × 3 种否决规则 × 4 种弃权策略 × 4 种超时策略） |
| `TaskEngine` | 通过之后谁做什么？（分配、依赖、协作、验收、逾期） |
| `EscalationEngine` | 搞不定往上交给谁，交上去之后怎么处理、怎么回写？ |

## 技术栈

Next.js 14（App Router）+ TypeScript + Tailwind + shadcn/ui + Recharts · NestJS + Prisma + PostgreSQL 16 · Redis + BullMQ · Socket.IO · pnpm workspace + Turborepo（`packages/shared` 前后端共用类型与规则 DSL）。

部署目标：开发一条命令（`pnpm setup && pnpm dev`），生产一台机器 + 一个 compose 文件（`web + api + postgres + redis`），**不引入 K8s / Nginx / Prometheus**。

## 文档

| 文档 | 内容 |
| --- | --- |
| [ROADMAP.md](./ROADMAP.md) | 最高优先级约束、阶段计划、输出物映射、阶段汇报模板 |
| [docs/stage-0/](./docs/stage-0/) | 阶段 0 全部设计文档（需求 / 信息架构 / 技术选型 / 领域模型与状态机） |

## 交付方式

项目按阶段交付，**每阶段结束汇报并等待确认后才进入下一阶段**。

```
git clone https://github.com/liangan772/CloudRail-OA.git
```
