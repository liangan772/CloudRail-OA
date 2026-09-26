import { getByPath, resolveFromContext } from './path';
import {
  COMPARISON_OPS,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_NODES,
  type ComparisonOp,
  type EvaluateOptions,
  type RuleComparison,
  type RuleNode,
  type RuleValue,
} from './types';

export interface ExplainLeaf {
  type: 'leaf';
  op: ComparisonOp;
  path: string;
  left: unknown;
  right: unknown;
  result: boolean;
}
export interface ExplainGroup {
  type: 'and' | 'or' | 'not';
  result: boolean;
  children: ExplainNode[];
}
export type ExplainNode = ExplainLeaf | ExplainGroup;

export class RuleEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleEvaluationError';
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 解析操作数：字面量，或 { $path } 引用上下文 */
function operandValue(value: RuleValue | undefined, ctx: Record<string, unknown>): unknown {
  if (isPlainObject(value) && typeof (value as { $path?: unknown }).$path === 'string') {
    return resolveFromContext(ctx, (value as { $path: string }).$path);
  }
  return value;
}

/** 数值归一：字符串数字、Date、布尔 → number；不可归一返回 NaN */
function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return Number.NaN;
    return Number(t);
  }
  if (v instanceof Date) return v.getTime();
  return Number.NaN;
}

/** 相等比较：数值优先按数值比较（'5' == 5），否则严格比较 */
function looseEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) return false;
  const ln = toNumber(left);
  const rn = toNumber(right);
  if (!Number.isNaN(ln) && !Number.isNaN(rn)) return ln === rn;
  return String(left) === String(right);
}

function compareOrder(left: unknown, right: unknown): number | null {
  const ln = toNumber(left);
  const rn = toNumber(right);
  if (!Number.isNaN(ln) && !Number.isNaN(rn)) {
    return ln === rn ? 0 : ln < rn ? -1 : 1;
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return left === right ? 0 : left < right ? -1 : 1;
  }
  return null;
}

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return true;
}

function evalComparison(
  node: RuleComparison,
  ctx: Record<string, unknown>,
): { result: boolean; op: ComparisonOp; path: string; left: unknown; right: unknown } {
  const key = Object.keys(node).find((k) => (COMPARISON_OPS as readonly string[]).includes(k));
  if (!key) {
    throw new RuleEvaluationError(`未知操作符: ${Object.keys(node).join(',')}`);
  }
  const op = key as ComparisonOp;
  const args = (node as Record<string, unknown>)[key];
  if (!Array.isArray(args) || args.length === 0 || typeof args[0] !== 'string') {
    throw new RuleEvaluationError(`操作符 ${op} 的参数必须是 [path, ...values]`);
  }
  const path = args[0] as string;
  const left = resolveFromContext(ctx, path);
  const right = operandValue(args[1] as RuleValue | undefined, ctx);

  let result: boolean;
  switch (op) {
    case 'exists':
      result = hasValue(left);
      break;
    case 'eq':
      result = looseEquals(left, right);
      break;
    case 'neq':
      result = left === undefined && right === undefined ? false : !looseEquals(left, right);
      break;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const cmp = compareOrder(left, right);
      if (cmp === null) {
        result = false;
      } else if (op === 'gt') result = cmp > 0;
      else if (op === 'gte') result = cmp >= 0;
      else if (op === 'lt') result = cmp < 0;
      else result = cmp <= 0;
      break;
    }
    case 'in': {
      const list = Array.isArray(right) ? right : [];
      result = list.some((item) => looseEquals(left, item));
      break;
    }
    case 'notIn': {
      const list = Array.isArray(right) ? right : [];
      result = !list.some((item) => looseEquals(left, item));
      break;
    }
    case 'contains':
      result =
        typeof left === 'string'
          ? left.includes(String(right ?? ''))
          : Array.isArray(left)
            ? left.some((item) => looseEquals(item, right))
            : false;
      break;
    case 'startsWith':
      result = typeof left === 'string' ? left.startsWith(String(right ?? '')) : false;
      break;
    case 'between': {
      const max = operandValue(args[2] as RuleValue | undefined, ctx);
      const low = compareOrder(left, right);
      const high = compareOrder(left, max);
      result = low !== null && high !== null && low >= 0 && high <= 0;
      break;
    }
    case 'sizeGt':
    case 'sizeLt': {
      const size = Array.isArray(left)
        ? left.length
        : typeof left === 'string'
          ? left.length
          : isPlainObject(left)
            ? Object.keys(left).length
            : -1;
      const threshold = toNumber(operandValue(args[1] as RuleValue | undefined, ctx));
      result = Number.isNaN(threshold)
        ? false
        : op === 'sizeGt'
          ? size > threshold
          : size < threshold;
      break;
    }
    default:
      throw new RuleEvaluationError(`未实现的操作符: ${String(op)}`);
  }
  return { result, op, path, left, right };
}

