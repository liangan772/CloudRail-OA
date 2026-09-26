'use client';

import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Bell, ChevronDown, LogOut, Menu, Moon, Sun, UserRound } from 'lucide-react';
import useSWR from 'swr';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import { Drawer } from '@/components/ui/drawer';
import { Dropdown } from '@/components/ui/dropdown';
import { Tooltip } from '@/components/ui/tooltip';
import { breadcrumbsOf, NAV_GROUPS } from './nav-config';

/** 侧边栏导航（桌面固定栏与移动抽屉共用同一份渲染） */
function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const { canAny } = useSession();
  const pathname = usePathname();

  return (
    <nav className="space-y-5">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((item) => !item.permissions || canAny(item.permissions));
        if (items.length === 0) return null;

        return (
          <div key={group.title}>
            <div className="px-2.5 pb-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground/80">
              {group.title}
            </div>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        'group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150',
                        active ? 'font-medium text-primary' : 'text-foreground/80 hover:bg-muted hover:text-foreground',
                      )}
                    >
                      {/* 激活态：底色块 + 左侧指示条，用 layoutId 让切换时"滑"过去 */}
                      {active ? (
                        <motion.span
                          layoutId="oa-nav-active"
                          className="absolute inset-0 rounded-md bg-primary-subtle"
                          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                        />
                      ) : null}
                      {active ? (
                        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-primary" />
                      ) : null}
                      <Icon className="relative z-10 h-4 w-4 shrink-0" />
                      <span className="relative z-10 truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className={cn('flex items-center gap-2.5 px-3', compact ? 'h-14' : 'py-4')}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground shadow-[var(--shadow-xs)]">
        CR
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold leading-tight tracking-tight">CloudRail OA</span>
        <span className="block truncate text-2xs text-muted-foreground">层级投票制协作</span>
      </span>
    </Link>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    window.localStorage.setItem('oa-theme', next ? 'dark' : 'light');
  };

  return (
    <Tooltip content={dark ? '切换到浅色' : '切换到深色'}>
      <button type="button" className="oa-icon-button" onClick={toggle} aria-label="切换主题">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={dark ? 'sun' : 'moon'}
            initial={{ opacity: 0, rotate: -45, scale: 0.8 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 45, scale: 0.8 }}
            transition={{ duration: 0.18 }}
            className="flex"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </motion.span>
        </AnimatePresence>
      </button>
    </Tooltip>
  );
}

/** 通知铃铛：带未读数角标。用 SWR 轮询，切窗口不重验证（沿用全局配置） */
function NotificationBell() {
  const { data } = useSWR<{ unread: number }>('/notifications?pageSize=1', {
    refreshInterval: 60_000,
  });
  const unread = data?.unread ?? 0;

  return (
    <Tooltip content={unread > 0 ? `${unread} 条未读通知` : '通知'}>
      <Link href="/notifications" className="oa-icon-button relative" aria-label={`通知${unread > 0 ? `（${unread} 条未读）` : ''}`}>
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </Link>
    </Tooltip>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useSession();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // 路由变化时收起移动端抽屉，否则点完链接抽屉还开着
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const crumbs = breadcrumbsOf(pathname);
  const primaryDept = user?.deptIds?.length ? `部门 #${user.deptIds[0]}` : '未分配部门';

  return (
    <div className="flex min-h-screen">
      {/* 桌面固定侧边栏 */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card lg:flex">
        <Brand />
        <div className="oa-scroll-area min-h-0 flex-1 px-2 py-2">
          <SideNav />
        </div>
      </aside>

      {/* 移动端抽屉导航 */}
      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} title="导航" width="sm">
        <div className="-mx-4 -my-4">
          <div className="border-b px-2">
            <Brand />
          </div>
          <div className="px-2 py-3">
            <SideNav onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-card/85 px-3 backdrop-blur-md lg:px-5">
          <button
            type="button"
            className="oa-icon-button lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="打开导航"
          >
            <Menu className="h-4 w-4" />
          </button>

          {/* 面包屑：窄屏只显示最后一级，避免挤掉右侧操作 */}
          <nav className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" aria-label="面包屑">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return (
                <span
                  key={`${crumb.label}-${index}`}
                  className={cn('flex min-w-0 items-center gap-1', !last && 'hidden sm:flex')}
                >
                  {index > 0 ? <span className="opacity-40">/</span> : null}
                  {crumb.href ? (
                    <Link href={crumb.href} className="truncate transition-colors hover:text-foreground">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="truncate font-medium text-foreground">{crumb.label}</span>
                  )}
                </span>
              );
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <ThemeToggle />
            <NotificationBell />

            <Dropdown
              align="end"
              header={
                <div className="px-1 py-0.5">
                  <div className="truncate text-sm font-medium">{user?.name ?? '未登录'}</div>
                  <div className="truncate text-xs text-muted-foreground">{user?.email ?? ''}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(user?.roleCodes ?? []).map((role) => (
                      <span key={role} className="oa-chip border-border bg-muted text-2xs text-muted-foreground">
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
              }
              items={[
                { key: 'profile', label: '账号信息', icon: <UserRound className="h-3.5 w-3.5" />, onSelect: () => undefined, disabled: true },
                { key: 'notifications', label: '我的通知', icon: <Bell className="h-3.5 w-3.5" />, onSelect: () => { window.location.href = '/notifications'; } },
                { key: 'logout', label: '退出登录', icon: <LogOut className="h-3.5 w-3.5" />, danger: true, dividerBefore: true, onSelect: logout },
              ]}
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className={cn(
                    'ml-1 flex h-8 items-center gap-1.5 rounded-md px-1.5 transition-colors hover:bg-muted',
                    open && 'bg-muted',
                  )}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-2xs font-medium text-primary">
                    {(user?.name ?? '?').slice(0, 1)}
                  </span>
                  <span className="hidden max-w-[6rem] truncate text-xs font-medium sm:block">{user?.name ?? '未登录'}</span>
                  <ChevronDown className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
                </button>
              )}
            />
          </div>
        </header>

        {/* 页面内容：按路径做一次轻量淡入上移，切页有"落位"感但不拖慢 */}
        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="hidden shrink-0 items-center justify-between px-5 py-3 text-2xs text-muted-foreground lg:flex">
          <span>CloudRail OA · 层级投票制协作平台</span>
          <span className="truncate">
            {user?.name} · {primaryDept}
          </span>
        </footer>
      </div>
    </div>
  );
}
