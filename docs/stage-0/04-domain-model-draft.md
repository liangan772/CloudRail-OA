# 04 · 领域模型与状态机草案

> 定位：这是**设计草案**，用于评审数据边界与规则语义；阶段 1 会据此产出可执行的 `schema.prisma`。
> 用户已给出的实体全部保留，本文件在其上做**精化**（字段补充、约束补充、缺失实体增补）并给出**形式化定义**。

## 1. 术语表（全项目统一口径）

| 术语 | 英文/代码 | 定义 |
| --- | --- | --- |
| 模板 | `WorkflowTemplate` | 一类审批的蓝图，可有多版本 |
| 模板版本 | `WorkflowVersion` | 一次发布后的不可变快照；实例永远绑定具体版本 |
| 流程节点 | `WorkflowNode` | 版本内的一个环节，类型：`START/VOTE/TASK/ESCALATION/CONDITION/END` |
| **层** | `Layer` | 由 `VOTE` 节点 + 其后的 `TASK` 节点构成的逻辑单元；「一层多人投票」中的「层」即此 |
| 投票人规则 | `NodeVoterRule` | 如何解析出这一层的投票人（`USER/ROLE/DEPARTMENT/VOTE_GROUP/DYNAMIC`） |
| 投票规则 | `NodeVoteRule` | 如何计票与判定（通过/否决/弃权/超时/可见性） |
| 流程实例 | `WorkflowInstance` | 一次真实发起；`formData` 为 JSONB |
| 实例节点 | `InstanceNode` | 实例在某一层的运行态；承载 deadline/result |
| 实例投票人 | `InstanceNodeVoter` | **发起时快照**下来的投票人及其权重、来源原因 |
| 票 | `Vote` | 一条不可篡改的投票记录（改票为新增 + 标记替换） |
| 计票快照 | `VoteResult` | 该层结论的不可变记录，含计数、加权分、规则快照 |
| 任务 | `Task` | 投票通过后要执行的协作单元，可嵌套子任务 |
| 上报 | `Escalation` | 把决策权上交上级部门，并**在上级部门再跑一次同样的投票流程**，最终意见回写原流程；带完整链路 `EscalationChain` |
| 投票结论 | `VoteConclusion` | 本层**全员表态后由指定人填写的人工结论**；可确认或改判系统自动判定 |
| 可见范围 | `VoteViewScope` | 投票明细的可见边界：默认仅本部门，上报链上的上级部门可见全部 |
| 表态 | `stated` | 投票人已提交明确选择（同意/反对）；未表态不算投票，且**不允许弃权** |
| 部门工号 | `Department.workNo` | 部门级统一处理入口：上报**统一投递到上级部门的工号**；工号成员即该级的投票人（不是裁定人） |
| 投票池 | `votingPool` | 真正参与计票的人：`N_pool = N_expected − 缺席人数`。全员表态、分母、权重总和都按池内计算 |
| 缺席 | `ABSENT` | 请假/出差等无法表态且无委托的人：**不算票、不计入投票池**，既不触发催办也不算未表态 |
| 有效票 | `denominator` | 参与通过率计算的分母，取决于 `abstainPolicy` |
| 否决优先 | veto-priority | 判定顺序：否决规则命中即驳回，不再看通过规则 |

## 2. 聚合边界（一致性与事务单位）

| 聚合根 | 包含实体 | 事务内必须一起写 | 并发控制 |
| --- | --- | --- | --- |
| WorkflowVersion | WorkflowNode / WorkflowEdge / NodeVoterRule / NodeVoteRule / NodeTaskTemplate / NodeEscalationRule | 发布时整版本原子写入，发布后**不可变** | 发布用 `LockService` + 版本号乐观锁 |
| WorkflowInstance | InstanceNode / InstanceNodeVoter / Vote / VoteResult | 投票 → 计票 → 节点状态 → 实例状态 → 创建任务/上报 → Outbox | `LockService.withLock('instance:{id}')` |
| Task | TaskAssignee / TaskDependency / TaskChecklist / TaskLog | 状态变更 + 日志 + Outbox | 行级锁 + 状态条件更新（`WHERE status = expected`） |
| Escalation | EscalationChain / EscalationRecord | 上报状态 + 链路级更新 + 回写原流程 + Outbox | 同一把实例锁（跨聚合时按 instance 串行） |
| Org | Department / UserDepartment | 部门移动需重算子树 `path` | 移动时锁租户组织 |
| Rbac | Role / Permission / RolePermission / UserRole | 权限变更 + 缓存失效 | 缓存双删 + 版本号 |

跨聚合一致性：**同实例的 Vote / Task / Escalation 共用实例级分布式锁**，保证「一层只有一个推进者」。

## 3. ER 总览

```
Tenant ─┬─ User ─┬─ UserDepartment ── Department(自引用 parentId, 物化路径 path, 部门工号 workNo)
        │        │                        └─ DepartmentWorkNoMember(部门工号操盘人)
        │        ├─ UserRole ── Role ── RolePermission ── Permission
        │        └─ Notification / AuditLog
        ├─ WorkflowTemplate ── WorkflowVersion ─┬─ WorkflowNode ─┬─ NodeVoterRule
        │                                       │                ├─ NodeVoteRule
        │                                       │                ├─ NodeTaskTemplate
        │                                       │                └─ NodeEscalationRule
        │                                       └─ WorkflowEdge
        └─ WorkflowInstance ─┬─ InstanceNode ─┬─ InstanceNodeVoter ── Vote
                             │                └─ VoteResult
                             ├─ Task ─┬─ TaskAssignee ── User
                             │        ├─ TaskDependency(自引用)
                             │        ├─ TaskChecklist
                             │        └─ TaskLog
                             └─ Escalation ─┬─ EscalationChain
                                            ├─ EscalationRecord
                                            └─ (fromDeptId / toDeptId → Department)

通用挂载（多态）：Comment / Attachment / AuditLog 通过 (targetType, targetId) 关联任意实体
平台：OutboxEvent、HolidayCalendar、Delegation、(建议) InstanceSuspension
```

## 4. 实体清单（含关键字段、约束、索引）

> 字段前的 `*` 表示除用户给定字段外**本次建议增补**的字段。所有表含 `createdAt / updatedAt`；所有业务表含 `tenantId`。

### 4.1 组织与权限

| 实体 | 关键字段 | 约束与索引 |
| --- | --- | --- |
| `Tenant` | `id, name, code, status` | `code` 唯一 |
| `User` | `id, tenantId, name, email, phone, avatar, status, passwordHash, *lastLoginAt, *failedLoginCount, *lockedUntil` | `(tenantId, email)` 唯一；`(tenantId, phone)` 唯一 |
| `Department` | `id, tenantId, name, parentId, path, level, managerId, *code, *sort, *status, *workNo`（部门工号） | `(tenantId, parentId)` 索引；`(tenantId, path)` 前缀索引（`text_pattern_ops`）；`(tenantId, code)` 唯一；**`(tenantId, workNo)` 唯一** |
| `UserDepartment` | `userId, departmentId, isPrimary, *isLeader, *title` | `(userId, departmentId)` 唯一；`(departmentId, isLeader)` 索引 |
| `Role` | `id, tenantId, name, code, *isSystem, *dataScopeDefault` | `(tenantId, code)` 唯一 |
| `Permission` | `id, code, name, type, *module` | `code` 唯一 |
| `RolePermission` | `roleId, permissionId` | 复合主键 |
| `DepartmentWorkNoMember` | `id, tenantId, departmentId, userId, *isPrimary, *receiveNotify, *status`（部门工号的操盘人） | 唯一 `(departmentId, userId)`；`(userId)` 索引（查"我的工号待办"） |
| `UserRole` | `userId, roleId, scopeType, scopeId` | 唯一 `(userId, roleId, scopeType, scopeId)`；`(scopeType, scopeId)` 索引 |

### 4.2 流程模板（发布后不可变）

