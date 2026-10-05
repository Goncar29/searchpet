import { COLORS, DARK_COLORS, LIGHT_COLORS } from '../constants';

// S6: light mode looks exactly as before. These are the values COLORS had
// before dark mode existed; a light palette that drifts from them changes the
// app for every user who never touches the setting.
describe('palettes', () => {
  it('keeps the light palette identical to the old COLORS', () => {
    expect(COLORS).toBe(LIGHT_COLORS);
    expect(LIGHT_COLORS).toMatchObject({
      primary: '#FF6B35',
      white: '#FFFFFF',
      background: '#F8F9FA',
      card: '#FFFFFF',
      border: '#E5E7EB',
      textPrimary: '#111827',
      textSecondary: '#6B7280',
      textMuted: '#9CA3AF',
      placeholder: '#D1D5DB',
      danger: '#EF4444',
    });
    expect(LIGHT_COLORS.surface).toBe('#FFFFFF');
  });

  // S3: the web's dark tokens.
  it('uses the web dark tokens and keeps brand and status colors', () => {
    expect(DARK_COLORS).toMatchObject({
      background: '#111827',
      surface: '#1F2937',
      card: '#1F2937',
      border: '#374151',
      textPrimary: '#F9FAFB',
      textMuted: '#9CA3AF',
      danger: '#F87171',
    });
    expect(DARK_COLORS.primary).toBe(LIGHT_COLORS.primary);
    expect(DARK_COLORS.lost).toBe(LIGHT_COLORS.lost);
  });

  // `white` stays literal white so text on brand buttons keeps reading.
  it('keeps white and onPrimary white in the dark theme', () => {
    expect(DARK_COLORS.white).toBe('#FFFFFF');
    expect(DARK_COLORS.onPrimary).toBe('#FFFFFF');
  });
});
