'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CheckSquare, FileStack, Send, Zap } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { StatSkeleton, Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { TASK_STATUS_LABEL, type TaskStatus } from '@oa/shared';

interface InstanceRow {
  id: number;
  status: string;
  createdAt: string;
}

interface TaskRow {
  id: number;
  status: string;
  overdue: boolean;
}

const TASK_TONE: Record<string, string> = {
  PENDING_ASSIGN: 'hsl(var(--chart-4))',
  PENDING_ACCEPT: 'hsl(var(--chart-1))',
  IN_PROGRESS: 'hsl(var(--chart-2))',
  PENDING_ACCEPTANCE: 'hsl(var(--chart-3))',
  DONE: 'hsl(var(--chart-5))',
  OVERDUE: 'hsl(var(--danger))',
  CANCELLED: 'hsl(var(--muted-foreground))',
  BLOCKED: 'hsl(var(--warning))',
  ESCALATED: 'hsl(var(--chart-4))',
};

export default function StatsPage() {
  const { data: instances, isLoading } = useSWR<{ items: InstanceRow[]; total: number }>(
    '/instances?scope=all&page=1&pageSize=100',
  );
  const { data: tasks } = useSWR<{ items: TaskRow[]; total: number }>('/tasks?scope=all&page=1&pageSize=100');
  const { data: escalations } = useSWR<{ total: number }>('/escalations?scope=all&page=1&pageSize=1');
  const { data: jobs } = useSWR<{ mode: string; outbox: { pending: number; dead: number } }>('/jobs/status');

  const taskList = tasks?.items ?? [];
  const overdue = taskList.filter((task) => task.overdue).length;
  const blocked = taskList.filter((task) => task.status === 'BLOCKED').length;

  /** 近 7 天发起量：后端列表已带 createdAt，直接按自然日聚合 */
  const trend = useMemo(() => {
    const days: { date: string; label: string; count: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = new Date(today);
      day.setDate(day.getDate() - offset);
      days.push({
        date: day.toISOString().slice(0, 10),
        label: `${day.getMonth() + 1}/${day.getDate()}`,
        count: 0,
      });
    }

    const index = new Map(days.map((day) => [day.date, day]));
    for (const instance of instances?.items ?? []) {
      const key = new Date(instance.createdAt).toISOString().slice(0, 10);
      const bucket = index.get(key);
      if (bucket) bucket.count += 1;
    }
    return days;
  }, [instances]);

  /** 任务状态分布：按状态聚合并带上中文标签与固定配色 */
  const taskBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of taskList) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
    return [...counts.entries()]
      .map(([status, count]) => ({
        status,
        name: TASK_STATUS_LABEL[status as TaskStatus] ?? status,
        count,
        fill: TASK_TONE[status] ?? 'hsl(var(--chart-1))',
      }))
      .sort((a, b) => b.count - a.count);
  }, [taskList]);

  const trendTotal = trend.reduce((sum, day) => sum + day.count, 0);

  return (
    <div className="space-y-5">
      <PageHeader title="统计" description="按你的数据范围统计流程、任务与上报；趋势为近 7 个自然日" />

      {isLoading ? (
        <StatSkeleton count={4} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="流程实例"
            value={instances?.total ?? 0}
            unit="条"
            icon={<FileStack className="h-3.5 w-3.5" />}
            hint={`近 7 天新增 ${trendTotal} 条`}
          />
          <StatCard
            label="任务"
            value={tasks?.total ?? 0}
            unit="个"
            tone={overdue > 0 ? 'danger' : 'primary'}
            icon={<CheckSquare className="h-3.5 w-3.5" />}
            hint={`逾期 ${overdue}｜阻塞 ${blocked}`}
          />
          <StatCard
            label="上报单"
            value={escalations?.total ?? 0}
            unit="单"
            tone="warning"
            icon={<Send className="h-3.5 w-3.5" />}
            hint="含逐级上溯产生的单"
          />
          <StatCard
            label="事件投递"
            value={jobs?.outbox.pending ?? 0}
            unit="条待发"
            tone={jobs?.outbox.dead ? 'danger' : 'neutral'}
            icon={<Zap className="h-3.5 w-3.5" />}
            hint={`模式 ${jobs?.mode ?? '—'}｜死信 ${jobs?.outbox.dead ?? 0}`}
          />
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <Card title="近 7 天发起量" description="按流程实例创建时间聚合" pad>
          {isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : trendTotal === 0 ? (
            <EmptyState title="近 7 天没有新发起的流程" className="py-10" />
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <ChartTooltip
                    cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }}
                    contentStyle={{
                      borderRadius: 10,
                      border: '1px solid hsl(var(--border))',
                      background: 'hsl(var(--card))',
                      fontSize: 12,
                      boxShadow: 'var(--shadow-md)',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 500 }}
                    formatter={(value: number) => [`${value} 条`, '发起']}
                  />
                  <Bar dataKey="count" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="任务状态分布" description="最近 100 条任务" pad>
          {!tasks ? (
            <Skeleton className="h-56 w-full" />
          ) : taskBreakdown.length === 0 ? (
            <EmptyState title="还没有任务" className="py-10" />
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={taskBreakdown}
                    dataKey="count"
                    nameKey="name"
                    innerRadius="52%"
                    outerRadius="80%"
                    paddingAngle={2}
                    stroke="hsl(var(--card))"
                    strokeWidth={2}
                  >
                    {taskBreakdown.map((entry) => (
                      <Cell key={entry.status} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    iconType="circle"
                    iconSize={8}
                    formatter={(value) => <span style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>{value}</span>}
                  />
                  <ChartTooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: '1px solid hsl(var(--border))',
                      background: 'hsl(var(--card))',
                      fontSize: 12,
                      boxShadow: 'var(--shadow-md)',
                    }}
                    formatter={(value: number, name: string) => [`${value} 个`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
