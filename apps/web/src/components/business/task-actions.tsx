'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api-client';

interface Checklist {
  id: number;
  content: string;
  done: boolean;
}

interface Assignee {
  userId: number;
  role: string;
  isActive: boolean;
  user: { name: string };
}

export interface TaskDetail {
  id: number;
  code: string;
  title: string;
  status: string;
  instanceId: number | null;
  instanceNodeId: number | null;
  dueAt: string | null;
  blockedReason: string | null;
  progress: number;
  assignees: Assignee[];
  checklists: Checklist[];
  checklistProgress: { total: number; done: number };
  logs: { action: string; fromStatus: string | null; toStatus: string | null; createdAt: string }[];
}

// 任务动作：接单 → 勾检查项 → 提交验收 → 验收通过/打回；另有阻塞与重开。
// 提交验收前必须检查项全完成（后端也会拦），所以这里按 checklistProgress 直接禁用按钮。
export function TaskActions({
  task,
  onDone,
}: {
  task: TaskDetail;
  onDone: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message}${err.detail ? `（${err.detail}）` : ''}` : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const checklistDone = task.checklistProgress.total === 0 || task.checklistProgress.done === task.checklistProgress.total;

  return (
    <div className="space-y-3">
      <div className="rounded border p-2 text-xs text-muted-foreground">
        负责人：{task.assignees.find((item) => item.role === 'OWNER' && item.isActive)?.user.name ?? '—'}｜验收人：
        {task.assignees.find((item) => item.role === 'ACCEPTOR' && item.isActive)?.user.name ?? '—'}
        {task.dueAt ? `｜截止 ${new Date(task.dueAt).toLocaleString('zh-CN')}` : ''}
        {task.blockedReason ? `｜阻塞：${task.blockedReason}` : ''}
      </div>

      <div>
        <div className="mb-1 text-sm font-medium">
          检查项 {task.checklistProgress.done}/{task.checklistProgress.total}
        </div>
        <ul className="space-y-1 text-sm">
          {task.checklists.map((item) => (
            <li key={item.id}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={busy || (task.status !== 'IN_PROGRESS' && task.status !== 'OVERDUE')}
                  onChange={(event) => void run(() => api.post(`/tasks/${task.id}/checklist/${item.id}`, { done: event.target.checked }))}
                />
                {item.content}
              </label>
            </li>
          ))}
        </ul>
      </div>

      <label className="block space-y-1">
        <span className="text-sm">说明 / 打回原因</span>
        <input className="oa-input" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} />
      </label>

      <div className="flex flex-wrap gap-2">
        {task.status === 'PENDING_ACCEPT' ? (
          <>
            <button type="button" className="oa-button" disabled={busy} onClick={() => void run(() => api.post(`/tasks/${task.id}/accept`))}>
              接单
            </button>
            <button
              type="button"
              className="oa-button-ghost"
              disabled={busy || comment.trim().length < 2}
              onClick={() => void run(() => api.post(`/tasks/${task.id}/reject-assign`, { reason: comment }))}
            >
              拒绝接单
            </button>
          </>
        ) : null}

        {task.status === 'IN_PROGRESS' || task.status === 'OVERDUE' ? (
          <>
            <button
              type="button"
              className="oa-button"
              disabled={busy || !checklistDone}
              onClick={() => void run(() => api.post(`/tasks/${task.id}/submit`, { comment }))}
            >
              提交验收
            </button>
            <button
              type="button"
              className="oa-button-ghost"
              disabled={busy || comment.trim().length < 2}
              onClick={() => void run(() => api.post(`/tasks/${task.id}/block`, { reason: comment }))}
            >
              标记阻塞
            </button>
          </>
        ) : null}

        {task.status === 'BLOCKED' ? (
          <button type="button" className="oa-button" disabled={busy} onClick={() => void run(() => api.post(`/tasks/${task.id}/unblock`))}>
            解除阻塞
          </button>
        ) : null}

        {task.status === 'PENDING_ACCEPTANCE' || task.status === 'OVERDUE' ? (
          <>
            <button
              type="button"
              className="oa-button"
              disabled={busy}
              onClick={() => void run(() => api.post(`/tasks/${task.id}/acceptance-pass`, { comment }))}
            >
              验收通过
            </button>
            <button
              type="button"
              className="oa-button-ghost"
              disabled={busy || comment.trim().length < 2}
              onClick={() => void run(() => api.post(`/tasks/${task.id}/acceptance-reject`, { reason: comment }))}
            >
              打回
            </button>
          </>
        ) : null}

        {task.status === 'DONE' ? (
          <button
            type="button"
            className="oa-button-ghost"
            disabled={busy || comment.trim().length < 2}
            onClick={() => void run(() => api.post(`/tasks/${task.id}/reopen`, { reason: comment }))}
          >
            重开
          </button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {!checklistDone && (task.status === 'IN_PROGRESS' || task.status === 'OVERDUE') ? (
        <p className="text-xs text-muted-foreground">检查项全部完成后才能提交验收。</p>
      ) : null}
    </div>
  );
}
