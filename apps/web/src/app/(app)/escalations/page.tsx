'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { ESCALATION_STATUS_LABEL, ESCALATION_TRIGGER_LABEL } from '@oa/shared';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Pagination } from '@/components/ui/pagination';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/session';

interface EscalationRow {
  id: number;
  code: string;
  status: string;
  level: number;
  triggerType: string;
  fromWorkNo: string | null;
  toWorkNo: string | null;
  reason: string;
  createdAt: string;
  instanceId: number | null;
  instance: { code: string; title: string; status: string } | null;
}

interface Page {
  items: EscalationRow[];
  total: number;
}

interface EscalationDetail extends EscalationRow {
  finalOpinion: string | null;
  writeBackAction: string | null;
  chains: { level: number; deptId: number; workNo: string | null; status: string; actionType: string | null; comment: string | null }[];
  upwardNodes: { id: number; status: string; layerIndex: number; voters: { userId: number; status: string; sourceReason: string | null }[] }[];
  records: { action: string; fromStatus: string | null; toStatus: string | null; comment: string | null; createdAt: string }[];
}

const OPINIONS: { value: string; label: string; hint: string }[] = [
  { value: 'CONTINUE', label: '同意继续', hint: '解冻原流程并恢复投票' },
  { value: 'RETURN', label: '退回原部门', hint: '重走本层投票（讲清哪里不行）' },
  { value: 'REQUEST_MORE', label: '要求补充材料', hint: '解冻流程，由原部门补充后重提' },
  { value: 'FINAL_APPROVE', label: '终审通过', hint: '原流程直接定局通过' },
  { value: 'FINAL_REJECT', label: '终审驳回', hint: '原流程直接驳回' },
];

