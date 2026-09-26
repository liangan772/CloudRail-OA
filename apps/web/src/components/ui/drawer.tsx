'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

const WIDTH_CLASS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-xl',
  xl: 'max-w-3xl',
} as const;

/**
 * 侧边抽屉。移动端导航与"不打断上下文的详情/编辑"都用它：
 * 比弹窗更适合长表单，也比跳页更省一次往返。
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: keyof typeof WIDTH_CLASS;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // 打开时锁滚动，避免背景跟着滚（移动端尤其明显）
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/35 backdrop-blur-[1px]"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className={cn('relative flex h-full w-full flex-col border-l bg-card shadow-[var(--shadow-lg)]', WIDTH_CLASS[width])}
            role="dialog"
            aria-modal="true"
          >
            <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-medium">{title}</h2>
                {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
              </div>
              <button type="button" className="oa-icon-button shrink-0" onClick={onClose} aria-label="关闭">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="oa-scroll-area min-h-0 flex-1 px-4 py-4 text-sm">{children}</div>
            {footer ? <footer className="flex justify-end gap-2 border-t px-4 py-3">{footer}</footer> : null}
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
