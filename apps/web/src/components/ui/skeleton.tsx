import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-muted', className)} />;
}

// 表格骨架：列数行数可配，避免加载时页面高度跳动
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}>
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton key={columnIndex} className="h-4" />
          ))}
        </div>
      ))}
    </div>
  );
}
