/**
 * Shared surface styling for the auth screens.
 *
 * LoginPage, RegisterPage and GoogleAuthPanel each render this same card, and
 * before this const they carried three hand-copied class strings that had
 * already drifted: the auth pages used `dark:border-gray-700` while every
 * redesigned page uses `dark:border-gray-800`. One export means the next auth
 * screen — password recovery is the third of the family — inherits the styling
 * instead of copying a fourth variant of it.
 */
export const AUTH_CARD =
  'bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-5 sm:p-6';
