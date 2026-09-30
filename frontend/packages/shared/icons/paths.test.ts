import { describe, expect, it } from 'vitest';
import { ICON_PATHS } from './paths';

// Guard for future data swaps: both Icon components render each value as the
// `d` of a single <path> on a 24x24 viewBox.
describe('ICON_PATHS', () => {
  const entries = Object.entries(ICON_PATHS);

  it('is not empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s is non-empty path data', (_name, d) => {
    expect(typeof d).toBe('string');
    expect(d.trim()).not.toBe('');
    // Path data must start with a move command.
    expect(d).toMatch(/^[Mm]/);
    // Single-path contract: no markup leaked in from the icon source.
    expect(d).not.toMatch(/[<>"]/);
  });
});
