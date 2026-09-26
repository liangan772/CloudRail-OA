import { RouteGuard } from '@/components/layout/route-guard';
import { StagePlaceholder } from '@/components/layout/stage-placeholder';

export default function InstancesPage() {
  return (
    <RouteGuard permissions={['INSTANCE_READ']}>
      <StagePlaceholder
        title="流程实例"
        description="发起流程、查看各层步骤与投票人快照、结论与上报链路"
        todo="列表（我发起的 / 数据范围内）+ 详情（步骤条、每层投票人与进度、结论记录、上报链路）+ 发起表单（按模板 formSchema 动态渲染）。"
      />
    </RouteGuard>
  );
}
