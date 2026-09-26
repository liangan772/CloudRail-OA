'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface MenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** 分组分隔线：为 true 时在这条之前画一条线 */
  dividerBefore?: boolean;
}

/**
 * 轻量下拉菜单（无外部依赖）。
 * 点击外部、按 Esc、选择后都会关闭；用 framer-motion 做 120ms 的缩放淡入，
 * 比"瞬间出现"更像原生控件。
 */
export function Dropdown({
  trigger,
  items,
  align = 'end',
  header,
  className,
  menuClassName,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  header?: ReactNode;
  className?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {trigger({ open, toggle: () => setOpen((value) => !value) })}

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -2 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'absolute z-50 mt-1.5 min-w-[11rem] origin-top overflow-hidden rounded-lg border bg-card p-1 shadow-[var(--shadow-lg)]',
              align === 'end' ? 'right-0' : 'left-0',
              menuClassName,
            )}
            role="menu"
          >
            {header ? <div className="border-b px-2.5 py-2">{header}</div> : null}
            {items.map((item) => (
              <div key={item.key}>
                {item.dividerBefore ? <div className="my-1 h-px bg-border" /> : null}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) return;
                    setOpen(false);
                    item.onSelect?.();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                    item.disabled
                      ? 'cursor-not-allowed opacity-45'
                      : item.danger
                        ? 'text-danger hover:bg-danger-subtle'
                        : 'hover:bg-muted',
                  )}
                >
                  {item.icon ? <span className="shrink-0 text-muted-foreground">{item.icon}</span> : null}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              </div>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