| 实体 | 关键字段 | 约束与索引 |
| --- | --- | --- |
| `WorkflowTemplate` | `id, tenantId, name, category, status, currentVersionId, *code, *description, *icon, *formSchema(JSONB)` | `(tenantId, code)` 唯一；`(tenantId, status)` 索引 |
| `WorkflowVersion` | `id, templateId, version, config(JSONB), publishedAt, *publishedBy, *changelog, *isLocked` | 唯一 `(templateId, version)` |
| `WorkflowNode` | `id, versionId, type, name, order, config(JSONB), *layerIndex, *nodeKey` | `(versionId, order)` 索引；唯一 `(versionId, nodeKey)` |
| `WorkflowEdge` | `id, versionId, fromNodeId, toNodeId, condition(JSONB), *priority, *label` | `(versionId, fromNodeId)` 索引 |
| `NodeVoterRule` | `id, nodeId, voterType, voterValue(JSONB), weight, *isRequired, *order` | `(nodeId)` 索引；voterValue 结构见 §7 |
| `NodeVoteRule` | `id, nodeId, passRule, passThreshold, rejectRule, rejectThreshold, abstainPolicy, timeoutPolicy, visibility, *viewScope(默认 DEPT_ONLY), *timeoutHours, *allowAbstain(恒 false), *requireAllVote(默认 true), *revotePolicy(默认 UNLIMITED_BEFORE_CONCLUSION), *vetoTerminates(默认 false), *tiePolicy(默认 ESCALATE), *conclusionMode(默认 MANUAL_CONFIRM), *conclusionAuthorRule(JSONB), *remindIntervalHours, *maxRemindRounds, *quorumPolicy(默认 MIN_POOL_RATIO), *minQuorum(默认 0.6), *allowMarkAbsent(默认 true)` | `nodeId` 唯一（1:1） |
| `NodeTaskTemplate` | `id, nodeId, title, assigneeRule(JSONB), priority, dueOffset, checklist(JSONB), *acceptanceRule(JSONB), *triggerOn(PASS/ALWAYS)` | `(nodeId, order)` 索引 |
| `NodeEscalationRule` | `id, nodeId, triggerType, condition(JSONB), targetDeptRule(JSONB), timeout, autoApprove, *freezeSource, *maxLevel, *skipLevels` | `(nodeId, triggerType)` 索引 |

### 4.3 流程实例与投票

| 实体 | 关键字段 | 约束与索引 |
| --- | --- | --- |
| `WorkflowInstance` | `id, tenantId, templateVersionId, initiatorId, title, formData(JSONB), status, currentNodeId, startedAt, endedAt, *code, *layerIndex, *suspendedFrom, *priority, *summary` | **组合索引 `(tenantId, status, startedAt)`**；唯一 `(tenantId, code)` |
| `InstanceNode` | `id, instanceId, nodeId, type, status, startedAt, endedAt, deadline, result(JSONB), *layerIndex, *round, *escalationId, *conclusionStatus, *conclusionDeadline` | 唯一 `(instanceId, nodeId, round)`；**`(tenantId, status, deadline)`**（超时扫描核心索引） |
| `InstanceNodeVoter` | `id, instanceNodeId, userId, weight, status, votedAt, *sourceRuleId, *sourceReason, *delegateFromUserId, *remindedAt, *remindCount, *absentAt, *absentById, *absentReason, *absentSource, *excludedWeight` | **唯一 `(instanceNodeId, userId)`**；`(instanceNodeId, status)` 索引。`status=ABSENT` 时该行被排除出投票池，`excludedWeight` 记录被剔除的权重以便审计与复算 |
| `Vote` | `id, instanceNodeId, voterId, decision, comment, weight, createdAt, *revoteSeq, *isReplaced, *replacedById, *delegateFromUserId, *ip, *ua` | 唯一 `(instanceNodeId, voterId, revoteSeq)`；`(instanceNodeId, isReplaced)` 索引。**只 INSERT，不 UPDATE/DELETE**（改票 = 新行 + 旧行 `isReplaced=true`） |
| `VoteResult` | `id, instanceNodeId, approveCount, rejectCount, abstainCount, weightedScore, passed, snapshot(JSONB), *ruleSnapshot(JSONB), *denominator, *tieResolvedBy, *decidedBy, *decidedAt` | `instanceNodeId` 唯一 |
| `VoteConclusion` | `id, tenantId, instanceNodeId, authorId, decision(APPROVE/REJECT), systemDecision, isOverride, content, attachments(JSONB), createdAt, *overrideReason, *round` | 唯一 `(instanceNodeId, round)`；`(authorId, createdAt)` 索引。**提交后不可修改**（如需重填走新一轮 `round`） |

### 4.4 任务

| 实体 | 关键字段 | 约束与索引 |
| --- | --- | --- |
| `Task` | `id, tenantId, instanceId, instanceNodeId, parentTaskId, title, description, status, priority, creatorId, dueAt, startedAt, completedAt, *code, *blockedReason, *progress, *overdueNotifiedAt, *sourceEscalationId` | `(tenantId, status, dueAt)`、`(instanceId)`；待我处理见下方派生索引 |
| `TaskAssignee` | `id, taskId, userId, role, weight, *assignedAt, *assignedBy, *isActive` | 唯一 `(taskId, userId, role)`；**约束：每任务恰好一个 `OWNER`、恰好一个 `ACCEPTOR`（服务层 + 部分唯一索引保证）** |
| `TaskDependency` | `id, taskId, dependsOnTaskId, type` | 唯一 `(taskId, dependsOnTaskId)`；`(dependsOnTaskId)` 索引（反查解锁） |
| `TaskChecklist` | `id, taskId, content, done, order` | `(taskId, order)` |
| `TaskLog` | `id, taskId, actorId, action, fromStatus, toStatus, payload(JSONB), createdAt` | `(taskId, createdAt)` 索引 |

为支撑「待我处理任务」查询，增补派生查询索引：`TaskAssignee(userId, isActive)` 上建 `INCLUDE (taskId)`，或维护物化视图 `mv_my_tasks`。

### 4.5 上报

| 实体 | 关键字段 | 约束与索引 |
| --- | --- | --- |
| `Escalation` | `id, tenantId, sourceType, sourceId, instanceId, taskId, fromDeptId, toDeptId, reason, status, requestedBy, handledBy, handledAt, result, comment, *code, *level, *triggerType, *targetRule, *deadline, *frozenInstanceStatus, *maxLevel, *fromWorkNo, *toWorkNo（目标工号快照）, *upwardInstanceNodeId（上级投票节点）, *finalOpinion（最终意见正文）, *writeBackAction, *voteRound` | **`(toWorkNo, status)`**（工号待办主查询）、`(toDeptId, status)`、`(instanceId)`、`(tenantId, status, createdAt)` |
| `EscalationChain` | `id, escalationId, level, deptId, handlerId, status, handledAt, *enteredAt, *actionType, *comment, *deadline, *workNo, *instanceNodeId（该级投票节点）` | 唯一 `(escalationId, level)`；`(workNo, status)` 索引 |
| `EscalationRecord` | `id, escalationId, actorId, action, comment, attachments(JSONB), createdAt, *fromStatus, *toStatus` | `(escalationId, createdAt)` |

**目标投递解析（用户已确认：不允许越级 + 统一上报到上级工号）**：

1. `toDeptId` 只能取 `Department.parentId`（直接上级）或沿 `Department.path` **逐级上溯一级**（每级单独成链，不允许一次跳多级）。
2. 投递对象不是人，而是**上级部门的工号**：`toWorkNo = 上级部门.workNo`（写入 `Escalation.toWorkNo` 作快照，事后改工号不影响历史）。
3. 通知发给该工号的**全部成员**（`DepartmentWorkNoMember.receiveNotify=true`）。**工号成员不是"裁定人"，而是这一级的投票人**：默认 `acceptMode=AUTO`，投递后立即按上级投票规则开投；也可配 `GRAB`，由任一成员先签收再开投。
4. **这一级的结论由投票产生**（多数/比例/否决规则 + 全员表态 + 人工结论），没有任何单人可以直接裁定；`handledBy` 只记录"签收人/结论填写人"，不代表其一人决定。
5. 上级部门未配置工号时按兜底策略 `onMissingWorkNo`：`ESCALATE_UP`（继续上溯一级找有工号的部门，默认）/ `NOTIFY_ADMIN`（通知租户管理员）/ `BLOCK`（阻断并报错）。
6. `SKIP_TO_LEVEL` / 指定非直接上级部门仅在租户开关 `allowCrossLevel=true` 时可用，且需 `ESC_CROSS_LEVEL` 权限 + 理由必填。

### 4.6 通用与平台

