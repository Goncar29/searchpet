// ============================================================
// SearchPet - Constantes
// ============================================================

import type { IconName } from '../../shared/icons/paths';

export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8081';

// OAuth 2.0 Web client id para el login con Google. Es el MISMO valor que usa la
// web y que el backend verifica como audiencia del token — no el de Android.
// Vacío = el botón de Google no se renderiza (ver GoogleSignInButton).
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';

export const LIGHT_COLORS = {
  primary: '#FF6B35',
  primaryDark: '#E5551F',
  primaryLight: '#FF8F66',
  secondary: '#004E89',
  secondaryLight: '#1A6BAF',
  accent: '#FCBF49',
  success: '#22C55E',
  danger: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',

  // Neutrals. `white` is LITERAL white in both themes (text and icons on brand
  // colors). For a background that follows the theme use `surface` or `card`.
  white: '#FFFFFF',
  onPrimary: '#FFFFFF',
  surface: '#FFFFFF',
  background: '#F8F9FA',
  card: '#FFFFFF',
  border: '#E5E7EB',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  placeholder: '#D1D5DB',

  // Status colors
  lost: '#EF4444',
  found: '#22C55E',
  sighting: '#F59E0B',
  adoption: '#7E22CE',
  adopted: '#0F766E',

  // Leaderboard medals (ranks 1-3)
  medalGold: '#D4A017',
  medalSilver: '#9CA3AF',
  medalBronze: '#B4713A',

  // Social
  whatsapp: '#25D366',
  facebook: '#1877F2',
  instagram: '#E4405F',
  twitter: '#1DA1F2',

  // Tinted banners and chips. These used to be hex literals in the screens;
  // the light values are exactly those literals (S6), the dark ones keep the
  // same meaning on a dark page.
  dangerSoftBg: '#FEF2F2',
  dangerSoftBorder: '#FECACA',
  dangerSoftText: '#DC2626',
  warningSoftBg: '#FFFBEB',
  warningSoftBorder: '#FDE68A',
  warningSoftText: '#78350F',
  warningSoftTextAccent: '#92400E',
  noticeBg: '#FFF3CD',
  noticeBorder: '#FFEAA7',
  noticeText: '#856404',
  successSoftBg: '#ECFDF5',
  successSoftTitle: '#065F46',
  successSoftText: '#047857',
  primarySoft: '#FFF0E8',
  // Floating controls over the map.
  floatingSurface: 'rgba(255,255,255,0.95)',
};

export type ThemeColors = typeof LIGHT_COLORS;

// The web's `.dark` tokens (web/src/index.css), so both apps look the same.
// Brand, status, medal and social colors are shared with the light theme.
export const DARK_COLORS: ThemeColors = {
  ...LIGHT_COLORS,
  danger: '#F87171',
  surface: '#1F2937',
  background: '#111827',
  card: '#1F2937',
  border: '#374151',
  textPrimary: '#F9FAFB',
  textSecondary: '#D1D5DB',
  textMuted: '#9CA3AF',
  placeholder: '#6B7280',
  dangerSoftBg: '#3B1A1A',
  dangerSoftBorder: '#7F1D1D',
  dangerSoftText: '#FCA5A5',
  warningSoftBg: '#33280A',
  warningSoftBorder: '#78590F',
  warningSoftText: '#FDE68A',
  warningSoftTextAccent: '#FDE68A',
  noticeBg: '#33280A',
  noticeBorder: '#78590F',
  noticeText: '#FDE68A',
  successSoftBg: '#052E22',
  successSoftTitle: '#A7F3D0',
  successSoftText: '#6EE7B7',
  primarySoft: '#3A2418',
  floatingSurface: 'rgba(31,41,55,0.95)',
};

// Light palette under its old name for files not migrated to the theme yet.
// Reading COLORS does not follow dark mode; use useTheme() instead.
export const COLORS = LIGHT_COLORS;

export const FONTS = {
  regular: 'System',
  medium: 'System',
  bold: 'System',
  sizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 22,
    xxl: 28,
    title: 34,
  },
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const RADIUS = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const SHADOWS = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
};

// `icon` is a registry name (shared/icons/paths.ts): render it with `<Icon>`.
export const PET_TYPES = [
  { value: 'perro', labelKey: 'pets:types.perro', icon: 'dog' },
  { value: 'gato', labelKey: 'pets:types.gato', icon: 'cat' },
  { value: 'pajaro', labelKey: 'pets:types.pajaro', icon: 'bird' },
  { value: 'otro', labelKey: 'pets:types.otro', icon: 'pets' },
] as const satisfies readonly { value: string; labelKey: string; icon: IconName }[];

export const REPORT_STATUSES = [
  { value: 'lost', labelKey: 'pets:status.lost', color: COLORS.lost },
  { value: 'found', labelKey: 'pets:status.found', color: COLORS.found },
  { value: 'sighting', labelKey: 'pets:status.sighting', color: COLORS.sighting },
] as const;

export const MAP_DEFAULTS = {
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0421,
  // Montevideo como default
  defaultLatitude: -34.9011,
  defaultLongitude: -56.1645,
};