export default function EscalationsPage() {
  const { mutate } = useSWRConfig();
  const { can } = useSession();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);

  const listKey = `/escalations?scope=${scope}&page=${page}&pageSize=20`;
  const { data, isLoading } = useSWR<Page>(listKey);
  const detailKey = openId ? `/escalations/${openId}` : null;
  const { data: detail } = useSWR<EscalationDetail>(detailKey);

  const columns: Column<EscalationRow>[] = [
    {
      key: 'code',
      header: '上报单',
      render: (row) => (
        <div>
          <div className="font-medium">{row.code}</div>
          <div className="text-xs text-muted-foreground">
            {ESCALATION_TRIGGER_LABEL[row.triggerType as never] ?? row.triggerType}
            {row.instance ? `｜${row.instance.title}` : ''}
          </div>
        </div>
      ),
    },
    { key: 'route', header: '投递', render: (row) => `${row.fromWorkNo ?? '—'} → ${row.toWorkNo ?? '—'}` },
    { key: 'level', header: '层级', render: (row) => `L${row.level}`, hideOnMobile: true },
    { key: 'status', header: '状态', render: (row) => <StatusBadge status={row.status} label={ESCALATION_STATUS_LABEL[row.status as never]} /> },
    { key: 'createdAt', header: '创建', hideOnMobile: true, render: (row) => new Date(row.createdAt).toLocaleString('zh-CN') },
    {
      key: 'action',
      header: '',
      render: (row) => (
        <button type="button" className="oa-button-ghost h-7 px-2" onClick={() => setOpenId(row.id)}>
          处理
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="上报中心"
        description="投递到上级部门工号；上级按同样规则再投票并给结论，回写后原流程解冻或定局"
      />

      <div className="mb-3 flex items-center gap-2">
        <select
          className="oa-input w-40"
          value={scope}
          onChange={(event) => {
            setScope(event.target.value as 'mine' | 'all');
            setPage(1);
          }}
        >
          <option value="mine">我所在工号待受理</option>
          <option value="all">数据范围内全部</option>
        </select>
      </div>

      <div className="oa-card p-0">
        <DataTable columns={columns} rows={data?.items ?? []} loading={isLoading} emptyTitle="没有上报单" />
        <Pagination page={page} pageSize={20} total={data?.total ?? 0} onChange={setPage} />
      </div>

      <Modal open={openId != null} title={detail ? `${detail.code} · ${ESCALATION_STATUS_LABEL[detail.status as never]}` : '上报详情'} onClose={() => setOpenId(null)}>
        {detail ? (
          <div className="space-y-3">
            <div className="rounded border p-2 text-xs">
              <div>{detail.reason}</div>
              <div className="text-muted-foreground">
                {detail.fromWorkNo ?? '—'} → {detail.toWorkNo ?? '—'}｜L{detail.level}
                {detail.instanceId ? (
                  <>
                    ｜
                    <Link href={`/instances/${detail.instanceId}`} className="text-primary hover:underline">
                      查看来源流程
                    </Link>
                  </>
                ) : null}
              </div>
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">逐级链路</div>
              <ul className="space-y-0.5 text-xs">
                {detail.chains.map((chain) => (
                  <li key={chain.level} className="flex items-center gap-2">
                    <span>L{chain.level}</span>
                    <span className="font-mono">{chain.workNo ?? '—'}</span>
                    <StatusBadge status={chain.status} />
                    {chain.actionType ? <span className="text-muted-foreground">{chain.actionType}</span> : null}
                  </li>
                ))}
              </ul>
            </div>

            {detail.upwardNodes.length > 0 ? (
              <div>
                <div className="mb-1 text-sm font-medium">上级投票</div>
                {detail.upwardNodes.map((node) => (
                  <div key={node.id} className="rounded border p-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span>L{node.layerIndex}</span>
                      <StatusBadge status={node.status} />
                      <span className="text-muted-foreground">应投票 {node.voters.length} 人</span>
                    </div>
                    <div className="text-muted-foreground">
                      {node.voters.map((voter) => `#${voter.userId} ${voter.status}`).join('、')}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {detail.status === 'PENDING_CONCLUSION' && can('ESC_CONCLUDE') ? (
              <ConclusionForm
                escalationId={detail.id}
                onDone={async () => {
                  await Promise.all([mutate(detailKey), mutate(listKey)]);
                }}
              />
            ) : null}

            {can('ESC_UPGRADE') && detail.status !== 'CLOSED' ? (
              <UpgradeForm
                escalationId={detail.id}
                onDone={async () => {
                  await Promise.all([mutate(detailKey), mutate(listKey)]);
                }}
              />
            ) : null}

            {detail.finalOpinion ? (
              <div className="rounded border p-2 text-xs">
                <div className="text-muted-foreground">上级结论（{detail.writeBackAction}）</div>
                <div>{detail.finalOpinion}</div>
              </div>
            ) : null}

            <div>
              <div className="mb-1 text-sm font-medium">处理记录</div>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {detail.records.map((record, index) => (
                  <li key={index}>
                    {new Date(record.createdAt).toLocaleString('zh-CN')}｜{record.action}
                    {record.comment ? `：${record.comment}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}

function ConclusionForm({ escalationId, onDone }: { escalationId: number; onDone: () => Promise<void> }) {
  const [opinion, setOpinion] = useState('CONTINUE');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/escalations/${escalationId}/conclusion`, { opinion, content });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message}${err.detail ? `（${err.detail}）` : ''}` : '提交失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded border p-2">
      <div className="text-sm font-medium">上级结论</div>
      <select className="oa-input" value={opinion} onChange={(event) => setOpinion(event.target.value)}>
        {OPINIONS.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}（{item.hint}）
          </option>
        ))}
      </select>
      <input className="oa-input" placeholder="结论意见（必填）" value={content} onChange={(event) => setContent(event.target.value)} maxLength={4000} />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <button type="button" className="oa-button" disabled={busy || content.trim().length === 0} onClick={() => void submit()}>
        提交并回写原流程
      </button>
    </div>
  );
}

function UpgradeForm({ escalationId, onDone }: { escalationId: number; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-2 rounded border p-2">
      <input className="oa-input" placeholder="继续上报上一级的原因" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
      <button
        type="button"
        className="oa-button-ghost shrink-0"
        disabled={busy || reason.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          try {
            await api.post(`/escalations/${escalationId}/upgrade`, { reason });
            await onDone();
            setReason('');
          } finally {
            setBusy(false);
          }
        }}
      >
        上溯一级
      </button>
    </div>
  );
}
