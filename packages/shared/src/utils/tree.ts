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

/** 带子节点的递归类型（避免 children 类型不自洽） */
export type TreeNode<T> = T & { children: TreeNode<T>[] };

export interface BuildTreeOptions<T extends TreeNodeLike> {
  sort?: (a: T, b: T) => number;
}

/** 平铺列表 → 树（组织架构页与部门选择器共用） */
export function buildTree<T extends TreeNodeLike>(
  nodes: T[],
  options: BuildTreeOptions<T> = {},
): TreeNode<T>[] {
  const map = new Map<number, TreeNode<T>>();
  const roots: TreeNode<T>[] = [];

  for (const node of nodes) {
    map.set(node.id, { ...node, children: [] });
  }

  for (const node of nodes) {
    const current = map.get(node.id);
    if (!current) continue;
    const parent = node.parentId != null ? map.get(node.parentId) : undefined;
    if (parent) parent.children.push(current);
    else roots.push(current);
  }

  if (options.sort) {
    const comparator = options.sort;
    const sortRec = (list: TreeNode<T>[]): void => {
      list.sort(comparator);
      for (const item of list) sortRec(item.children);
    };
    sortRec(roots);
  }

  return roots;
}
