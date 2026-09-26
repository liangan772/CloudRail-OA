'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Download, Eye, Filter, Search } from 'lucide-react';
import { api } from '@/lib/api-client';
import { errorText, runAction } from '@/lib/action';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Field } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Pagination } from '@/components/ui/pagination';
import { StatusBadge } from '@/components/ui/status-badge';

interface AuditRow {
  id: string;
  createdAt: string;
  actorId: number | null;
  actor: { id: number; name: string; email: string } | null;
  action: string;
  targetType: string;
  targetId: string;
  traceId: string | null;
  before: unknown;
  after: unknown;
}

interface Facets {
  actions: { value: string; count: number }[];
  targetTypes: { value: string; count: number }[];
  actors: { id: number; name: string }[];
}

const TARGET_LABEL: Record<string, string> = {
  INSTANCE: '流程实例',
  NODE: '实例节点',
  TASK: '任务',
  ESCALATION: '上报单',
  USER: '用户',
  ROLE: '角色',
  DEPARTMENT: '部门',
  WORKNO: '部门工号',
  SYSTEM: '系统',
  OUTBOX: '发件箱',
};

export default function AdminAuditPage() {
  const { can } = useSession();
  const canExport = can('AUDIT_EXPORT');

  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState({ keyword: '', action: '', targetType: '', actorId: '', from: '', to: '' });
  const [applied, setApplied] = useState(draft);
  const [showFilters, setShowFilters] = useState(false);
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  for (const [key, value] of Object.entries(applied)) if (value) query.set(key, value);

  const { data, isLoading } = useSWR<{ items: AuditRow[]; total: number }>(`/admin/audit?${query.toString()}`);
  const { data: facets } = useSWR<Facets>('/admin/audit/facets');

  const apply = () => {
    setApplied(draft);
    setPage(1);
  };

  const reset = () => {
    const empty = { keyword: '', action: '', targetType: '', actorId: '', from: '', to: '' };
    setDraft(empty);
    setApplied(empty);
    setPage(1);
  };

  const exportCsv = async () => {
    const result = await runAction(
      () => api.post<{ filename: string; content: string; rows: number }>('/admin/audit/export', applied),
      { success: '导出完成' },
    );
    if (!result.ok || !result.data) return;

    // 后端返回内容而不是流，这里自己落盘 —— 避免绕过统一响应包裹层
    const blob = new Blob([result.data.content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.data.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<AuditRow>[] = [
    {
      key: 'createdAt',
      header: '时间',
      sortValue: (row) => row.createdAt,
      render: (row) => <span className="tabular text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString('zh-CN')}</span>,
    },
    {
      key: 'actor',
      header: '操作人',
      render: (row) => (
        <span className="text-xs">
          {row.actor ? (
            <>
              <span className="block">{row.actor.name}</span>
              <span className="block truncate text-muted-foreground">{row.actor.email}</span>
            </>
          ) : (
            <span className="text-muted-foreground">系统</span>
          )}
        </span>
      ),
    },
    {
      key: 'action',
      header: '动作',
      sortValue: (row) => row.action,
      render: (row) => <span className="font-mono text-xs">{row.action}</span>,
    },
    {
      key: 'target',
      header: '对象',
      render: (row) => (
        <span className="text-xs">
          <span className="block">{TARGET_LABEL[row.targetType] ?? row.targetType}</span>
          <span className="block font-mono text-muted-foreground">#{row.targetId}</span>
        </span>
      ),
    },
    {
      key: 'traceId',
      header: 'traceId',
      hideOnMobile: true,
      render: (row) => <span className="font-mono text-2xs text-muted-foreground">{row.traceId?.slice(0, 12) ?? '—'}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      align: 'right',
      render: (row) => (
        <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => setDetail(row)}>
          详情
        </Button>
      ),
    },
  ];

  const activeFilterCount = Object.values(applied).filter(Boolean).length;

  return (
    <div className="space-y-4">
      <Card
        pad={false}
        title="审计日志"
        description={`共 ${data?.total ?? 0} 条 · 全量写操作记录，保留 3 年`}
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              icon={<Filter className="h-3.5 w-3.5" />}
              onClick={() => setShowFilters((value) => !value)}
            >
              筛选{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Button>
            {canExport ? (
              <Button size="sm" variant="primary" icon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv}>
                导出 CSV
              </Button>
            ) : null}
          </>
        }
      >
        {showFilters ? (
          <div className="border-b bg-[hsl(var(--surface))] px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="关键词" hint="动作 / 对象类型 / 对象ID / traceId">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    className="oa-input h-8 pl-8 text-xs"
                    value={draft.keyword}
                    onChange={(event) => setDraft({ ...draft, keyword: event.target.value })}
                  />
                </div>
              </Field>
              <Field label="动作">
                <select className="oa-input h-8 text-xs" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
                  <option value="">全部动作</option>
                  {(facets?.actions ?? []).map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.value}（{item.count}）
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="对象类型">
                <select
                  className="oa-input h-8 text-xs"
                  value={draft.targetType}
                  onChange={(e) => setDraft({ ...draft, targetType: e.target.value })}
                >
                  <option value="">全部对象</option>
                  {(facets?.targetTypes ?? []).map((item) => (
                    <option key={item.value} value={item.value}>
                      {TARGET_LABEL[item.value] ?? item.value}（{item.count}）
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="操作人">
                <select className="oa-input h-8 text-xs" value={draft.actorId} onChange={(e) => setDraft({ ...draft, actorId: e.target.value })}>
                  <option value="">全部操作人</option>
                  {(facets?.actors ?? []).map((actor) => (
                    <option key={actor.id} value={actor.id}>
                      {actor.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="起始日期">
                <input type="date" className="oa-input h-8 text-xs" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
              </Field>
              <Field label="结束日期">
                <input type="date" className="oa-input h-8 text-xs" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
              </Field>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={reset}>
                重置
              </Button>
              <Button size="sm" variant="primary" onClick={apply}>
                应用筛选
              </Button>
            </div>
          </div>
        ) : null}

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          loading={isLoading}
          emptyTitle="没有匹配的审计记录"
          emptyDescription="调整筛选条件，或确认是否已经发生过写操作。"
        />

        {data ? <Pagination page={page} pageSize={20} total={data.total} onChange={setPage} className="border-t" /> : null}
      </Card>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title="审计详情"
        description={detail ? `${detail.action} · ${new Date(detail.createdAt).toLocaleString('zh-CN')}` : undefined}
        width="lg"
      >
        {detail ? (
          <div className="space-y-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">操作人</dt>
                <dd>{detail.actor ? `${detail.actor.name}（${detail.actor.email}）` : '系统'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">对象</dt>
                <dd>
                  {TARGET_LABEL[detail.targetType] ?? detail.targetType} <span className="font-mono">#{detail.targetId}</span>
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">traceId</dt>
                <dd className="font-mono text-xs">{detail.traceId ?? '—'}</dd>
              </div>
            </dl>

            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <StatusBadge status="PENDING" label="变更前" />
                </h3>
                <pre className="oa-scroll-area max-h-72 rounded-md border bg-[hsl(var(--surface))] p-3 font-mono text-xs leading-relaxed">
                  {detail.before === null || detail.before === undefined ? '—' : JSON.stringify(detail.before, null, 2)}
                </pre>
              </div>
              <div>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <StatusBadge status="ACTIVE" label="变更后" />
                </h3>
                <pre className="oa-scroll-area max-h-72 rounded-md border bg-[hsl(var(--surface))] p-3 font-mono text-xs leading-relaxed">
                  {detail.after === null || detail.after === undefined ? '—' : JSON.stringify(detail.after, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
