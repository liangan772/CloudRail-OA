'use client';

import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';

/**
 * 全局提示。sonner 自带堆叠、自动消失、悬停暂停，
 * 这里只负责把主题跟当前的 dark class 对齐（否则暗色下弹窗是白的，很扎眼）。
 */
function useIsDark(): boolean {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains('dark'));
    sync();
    // 顶栏的切换按钮直接改 class，所以监听 class 变化而不是自定义事件
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

export function AppToaster() {
  const dark = useIsDark();
  return (
    <Toaster
      theme={dark ? 'dark' : 'light'}
      position="top-center"
      offset={16}
      duration={3200}
      visibleToasts={4}
      toastOptions={{
        classNames: {
          toast:
            'oa-toast !rounded-lg !border !border-border !bg-card !text-card-foreground !shadow-[var(--shadow-lg)] !text-sm',
          title: '!font-medium',
          description: '!text-muted-foreground !text-xs',
          actionButton: '!bg-primary !text-primary-foreground !rounded-md !text-xs',
          cancelButton: '!bg-muted !text-muted-foreground !rounded-md !text-xs',
        },
      }}
    />
  );
}

export { toast } from 'sonner';
