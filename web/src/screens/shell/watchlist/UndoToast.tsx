/**
 * Undo toast (checklist F.5, watchlist.html state 4): "Removed IWM · Undo",
 * auto-dismissed after UNDO_MS. Mounted only while a message is showing
 * (no status region without a toast); `role="status"` carries the implicit
 * polite announcement of the inserted text.
 */

import { useEffect } from "react";
import { UNDO_MS } from "./storage";

export interface ToastState {
  /** Changes with every message so a repeat of the same text restarts the timer. */
  key: number;
  message: string;
  /** Present for a removal; absent for a plain notice ("List is full"). */
  onUndo?: () => void;
}

interface Props {
  toast: ToastState | null;
  onDismiss: () => void;
  ms?: number;
}

export default function UndoToast({ toast, onDismiss, ms = UNDO_MS }: Props) {
  const key = toast?.key ?? null;
  useEffect(() => {
    if (key == null) return;
    const t = window.setTimeout(onDismiss, ms);
    return () => window.clearTimeout(t);
    // A new message (new key) restarts the timer; unmount clears it.
  }, [key, ms, onDismiss]);

  if (!toast) return null;
  return (
    <div role="status" aria-live="polite" className="mrr-toast">
      <span>{toast.message}</span>
      {toast.onUndo ? (
        <button type="button" onClick={toast.onUndo}>
          Undo
        </button>
      ) : null}
    </div>
  );
}
