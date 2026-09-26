import type { Metadata } from 'next';
import { SwrProvider } from '@/components/providers/swr-provider';
import { AppToaster } from '@/components/ui/toast';
import { SessionProvider } from '@/lib/session';
import './globals.css';

export const metadata: Metadata = {
  title: 'CloudRail OA',
  description: '层级投票制 OA：投票 / 任务 / 上报',
};

/**
 * 主题用 class 承载（dark），首屏由内联脚本按本地偏好设置，避免闪白。
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('oa-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}`,
          }}
        />
      </head>
      <body>
        <SessionProvider>
          <SwrProvider>{children}</SwrProvider>
        </SessionProvider>
        <AppToaster />
      </body>
    </html>
  );
}