| 实体 | 关键字段 | 约束与索引 |
| --- | --- | --- |
| `Comment` | `id, tenantId, targetType, targetId, authorId, content, parentId, *mentions(JSONB)` | `(targetType, targetId, createdAt)` |
| `Attachment` | `id, tenantId, targetType, targetId, fileName, fileKey, size, mime, uploaderId, *storageDriver, *checksum, *status` | `(targetType, targetId)`；`fileKey` 唯一 |
| `Notification` | `id, tenantId, userId, type, title, content, link, read, createdAt, *level, *payload(JSONB), *readAt, *channel` | `(userId, read, createdAt)` 索引 |
| `AuditLog` | `id, tenantId, actorId, action, targetType, targetId, before(JSONB), after(JSONB), ip, ua, createdAt, *traceId, *result` | **`(tenantId, targetType, targetId, createdAt)`**、`(tenantId, actorId, createdAt)`；按月分区 |
| `OutboxEvent` | `id, tenantId, eventType, payload(JSONB), status, retries, *aggregateType, *aggregateId, *sequence, *availableAt, *lockedAt, *lastError, *processedAt` | `(status, availableAt)` 索引（调度取件）；`(aggregateType, aggregateId, sequence)` 保序 |

### 4.7 建议新增实体（用户清单未含）

| 实体 | 为什么需要 | 关键字段 |
| --- | --- | --- |
| `HolidayCalendar` | `dueOffset` 若按工作日计算必须有节假日数据，否则「3 个工作日」会算到周末 | `id, tenantId, date, name, type(HOLIDAY/WORKDAY), year` + 唯一 `(tenantId, date)` |
| `Delegation` | 投票人请假/出差时把投票权委托他人（澄清项 Q8） | `id, tenantId, fromUserId, toUserId, startAt, endAt, scopeType, scopeId, reason, status` |
| `InstanceSuspension` | 上报冻结期间需要记住「冻结前的状态」以便精确恢复 | `id, instanceId, escalationId, frozenStatus, frozenNodeId, suspendedAt, resumedAt, resumeAction` |
| `VoteGroup` | `NodeVoterRule.voterType = VOTE_GROUP` 需要可复用的「投票组」定义（如「技术委员会」） | `id, tenantId, name, code` + `VoteGroupMember(groupId, userId, weight)` |
| `NumberSequence` | 实例号/任务号/上报号需按租户按年月递增且不重复 | `id, tenantId, type, period, nextValue` + 唯一 `(tenantId, type, period)` |
| `IdempotencyKey` | 队列消费与客户端重试去重 | `id, tenantId, scope, key, responseHash, createdAt` + 唯一 `(tenantId, scope, key)` |
| `WebhookSubscription` | 对外通知/集成（企微/钉钉/飞书/自定义） | `id, tenantId, eventTypes, url, secret, enabled, failureCount` |
| `Absence` | 提前登记的请假/出差区间，节点开启时自动把命中区间的人标为 `ABSENT`（避免每次人工标记） | `id, tenantId, userId, startAt, endAt, reason, source(MANUAL/LEAVE_SYNC), createdBy` + `(tenantId, userId, startAt, endAt)` 索引 |

## 5. 枚举清单（`packages/shared/src/enums`）

| 域名 | 枚举 | 取值 |
| --- | --- | --- |
| 流程 | `WorkflowNodeType` | `START, VOTE, TASK, ESCALATION, CONDITION, END` |
| 流程 | `InstanceStatus` | `DRAFT, VOTING, APPROVED, REJECTED, ESCALATED, SUSPENDED, CLOSED` |
| 流程 | `InstanceNodeStatus` | `PENDING, VOTING, PENDING_CONCLUSION, PASSED, REJECTED, TIMEOUT, ESCALATED, SKIPPED, DONE` |
| 模板 | `TemplateStatus` | `DRAFT, PUBLISHED, ARCHIVED` |
| 投票 | `VoterType` | `USER, ROLE, DEPARTMENT, VOTE_GROUP, DYNAMIC` |
| 投票 | `PassRule` | `ALL, MAJORITY, RATIO, WEIGHTED, AT_LEAST_N` |
| 投票 | `RejectRule` | `ANY_VETO, OPPOSE_OVER, NONE` |
| 投票 | `AbstainPolicy` | `COUNT_IN_DENOMINATOR, EXCLUDE_FROM_DENOMINATOR, AS_APPROVE, AS_REJECT` |
| 投票 | `TimeoutPolicy` | `REMIND_ONLY`（默认）、`AUTO_REJECT`、`ESCALATE`、`AUTO_APPROVE`（**默认禁用**，需租户开关 `allowAutoApprove`） |
| 投票 | `VoteVisibility` | `PUBLIC, RESULT_ONLY, ANONYMOUS`（记名方式） |
| 投票 | `VoteViewScope` | `DEPT_ONLY`（**默认**）、`TENANT`；上报链上级部门由可见性覆盖规则放行，不依赖此值 |
| 投票 | `VoteDecision` | `APPROVE, REJECT`；`ABSTAIN` 已按用户确认**移除**（不能弃权），枚举仅保留用于历史数据兼容 |
| 投票 | `RevotePolicy` | `NOT_ALLOWED, ONCE, UNLIMITED_BEFORE_CONCLUSION`（**默认**） |
| 投票 | `ConclusionMode` | `AUTO, MANUAL_CONFIRM`（**默认**）、`MANUAL_OVERRIDE` |
| 投票 | `ConclusionDecision` | `APPROVE, REJECT` |
| 投票 | `ConclusionStatus` | `NOT_REQUIRED, PENDING, SUBMITTED, TIMEOUT` |
| 投票 | `TiePolicy` | `ESCALATE`（**已确认：报上级组织裁定**）、`REJECT`、`CHAIRMAN_VOTE` |
| 投票 | `VoterStatus` | `PENDING, VOTED, TIMEOUT, DELEGATED, SKIPPED, ABSENT`（缺席者被排除出投票池） |
| 投票 | `AbsenceSource` | `MANUAL`（人工标记）、`LEAVE_SYNC`（请假数据自动命中）、`DECLARED`（本人声明） |
| 投票 | `QuorumPolicy` | `NONE`、`MIN_POOL_RATIO`（**默认：池内人数 ≥ 应投票人数 × `minQuorum`，默认 0.6**）、`MIN_POOL_N` |
| 通用 | `DeadlineMode` | `CALENDAR_DAY`（**已确认：自然日**）、`WORKING_DAY`（保留，需节假日数据） |
| 组织 | `WorkNoMissingPolicy` | `ESCALATE_UP`（默认）、`NOTIFY_ADMIN`、`BLOCK` |
| 上报 | `EscalationAcceptMode` | `AUTO`（**默认：投递即开投，无需签收**）、`GRAB`（任一工号成员签收后开投）、`ASSIGNED` |
| 任务 | `TaskStatus` | `PENDING_ASSIGN, PENDING_ACCEPT, IN_PROGRESS, PENDING_ACCEPTANCE, DONE, OVERDUE, CANCELLED, BLOCKED, ESCALATED` |
| 任务 | `TaskPriority` | `LOW, NORMAL, HIGH, URGENT` |
| 任务 | `TaskAssigneeRole` | `OWNER, COLLABORATOR, WATCHER, ACCEPTOR` |
| 任务 | `AssigneeRuleType` | `MANUAL, ROLE, DEPARTMENT, VOTE_GROUP, LOAD_BALANCE, GRAB` |
| 任务 | `TaskDependencyType` | `FINISH_TO_START, START_TO_START` |
| 上报 | `EscalationSourceType` | `VOTE, TASK, INSTANCE, MANUAL` |
| 上报 | `EscalationStatus` | `PENDING, SUBMITTED, SIGNED, VOTING, PENDING_CONCLUSION, ADOPTED, RETURNED, UPGRADED, CLOSED`（已移除 `TASKING`/`ACCEPTED`：上级不再单独派任务，也不再由单人裁定） |
| 上报 | `EscalationTrigger` | `MANUAL, TIMEOUT, TIE, REPEATED_REJECT, OVER_LIMIT, CROSS_DEPT_DISPUTE, INSUFFICIENT_PERMISSION, TASK_BLOCKED, TASK_OVERDUE` |
| 上报 | `TargetDeptRule` | `DIRECT_PARENT`（默认）、`LEVEL_UP`；`SKIP_TO_LEVEL` / `SPECIFIC_DEPT` **已移除默认能力**，需租户开关 `allowCrossLevel=true` 才启用（用户已确认不允许越级） |
| 上报 | `EscalationAction` | `SIGN, START_VOTE, CAST_VOTE, SUBMIT_CONCLUSION, CONTINUE, RETURN, REQUEST_MORE, UPGRADE, FINAL_APPROVE, FINAL_REJECT, CLOSE` |
| 上报 | `EscalationResult` | `CONTINUE, RETURN, REQUEST_MORE, FINAL_APPROVE, FINAL_REJECT, CLOSE` |
| 上报 | `WriteBackAction` | `CONTINUE`（解冻继续，按需派任务）、`RETURN`（退回原部门重走本层）、`REQUEST_MORE`（生成补充材料任务）、`FINAL_APPROVE`、`FINAL_REJECT` |
| 权限 | `ScopeType` | `SELF, DEPT, DEPT_AND_SUB, DEPT_LIST, TENANT` |
| 权限 | `PermissionType` | `MENU, ACTION, DATA` |
| 通用 | `NotificationType` | `VOTE_PENDING, VOTE_RESULT, TASK_ASSIGNED, TASK_OVERDUE, ESCALATION_CREATED, ESCALATION_HANDLED, INSTANCE_FINISHED, SYSTEM` |
| 通用 | `OutboxStatus` | `PENDING, PROCESSING, SENT, FAILED, DEAD` |

