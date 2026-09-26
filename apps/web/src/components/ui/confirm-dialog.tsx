'use client';

import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button } from './button';
import { Modal } from './modal';

/**
 * 危险操作二次确认。破坏性操作必须走这里 —— 比 window.confirm 可控（能写清后果），
 * 也比让调用方每次手写一遍弹窗省事。
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={title} onClose={onClose} width="sm">
      <div className="flex gap-3">
        {danger ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger-subtle text-danger">
            <AlertTriangle className="h-4 w-4" />
          </div>
        ) : null}
        <div className="min-w-0 flex-1 pt-1 text-sm leading-relaxed text-muted-foreground">{description}</div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {cancelText}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={handleConfirm}>
          {confirmText}
        </Button>
      </div>
    </Modal>
  );
}
