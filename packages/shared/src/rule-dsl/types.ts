/**
 * 规则 DSL 文法（docs/stage-0/04-domain-model-draft.md §9）
 *
 *   Rule      := Condition
 *   Condition := Logical | Comparison
 *   Logical   := { "and": [...] } | { "or": [...] } | { "not": ... }
 *   Comparison:= { OP: [Path, Value] }
 */

/** 比较操作符 */
export type ComparisonOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'startsWith'
  | 'exists'
  | 'between'
  | 'sizeGt'
  | 'sizeLt';

export const COMPARISON_OPS: readonly ComparisonOp[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
  'contains',
  'startsWith',
  'exists',
  'between',
  'sizeGt',
  'sizeLt',
] as const;

/** 白名单上下文根：禁止任意路径访问 */
export const RULE_ROOTS = [
  'formData',
  'user',
  'dept',
  'instance',
  'voteResult',
  'task',
  'taskStatus',
  'escalation',
  'now',
  'const',
] as const;
export type RuleRoot = (typeof RULE_ROOTS)[number];

/** 字面量或对另一路径的引用 */
export type RuleValue =
  | string
  | number
  | boolean
  | null
  | { $path: string }
  | readonly (string | number | boolean)[];

export interface RuleComparisonMap {
  eq: [string, RuleValue];
  neq: [string, RuleValue];
  gt: [string, RuleValue];
  gte: [string, RuleValue];
  lt: [string, RuleValue];
  lte: [string, RuleValue];
  in: [string, readonly (string | number | boolean)[]];
  notIn: [string, readonly (string | number | boolean)[]];
  contains: [string, RuleValue];
  startsWith: [string, RuleValue];
  exists: [string];
  between: [string, RuleValue, RuleValue];
  sizeGt: [string, number];
  sizeLt: [string, number];
}

export type RuleComparison = {
  [K in ComparisonOp]: { [P in K]: RuleComparisonMap[K] };
}[ComparisonOp];

export interface RuleAnd {
  and: RuleNode[];
}
export interface RuleOr {
  or: RuleNode[];
}
export interface RuleNot {
  not: RuleNode;
}

export type RuleNode = RuleAnd | RuleOr | RuleNot | RuleComparison;

/** 求值上下文：根名 → 任意结构 */
export type RuleContext = Record<string, unknown>;

export interface EvaluateOptions {
  /** 最大嵌套深度，默认 10 */
  maxDepth?: number;
  /** 最大节点数，默认 200 */
  maxNodes?: number;
}

export const DEFAULT_MAX_DEPTH = 10;
export const DEFAULT_MAX_NODES = 200;
