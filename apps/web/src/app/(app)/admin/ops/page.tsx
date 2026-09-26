'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Activity, CheckCircle2, Database, HardDrive, RefreshCw, RotateCcw, Zap } from 'lucide-react';
import { api } from '@/lib/api-client';
import { runAction } from '@/lib/action';
import { Button } from '@/components/ui/button';
import { Card, SectionTitle } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tooltip } from '@/components/ui/tooltip';
import { OUTBOX_STATUS_LABEL, type OutboxStatus } from '@oa/shared';

interface Runtime {
  jobs: { mode: string; schedule: Record<string, number> };
  outbox: {
    pending: number;
    processing: number;
    sent: number;
    failed: number;
    dead: number;
    problem: number;
    oldestPendingAt: string | null;
    oldestPendingEvent: string | null;
  };
  channels: { wecom: boolean; dingtalk: boolean; feishu: boolean; mail: boolean; sms: boolean };
  storage: { driver: string; localDir: string };
  workerMode: string;
}

interface OutboxRow {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  status: OutboxStatus;
  retries: number;
  lastError: string | null;
  availableAt: string;
  processedAt: string | null;
  createdAt: string;
}

const JOB_LABEL: Record<string, string> = {
  'outbox-dispatch': '发件箱派发',
  'vote-timeout': '投票超时扫描',
  'conclusion-timeout': '结论超时扫描',
  'escalation-timeout': '上报超时扫描',
};

