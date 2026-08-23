import { useTranslation } from 'react-i18next';
import { controlClass as formControlClass } from './form/FormField';
import type { PetGender } from '@shared/types';
import {
  birthDateYears,
  selectableDays,
  selectableMonths,
  type BirthDateParts,
} from '@shared/utils/petBirthDate';

// Sexo y fecha de nacimiento, juntos porque siempre se piden juntos y para que
// las pantallas que los piden compartan UNA definicion en vez de duplicar el
// markup.
//
// LO USAN LAS CUATRO SUPERFICIES DE ALTA/EDICION DE WEB: CreatePetPage,
// EditPetPage, y los pasos StrayFormStep y AdoptionFormStep del wizard.
//
// Lo que TODAVIA falta es MOBILE — pets/register.tsx, (tabs)/post.tsx y sus dos
// pasos del wizard siguen sin poder cargar estos campos. Ahi no alcanza con
// importar este componente: es React DOM (<select>, <fieldset>, clases de
// Tailwind) y hace falta un equivalente nativo.
//
// Se enumera explicito porque una version anterior de este comentario decia
// "los cuatro formularios" cuando solo lo usaban dos, y se leia como que la
// divergencia ya estaba resuelta.
//
// LA FECHA SE PIDE EN TRES SELECTS Y LA PRECISION SE DERIVA de cuanto lleno el
// usuario. No hay ningun control que diga "precision": si solo elige el anio,
// la precision es 'year'. Eso hace ESTRUCTURALMENTE IMPOSIBLE el par
// incoherente que el backend rechaza con 400 — no es que la UI lo valide, es
// que no lo puede construir.

export interface PetIdentityValue {
  gender: PetGender | '';
  birth: BirthDateParts;
}

interface Props {
  value: PetIdentityValue;
  onChange: (next: PetIdentityValue) => void;
  disabled?: boolean;
  /** Error de la fecha, cuando el par no se pudo armar con lo elegido. */
  birthDateError?: string;
  /**
   * Oculta la fecha de nacimiento y deja sólo el sexo.
   *
   * Lo usa el alta de CALLEJERA: quien la reporta es un desconocido que la
   * encontró en la calle. El sexo lo puede VER; la fecha de nacimiento no la
   * puede saber. Ofrecerle un selector de año lo invita a inventar, y la
   * precisión existe justamente para que nadie tenga que fabricar certeza.
   */
  hideBirthDate?: boolean;
}

const labelClass = 'block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2';

// Toma la clase del sistema de formularios en vez de mantener la suya.
//
// Sus CUATRO consumidores —CreatePetPage, EditPetPage, StrayFormStep y
// AdoptionFormStep— ya usan las primitivas, asi que con una clase propia este
// bloque quedaba con OTRA densidad adentro de la misma card: los campos de
// alrededor a 52px de alto y estos a 38, con radios distintos. No se ve como un
// bug, se ve como un descuido, que es peor — nadie lo reporta y nadie lo
// arregla. Se ve en la captura de EditPetPage: "Nombre" contra "Sexo".
const controlClass =
  formControlClass() + ' disabled:opacity-50 disabled:cursor-not-allowed';

