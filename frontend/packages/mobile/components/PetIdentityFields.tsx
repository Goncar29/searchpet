import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PetGender } from '@shared/types';
import type { BirthDateParts } from '@shared/utils/petBirthDate';
import { COLORS, SPACING, FONTS, RADIUS } from '../constants';

// El equivalente NATIVO de web/src/components/PetIdentityFields.tsx. No se puede
// compartir el de web: usa <select>, <fieldset> y clases de Tailwind, nada de lo
// cual existe en React Native. Lo que SÍ se comparte es toda la lógica —
// composeBirthDate, decomposeBirthDate y los tipos viven en `shared/` y las dos
// plataformas los importan.
//
// DOS CONTROLES DISTINTOS, Y LOS DOS SALEN DE PRECEDENTES DEL REPO:
//
//  - El SEXO va como fila de opciones tocables, igual que el selector de tipo de
//    mascota (PET_TYPES en StrayFormStep). Son tres opciones: entran en una fila
//    y se eligen de un toque, sin abrir nada.
//
//  - La FECHA va en tres campos numéricos y NO en un date picker nativo. Es la
//    misma decisión que tomó el #133 para `occurred_at`, con su motivo textual:
//    el picker es un módulo nativo y sumarlo obliga a rebuildear el APK
//    distribuido y el dev client (reglas #31 y #33). Hoy el único picker
//    instalado es expo-image-picker.
//
//    Tres campos y no uno: el modelo admite fechas PARCIALES, así que "2022"
//    solo tiene que ser válido. En un único campo YYYY-MM-DD no lo sería.
//
// LA PRECISIÓN SE DERIVA de cuánto llenó el usuario, igual que en web: no hay
// ningún control que la pida. Eso hace imposible construir el par incoherente
// que el backend rechaza con 400.

export interface PetIdentityValue {
  gender: PetGender | '';
  birth: BirthDateParts;
}

interface Props {
  value: PetIdentityValue;
  onChange: (next: PetIdentityValue) => void;
  disabled?: boolean;
  birthDateError?: string;
  /**
   * Oculta la fecha y deja sólo el sexo. Lo usa el alta de CALLEJERA: quien la
   * reporta la encontró en la calle, así que el sexo lo puede VER pero la fecha
   * de nacimiento no la puede saber. Pedirla invita a inventar, y la precisión
   * existe para que nadie tenga que fabricar certeza.
   */
  hideBirthDate?: boolean;
}

const GENDERS: PetGender[] = ['male', 'female', 'unknown'];

export function PetIdentityFields({
  value,
  onChange,
  disabled,
  birthDateError,
  hideBirthDate,
}: Props) {
  const { t } = useTranslation(['pets']);

  // Sólo dígitos: el teclado numérico de Android igual deja pegar texto, y una
  // letra acá haría que composeBirthDate descarte la fecha entera en silencio.
  const soloDigitos = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

  const setBirth = (patch: Partial<BirthDateParts>) => {
    const birth = { ...value.birth, ...patch };
    // Vaciar el año vacía todo, y vaciar el mes vacía el día: sin año no hay
    // fecha, y "el 9 de algún mes" no existe en el modelo. Igual que en web.
    if (!birth.year) {
      birth.month = '';
      birth.day = '';
    }
    if (!birth.month) birth.day = '';
    onChange({ ...value, birth });
  };

  return (
    <>
      <View style={styles.section}>
        <Text style={styles.label}>{t('pets:create.gender')}</Text>
        <View style={styles.row}>
          {GENDERS.map((g) => {
            const active = value.gender === g;
            return (
              <TouchableOpacity
                key={g}
                style={[styles.option, active && styles.optionActive]}
                disabled={disabled}
                // Se puede DESELECCIONAR volviendo a tocar la opción activa. Sin
                // esto, elegir sin querer "Macho" no tiene vuelta atrás: no hay
                // una opción "vacía" como el "—" del <select> de web.
                onPress={() => onChange({ ...value, gender: active ? '' : g })}
                accessibilityRole="radio"
                accessibilityState={{ selected: active, disabled: !!disabled }}
                accessibilityLabel={t(`pets:genders.${g}`)}
              >
                <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
                  {t(`pets:genders.${g}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {!hideBirthDate && (
        <View style={styles.section}>
          <Text style={styles.label}>{t('pets:create.birthDate')}</Text>
          <View style={styles.row}>
            <TextInput
              testID="birth-year-input"
              style={[styles.input, styles.year]}
              value={value.birth.year}
              editable={!disabled}
              onChangeText={(v) => setBirth({ year: soloDigitos(v, 4) })}
              placeholder={t('pets:create.birthYear')}
              placeholderTextColor={COLORS.placeholder}
              keyboardType="number-pad"
              maxLength={4}
              accessibilityLabel={t('pets:create.birthYear')}
            />
            {/* Mes y día quedan inertes hasta que haya año: sin él no se manda
                nada, y ofrecerlos invita a llenar algo que se descarta. */}
            <TextInput
              testID="birth-month-input"
              style={[styles.input, styles.short, !value.birth.year && styles.inputDisabled]}
              value={value.birth.month}
              editable={!disabled && !!value.birth.year}
              onChangeText={(v) => setBirth({ month: soloDigitos(v, 2) })}
              placeholder={t('pets:create.birthMonth')}
              placeholderTextColor={COLORS.placeholder}
              keyboardType="number-pad"
              maxLength={2}
              accessibilityLabel={t('pets:create.birthMonth')}
            />
            <TextInput
              testID="birth-day-input"
              style={[styles.input, styles.short, !value.birth.month && styles.inputDisabled]}
              value={value.birth.day}
              editable={!disabled && !!value.birth.month}
              onChangeText={(v) => setBirth({ day: soloDigitos(v, 2) })}
              placeholder={t('pets:create.birthDay')}
              placeholderTextColor={COLORS.placeholder}
              keyboardType="number-pad"
              maxLength={2}
              accessibilityLabel={t('pets:create.birthDay')}
            />
          </View>
          {birthDateError ? (
            <Text style={styles.error}>{birthDateError}</Text>
          ) : (
            <Text style={styles.help}>{t('pets:create.birthDateHint')}</Text>
          )}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: SPACING.md },
  label: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  option: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
  },
  optionActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight + '22' },
  optionLabel: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  optionLabelActive: { color: COLORS.primary, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
  },
  inputDisabled: { opacity: 0.5 },
  year: { flex: 1.2 },
  short: { flex: 1 },
  help: { fontSize: FONTS.sizes.xs, color: COLORS.textMuted, marginTop: SPACING.xs },
  error: { fontSize: FONTS.sizes.xs, color: COLORS.danger, marginTop: SPACING.xs },
});
