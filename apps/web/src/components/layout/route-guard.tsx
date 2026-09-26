'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useSession } from '@/lib/session';

// 页面级权限守卫：缺权限时给出「缺哪个权限点」的说明页（对应阶段 0 §2 的 403 体验）。
// 真正的隔离仍在后端，这里只是把"看不懂的报错"换成可读的说明。
export function RouteGuard({ permissions, children }: { permissions: string[]; children: ReactNode }) {
  const { canAny } = useSession();
  if (canAny(permissions)) return <>{children}</>;

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <ShieldAlert className="h-8 w-8 text-warning" />
      <p className="text-sm font-medium">你没有访问该页面的权限</p>
      <p className="text-xs text-muted-foreground">
        需要的权限点：{permissions.join(' / ')}（可联系租户管理员分配角色）
      </p>
      <Link href="/" className="oa-button-ghost">
        返回工作台
      </Link>
    </div>
  );
}
