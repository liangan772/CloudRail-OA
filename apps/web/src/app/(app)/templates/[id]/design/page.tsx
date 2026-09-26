'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';

// 流程设计器（阶段 5 版本）：以「整图 JSON」编辑节点与连线，保存时整图提交。
// 校验与发布门槛完全复用后端（validateNodeGraph + 每个投票层必须有投票规则与投票人规则）。
// 拖拽画布属于另一条路线，作为后续增量——先把"能正确编出可发布的图"这件事做实。

interface TemplateVersion {
  id: number;
  version: number;
  publishedAt: string | null;
  isLocked: boolean;
}

interface TemplateDetail {
  id: number;
  name: string;
  versions: TemplateVersion[];
}

interface Graph {
  versionId: number;
  version: number;
  templateName: string;
  isLocked: boolean;
  publishedAt: string | null;
  nodes: unknown[];
  edges: unknown[];
}

const SAMPLE = `{
  "nodes": [
    { "nodeKey": "start", "type": "START", "name": "发起", "order": 0 },
    { "nodeKey": "vote1", "type": "VOTE", "name": "部门初评", "order": 1, "layerIndex": 1,
      "voteRule": { "passRule": "MAJORITY", "rejectRule": "ANY_VETO", "minQuorum": 0.6 },
      "voterRules": [ { "voterType": "DEPARTMENT", "voterValue": { "deptRef": "INITIATOR_DEPT" }, "weight": 1, "isRequired": true, "order": 0 } ] },
    { "nodeKey": "end", "type": "END", "name": "结束", "order": 2 }
  ],
  "edges": [
    { "from": "start", "to": "vote1", "priority": 0 },
    { "from": "vote1", "to": "end", "priority": 0 }
  ]
}`;

