'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { useSession } from '@/lib/session';

/** 首屏骨架：结构与 AppShell 一致，避免"加载完再整页跳一次" */
function BootSplash() {
  return (
    <div className="flex min-h-screen">
      <div className="hidden w-60 shrink-0 border-r bg-card lg:block">
        <div className="flex items-center gap-2.5 px-3 py-4">
          <span className="h-7 w-7 rounded-lg bg-muted" />
          <span className="space-y-1.5">
            <span className="block h-3 w-24 rounded bg-muted" />
            <span className="block h-2.5 w-16 rounded bg-muted" />
          </span>
        </div>
        <div className="space-y-2 px-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <span key={index} className="block h-6 rounded bg-muted" />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-14 border-b bg-card" />
        <div className="flex-1 p-6">
          <span className="mb-5 block h-5 w-32 rounded bg-muted" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <span key={index} className="block h-24 rounded-lg border bg-card" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

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

  if (loading) return <BootSplash />;
  if (!user) return null;

  return <AppShell>{children}</AppShell>;
}
