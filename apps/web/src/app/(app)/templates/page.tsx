import { RouteGuard } from '@/components/layout/route-guard';
import { StagePlaceholder } from '@/components/layout/stage-placeholder';

export default function TemplatesPage() {
  return (
    <RouteGuard permissions={['WF_DESIGN', 'WF_PUBLISH']}>
      <StagePlaceholder
        title="流程模板"
        description="模板版本、节点图与投票规则；发布前会做节点图与规则完备性校验"
        todo="只读视图 + 发布动作先做；可视化流程设计器（节点拖拽、规则在线试算）建议最后做，它与引擎的 DSL 校验共用同一套纯函数。"
      />
    </RouteGuard>
  );
}
