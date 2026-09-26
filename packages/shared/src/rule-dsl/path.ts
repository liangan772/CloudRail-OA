import { RULE_ROOTS, type RuleRoot } from './types';

/**
 * 解析 `rsplit` 形式的路径：`formData.items[0].amount`
 * 支持 `.` 与 `[n]`，不支持函数调用或表达式，杜绝任意代码执行。
 */
export function parsePath(path: string): string[] {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('路径必须是非空字符串');
  }
  const segments: string[] = [];
  const normalized = path.replace(/\[(\d+)\]/g, '.$1');
  for (const raw of normalized.split('.')) {
    const seg = raw.trim();
    if (seg.length === 0) continue;
    if (!/^[A-Za-z_$][\w$]*$|^\d+$/.test(seg)) {
      throw new Error(`非法路径片段: ${seg}`);
    }
    segments.push(seg);
  }
  if (segments.length === 0) {
    throw new Error(`非法路径: ${path}`);
  }
  return segments;
}

export function assertAllowedRoot(path: string): RuleRoot {
  const [root] = parsePath(path);
  if (!root || !(RULE_ROOTS as readonly string[]).includes(root)) {
    throw new Error(`路径根不在白名单内: ${String(root)}`);
  }
  return root as RuleRoot;
}

/** 读取路径值；缺失返回 undefined，不抛错（求值需要区分"缺失"与"false"） */
export function getByPath(ctx: unknown, path: string): unknown {
  let current: unknown = ctx;
  for (const seg of parsePath(path)) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) return undefined;
      current = current[idx];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/** 从上下文中取根：`formData.amount` → ctx.formData.amount */
export function resolveFromContext(ctx: Record<string, unknown>, path: string): unknown {
  const [root, ...rest] = parsePath(path);
  if (rest.length === 0) return ctx[root as string];
  return getByPath(ctx[root as string], rest.join('.'));
}
