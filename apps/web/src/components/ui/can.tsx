'use client';

import type { ReactNode } from 'react';
import { useSession } from '@/lib/session';

// 按钮级权限：没权限直接不渲染（与后端 @RequirePermissions 同一份权限点）
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = useSession();
  return <>{can(permission) ? children : fallback}</>;
}
