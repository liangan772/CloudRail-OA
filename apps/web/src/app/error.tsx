'use client';

import { useEffect } from 'react';

// 全局错误边界：把异常收敛成"可重试"的一屏，而不是白屏。
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 生产环境这里接前端埋点；开发期直接打到控制台便于定位
    console.error('[oa-web] 页面异常', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold">页面出错了</h1>
      <p className="max-w-md text-sm text-muted-foreground">{error.message || '未知错误'}</p>
      {error.digest ? <p className="text-xs text-muted-foreground">traceId: {error.digest}</p> : null}
      <button type="button" className="oa-button" onClick={reset}>
        重试
      </button>
    </div>
  );
}
