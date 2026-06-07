import { ApiError } from '../api/client';

// Minimal TFunction type — compatible with i18next's `t` and any mock.
type TFunction = (key: string) => string;

/**
 * Resolves a user-facing error message from an unknown thrown value.
 *
 * - If `err` is an `ApiError`, looks up `errors.{code}` via `t`.
 *   Falls back to `errors.unknown_error` when i18next returns the key
 *   unchanged (i.e. the code has no translation).
 * - For any other value, returns `t('errors.unknown_error')`.
 *
 * @param err  - The thrown value (usually from a catch block).
 * @param t    - i18next translation function, already scoped or using full keys.
 */
export function getErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    const key = `errors.${err.code}`;
    const translated = t(key);
    // i18next returns the key string unchanged when no translation is found.
    if (translated !== key) return translated;
  }
  return t('errors.unknown_error');
}
