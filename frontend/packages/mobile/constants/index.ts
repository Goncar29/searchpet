// ============================================================
// SearchPet - Constantes
// ============================================================

export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8081';

export const COLORS = {
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

  // Neutrals
  white: '#FFFFFF',
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

  // Social
  whatsapp: '#25D366',
  facebook: '#1877F2',
  instagram: '#E4405F',
  twitter: '#1DA1F2',
};

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

export const PET_TYPES = [
  { value: 'perro', label: 'Perro', icon: '🐕' },
  { value: 'gato', label: 'Gato', icon: '🐱' },
  { value: 'pajaro', label: 'Pájaro', icon: '🐦' },
  { value: 'otro', label: 'Otro', icon: '🐾' },
] as const;

export const REPORT_STATUSES = [
  { value: 'lost', label: 'Perdido', color: COLORS.lost },
  { value: 'found', label: 'Encontrado', color: COLORS.found },
  { value: 'sighting', label: 'Avistamiento', color: COLORS.sighting },
] as const;

export const MAP_DEFAULTS = {
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0421,
  // Montevideo como default
  defaultLatitude: -34.9011,
  defaultLongitude: -56.1645,
};

// ============================================================
// GAMIFICATION — Badge metadata
// ============================================================

export const BADGE_META: Record<string, { emoji: string; label: string; description: string }> = {
  first_helper:       { emoji: '🤝', label: 'Primer Ayudante',   description: 'Creó su primer reporte de avistamiento' },
  pet_rescuer:        { emoji: '🦸', label: 'Rescatador',        description: 'Ayudó a reunir una mascota con su familia' },
  social_butterfly:   { emoji: '📣', label: 'Social',            description: 'Compartió reportes en redes sociales' },
  verified_finder:    { emoji: '✅', label: 'Verificado',        description: 'Identidad verificada por la plataforma' },
  community_guardian: { emoji: '🛡️', label: 'Guardián',          description: 'Contribuyó activamente a la comunidad' },
  super_finder:       { emoji: '🌟', label: 'Super Finder',      description: 'Encontró múltiples mascotas perdidas' },
};
