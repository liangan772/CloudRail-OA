import { cn } from '@/lib/cn';

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  if (totalPages <= 1) {
    return <div className="px-3 py-2 text-xs text-muted-foreground">共 {total} 条</div>;
  }

  return (
    <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
      <span>
        共 {total} 条 · 第 {page}/{totalPages} 页
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={cn('oa-button-ghost h-7 px-2', page <= 1 && 'pointer-events-none opacity-50')}
          onClick={() => onChange(page - 1)}
        >
          上一页
        </button>
        <button
          type="button"
          className={cn('oa-button-ghost h-7 px-2', page >= totalPages && 'pointer-events-none opacity-50')}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
