'use client';

import { useParams } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { INSTANCE_NODE_STATUS_LABEL, INSTANCE_STATUS_LABEL, VOTER_STATUS_LABEL } from '@oa/shared';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { VoteProgressBar } from '@/components/ui/progress-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { VoteActions } from '@/components/business/vote-actions';

interface NodeVoter {
  userId: number;
  name: string | null;
  weight: number;
  status: string;
  absentReason: string | null;
}

interface InstanceNode {
  id: number;
  name: string;
  status: string;
  layerIndex: number;
  round: number;
  deadline: string | null;
  vetoLocked: boolean;
  conclusionStatus: string;
  conclusions: { round: number; decision: string; isOverride: boolean; overrideReason: string | null; content: string; createdAt: string }[];
  voters: NodeVoter[];
  pendingEscalation: { triggers?: { triggerLabel: string; reason: string }[] } | null;
}

interface InstanceDetail {
  id: number;
  code: string;
  title: string;
  status: string;
  layerIndex: number;
  currentNodeId: number | null;
  suspendedFrom: string | null;
  formData: Record<string, unknown>;
  template: { id: number; name: string; category: string };
  initiator: { id: number; name: string; department: string | null };
  nodes: InstanceNode[];
  escalations: { id: number; triggerType: string; status: string; fromWorkNo: string | null; toWorkNo: string | null; level: number }[];
}

interface ProgressDetail {
  rule: string;
  progress: { expected: number; pool: number; stated: number; approve: number; reject: number; quorumSatisfied: boolean };
  myVote: { status: string; decision: string | null } | null;
  details: { userId: number; name: string | null; weight: number; status: string; decision: string | null }[];
  detailsVisible: boolean;
}

const DECISION_LABEL: Record<string, string> = { APPROVE: '同意', REJECT: '反对' };

