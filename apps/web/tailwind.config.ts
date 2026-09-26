import type { Config } from 'tailwindcss';

/**
 * 设计 token 用 CSS 变量承载（见 src/app/globals.css），
 * 组件只引用语义名（background/foreground/status-*），换主题不用改组件。
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        'card-foreground': 'hsl(var(--card-foreground))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        border: 'hsl(var(--border))',
        primary: 'hsl(var(--primary))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        danger: 'hsl(var(--danger))',
        warning: 'hsl(var(--warning))',
        success: 'hsl(var(--success))',
        info: 'hsl(var(--info))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontSize: {
        // 中文正文用 14px 基准，避免默认 16px 在大表格里过宽
        base: ['14px', '22px'],
      },
    },
  },
  plugins: [],
};

export default config;