export default function AdminOpsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'FAILED' | 'DEAD' | 'PENDING' | 'SENT' | 'PROCESSING' | ''>('FAILED');

  const { data: runtime, mutate: mutateRuntime } = useSWR<Runtime>('/admin/ops/runtime', { refreshInterval: 30_000 });
  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (statusFilter) query.set('status', statusFilter);
  const { data: outbox, isLoading, mutate: mutateOutbox } = useSWR<{ items: OutboxRow[]; total: number }>(
    `/admin/ops/outbox?${query.toString()}`,
  );

  const refreshAll = () => {
    void mutateRuntime();
    void mutateOutbox();
  };

  const replayOne = async (row: OutboxRow) => {
    const result = await runAction(() => api.post('/admin/ops/outbox/replay', { ids: [row.id] }), { success: '已重新入队' });
    if (result.ok) refreshAll();
  };

  const replayAllProblem = async () => {
    const ids = (outbox?.items ?? []).filter((row) => row.status === 'FAILED' || row.status === 'DEAD').map((row) => row.id);
    if (ids.length === 0) return;
    const result = await runAction(() => api.post('/admin/ops/outbox/replay', { ids }), { success: `已重新入队 ${ids.length} 条` });
    if (result.ok) refreshAll();
  };

  const dispatchNow = async () => {
    const result = await runAction(() => api.post('/admin/ops/dispatch', {}), { success: '已触发一轮派发' });
    if (result.ok) refreshAll();
  };

  const columns: Column<OutboxRow>[] = [
    {
      key: 'createdAt',
      header: '创建时间',
      sortValue: (row) => row.createdAt,
      render: (row) => <span className="tabular text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString('zh-CN')}</span>,
    },
    {
      key: 'eventType',
      header: '事件',
      render: (row) => (
        <span className="text-xs">
          <span className="block font-mono">{row.eventType}</span>
          <span className="block text-muted-foreground">
            {row.aggregateType} #{row.aggregateId}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      sortValue: (row) => row.status,
      render: (row) => <StatusBadge status={row.status} label={OUTBOX_STATUS_LABEL[row.status]} />,
    },
    {
      key: 'retries',
      header: '重试',
      align: 'right',
      hideOnMobile: true,
      render: (row) => <span className="tabular text-xs">{row.retries}</span>,
    },
    {
      key: 'lastError',
      header: '最后错误',
      hideOnMobile: true,
      render: (row) =>
        row.lastError ? (
          <Tooltip content={row.lastError}>
            <span className="oa-truncate-2 block max-w-xs text-xs text-danger">{row.lastError}</span>
          </Tooltip>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'actions',
      header: '操作',
      align: 'right',
      render: (row) =>
        row.status === 'FAILED' || row.status === 'DEAD' ? (
          <Button size="sm" variant="secondary" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => replayOne(row)}>
            重放
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <section>
        <SectionTitle
          title="运行态"
          description="每 30 秒自动刷新"
          actions={
            <>
              <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={refreshAll}>
                刷新
              </Button>
              <Button size="sm" variant="secondary" icon={<Zap className="h-3.5 w-3.5" />} onClick={dispatchNow}>
                立即派发
              </Button>
            </>
          }
        />

        {!runtime ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="oa-card oa-card-pad space-y-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-7 w-12" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="后台任务模式"
              value={runtime.jobs.mode === 'queue' ? 'BullMQ' : runtime.jobs.mode === 'in-process' ? '进程内' : '已停止'}
              icon={<Activity className="h-3.5 w-3.5" />}
              tone={runtime.jobs.mode === 'stopped' ? 'danger' : 'success'}
              hint={runtime.jobs.mode === 'in-process' ? '未配置 Redis，功能不降级但无法多实例' : undefined}
            />
            <StatCard
              label="待投递事件"
              value={runtime.outbox.pending}
              icon={<Database className="h-3.5 w-3.5" />}
              tone={runtime.outbox.pending > 50 ? 'warning' : 'primary'}
              hint={runtime.outbox.oldestPendingAt ? `最老一条：${new Date(runtime.outbox.oldestPendingAt).toLocaleTimeString('zh-CN')}` : '没有积压'}
            />
            <StatCard
              label="投递异常"
              value={runtime.outbox.problem}
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              tone={runtime.outbox.problem > 0 ? 'danger' : 'success'}
              hint={`失败 ${runtime.outbox.failed} · 已放弃 ${runtime.outbox.dead}`}
            />
            <StatCard
              label="已投递"
              value={runtime.outbox.sent}
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              tone="neutral"
              hint={`投递中 ${runtime.outbox.processing}`}
            />
          </div>
        )}
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="周期任务" description="四种任务共用一个执行入口，队列与进程内模式行为一致">
          {!runtime ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-4 w-full" />
              ))}
            </div>
          ) : (
            <ul className="space-y-2.5 text-sm">
              {Object.entries(runtime.jobs.schedule).map(([job, interval]) => (
                <li key={job} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{JOB_LABEL[job] ?? job}</span>
                  <span className="tabular font-mono text-xs">{formatInterval(interval)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="运行配置" description="只读展示，修改需调整环境变量并重启">
          {!runtime ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-4 w-full" />
              ))}
            </div>
          ) : (
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <HardDrive className="h-3.5 w-3.5" />
                  附件存储
                </span>
                <span className="font-mono text-xs">{runtime.storage.driver}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">存储目录</span>
                <span className="truncate font-mono text-xs">{runtime.storage.localDir}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Worker 模式</span>
                <span className="font-mono text-xs">{runtime.workerMode}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">IM 渠道</span>
                <span className="flex gap-1">
                  {(['wecom', 'dingtalk', 'feishu'] as const).map((key) => (
                    <span
                      key={key}
                      className={
                        runtime.channels[key]
                          ? 'oa-chip border-success/20 bg-success-subtle text-success'
                          : 'oa-chip border-border bg-muted text-muted-foreground'
                      }
                    >
                      {key === 'wecom' ? '企微' : key === 'dingtalk' ? '钉钉' : '飞书'}
                    </span>
                  ))}
                </span>
              </li>
            </ul>
          )}
        </Card>
      </div>

      <Card
        pad={false}
        title="发件箱事件"
        description={`共 ${outbox?.total ?? 0} 条 · 投递失败的事件可人工重放`}
        actions={
          <Button size="sm" variant="secondary" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={replayAllProblem}>
            批量重放本页
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          {(['', 'FAILED', 'DEAD', 'PENDING', 'PROCESSING', 'SENT'] as const).map((value) => (
            <button
              key={value || 'all'}
              type="button"
              onClick={() => {
                setStatusFilter(value);
                setPage(1);
              }}
              className={
                statusFilter === value
                  ? 'rounded-md border border-primary/30 bg-primary-subtle px-2.5 py-1 text-xs font-medium text-primary'
                  : 'rounded-md border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted'
              }
            >
              {value ? OUTBOX_STATUS_LABEL[value] : '全部'}
            </button>
          ))}
        </div>

        <DataTable
          columns={columns}
          rows={outbox?.items ?? []}
          loading={isLoading}
          emptyTitle={statusFilter === 'FAILED' ? '没有投递失败的事件' : '没有匹配的事件'}
          emptyDescription={statusFilter === 'FAILED' ? '发件箱运行正常。' : '换个状态筛选看看。'}
        />

        {outbox ? <Pagination page={page} pageSize={20} total={outbox.total} onChange={setPage} className="border-t" /> : null}
      </Card>
    </div>
  );
}

function formatInterval(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${ms / 1000}s`;
  return `${ms / 60_000}min`;
}
