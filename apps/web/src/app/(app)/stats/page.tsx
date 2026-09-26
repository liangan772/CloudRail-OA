'use client';

import useSWR from 'swr';
import { PageHeader } from '@/components/ui/page-header';

interface CountPage {
  total: number;
  items: unknown[];
}

interface TaskRow {
  id: number;
  status: string;
  overdue: boolean;
}

export default function StatsPage() {
  const { data: instances } = useSWR<CountPage>('/instances?scope=all&page=1&pageSize=1');
  const { data: tasks } = useSWR<{ items: TaskRow[]; total: number }>('/tasks?scope=all&page=1&pageSize=100');
  const { data: escalations } = useSWR<CountPage>('/escalations?scope=all&page=1&pageSize=1');
  const { data: jobs } = useSWR<{ mode: string; outbox: { pending: number; dead: number } }>('/jobs/status');

  const taskList = tasks?.items ?? [];
  const overdue = taskList.filter((task) => task.overdue).length;
  const blocked = taskList.filter((task) => task.status === 'BLOCKED').length;

  return (
    <>
      <PageHeader title="统计" description="按数据范围统计的流程、任务与上报；更细的报表与趋势图在后续版本补充" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="流程实例" value={instances?.total} />
        <Metric label="任务" value={tasks?.total} hint={`逾期 ${overdue}｜阻塞 ${blocked}`} />
        <Metric label="上报单" value={escalations?.total} />
        <Metric
          label="事件投递"
          value={jobs?.outbox.pending}
          hint={`模式 ${jobs?.mode ?? '—'}｜死信 ${jobs?.outbox.dead ?? 0}`}
        />
      </div>

      <div className="oa-card mt-4">
        <h2 className="mb-2 text-sm font-medium">任务状态分布（最近 100 条）</h2>
        <TaskBreakdown rows={taskList} />
      </div>
    </>
  );
}

function Metric({ label, value, hint }: { label: string; value?: number; hint?: string }) {
  return (
    <div className="oa-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value ?? '—'}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function TaskBreakdown({ rows }: { rows: TaskRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">暂无数据</p>;
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  const total = rows.length;

  return (
    <ul className="space-y-2">
      {[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([status, count]) => (
        <li key={status} className="flex items-center gap-3 text-sm">
          <span className="w-32 shrink-0 text-xs text-muted-foreground">{status}</span>
          <span className="h-2 flex-1 overflow-hidden rounded bg-muted">
            <span className="block h-full bg-primary" style={{ width: `${(count / total) * 100}%` }} />
          </span>
          <span className="w-10 shrink-0 text-right text-xs">{count}</span>
        </li>
      ))}
    </ul>
  );
}