配套：每个枚举同时导出 `LABEL_ZH`（中文标签）与 `STATUS_TONE`（语义色），前后端共用（见 02 文档 §4.1）。

## 6. 状态机设计

**统一规则**：所有状态变更必须 ① 走领域服务；② 写 `AuditLog`（before/after）；③ 发 `OutboxEvent`；④ 广播 WebSocket。禁止 `prisma.xxx.update({ status })` 直改。

### 6.1 流程实例 `WorkflowInstance`

```
DRAFT ──submit──▶ VOTING
VOTING ──lastLayerPassed──▶ APPROVED ──close──▶ CLOSED
VOTING ──rejected──▶ REJECTED ──close──▶ CLOSED
VOTING ──escalate──▶ ESCALATED ──resume──▶ VOTING
ESCALATED ──finalDecide(approve)──▶ APPROVED
ESCALATED ──finalDecide(reject)──▶ REJECTED
ESCALATED ──returned──▶ VOTING | REJECTED   （按退回深度决定）
VOTING|ESCALATED ──suspend──▶ SUSPENDED ──resume──▶ 冻结前状态
VOTING ──withdraw──▶ CLOSED（发起人撤回，需权限与状态校验）
```

| 当前状态 | 事件 | 守卫条件 | 下一状态 | 副作用（Actions） |
| --- | --- | --- | --- | --- |
| DRAFT | `SUBMIT` | 模板版本已发布；表单通过 schema 校验；发起人有 `INSTANCE_CREATE` | VOTING | 创建首层 `InstanceNode`；快照投票人；算 deadline；投递 `vote.timeout`；通知 + WS |
| VOTING | `NODE_PASSED` | 存在下一层 | VOTING | 创建下一层 `InstanceNode` + 任务；通知 |
| VOTING | `NODE_PASSED` | 已是最后一层 | APPROVED | 置 `endedAt`；通知发起人；触发归档 Outbox |
| VOTING | `NODE_REJECTED` | `rejectRule` 命中且 `NodeEscalationRule` 未命中「驳回即上报」 | REJECTED | 置 `endedAt`；通知发起人与同层 |
| VOTING | `ESCALATE` | `EscalationEngine` 触发命中 | ESCALATED | 创建 `Escalation`；写 `InstanceSuspension`；冻结任务（可选）；通知目标部门 |
| ESCALATED | `RESUME` | 上级结论 = `CONTINUE` | VOTING | 解冻；恢复 `currentNodeId`；重算 deadline |
| ESCALATED | `FINAL_APPROVE` / `FINAL_REJECT` | 上级选择终审 | APPROVED / REJECTED | 记录 `decidedBy`；通知全链路 |
| ESCALATED | `RETURN` | 上级退回原部门 | VOTING 或 REJECTED | 按 `returnDepth` 决定回到某层还是直接驳回 |
| APPROVED / REJECTED | `CLOSE` | — | CLOSED | 归档、统计入账 |
| VOTING / ESCALATED | `SUSPEND` | 有权操作 | SUSPENDED | 冻结计时；记录 `suspendedFrom` |
| SUSPENDED | `RESUME` | — | `suspendedFrom` | 恢复计时；重算剩余时间 |
| VOTING | `WITHDRAW` | 发起人本人；无已生效投票结论 | CLOSED | 作废未投票节点；通知 |

### 6.2 层级节点 `InstanceNode`

```
PENDING ──open──▶ VOTING ──全员表态+计票──▶ PENDING_CONCLUSION ──提交人工结论──▶ PASSED ──▶ DONE
                     │                                                        └─REJECTED──▶ DONE
                     │（否决票：只锁定"不予通过"，仍等全员表态）
                     ├──deadline──▶ TIMEOUT ─┬─ 应用 timeoutPolicy ─▶ PENDING_CONCLUSION（系统拟判定）
                     │                        ├─ ESCALATE ─▶ ESCALATED
                     │                        └─ REMIND_ONLY ─▶ VOTING（重设 deadline，最多 maxRemindRounds 轮）
                     ├──escalation──▶ ESCALATED ──resume──▶ VOTING
                     └──condition/无效──▶ SKIPPED ──▶ DONE

PENDING_CONCLUSION ──结论填写超时──▶ ESCALATED（交上级裁定，避免结论卡死）
```

| 当前状态 | 事件 | 守卫条件 | 下一状态 | 副作用 |
| --- | --- | --- | --- | --- |
| PENDING | `OPEN` | 上一层 `DONE` 或为首层 | VOTING | 生成 `InstanceNodeVoter`（已快照则复用）；置 `startedAt/deadline`；发通知；投递 `vote.timeout` |
| VOTING | `VOTE_CAST` | 投票人在快照名单内；本轮结论未形成（`revotePolicy=UNLIMITED_BEFORE_CONCLUSION` 允许反复改票）；未过截止 | VOTING | 新增一行 `Vote` + 旧票标记 `isReplaced=true`；重算进度；WS `vote.cast` |
| VOTING | `VETO_LOCK` | `rejectRule` 命中且 `vetoTerminates=false`（默认） | VOTING（标记否决锁定） | 记录 `vetoLocked`；**仍等待全员表态**；通知结论填写人 |
| VOTING | `ALL_STATED` | `requireAllVote=true` 时全员已表态（`VOTED` / `DELEGATED`） | PENDING_CONCLUSION | 计票产出**系统拟判定**（否决锁定则拟驳回）；写 `VoteResult`（`isProvisional=true`）；`conclusionStatus=PENDING`；通知结论填写人；投递结论超时任务；WS `conclusion.pending` |
| VOTING | `MARK_ABSENT` | 操作人具 `VOTE_MARK_ABSENT`；理由必填；本层结论尚未形成；被标记人无有效委托 | VOTING（池缩小） | `status=ABSENT`；重算 `N_pool / Wtotal / D`；**若池内人数低于 `minQuorum` → 立即转 ESCALATED**；若因此满足 `ALL_STATED` → 直接进入结论阶段；写审计 |
| VOTING | `REVOKE_ABSENT` | 结论尚未形成；有权限 | VOTING（池恢复） | 恢复为 `PENDING`；重算池；写审计（保留撤销痕迹） |
| VOTING | `DEADLINE_HIT` | 存在未表态人 | TIMEOUT | 停止计时；记录未表态名单；通知 |
| TIMEOUT | `APPLY_POLICY(REMIND_ONLY)` | `remindCount < maxRemindRounds`（默认 3） | VOTING | 重设 deadline（+`remindIntervalHours`，默认 8h）；`remindCount++`；再次催办 |
| TIMEOUT | `APPLY_POLICY(REMIND_ONLY 超轮次)` | `remindCount >= maxRemindRounds` | ESCALATED | **强制上报**，避免节点永久悬挂 |
| TIMEOUT | `APPLY_POLICY(AUTO_REJECT)` | — | PENDING_CONCLUSION | 未表态视为反对；系统拟判定 = 驳回 |
| TIMEOUT | `APPLY_POLICY(AUTO_APPROVE)` | 租户开关 `allowAutoApprove=true`（**默认禁用**） | PENDING_CONCLUSION | 未表态视为同意 |
| TIMEOUT | `APPLY_POLICY(ESCALATE)` | — | ESCALATED | 创建 `Escalation`（`triggerType=TIMEOUT`） |
| VOTING / TIMEOUT | `ESCALATE` | 规则命中（平票 / 拒绝上报 / 超限 / 争议） | ESCALATED | 创建 `Escalation`；节点暂停计时 |
| PENDING_CONCLUSION | `SUBMIT_CONCLUSION` | 填写人具 `NODE_CONCLUDE` 权限；改判时理由必填 | PASSED 或 REJECTED | 写 `VoteConclusion`（记 `isOverride`）；`VoteResult` 补最终判定；取消超时任务；WS `conclusion.submitted`；触发任务创建/下一层 |
| PENDING_CONCLUSION | `CONCLUSION_TIMEOUT` | 结论填写超时（默认 24h） | ESCALATED | 上报上级部门裁定（`triggerType=CONCLUSION_TIMEOUT`） |
| ESCALATED | `RESUME` | 上级 `CONTINUE` | VOTING | 重开投票（保留已投票，或按配置重新计票，见 §12 建议 6） |
| ESCALATED | `FINAL` | 上级终审 | PASSED 或 REJECTED | 写 `VoteResult`（`tieResolvedBy = ESCALATION`），并生成系统代填的 `VoteConclusion`（`isOverride=true`、`authorId=null`、原因=上级终审） |
| 任意 | `SKIP` | 条件分支未命中 / 节点被配置跳过 | SKIPPED | 记录跳过原因；继续下一节点 |
| PASSED / REJECTED / TIMEOUT / SKIPPED | `COMPLETE` | 相关任务已创建 | DONE | 触发 `NodeStateMachine` 推进实例 |

