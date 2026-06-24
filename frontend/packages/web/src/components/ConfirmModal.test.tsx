import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmModal } from './ConfirmModal';

describe('ConfirmModal', () => {
  it('renders the title and message', () => {
    render(
      <ConfirmModal
        title="Ban user"
        message="This will block the user from logging in."
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.getByText('Ban user')).toBeTruthy();
    expect(screen.getByText('This will block the user from logging in.')).toBeTruthy();
  });

  it('fires onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmModal title="t" message="m" confirmLabel="Ban" onConfirm={onConfirm} onCancel={() => {}} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ban' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('fires onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal title="t" message="m" onConfirm={() => {}} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables the confirm button and does not fire onConfirm while loading', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmModal
        title="t"
        message="m"
        confirmLabel="Delete"
        loading
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );

    const confirmBtn = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    fireEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders extra content passed as children (e.g. a reason field)', () => {
    render(
      <ConfirmModal title="t" message="m" onConfirm={() => {}} onCancel={() => {}}>
        <input aria-label="reason" />
      </ConfirmModal>
    );

    expect(screen.getByLabelText('reason')).toBeTruthy();
  });
});
