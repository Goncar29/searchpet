import type { ReactNode } from 'react';

/**
 * Class list for the control inside a `FormField`.
 *
 * One function instead of two exported strings: the plain and the error variant
 * differ only in border and ring, and as separate constants whoever changed the
 * padding had to remember both — forgetting gave a form whose fields changed
 * density depending on whether they were in error, with nothing failing.
 *
 * `px-6 py-4` comes from the design (24px / 16px), measured against the mock
 * rather than guessed: the placeholder sits 24px from the field's left edge and
 * the control lands at ~52px tall.
 */
export function controlClass(hasError = false): string {
  // `focus:outline-hidden` y no `outline-none` a secas, por dos motivos:
  // el primero sólo actúa al enfocar (el `outline-none` suelto mataba también
  // el indicador en reposo), y deja un contorno transparente que el modo de
  // colores forzados del sistema sí puede pintar. Con `outline-none` un usuario
  // de alto contraste se quedaba sin ninguna señal de foco.
  //
  // El anillo va en /30 y no en /20: el código que esto reemplaza usaba
  // `focus:ring-primary` OPACO, así que /20 era una regresión — a esa opacidad
  // el anillo ronda 1,2:1 sobre blanco y la única señal real quedaba en el
  // borde. /30 además es lo que ya usan otras 12 pantallas del repo.
  const base =
    'w-full px-6 py-4 rounded-xl border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ' +
    'placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-hidden transition-colors ';
  return (
    base +
    (hasError
      ? 'border-danger focus:border-danger focus:ring-2 focus:ring-danger/30'
      : 'border-gray-300 dark:border-gray-600 focus:border-primary focus:ring-2 focus:ring-primary/30')
  );
}

/**
 * What `FormField` hands to its control. Spread it onto the element.
 *
 * It carries the id, the styling and — the part that matters — the wiring that
 * tells assistive technology this control is invalid and where its message is.
 */
export interface ControlProps {
  id: string;
  className: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

interface FormFieldProps {
  label: string;
  /** Also becomes the control's `id`, so the two can never drift apart. */
  htmlFor: string;
  /** Rendered after the label, muted — for "(optional)". Pass a translated string, never one built by casing another key. */
  hint?: string;
  required?: boolean;
  error?: string;
  /**
   * Receives the props the control must carry. A render prop and not plain
   * children on purpose: the association between a control and its error
   * message is exactly the kind of wiring that gets forgotten once thirteen
   * screens are copying each other, and a value you have to remember to spread
   * fails loudly here (nothing renders) instead of silently (an error no screen
   * reader can find).
   */
  children: (control: ControlProps) => ReactNode;
}

/**
 * Label, control and error message for one field.
 *
 * The error carries `role="alert"` so it is announced the moment it appears,
 * AND is referenced by the control through `aria-describedby`, so a user who
 * tabs back to the field later still hears it. The first without the second
 * announces once and then goes silent — which is what this component did before
 * the wiring existed.
 */
export function FormField({ label, htmlFor, hint, required, error, children }: FormFieldProps) {
  const errorId = `${htmlFor}-error`;
  const control: ControlProps = {
    id: htmlFor,
    className: controlClass(!!error),
    ...(error ? { 'aria-describedby': errorId, 'aria-invalid': true as const } : {}),
    ...(required ? { 'aria-required': true as const } : {}),
  };

  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
      >
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger ml-0.5">
            *
          </span>
        )}
        {hint && <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">{hint}</span>}
      </label>
      {children(control)}
      {error && (
        <p id={errorId} role="alert" className="text-danger text-sm mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
