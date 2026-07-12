import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  useHideConversation,
  useMarkConversationUnread,
  useBlockUser,
  useUnblockUser,
  useBlockedUsers,
  useSubmitAbuseReport,
} from '@shared/hooks';
import type { AbuseReason } from '@shared/types';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { ConfirmModal } from './ConfirmModal';

interface ConversationActionsMenuProps {
  otherUserId: string;
  otherUserName: string;
  /** Called after the conversation is hidden (e.g. ChatPage navigates back). */
  onHidden?: () => void;
  /** Hide the "mark unread" entry (e.g. if ever irrelevant in a context). */
  showMarkUnread?: boolean;
}

type Dialog = 'none' | 'delete' | 'block' | 'report';

interface Toast {
  text: string;
  kind: 'success' | 'error';
}

const TOAST_DURATION_MS = 3000;

/**
 * Kebab menu with per-conversation actions: view profile, mark unread,
 * block/unblock, report and delete (hide). Delete and block ask for
 * confirmation first; report opens a small form for the reason.
 */
export function ConversationActionsMenu({
  otherUserId,
  otherUserName,
  onHidden,
  showMarkUnread = true,
}: ConversationActionsMenuProps) {
  const { t } = useTranslation(['chat', 'errors']);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>('none');
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const hideConversation = useHideConversation();
  const markUnread = useMarkConversationUnread();
  const blockUser = useBlockUser();
  const unblockUser = useUnblockUser();
  const submitReport = useSubmitAbuseReport();
  const { data: blockedUsers } = useBlockedUsers();
  const iBlockedThem = blockedUsers?.some((b) => b.blocked_id === otherUserId) ?? false;

  // Clear any pending toast timer on unmount.
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // Close the dropdown on outside interaction or Escape. Listeners exist only
  // while the menu is open. This closes ONLY the dropdown: the confirm/report
  // dialogs render inside rootRef, so `contains` keeps them unaffected, and
  // they manage their own dismissal.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const showToast = (text: string, kind: Toast['kind']) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, kind });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  };

  const closeAll = () => {
    setOpen(false);
    setDialog('none');
    setError(null);
  };

  // Open a confirm/report dialog with a clean error slate, so a failure from
  // a previous action never leaks into a freshly opened dialog.
  const openDialog = (d: Dialog) => {
    setError(null);
    setDialog(d);
  };

  const handleDelete = () => {
    hideConversation.mutate(otherUserId, {
      onSuccess: () => {
        closeAll();
        onHidden?.();
      },
      onError: (err: Error) => setError(getErrorMessage(err, t)),
    });
  };

  const handleBlockToggle = () => {
    if (iBlockedThem) {
      // Unblock fires directly from the menu (no dialog), so its failure has
      // no dialog to render in — surface it as an error toast instead.
      unblockUser.mutate(otherUserId, {
        onSuccess: closeAll,
        onError: (err: Error) => {
          closeAll();
          showToast(getErrorMessage(err, t), 'error');
        },
      });
      return;
    }
    blockUser.mutate(
      { userId: otherUserId },
      {
        onSuccess: closeAll,
        onError: (err: Error) => setError(getErrorMessage(err, t)),
      }
    );
  };

  const handleReport = () => {
    const trimmed = reason.trim();
    if (!trimmed || submitReport.isPending) return;
    // The backend accepts any non-empty string for `reason` (free text);
    // AbuseReason is a narrower union used elsewhere for fixed-reason
    // pickers, so we cast here rather than widen the shared DTO type.
    submitReport.mutate(
      { target_user_id: otherUserId, reason: trimmed as AbuseReason },
      {
        onSuccess: () => {
          setReason('');
          closeAll();
          showToast(t('chat:actions.reportSuccess'), 'success');
        },
        onError: (err: Error) => setError(getErrorMessage(err, t)),
      }
    );
  };

  const handleMarkUnread = () => {
    // Direct action from the menu: report failures via toast, they would be
    // invisible otherwise.
    markUnread.mutate(otherUserId, {
      onSuccess: closeAll,
      onError: (err: Error) => {
        closeAll();
        showToast(getErrorMessage(err, t), 'error');
      },
    });
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t('chat:actions.menuLabel', { name: otherUserName })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <circle cx="10" cy="4" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="10" cy="16" r="1.6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-56 rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1 z-20"
        >
          <MenuItem
            onClick={() => {
              closeAll();
              navigate(`/users/${otherUserId}`);
            }}
          >
            {t('chat:actions.viewProfile')}
          </MenuItem>
          {showMarkUnread && (
            <MenuItem onClick={handleMarkUnread}>{t('chat:actions.markUnread')}</MenuItem>
          )}
          <MenuItem onClick={() => (iBlockedThem ? handleBlockToggle() : openDialog('block'))}>
            {iBlockedThem ? t('chat:actions.unblock') : t('chat:actions.block')}
          </MenuItem>
          <MenuItem onClick={() => openDialog('report')}>{t('chat:actions.report')}</MenuItem>
          <MenuItem destructive onClick={() => openDialog('delete')}>
            {t('chat:actions.delete')}
          </MenuItem>
        </div>
      )}

      {dialog === 'delete' && (
        <ConfirmModal
          title={t('chat:actions.deleteConfirmTitle')}
          message={t('chat:actions.deleteConfirmBody')}
          confirmLabel={t('chat:actions.confirm')}
          cancelLabel={t('chat:actions.cancel')}
          destructive
          loading={hideConversation.isPending}
          onConfirm={handleDelete}
          onCancel={closeAll}
        >
          {error && <p className="text-sm text-red-600">{error}</p>}
        </ConfirmModal>
      )}

      {dialog === 'block' && (
        <ConfirmModal
          title={t('chat:actions.blockConfirmTitle', { name: otherUserName })}
          message={t('chat:actions.blockConfirmBody')}
          confirmLabel={t('chat:actions.confirm')}
          cancelLabel={t('chat:actions.cancel')}
          destructive
          loading={blockUser.isPending}
          onConfirm={handleBlockToggle}
          onCancel={closeAll}
        >
          {error && <p className="text-sm text-red-600">{error}</p>}
        </ConfirmModal>
      )}

      {dialog === 'report' && (
        /* Bespoke dialog rather than ConfirmModal: its API can only disable
           BOTH buttons (loading), but here the submit button alone must be
           disabled while the reason is empty, keeping cancel usable. */
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => {
            if (!submitReport.isPending) closeAll();
          }}
          role="dialog"
          aria-modal="true"
          aria-label={t('chat:actions.reportTitle', { name: otherUserName })}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {t('chat:actions.reportTitle', { name: otherUserName })}
            </h3>
            <label htmlFor="report-reason" className="mt-4 block text-sm text-gray-600 dark:text-gray-300 mb-1">
              {t('chat:actions.reportReasonLabel')}
            </label>
            <textarea
              id="report-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('chat:actions.reportReasonPlaceholder')}
              rows={4}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeAll}
                disabled={submitReport.isPending}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {t('chat:actions.cancel')}
              </button>
              <button
                type="button"
                onClick={handleReport}
                disabled={!reason.trim() || submitReport.isPending}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {t('chat:actions.reportSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-30 rounded-xl text-white text-sm px-4 py-2 shadow-lg ${
            toast.kind === 'error' ? 'bg-red-600' : 'bg-gray-900'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  destructive = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${
        destructive ? 'text-red-600' : 'text-gray-700 dark:text-gray-200'
      }`}
    >
      {children}
    </button>
  );
}
