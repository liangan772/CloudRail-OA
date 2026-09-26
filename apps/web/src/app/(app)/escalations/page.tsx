import { RouteGuard } from '@/components/layout/route-guard';
import { StagePlaceholder } from '@/components/layout/stage-placeholder';

export default function EscalationsPage() {
  return (
    <RouteGuard permissions={['ESC_READ']}>
      <StagePlaceholder
        title="上报中心"
        description="我所在工号待受理的上报、逐级链路与处理记录"
        todo="上级受理 = 按同样规则再投一次票；结论可选继续 / 退回 / 要求补充 / 终审，回写后原流程自动解冻或定局。"
      />
    </RouteGuard>
  );
}
