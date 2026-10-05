import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PointsRulesModal } from './PointsRulesModal';
import { BADGE_META } from '@shared/types';
import { POINTS, BADGE_THRESHOLDS } from '@shared/constants/gamification';

// El mock interpola: devuelve `clave|valores`, así se distingue "pasó el número"
// de "se olvidó el objeto de interpolación".
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}|${Object.values(opts).join(',')}` : key,
    i18n: { language: 'es' },
  }),
}));

describe('PointsRulesModal', () => {
  // The parent passes a fresh inline onClose on every render: a re-render while
  // the modal is open must not yank focus back to the close button.
  it('keeps the user focus when the parent re-renders with a new onClose', () => {
    const ui = (onClose: () => void) => (
      <>
        <button type="button">elsewhere</button>
        <PointsRulesModal onClose={onClose} />
      </>
    );
    const { rerender } = render(ui(() => {}));
    expect(screen.getByRole('button', { name: 'pointsRules:close' })).toHaveFocus();

    const elsewhere = screen.getByRole('button', { name: 'elsewhere' });
    elsewhere.focus();
    const latest = vi.fn();
    rerender(ui(latest));

    expect(elsewhere).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('is a labelled modal dialog', () => {
    render(<PointsRulesModal onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'pointsRules:title' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('shows the four sections', () => {
    render(<PointsRulesModal onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    for (const key of [
      'pointsRules:earn.title',
      'pointsRules:notEarn.title',
      'pointsRules:badges.title',
      'pointsRules:ranking.title',
    ]) {
      expect(within(dialog).getByText(key)).toBeInTheDocument();
    }
  });

  it('shows every way to earn points with the shared numbers', () => {
    render(<PointsRulesModal onClose={() => {}} />);
    expect(screen.getByText(`pointsRules:earn.report|${POINTS.report}`)).toBeInTheDocument();
    expect(screen.getByText(`pointsRules:earn.share|${POINTS.share}`)).toBeInTheDocument();
    expect(screen.getByText(`pointsRules:earn.helper|${POINTS.helper}`)).toBeInTheDocument();
    expect(screen.getByText(`pointsRules:earn.review|${POINTS.reviewReceived}`)).toBeInTheDocument();
  });

  it('shows what does NOT earn points', () => {
    render(<PointsRulesModal onClose={() => {}} />);
    expect(screen.getByText('pointsRules:notEarn.ownFound')).toBeInTheDocument();
    expect(screen.getByText('pointsRules:notEarn.helperOnce')).toBeInTheDocument();
    expect(screen.getByText('pointsRules:notEarn.reviewWritten')).toBeInTheDocument();
    expect(
      screen.getByText(`pointsRules:notEarn.reviewDeleted|${POINTS.reviewReceived}`),
    ).toBeInTheDocument();
  });

  it('lists every badge by its label, with its condition', () => {
    render(<PointsRulesModal onClose={() => {}} />);
    for (const [type, meta] of Object.entries(BADGE_META)) {
      expect(screen.getByText(meta.labelKey)).toBeInTheDocument();
      // Los dos umbrales viajan interpolados; el resto no lleva número.
      const threshold =
        type === 'community_guardian'
          ? BADGE_THRESHOLDS.communityGuardianReports
          : type === 'super_finder'
            ? BADGE_THRESHOLDS.superFinderPets
            : null;
      const text =
        threshold == null
          ? `pointsRules:badges.${type}`
          : `pointsRules:badges.${type}|${threshold}`;
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it('closes from the close button', () => {
    const onClose = vi.fn();
    render(<PointsRulesModal onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'pointsRules:close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes with Escape', () => {
    const onClose = vi.fn();
    render(<PointsRulesModal onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked, but not when the card is', () => {
    const onClose = vi.fn();
    render(<PointsRulesModal onClose={onClose} />);
    fireEvent.click(screen.getByText('pointsRules:earn.title'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
