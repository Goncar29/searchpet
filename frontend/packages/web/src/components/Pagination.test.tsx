import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Pagination } from './Pagination';

// Mock i18n: t returns the key, appending interpolation values so the
// "page X of Y" indicator can still be asserted.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(',')}` : key,
    i18n: { language: 'es' },
  }),
}));

describe('Pagination', () => {
  it('renders nothing when there is a single page', () => {
    const { container } = render(<Pagination page={1} totalPages={1} onPageChange={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when totalPages is 0', () => {
    const { container } = render(<Pagination page={1} totalPages={0} onPageChange={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the "page X of Y" indicator', () => {
    render(<Pagination page={2} totalPages={5} onPageChange={vi.fn()} />);
    expect(screen.getByText('pageOf:2,5')).toBeTruthy();
  });

  it('disables prev on the first page and keeps next enabled', () => {
    render(<Pagination page={1} totalPages={3} onPageChange={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'prev' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'next' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables next on the last page and keeps prev enabled', () => {
    render(<Pagination page={3} totalPages={3} onPageChange={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'next' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'prev' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls onPageChange with the next/previous page from the middle', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} totalPages={5} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByRole('button', { name: 'prev' }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
