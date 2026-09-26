'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { INSTANCE_STATUS_LABEL } from '@oa/shared';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination } from '@/components/ui/pagination';
import { useSession } from '@/lib/session';

interface InstanceRow {
  id: number;
  code: string;
  title: string;
  status: string;
  layerIndex: number;
  initiator: { id: number; name: string | null };
  template: { id: number; name: string; category: string };
  counts: { nodes: number; tasks: number; escalations: number };
  startedAt: string | null;
  createdAt: string;
}

interface Page {
  items: InstanceRow[];
  total: number;
}

const STATUS_OPTIONS = ['', 'VOTING', 'APPROVED', 'REJECTED', 'ESCALATED', 'CLOSED'];

export default function InstancesPage() {
  const { can } = useSession();
  const router = useRouter();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const query = `/instances?scope=${scope}&page=${page}&pageSize=20${status ? `&status=${status}` : ''}`;
  const { data, isLoading } = useSWR<Page>(query);

  const columns: Column<InstanceRow>[] = [
    {
      key: 'title',
      header: '流程',
      render: (row) => (
        <div>
          <div className="font-medium">{row.title}</div>
          <div className="text-xs text-muted-foreground">
            {row.code}｜{row.template.name}
          </div>
        </div>
      ),
    },
    { key: 'initiator', header: '发起人', render: (row) => row.initiator.name ?? '—', hideOnMobile: true },
    { key: 'layerIndex', header: '当前层', render: (row) => `第 ${row.layerIndex} 层`, hideOnMobile: true },
    {
      key: 'counts',
      header: '关联',
      hideOnMobile: true,
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          任务 {row.counts.tasks}｜上报 {row.counts.escalations}
        </span>
      ),
    },
    { key: 'status', header: '状态', render: (row) => <StatusBadge status={row.status} label={INSTANCE_STATUS_LABEL[row.status as never]} /> },
    {
      key: 'createdAt',
      header: '创建时间',
      hideOnMobile: true,
      render: (row) => new Date(row.createdAt).toLocaleString('zh-CN'),
    },
  ];

  return (
    <>
      <PageHeader
        title="流程实例"
        description="我发起的与数据范围内的流程；点行看各层投票人、结论与上报链路"
        actions={
          can('INSTANCE_CREATE') ? (
            <Link href="/instances/new" className="oa-button">
              发起流程
            </Link>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="oa-input w-32" value={scope} onChange={(event) => { setScope(event.target.value as 'mine' | 'all'); setPage(1); }}>
          <option value="mine">我发起的</option>
          <option value="all">数据范围内</option>
        </select>
        <select className="oa-input w-36" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          {STATUS_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value ? INSTANCE_STATUS_LABEL[value as never] : '全部状态'}
            </option>
          ))}
        </select>
      </div>

      <div className="oa-card p-0">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          loading={isLoading}
          emptyTitle="没有符合条件的流程"
          onRowClick={(row) => router.push(`/instances/${row.id}`)}
        />
        <Pagination page={page} pageSize={20} total={data?.total ?? 0} onChange={setPage} />
      </div>
    </>
  );
}
