'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Activity, ScrollText, ShieldCheck, UserCog, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import { ADMIN_PERMISSIONS } from '@/components/layout/nav-config';
import { RouteGuard } from '@/components/layout/route-guard';
import { PageHeader } from '@/components/ui/page-header';

const SECTIONS = [
  { href: '/admin', label: '概览', icon: ShieldCheck, permissions: ['USER_MANAGE', 'ROLE_MANAGE', 'ORG_MANAGE', 'AUDIT_READ', 'SYS_MONITOR'] },
  { href: '/admin/users', label: '用户管理', icon: UserCog, permissions: ['USER_MANAGE'] },
  { href: '/admin/roles', label: '角色权限', icon: ShieldCheck, permissions: ['ROLE_MANAGE'] },
  { href: '/admin/org', label: '组织与工号', icon: Users, permissions: ['ORG_MANAGE', 'DEPT_WORKNO_MANAGE'] },
  { href: '/admin/audit', label: '审计日志', icon: ScrollText, permissions: ['AUDIT_READ'] },
  { href: '/admin/ops', label: '运维监控', icon: Activity, permissions: ['SYS_MONITOR', 'AUDIT_READ'] },
];

/**
 * 管理后台分区布局。
 *
 * 整区用 ADMIN_PERMISSIONS 做一次总守卫（一个管理权限都没有的人直接看到 403 说明页），
 * 具体到每个二级页再由各自的 RouteGuard 收紧 —— 避免"能进后台就什么都能看"。
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { canAny } = useSession();
  const pathname = usePathname();

  const sections = SECTIONS.filter((section) => canAny(section.permissions));

  return (
    <RouteGuard permissions={ADMIN_PERMISSIONS}>
      <PageHeader
        breadcrumbs={[{ label: '管理后台' }]}
        title="管理后台"
        description="组织、权限、审计与运维的统一入口。所有变更都会留下审计记录。"
      />

      <nav className="mb-5 flex flex-wrap gap-1 border-b pb-3" aria-label="管理后台分区">
        {sections.map((section) => {
          const active = section.href === '/admin' ? pathname === '/admin' : pathname.startsWith(section.href);
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                active ? 'bg-primary-subtle font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {section.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </RouteGuard>
  );
}
