'use client';

import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { useState } from 'react';
import { NOTIFICATION_TYPE_LABEL } from '@oa/shared';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/cn';

interface NotificationRow {
  id: number;
  type: string;
  title: string;
  content: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

interface Page {
  items: NotificationRow[];
  total: number;
  unread: number;
}

export default function NotificationsPage() {
  const { mutate } = useSWRConfig();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const key = `/notifications?page=1&pageSize=30${unreadOnly ? '&unreadOnly=true' : ''}`;
  const { data, isLoading } = useSWR<Page>(key);

  const markRead = async (id: number) => {
    await api.post(`/notifications/${id}/read`);
    await mutate(key);
  };
  const markAll = async () => {
    await api.post('/notifications/read-all');
    await mutate(key);
  };

  return (
    <>
      <PageHeader
        title="通知"
        description={data ? `未读 ${data.unread} 条 / 共 ${data.total} 条` : '待我投票、待填结论、任务与上报的处理提醒'}
        actions={
          <>
            <button type="button" className="oa-button-ghost" onClick={() => setUnreadOnly((prev) => !prev)}>
              {unreadOnly ? '显示全部' : '只看未读'}
            </button>
            <button type="button" className="oa-button-ghost" onClick={markAll} disabled={!data?.unread}>
              全部已读
            </button>
          </>
        }
      />

      <div className="oa-card p-0">
        {isLoading ? (
          <div className="space-y-4 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <EmptyState title="没有通知" description="投票、任务与上报的处理提醒会出现在这里。" />
        ) : (
          <ul className="divide-y">
            {data!.items.map((item) => (
              <li key={item.id} className={cn('flex items-start justify-between gap-3 px-4 py-3', !item.read && 'bg-primary/5')}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {NOTIFICATION_TYPE_LABEL[item.type as never] ?? item.type}
                    </span>
                    <span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <div className="text-sm font-medium">{item.title}</div>
                  {item.content ? <div className="text-xs text-muted-foreground">{item.content}</div> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.link ? (
                    <Link href={item.link} className="oa-button-ghost h-7 px-2">
                      查看
                    </Link>
                  ) : null}
                  {!item.read ? (
                    <button type="button" className="oa-button-ghost h-7 px-2" onClick={() => void markRead(item.id)}>
                      标记已读
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