function checkLimits(node: RuleNode, depth: number, counter: { n: number }, opts: Required<EvaluateOptions>): void {
  if (depth > opts.maxDepth) {
    throw new RuleEvaluationError(`规则嵌套超过 ${opts.maxDepth} 层`);
  }
  counter.n += 1;
  if (counter.n > opts.maxNodes) {
    throw new RuleEvaluationError(`规则节点数超过 ${opts.maxNodes}`);
  }
  if (!isPlainObject(node)) {
    throw new RuleEvaluationError('规则节点必须是对象');
  }
  if ('and' in node && Array.isArray(node.and)) {
    for (const child of node.and) checkLimits(child, depth + 1, counter, opts);
  } else if ('or' in node && Array.isArray(node.or)) {
    for (const child of node.or) checkLimits(child, depth + 1, counter, opts);
  } else if ('not' in node) {
    checkLimits(node.not as RuleNode, depth + 1, counter, opts);
  }
}

function normalizeOptions(opts?: EvaluateOptions): Required<EvaluateOptions> {
  return {
    maxDepth: opts?.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxNodes: opts?.maxNodes ?? DEFAULT_MAX_NODES,
  };
}

/**
 * 求值：纯函数，无 IO。空 and = true，空 or = false（与 §9.1 一致）。
 */
export function evaluate(
  rule: RuleNode,
  ctx: Record<string, unknown>,
  opts?: EvaluateOptions,
): boolean {
  const options = normalizeOptions(opts);
  checkLimits(rule, 1, { n: 0 }, options);
  return evalNode(rule, ctx);
}

function evalNode(rule: RuleNode, ctx: Record<string, unknown>): boolean {
  if (!isPlainObject(rule)) throw new RuleEvaluationError('规则节点必须是对象');
  if ('and' in rule && Array.isArray(rule.and)) {
    return rule.and.every((child) => evalNode(child, ctx));
  }
  if ('or' in rule && Array.isArray(rule.or)) {
    return rule.or.some((child) => evalNode(child, ctx));
  }
  if ('not' in rule) {
    return !evalNode(rule.not as RuleNode, ctx);
  }
  return evalComparison(rule as RuleComparison, ctx).result;
}

/**
 * 可解释求值：返回命中路径与每个叶子的真假。
 * 用于「为什么上报」的解释与流程设计器的在线试算。
 */
export function explain(
  rule: RuleNode,
  ctx: Record<string, unknown>,
  opts?: EvaluateOptions,
): ExplainNode {
  const options = normalizeOptions(opts);
  checkLimits(rule, 1, { n: 0 }, options);
  return explainNode(rule, ctx);
}

function explainNode(rule: RuleNode, ctx: Record<string, unknown>): ExplainNode {
  if (!isPlainObject(rule)) throw new RuleEvaluationError('规则节点必须是对象');
  if ('and' in rule && Array.isArray(rule.and)) {
    const children = rule.and.map((c) => explainNode(c, ctx));
    return { type: 'and', result: children.every((c) => c.result), children };
  }
  if ('or' in rule && Array.isArray(rule.or)) {
    const children = rule.or.map((c) => explainNode(c, ctx));
    return { type: 'or', result: children.some((c) => c.result), children };
  }
  if ('not' in rule) {
    const child = explainNode(rule.not as RuleNode, ctx);
    return { type: 'not', result: !child.result, children: [child] };
  }
  const { result, op, path, left, right } = evalComparison(rule as RuleComparison, ctx);
  return { type: 'leaf', op, path, left, right, result };
}

/** 供 DTO 复用的便捷入口：直接用点路径读值 */
export { getByPath };
