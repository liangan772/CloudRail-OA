/** 权重与计票辅助（纯函数，计票引擎与前端预览共用） */

/** 保留 4 位小数，避免浮点误差累积 */
export function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function sumBy<T>(items: readonly T[], pick: (item: T) => number): number {
  return round4(items.reduce((acc, item) => acc + pick(item), 0));
}

/** 比例判断（含浮点容差），ratio(3,5) >= 0.6 为 true */
export function gteRatio(numerator: number, denominator: number, threshold: number): boolean {
  if (denominator <= 0) return false;
  return round4(numerator / denominator) >= round4(threshold);
}

export function gtRatio(numerator: number, denominator: number, threshold: number): boolean {
  if (denominator <= 0) return false;
  return round4(numerator / denominator) > round4(threshold);
}

/** 多数：同意 > 分母/2 */
export function isMajority(approve: number, denominator: number): boolean {
  if (denominator <= 0) return false;
  return approve > denominator / 2;
}

export function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 1000) / 10;
}
