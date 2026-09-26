'use client';

import { SWRConfig } from 'swr';
import { swrFetcher } from '@/lib/api-client';

// 全局 SWR 配置：统一 fetcher（含刷新与错误码语义）；
// 关掉 focus 重验证（切窗口就刷会打断填写）与自动重试（错误交给页面展示）。
export function SwrProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: swrFetcher,
        revalidateOnFocus: false,
        shouldRetryOnError: false,
        keepPreviousData: true,
      }}
    >
      {children}
    </SWRConfig>
  );
}
