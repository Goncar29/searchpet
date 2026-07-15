import type { PetStatus } from '../types';

export interface ExpiryInfo {
  // Parsed expiry date so callers can format it in the user's locale.
  // null when there is no applicable expiry (hasExpiry === false).
  expiresAt: Date | null;
  daysRemaining: number;
  isWarning: boolean;
  isExpired: boolean;
  hasExpiry: boolean;
}

const NO_EXPIRY: ExpiryInfo = {
  expiresAt: null,
  daysRemaining: Infinity,
  isWarning: false,
  isExpired: false,
  hasExpiry: false,
};

// Mientras la mascota siga en búsqueda activa (lost/stray) el backend ignora
// la expiración del link, así que la UI tampoco la muestra. La fecha solo
// aplica una vez resuelta la búsqueda (found/archived/registered).
export function getExpiryInfo(expiresAt: string | undefined, petStatus?: PetStatus): ExpiryInfo {
  if (petStatus === 'lost' || petStatus === 'stray') {
    return NO_EXPIRY;
  }

  if (!expiresAt) {
    return NO_EXPIRY;
  }

  const expiry = new Date(expiresAt);
  if (isNaN(expiry.getTime())) {
    return NO_EXPIRY;
  }

  const diffMs = expiry.getTime() - Date.now();
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  const isExpired = daysRemaining <= 0;
  const isWarning = daysRemaining > 0 && daysRemaining < 7;

  return {
    expiresAt: expiry,
    daysRemaining,
    isWarning,
    isExpired,
    hasExpiry: true,
  };
}
