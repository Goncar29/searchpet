import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../Icon';

interface AuthFieldProps {
  label: string;
  type: 'text' | 'email' | 'tel' | 'password';
  value: string;
  onChange: (value: string) => void;
  /** Leading glyph inside the field, as in the Stitch auth screens. */
  icon: IconName;
  error?: string;
  placeholder?: string;
  autoComplete?: string;
  /** Needed by the recovery OTP field, which is digits-only and exactly 6 long. */
  inputMode?: 'numeric';
  maxLength?: number;
  /**
   * Only for a field that appears as the result of an action the user just
   * took. Password recovery swaps the whole form when the code step arrives,
   * which drops focus to <body>: without this the user hears nothing and has to
   * Tab from the top of the document to find the field that appeared. Never put
   * it on a field that is present at page load.
   */
  autoFocus?: boolean;
  /**
   * Rendered on the right of the label row — the "forgot password?" link on
   * login.
   *
   * ONLY USE THIS ON THE LAST FIELD OF A FORM. It is declared after the input
   * in the DOM (so it does not intercept someone arriving at the field), which
   * means it sits between this field and whatever comes next. On a middle field
   * that puts a control in the way of the Tab from this input to the following
   * one — measured on password recovery, where the resend button landed between
   * the code and the new password, and activating it wipes the code just typed.
   * A label-row action has only two possible DOM positions and both intercept
   * something; last-field is the only place where neither hurts.
   */
  labelAction?: ReactNode;
}

/**
 * A labelled auth input: leading icon, and a reveal toggle when it holds a
 * password.
 *
 * Both auth pages hand-wrote the same input markup six times over, so a styling
 * change had to be applied six times to stay consistent — and the association
 * between label and input had already been lost: every field in RegisterPage
 * rendered a bare `<label>` with no `htmlFor` and an `<input>` with no `id`, so
 * a screen reader announced the control unnamed and clicking the label did
 * nothing. `useId` makes that association impossible to forget.
 */
export function AuthField({
  label,
  type,
  value,
  onChange,
  icon,
  error,
  placeholder,
  autoComplete,
  inputMode,
  maxLength,
  autoFocus,
  labelAction,
}: AuthFieldProps) {
  const { t } = useTranslation(['auth']);
  const id = useId();
  const errorId = `${id}-error`;
  const [revealed, setRevealed] = useState(false);

  const isPassword = type === 'password';
  // A revealed password field becomes a text field; keeping type="password"
  // and faking it would let the browser keep masking the value.
  const inputType = isPassword && revealed ? 'text' : type;

  // Grid with explicit placement, not a flex row, because tab order follows DOM
  // order and ignores visual order. `labelAction` is the "forgot password?" link
  // and the Stitch design puts it up on the label row — but writing it there in
  // the markup put it BEFORE the password input in the DOM, so tabbing out of
  // the email field landed on a navigation link, and Enter there left the page
  // and discarded what the user had typed. Measured, not assumed. Declaring it
  // last and pinning it to row 1 / column 2 keeps the design and restores
  // input-then-link for the keyboard.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
      <label
        htmlFor={id}
        className="col-start-1 row-start-1 self-baseline mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {label}
      </label>

      <div className="col-span-2 row-start-2 relative">
        <Icon
          name={icon}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 dark:text-gray-500"
        />
        <input
          id={id}
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          maxLength={maxLength}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`w-full rounded-xl border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 pl-10 ${
            isPassword ? 'pr-11' : 'pr-4'
          } py-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary ${
            error
              ? 'border-red-400 dark:border-red-500'
              : 'border-gray-200 dark:border-gray-700'
          }`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((prev) => !prev)}
            // The button has no visible text, so it carries the accessible name
            // itself. Never move this onto the icon: an aria-label there would
            // be dropped, since the glyph is aria-hidden.
            aria-label={revealed ? t('auth:hidePassword') : t('auth:showPassword')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
          >
            <Icon name={revealed ? 'visibility-off' : 'visibility'} className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Declared after the input on purpose — see the note above the grid. */}
      {labelAction && (
        <div className="col-start-2 row-start-1 self-baseline justify-self-end mb-1.5">
          {labelAction}
        </div>
      )}

      {error && (
        <p
          id={errorId}
          // `aria-describedby` alone only reaches the message once focus is
          // already inside the field. Submitting with an empty field leaves
          // focus on the button, so without a live region the form just
          // silently refuses to submit for anyone not watching the screen.
          role="alert"
          className="col-span-2 row-start-3 text-red-500 dark:text-red-400 text-sm mt-1.5"
        >
          {error}
        </p>
      )}
    </div>
  );
}
