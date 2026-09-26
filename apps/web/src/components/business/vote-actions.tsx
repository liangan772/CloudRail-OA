'use client';

import { useState } from 'react';
import { VOTER_STATUS_LABEL } from '@oa/shared';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/session';

interface Voter {
  userId: number;
  name: string | null;
  status: string;
}

// 本层可执行的动作：投票 / 改票、标记缺席、填写结论。
// 谁能做什么由后端再校验一遍（投票人快照、权限点、节点状态），这里只负责把入口摆对。
export function VoteActions({
  instanceId,
  nodeStatus,
  nodeId,
  myVote,
  voters,
  onDone,
}: {
  instanceId: number;
  nodeStatus: string;
  nodeId: number;
  myVote: { status: string; decision: string | null } | null;
  voters: Voter[];
  onDone: () => Promise<void> | void;
}) {
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [absentOpen, setAbsentOpen] = useState(false);
  const [conclusionOpen, setConclusionOpen] = useState(false);

  const run = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      // 成功走全局 Toast（不打断视线），失败留在按钮旁边内联显示（用户正看着这里）
      toast.success(successMessage);
      await onDone();
    } catch (err) {
      const message = err instanceof ApiError ? `${err.message}${err.detail ? `（${err.detail}）` : ''}` : '操作失败';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const canVote = nodeStatus === 'VOTING' && Boolean(myVote) && myVote?.status !== 'ABSENT';
  const canConclude = nodeStatus === 'PENDING_CONCLUSION' && can('NODE_CONCLUDE');
  const canMarkAbsent = nodeStatus === 'VOTING' && can('VOTE_MARK_ABSENT');

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {canVote ? (
          <>
            <button type="button" className="oa-button" disabled={busy} onClick={() => void run(() => api.post(`/instances/${instanceId}/votes`, { decision: 'APPROVE' }), '已投同意票')}>
              同意
            </button>
            <button
              type="button"
              className="oa-button-ghost"
              disabled={busy}
              onClick={() => void run(() => api.post(`/instances/${instanceId}/votes`, { decision: 'REJECT', comment: '不同意' }), '已投反对票')}
            >
              反对
            </button>
          </>
        ) : null}
        {canConclude ? (
          <button type="button" className="oa-button" disabled={busy} onClick={() => setConclusionOpen(true)}>
            填写结论
          </button>
        ) : null}
        {canMarkAbsent ? (
          <button type="button" className="oa-button-ghost" disabled={busy} onClick={() => setAbsentOpen(true)}>
            标记缺席
          </button>
        ) : null}
        {myVote ? (
          <span className="self-center text-xs text-muted-foreground">
            我的状态：{VOTER_STATUS_LABEL[myVote.status as never] ?? myVote.status}
            {myVote.decision ? `（${myVote.decision === 'APPROVE' ? '同意' : '反对'}）` : ''}
          </span>
        ) : (
          <span className="self-center text-xs text-muted-foreground">你不在本层投票人名单内</span>
        )}
      </div>

      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <AbsentModal
        open={absentOpen}
        voters={voters}
        onClose={() => setAbsentOpen(false)}
        onSubmit={async (userIds, reason) => {
          await run(() => api.post(`/instances/${instanceId}/absent`, { userIds, reason, source: 'MANUAL' }), '已标记缺席');
          setAbsentOpen(false);
        }}
      />
      <ConclusionModal
        open={conclusionOpen}
        onClose={() => setConclusionOpen(false)}
        onSubmit={async (decision, content, overrideReason) => {
          await run(() => api.post(`/instances/${instanceId}/conclusion`, { decision, content, overrideReason }), '结论已提交');
          setConclusionOpen(false);
        }}
      />
      <span className="hidden">{nodeId}</span>
    </div>
  );
}

function AbsentModal({
  open,
  voters,
  onClose,
  onSubmit,
}: {
  open: boolean;
  voters: Voter[];
  onClose: () => void;
  onSubmit: (userIds: number[], reason: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [reason, setReason] = useState('');

  return (
    <Modal
      open={open}
      title="标记缺席"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="oa-button-ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="oa-button"
            disabled={selected.length === 0 || reason.trim().length < 2}
            onClick={() => void onSubmit(selected, reason)}
          >
            确认
          </button>
        </>
      }
    >
      <p className="mb-2 text-xs text-muted-foreground">
        缺席者不算票、也不计入投票池（分母与权重同步剔除）；若剔除后低于法定人数，本层直接转上报。
      </p>
      <ul className="mb-3 space-y-1 text-sm">
        {voters
          .filter((voter) => voter.status !== 'ABSENT')
          .map((voter) => (
            <li key={voter.userId}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.includes(voter.userId)}
                  onChange={(event) =>
                    setSelected((prev) => (event.target.checked ? [...prev, voter.userId] : prev.filter((id) => id !== voter.userId)))
                  }
                />
                {voter.name ?? `用户 ${voter.userId}`}
              </label>
            </li>
          ))}
      </ul>
      <label className="block space-y-1">
        <span className="text-sm">理由（必填）</span>
        <input className="oa-input" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
      </label>
    </Modal>
  );
}

function ConclusionModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (decision: 'APPROVE' | 'REJECT', content: string, overrideReason?: string) => Promise<void>;
}) {
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [content, setContent] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  return (
    <Modal
      open={open}
      title="填写本层结论"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="oa-button-ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="oa-button"
            disabled={content.trim().length === 0}
            onClick={() => void onSubmit(decision, content, overrideReason || undefined)}
          >
            提交结论
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <button type="button" className={decision === 'APPROVE' ? 'oa-button' : 'oa-button-ghost'} onClick={() => setDecision('APPROVE')}>
            通过
          </button>
          <button type="button" className={decision === 'REJECT' ? 'oa-button' : 'oa-button-ghost'} onClick={() => setDecision('REJECT')}>
            驳回
          </button>
        </div>
        <label className="block space-y-1">
          <span className="text-sm">结论意见（必填）</span>
          <textarea className="oa-textarea h-24" value={content} onChange={(event) => setContent(event.target.value)} maxLength={4000} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm">改判理由（与系统拟判定不一致时必填）</span>
          <input className="oa-input" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} maxLength={2000} />
        </label>
      </div>
    </Modal>
  );
}
