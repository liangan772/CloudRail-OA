import { ERROR_CODES, type ErrorDef, type WorkflowNodeType } from '@oa/shared';

/**
 * 流程节点图校验（纯函数，零 IO）。
 *
 * 这是**发布模板版本**的硬门槛：图不合法就不允许发布，避免脏模板进入生产后
 * 实例化到一半卡住（阶段 0 §6 的节点图约束）。
 *
 * 校验项：
 * 1. 节点非空、nodeKey 唯一且非空；
 * 2. 恰好一个 START，至少一个 END；
 * 3. 投票层必须给 `layerIndex`（从 1 开始）且不重复 —— 层号是「第几层投票」的唯一口径；
 * 4. 边两端的节点必须存在，禁止自环；
 * 5. 除 START 外不允许孤立节点（没有上游），除 END 外不允许死路节点（没有下游）；
 * 6. 必须是有向无环图（拓扑排序可完成）；
 * 7. 所有节点必须从 START 可达。
 */

export interface GraphNodeInput {
  nodeKey: string;
  type: WorkflowNodeType;
  /** 投票层号（仅 VOTE 节点有意义，从 1 开始） */
  layerIndex?: number | null;
  name?: string;
}

export interface GraphEdgeInput {
  from: string;
  to: string;
}

export type GraphValidationResult =
  | { ok: true; topologicalOrder: string[]; voteLayers: number[] }
  | { ok: false; error: ErrorDef; reasons: string[] };

function fail(reasons: string[]): GraphValidationResult {
  return { ok: false, error: ERROR_CODES.WF_NODE_GRAPH_INVALID, reasons };
}

export function validateNodeGraph(
  nodes: readonly GraphNodeInput[],
  edges: readonly GraphEdgeInput[],
): GraphValidationResult {
  const reasons: string[] = [];

  if (nodes.length === 0) reasons.push('节点图为空');

  const keys = nodes.map((n) => n.nodeKey);
  const duplicated = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  if (duplicated.length > 0) reasons.push(`节点 key 重复：${duplicated.join(', ')}`);
  if (keys.some((key) => !key || key.trim().length === 0)) reasons.push('存在空的 nodeKey');

  const starts = nodes.filter((n) => n.type === 'START');
  const ends = nodes.filter((n) => n.type === 'END');
  if (starts.length !== 1) reasons.push(`必须恰好一个开始节点，当前 ${starts.length} 个`);
  if (ends.length === 0) reasons.push('至少需要一个结束节点');

  const voteNodes = nodes.filter((n) => n.type === 'VOTE');
  const layerValues = voteNodes.map((n) => n.layerIndex ?? 0);
  if (voteNodes.some((n) => !n.layerIndex || n.layerIndex < 1)) {
    reasons.push('投票层必须指定 layerIndex（从 1 开始）');
  }
  const duplicatedLayers = [...new Set(layerValues.filter((v, i) => layerValues.indexOf(v) !== i))];
  if (duplicatedLayers.length > 0) reasons.push(`投票层号重复：${duplicatedLayers.join(', ')}`);

  const keySet = new Set(keys);
  for (const edge of edges) {
    if (!keySet.has(edge.from)) reasons.push(`边引用了不存在的起始节点：${edge.from}`);
    if (!keySet.has(edge.to)) reasons.push(`边引用了不存在的目标节点：${edge.to}`);
    if (edge.from === edge.to) reasons.push(`禁止自环：${edge.from}`);
  }
  if (reasons.length > 0) return fail(reasons);

  const startKey = starts[0]!.nodeKey;
  const endKeys = new Set(ends.map((n) => n.nodeKey));

  const outMap = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const key of keys) {
    outMap.set(key, []);
    inDegree.set(key, 0);
  }
  for (const edge of edges) {
    outMap.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const orphans = keys.filter((key) => key !== startKey && (inDegree.get(key) ?? 0) === 0);
  if (orphans.length > 0) reasons.push(`存在孤立节点（没有上游）：${orphans.join(', ')}`);

  const deadEnds = keys.filter((key) => !endKeys.has(key) && (outMap.get(key)?.length ?? 0) === 0);
  if (deadEnds.length > 0) reasons.push(`存在死路节点（没有下游）：${deadEnds.join(', ')}`);

  // Kahn 拓扑排序：既得到执行顺序，也顺带发现环
  const workingDegree = new Map(inDegree);
  const queue = keys.filter((key) => (workingDegree.get(key) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const next of outMap.get(current) ?? []) {
      const left = (workingDegree.get(next) ?? 0) - 1;
      workingDegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  if (order.length !== keys.length) reasons.push('节点图存在环，无法拓扑排序');

  // 可达性：从 START 出发能否覆盖全部节点
  const reachable = new Set<string>([startKey]);
  const stack = [startKey];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const next of outMap.get(current) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        stack.push(next);
      }
    }
  }
  const unreachable = keys.filter((key) => !reachable.has(key));
  if (unreachable.length > 0) {
    reasons.push(`存在从开始节点不可达的节点：${unreachable.join(', ')}`);
  }
  // 一次性把所有问题都报出来（环与不可达往往同时出现，逐个报会来回改好几轮）
  if (reasons.length > 0) return fail(reasons);

  return {
    ok: true,
    topologicalOrder: order,
    voteLayers: [...new Set(layerValues)].sort((a, b) => a - b),
  };
}
