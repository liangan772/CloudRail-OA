import { toneOf, type Tone } from '@oa/shared';
import { cn } from '@/lib/cn';

// 状态标签：语义色取自 @oa/shared 的 STATUS_TONE，各页不再自己写一套颜色映射。
const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-success/10 text-success',
  info: 'bg-info/10 text-info',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  neutral: 'bg-muted text-muted-foreground',
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string | null | undefined;
  // 中文标签：不同域的标签表不同（实例/任务/上报），由调用方从 shared 取
  label?: string;
  className?: string;
}) {
  if (!status) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium',
        TONE_CLASS[toneOf(status)],
        className,
      )}
    >
      {label ?? status}
    </span>
  );
}
