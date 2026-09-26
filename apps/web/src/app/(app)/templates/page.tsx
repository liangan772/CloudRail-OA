'use client';

import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { TEMPLATE_STATUS_LABEL } from '@oa/shared';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Modal } from '@/components/ui/modal';
import { api, ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/session';

interface TemplateRow {
  id: number;
  name: string;
  code: string;
  category: string;
  status: string;
  currentVersionId: number | null;
  latestVersion: { id: number; version: number; publishedAt: string | null } | null;
  versionCount: number;
  instanceCount: number;
}

interface TemplateDetail {
  id: number;
  name: string;
  code: string;
  category: string;
  status: string;
  currentVersionId: number | null;
  formSchema: { required?: string[]; properties?: Record<string, { title?: string; type?: string }> };
  versions: {
    id: number;
    version: number;
    publishedAt: string | null;
    isLocked: boolean;
    changelog: string | null;
    nodes: { id: number; name: string; type: string; layerIndex: number | null; voterRules: unknown[]; voteRule: { id: number } | null }[];
    edges: { fromNodeId: number; toNodeId: number }[];
  }[];
}

// 模板页：阶段 5 先做"只读视图 + 发布"，可视化流程设计器作为独立增量（后端还需要版本 CRUD 接口）。
export default function TemplatesPage() {
  const { mutate } = useSWRConfig();
  const { can } = useSession();
  const [openId, setOpenId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const listKey = '/workflow/templates?page=1&pageSize=50';
  const { data, isLoading } = useSWR<{ items: TemplateRow[] }>(listKey);
  const detailKey = openId ? `/workflow/templates/${openId}` : null;
  const { data: detail } = useSWR<TemplateDetail>(detailKey);

  const publish = async (versionId?: number) => {
    if (!openId) return;
    setMessage(null);
    try {
      const result = await api.post<{ version: number; voteLayers: number[] }>(`/workflow/templates/${openId}/publish`, {
        versionId,
      });
      setMessage({ kind: 'ok', text: `已发布 v${result.version}，投票层 ${result.voteLayers.join('、')}` });
      await Promise.all([mutate(detailKey), mutate(listKey)]);
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof ApiError ? `${error.message}${error.detail ? `（${error.detail}）` : ''}` : '发布失败',
      });
    }
  };

  const columns: Column<TemplateRow>[] = [
    {
      key: 'name',
      header: '模板',
      render: (row) => (
        <div>
          <div className="font-medium">{row.name}</div>
          <div className="text-xs text-muted-foreground">
            {row.code}｜{row.category}
          </div>
        </div>
      ),
    },
    { key: 'status', header: '状态', render: (row) => <StatusBadge status={row.status} label={TEMPLATE_STATUS_LABEL[row.status as never]} /> },
    {
      key: 'latestVersion',
      header: '最新版本',
      render: (row) =>
        row.latestVersion
          ? `v${row.latestVersion.version}${row.latestVersion.publishedAt ? '（已发布）' : '（未发布）'}`
          : '—',
    },
    { key: 'versionCount', header: '版本数', render: (row) => String(row.versionCount), hideOnMobile: true },
    { key: 'instanceCount', header: '已发起', render: (row) => String(row.instanceCount), hideOnMobile: true },
    {
      key: 'action',
      header: '',
      render: (row) => (
        <button type="button" className="oa-button-ghost h-7 px-2" onClick={() => setOpenId(row.id)}>
          查看
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="流程模板" description="模板版本、节点与投票规则；发布前会校验节点图与规则完备性" />

      <div className="oa-card p-0">
        <DataTable columns={columns} rows={data?.items ?? []} loading={isLoading} emptyTitle="没有模板" />
      </div>

      <Modal open={openId != null} title={detail?.name ?? '模板详情'} onClose={() => setOpenId(null)}>
        {detail ? (
          <div className="space-y-4">
            {message ? (
              <p className={`rounded px-2 py-1 text-xs ${message.kind === 'ok' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                {message.text}
              </p>
            ) : null}

            <div>
              <div className="mb-1 text-sm font-medium">表单字段</div>
              <ul className="text-xs text-muted-foreground">
                {Object.entries(detail.formSchema?.properties ?? {}).map(([key, property]) => (
                  <li key={key}>
                    {property.title ?? key}
                    {detail.formSchema.required?.includes(key) ? ' *' : ''}
                    {property.type ? `（${property.type}）` : ''}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">版本</div>
              {detail.versions.map((version) => (
                <div key={version.id} className="rounded border p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">v{version.version}</span>
                    <span className="text-muted-foreground">
                      {version.publishedAt ? `已发布 ${new Date(version.publishedAt).toLocaleDateString('zh-CN')}` : '未发布'}
                    </span>
                    {version.isLocked ? <span className="text-muted-foreground">已锁定</span> : null}
                    {can('WF_PUBLISH') && !version.publishedAt ? (
                      <button type="button" className="oa-button-ghost h-6 px-2" onClick={() => void publish(version.id)}>
                        发布此版本
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    节点 {version.nodes.length} 个｜连线 {version.edges.length} 条｜投票层：
                    {version.nodes
                      .filter((node) => node.type === 'VOTE')
                      .map((node) => `L${node.layerIndex ?? '?'} ${node.name}`)
                      .join('、') || '无'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">加载中…</p>
        )}
      </Modal>
    </>
  );
}
