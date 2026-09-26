import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/cn';

const TONE_ICON_CLASS = {
  primary: 'bg-primary-subtle text-primary',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  info: 'bg-info-subtle text-info',
  neutral: 'bg-muted text-muted-foreground',
} as const;

export type StatTone = keyof typeof TONE_ICON_CLASS;

/**
 * 指标卡。数值用等宽数字，多卡并排时位数能对齐；
 * trend 只表达方向，不解释业务含义（含义由调用方的 label 说清）。
 */
export function StatCard({
  label,
  value,
  unit,
  icon,
  tone = 'primary',
  trend,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  icon?: ReactNode;
  tone?: StatTone;
  trend?: { direction: 'up' | 'down'; text: string; positive?: boolean };
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('oa-card oa-card-interactive oa-card-pad', className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon ? (
          <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', TONE_ICON_CLASS[tone])}>
            {icon}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular tracking-tight">{value}</span>
        {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
      </div>

      {trend ? (
        <div className="mt-1.5 flex items-center gap-1 text-xs">
          {trend.direction === 'up' ? (
            <TrendingUp className={cn('h-3.5 w-3.5', trend.positive ? 'text-success' : 'text-danger')} />
          ) : (
            <TrendingDown className={cn('h-3.5 w-3.5', trend.positive ? 'text-danger' : 'text-success')} />
          )}
          <span className="text-muted-foreground">{trend.text}</span>
        </div>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