### 6.3 任务 `Task`

```
PENDING_ASSIGN ──assign──▶ PENDING_ACCEPT ──accept──▶ IN_PROGRESS ──submit──▶ PENDING_ACCEPTANCE
                                │  ▲                          │                        │
                                │  └──reject(打回)────────────┘                   acceptance
                                │                                                       ▼
                                │  (依赖未满足 → BLOCKED ──解锁──▶ 回原状态)             DONE
                                └─────────────── transfer ─────────────────▶（换人，状态不变）
旁路/叠加：OVERDUE（逾期标记）· CANCELLED · ESCALATED
```

| 当前状态 | 事件 | 守卫条件 | 下一状态 | 副作用 |
| --- | --- | --- | --- | --- |
| PENDING_ASSIGN | `ASSIGN` | 有 `TASK_ASSIGN` 权限；解析出唯一 `OWNER` + 唯一 `ACCEPTOR` | PENDING_ACCEPT | 写 `TaskAssignee`；若存在未完成 `TaskDependency` → BLOCKED；通知负责人 |
| PENDING_ACCEPT | `ACCEPT` | 是 `OWNER` | IN_PROGRESS | 置 `startedAt`；通知创建者；WS `task.updated` |
| PENDING_ACCEPT | `REJECT_ASSIGN` | 是 `OWNER` | PENDING_ASSIGN | 记录理由；通知创建者重派/上报 |
| PENDING_ACCEPT | `TRANSFER` | 是 `OWNER` 或有 `TASK_TRANSFER` | PENDING_ACCEPT | 更换 `OWNER`；保留转派日志 |
| IN_PROGRESS | `SUBMIT` | 检查项全完成（可配 `requireChecklist`） | PENDING_ACCEPTANCE | 通知 `ACCEPTOR` |
| IN_PROGRESS | `BLOCK` | 依赖未满足或被人工阻塞 | BLOCKED | 记录 `blockedReason`；可选触发上报 |
| BLOCKED | `UNBLOCK` | 所有 `TaskDependency` 完成 | 阻塞前状态 | 通知负责人；WS `task.updated` |
| PENDING_ACCEPTANCE | `ACCEPTANCE_PASS` | 是 `ACCEPTOR` | DONE | 置 `completedAt`；检查是否推进下一层；解锁下游任务 |
| PENDING_ACCEPTANCE | `ACCEPTANCE_REJECT` | 是 `ACCEPTOR` | IN_PROGRESS | 记录打回理由；通知 `OWNER` |
| IN_PROGRESS / PENDING_ACCEPTANCE | `OVERDUE` | `now > dueAt` 且未终态 | 状态不变 + `OVERDUE` 标记 | 通知；按规则可选上报；写 `overdueNotifiedAt`（防重复） |
| 任意非终态 | `CANCEL` | 有权限 / 流程被撤回 | CANCELLED | 取消子任务与依赖；通知 |
| IN_PROGRESS | `ESCALATE` | 规则命中 | ESCALATED | 创建 `Escalation(sourceType=TASK)`；通知上级部门 |
| DONE | `REOPEN` | 有 `TASK_REOPEN` 权限 | IN_PROGRESS | 记录原因；通知 |

### 6.4 上报 `Escalation`

```
PENDING ──submit──▶ SUBMITTED（已投递到上级部门工号）
                        │
                        ├─（默认 AUTO）自动开投 ─────────────┐
                        ├─（可选 GRAB）工号成员签收 → SIGNED ─┤
                        └─ 签收超时 ─▶ UPGRADED（上溯一级）    │
                                                              ▼
                             VOTING（上级投票：与普通层同一套规则）
                                    │  全员表态 + 不允许弃权 + 结论前可改票
                                    ├──全员表态──▶ PENDING_CONCLUSION（上级人工结论）
                                    │                    ├─ CONTINUE ─▶ ADOPTED
                                    │                    ├─ RETURN / REQUEST_MORE ─▶ RETURNED
                                    │                    └─ FINAL_* ─▶ ADOPTED
                                    ├──平票（TiePolicy=ESCALATE）─▶ UPGRADED
                                    └──投票僵局 / 结论超时 ─▶ UPGRADED

UPGRADED ──(新建下一级)──▶ SUBMITTED   ← 逐级投票，直至 maxLevel 或形成结论
ADOPTED / RETURNED ──意见回写原流程──▶ CLOSED
```

> 越级（跳级）不在本版本支持范围：`advance()` 只能沿 `Department.parentId` 走**一级**，因此 `EscalationChain.level` 必然连续（1,2,3…），不存在缺口。
> 上级投票复用完全相同的 `VoteEngine` 与结论机制（全员表态、不允许弃权、结论形成前可改票、人工结论、按部门可见），因此「上报 = 让上级按同样流程投一次票」。
> 上级投票节点的归属：`InstanceNode` **仍挂在原流程实例下**（`layerIndex` 继续递增、`escalationId` 回指该次上报），因此步骤条、时间线、实例级分布式锁、可见性规则全部复用，不需要为上报另建一套投票表。

| 当前状态 | 事件 | 守卫条件 | 下一状态 | 副作用 |
| --- | --- | --- | --- | --- |
| PENDING | `SUBMIT` | 触发源校验；直接上级部门已配工号（否则按 `onMissingWorkNo` 兜底） | SUBMITTED | 建 `Escalation`（快照 `fromWorkNo / toWorkNo`）+ `EscalationChain(L1)`；**冻结原流程**（已确认）；通知**工号全部成员**；WS `escalation.created` |
| SUBMITTED | `AUTO_START_VOTE` | `acceptMode=AUTO`（默认） | VOTING | 按上级投票人规则（默认 `DEPT_WORKNO` = 目标工号成员）实例化投票人；创建上级投票节点写入 `upwardInstanceNodeId`；WS `escalation.voting_started` |
| SUBMITTED | `SIGN` | `acceptMode=GRAB`；操作人是目标工号成员且具 `ESC_HANDLE` | SIGNED | 记录签收人；同工号其他成员转只读；随后自动或手动开投 |
| SUBMITTED / SIGNED | `SIGN_TIMEOUT` | 超过签收时限 | UPGRADED | 上溯一级；若已达 `maxLevel` → 通知租户管理员并 `CLOSED` |
| VOTING | `VOTE_CAST` | 投票人在上级投票人集合内；本轮结论未形成 | VOTING | 复用 `VoteEngine`（同一套计票与改票规则）；WS `vote.cast` |
| VOTING | `ALL_STATED` | 全员已表态 | PENDING_CONCLUSION | 计票产出系统拟判定；通知上级结论填写人（默认目标工号主责人）；WS `conclusion.pending` |
| VOTING | `TIE` | 平票且 `TiePolicy=ESCALATE`（已确认） | UPGRADED | 上报再上一级继续投票（逐级，不跳级） |
| VOTING | `DEADLOCK_TIMEOUT` | 投票超时且策略为上报 | UPGRADED | 同上 |
| PENDING_CONCLUSION | `SUBMIT_CONCLUSION` | 上级结论填写人有权；改判需填理由 | ADOPTED / RETURNED | 写上级 `VoteConclusion` + `Escalation.finalOpinion`；按结论决定 `writeBackAction` |
| PENDING_CONCLUSION | `CONCLUSION_TIMEOUT` | 上级结论超时未填 | UPGRADED | 上溯一级（避免结论卡死） |
| ADOPTED | `WRITE_BACK` | 结论 = 继续 / 终审 | CLOSED | 回写原流程：`CONTINUE`（解冻继续投票或按需派任务）或 `FINAL_APPROVE`/`FINAL_REJECT`；WS `escalation.handled` |
| RETURNED | `WRITE_BACK` | 结论 = 退回 / 要求补充 | CLOSED | 回写原流程：`RETURN`（退回原部门重走本层）或 `REQUEST_MORE`（生成补充材料任务） |
| UPGRADED | `SUBMIT`(自动) | 下一级目标工号解析成功 | SUBMITTED | 追加下一级 chain；重置 deadline；通知新目标工号 |
| 任意 | `CLOSE` | — | CLOSED | 解冻（若尚未）；通知全链路；写审计 |

