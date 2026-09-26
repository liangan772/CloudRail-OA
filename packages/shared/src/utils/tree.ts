/** 组织树工具：与 Department.path 物化路径保持一致 */

export interface TreeNodeLike {
  id: number;
  parentId: number | null;
  path?: string;
  level?: number;
}

/** 由 path 计算父路径：'/1/3/7/' → '/1/3/'；根返回 '/' */
export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) return '/';
  return `${trimmed.slice(0, idx)}/`;
}

/** 由父路径与自身 id 生成路径 */
export function buildPath(parent: string | null | undefined, id: number): string {
  const base = !parent || parent === '/' ? '/' : `${parent.replace(/\/+$/, '')}/`;
  return `${base}${id}/`;
}

export function levelOf(path: string): number {
  return path.split('/').filter((s) => s.length > 0).length;
}

/** 祖先 id 列表（从近到远，不含自身） */
export function ancestorIds(path: string): number[] {
  return path
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n))
    .reverse();
}

/** 子树查询前缀（含自身）：'/1/3/7/' → '/1/3/7/%' */
export function subtreePrefix(path: string): string {
  return `${path.replace(/\/+$/, '')}/%`;
}

export interface BuildTreeOptions<T extends TreeNodeLike> {
  childrenKey?: string;
  sort?: (a: T, b: T) => number;
}

/** 平铺列表 → 树（前端组织架构页与部门选择器共用） */
export function buildTree<T extends TreeNodeLike>(nodes: T[], options: BuildTreeOptions<T> = {}): (T & { children: T[] })[] {
  const childrenKey = options.childrenKey ?? 'children';
  const map = new Map<number, T & { children: T[] }>();
  const roots: (T & { children: T[] })[] = [];
  for (const node of nodes) {
    map.set(node.id, { ...node, children: [] } as T & { children: T[] });
  }
  for (const node of nodes) {
    const current = map.get(node.id)!;
    const parent = node.parentId != null ? map.get(node.parentId) : undefined;
    if (parent) {
      (parent as unknown as Record<string, unknown>)[childrenKey];
      parent.children.push(current);
    } else {
      roots.push(current);
    }
  }
  if (options.sort) {
    const sortRec = (list: (T & { children: T[] })[]): void => {
      list.sort(options.sort!);
      list.forEach((n) => sortRec(n.children));
    };
    sortRec(roots);
  }
  return roots;
}

/** 从 path 直接构造树（不依赖 parentId，避免脏数据形成环） */
export function treeFromPaths<T extends TreeNodeLike & { name: string }>(nodes: T[]): (T & { children: T[] })[] {
  return buildTree(nodes);
}
