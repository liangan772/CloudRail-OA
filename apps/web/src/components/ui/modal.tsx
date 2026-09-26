'use client';

import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border bg-card shadow-lg" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-medium">{title}</h2>
          <button type="button" className="oa-button-ghost h-7 w-7 p-0" onClick={onClose} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[60vh] overflow-y-auto px-4 py-3 text-sm">{children}</div>
        {footer ? <footer className="flex justify-end gap-2 border-t px-4 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}
