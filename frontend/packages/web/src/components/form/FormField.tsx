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
 * Extra classes for a read-only control.
 *
 * These are `read-only:` variants and NOT plain utilities, and that is the whole
 * point. Appending a plain `bg-gray-50 text-gray-400` after `controlClass()`
 * does not win: the order of the class attribute decides nothing, the order of
 * the stylesheet does, and Tailwind emits `bg-gray-50` before `bg-white` and
 * `text-gray-400` before `text-gray-900`. Measured by compiling this project's
 * own Tailwind — the read-only email field came out white with full-contrast
 * text in light mode while dark mode did grey it, which is exactly the signature
 * of an override that never took. The variant appends `:read-only` to the
 * selector, so it wins on specificity (0,2,0) over both the base utilities and
 * the `dark:` ones, whose `:where(.dark, .dark *)` adds nothing.
 */
const readOnlyClass =
  'read-only:bg-gray-50 read-only:text-gray-500 read-only:cursor-not-allowed ' +
  'dark:read-only:bg-gray-900 dark:read-only:text-gray-400';

/**
 * What `FormField` hands to its control. Spread it onto the element.
 *
 * It carries the id, the styling and — the part that matters — the wiring that
 * tells assistive technology this control is invalid and where its message is.
 */
export interface ControlProps {
  id: string;
  className: string;
  readOnly?: true;
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
  /**
   * Helper text BELOW the control — for a sentence that would not fit beside the
   * label ("this address cannot be changed", "visible to anyone contacting you").
   *
   * Separate from `hint` because the two differ in placement and in length, not
   * in meaning: a short qualifier reads beside the label, a full sentence does
   * not. Both end up in `aria-describedby`, so neither is visual-only.
   */
  description?: string;
  required?: boolean;
  /**
   * The control shows a value the user cannot change here.
   *
   * `readOnly` and never `disabled`: a disabled control is not focusable, is out
   * of the tab order and is skipped by screen-reader browse modes, so its
   * `description` — the sentence explaining why it cannot be changed — is
   * announced to nobody and stays visual-only. Read-only keeps it focusable and
   * selectable (you can still copy your own email) while refusing edits.
   *
   * The native attribute carries the state on its own; no `aria-readonly` on top
   * of it, which would only restate what the platform already exposes.
   */
  readOnly?: boolean;
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
export function FormField({
  label,
  htmlFor,
  hint,
  description,
  required,
  readOnly,
  error,
  children,
}: FormFieldProps) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;
  const descriptionId = `${htmlFor}-description`;

  // El hint viaja por `aria-describedby` y NO por el nombre accesible. Vive en un
  // `<span>` hermano del `<label>` a propósito —meterlo adentro cambiaría el
  // `textContent` y rompería `getByLabelText`, que es justo por lo que el
  // asterisco está afuera—, así que sin esta referencia el control se llama sólo
  // "Nombre" y el "(opcional)" queda para quien MIRA. Es la misma asimetría
  // ver/oír contra la que argumenta el comentario de `FormChoiceGroup`.
  // El orden es el VISUAL: hint (al lado de la etiqueta), description (debajo
  // del control) y error (al final). Un lector de pantalla lee `describedby` en
  // el orden en que están listados los ids, así que cualquier otro orden le
  // contaría la pantalla en una secuencia que nadie ve.
  const describedBy = [
    hint ? hintId : null,
    description ? descriptionId : null,
    error ? errorId : null,
  ]
    .filter(Boolean)
    .join(' ');

  const control: ControlProps = {
    id: htmlFor,
    className: controlClass(!!error) + (readOnly ? ` ${readOnlyClass}` : ''),
    ...(readOnly ? { readOnly: true as const } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(error ? { 'aria-invalid': true as const } : {}),
    ...(required ? { 'aria-required': true as const } : {}),
  };

  return (
    <div>
      {/* El asterisco y el hint van FUERA del <label>, no adentro.
          `getByLabelText` y varias herramientas de accesibilidad computan el
          nombre a partir del textContent de la etiqueta: con el asterisco
          adentro, "Fotos" pasaba a ser "Fotos*" y toda consulta por texto
          exacto dejaba de encontrarlo. Medido — rompio 15 tests del wizard de
          una sola vez, y se habria repetido en cada pantalla que adopte esto.
          La obligatoriedad ya viaja por aria-required, que es donde tiene que
          estar; el asterisco es decoracion y por eso queda aria-hidden. */}
      <div className="flex items-baseline gap-1 mb-2">
        <label htmlFor={htmlFor} className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          {label}
        </label>
        {required && (
          <span aria-hidden="true" className="text-danger">
            *
          </span>
        )}
        {hint && (
          <span id={hintId} className="text-sm text-gray-400 dark:text-gray-500">
            {hint}
          </span>
        )}
      </div>
      {children(control)}
      {/* `text-gray-500 dark:text-gray-400` y no el `gray-400/gray-500` que usa
          el hint de arriba: a 12px esa combinación da ~2,6:1 sobre blanco y
          ~3,6:1 sobre gray-900, las dos por debajo del 4,5:1 que pide AA. El
          hint puede permitírselo discutiblemente porque es un calificador corto
          y redundante ("(opcional)"); esta descripción lleva información que no
          está en ningún otro lado ("esta dirección no se puede cambiar"), y
          además es el default que hereda toda pantalla que adopte el slot. */}
      {description && (
        <p id={descriptionId} className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-danger text-sm mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
