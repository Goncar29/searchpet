// The footer renders `footer:madeWith` through <Trans> with a self-closing
// <heart/> tag. MainLayout's test mocks Trans, so this one runs the REAL
// i18next instance against the real copy in every language: the tag must be
// replaced by the component, never shown as literal text.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Trans } from 'react-i18next';
import i18n from './index';

describe('footer:madeWith with the real i18next', () => {
  it.each(['es', 'en', 'pt'])('swaps <heart/> for the icon in %s', async (lng) => {
    await i18n.changeLanguage(lng);
    const { container, getByTestId } = render(
      <Trans i18nKey="footer:madeWith" components={{ heart: <span data-testid="heart" /> }} />,
    );
    expect(getByTestId('heart')).toBeTruthy();
    expect(container.textContent).not.toContain('<heart');
    expect(container.textContent).not.toContain('footer:madeWith');
    expect(container.textContent?.trim().length).toBeGreaterThan(10);
  });
});
