'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { ArrowRight, FileStack, Send, Vote, Zap } from 'lucide-react';
import { swrFetcher } from '@/lib/api-client';
import { useSession } from '@/lib/session';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { INSTANCE_STATUS_LABEL, type InstanceStatus } from '@oa/shared';

interface InstanceRow {
  id: number;
  code: string;
  title: string;
  status: string;
  layerIndex: number;
  createdAt: string;
  initiator: { id: number; name: string | null };
  template: { id: number; name: string; category: string };
  counts: { nodes: number; tasks: number; escalations: number };
}

interface InstancePage {
  items: InstanceRow[];
  total: number;
}

export default function DashboardPage() {
  const { user } = useSession();
  const { data, error, isLoading } = useSWR<InstancePage>(
    user ? '/instances?scope=mine&page=1&pageSize=6' : null,
    swrFetcher,
  );
  const { data: pendingVotes } = useSWR<{ items: unknown[] }>(user ? '/votes/pending' : null);
  const { data: escalations } = useSWR<{ total: number }>(user ? '/escalations?page=1&pageSize=1' : null);

  const items = data?.items ?? [];
  const voting = items.filter((item) => item.status === 'VOTING').length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={user ? `你好，${user.name}` : '工作台'}
        description="我发起的流程、待我处理的投票与上报概览"
        actions={
          <Link href="/instances/new" className="oa-button">
            发起流程
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="我发起的流程"
          value={isLoading ? '—' : (data?.total ?? 0)}
          unit="条"
          icon={<FileStack className="h-3.5 w-3.5" />}
          hint="全部状态"
        />
        <StatCard
          label="待我投票"
          value={pendingVotes ? (pendingVotes.items?.length ?? 0) : '—'}
          unit="项"
          tone={pendingVotes && pendingVotes.items.length > 0 ? 'warning' : 'neutral'}
          icon={<Vote className="h-3.5 w-3.5" />}
          hint="需要我表态的层级"
        />
        <StatCard
          label="进行中的流程"
          value={isLoading ? '—' : voting}
          unit="条"
          tone="success"
          icon={<Zap className="h-3.5 w-3.5" />}
          hint="最近 6 条中处于投票"
        />
        <StatCard
          label="数据范围"
          value={user?.scope ?? '—'}
          tone="neutral"
          icon={<Send className="h-3.5 w-3.5" />}
          hint={`权限点 ${user?.permissions.length ?? 0} 个 · 上报 ${escalations?.total ?? '—'}`}
        />
      </div>

      <Card
        pad={false}
        title="最近发起的流程"
        description="点击进入可查看投票进度、任务与上报链路"
        actions={
          <Link href="/instances" className="oa-button-ghost h-8 px-2.5 text-xs">
            查看全部
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        {error ? (
          <EmptyState title="加载失败" description={(error as Error).message} className="py-10" />
        ) : isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="还没有发起过流程"
            description="流程按层级组织多人投票，通过后派发任务，搞不定会自动上报到上级部门。"
            action={
              <Link href="/instances/new" className="oa-button">
                发起一个流程
              </Link>
            }
          />
        ) : (
          <ul className="divide-y">
            {items.map((item, index) => (
              <li
                key={item.id}
                className="oa-stagger"
                style={{ '--oa-index': index } as React.CSSProperties}
              >
                <Link
                  href={`/instances/${item.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{item.title}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="font-mono">{item.code}</span>
                      <span className="opacity-40">·</span>
                      <span>{item.template.name}</span>
                      <span className="opacity-40">·</span>
                      <span>第 {item.layerIndex} 层</span>
                      {item.counts.tasks > 0 ? (
                        <>
                          <span className="opacity-40">·</span>
                          <span>任务 {item.counts.tasks}</span>
                        </>
                      ) : null}
                      {item.counts.escalations > 0 ? (
                        <>
                          <span className="opacity-40">·</span>
                          <span className="text-warning">上报 {item.counts.escalations}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <StatusBadge
                    status={item.status}
                    label={INSTANCE_STATUS_LABEL[item.status as InstanceStatus] ?? item.status}
                    className="shrink-0"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