export default function InstanceDetailPage() {
  const params = useParams<{ id: string }>();
  const instanceId = Number(params.id);
  const { mutate } = useSWRConfig();
  const detailKey = `/instances/${instanceId}`;
  const progressKey = `/instances/${instanceId}/vote-progress`;

  const { data: detail } = useSWR<InstanceDetail>(detailKey);
  const { data: progress } = useSWR<ProgressDetail>(progressKey);

  if (!detail)
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
          <Skeleton className="h-72 w-full rounded-lg" />
          <Skeleton className="h-72 w-full rounded-lg" />
        </div>
      </div>
    );

  const currentNode = detail.nodes.find((node) => node.id === detail.currentNodeId) ?? detail.nodes[detail.nodes.length - 1];

  return (
    <>
      <PageHeader
        title={detail.title}
        description={`${detail.code}｜${detail.template.name}｜发起人 ${detail.initiator.name}（${detail.initiator.department ?? '—'}）`}
        actions={<StatusBadge status={detail.status} label={INSTANCE_STATUS_LABEL[detail.status as never]} />}
      />

      {detail.suspendedFrom ? (
        <p className="mb-3 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          流程因上报被冻结，解冻后恢复到「{INSTANCE_STATUS_LABEL[detail.suspendedFrom as never]}」
        </p>
      ) : null}

      <ol className="mb-4 flex flex-wrap gap-2">
        {detail.nodes.map((node) => (
          <li
            key={node.id}
            className={`rounded border px-3 py-1.5 text-xs ${node.id === detail.currentNodeId ? 'border-primary bg-primary/10' : 'bg-card'}`}
          >
            <div className="font-medium">
              L{node.layerIndex} {node.name}
            </div>
            <div className="text-muted-foreground">
              {INSTANCE_NODE_STATUS_LABEL[node.status as never] ?? node.status}
              {node.round > 1 ? `｜第 ${node.round} 轮` : ''}
            </div>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {currentNode ? (
            <div className="oa-card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium">
                  当前层：L{currentNode.layerIndex} {currentNode.name}
                </h2>
                <div className="flex items-center gap-2">
                  <StatusBadge status={currentNode.status} label={INSTANCE_NODE_STATUS_LABEL[currentNode.status as never]} />
                  {currentNode.vetoLocked ? <StatusBadge status="REJECTED" label="已锁定不予通过" /> : null}
                </div>
              </div>
              {progress ? <VoteProgressBar value={progress.progress} /> : null}
              {progress ? <p className="text-xs text-muted-foreground">规则：{progress.rule}</p> : null}
              {currentNode.deadline ? (
                <p className="text-xs text-muted-foreground">截止：{new Date(currentNode.deadline).toLocaleString('zh-CN')}</p>
              ) : null}
              <VoteActions
                instanceId={instanceId}
                nodeId={currentNode.id}
                nodeStatus={currentNode.status}
                myVote={progress?.myVote ?? null}
                voters={currentNode.voters}
                onDone={async () => {
                  await Promise.all([mutate(detailKey), mutate(progressKey)]);
                }}
              />
            </div>
          ) : null}

          <div className="oa-card">
            <h2 className="mb-2 text-sm font-medium">本层投票人（快照）</h2>
            {progress && progress.detailsVisible === false ? (
              <p className="text-xs text-muted-foreground">跨部门只给聚合计数；本部门明细对你可见。</p>
            ) : (
              <ul className="divide-y text-sm">
                {(progress?.details ?? []).map((voter) => (
                  <li key={voter.userId} className="flex items-center justify-between py-1.5">
                    <span>
                      {voter.name ?? `用户 ${voter.userId}`}
                      {voter.weight !== 1 ? <span className="ml-1 text-xs text-muted-foreground">权重 {voter.weight}</span> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {VOTER_STATUS_LABEL[voter.status as never] ?? voter.status}
                      {voter.decision ? `｜${DECISION_LABEL[voter.decision] ?? voter.decision}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {currentNode && currentNode.conclusions.length > 0 ? (
            <div className="oa-card">
              <h2 className="mb-2 text-sm font-medium">本层结论</h2>
              <ul className="space-y-2 text-sm">
                {currentNode.conclusions.map((conclusion, index) => (
                  <li key={index} className="rounded border p-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{new Date(conclusion.createdAt).toLocaleString('zh-CN')}</span>
                      <span>{conclusion.decision === 'APPROVE' ? '通过' : '驳回'}</span>
                      {conclusion.isOverride ? <span className="text-warning">改判</span> : null}
                    </div>
                    <div>{conclusion.content}</div>
                    {conclusion.overrideReason ? (
                      <div className="text-xs text-muted-foreground">改判理由：{conclusion.overrideReason}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <aside className="space-y-4">
          <div className="oa-card">
            <h2 className="mb-2 text-sm font-medium">表单数据</h2>
            <dl className="space-y-1 text-xs">
              {Object.entries(detail.formData ?? {}).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{key}</dt>
                  <dd className="text-right">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="oa-card">
            <h2 className="mb-2 text-sm font-medium">上报链路</h2>
            {detail.escalations.length === 0 ? (
              <p className="text-xs text-muted-foreground">没有上报</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {detail.escalations.map((escalation) => (
                  <li key={escalation.id} className="rounded border p-2">
                    <div className="flex items-center justify-between">
                      <span>L{escalation.level}</span>
                      <StatusBadge status={escalation.status} />
                    </div>
                    <div className="text-muted-foreground">
                      {escalation.fromWorkNo ?? '—'} → {escalation.toWorkNo ?? '—'}｜{escalation.triggerType}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {currentNode && currentNode.pendingEscalation && currentNode.pendingEscalation.triggers ? (
            <div className="oa-card border-warning/40">
              <h2 className="mb-2 text-sm font-medium text-warning">待上报</h2>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {currentNode.pendingEscalation.triggers.map((trigger, index) => (
                  <li key={index}>
                    {trigger.triggerLabel}：{trigger.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}
