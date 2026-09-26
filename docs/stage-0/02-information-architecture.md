# 02 · 信息架构与 UI 设计基线

## 1. 导航信息架构

左侧可折叠侧边栏，5 个分组；顶部固定「全局搜索 + 通知铃 + 头像菜单」。

```
┌ 品牌区：LOGO + 租户名 + 折叠按钮
├ 工作台            /dashboard                        （默认落地页）
├ 审批与协作
│   ├ 投票中心      /votes                            徽标 = 待我投票数
│   ├ 流程实例      /instances
│   ├ 上报中心      /escalations                      徽标 = 待我部门处理数
│   └ 任务中心      /tasks                            徽标 = 待我处理数
├ 分析
│   └ 统计报表      /stats
├ 管理（需权限）
│   ├ 流程设计器    /admin/workflow-templates
│   ├ 任务分配器    /admin/assignee-rules
│   ├ 组织架构      /admin/org
│   └ 角色权限      /admin/roles
└ 底部：消息通知 /notifications  ·  个人设置 /settings
```

导航项按权限动态过滤（`PermissionGuard` 同源的 `usePermissions()`）；无权限的整组隐藏而非禁用。

## 2. 页面清单与路由表

共 18 个页面，与用户要求一一对应。

| # | 页面 | 路由 | 权限 | 主要区块 |
| --- | --- | --- | --- | --- |
| 1 | 登录 | `/login` | 公开 | 品牌区、账号密码表单、记住我、错误提示、演示账号提示（seed 后） |
| 2 | 工作台 | `/dashboard` | 登录即可 | 9 张统计卡（原 8 张 + 新增「待我填写结论」，见 §3.1）、待办聚合列表、最近动态时间线、负载/进度迷你图 |
| 3 | 投票中心 | `/votes` | `VOTE_READ` | 分段控件「待我投票 / 我已投票 / 全部」、投票卡片（当前层进度条 + 截止倒计时）、批量提醒 |
| 4 | 投票详情 | `/votes/[instanceNodeId]` | `VOTE_READ` | 表单数据只读视图、**按部门分组的投票明细（默认仅本部门可见）**、投票动作区（同意/反对 + 意见，**必须表态**）、实时进度、计票规则说明卡片、**投票结论区（全员表态后由指定人填写）** |
| 5 | 流程实例列表 | `/instances` | `INSTANCE_READ` | 筛选（状态/模板/时间/发起人）、表格、导出 |
| 6 | 发起流程 | `/instances/new` | `INSTANCE_CREATE` | 模板选择器（卡片式）、按 JSON Schema 渲染表单、发起前预览「本次将产生的层级与投票人」、提交/存草稿 |
| 7 | 流程详情 | `/instances/[id]` | `INSTANCE_READ` | 层级步骤条（Stepper）、各层投票结果卡、任务群列表、上报记录、时间线、附件、评论、操作区（撤回/重提/催办/上报） |
| 8 | 任务中心 | `/tasks` | `TASK_READ` | 三视图切换：**看板**（dnd-kit 拖拽改状态）/ **列表**（表格 + 批量）/ **甘特**（缩放 + 依赖连线）、筛选与分组、我的/我部门/全部 |
| 9 | 任务详情 | `/tasks/[id]` | `TASK_READ` | 头部（状态/优先级/负责人/验收人/截止倒计时）、描述、检查项、子任务树、依赖关系图、附件、操作日志、操作区（接受/转派/提交验收/验收） |
| 10 | 上报中心 | `/escalations` | `ESC_READ` | 分段「待我部门处理 / 我发起的 / 全部」、状态漏斗图、列表（含来源类型徽标、耗时） |
| 11 | 上报详情 | `/escalations/[id]` | `ESC_READ` | **上报链时间线**（逐级可视化，含每级处理人与耗时）、来源对象卡片（可跳原流程/任务）、目标部门（**逐级上溯，不允许越级**）、**该实例全部层级的投票明细（上级部门可见）**、处理动作面板、结论与附件 |
| 12 | 流程设计器 | `/admin/workflow-templates`、`/admin/workflow-templates/[id]` | `WF_DESIGN` | 左侧节点库、中间画布（节点卡片 + 连线 + 层号泳道）、右侧属性面板（投票人规则/投票规则/任务模板/上报规则/超时策略 Tab）、版本列表与发布 |
| 13 | 任务分配器 | `/admin/assignee-rules` | `TASK_DESIGN` | 分配算法选择（手动/角色/部门/投票组/负载均衡/抢单）、规则 DSL 编辑与**在线试算**（给定模拟任务 → 输出命中人与理由）、负载预览 |
| 14 | 统计报表 | `/stats` | `STATS_READ` | 4 个 Tab：投票（通过率/规则分布/平均票耗时）、层级耗时（各层箱线/柱状）、任务（完成率/逾期率/负载热力）、上报（触发源分布/上溯层级分布/处理时长） |
| 15 | 组织架构 | `/admin/org` | `ORG_MANAGE` | 部门树（可展开/拖拽排序）、部门详情（负责人/成员/上级链路面包屑）、成员表格、批量导入导出 |
| 16 | 角色权限 | `/admin/roles` | `ROLE_MANAGE` | 角色列表、权限矩阵（权限 × 角色勾选）、数据范围设置（本人/本部门/本部门及下级/指定部门/全租户）、成员分配 |
| 17 | 消息通知 | `/notifications` | 登录即可 | 未读/已读分段、类型过滤（投票/任务/上报/系统）、批量已读、点击跳转并标记、通知偏好设置入口 |
| 18 | 个人设置 | `/settings` | 登录即可 | 基本资料、头像、密码修改、通知偏好（站内/邮件/短信/IM）、主题（亮/暗/跟随系统）、时区与语言 |

