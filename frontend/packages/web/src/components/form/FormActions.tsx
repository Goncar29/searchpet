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
 * Order is cancel-then-submit in the DOM, which is the reading order on desktop
 * (primary action on the right, where the eye finishes) and the tab order.
 *
 * It stacks with `flex-col` and NOT `flex-col-reverse`. The reverse was here to
 * put the primary button on top on a phone, but it only flips the PAINTING
 * order: the DOM — and therefore focus order — stays cancel-then-submit, so a
 * keyboard user tabbing off the last field landed on the button drawn *below*
 * the one they saw first. That is the WCAG 2.4.3 / 1.3.2 mismatch, and it is
 * not fixable by reversing: any `*-reverse` decouples the two orders by
 * definition. The premise was wrong anyway — stacked at the end of a form, the
 * LAST child is the one nearest the thumb, not the furthest.
 */
export function FormActions({ cancel, submit }: FormActionsProps) {
  return (
    <div className="pt-6 mt-2 border-t border-gray-200 dark:border-gray-700">
      <div className="flex flex-col sm:flex-row sm:justify-end gap-3">
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
