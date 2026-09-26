# 联调文档（阶段 6）

## 1. 统一约定

- 基址：开发 `http://localhost:3001`；前端通过同源 `/api/*` 转发（Next rewrite）
- 认证：`Authorization: Bearer <accessToken>`（登录/刷新/健康检查除外）
- 成功响应：`{ code: 'OK', message: 'success', data, traceId }`
- 失败响应：`{ code, message, detail?, data: null, traceId }`，`code` 取自 `packages/shared` 的 `ERROR_CODES`
- 错误码可直接判断语义，不要解析 `message`（message 是给人看的）

## 2. 登录与刷新

```bash
# 登录（演示账号）
curl -s http://localhost:3001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@cloudrail.dev","password":"Oa@12345678"}'

# 拿到 tokens.accessToken / tokens.refreshToken；access 过期后用 refresh 换一对新的
curl -s http://localhost:3001/auth/refresh -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refresh>"}'

# 当前用户与权限点
curl -s http://localhost:3001/auth/me -H "Authorization: Bearer <access>"
```

前端 `api-client` 已内置刷新单飞队列（多个请求同时 401 只刷新一次）。

## 3. 主流程示例：发起 → 投票 → 结论 → 任务 → 上报

```bash
# 1) 看已发布模板
curl -s 'http://localhost:3001/workflow/templates?status=PUBLISHED&page=1&pageSize=10' -H "Authorization: Bearer <access>"

# 2) 发起（formData 必须过模板 formSchema 的必填与类型校验；首层投票人会被解析并快照）
curl -s http://localhost:3001/instances -H "Authorization: Bearer <access>" -H 'Content-Type: application/json' \
  -d '{"templateId":1,"title":"采购服务器","formData":{"amount":12000,"purpose":"扩容","vendorCount":3},"priority":"NORMAL"}'
# → { instanceId, status:"VOTING", node:{...}, voters:[...], actions:[...] }

# 3) 我的待办（投票中心数据源）
curl -s 'http://localhost:3001/votes/pending?page=1&pageSize=20' -H "Authorization: Bearer <access>"

# 4) 看本层进度（本部门可见姓名与选择，跨部门只给聚合计数）
curl -s 'http://localhost:3001/instances/1/vote-progress' -H "Authorization: Bearer <access>"

# 5) 投票 / 改票（结论形成前可反复改；不允许弃权）
curl -s http://localhost:3001/instances/1/votes -H "Authorization: Bearer <access>" -H 'Content-Type: application/json' \
  -d '{"decision":"APPROVE","comment":"同意"}'

# 6) 池内全员表态后填写结论（改判需 NODE_CONCLUDE_OVERRIDE 权限与理由）
curl -s http://localhost:3001/instances/1/conclusion -H "Authorization: Bearer <access>" -H 'Content-Type: application/json' \
  -d '{"decision":"APPROVE","content":"技术部初评通过"}'

# 7) 通过后派任务；任务闭环（接单 → 勾检查项 → 提交 → 验收）
curl -s 'http://localhost:3001/tasks?scope=mine' -H "Authorization: Bearer <access>"
curl -s -X POST http://localhost:3001/tasks/1/accept -H "Authorization: Bearer <access>"
curl -s -X POST http://localhost:3001/tasks/1/checklist/1 -H "Authorization: Bearer <access>" -H 'Content-Type: application/json' -d '{"done":true}'
curl -s -X POST http://localhost:3001/tasks/1/submit -H "Authorization: Bearer <access>"
curl -s -X POST http://localhost:3001/tasks/1/acceptance-pass -H "Authorization: Bearer <access>"
# → 本层任务全部完成后自动开启下一层

# 8) 上报：命中规则时自动建单（也可在 /escalations 中心处理）
curl -s 'http://localhost:3001/escalations?scope=mine' -H "Authorization: Bearer <access>"
curl -s http://localhost:3001/escalations/1/conclusion -H "Authorization: Bearer <access>" -H 'Content-Type: application/json' \
  -d '{"opinion":"CONTINUE","content":"同意继续"}'
```

## 4. 实时通道（Socket.IO）

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:3001/ws', { auth: { token: accessToken } });
socket.on('vote.cast', (payload) => { /* ... */ });
socket.on('conclusion.pending', (payload) => { /* ... */ });
socket.on('escalation.created', (payload) => { /* ... */ });
```

连接后自动加入 `user:{id}` / `dept:{id}` / `workno:{工号}` 房间；
事件名与房间名在 `packages/shared` 的 `WS_EVENTS` / `WS_ROOMS`，前后端同源。

## 5. 后台任务与运维接口

| 接口 | 说明 |
| --- | --- |
| `GET /jobs/status` | 队列模式、各任务周期、Outbox 积压（需 AUDIT_READ） |
| `POST /jobs/run {"job":"outbox-dispatch"}` | 手动触发一次（排障/联调，不依赖队列） |
| `GET /notifications` `/notifications/:id/read` `/notifications/read-all` | 站内通知 |

四个周期任务：`outbox-dispatch`（5s）、`vote-timeout` / `conclusion-timeout` / `escalation-timeout`（各 5min）。