### 2.1 路由组与布局

```
app/
├ (auth)/login/page.tsx                    独立布局，无侧边栏
├ (app)/layout.tsx                         侧边栏 + 顶栏 + 通知抽屉 + Toaster + Provider
│   ├ dashboard/page.tsx
│   ├ votes/page.tsx, votes/[instanceNodeId]/page.tsx
│   ├ instances/page.tsx, instances/new/page.tsx, instances/[id]/page.tsx
│   ├ tasks/page.tsx, tasks/[id]/page.tsx
│   ├ escalations/page.tsx, escalations/[id]/page.tsx
│   ├ stats/page.tsx
│   ├ admin/workflow-templates/page.tsx, admin/workflow-templates/[id]/page.tsx
│   ├ admin/assignee-rules/page.tsx
│   ├ admin/org/page.tsx
│   ├ admin/roles/page.tsx
│   ├ notifications/page.tsx
│   └ settings/page.tsx
```

## 3. 关键页面的信息设计

### 3.1 工作台（用户要求的 8 个区块 + 新增 1 个）

| 区块 | 内容 | 数据来源 | 交互 |
| --- | --- | --- | --- |
| 待我投票 | 计数 + 最紧急 3 条（含剩余时间） | `GET /votes?scope=mine&status=pending` | 点击进投票详情；「全部」跳投票中心 |
| 待我处理任务 | 计数 + 最紧急 3 条（含逾期标红） | `GET /tasks?assignee=me&status=open` | 点击进任务详情 |
| 待我上报 | 我发起的上报中待上级处理 | `GET /escalations?requestedBy=me` | 跳上报详情 |
| 上报给我部门 | 当前部门需受理的上报 | `GET /escalations?toDept=mine&status=submitted` | 跳上报详情，可直接受理 |
| 我发起的 | 我发起的流程实例（按状态分组） | `GET /instances?initiator=me` | 跳流程详情 |
| 进行中 | 租户内我可见的进行中实例 | `GET /instances?status=active` | 跳列表 |
| 已结束 | 近 30 天完结实例 | `GET /instances?status=closed&range=30d` | 跳列表 |
| 逾期预警 | 逾期任务 + 临期节点（≤ 24h） | `GET /stats/overdue-warnings` | 跳任务中心/投票中心 |
| 待我填写结论 | 全员已表态、等我填写投票结论的节点 | `GET /votes?scope=to-conclude` | 跳投票详情 · 结论区 |

### 3.2 投票详情页（核心交互）

三栏（桌面）/ 上下堆叠（移动）：

| 区域 | 元素 |
| --- | --- |
| 左：上下文 | 申请表单只读渲染、发起人与发起时间、附件列表、评论区 |
| 中：投票区 | 同意 / 反对 两按钮 + 意见输入（反对时必填，**无弃权选项**）；已投票则显示我的选择与时间，**结论形成前可反复改票**（改票按钮 + 历史轨迹）；底部实时进度条（同意/反对分段） |
| 右：规则与人员 | 计票规则卡片（人类可读翻译，例如「全员必须表态；≥ 60% 同意且无人反对即拟通过」）、**按部门分组的投票明细**（本部门显示姓名与选择，其他部门仅显示"已投 N/M"）、截止倒计时、催办按钮 |
| 下：结论区 | 全员表态后出现：系统自动判定结果（拟通过/拟驳回）+ 计票明细、结论填写表单（结论类型 + 结论意见必填 + 附件）、改判时强制填写理由、提交后展示结论卡片（填写人/时间/是否改判） |

