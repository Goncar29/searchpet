'use strict';

// Mock for @shared/utils/apiErrors — avoids importing client.ts (class ApiError
// extends Error requires @babel/runtime which isn't resolvable from shared/ in Jest).
const getErrorMessage = (err, t) => {
  if (err && typeof err === 'object' && err.code) {
    const key = `errors.${err.code}`;
    const translated = t(key);
    if (translated !== key) return translated;
  }
  return t('errors.unknown_error');
};

module.exports = { getErrorMessage };
