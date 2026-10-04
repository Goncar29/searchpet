import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHelperCandidates } from '@shared/hooks';
import { ConfirmModal } from './ConfirmModal';
import { ListState } from './list/ListState';
import { UserAvatar } from './UserAvatar';

interface HelperPickerModalProps {
  petId: string;
  petName: string;
  /** Se pasa `loading` mientras corre la mutación que marca la mascota como encontrada. */
  loading?: boolean;
  /** Error de la mutación ya traducido (`getErrorMessage`); se dibuja dentro del modal. */
  error?: string | null;
  /**
   * `undefined` = no había candidatos, así que NO se manda `helper_ids` (el
   * backend lo acepta). `[]` = el dueño contestó "nadie me ayudó". Son dos
   * respuestas distintas y el backend las trata distinto.
   */
  onConfirm: (helperIds: string[] | undefined) => void;
  onCancel: () => void;
}

/**
 * Pregunta quién ayudó a encontrar la mascota, ANTES de marcarla encontrada.
 *
 * Contestar es obligatorio cuando hay candidatos (lo exige el backend con 400
 * `helper_ids_required`; acá se refleja deshabilitando Confirmar hasta que el
 * dueño elija a alguien o diga explícitamente "Nadie me ayudó"). No hay
 * selección por defecto: una respuesta preseleccionada no es una respuesta.
 *
 * Montar sólo mientras la confirmación está pendiente (igual que ConfirmModal):
 * la consulta de candidatos nace al abrirse y se vuelve a leer cada vez.
 */
export function HelperPickerModal({
  petId,
  petName,
  loading = false,
  error = null,
  onConfirm,
  onCancel,
}: HelperPickerModalProps) {
  const { t } = useTranslation(['pets', 'common']);
  const query = useHelperCandidates(petId, true);
  const { refetch } = query;

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [nobody, setNobody] = useState(false);

  // Un 400 al confirmar puede significar que la lista cambió desde que se
  // abrió el modal (alguien reportó en el medio): releerla es lo que deja al
  // dueño ver a esa persona en vez de repetir el mismo rechazo.
  useEffect(() => {
    if (error) void refetch();
  }, [error, refetch]);

  // `data == null` y NO `items.length === 0` (regla #60): sin datos no sabemos
  // si hay candidatos, y confirmar a ciegas es justo lo que no puede pasar.
  const candidates = query.data ?? null;
  const hasCandidates = candidates != null && candidates.length > 0;
  const answered = nobody || selected.size > 0;
  const confirmDisabled = candidates == null || (hasCandidates && !answered);

  const toggleHelper = (id: string) => {
    setNobody(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleNobody = () => {
    setSelected(new Set());
    setNobody((prev) => !prev);
  };

  const handleConfirm = () => {
    if (confirmDisabled) return;
    if (!hasCandidates || candidates == null) {
      onConfirm(undefined);
      return;
    }
    // Se filtra contra la lista vigente: si una relectura quitó a alguien, su
    // id no viaja.
    onConfirm(nobody ? [] : candidates.filter((c) => selected.has(c.id)).map((c) => c.id));
  };

  return (
    <ConfirmModal
      title={hasCandidates ? t('pets:helpers.title', { name: petName }) : t('pets:detail.markFound')}
      message={
        hasCandidates
          ? t('pets:helpers.message')
          : t('pets:detail.markFoundConfirm', { name: petName })
      }
      confirmLabel={t('common:confirm')}
      cancelLabel={t('common:cancel')}
      loading={loading}
      confirmDisabled={confirmDisabled}
      onConfirm={handleConfirm}
      onCancel={onCancel}
    >
      <div className="space-y-3">
        <ListState
          query={query}
          loading={
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('common:loading')}</p>
          }
          empty={<></>}
          errorTitle={t('pets:helpers.loadError')}
        >
          {(items) => (
            <fieldset className="space-y-2">
              <legend className="sr-only">{t('pets:helpers.selectLabel', { name: petName })}</legend>
              {items.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2 cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/30"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggleHelper(c.id)}
                    className="h-4 w-4 accent-primary"
                  />
                  <UserAvatar name={c.name} photoUrl={c.profile_photo_url} px={64} className="h-8 w-8 text-sm" />
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{c.name}</span>
                </label>
              ))}
              <label className="flex items-center gap-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 px-3 py-2 cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/30">
                <input
                  type="checkbox"
                  checked={nobody}
                  onChange={toggleNobody}
                  className="h-4 w-4 accent-primary"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('pets:helpers.nobody')}
                </span>
              </label>
            </fieldset>
          )}
        </ListState>

        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
      </div>
    </ConfirmModal>
  );
}
