import { ERROR_CODES } from '@oa/shared';
import { validateNodeGraph, type GraphEdgeInput, type GraphNodeInput } from './graph';

const baseNodes: GraphNodeInput[] = [
  { nodeKey: 'start', type: 'START' },
  { nodeKey: 'vote1', type: 'VOTE', layerIndex: 1, name: '第一层投票' },
  { nodeKey: 'task1', type: 'TASK', name: '任务群' },
  { nodeKey: 'vote2', type: 'VOTE', layerIndex: 2, name: '第二层投票' },
  { nodeKey: 'end', type: 'END' },
];

const baseEdges: GraphEdgeInput[] = [
  { from: 'start', to: 'vote1' },
  { from: 'vote1', to: 'task1' },
  { from: 'task1', to: 'vote2' },
  { from: 'vote2', to: 'end' },
];

describe('节点图校验 · 正常路径', () => {
  it('合法图返回拓扑顺序与层号列表', () => {
    const r = validateNodeGraph(baseNodes, baseEdges);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.voteLayers).toEqual([1, 2]);
    expect(r.topologicalOrder[0]).toBe('start');
    expect(r.topologicalOrder[r.topologicalOrder.length - 1]).toBe('end');
    expect(r.topologicalOrder).toHaveLength(baseNodes.length);
  });

  it('条件分支（一对多）也是合法图', () => {
    const r = validateNodeGraph(
      [
        { nodeKey: 'start', type: 'START' },
        { nodeKey: 'cond', type: 'CONDITION' },
        { nodeKey: 'vote1', type: 'VOTE', layerIndex: 1 },
        { nodeKey: 'esc', type: 'ESCALATION' },
        { nodeKey: 'end', type: 'END' },
      ],
      [
        { from: 'start', to: 'cond' },
        { from: 'cond', to: 'vote1' },
        { from: 'cond', to: 'esc' },
        { from: 'vote1', to: 'end' },
        { from: 'esc', to: 'end' },
      ],
    );
    expect(r.ok).toBe(true);
  });
});

describe('节点图校验 · 结构与守卫', () => {
  const failReasons = (nodes: GraphNodeInput[], edges: GraphEdgeInput[]): string[] => {
    const r = validateNodeGraph(nodes, edges);
    expect(r.ok).toBe(false);
    if (r.ok) return [];
    expect(r.error).toBe(ERROR_CODES.WF_NODE_GRAPH_INVALID);
    return r.reasons;
  };

  it('空图直接拒绝', () => {
    expect(failReasons([], []).join()).toContain('节点图为空');
  });

  it('必须恰好一个开始节点', () => {
    const reasons = failReasons(
      [...baseNodes, { nodeKey: 'start2', type: 'START' }],
      [...baseEdges, { from: 'start2', to: 'end' }],
    );
    expect(reasons.join()).toContain('必须恰好一个开始节点，当前 2 个');
  });

  it('必须有结束节点', () => {
    const reasons = failReasons(
      baseNodes.filter((n) => n.type !== 'END'),
      baseEdges.filter((e) => e.to !== 'end'),
    );
    expect(reasons.join()).toContain('至少需要一个结束节点');
  });

  it('nodeKey 重复要被发现', () => {
    const reasons = failReasons([...baseNodes, { nodeKey: 'vote1', type: 'TASK' }], baseEdges);
    expect(reasons.join()).toContain('节点 key 重复：vote1');
  });

  it('投票层必须给 layerIndex，且层号不能重复', () => {
    expect(
      failReasons(
        baseNodes.map((n) => (n.nodeKey === 'vote2' ? { ...n, layerIndex: null } : n)),
        baseEdges,
      ).join(),
    ).toContain('投票层必须指定 layerIndex');

    expect(
      failReasons(
        baseNodes.map((n) => (n.type === 'VOTE' ? { ...n, layerIndex: 1 } : n)),
        baseEdges,
      ).join(),
    ).toContain('投票层号重复：1');
  });

  it('边引用不存在的节点、以及自环，都要拒绝', () => {
    expect(failReasons(baseNodes, [...baseEdges, { from: 'ghost', to: 'end' }]).join()).toContain(
      '不存在的起始节点：ghost',
    );
    expect(failReasons(baseNodes, [...baseEdges, { from: 'vote1', to: 'vote1' }]).join()).toContain('禁止自环：vote1');
  });

  it('孤立节点（没有上游）要拒绝', () => {
    const reasons = failReasons([...baseNodes, { nodeKey: 'lost', type: 'TASK' }], baseEdges);
    expect(reasons.join()).toContain('孤立节点');
    expect(reasons.join()).toContain('lost');
  });

  it('死路节点（没有下游且不是 END）要拒绝', () => {
    const reasons = failReasons(
      [...baseNodes, { nodeKey: 'dead', type: 'TASK' }],
      [...baseEdges, { from: 'vote2', to: 'dead' }],
    );
    expect(reasons.join()).toContain('死路节点');
    expect(reasons.join()).toContain('dead');
  });

  it('环要被识别', () => {
    const reasons = failReasons(baseNodes, [...baseEdges, { from: 'vote2', to: 'vote1' }]);
    expect(reasons.join()).toContain('存在环');
  });

  it('旁支节点只要能从 start 到达就算合法（多出口汇合到 END 是允许的）', () => {
    const r = validateNodeGraph(
      [
        { nodeKey: 'start', type: 'START' },
        { nodeKey: 'vote1', type: 'VOTE', layerIndex: 1 },
        { nodeKey: 'side', type: 'TASK' },
        { nodeKey: 'end', type: 'END' },
      ],
      [
        { from: 'start', to: 'vote1' },
        { from: 'vote1', to: 'side' },
        { from: 'vote1', to: 'end' },
        { from: 'side', to: 'end' },
      ],
    );
    expect(r.ok).toBe(true);
  });

  it('与主流程完全断开的孤岛（含环）会被拒绝', () => {
    const reasons = failReasons(
      [
        { nodeKey: 'start', type: 'START' },
        { nodeKey: 'vote1', type: 'VOTE', layerIndex: 1 },
        { nodeKey: 'end', type: 'END' },
        { nodeKey: 'island', type: 'TASK' },
        { nodeKey: 'islandEnd', type: 'END' },
      ],
      [
        { from: 'start', to: 'vote1' },
        { from: 'vote1', to: 'end' },
        { from: 'island', to: 'islandEnd' },
        { from: 'islandEnd', to: 'island' },
      ],
    );
    const text = reasons.join();
    expect(text).toContain('环');
    expect(text).toContain('不可达');
    expect(text).toContain('island');
  });
});
