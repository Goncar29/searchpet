'use strict';

// Mock for @shared/utils/apiErrors — avoids importing client.ts (class ApiError
// extends Error requires @babel/runtime which isn't resolvable from shared/ in Jest).
// The separator is `:` — the i18next namespace separator, rule #12. This mock
// said `errors.` for a while, which made every mobile test assert against a
// lookup production never performs: with a dot i18next reads the whole thing as
// a nested key inside the default namespace and silently returns the key back.
// A double that diverges from the code it stands in for is worse than no double.
const getErrorMessage = (err, t) => {
  if (err && typeof err === 'object' && err.code) {
    const key = `errors:${err.code}`;
    const translated = t(key);
    if (translated !== key) return translated;
  }
  return t('errors:unknown_error');
};

module.exports = { getErrorMessage };
