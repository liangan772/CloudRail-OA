'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'oa-button',
  secondary: 'oa-button-secondary',
  ghost: 'oa-button-ghost',
  danger: 'oa-button-danger',
  subtle: 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary-subtle px-4 text-sm font-medium text-primary transition-all duration-150 hover:brightness-[0.97] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
};

const SIZE_CLASS: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: '',
  lg: 'h-10 px-5',
  icon: 'h-9 w-9 !px-0',
  'icon-sm': 'h-8 w-8 !px-0',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** 进行中：自动禁用 + 显示转圈，避免重复提交 */
  loading?: boolean;
  icon?: ReactNode;
}

/**
 * 统一按钮。四种变体对应四种语义层级：
 * primary 主操作 / secondary 次操作 / ghost 弱操作 / danger 破坏性操作。
 * 一屏最多一个 primary。
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const iconOnly = size === 'icon' || size === 'icon-sm';
  return (
    <button
      type={type}
      className={cn(VARIANT_CLASS[variant], SIZE_CLASS[size], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={iconOnly ? 14 : 13} /> : icon}
      {iconOnly ? null : children}
    </button>
  );
}