### 3.3 上报详情页（上报链可视化）

```
来源：任务「补充三家供应商比价」（逾期）
   │
   ├─ L1  技术部           提交人 张三   2026-09-26 10:00   PENDING→SUBMITTED
   ├─ L2  产品中心（直接上级） 处理人 李四   2026-09-26 11:20   ACCEPTED（发起上级投票）
   ├─ L3  副总裁办（越级）    处理人 王五   ——                VOTING（3/5 已投）
   └─ L4  待定 · 预计 2026-09-28 再上报（超时自动）
结果：待定
```

每级展示：部门、处理人、时间、动作、耗时、结论、附件；未处理级显示「超时自动上报倒计时」。

## 4. 设计系统基线（阶段 4 落地为 Tailwind theme）

### 4.1 色彩

| 语义 | Light | Dark | 用途 |
| --- | --- | --- | --- |
| 主色 brand-600 | `#4F46E5` | `#6366F1` | 主按钮、选中态、进度条、链接 |
| 主色浅底 brand-50 | `#EEF2FF` | `#1E1B4B` | 选中行、徽标底 |
| 页面底 canvas | `#F7F8FA` | `#0B0D12` | 应用背景 |
| 卡片面 surface | `#FFFFFF` | `#14161C` | 卡片、弹窗、表格 |
| 边框 border | `#E5E7EB` | `#262A33` | 分隔线、输入框边 |
| 正文 text | `#111827` | `#E5E7EB` | 主文本 |
| 次要 text-muted | `#6B7280` | `#9CA3AF` | 辅助信息、标签 |
| 成功 | `#16A34A` / 底 `#ECFDF5` | `#22C55E` / `#052E16` | 通过、已完成 |
| 警告 | `#D97706` / 底 `#FFFBEB` | `#F59E0B` / `#2C1A02` | 临期、待处理 |
| 危险 | `#DC2626` / 底 `#FEF2F2` | `#EF4444` / `#300A0A` | 驳回、否决、逾期 |
| 信息 | `#0284C7` / 底 `#EFF6FF` | `#38BDF8` / `#082F49` | 提示、上报中 |

状态标签色映射（唯一事实来源放 `packages/shared/constants/status.ts`，前后端共用）：

| 状态 | 语义色 | 状态 | 语义色 |
| --- | --- | --- | --- |
| `DRAFT` | 中性 | `PASSED` / `APPROVED` / `DONE` / `ADOPTED` | 成功 |
| `VOTING` / `IN_PROGRESS` / `SUBMITTED` / `TASKING` / `PENDING_CONCLUSION` | 信息 | `PENDING` / `PENDING_ACCEPT` / `PENDING_ACCEPTANCE` | 警告 |
| `REJECTED` / `OVERDUE` | 危险 | `TIMEOUT` / `ESCALATED` / `SUSPENDED` / `BLOCKED` | 警告（描边） |
| `CLOSED` / `CANCELLED` / `SKIPPED` | 中性弱化 | `RETURNED` / `UPGRADED` | 警告 |

### 4.2 形状、阴影、排版

| Token | 取值 |
| --- | --- |
| 圆角 | 卡片 12px、面板/弹窗 16px、控件 8px、标签/头像 999px |
| 阴影 | sm `0 1px 2px rgba(16,24,40,.05)`；md `0 4px 12px rgba(16,24,40,.08)`；lg `0 12px 32px rgba(16,24,40,.12)`；暗色下用边框+更低透明度阴影 |
| 间距 | 4px 基准，常用 4/8/12/16/24/32/48 |
| 字号 | 12 / 13 / 14（正文）/ 16（卡片标题）/ 20（页面副标题）/ 24 / 30（页面标题） |
| 字重 | 400 正文、500 控件、600 标题 |
| 字体 | 拉丁 Inter，中文 `system-ui, "PingFang SC", "Microsoft YaHei"`；数字用 `tabular-nums` |
| 动效 | 过渡 150–200ms `ease-out`；页面进入 Framer Motion `opacity + y: 8 → 0`；列表增删 `layout` 动画；尊重 `prefers-reduced-motion` |

### 4.3 组件清单（阶段 4 交付）

