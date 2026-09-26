'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { TASK_STATUS_LABEL, TASK_PRIORITY_LABEL } from '@oa/shared';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination } from '@/components/ui/pagination';
import { Modal } from '@/components/ui/modal';
import { TaskActions, type TaskDetail } from '@/components/business/task-actions';

interface TaskRow {
  id: number;
  code: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  completedAt: string | null;
  instanceId: number | null;
  owner: string | null;
  acceptor: string | null;
  overdue: boolean;
}

interface Page {
  items: TaskRow[];
  total: number;
}

export default function TasksPage() {
  const { mutate } = useSWRConfig();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);

  const listKey = `/tasks?scope=${scope}&page=${page}&pageSize=20${status ? `&status=${status}` : ''}`;
  const { data, isLoading } = useSWR<Page>(listKey);
  const detailKey = openTaskId ? `/tasks/${openTaskId}` : null;
  const { data: detail } = useSWR<TaskDetail>(detailKey);

  const columns: Column<TaskRow>[] = [
    {
      key: 'title',
      header: '任务',
      render: (row) => (
        <div>
          <div className="font-medium">
            {row.title}
            {row.overdue ? <span className="ml-2 text-xs text-danger">已逾期</span> : null}
          </div>
          <div className="text-xs text-muted-foreground">
            {row.code}
            {row.instanceId ? `｜流程 #${row.instanceId}` : ''}
          </div>
        </div>
      ),
    },
    { key: 'priority', header: '优先级', render: (row) => TASK_PRIORITY_LABEL[row.priority as never] ?? row.priority, hideOnMobile: true },
    { key: 'owner', header: '负责人', render: (row) => row.owner ?? '—', hideOnMobile: true },
    { key: 'acceptor', header: '验收人', render: (row) => row.acceptor ?? '—', hideOnMobile: true },
    { key: 'status', header: '状态', render: (row) => <StatusBadge status={row.status} label={TASK_STATUS_LABEL[row.status as never]} /> },
    {
      key: 'dueAt',
      header: '截止',
      hideOnMobile: true,
      render: (row) => (row.dueAt ? new Date(row.dueAt).toLocaleString('zh-CN') : '—'),
    },
    {
      key: 'action',
      header: '',
      render: (row) => (
        <button type="button" className="oa-button-ghost h-7 px-2" onClick={() => setOpenTaskId(row.id)}>
          处理
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="任务中心"
        description="接单 → 勾检查项 → 提交验收 → 验收；本层任务全部完成后自动进入下一层投票"
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className="oa-input w-32"
          value={scope}
          onChange={(event) => {
            setScope(event.target.value as 'mine' | 'all');
            setPage(1);
          }}
        >
          <option value="mine">我参与的</option>
          <option value="all">数据范围内</option>
        </select>
        <select
          className="oa-input w-36"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">全部状态</option>
          {['PENDING_ASSIGN', 'PENDING_ACCEPT', 'IN_PROGRESS', 'BLOCKED', 'PENDING_ACCEPTANCE', 'DONE', 'CANCELLED'].map((value) => (
            <option key={value} value={value}>
              {TASK_STATUS_LABEL[value as never]}
            </option>
          ))}
        </select>
        <Link href="/instances" className="text-xs text-primary hover:underline">
          按流程查看
        </Link>
      </div>

      <div className="oa-card p-0">
        <DataTable columns={columns} rows={data?.items ?? []} loading={isLoading} emptyTitle="没有任务" emptyDescription="流程通过后会自动派发任务。" />
        <Pagination page={page} pageSize={20} total={data?.total ?? 0} onChange={setPage} />
      </div>

      <Modal open={openTaskId != null} title={detail?.title ?? '任务详情'} onClose={() => setOpenTaskId(null)}>
        {detail ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{detail.code}</span>
              <StatusBadge status={detail.status} label={TASK_STATUS_LABEL[detail.status as never]} />
              {detail.instanceId ? (
                <Link href={`/instances/${detail.instanceId}`} className="text-primary hover:underline">
                  查看来源流程
                </Link>
              ) : null}
            </div>
            <TaskActions
              task={detail}
              onDone={async () => {
                await Promise.all([mutate(detailKey), mutate(listKey)]);
              }}
            />
            <div>
              <div className="mb-1 text-sm font-medium">操作记录</div>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {detail.logs.map((log, index) => (
                  <li key={index}>
                    {new Date(log.createdAt).toLocaleString('zh-CN')}｜{log.action}
                    {log.toStatus ? ` → ${TASK_STATUS_LABEL[log.toStatus as never] ?? log.toStatus}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">加载中…</p>
        )}
      </Modal>
    </>
  );
}
