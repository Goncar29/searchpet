import type { ReactNode } from 'react';

interface FormActionsProps {
  /** The secondary way out — "Cancel". Rendered first, ghost styling. */
  cancel?: ReactNode;
  /** The primary action. Rendered last so it sits closest to the page edge. */
  submit: ReactNode;
}

/**
 * The action row that closes a form: a rule, then the buttons.
 *
 * It lives OUTSIDE the section cards, which is what the Stitch design does and
 * what makes it read as "this ends the whole form" rather than "this ends the
 * last section".
 *
 * Order is cancel-then-submit in the DOM, which is both the reading order on
 * desktop (primary action on the right, where the eye finishes) and the tab
 * order — a keyboard user reaches the destructive-ish exit before the commit,
 * never the other way around.
 *
 * On a phone the row stacks and REVERSES (`flex-col-reverse`), so the primary
 * button ends up on top: stacked, the last child would otherwise be furthest
 * from the thumb, and "Cancel" would be the one sitting under it.
 */
export function FormActions({ cancel, submit }: FormActionsProps) {
  return (
    <div className="pt-6 mt-2 border-t border-gray-200 dark:border-gray-700">
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
        {cancel}
        {submit}
      </div>
    </div>
  );
}

/** Shared styling for the primary button of a form. */
export const formSubmitClass =
  'inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-primary hover:bg-primary-dark ' +
  'text-white font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed';

/** Shared styling for the ghost button beside it. */
export const formCancelClass =
  'inline-flex items-center justify-center px-6 py-3 rounded-lg border border-gray-300 dark:border-gray-600 ' +
  'text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 ' +
  'transition-colors disabled:opacity-60 disabled:cursor-not-allowed';
