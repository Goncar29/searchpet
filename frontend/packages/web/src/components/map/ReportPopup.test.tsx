import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Report } from '@shared/types';
import { ReportPopup } from './ReportPopup';
import { drawnPaths, iconPath, EMOJI } from '../../test/icons';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

// Emoji ignore `currentColor` and dark mode; the popup draws an icon instead.
describe('ReportPopup — sin emoji', () => {
  it('la antigüedad del reporte se dibuja con el ícono schedule', () => {
    const report = {
      id: 'r1',
      status: 'lost',
      created_at: '2026-06-23T10:00:00Z',
      pet: { id: 'p1', name: 'Rex', type: 'perro', photos: [] },
    } as unknown as Report;
    const { container } = render(
      <MemoryRouter>
        <ReportPopup report={report} />
      </MemoryRouter>,
    );

    expect(container.textContent).not.toMatch(EMOJI);
    expect(drawnPaths(container)).toContain(iconPath('schedule'));
  });
});
