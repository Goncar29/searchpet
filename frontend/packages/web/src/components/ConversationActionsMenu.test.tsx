import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationActionsMenu } from './ConversationActionsMenu';

// i18n mock: t returns the key, with interpolation values appended so tests
// can still assert interpolated content (e.g. the other user's name) shows up.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(',')}` : key,
    i18n: { language: 'es' },
  }),
}));

type MutateOptions = {
  onSuccess?: () => void;
  onError?: (err: Error) => void;
  onSettled?: () => void;
};

const hideConversationMutate = vi.fn();
const markUnreadMutate = vi.fn();
const blockUserMutate = vi.fn();
const unblockUserMutate = vi.fn();
const submitReportMutate = vi.fn();

// Mutable per-test fixture for who the current user has blocked.
let blockedUsersData: { id: string; blocked_id: string; name: string; blocked_at: string }[] = [];

vi.mock('@shared/hooks', () => ({
  useHideConversation: () => ({ mutate: hideConversationMutate, isPending: false }),
  useMarkConversationUnread: () => ({ mutate: markUnreadMutate, isPending: false }),
  useBlockUser: () => ({ mutate: blockUserMutate, isPending: false }),
  useUnblockUser: () => ({ mutate: unblockUserMutate, isPending: false }),
  useSubmitAbuseReport: () => ({ mutate: submitReportMutate, isPending: false }),
  useBlockedUsers: () => ({ data: blockedUsersData }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  blockedUsersData = [];
  // Default: report submit succeeds synchronously.
  submitReportMutate.mockImplementation((_data: unknown, opts?: MutateOptions) => opts?.onSuccess?.());
});

function openMenu() {
  fireEvent.click(screen.getByLabelText('chat:actions.menuLabel'));
}

function openReportDialogAndType(text: string) {
  openMenu();
  fireEvent.click(screen.getByText('chat:actions.report'));
  fireEvent.change(screen.getByLabelText('chat:actions.reportReasonLabel'), {
    target: { value: text },
  });
}

describe('ConversationActionsMenu', () => {
  it('opens the menu and shows the five actions', () => {
    render(<ConversationActionsMenu otherUserId="u2" otherUserName="Alice" />, { wrapper });

    openMenu();

    expect(screen.getByText('chat:actions.viewProfile')).toBeTruthy();
    expect(screen.getByText('chat:actions.markUnread')).toBeTruthy();
    expect(screen.getByText('chat:actions.block')).toBeTruthy();
    expect(screen.getByText('chat:actions.report')).toBeTruthy();
    expect(screen.getByText('chat:actions.delete')).toBeTruthy();
  });

  it('delete shows confirm dialog and calls the hide mutation with the other user id on confirm', () => {
    render(<ConversationActionsMenu otherUserId="u2" otherUserName="Alice" />, { wrapper });

    openMenu();
    fireEvent.click(screen.getByText('chat:actions.delete'));

    expect(screen.getByText('chat:actions.deleteConfirmTitle')).toBeTruthy();

    fireEvent.click(screen.getByText('chat:actions.confirm'));

    expect(hideConversationMutate).toHaveBeenCalledWith('u2', expect.anything());
  });

  it('block shows confirm dialog and calls block mutation on confirm', () => {
    render(<ConversationActionsMenu otherUserId="u2" otherUserName="Alice" />, { wrapper });

    openMenu();
    fireEvent.click(screen.getByText('chat:actions.block'));

    expect(screen.getByText(/chat:actions.blockConfirmTitle/)).toBeTruthy();

    fireEvent.click(screen.getByText('chat:actions.confirm'));

    expect(blockUserMutate).toHaveBeenCalledWith({ userId: 'u2' }, expect.anything());
  });

  it('shows Unblock instead of Block when the other user is already blocked, and calls unblock directly (no confirm dialog)', () => {
    blockedUsersData = [{ id: 'b1', blocked_id: 'u2', name: 'Alice', blocked_at: new Date().toISOString() }];

    render(<ConversationActionsMenu otherUserId="u2" otherUserName="Alice" />, { wrapper });

    openMenu();

    expect(screen.queryByText('chat:actions.block')).toBeNull();
    expect(screen.getByText('chat:actions.unblock')).toBeTruthy();

    fireEvent.click(screen.getByText('chat:actions.unblock'));

    expect(unblockUserMutate).toHaveBeenCalledWith('u2', expect.anything());
    // No confirm dialog for unblock.
    expect(screen.queryByText('chat:actions.confirm')).toBeNull();
  });

  it('report opens a modal; typing a reason and submitting calls the report mutation with the other user id + reason', async () => {
    render(<ConversationActionsMenu otherUserId="u2" otherUserName="Alice" />, { wrapper });

    openReportDialogAndType('Sending spam messages');
    fireEvent.click(screen.getByText('chat:actions.reportSubmit'));

    await waitFor(() => {
      expect(submitReportMutate).toHaveBeenCalledWith(
        { target_user_id: 'u2', reason: 'Sending spam messages' },
        expect.anything()
      );
    });
  });

  it('report submit is disabled while the reason is empty and enabled once typed', () => {
    render(<ConversationActionsMenu otherUserId="u2" otherUserName="Alice" />, { wrapper });

    openMenu();
    fireEvent.click(screen.getByText('chat:actions.report'));

    const submitBtn = screen.getByRole('button', { name: 'chat:actions.reportSubmit' }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    fireEvent.click(submitBtn);
    expect(submitReportMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('chat:actions.reportReasonLabel'), {
      target: { value: 'Spam' },
    });
    expect(submitBtn.disabled).toBe(false);
  });

  it('shows the reportSuccess toast after a successful submit', async () => {
    render(<ConversationActionsMenu otherUserId="u2" otherUserName="Alice" />, { wrapper });

    openReportDialogAndType('Sending spam messages');
    fireEvent.click(screen.getByText('chat:actions.reportSubmit'));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('chat:actions.reportSuccess');
    });
  });

  it('auto-dismisses the toast after a few seconds', () => {
    vi.useFakeTimers();
    try {
      render(<ConversationActionsMenu otherUserId="u2" otherUserName="Alice" />, { wrapper });

      openReportDialogAndType('Spam');
      fireEvent.click(screen.getByText('chat:actions.reportSubmit'));

      expect(screen.getByRole('status')).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(3100);
      });

      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a report error inside the dialog and does not leak it into other dialogs afterwards', () => {
    submitReportMutate.mockImplementation((_data: unknown, opts?: MutateOptions) =>
      opts?.onError?.(new Error('boom'))
    );

    render(<ConversationActionsMenu otherUserId="u2" otherUserName="Alice" />, { wrapper });

    openReportDialogAndType('Spam');
    fireEvent.click(screen.getByText('chat:actions.reportSubmit'));

    // getErrorMessage falls back to errors:unknown_error for plain Errors.
    expect(screen.getByText('errors:unknown_error')).toBeTruthy();

    // Cancel and open the delete dialog: the stale error must not reappear.
    fireEvent.click(screen.getByText('chat:actions.cancel'));
    openMenu();
    fireEvent.click(screen.getByText('chat:actions.delete'));

    expect(screen.queryByText('errors:unknown_error')).toBeNull();
  });

  it('hides the mark-unread entry when showMarkUnread is false', () => {
    render(
      <ConversationActionsMenu otherUserId="u2" otherUserName="Alice" showMarkUnread={false} />,
      { wrapper }
    );

    openMenu();

    expect(screen.queryByText('chat:actions.markUnread')).toBeNull();
    // The rest of the menu is still there.
    expect(screen.getByText('chat:actions.viewProfile')).toBeTruthy();
    expect(screen.getByText('chat:actions.delete')).toBeTruthy();
  });

  it('mark unread calls the markUnread mutation with the other user id', () => {
    render(<ConversationActionsMenu otherUserId="u2" otherUserName="Alice" />, { wrapper });

    openMenu();
    fireEvent.click(screen.getByText('chat:actions.markUnread'));

    expect(markUnreadMutate).toHaveBeenCalledWith('u2', expect.anything());
  });

  it('shows an error toast when mark unread fails', () => {
    markUnreadMutate.mockImplementation((_id: string, opts?: MutateOptions) =>
      opts?.onError?.(new Error('boom'))
    );

    render(<ConversationActionsMenu otherUserId="u2" otherUserName="Alice" />, { wrapper });

    openMenu();
    fireEvent.click(screen.getByText('chat:actions.markUnread'));

    expect(screen.getByRole('status').textContent).toBe('errors:unknown_error');
  });

  it('shows an error toast when unblock fails', () => {
    blockedUsersData = [{ id: 'b1', blocked_id: 'u2', name: 'Alice', blocked_at: new Date().toISOString() }];
    unblockUserMutate.mockImplementation((_id: string, opts?: MutateOptions) =>
      opts?.onError?.(new Error('boom'))
    );

    render(<ConversationActionsMenu otherUserId="u2" otherUserName="Alice" />, { wrapper });

    openMenu();
    fireEvent.click(screen.getByText('chat:actions.unblock'));

    expect(screen.getByRole('status').textContent).toBe('errors:unknown_error');
  });
});