## 7. 投票人解析规则结构（`NodeVoterRule.voterValue`）

| `voterType` | `voterValue` 结构 | 解析逻辑 | 示例 |
| --- | --- | --- | --- |
| `USER` | `{ "userIds": [1,2] }` | 直接取人 | 指定 2 人投票 |
| `ROLE` | `{ "roleCodes": ["DEPT_MANAGER"], "scope": "INITIATOR_DEPT" }` | 按角色 + 范围找用户 | 发起人所在部门的部门经理 |
| `DEPARTMENT` | `{ "deptIds": [3], "includeSub": false, "leaderOnly": true }` | 取部门（或其子树）成员/负责人 | 技术部全体负责人 |
| `VOTE_GROUP` | `{ "groupCodes": ["TECH_COMMITTEE"] }` | 取投票组成员（带权重） | 技术委员会 |
| `DYNAMIC` | `{ "from": "formData.approvers", "as": "USER" }` | 从表单字段动态取人 | 申请单里指定会签人 |
| `DEPT_WORKNO` | `{ "deptRef": "INITIATOR_DEPT｜PARENT_DEPT｜FIXED", "deptId": 3, "primaryOnly": true }` | 取该部门**工号成员**（可限主责人） | 本部门工号作为结论填写人 |

约束：解析结果去重（同一人被多条规则命中时取**最大权重**，并记录 `sourceReason` 说明命中原因）；解析结果为空 → 节点转 `SKIPPED` 并告警（可配为报错中断）。

## 8. 计票规则形式化（`VoteEngine` 权威定义）

### 8.0 三条不可绕过的前置约束（来自用户确认）

| 约束 | 定义 | 违反后果 |
| --- | --- | --- |
| **必须表态** | 每个 `InstanceNodeVoter` 必须提交 `APPROVE` 或 `REJECT`（`allowAbstain=false` 时不允许 `ABSTAIN`），才算「已表态」；委托投票（`Delegation`）由受托人代为表态，计入本人 | 调用投票接口返回 `VOTE_ABSTAIN_NOT_ALLOWED`；节点无法进入结论阶段 |
| **全员表态才出结论** | `requireAllVote=true`（默认）时，**池内**全部表态（`statedCount = N_pool`）之前不得进入 `PENDING_CONCLUSION`；池外（缺席）无需表态；池内的未表态者只能通过超时策略消解（催办 → 上报 / 视为反对） | `ALL_STATED` 事件被守卫拒绝 |
| **缺席不算票、不计入池** | 请假/出差且无委托者标为 `ABSENT`：从分母 `D`、权重总和 `Wtotal`、应表态数中**一并剔除**；既不催办也不算未表态。有委托时受托人投票，仍计入池内 | 池内人数低于 `minQuorum`（默认 60%）→ 该层不得通过，直接转上报（防用缺席稀释门槛） |
| **结论必须人工填写** | `conclusionMode=MANUAL_CONFIRM`（默认）时，系统计票结果只是**拟判定**，必须有 `VoteConclusion` 才能推进流程 | 节点停留在 `PENDING_CONCLUSION`，超时则上报 |

**否决锁定**：`rejectRule` 命中时（`vetoTerminates=false`，默认）不是立刻终结投票，而是把本层锁定为「不予通过」——即使后续计票满足 `passRule`，拟判定仍为驳回。这样既落实一票否决，又不剥夺其他人表态的权利（澄清项 Q20）。

### 8.1 符号

| 符号 | 含义 |
| --- | --- |
| `N_expected` | 该层应投票人数 = `InstanceNodeVoter` 条数 |
| `N_pool` | **投票池人数** = `N_expected − 缺席人数`；全员表态与最低法定人数都按它判断 |
| `Wtotal` | 池内权重总和（缺席者权重已剔除） |
| `A / R / B` | 同意 / 反对 / 弃权 的**票数**（只计最新票，`isReplaced=false`） |
| `Wa / Wr` | 同意 / 反对票的**权重和** |
| `absentCount` | 缺席人数（`status=ABSENT`），与被剔除的权重 |
| `minQuorum` | 最低法定人数比例（默认 0.6）：`N_pool / N_expected >= minQuorum` 才允许本层通过 |
| `D` | 有效票分母 `denominator` |
| `A' / R'` | 按弃权策略折算后的同意 / 反对有效数 |
| `stated` | 已表态人数（`InstanceNodeVoter.status ∈ {VOTED, DELEGATED}`） |
| `vetoLocked` | 是否已被否决规则锁定为不予通过 |
| `systemDecision` | 系统拟判定（`APPROVE` / `REJECT`），由计票产出，交由人工结论确认或改判 |

### 8.2 弃权策略 → 分母与折算

> **已确认：不能弃权**。`allowAbstain` 恒为 `false`，`B = 0`，下表策略**不生效**；保留该表仅为说明「若未来放开弃权」的折算语义，本版本不提供开启入口。

| `abstainPolicy` | `D` | `A'` | `R'` |
| --- | --- | --- | --- |
| `COUNT_IN_DENOMINATOR` | `A + R + B` | `A` | `R` |
| `EXCLUDE_FROM_DENOMINATOR` | `A + R` | `A` | `R` |
| `AS_APPROVE` | `A + R + B` | `A + B` | `R` |
| `AS_REJECT` | `A + R + B` | `A` | `R + B` |

### 8.3 通过规则与否决规则

| 规则 | 判定条件 | 备注 |
| --- | --- | --- |
| `PASS/ALL` | `R' = 0` 且 `A' = N_pool` | 全按**池内**人数判定；缺席者不影响（Q4/Q8 已确认） |
| `PASS/MAJORITY` | `A' > D / 2`，且 `N_pool / N_expected >= minQuorum` | 平票按 `tiePolicy=ESCALATE` 报上级组织裁定（Q3 已确认） |
| `PASS/RATIO` | `A' / D >= passThreshold` | `passThreshold ∈ (0,1]`，默认 0.6 |
| `PASS/WEIGHTED` | `Wa' / Wtotal >= passThreshold` | 权重制，支持「部门长权重 2」 |
| `PASS/AT_LEAST_N` | `A' >= passThreshold`（整数 N） | 与总人数无关 |
| `REJECT/ANY_VETO` | `R' >= 1` | 一票否决；默认只**锁定不予通过**（仍等全员表态），`vetoTerminates=true` 才立即终结投票 |
| `REJECT/OPPOSE_OVER` | `R' / D > rejectThreshold` | `rejectThreshold ∈ (0,1)`，默认 0.34 |
| `REJECT/NONE` | 不因反对直接失败 | 仅靠通过规则判定 |

### 8.4 判定顺序（唯一权威流程）

