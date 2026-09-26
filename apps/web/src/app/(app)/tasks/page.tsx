import { RouteGuard } from '@/components/layout/route-guard';
import { StagePlaceholder } from '@/components/layout/stage-placeholder';

export default function TasksPage() {
  return (
    <RouteGuard permissions={['TASK_READ']}>
      <StagePlaceholder
        title="任务中心"
        description="我参与的任务、待接单、待验收、阻塞与逾期"
        todo="接单 / 勾检查项 / 提交验收 / 验收通过或打回 / 转派 / 阻塞与重开；本层任务全部完成后会自动开启下一层投票。"
      />
    </RouteGuard>
  );
}