export function PetIdentityFields({ value, onChange, disabled, birthDateError, hideBirthDate }: Props) {
  const { t, i18n } = useTranslation(['pets', 'common']);

  // Los nombres de mes salen de Intl con el idioma activo, no de 36 claves de
  // traduccion. Menos que mantener, y siempre correcto: si maniana entra otro
  // idioma, los meses ya estan.
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(i18n.language, { month: 'long' }).format(new Date(2000, i, 1))
  );

  const years = birthDateYears();
  // La oferta se corta en HOY cuando el año elegido es el actual. Nadie nació
  // mañana, y ofrecerlo hacía que el update borrara la fecha guardada sin decir
  // nada. Lo que no se puede elegir no hay que validarlo después.
  const months = selectableMonths(value.birth.year);
  const days = selectableDays(value.birth.year, value.birth.month);

  const setBirth = (patch: Partial<BirthDateParts>) => {
    const birth = { ...value.birth, ...patch };
    // Vaciar el anio vacia todo: mes y dia sin anio no ubican nada en el
    // tiempo, y dejarlos puestos mostraria una seleccion que no se va a mandar.
    if (!birth.year) {
      birth.month = '';
      birth.day = '';
    }
    // Vaciar el mes vacia el dia por lo mismo — "el 9 de algun mes" no existe
    // en el modelo.
    if (!birth.month) birth.day = '';
    // Cambiar a un mes mas corto tiene que soltar un dia que ya no existe, o
    // quedaria un 31 de febrero seleccionado que composeBirthDate descarta en
    // silencio: el usuario perderia la fecha entera sin entender por que. Lo
    // mismo al pasar al anio en curso, donde la oferta se corta en hoy.
    const diasValidos = selectableDays(birth.year, birth.month);
    if (birth.day && !diasValidos.includes(Number(birth.day))) birth.day = '';
    const mesesValidos = selectableMonths(birth.year);
    if (birth.month && !mesesValidos.includes(Number(birth.month))) {
      birth.month = '';
      birth.day = '';
    }
    onChange({ ...value, birth });
  };

  return (
    <>
      <div>
        <label htmlFor="gender" className={labelClass}>
          {t('pets:create.gender')}
        </label>
        <select
          id="gender"
          name="gender"
          value={value.gender}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, gender: e.target.value as PetGender | '' })}
          className={controlClass}
        >
          <option value="">—</option>
          <option value="male">{t('pets:genders.male')}</option>
          <option value="female">{t('pets:genders.female')}</option>
          <option value="unknown">{t('pets:genders.unknown')}</option>
        </select>
      </div>

      {!hideBirthDate && (
      <>
      {/* Sin `m-0`: esa clase pisaba el margen que `space-y-5` del formulario
          le pone al campo SIGUIENTE, y "Raza" quedaba pegado a 0px mientras el
          resto respiraba 20. Medido con getBoundingClientRect, no a ojo. */}
      <fieldset className="border-0 p-0">
        <legend className={labelClass}>{t('pets:create.birthDate')}</legend>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label htmlFor="birthYear" className="sr-only">
              {t('pets:create.birthYear')}
            </label>
            <select
              id="birthYear"
              name="birthYear"
              value={value.birth.year}
              disabled={disabled}
              onChange={(e) => setBirth({ year: e.target.value })}
              className={controlClass}
              aria-label={t('pets:create.birthYear')}
            >
              <option value="">{t('pets:create.birthYear')}</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Mes y dia se deshabilitan hasta que haya anio: sin el no se puede
              mandar nada, y ofrecerlos invita a llenar algo que se descarta. */}
          <div>
            <label htmlFor="birthMonth" className="sr-only">
              {t('pets:create.birthMonth')}
            </label>
            <select
              id="birthMonth"
              name="birthMonth"
              value={value.birth.month}
              disabled={disabled || !value.birth.year}
              onChange={(e) => setBirth({ month: e.target.value })}
              className={controlClass}
              aria-label={t('pets:create.birthMonth')}
            >
              <option value="">{t('pets:create.birthMonth')}</option>
              {months.map((m) => (
                <option key={m} value={String(m)}>
                  {monthNames[m - 1]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="birthDay" className="sr-only">
              {t('pets:create.birthDay')}
            </label>
            <select
              id="birthDay"
              name="birthDay"
              value={value.birth.day}
              disabled={disabled || !value.birth.month}
              onChange={(e) => setBirth({ day: e.target.value })}
              className={controlClass}
              aria-label={t('pets:create.birthDay')}
            >
              <option value="">{t('pets:create.birthDay')}</option>
              {days.map((d) => (
                <option key={d} value={String(d)}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        {birthDateError ? (
          <p className="text-red-500 dark:text-red-400 text-sm mt-1">{birthDateError}</p>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('pets:create.birthDateHint')}
          </p>
        )}
      </fieldset>
      </>
      )}
    </>
  );
}