```
【阶段一：投票收集（VOTING）】
0) 计算投票池：N_pool = N_expected − 缺席人数；Wtotal = 池内权重和；缺席者不催办、不计入分母
   若 N_pool / N_expected < minQuorum（默认 0.6）→ 本层不得通过，直接转 ESCALATED（上报）
1) 校验：是否在投票期内？投票人是否在快照名单内且未被标记缺席？是否本轮结论已形成（已形成则拒绝改票）？
   → 否：抛 VOTE_* 错误
2) 校验表态合法性：allowAbstain=false 时拒绝 ABSTAIN → VOTE_ABSTAIN_NOT_ALLOWED
3) 写入票（事务内 + 唯一约束兜底；改票 = 新增行 + 旧行 isReplaced=true）
4) 重算 A/R/B/Wa/Wr/D/A'/R'/stated
5) 否决标记：rejectRule 命中 → 置 vetoLocked=true
   ├ vetoTerminates=false（默认）→ 继续等待全员表态
   └ vetoTerminates=true         → 立即进入阶段二（未表态者记 SKIPPED）
6) 表态完成检查：requireAllVote=true 且 stated < N_pool → 保持 VOTING，等待后续票或 deadline
   （若期间有人被标记 ABSENT，池缩小到 stated == N_pool → 立即进入阶段二）

【阶段二：形成系统拟判定（VOTING → PENDING_CONCLUSION）】
7) 若 vetoLocked → systemDecision = REJECT（一票否决优先，即使 passRule 满足）
8) 否则按 passRule 判定：
   ├ 满足           → systemDecision = APPROVE
   ├ 平票           → tiePolicy：REJECT → REJECT；ESCALATE → 创建上报；CHAIRMAN_VOTE → 追加一票后重算
   └ 不满足         → systemDecision = REJECT（理由：未达通过阈值）
9) 写 VoteResult（isProvisional=true）；conclusionStatus=PENDING；通知结论填写人
   例外：conclusionMode=AUTO 时跳过人工环节，systemDecision 即最终结论

【阶段三：人工结论（PENDING_CONCLUSION → PASSED/REJECTED）】
10) 结论填写人提交 VoteConclusion：
    ├ MANUAL_CONFIRM：只能确认 systemDecision；改判需 NODE_CONCLUDE_OVERRIDE 权限 + 必填理由
    ├ MANUAL_OVERRIDE：可自由改判，仍需必填理由
    └ 超时未填（默认 24h）→ ESCALATED，交上级部门裁定
11) 回填 VoteResult 最终判定与 conclusionId，节点进入 PASSED / REJECTED → DONE

（EARLY_PASS「提前通过」默认关闭：本条与「全员必须表态」冲突，仅在不要求全员表态的模板中可启用）
```

**仅提醒型超时**（`REMIND_ONLY`）不终结节点：重置新 `deadline` 并再次投递 `vote.timeout`，直到 `maxRemindRounds`（默认 3）后强制转 `ESCALATE`，避免节点永久悬挂。

### 8.5 `VoteResult.snapshot` 结构（不可变审计凭证）

```jsonc
{
  "counts": { "approve": 3, "reject": 1, "abstain": 0 },
  "stated": 4,
  "expectedVoters": 4,
  "votingPool": 4, "absentCount": 0, "absentUserIds": [], "minQuorum": 0.6, "quorumSatisfied": true,
  "weighted": { "approve": 5, "reject": 2, "total": 9 },
  "denominator": 4,
  "allowAbstain": false,
  "passRule": "RATIO", "passThreshold": 0.6, "passSatisfied": true,
  "rejectRule": "ANY_VETO", "rejectSatisfied": false, "vetoLocked": false,
  "systemDecision": "APPROVE",
  "finalDecision": "APPROVE",
  "conclusionId": 88, "conclusionMode": "MANUAL_CONFIRM", "conclusionIsOverride": false,
  "voters": [ { "userId": 7, "decision": "APPROVE", "weight": 2, "voteId": 101, "at": "..." } ],
  "ruleVersion": "v1.3", "engineVersion": "tally-1.0.0", "evaluatedAt": "..."
}
```

`engineVersion` 用于将来规则语义微调时区分历史结论的算法版本。

## 9. 规则引擎 JSON DSL 文法（`RuleEngine`）

### 9.1 文法（EBNF 风格）

```
Rule      := Condition
Condition := Logical | Comparison | Literal
Logical   := { "and": [Condition, ...] }      // 空数组 = true
           | { "or":  [Condition, ...] }      // 空数组 = false
           | { "not": Condition }
Comparison:= { OP: [Path, Value] }
OP        := "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
           | "in" | "notIn" | "contains" | "startsWith"
           | "exists" | "between" | "sizeGt" | "sizeLt"
Path      := ROOT ( "." IDENT | "[" INT "]" )*      // 例：formData.items[0].amount
ROOT      := "formData" | "user" | "user.depts" | "user.roles"
           | "dept" | "dept.ancestors" | "dept.level"
           | "instance" | "voteResult" | "task" | "taskStatus"
           | "escalation" | "escalation.level" | "now" | "const"
Value     := Literal | { "$path": Path }            // 支持与另一字段比较
```

### 9.2 示例

```jsonc
// 示例 1：金额超 5 万且发起部门层级 = 3，且发起人非总经理 → 命中上报
{
  "and": [
    { "gt": ["formData.amount", 50000] },
    { "eq": ["dept.level", 3] },
    { "not": { "in": ["user.roles", "GM"] } }
  ]
}

// 示例 2：字段间比较（申请金额超过预算字段 → 触发风险审核）
{ "gt": ["formData.amount", { "$path": "formData.budget" }] }

// 示例 3：投票结果驱动跳转（已通过且零反对 → 走快速通道）
{ "and": [ { "eq": ["voteResult.passed", true] }, { "eq": ["voteResult.counts.reject", 0] } ] }

// 示例 4：时间相关（距截止不足 24 小时且仍在进行 → 催办）
{ "and": [ { "lt": ["task.dueInHours", 24] }, { "eq": ["task.status", "IN_PROGRESS"] } ] }
```

### 9.3 求值器设计要求

| 要求 | 说明 |
| --- | --- |
| 纯函数 | `evaluate(rule, ctx)` 无 IO，前后端同一份实现（`packages/shared/src/rule-dsl`） |
| 安全 | 只允许白名单 `ROOT`；`$path` 解析不执行任意代码；深度上限（默认 10 层）、节点数上限（默认 200）防 DoS |
| 类型安全 | 数值比较前做类型归一（字符串数字、`Date`、`Decimal`）；`null/undefined` 统一语义为「不满足，`neq`/`exists` 除外」 |
| 可解释 | `explain(rule, ctx)` 返回命中路径与每个叶子节点的真假；UI 用它在「上报详情」里说明**为什么上报**、在设计器里做「在线试算」 |
| 校验 | 模板发布前用 `validateRule()` 静态校验（未知 OP、路径不在白名单、类型不匹配、缺必填阈值） |
| 可扩展 | OP 注册表（`Map<string, ComparatorFn>`），新增操作符无需改求值器主体 → 对应输出要求 #14「如何扩展」 |

### 9.4 DSL 的五处应用

| 场景 | 字段 | 命中后果 |
| --- | --- | --- |
| 节点跳转 | `WorkflowEdge.condition` | 选择下一条边（多边按 `priority` 取第一个命中） |
| 上报触发 | `NodeEscalationRule.triggerType + condition` | 创建 `Escalation` |
| 任务分配 | `NodeTaskTemplate.assigneeRule`（内含条件） | 解析出 `OWNER / ACCEPTOR` |
| 超时策略 | `NodeVoteRule.timeoutPolicy + 条件` | 决定自动通过 / 自动驳回 / 上报 |
| 结论填写人 | `NodeVoteRule.conclusionAuthorRule` | 解析出本层投票结论的填写人；默认 `DEPT_WORKNO`（本部门工号主责人 → 无工号则部门负责人） |

## 10. 索引与性能计划

| 目标查询 | 索引 |
| --- | --- |
| 待我投票 | `InstanceNodeVoter(userId, status)` + `InstanceNode(status, deadline)` |
| 超时扫描（每 30s） | `InstanceNode(tenantId, status, deadline) WHERE status = 'VOTING'`（部分索引） |
| 逾期任务扫描 | `Task(tenantId, status, dueAt) WHERE status NOT IN 终态`（部分索引） |
| 待我处理任务 | `TaskAssignee(userId, isActive)` 覆盖索引 `INCLUDE (taskId)` |
| 待我部门上报 | `Escalation(toDeptId, status)` |
| 组织子树 | `Department(path text_pattern_ops)`，前缀 `LIKE '/1/3/%'` |
| 实例时间线 | `InstanceNode(instanceId, layerIndex)` + `Vote(instanceNodeId, createdAt)` |
| 审计检索 | `AuditLog(tenantId, targetType, targetId, createdAt)`；按月 `PARTITION BY RANGE(createdAt)` |
| Outbox 取件 | `OutboxEvent(status, availableAt)` + `SKIP LOCKED` 批量取 |
| 幂等兜底 | 唯一约束作为最终防线：`Vote(instanceNodeId, voterId, revoteSeq)`、`InstanceNodeVoter(instanceNodeId, userId)` |

大数据量取舍：投票 / 审计 / outbox 三表增长最快 → 审计按月分区，Outbox 已投递记录定期归档（默认保留 30 天），投票记录不清理（合规要求）。

## 11. 多租户与数据权限隔离

