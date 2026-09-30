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
    // Single-element contract: the value is the `d` of ONE <path>, so it may
    // hold many subpaths (several M/m) but only path commands, numbers and
    // separators — no markup, attributes or other elements from the source.
    expect(d).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,eE+\-\s]+$/);
  });
});
