import { RouteGuard } from '@/components/layout/route-guard';
import { StagePlaceholder } from '@/components/layout/stage-placeholder';

export default function VotesPage() {
  return (
    <RouteGuard permissions={['VOTE_READ']}>
      <StagePlaceholder
        title="投票中心"
        description="待我表态的层级、我发起流程的进度、本部门投票明细"
        todo="将复用后端已按 B1/B2 过滤好的 vote-progress：本部门可见姓名与选择，跨部门只给聚合计数；投票与改票、标记缺席、填写结论都在这一页完成。"
      />
    </RouteGuard>
  );
}
