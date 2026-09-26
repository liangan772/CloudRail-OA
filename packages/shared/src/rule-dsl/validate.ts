import { assertAllowedRoot } from './path';
import {
  COMPARISON_OPS,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_NODES,
  type ComparisonOp,
  type RuleNode,
} from './types';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const ARITY: Record<ComparisonOp, number[]> = {
  eq: [2],
  neq: [2],
  gt: [2],
  gte: [2],
  lt: [2],
  lte: [2],
  in: [2],
  notIn: [2],
  contains: [2],
  startsWith: [2],
  exists: [1],
  between: [3],
  sizeGt: [2],
  sizeLt: [2],
};

const LIST_OPS: ComparisonOp[] = ['in', 'notIn', 'contains'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 模板发布前的静态校验：未知操作符、路径越界、参数个数、类型不匹配、深度/节点数超限。
 * 校验通过才允许发布版本，避免线上才发现规则写错。
 */
export function validateRule(
  rule: RuleNode,
  opts?: { maxDepth?: number; maxNodes?: number },
): ValidationResult {
  const errors: string[] = [];
  const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = opts?.maxNodes ?? DEFAULT_MAX_NODES;
  let count = 0;

  const walk = (node: unknown, depth: number): void => {
    if (depth > maxDepth) {
      errors.push(`规则嵌套超过 ${maxDepth} 层`);
      return;
    }
    count += 1;
    if (count > maxNodes) {
      if (!errors.includes(`规则节点数超过 ${maxNodes}`)) errors.push(`规则节点数超过 ${maxNodes}`);
      return;
    }
    if (!isPlainObject(node)) {
      errors.push('规则节点必须是对象');
      return;
    }

    if ('and' in node) {
      if (!Array.isArray(node.and)) {
        errors.push('and 必须是数组');
        return;
      }
      node.and.forEach((c) => walk(c, depth + 1));
      return;
    }
    if ('or' in node) {
      if (!Array.isArray(node.or)) {
        errors.push('or 必须是数组');
        return;
      }
      node.or.forEach((c) => walk(c, depth + 1));
      return;
    }
    if ('not' in node) {
      walk(node.not, depth + 1);
      return;
    }

    const opKeys = Object.keys(node).filter((k) => (COMPARISON_OPS as readonly string[]).includes(k));
    if (opKeys.length === 0) {
      errors.push(`未知的规则节点或操作符: ${JSON.stringify(Object.keys(node))}`);
      return;
    }
    if (opKeys.length > 1) {
      errors.push(`一个比较节点只能有一个操作符: ${opKeys.join(',')}`);
      return;
    }
    const op = opKeys[0] as ComparisonOp;
    const args = (node as Record<string, unknown>)[op];
    if (!Array.isArray(args)) {
      errors.push(`${op} 的参数必须是数组`);
      return;
    }
    const allowed = ARITY[op];
    if (!allowed.includes(args.length)) {
      errors.push(`${op} 需要 ${allowed.join(' 或 ')} 个参数，实际 ${args.length} 个`);
      return;
    }
    if (typeof args[0] !== 'string') {
      errors.push(`${op} 的第一个参数必须是路径字符串`);
      return;
    }
    try {
      assertAllowedRoot(args[0]);
    } catch (err) {
      errors.push((err as Error).message);
    }
    if (LIST_OPS.includes(op) && !Array.isArray(args[1])) {
      errors.push(`${op} 的第二个参数必须是数组`);
    }
    if ((op === 'sizeGt' || op === 'sizeLt') && typeof args[1] !== 'number') {
      errors.push(`${op} 的阈值必须是数字`);
    }
  };

  walk(rule, 1);
  return { ok: errors.length === 0, errors };
}

/** 人类可读的规则描述，用于投票规则卡片与上报原因说明 */
export function describeRule(rule: RuleNode): string {
  const OPS: Record<ComparisonOp, string> = {
    eq: '等于',
    neq: '不等于',
    gt: '大于',
    gte: '不小于',
    lt: '小于',
    lte: '不大于',
    in: '属于',
    notIn: '不属于',
    contains: '包含',
    startsWith: '以…开头',
    exists: '存在',
    between: '介于',
    sizeGt: '长度大于',
    sizeLt: '长度小于',
  };
  const render = (n: RuleNode): string => {
    if ('and' in n) return `(${n.and.map(render).join(' 且 ')})`;
    if ('or' in n) return `(${n.or.map(render).join(' 或 ')})`;
    if ('not' in n) return `非${render(n.not)}`;
    const op = Object.keys(n).find((k) => (COMPARISON_OPS as readonly string[]).includes(k)) as
      | ComparisonOp
      | undefined;
    if (!op) return '<未知规则>';
    const args = (n as Record<string, unknown>)[op] as unknown[];
    const val = args[1];
    const shown = isPlainObject(val) && '$path' in val ? String((val as { $path: string }).$path) : JSON.stringify(val);
    if (op === 'exists') return `${String(args[0])} 存在`;
    if (op === 'between') return `${String(args[0])} ${OPS[op]} ${JSON.stringify(args[1])} 与 ${JSON.stringify(args[2])} 之间`;
    return `${String(args[0])} ${OPS[op]} ${shown}`;
  };
  return render(rule);
}
