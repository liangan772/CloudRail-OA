import { cn } from '@/lib/cn';

export interface VoteProgressValue {
  expected: number;
  pool: number;
  stated: number;
  approve: number;
  reject: number;
  quorumSatisfied?: boolean;
}

// 投票进度：同意/反对/未表态按"池内人数"分段，缺席者单独提示（缺席不算票也不入池）。
export function VoteProgressBar({ value, className }: { value: VoteProgressValue; className?: string }) {
  const pool = Math.max(value.pool, 0);
  const pending = Math.max(pool - value.approve - value.reject, 0);
  const absent = Math.max(value.expected - pool, 0);
  const pct = (n: number) => (pool === 0 ? 0 : (n / pool) * 100);

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex h-2 w-full overflow-hidden rounded bg-muted">
        <div className="bg-success" style={{ width: `${pct(value.approve)}%` }} />
        <div className="bg-danger" style={{ width: `${pct(value.reject)}%` }} />
        <div className="bg-warning/60" style={{ width: `${pct(pending)}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>
          已表态 <b className="text-foreground">{value.stated}</b>/{pool}
        </span>
        <span className="text-success">同意 {value.approve}</span>
        <span className="text-danger">反对 {value.reject}</span>
        {value.quorumSatisfied === false ? <span className="text-warning">未达法定人数</span> : null}
        {absent > 0 ? <span>缺席 {absent}（不计票、不入池）</span> : null}
      </div>
    </div>
  );
}
