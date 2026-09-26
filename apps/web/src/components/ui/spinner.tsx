import { cn } from '@/lib/cn';

/** 轻量加载指示器：用于按钮内、卡片局部刷新等"不该整页骨架"的场景 */
export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn('inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent', className)}
      style={{ width: size, height: size }}
      role="status"
      aria-label="加载中"
    />
  );
}

/** 内容区加载遮罩：保留原内容尺寸，避免刷新时布局跳动 */
export function LoadingOverlay({ active, className }: { active: boolean; className?: string }) {
  if (!active) return null;
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-10 flex items-start justify-center rounded-[inherit] bg-card/60 pt-6 backdrop-blur-[1px]',
        className,
      )}
    >
      <Spinner className="text-primary" size={20} />
    </div>
  );
}
