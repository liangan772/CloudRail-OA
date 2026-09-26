import { cn } from '@/lib/cn';

export interface VoteProgressValue {
  expected: number;
  pool: number;
  stated: number;
  approve: number;
  reject: number;
  quorumSatisfied?: boolean;
}

/**
 * 投票进度：同意 / 反对 / 未表态按"池内人数"分段，缺席者单独提示（缺席不算票也不入池）。
 * 分段宽度用 transition 过渡，改票时能看到条子平滑移动而不是瞬变。
 */
export function VoteProgressBar({ value, className }: { value: VoteProgressValue; className?: string }) {
  const pool = Math.max(value.pool, 0);
  const pending = Math.max(pool - value.approve - value.reject, 0);
  const absent = Math.max(value.expected - pool, 0);
  const pct = (n: number) => (pool === 0 ? 0 : (n / pool) * 100);

  const statedPct = pct(value.stated);

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="bg-success transition-[width] duration-500 ease-[var(--ease-out-quint)]"
          style={{ width: `${pct(value.approve)}%` }}
        />
        <div
          className="bg-danger transition-[width] duration-500 ease-[var(--ease-out-quint)]"
          style={{ width: `${pct(value.reject)}%` }}
        />
        <div
          className="bg-warning/50 transition-[width] duration-500 ease-[var(--ease-out-quint)]"
          style={{ width: `${pct(pending)}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span className="tabular">
          已表态{' '}
          <b className="font-medium text-foreground">
            {value.stated}/{pool}
          </b>
          {pool > 0 ? <span className="ml-1 opacity-70">({Math.round(statedPct)}%)</span> : null}
        </span>
        <span className="tabular text-success">同意 {value.approve}</span>
        <span className="tabular text-danger">反对 {value.reject}</span>
        {value.quorumSatisfied === false ? <span className="font-medium text-warning">未达法定人数</span> : null}
        {absent > 0 ? <span className="tabular opacity-80">缺席 {absent}（不计票、不入池）</span> : null}
      </div>
    </div>
  );
}
