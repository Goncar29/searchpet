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
  /**
   * Rendered on the right of the label row — currently the "forgot password?"
   * link, which is where the Stitch login screen puts it.
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

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <label htmlFor={id} className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
        {labelAction}
      </div>

      <div className="relative">
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

      {error && (
        <p id={errorId} className="text-red-500 dark:text-red-400 text-sm mt-1.5">
          {error}
        </p>
      )}
    </div>
  );
}
