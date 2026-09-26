'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Bell,
  ChartColumn,
  CheckSquare,
  FileStack,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Moon,
  Send,
  Sun,
  Users,
  Vote,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** 需要的权限点（任一命中即可见），与后端守卫同一份常量 */
  permissions?: string[];
}

/** 与阶段 0 §2.1 的导航分组一致：待办 / 协作 / 配置 */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: '我的工作',
    items: [
      { href: '/', label: '工作台', icon: LayoutDashboard },
      { href: '/votes', label: '投票中心', icon: Vote, permissions: ['VOTE_READ'] },
      { href: '/tasks', label: '任务中心', icon: CheckSquare, permissions: ['TASK_READ'] },
      { href: '/escalations', label: '上报中心', icon: Send, permissions: ['ESC_READ'] },
    ],
  },
  {
    title: '流程与组织',
    items: [
      { href: '/instances', label: '流程实例', icon: FileStack, permissions: ['INSTANCE_READ'] },
      { href: '/templates', label: '流程模板', icon: GitBranch, permissions: ['WF_DESIGN', 'WF_PUBLISH'] },
      { href: '/org', label: '组织架构', icon: Users, permissions: ['ORG_MANAGE'] },
      { href: '/stats', label: '统计', icon: ChartColumn, permissions: ['STATS_READ'] },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout, canAny } = useSession();
  const pathname = usePathname();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    window.localStorage.setItem('oa-theme', next ? 'dark' : 'light');
  };

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r bg-card px-3 py-4 lg:block">
        <div className="px-2 pb-4 text-base font-semibold tracking-tight">CloudRail OA</div>
        <nav className="space-y-4">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => !item.permissions || canAny(item.permissions));
            if (items.length === 0) return null;
            return (
              <div key={group.title}>
                <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group.title}</div>
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const active = pathname === item.href;
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={cn(
                            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition',
                            active ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted',
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-card px-4">
          <div className="text-sm text-muted-foreground">
            {user ? `${user.name}｜${user.roleCodes.join(' / ') || '无角色'}` : ''}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="oa-button-ghost" onClick={toggleTheme} aria-label="切换主题">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Link href="/notifications" className="oa-button-ghost" aria-label="通知">
              <Bell className="h-4 w-4" />
            </Link>
            <button type="button" className="oa-button-ghost" onClick={logout}>
              <LogOut className="h-4 w-4" />
              退出
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
