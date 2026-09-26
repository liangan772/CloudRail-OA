import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { EmptyState } from './empty-state';

export interface Column<T> {
  key: string;
  header: ReactNode;
  // 不传 render 时取 row[key]
  render?: (row: T) => ReactNode;
  className?: string;
  // 窄屏隐藏（手机上只保留关键列）
  hideOnMobile?: boolean;
}

export function DataTable<T extends { id: number | string }>({
  columns,
  rows,
  loading,
  emptyTitle = '暂无数据',
  emptyDescription,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
}) {
  if (loading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">加载中…</div>;
  }
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn('px-3 py-2 font-medium', column.hideOnMobile && 'hidden md:table-cell', column.className)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={String(row.id)}
              className={cn('border-b last:border-0', onRowClick && 'cursor-pointer hover:bg-muted/60')}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn('px-3 py-2 align-top', column.hideOnMobile && 'hidden md:table-cell', column.className)}
                >
                  {column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
