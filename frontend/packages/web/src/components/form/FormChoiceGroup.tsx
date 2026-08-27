export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

interface FormChoiceGroupProps<T extends string> {
  /** Prefijo de los ids del grupo. Con él se arman el del error y el de cada control. */
  id: string;
  legend: string;
  options: readonly ChoiceOption<T>[];
  /** `radio` elige uno; `checkbox` elige varios. */
  type: 'radio' | 'checkbox';
  /** Un valor para `radio`, la lista de elegidos para `checkbox`. */
  value: T | readonly T[];
  onToggle: (value: T) => void;
  required?: boolean;
  error?: string;
  /**
   * Lo que un lector de pantalla oye en lugar del asterisco. La pantalla lo
   * pasa traducido — nunca se arma acá pegando texto.
   */
  requiredLabel?: string;
}

/**
 * Un grupo de opciones excluyentes (`radio`) o múltiples (`checkbox`).
 *
 * **`<fieldset>` + `<legend>` y no `role="group"` + `aria-labelledby`.** Es el
 * patrón que ya usa `CreateReportPage`, y su comentario explica por qué: con
 * `role="group"` la obligatoriedad **no se anuncia por ningún lado**, porque
 * ARIA 1.2 sólo admite `aria-required` en `radiogroup` y en roles de control.
 * Un asterisco `aria-hidden` sobre un `role="group"` le da al usuario que ve
 * una marca de requerido que el que no ve **no puede recibir** — una asimetría
 * neta, y una regresión que esa pantalla ya tuvo que reparar una vez.
 * Por eso acá la obligatoriedad viaja como TEXTO dentro de la leyenda, oculto a
 * la vista pero no al lector.
 *
 * **Y el error se cuelga de CADA control, no del grupo.** Un
 * `aria-describedby` en el contenedor no se anuncia cuando el foco entra a los
 * controles: el usuario oye el `role="alert"` una vez, tabula para corregir y
 * no recibe nada — ni "inválido", ni el mensaje, ni cuál grupo falla. Es
 * exactamente el modo de falla que `FormField` documenta haber cerrado para los
 * campos de texto ("anuncia una vez y después se queda mudo"), y no tendría
 * sentido dejarlo abierto en el único control de la pantalla que no es texto.
 *
 * Tampoco `role="radiogroup"` escrito a mano con botones (lo que hace hoy
 * `AlertsPage`): ese patrón exige un único tab stop y navegación con flechas, y
 * declararlo sin implementar el teclado promete un comportamiento que no está.
 * Con controles nativos, la exclusividad, las flechas y el tab stop único los
 * pone el navegador.
 */
export function FormChoiceGroup<T extends string>({
  id,
  legend,
  options,
  type,
  value,
  onToggle,
  required,
  error,
  requiredLabel,
}: FormChoiceGroupProps<T>) {
  const errorId = `${id}-error`;
  const seleccionado = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);

  return (
    <fieldset {...(error ? { 'aria-describedby': errorId } : {})}>
      <legend className="flex items-baseline gap-1 mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
        {legend}
        {required && (
          <>
            <span aria-hidden="true" className="text-danger">
              *
            </span>
            {/* La palabra es lo que hace que el requerido llegue al lector de
                pantalla; el asterisco es su equivalente visual y por eso queda
                `aria-hidden`. Sin esto, el símbolo lo ve sólo quien mira. */}
            {requiredLabel && <span className="sr-only">{requiredLabel}</span>}
          </>
        )}
      </legend>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
          >
            <input
              type={type}
              name={type === 'radio' ? id : undefined}
              value={o.value}
              checked={seleccionado(o.value)}
              onChange={() => onToggle(o.value)}
              // El error viaja en cada control, no en el `<fieldset>`.
              {...(error ? { 'aria-invalid': true as const, 'aria-describedby': errorId } : {})}
              className={`${type === 'checkbox' ? 'rounded' : ''} h-4 w-4 border-gray-300 dark:border-gray-600 text-primary focus:ring-2 focus:ring-primary/30`}
            />
            {o.label}
          </label>
        ))}
      </div>

      {error && (
        // Mismo marcado que el error de `FormField`, para que los dos tipos de
        // campo se vean y se anuncien igual.
        <p id={errorId} role="alert" className="text-danger text-sm mt-2">
          {error}
        </p>
      )}
    </fieldset>
  );
}
