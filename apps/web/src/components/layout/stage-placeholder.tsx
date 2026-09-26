import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

// 阶段 4 交付的是"骨架 + 设计系统"；业务页面在阶段 5 实现。
// 这里先给出可导航的占位，避免点了菜单 404，也让人一眼看出进度。
export function StagePlaceholder({ title, description, todo }: { title: string; description: string; todo: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="oa-card">
        <EmptyState title="阶段 5 实现" description={todo} />
      </div>
    </>
  );
}
