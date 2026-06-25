import type { ReactNode } from 'react';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Apply destructive (red) styling to the confirm button. */
  destructive?: boolean;
  /** Disable actions and show a busy state while the confirm mutation runs. */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional extra content rendered between the message and the buttons. */
  children?: ReactNode;
}

/**
 * Reusable confirmation dialog. The parent controls mounting (render it only
 * while a confirmation is pending) and passes the action via onConfirm.
 */
export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmModalProps) {
  const confirmClasses = destructive
    ? 'bg-red-600 text-white hover:bg-red-700'
    : 'bg-primary text-white hover:bg-primary/90';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={() => {
        if (!loading) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{message}</p>

        {children && <div className="mt-4">{children}</div>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ${confirmClasses}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
