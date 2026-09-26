import { RouteGuard } from '@/components/layout/route-guard';
import { StagePlaceholder } from '@/components/layout/stage-placeholder';

export default function OrgPage() {
  return (
    <RouteGuard permissions={['ORG_MANAGE']}>
      <StagePlaceholder
        title="组织架构"
        description="部门树、部门工号与成员、用户与角色"
        todo="部门树按物化路径渲染（后端已按数据范围裁剪），工号成员维护即「该级投票人」维护。"
      />
    </RouteGuard>
  );
}
