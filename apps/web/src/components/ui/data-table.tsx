'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { EmptyState } from './empty-state';
import { TableSkeleton } from './skeleton';

export interface Column<T> {
  key: string;
  header: ReactNode;
  // 不传 render 时取 row[key]
  render?: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
  // 窄屏隐藏（手机上只保留关键列）
  hideOnMobile?: boolean;
  /** 给该列的值，用于前端排序；不传则这列不可排序 */
  sortValue?: (row: T) => string | number;
  /** 数字列右对齐 */
  align?: 'left' | 'right' | 'center';
}

type SortState = { key: string; direction: 'asc' | 'desc' } | null;

const ALIGN_CLASS = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

/**
 * 数据表格。
 * 表头吸顶（长列表滚动时不会丢失列含义），行 hover 有底色，加载时用骨架而非"加载中…"文字
 * —— 骨架能保持页面高度，避免内容到位时整页跳动。
 */
export function DataTable<T extends { id: number | string }>({
  columns,
  rows,
  loading,
  emptyTitle = '暂无数据',
  emptyDescription,
  emptyAction,
  onRowClick,
  stickyHeader = true,
  dense = false,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  onRowClick?: (row: T) => void;
  stickyHeader?: boolean;
  dense?: boolean;
  className?: string;
}) {
  const [sort, setSort] = useState<SortState>(null);

  const displayRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.sortValue) return rows;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor;
      return String(left).localeCompare(String(right), 'zh-Hans-CN') * factor;
    });
  }, [rows, sort, columns]);

  const toggleSort = (key: string) => {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: 'asc' };
      if (current.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  };

  if (loading) return <TableSkeleton rows={6} columns={Math.min(columns.length, 5)} />;
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;

  const cellPadding = dense ? 'px-3 py-1.5' : 'px-3 py-2.5';

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        <thead
          className={cn(
            stickyHeader && 'sticky top-0 z-10',
            'bg-[hsl(var(--surface))] shadow-[inset_0_-1px_0_0_hsl(var(--border))]',
          )}
        >
          <tr className="text-xs text-muted-foreground">
            {columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'px-3 py-2 font-medium',
                    ALIGN_CLASS[column.align ?? 'left'],
                    column.hideOnMobile && 'hidden md:table-cell',
                    column.headerClassName,
                  )}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded transition-colors hover:text-foreground',
                        active && 'text-foreground',
                      )}
                    >
                      {column.header}
                      {active ? (
                        sort?.direction === 'asc' ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {displayRows.map((row, index) => (
            <tr
              key={String(row.id)}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              className={cn(
                'border-b border-border/70 transition-colors last:border-0',
                onRowClick && 'cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60',
                'oa-stagger',
              )}
              style={{ '--oa-index': Math.min(index, 12) } as React.CSSProperties}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    cellPadding,
                    'align-top',
                    ALIGN_CLASS[column.align ?? 'left'],
                    column.hideOnMobile && 'hidden md:table-cell',
                    column.className,
                  )}
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
