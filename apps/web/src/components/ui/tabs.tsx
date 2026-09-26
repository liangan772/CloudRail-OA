'use client';

import { motion } from 'framer-motion';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string = string> {
  value: T;
  label: ReactNode;
  /** 右上角计数（待办数量等） */
  count?: number;
}

/**
 * 标签页。激活态用 layoutId 共享的滑块移动，切换时有连续感而不是硬跳。
 */
export function Tabs<T extends string>({
  value,
  items,
  onChange,
  className,
  size = 'md',
}: {
  value: T;
  items: TabItem<T>[];
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const layoutId = useId();

  return (
    <div className={cn('flex items-center gap-1 overflow-x-auto', className)} role="tablist">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 rounded-md font-medium transition-colors duration-150',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              active ? 'text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-md bg-primary-subtle"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className="relative z-10">{item.label}</span>
            {typeof item.count === 'number' ? (
              <span
                className={cn(
                  'relative z-10 rounded-full px-1.5 text-2xs tabular',
                  active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** 分段控件：与 Tabs 同一视觉语言，但语义是"切换视图/范围"而非页面分区 */
export function Segmented<T extends string>({
  value,
  items,
  onChange,
  className,
}: {
  value: T;
  items: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const layoutId = useId();
  return (
    <div className={cn('inline-flex items-center gap-0.5 rounded-lg border bg-[hsl(var(--surface))] p-0.5', className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={cn(
              'relative h-7 shrink-0 rounded-md px-2.5 text-xs font-medium transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-md border bg-card shadow-[var(--shadow-xs)]"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className="relative z-10">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