| 层次 | 手段 |
| --- | --- |
| 表结构 | 所有业务表带 `tenantId`；所有唯一约束含 `tenantId` 前缀 |
| 应用层 | Prisma Client Extension：`where` 自动注入 `tenantId`、`create` 自动带 `tenantId`；禁止裸 `$queryRaw`（ESLint 规则 + review 清单） |
| 数据范围 | `DataScopeGuard` 解析 `UserRole.scopeType/scopeId` → `RequestContext.scope` → Repository 统一拼条件：`SELF`（`initiatorId/voterId = me`）、`DEPT`（`= myDeptId`）、`DEPT_AND_SUB`（`path LIKE '/1/3/%'`）、`DEPT_LIST`（`IN (...)`）、`TENANT`（无附加条件） |
| 越权防护 | 详情接口必须校验「主体是否在该用户数据范围内」，越权返回 404 而非 403（避免探测存在性） |
| 缓存隔离 | Redis key 前缀 `tenant:{id}:` |
| 队列隔离 | 任务 payload 带 `tenantId`；Worker 消费时重建 `RequestContext` |
| 升级路径 | 若未来需要物理隔离，可在 `PrismaService` 层按 `tenantId` 路由到不同 `DATABASE_URL`（连接池映射），业务代码不变 |

### 11.1 投票明细可见性解析（对应澄清项 Q1 / Q21）

可见性不是简单的角色判断，而是**每次查询都要按「查询者 → 投票人」的部门关系逐条投影**。解析顺序如下（命中即返回，`VoteVisibilityPolicy` 纯函数，前后端共用）：

| 优先级 | 条件 | 结果 |
| --- | --- | --- |
| 1 | 系统管理员 / 审计者（`AUDIT_EXPORT` 或 `TENANT` 数据范围） | 全部明细 |
| 2 | 查询者在**该实例上报链**的上级部门内（`EscalationChain.deptId` ∈ 其部门，且 chain 状态 ≥ `SUBMITTED`） | **全部明细**（用户明确要求：上级部门能看到所有上报的） |
| 3 | 查询者本人是该层投票人 | **本部门明细**（含姓名与选择）+ 其他部门的聚合计数 |
| 4 | 查询者属于发起部门且具 `VOTE_VIEW_DEPT` | 本部门明细 + 聚合计数 |
| 5 | 其他任何用户 | 仅聚合计数（已表态 N/M、同意数、反对数），**不含任何姓名** |

返回结构固定为三段，避免前端各自拼装导致越权泄漏：

| 字段 | 内容 | 受策略影响 |
| --- | --- | --- |
| `progress` | 已表态数 / 应表态数、同意数、反对数 | 始终可见 |
| `deptBreakdown[]` | 按部门分组的「已表态 N/M」 | 始终可见（只有计数，无线索到人） |
| `voters[]` | 投票人姓名、选择、时间、权重 | 按上表策略过滤或整体置空 |

配套约束：

- `recordMode = ANONYMOUS` 时，`voters[]` 只返回 `{ votedAt, weight }`，不返回 `userId/name/decision`，但**计票仍然照常**（匿名只影响展示，不影响判定）。
- 任何可见性过滤都在**服务端投影层**完成；前端不做隐藏式"假过滤"（前端只负责渲染服务端返回的 `voters[]`）。
- 每次查看他人投票明细写一条 `AuditLog(action=VOTE_DETAIL_VIEW)`，便于合规审计。

## 12. 模型增补建议汇总（需用户确认）

| # | 建议 | 原因 | 影响 |
| --- | --- | --- | --- |
| 1 | ~~新增 `HolidayCalendar`~~（**降级为可选**） | Q7 已确认按**自然日**计算，本版本不需要节假日数据；仅当未来切换 `WORKING_DAY` 才建表 | 阶段 1 不建表，deadline 工具保留 `DeadlineMode` 分支 |
| 2 | 新增 `Delegation` | 投票人缺席委托（Q8） | 阶段 1 加表；投票鉴权需查委托 |
| 3 | 新增 `InstanceSuspension` | 精确恢复冻结前状态（Q5） | 阶段 1 加表；解冻逻辑更可靠 |
| 4 | 新增 `VoteGroup / VoteGroupMember` | 让 `VOTE_GROUP` 投票人类型可落地 | 阶段 1 加表；投票人解析支持组 |
| 5 | `Vote` 增加 `revoteSeq / isReplaced` | 允许一次改票且不可篡改（Q2） | 唯一约束改三元组；计票只取最新票 |
| 6 | `InstanceNode` 增加 `layerIndex / round` | 明确「第几层」与「同层重投轮次」 | 步骤条与时间线直接可用；重开投票可追溯 |
| 7 | `WorkflowNode` 增加 `nodeKey` | 设计器与前后端用稳定 key 引用节点，不依赖自增 id | 图校验与前端画布更稳 |
| 8 | `InstanceNodeVoter` 增加 `sourceRuleId / sourceReason` | 审计「为什么这个人是投票人」 | 投票详情页可展示来源；合规友好 |
| 9 | `Escalation` 增加 `level / frozenInstanceStatus / maxLevel` | 逐级/越级与解冻恢复的基础 | 上报链与冻结恢复依赖它 |
| 10 | `OutboxEvent` 增加 `aggregateType/aggregateId/sequence/lockedAt` | 保序 + 多实例安全取件 | 防止同一聚合事件乱序导致状态回退 |
| 11 | 新增 `NumberSequence` | 实例号 / 任务号 / 上报号需要 | 单机部署也需不重复单号 |
| 12 | 新增 `IdempotencyKey` | 客户端重试与队列重复消费 | 计票与创建任务天然幂等 |
| 13 | 新增 `VoteConclusion` 表 | 每层**人工投票结论**落地（用户新增需求） | 阶段 1 建表，阶段 2 实现结论服务 |
| 14 | `InstanceNodeStatus` 增加 `PENDING_CONCLUSION` | 「全员表态 → 人工结论」阶段不可省 | 阶段 2 状态机与前端步骤条 |
| 15 | `NodeVoteRule` 增加 `requireAllVote / allowAbstain / revotePolicy / vetoTerminates / conclusionMode / conclusionAuthorRule / viewScope / remindIntervalHours / maxRemindRounds` | 承载「必须表态」「结论前可改票」「可见性按部门」「结论人工填写」四条规则 | 阶段 1 字段 + 阶段 2 引擎 |
| 16 | `Tenant` 增加 `allowCrossLevel / allowAutoApprove` 开关 | 越级与超时自动通过默认关闭，保留合规出口 | 阶段 1 字段；阶段 3 生效 |
| 17 | `EscalationChain` 增加可见性用途的 `deptId` 索引 | 上级部门查全部投票明细需按链上部门反查 | 阶段 1 索引 |
| 18 | `Comment` / `Attachment` 支持挂载到 `VoteConclusion` | 结论需要附证明材料 | 多态挂载已支持，无需新表 |
| 19 | `Department` 增加 `workNo`（部门工号，租户内唯一） | 上报统一投递到上级部门工号（用户确认） | 阶段 1 字段 + 唯一约束 |
| 20 | 新增 `DepartmentWorkNoMember` | 工号是"部门级账号"，需要一张表记录谁能用该工号收件与处理 | 阶段 1 建表；上报受理与通知依赖它 |
| 21 | `Escalation` 增加 `fromWorkNo / toWorkNo` | 工号快照，事后调整工号不影响历史链路 | 阶段 1 字段 + `(toWorkNo, status)` 索引 |

| 22 | `Escalation` 增加 `upwardInstanceNodeId / finalOpinion / writeBackAction`，上级投票**复用 `InstanceNode` + `VoteEngine`**，不新建投票体系 | 用户确认「上报 = 让上级做一次同样的投票」；复用可保证规则语义与前端组件完全一致 | 阶段 3 的核心实现；避免第二套计票逻辑 |
| 23 | 新增 `Absence`（请假/出差区间登记） | 缺席要「不算票、不计入池」，靠人工逐节点标记容易漏；按区间登记后节点开启时自动命中 | 阶段 1 建表；节点 `OPEN` 时自动标 `ABSENT` |
| 24 | `InstanceNodeVoter` 增加缺席字段 + `NodeVoteRule.minQuorum` / `quorumPolicy` | 缺席剔除需要留痕（谁标、为什么、剔了多少权重），并需要法定人数下限防止门槛被稀释 | 阶段 1 字段；阶段 2 计票强制校验 |

以上 24 条建议默认全部采纳（第 1 条降级为可选、本版本不建表）；如需删减请指出编号，我将在阶段 1 调整 schema。
