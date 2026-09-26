import { toneOf, type Tone } from '@oa/shared';
import { cn } from '@/lib/cn';

// 状态标签：语义色取自 @oa/shared 的 STATUS_TONE，各页不再自己写一套颜色映射。
const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-success-subtle text-success border-success/20',
  info: 'bg-info-subtle text-info border-info/20',
  warning: 'bg-warning-subtle text-warning border-warning/20',
  danger: 'bg-danger-subtle text-danger border-danger/20',
  neutral: 'bg-muted text-muted-foreground border-border',
};

const DOT_CLASS: Record<Tone, string> = {
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-muted-foreground/50',
};

/**
 * 状态标签。带一个语义色圆点：色觉障碍用户也能靠位置 + 文字辨认，
 * 同时比纯色块更轻，不会在密集表格里变成一堵彩墙。
 */
export function StatusBadge({
  status,
  label,
  className,
  dot = true,
}: {
  status: string | null | undefined;
  // 中文标签：不同域的标签表不同（实例/任务/上报），由调用方从 shared 取
  label?: string;
  className?: string;
  dot?: boolean;
}) {
  if (!status) return null;
  const tone = toneOf(status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot ? <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLASS[tone])} /> : null}
      {label ?? status}
    </span>
  );
}
