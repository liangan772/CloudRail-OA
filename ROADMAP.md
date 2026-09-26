# 层级投票制 OA 系统 · 交付路线图

> 本仓库按「阶段交付 + 阶段汇报 + 用户确认」的方式推进。
> **未经用户回复「继续 / 进入下一阶段」，不得进入下一阶段。**

## 一、最高优先级约束（贯穿全项目）

| 编号 | 约束 | 落地方式（后续阶段的验收点） |
| --- | --- | --- |
| C1 | 不是「单人逐级审批」，而是**按层级组织的多人投票审批** | 每一层 `InstanceNode` 实例化一组投票人；`VoteEngine` 支持 5 种通过规则 + 3 种否决规则 |
| C2 | 每层有独立的**多人投票规则**（含弃权、超时、一票否决） | `NodeVoteRule`：`passRule / rejectRule / abstainPolicy / timeoutPolicy / visibility` |
| C3 | **任务分配贯穿流程**：投票通过 → 触发任务；任务完成 → 推动下一层 | `NodeTaskTemplate` + `TaskEngine`；依赖解锁后自动推进 `NodeStateMachine` |
| C4 | **上报贯穿流程**：投票 / 任务 / 流程满足条件即逐级或越级上报 | `EscalationEngine`：手动 / 超时 / 平票 / 连续驳回 / 金额风险 / 跨部门 / 任务阻塞逾期，共 9 类触发源 |
| C5 | 上级处理后可决定：继续 / 退回 / 终审 / 继续上报 | `Escalation` 结果回写原流程，冻结与解冻语义可配置 |
| C6 | 后端必须是**可运行的真实实现**，不是伪代码 | 真实 Prisma schema + NestJS 模块 + Jest/Supertest 测试 + 可一键启动 |
| C7 | 前端现代化且可交互 | Next.js 14 App Router + shadcn/ui + Recharts + Framer Motion + dnd-kit 看板/甘特 |
| C8 | 部署极简：开发一条命令，生产一台机器 + 一个 compose | dev 只起 postgres+redis；prod 四个服务 + Caddy/rewrites，**不引入 K8s / Nginx / Prometheus** |
| C9 | 所有状态变更走领域服务，禁止直接改库 | 统一 `TransitionGuard + AuditLog + OutboxEvent + WS 广播` 四点式落库 |
| C10 | 分阶段交付，每阶段结束必须汇报并等待确认 | 见下方阶段表与汇报模板 |
| C11 | 投票明细**按部门可见**：投票人只能看到本部门明细，上级部门可看到上报相关的全部明细 | `VoteViewScope=DEPT_ONLY` + 上报链可见性覆盖；跨部门只给聚合计数 |
| C12 | **每个投票人都必须表态**，且每层形成**人工投票结论** | 默认不允许弃权；未全员表态不得进入结论；`PENDING_CONCLUSION` 状态 + `VoteConclusion` 人工结论实体 |
| C13 | **不允许越级上报** | `EscalationEngine` 只支持「直接上级」与「逐级上溯」，跳级能力默认关闭 |
| C14 | 每个部门设置**部门工号**，上报**统一投递到上级部门的工号**（不是投给人） | `Department.workNo` + `DepartmentWorkNoMember`；`Escalation.toWorkNo` 快照；工号成员即该级投票人 |
| C15 | **上报 = 让上级部门再跑一次同样的投票**，结论意见回写原流程 | `Escalation.upwardInstanceNodeId` 复用 `InstanceNode` + `VoteEngine`；上级同样全员表态、人工结论；单人不裁定、不派任务 |
| C16 | **缺席者不算票、也不计入投票池**（分母与权重同步剔除） | `InstanceNodeVoter.status=ABSENT`；`N_pool = N_expected - absent`；「全员表态」与分母都按池内计算；配 `minQuorum` 防用缺席稀释门槛 |

## 二、阶段划分与交付物

