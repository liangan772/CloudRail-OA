'use client';

import useSWR from 'swr';
import {
  Activity,
  AlertTriangle,
  BellRing,
  Building2,
  CheckSquare,
  FileStack,
  GitBranch,
  ScrollText,
  Send,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { StatSkeleton, Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

interface Overview {
  users: { total: number; active: number; disabled: number };
  departments: { total: number; withWorkNo: number };
  roles: number;
  templates: number;
  instances: { total: number; running: number };
  tasks: { total: number; open: number; overdue: number };
  escalations: { total: number; open: number };
  notifications: { total: number; unread: number };
  audit: { total: number };
}

interface Runtime {
  jobs: { mode: string; schedule: Record<string, number> };
  outbox: { pending: number; processing: number; sent: number; failed: number; dead: number; problem: number };
  channels: { wecom: boolean; dingtalk: boolean; feishu: boolean; mail: boolean; sms: boolean };
  storage: { driver: string; localDir: string };
  workerMode: string;
}

export default function AdminOverviewPage() {
  const { data: overview, isLoading } = useSWR<Overview>('/admin/ops/overview');
  const { data: runtime } = useSWR<Runtime>('/admin/ops/runtime');

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle title="业务概览" description="当前租户下的组织规模与流程负载" />
        {isLoading || !overview ? (
          <StatSkeleton count={4} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="用户"
              value={overview.users.total}
              unit="人"
              icon={<UserCog className="h-3.5 w-3.5" />}
              hint={`启用 ${overview.users.active} · 停用/锁定 ${overview.users.disabled}`}
            />
            <StatCard
              label="部门"
              value={overview.departments.total}
              unit="个"
              tone="info"
              icon={<Building2 className="h-3.5 w-3.5" />}
              hint={`其中 ${overview.departments.withWorkNo} 个已配工号`}
            />
            <StatCard
              label="流程实例"
              value={overview.instances.total}
              unit="条"
              tone="success"
              icon={<FileStack className="h-3.5 w-3.5" />}
              hint={`进行中 ${overview.instances.running} 条`}
            />
            <StatCard
              label="任务"
              value={overview.tasks.total}
              unit="个"
              tone={overview.tasks.overdue > 0 ? 'danger' : 'primary'}
              icon={<CheckSquare className="h-3.5 w-3.5" />}
              hint={`未完成 ${overview.tasks.open} · 已逾期 ${overview.tasks.overdue}`}
            />
          </div>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading || !overview ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="oa-card oa-card-pad space-y-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-14" />
            </div>
          ))
        ) : (
          <>
            <StatCard label="角色" value={overview.roles} unit="个" tone="neutral" icon={<ShieldCheck className="h-3.5 w-3.5" />} />
            <StatCard label="流程模板" value={overview.templates} unit="套" tone="neutral" icon={<GitBranch className="h-3.5 w-3.5" />} />
            <StatCard
              label="上报单"
              value={overview.escalations.total}
              unit="单"
              tone={overview.escalations.open > 0 ? 'warning' : 'neutral'}
              icon={<Send className="h-3.5 w-3.5" />}
              hint={`待处理 ${overview.escalations.open}`}
            />
            <StatCard
              label="审计记录"
              value={overview.audit.total}
              unit="条"
              tone="neutral"
              icon={<ScrollText className="h-3.5 w-3.5" />}
              hint={`未读通知 ${overview.notifications.unread}`}
            />
          </>
        )}
      </div>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card
          title="运行态"
          description="后台任务与事件投递的健康度"
          actions={
            <Button size="sm" variant="ghost" icon={<Activity className="h-3.5 w-3.5" />} onClick={() => { window.location.href = '/admin/ops'; }}>
              去运维监控
            </Button>
          }
        >
          {!runtime ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : (
            <dl className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">后台任务模式</dt>
                <dd>
                  <StatusBadge
                    status={runtime.jobs.mode === 'queue' ? 'ACTIVE' : 'PENDING'}
                    label={runtime.jobs.mode === 'queue' ? 'BullMQ 队列' : runtime.jobs.mode === 'in-process' ? '进程内定时器' : '已停止'}
                  />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">发件箱待投递</dt>
                <dd className="tabular font-medium">{runtime.outbox.pending}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">投递异常（失败 + 放弃）</dt>
                <dd className={runtime.outbox.problem > 0 ? 'tabular font-medium text-danger' : 'tabular font-medium'}>
                  {runtime.outbox.problem}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">附件存储</dt>
                <dd className="font-mono text-xs">{runtime.storage.driver}</dd>
              </div>
            </dl>
          )}
        </Card>

        <Card title="通知渠道" description="留空的渠道会自动降级为仅站内通知">
          {!runtime ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <ul className="space-y-2.5 text-sm">
              {[
                { key: 'wecom', label: '企业微信 Webhook' },
                { key: 'dingtalk', label: '钉钉 Webhook' },
                { key: 'feishu', label: '飞书 Webhook' },
                { key: 'mail', label: '邮件（SMTP）' },
                { key: 'sms', label: '短信' },
              ].map((channel) => {
                const enabled = runtime.channels[channel.key as keyof Runtime['channels']];
                return (
                  <li key={channel.key} className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{channel.label}</span>
                    <StatusBadge
                      status={enabled ? 'ACTIVE' : 'DISABLED'}
                      label={enabled ? '已配置' : '未配置'}
                      dot
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      {overview && overview.tasks.overdue > 0 ? (
        <Card>
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning-subtle text-warning">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">有 {overview.tasks.overdue} 个任务已逾期</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                逾期任务会触发通知，也可能按规则上报到上级部门。建议先到任务中心确认负责人。
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {overview && overview.notifications.unread > 0 ? (
        <EmptyState
          title={`当前有 ${overview.notifications.unread} 条未读通知`}
          description="通知由发件箱派发器投递，包含投票待办、任务分配与上报进展。"
          icon={<BellRing className="h-5 w-5" />}
        />
      ) : null}
    </div>
  );
}
