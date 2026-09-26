'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { swrFetcher } from '@/lib/api-client';
import { useSession } from '@/lib/session';

interface InstanceRow {
  id: number;
  code: string;
  title: string;
  status: string;
  layerIndex: number;
  initiator: { id: number; name: string | null };
  template: { id: number; name: string; category: string };
  counts: { nodes: number; tasks: number; escalations: number };
}

interface InstancePage {
  items: InstanceRow[];
  total: number;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  VOTING: '投票中',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  ESCALATED: '上报中',
  SUSPENDED: '已挂起',
  CLOSED: '已归档',
};

export default function DashboardPage() {
  const { user } = useSession();
  const { data, error, isLoading } = useSWR<InstancePage>(
    user ? '/instances?scope=mine&page=1&pageSize=5' : null,
    swrFetcher,
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">工作台</h1>
        <p className="text-sm text-muted-foreground">我发起的流程与待办概览</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="我发起的流程" value={isLoading ? '—' : String(data?.total ?? 0)} hint="全部状态" />
        <MetricCard
          label="进行中"
          value={isLoading ? '—' : String((data?.items ?? []).filter((item) => item.status === 'VOTING').length)}
          hint="最近 5 条中"
        />
        <MetricCard label="数据范围" value={user?.scope ?? '—'} hint={`权限点 ${user?.permissions.length ?? 0} 个`} />
      </div>

      <section className="oa-card">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">最近发起的流程</h2>
          <Link href="/instances" className="text-sm text-primary hover:underline">
            查看全部
          </Link>
        </header>

        {error ? (
          <p className="text-sm text-danger">加载失败：{(error as Error).message}</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : (data?.items.length ?? 0) === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y">
            {data!.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between py-2">
                <div className="min-w-0">
                  <Link href={`/instances/${item.id}`} className="truncate text-sm font-medium hover:underline">
                    {item.title}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {item.code}｜{item.template.name}｜第 {item.layerIndex} 层
                  </div>
                </div>
                <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs">
                  {STATUS_LABEL[item.status] ?? item.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="oa-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-6 text-center text-sm text-muted-foreground">
      还没有流程。
      <Link href="/instances/new" className="text-primary hover:underline">
        发起一个
      </Link>
    </div>
  );
}
