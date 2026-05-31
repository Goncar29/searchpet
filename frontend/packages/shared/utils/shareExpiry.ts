export interface ExpiryInfo {
  label: string;
  daysRemaining: number;
  isWarning: boolean;
  isExpired: boolean;
  hasExpiry: boolean;
}

export function getExpiryInfo(expiresAt: string | undefined): ExpiryInfo {
  if (!expiresAt) {
    return {
      label: '',
      daysRemaining: Infinity,
      isWarning: false,
      isExpired: false,
      hasExpiry: false,
    };
  }

  const expiry = new Date(expiresAt);
  if (isNaN(expiry.getTime())) {
    return {
      label: '',
      daysRemaining: Infinity,
      isWarning: false,
      isExpired: false,
      hasExpiry: false,
    };
  }

  const diffMs = expiry.getTime() - Date.now();
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  const isExpired = daysRemaining <= 0;
  const isWarning = daysRemaining > 0 && daysRemaining < 7;

  const label = expiry.toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return {
    label: `Vence ${label}`,
    daysRemaining,
    isWarning,
    isExpired,
    hasExpiry: true,
  };
}
