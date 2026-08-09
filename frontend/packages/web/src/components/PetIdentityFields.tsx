import { useTranslation } from 'react-i18next';
import type { PetGender } from '@shared/types';
import { birthDateYears, daysInMonth, type BirthDateParts } from '@shared/utils/petBirthDate';

// Sexo y fecha de nacimiento, juntos porque siempre se piden juntos y porque
// asi los cuatro formularios de alta/edicion comparten UNA definicion. Las
// columnas existian en la base desde el principio y ningun formulario las
// pedia; duplicar el markup en cada pantalla era la forma segura de que
// volvieran a divergir.
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
}

const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';
const controlClass =
  'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed';

export function PetIdentityFields({ value, onChange, disabled }: Props) {
  const { t, i18n } = useTranslation(['pets', 'common']);

  // Los nombres de mes salen de Intl con el idioma activo, no de 36 claves de
  // traduccion. Menos que mantener, y siempre correcto: si maniana entra otro
  // idioma, los meses ya estan.
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(i18n.language, { month: 'long' }).format(new Date(2000, i, 1))
  );

  const years = birthDateYears();
  const maxDay = daysInMonth(value.birth.year, value.birth.month);

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
    // silencio: el usuario perderia la fecha entera sin entender por que.
    if (birth.day && Number(birth.day) > daysInMonth(birth.year, birth.month)) {
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

      <fieldset className="border-0 p-0 m-0">
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
              {monthNames.map((nombre, i) => (
                <option key={nombre} value={String(i + 1)}>
                  {nombre}
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
              {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                <option key={d} value={String(d)}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t('pets:create.birthDateHint')}
        </p>
      </fieldset>
    </>
  );
}
