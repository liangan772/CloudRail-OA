'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { INSTANCE_STATUS_LABEL, INSTANCE_NODE_STATUS_LABEL } from '@oa/shared';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination } from '@/components/ui/pagination';
import { useSession } from '@/lib/session';

interface PendingVote {
  nodeId: number;
  instanceId: number;
  instanceCode: string;
  title: string;
  instanceStatus: string;
  nodeStatus: string;
  layerIndex: number;
  deadline: string | null;
  myStatus: string;
  myDecision: string | null;
  needConclusion: boolean;
  voterCount: number;
}

interface Page {
  items: PendingVote[];
  total: number;
}

const DECISION_LABEL: Record<string, string> = { APPROVE: '已同意', REJECT: '已反对' };

export default function VotesPage() {
  const { can } = useSession();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSWR<Page>(`/votes/pending?page=${page}&pageSize=20`);

  const columns: Column<PendingVote>[] = [
    {
      key: 'title',
      header: '流程',
      render: (row) => (
        <div>
          <Link href={`/instances/${row.instanceId}`} className="font-medium hover:underline">
            {row.title}
          </Link>
          <div className="text-xs text-muted-foreground">
            {row.instanceCode}｜第 {row.layerIndex} 层｜应投票 {row.voterCount} 人
          </div>
        </div>
      ),
    },
    { key: 'instanceStatus', header: '流程状态', render: (row) => <StatusBadge status={row.instanceStatus} label={INSTANCE_STATUS_LABEL[row.instanceStatus as never]} />, hideOnMobile: true },
    { key: 'nodeStatus', header: '本层', render: (row) => <StatusBadge status={row.nodeStatus} label={INSTANCE_NODE_STATUS_LABEL[row.nodeStatus as never]} /> },
    {
      key: 'mine',
      header: '我的状态',
      render: (row) =>
        row.needConclusion ? (
          <span className="text-warning">待填结论</span>
        ) : row.myDecision ? (
          <span className="text-muted-foreground">{DECISION_LABEL[row.myDecision] ?? row.myDecision}</span>
        ) : (
          <span className="text-info">待表态</span>
        ),
    },
    {
      key: 'deadline',
      header: '截止',
      hideOnMobile: true,
      render: (row) => (row.deadline ? new Date(row.deadline).toLocaleString('zh-CN') : '—'),
    },
    {
      key: 'action',
      header: '',
      render: (row) => (
        <Link href={`/instances/${row.instanceId}`} className="oa-button-ghost h-7 px-2">
          去处理
        </Link>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="投票中心"
        description="待我表态与待我填写结论的层级；明细可见范围由后端按部门过滤"
        actions={
          can('INSTANCE_CREATE') ? (
            <Link href="/instances/new" className="oa-button">
              发起流程
            </Link>
          ) : null
        }
      />
      <div className="oa-card p-0">
        <DataTable
          columns={columns}
          rows={(data?.items ?? []).map((item) => ({ ...item, id: item.nodeId }))}
          loading={isLoading}
          emptyTitle="没有待你处理的投票"
          emptyDescription="你所在的层级都已表态，或当前没有进行中的流程。"
        />
        <Pagination page={page} pageSize={20} total={data?.total ?? 0} onChange={setPage} />
      </div>
    </>
  );
}
