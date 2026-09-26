import {
  Activity,
  ChartColumn,
  CheckSquare,
  FileStack,
  GitBranch,
  LayoutDashboard,
  ScrollText,
  Send,
  ShieldCheck,
  UserCog,
  Users,
  Vote,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** 需要的权限点（任一命中即可见），与后端守卫同一份常量 */
  permissions?: string[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * 侧边栏导航。分组与阶段 0 §2.1 一致，另加「管理后台」一组。
 * 管理后台整组的可见性由 canAny 判定 —— 一个管理权限都没有的用户不会看到这个分组。
 */
export const NAV_GROUPS: NavGroup[] = [
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
  {
    title: '管理后台',
    items: [
      { href: '/admin', label: '后台概览', icon: ShieldCheck, permissions: ['USER_MANAGE', 'ROLE_MANAGE', 'ORG_MANAGE', 'AUDIT_READ', 'SYS_MONITOR'] },
      { href: '/admin/users', label: '用户管理', icon: UserCog, permissions: ['USER_MANAGE'] },
      { href: '/admin/roles', label: '角色权限', icon: ShieldCheck, permissions: ['ROLE_MANAGE'] },
      { href: '/admin/org', label: '组织与工号', icon: Users, permissions: ['ORG_MANAGE', 'DEPT_WORKNO_MANAGE'] },
      { href: '/admin/audit', label: '审计日志', icon: ScrollText, permissions: ['AUDIT_READ'] },
      { href: '/admin/ops', label: '运维监控', icon: Activity, permissions: ['SYS_MONITOR', 'AUDIT_READ'] },
    ],
  },
];

/** 管理后台分区的权限集合，供路由守卫与分组判定复用 */
export const ADMIN_PERMISSIONS = ['USER_MANAGE', 'ROLE_MANAGE', 'ORG_MANAGE', 'DEPT_WORKNO_MANAGE', 'AUDIT_READ', 'SYS_MONITOR'];

/**
 * 路径 → 标题。用于顶栏面包屑。
 * 有动态段的路由（/instances/[id]）在页面内自己补，这里只兜住静态段。
 */
const ROUTE_TITLES: Record<string, string> = {
  '/': '工作台',
  '/votes': '投票中心',
  '/tasks': '任务中心',
  '/escalations': '上报中心',
  '/instances': '流程实例',
  '/instances/new': '发起流程',
  '/templates': '流程模板',
  '/org': '组织架构',
  '/stats': '统计',
  '/notifications': '通知',
  '/admin': '后台概览',
  '/admin/users': '用户管理',
  '/admin/roles': '角色权限',
  '/admin/org': '组织与工号',
  '/admin/audit': '审计日志',
  '/admin/ops': '运维监控',
};

/** 把 pathname 拆成面包屑。未知段回退为原样展示，避免出现空白层级 */
export function breadcrumbsOf(pathname: string): { label: string; href?: string }[] {
  if (pathname === '/') return [{ label: '工作台' }];

  const segments = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; href?: string }[] = [];

  segments.forEach((_, index) => {
    const path = `/${segments.slice(0, index + 1).join('/')}`;
    const label = ROUTE_TITLES[path] ?? segments[index] ?? path;
    crumbs.push({ label, href: index === segments.length - 1 ? undefined : path });
  });

  return crumbs;
}