| 阶段 | 名称 | 主要交付物 | 状态 |
| --- | --- | --- | --- |
| 0 | 需求澄清、信息架构、技术选型、数据模型草案 | `ROADMAP.md`、`docs/stage-0/*`（含 Q1–Q27 冻结基线） | ✅ 已完成，等待「进入阶段 1」指令 |
| 1 | Prisma Schema、共享类型与枚举、种子数据 | `apps/api/prisma/schema.prisma`、`packages/shared`、`prisma/seed.ts`、monorepo 脚手架 | ⏸ 未开始 |
| 2 | 后端核心：Auth、Org、Workflow、VoteEngine、NodeStateMachine、RuleEngine、**投票结论（VoteConclusion）** | 可运行的 API + 单测（计票/全员表态/结论/状态机/规则求值） | ⏸ 未开始 |
| 3 | 后端扩展：TaskEngine、EscalationEngine（逐级 + 上级投票复用同一 `VoteEngine`）、BullMQ、WebSocket、审计、Outbox | 队列消费者 + 网关 + 审计与发件箱 | ⏸ 未开始 |
| 4 | 前端基础：布局、主题、路由、API Client、状态管理、通用组件 | 设计系统 + 应用骨架 + 可登录 | ⏸ 未开始 |
| 5 | 前端业务：工作台、投票中心、流程详情、任务中心、上报中心、流程设计器、统计 | 全部业务页面可交互 | ⏸ 未开始 |
| 6 | 简化部署、联调、测试、文档、验收 | `docker-compose.dev/prod.yml`、启动与备份脚本、联调文档、验收清单 | ⏸ 未开始 |

对应用户要求的 14 项输出物的映射：

| 输出要求 | 归属阶段 |
| --- | --- |
| 1 目录结构（monorepo） | 阶段 0 提案 → 阶段 1 落地 |
| 2 Prisma schema | 阶段 1 |
| 3 共享类型与枚举 | 阶段 1 |
| 4 NestJS 模块划分与 DI 设计 | 阶段 0 提案 → 阶段 2 落地 |
| 5 核心服务（VoteEngine / NodeStateMachine / TaskEngine / EscalationEngine / RuleEngine） | 阶段 2：VoteEngine、NodeStateMachine、RuleEngine；阶段 3：TaskEngine、EscalationEngine |
| 6 Controller 与 DTO（Swagger） | 阶段 2 / 阶段 3 |
| 7 WebSocket Gateway 与事件 | 阶段 3 |
| 8 BullMQ 队列与定时任务 | 阶段 3 |
| 9 权限守卫与数据范围过滤 | 阶段 2 |
| 10 审计日志与 Outbox | 阶段 3 |
| 11 Docker Compose（dev + prod）与启动脚本 | 阶段 6 |
| 12 种子数据脚本 | 阶段 1 |
| 13 前后端联调说明与 API 示例 | 阶段 6 |
| 14 如何扩展（新投票规则 / 上报策略 / 分配算法） | 阶段 6 |

## 三、阶段汇报模板（每个阶段结束时必须输出）

```markdown
## 阶段 X 完成汇报
- 阶段名称：
- 状态：已完成 / 部分完成 / 阻塞
- 本阶段交付物：
  - 文件/模块清单：
  - 关键代码路径：
- 核心实现说明：
- 测试/验证结果：
- 关键决策与原因：
- 遇到的问题与解决：
- 遗留问题与风险：
- 下一阶段计划：
- 需要用户确认/决策的事项：
- 预计下一阶段 token 与工作量：
```

汇报后必须给出下一步动作选项：

- **A**：继续下一阶段
- **B**：修改当前阶段某模块
- **C**：调整架构或数据模型
- **D**：暂停并等待指示

## 四、环境基线（已探测）

| 项 | 探测结果 | 说明 |
| --- | --- | --- |
| 工作目录 | `C:\Users\liangan\Documents\ChatGPT\OA` | 空 Git 仓库（无 commit），无任何脚手架 |
| Node.js | v24.12.0 | 高于 LTS 目标（20.x / 22.x），需在阶段 1 用 `.nvmrc` + `engines` 锁定 |
| npm | 11.6.2 | 可用 |
| corepack | 0.34.5 | 可用（`corepack enable pnpm` 即可提供 pnpm） |
| pnpm | 未安装且沙箱内调用报错 | 见 `docs/stage-0/03-tech-stack.md` §5 风险 R3 |
| Docker | 未安装 | 阶段 6 才需要；本机联调可先用本地 postgres/redis 或请用户安装 Docker Desktop |
