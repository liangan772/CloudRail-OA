import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * 纯 CSS 提示气泡（不需要 JS、不会卡在屏幕边缘）。
 * 用 group 的 hover/focus 触发，键盘 Tab 到也能看到。
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  const sideClass = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }[side];

  return (
    <span className={cn('group/tt relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 w-max max-w-[16rem] rounded-md border bg-card px-2 py-1 text-xs font-normal text-card-foreground opacity-0 shadow-[var(--shadow-md)] transition-opacity duration-150',
          'group-hover/tt:opacity-100 group-focus-within/tt:opacity-100',
          sideClass,
        )}
      >
        {content}
      </span>
    </span>
  );
}