基础（shadcn/ui 风格）：Button、Input、Textarea、Select、Combobox、Checkbox、RadioGroup、Switch、Tabs、Segmented、Tooltip、Popover、DropdownMenu、Dialog、Sheet(Drawer)、Toast、Skeleton、Badge、Avatar、AvatarGroup、Progress、Separator、Table、Pagination、Breadcrumb、EmptyState、ErrorState、CommandPalette(⌘K)、DatePicker、Slider、ScrollArea。

业务组件：`StatusBadge`、`VoteProgressBar`（分段计数+规则文案）、`VoteRuleCard`、`NodeStepper`、`Timeline`、`EscalationChain`（逐级可视化）、`UserPicker`、`DeptCascader`、`DeptTreeSelect`、`DynamicForm`（JSON Schema 渲染）、`FileUploader`、`TaskCard`、`TaskKanban`、`TaskGantt`、`WorkloadBar`、`PermissionMatrix`、`RuleBuilder`（DSL 可视化编辑）、`CountdownBadge`、`DiffViewer`（审计 before/after）。

## 5. 权限模型（前端消费方式）

| 概念 | 说明 |
| --- | --- |
| 权限点 | `模块_动作` 形式，如 `VOTE_CAST`、`VOTE_VIEW_DEPT`、`VOTE_VIEW_ALL`（仅上报链上级部门）、`NODE_CONCLUDE`（填写投票结论）、`TASK_ASSIGN`、`ESC_UPGRADE`、`ESC_CROSS_LEVEL`（默认关闭，越级已禁止）、`WF_PUBLISH`、`AUDIT_EXPORT`、`ORG_MANAGE`、`ROLE_MANAGE`、`STATS_READ` |
| 数据范围 | `SELF` / `DEPT` / `DEPT_AND_SUB` / `DEPT_LIST`（指定部门）/ `TENANT`（全租户），挂在 `UserRole.scopeType + scopeId` |
| 前端用法 | `usePermissions()` 返回 `{ can(code), scope, deptIds }`；路由守卫 + 按钮级 `can()`；**前端隐藏只是体验，真实拒绝在后端守卫** |
| 后端用法 | `JwtAuthGuard`（身份）→ `PermissionGuard`（权限点）→ `DataScopeGuard`（把范围注入 `RequestContext`）→ Repository 统一拼 `tenantId + scope` 条件 |

## 6. 实时事件与 UI 反馈映射

| WebSocket 事件 | 房间 | UI 响应 |
| --- | --- | --- |
| `vote.cast` | `instance:{id}` | 投票详情进度条与头像组即时更新；触发 `invalidateQueries(['votes'])` |
| `conclusion.pending` | `instance:{id}`、`user:{concluderId}` | 投票详情出现结论填写区；结论人收到通知 + 工作台「待我填写结论」+1 |
| `conclusion.submitted` | `instance:{id}` | 展示结论卡片；节点状态变为通过/驳回；步骤条前进 |
| `node.passed` / `node.rejected` / `node.timeout` | `instance:{id}` | 层级步骤条前进/标红；Toast 提示；若当前层变为待我投票则侧边栏徽标 +1 |
| `task.created` / `task.updated` | `user:{id}`、`dept:{id}` | 任务卡片飞入动画；看板列内重排；徽标更新 |
| `task.overdue` | `user:{id}`、`dept:{id}` | 卡片转危险色 + 逾期标签；工作台预警区插入 |
| `escalation.created` | `dept:{toDeptId}` | 上报中心徽标 +1；Toast「有新的上报待你部门受理」 |
| `escalation.handled` | `instance:{id}`、`dept:{fromDeptId}` | 上报链时间线追加一级；流程状态卡更新；若解冻则恢复操作区 |
| `notification.new` | `user:{id}` | 顶栏铃铛红点 + 抽屉插入；浏览器通知（可选，需用户授权） |

断线策略：Socket.IO 自动重连 + 重连后调用一次 REST 全量刷新（不依赖事件补齐），避免漏事件导致状态错乱。

## 7. 状态呈现策略

| 场景 | 处理 |
| --- | --- |
| 加载 | 首屏用骨架屏（卡片/表格/图表各有骨架），不用全局 spinner |
| 空态 | 每个列表有定制空态：图标 + 一句话 + 主行动按钮（如「发起第一个流程」） |
| 错误 | 区块级 ErrorState（可重试）+ 顶部 Toast；表单错误就地展示字段级提示 |
| 无权限 | 页面级 403 页（说明缺哪个权限点）+ 按钮级 `Tooltip` 说明 |
| 乐观更新 | 投票、任务状态拖拽、已读等用乐观更新 + 失败回滚 + Toast |
| 长列表 | 虚拟滚动（任务/审计日志）+ 服务端分页游标 |
