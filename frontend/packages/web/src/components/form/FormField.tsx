import type { ReactNode } from 'react';

/**
 * Shared class list for the controls inside a `FormField`.
 *
 * Exported as a string rather than wrapped in an `<input>` component on
 * purpose: the thirteen forms this design has to cover use inputs, textareas,
 * selects, date pickers and a Leaflet map, and a component that tried to own
 * all of them would grow a prop per control type. The wrapper owns the label,
 * the error and the spacing — which is the part every field shares — and the
 * caller keeps its own element.
 *
 * `px-6 py-4` comes from the design (24px / 16px), measured against the mock
 * rather than guessed: the placeholder sits 24px from the field's left edge and
 * the control lands at ~52px tall.
 */
export const formControlClass =
  'w-full px-6 py-4 rounded-xl border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ' +
  'placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none transition-colors ' +
  'border-gray-300 dark:border-gray-600 focus:border-primary focus:ring-2 focus:ring-primary/20';

/** Swapped in for `border-gray-300 …` when the field is showing an error. */
export const formControlErrorClass =
  'w-full px-6 py-4 rounded-xl border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ' +
  'placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none transition-colors ' +
  'border-danger focus:border-danger focus:ring-2 focus:ring-danger/20';

interface FormFieldProps {
  label: string;
  /** Must match the control's `id`, so clicking the label focuses it. */
  htmlFor: string;
  /** Rendered after the label, muted — for "(optional)". */
  hint?: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}

/**
 * Label, control and error message for one field.
 *
 * The error is rendered with `role="alert"` so a screen reader announces it
 * when it appears after a failed submit, instead of leaving the user to
 * discover it by navigating back over the field.
 */
export function FormField({ label, htmlFor, hint, required, error, children }: FormFieldProps) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
      >
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
        {hint && <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">{hint}</span>}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-danger text-sm mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
