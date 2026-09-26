import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';

/** 基础骨架块：用 globals.css 的 .oa-skeleton（微光扫过），比纯 pulse 更有"在加载"的暗示 */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn('oa-skeleton h-4', className)} style={style} />;
}

/**
 * 表格骨架：列数行数可配，避免加载时页面高度跳动。
 * 逐行轻微错峰淡入，避免整块同时闪。
 */
export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="grid items-center gap-4"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))`,
            animation: 'oa-fade-in 0.3s var(--ease-out-quint) both',
            animationDelay: `${rowIndex * 40}ms`,
          }}
        >
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton key={columnIndex} className={cn('h-3.5', columnIndex === 0 && 'w-4/5')} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 卡片骨架：标题 + 若干行，用于详情页首屏 */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="oa-card oa-card-pad space-y-3">
      <Skeleton className="h-4 w-1/4" />
      <div className="space-y-2.5 pt-1">
        {Array.from({ length: lines }).map((_, index) => (
          <Skeleton key={index} className={cn('h-3.5', index % 3 === 2 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
    </div>
  );
}

/** 指标卡骨架 */
export function StatSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="oa-card oa-card-pad space-y-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}