export default function DesignerPage() {
  const params = useParams<{ id: string }>();
  const templateId = Number(params.id);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [versionId, setVersionId] = useState<number | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [text, setText] = useState(SAMPLE);
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadGraph = useCallback(async (id: number) => {
    const data = await api.get<Graph>(`/workflow/versions/${id}/graph`);
    setGraph(data);
    setText(JSON.stringify({ nodes: data.nodes, edges: data.edges }, null, 2));
    setProblems([]);
  }, []);

  useEffect(() => {
    void (async () => {
      const data = await api.get<TemplateDetail>(`/workflow/templates/${templateId}`);
      setDetail(data);
      const draft = data.versions.find((version) => !version.publishedAt && !version.isLocked);
      if (draft) {
        setVersionId(draft.id);
        await loadGraph(draft.id);
      }
    })();
  }, [templateId, loadGraph]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await action());
    } catch (error) {
      setMessage(error instanceof ApiError ? `${error.message}${error.detail ? `（${error.detail}）` : ''}` : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const parse = (): { nodes: unknown[]; edges: unknown[] } | null => {
    try {
      const parsed = JSON.parse(text) as { nodes?: unknown[]; edges?: unknown[] };
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error('nodes/edges 必须是数组');
      return { nodes: parsed.nodes, edges: parsed.edges };
    } catch (error) {
      setProblems([`JSON 解析失败：${(error as Error).message}`]);
      return null;
    }
  };

  return (
    <>
      <PageHeader
        title={`流程设计器 · ${graph?.templateName ?? detail?.name ?? ''}`}
        description="整图 JSON 编辑（节点 / 连线 / 投票规则）；保存时整图提交，发布前由后端做节点图与规则完备性校验"
        actions={
          <>
            <button
              type="button"
              className="oa-button-ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const created = await api.post<{ versionId: number; version: number; clonedFrom: number }>(
                    `/workflow/templates/${templateId}/versions`,
                    {},
                  );
                  const data = await api.get<TemplateDetail>(`/workflow/templates/${templateId}`);
                  setDetail(data);
                  setVersionId(created.versionId);
                  await loadGraph(created.versionId);
                  return `已从 v${created.clonedFrom} 克隆出草稿 v${created.version}`;
                })
              }
            >
              新建草稿版本
            </button>
            <button
              type="button"
              className="oa-button-ghost"
              disabled={busy || !versionId}
              onClick={() =>
                void run(async () => {
                  const payload = parse();
                  if (!payload) return 'JSON 有问题，先修好再校验';
                  const result = await api.post<{ ok: boolean; problems: string[] }>(
                    `/workflow/versions/${versionId}/validate`,
                    payload,
                  );
                  setProblems(result.problems);
                  return result.ok ? '校验通过，可以保存并发布' : `发现 ${result.problems.length} 个问题`;
                })
              }
            >
              校验
            </button>
            <button
              type="button"
              className="oa-button"
              disabled={busy || !versionId || graph?.isLocked}
              onClick={() =>
                void run(async () => {
                  const payload = parse();
                  if (!payload) return 'JSON 有问题，先修好再保存';
                  const result = await api.put<{ nodeCount: number; edgeCount: number }>(
                    `/workflow/versions/${versionId}/graph`,
                    payload,
                  );
                  await loadGraph(versionId!);
                  return `已保存：节点 ${result.nodeCount} 个、连线 ${result.edgeCount} 条`;
                })
              }
            >
              保存
            </button>
            <button
              type="button"
              className="oa-button"
              disabled={busy || !versionId || graph?.isLocked}
              onClick={() =>
                void run(async () => {
                  const result = await api.post<{ version: number; voteLayers: number[] }>(
                    `/workflow/templates/${templateId}/publish`,
                    { versionId },
                  );
                  await loadGraph(versionId!);
                  return `已发布 v${result.version}（投票层 ${result.voteLayers.join('、')}）`;
                })
              }
            >
              发布
            </button>
          </>
        }
      />

      {message ? <p className="mb-3 rounded bg-muted px-3 py-2 text-sm">{message}</p> : null}
      {problems.length > 0 ? (
        <ul className="mb-3 space-y-0.5 rounded border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          {problems.map((problem, index) => (
            <li key={index}>· {problem}</li>
          ))}
        </ul>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <select
          className="oa-input w-56"
          value={versionId ?? ''}
          onChange={(event) => {
            const id = Number(event.target.value);
            setVersionId(id);
            void loadGraph(id);
          }}
        >
          <option value="">选择版本</option>
          {(detail?.versions ?? []).map((version) => (
            <option key={version.id} value={version.id}>
              v{version.version}
              {version.publishedAt ? '（已发布·只读）' : '（草稿）'}
            </option>
          ))}
        </select>
        {graph ? (
          <StatusBadge
            status={graph.isLocked ? 'PUBLISHED' : 'DRAFT'}
            label={graph.isLocked ? `v${graph.version} 已发布并锁定` : `v${graph.version} 草稿`}
          />
        ) : null}
      </div>

      {!versionId ? (
        <div className="oa-card text-sm text-muted-foreground">
          已发布版本锁定不能直接改。点右上角「新建草稿版本」从现有版本克隆一份开始编辑。
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="oa-card">
            <textarea
              className="oa-input h-[60vh] py-2 font-mono text-xs"
              value={text}
              onChange={(event) => setText(event.target.value)}
              spellCheck={false}
            />
          </div>
          <aside className="oa-card space-y-2 text-xs text-muted-foreground">
            <div className="text-sm font-medium text-foreground">编辑要点</div>
            <p>· 节点必须有唯一的 <code>nodeKey</code>；恰好一个 <code>START</code>、至少一个 <code>END</code>。</p>
            <p>· 投票层要填 <code>layerIndex</code>（从 1 起、不重复），并给 <code>voteRule</code> 与至少一条 <code>voterRules</code>。</p>
            <p>· 除了 START 外不能有孤立节点，除了 END 外不能有死路，整图不能有环。</p>
            <p>· 保存会**整图替换**（先删边再删节点，同一事务），不会留下改一半的图。</p>
            <p>· 发布后版本被锁定，实例只认已发布版本，保证历史可复现。</p>
          </aside>
        </div>
      )}
    </>
  );
}
