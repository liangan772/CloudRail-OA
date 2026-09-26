import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** className 合并：clsx 处理条件，tailwind-merge 处理同类冲突（后写的胜） */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
