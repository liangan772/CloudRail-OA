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
| 1 | Prisma Schema、共享类型与枚举、种子数据 | `apps/api/prisma/schema.prisma`（44 模型/41 枚举/75 索引）、`packages/shared`（枚举+常量+DSL）、幂等 seed、脚手架、`prisma/migrations/*` | ✅ 已完成：`validate`/`generate`/typecheck 全绿；**migrate + seed 已对宝塔 PostgreSQL 16.3 实跑通过**（init 迁移 + 部分索引迁移；种子 1 租户/3 部门/8 工号成员/9 用户/5 角色/36 权限/2 模板/3 序列） |
| 2 | 后端核心：Auth、Org、Workflow、VoteEngine、NodeStateMachine、RuleEngine、**投票结论（VoteConclusion）** | 可运行的 API + 单测（计票/全员表态/结论/状态机/规则求值） | ✅ **已完成并已对真实库验收**：Auth（JWT + 三级守卫）、Org、Workflow 模板发布与图校验、实例发起与投票人快照、投票/改票、标记缺席、人工结论与层级推进、RuleEngine 条件上报；22 条路由 + Swagger + `/health` `/metrics`；**195 个单测（16 套件）+ 11 个真实库 e2e 全绿**。任务引擎属阶段 3 |
| 3 | 后端扩展：TaskEngine、EscalationEngine（逐级 + 上级投票复用同一 `VoteEngine`）、BullMQ、WebSocket、审计、Outbox | 队列消费者 + 网关 + 审计与发件箱 | ✅ **已完成**：EscalationEngine（目标解析 / 上报状态机 / 建单冻结 / 投递即开投 / 逐级上溯 / 结论回写）、TaskEngine（状态机 + 分配解析 + 15 个接口）、**审计 + Outbox + 派发器**（四点式落库）、**Socket.IO 网关**（房间 `instance:` / `workno:` / `user:` / `dept:`，令牌鉴权）、**BullMQ 定时**（无 Redis 自动退回进程内定时器）；**14 个真实库 e2e 全绿**、248 个单测全绿。遗留项见下表 |

### 阶段 3 的已知遗留（不阻塞主线）

| # | 项 | 说明 |
| --- | --- | --- |
| 1 | 上报平票（TIE）自动上溯 | ✅ 已实现：上级投票平票且策略为上报时，**在同一事务内**上溯一级；命中否决时按「否决优先」处理，不按平票上溯 |
| 2 | 任务依赖的模板声明 | ✅ 已实现：`NodeTaskTemplate.dependsOn`（数字 = 按 order 排序后的位置，字符串 = 标题）→ 建任务即落 `TaskDependency` 并进 `BLOCKED`，前置验收通过后自动解锁回 `PENDING_ACCEPT`。⚠️ 迁移 `20260926054000_task_template_dependencies` **待应用**（链路恢复后 `pnpm --filter @oa/api db:deploy`） |
| 3 | 通知渠道 | 站内通知已打通；邮件 / 短信 / IM 的适配器按计划留到阶段 6 |
| 4 | 审计日志按月分区 | schema 里已是普通表，分区在建库脚本里按计划留到上线前（阶段 6） |
| 5 | WS 的自动化验证 | ✅ 已补：用假 socket/server 单测覆盖令牌鉴权、房间加入（user/dept/workno）与广播语义，不引入 `socket.io-client` |

### 阶段 3 实现时发现的一处文档冲突（已按最高优先级约束实现）

§6.1 的状态转移表里 `VOTING + NODE_PASSED` 一行写的是「创建下一层 `InstanceNode` + 任务」，
而 C1/C3 与总览图明确要求「**任务完成再推动下一层**」。两者不能同时成立，实现按 **C1/C3**：

- 本层通过 → 按 `NodeTaskTemplate`（`triggerOn=PASS`）派任务，流程**挂起**在当前层（不建下一层节点）
- 本层任务**全部** DONE/CANCELLED → 节点置 `DONE` → 才创建下一层节点并开投
- 本层没有任务模板时直接推进（行为与阶段 2 一致）

若后续确认要按 §6.1 的"同时创建"，改动点只有一处：`ConclusionService` 里 `heldByTasks` 的判断。
| 4 | 前端基础：布局、主题、路由、API Client、状态管理、通用组件 | 设计系统 + 应用骨架 + 可登录 | ⏸ 未开始 |
| 5 | 前端业务：工作台、投票中心、流程详情、任务中心、上报中心、流程设计器、统计 | 全部业务页面可交互 | ⏸ 未开始 |
| 6 | 简化部署、联调、测试、文档、验收 | `docker-compose.dev/prod.yml`、启动与备份脚本、联调文档、验收清单 | ⏸ 未开始 |

### 阶段 2 结束时确认的三个口径（2026-09-26）

| # | 决策 | 现状与后续 |
| --- | --- | --- |
| 1 | 流程定局后**停留**在 `APPROVED` / `REJECTED`，不自动归档 | `endedAt` 已写；`CLOSE → CLOSED` 保留给显式动作或归档任务（状态机路径仍在，`allowedInstanceEvents('APPROVED') === ['CLOSE']`） |
| 2 | 命中上报规则时**只把节点标为 `ESCALATED`，实例状态不动** | 命中依据写进 `InstanceNode.result.escalationPending`，并在流程详情里以 `pendingEscalation` 暴露；阶段 3 的 EscalationEngine 建出上报单、写冻结记录后再改实例状态，避免"实例说在上报、却查不到上报单" |
| 3 | 通过后**不落占位任务** | 结论接口返回 `pendingTaskTemplates`（本层待派条数）；任务实体由阶段 3 的 TaskEngine 统一创建，避免产生没有 OWNER / ACCEPTOR 的脏数据 |

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
