import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * 卡片。`pad=false` 用于内部要放整宽表格/列表的场景（由内容自己管左右边距）。
 * 统一卡片标题区，避免每个页面各写一套标题排版。
 */
export function Card({
  title,
  description,
  actions,
  children,
  footer,
  pad = true,
  interactive = false,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  pad?: boolean;
  interactive?: boolean;
  className?: string;
  bodyClassName?: string;
}) {
  const hasHeader = Boolean(title || description || actions);

  return (
    <div className={cn('oa-card overflow-hidden', interactive && 'oa-card-interactive', className)}>
      {hasHeader ? (
        <div className="oa-card-header">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-medium">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </div>
      ) : null}

      <div className={cn(pad && 'oa-card-pad', bodyClassName)}>{children}</div>

      {footer ? <div className="border-t px-4 py-3 lg:px-5">{footer}</div> : null}
    </div>
  );
}

/** 页面分区标题：用于一页里多个语义区块之间做区隔 */
export function SectionTitle({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-end justify-between gap-2', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-medium">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}
