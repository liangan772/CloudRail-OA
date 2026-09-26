'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { useSession } from '@/lib/session';

/**
 * 受保护区布局：未登录跳登录页。
 * 注意这只是"体验层"的守卫——真正的权限判定在后端（JwtAuthGuard → PermissionsGuard → DataScopeGuard），
 * 前端守卫只避免用户看到一屏报错。
 */
export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">正在加载…</div>;
  }
  if (!user) return null;

  return <AppShell>{children}</AppShell>;
}
