import { RouteGuard } from '@/components/layout/route-guard';
import { StagePlaceholder } from '@/components/layout/stage-placeholder';

export default function NotificationsPage() {
  return (
    <RouteGuard permissions={['INSTANCE_READ']}>
      <StagePlaceholder
        title="通知"
        description="待我投票 / 待我填写结论 / 任务分配与逾期 / 上报受理"
        todo="列表 + 标记已读；通知由后端 Outbox 派发器写入，实时到达由 Socket.IO 推送（房间 user:{id}）。"
      />
    </RouteGuard>
  );
}
