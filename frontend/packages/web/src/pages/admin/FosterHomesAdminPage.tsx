import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  usePendingFosterHomes,
  useApproveFosterHome,
  useRejectFosterHome,
  useSuspendFosterHome,
  useReinstateFosterHome,
  useFosterHomeLogs,
  useFosterHomeHistory,
} from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { cloudinaryThumb } from '@shared/utils/cloudinaryThumb';
import { Icon } from '../../components/Icon';
import { ListState } from '../../components/list/ListState';
import type {
  AnimalKind,
  FosterHomeChangeLog,
  FosterHomeModerationLog,
  MyFosterHome,
} from '@shared/types';

// action → label key. Kept separate from fosterHomes:status.* (different
// domain: a moderation event vs. the home's current state).
const ACTION_LABEL_KEY: Record<FosterHomeModerationLog['action'], string> = {
  approve: 'fosterHomes:admin.action.approve',
  reject: 'fosterHomes:admin.action.reject',
  suspend: 'fosterHomes:admin.action.suspend',
  reinstate: 'fosterHomes:admin.action.reinstate',
};

// Espeja `foster_homes.rejection_reason` (varchar 500) y el `max=500` del DTO.
// El backend igual devuelve 400 si esto se saltea; acá evitamos que el
// moderador escriba 600 caracteres para enterarse recién al confirmar.
const REASON_MAX_LEN = 500;

type ReasonTarget = { type: 'reject' | 'suspend'; item: MyFosterHome };

export function FosterHomesAdminPage() {
  const { t } = useTranslation(['fosterHomes', 'errors', 'common']);

  const queueQuery = usePendingFosterHomes();
  const queue = queueQuery.data;

  const approveMutation = useApproveFosterHome();
  const rejectMutation = useRejectFosterHome();
  const suspendMutation = useSuspendFosterHome();
  const reinstateMutation = useReinstateFosterHome();

  const [reasonTarget, setReasonTarget] = useState<ReasonTarget | null>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const closeReasonModal = () => {
    setReasonTarget(null);
    setReason('');
  };

  const handleApprove = (id: string) => {
    setActionError(null);
    approveMutation.mutate(id, { onError: (err) => setActionError(getErrorMessage(err, t)) });
  };

  const handleReinstate = (id: string) => {
    setActionError(null);
    reinstateMutation.mutate(id, { onError: (err) => setActionError(getErrorMessage(err, t)) });
  };

  const handleConfirmReason = () => {
    if (!reasonTarget) return;
    const trimmed = reason.trim();
    if (!trimmed) return;
    setActionError(null);
    const vars = { id: reasonTarget.item.id, reason: trimmed };
    const mutation = reasonTarget.type === 'reject' ? rejectMutation : suspendMutation;
    mutation.mutate(vars, {
      onSuccess: () => closeReasonModal(),
      onError: (err) => setActionError(getErrorMessage(err, t)),
    });
  };

  const reasonMutation = reasonTarget?.type === 'reject' ? rejectMutation : suspendMutation;

  // Métricas por estado, contadas sobre la cola que ya está en memoria. Las
  // etiquetas son las de `fosterHomes:status.*`, que ya existen traducidas: el
  // encabezado no inventa vocabulario nuevo para nombrar lo mismo que dice el
  // badge de cada tarjeta.
  const cola = queue ?? [];
  const porEstado = (estado: string) => cola.filter((i) => i.status === estado).length;
  const stats = [
    { estado: 'pending', icono: 'hourglass' as const },
    { estado: 'approved', icono: 'check-circle' as const },
    { estado: 'suspended', icono: 'warning' as const },
  ];

  return (
    <div>
      <div className="mb-6">
        {/* `font-semibold` explícito: `font-display` fija la familia y el
            preflight de Tailwind v4 deja los h1-h6 en `font-weight: inherit`. */}
        <h2 className="font-display font-semibold text-xl text-gray-900 dark:text-gray-100">
          {t('fosterHomes:admin.title')}
        </h2>
        {/* Era un `<h3>` usado como subtítulo: un encabezado que no encabeza
            nada le mete un nivel falso al árbol que lee un lector de pantalla. */}
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t('fosterHomes:admin.pendingQueue')}
        </p>
      </div>

      {/* Sólo con datos: un "0 en revisión" al lado del cartel de error afirma
          que no hay nada que moderar, que es justo lo que no sabemos. */}
      {queue && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {stats.map((s) => (
            <div
              key={s.estado}
              className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4"
            >
              <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <Icon name={s.icono} className="h-4 w-4 flex-shrink-0" />
                <span className="text-xs font-medium">{t(`fosterHomes:status.${s.estado}`)}</span>
              </div>
              <p className="font-display font-semibold text-2xl text-gray-900 dark:text-gray-100 mt-1">
                {porEstado(s.estado)}
              </p>
            </div>
          ))}
        </div>
      )}

      {actionError && (
        <p role="alert" className="text-sm text-red-600 mb-4">
          {actionError}
        </p>
      )}

      <ListState
        query={queueQuery}
        loading={
          <div className="text-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">{t('common:loading')}</p>
          </div>
        }
        empty={
          <p className="text-gray-400 dark:text-gray-500 py-8 text-center">
            {t('fosterHomes:directory.empty')}
          </p>
        }
        errorTitle={t('fosterHomes:admin.title')}
        errorBody={t('fosterHomes:mine.loadError')}
      >
        {(items) => (
        <ul className="space-y-4">
          {items.map((item) => (
            <FosterHomeAdminItem
              key={item.id}
              item={item}
              onApprove={() => handleApprove(item.id)}
              onReject={() => {
                setActionError(null);
                setReason('');
                setReasonTarget({ type: 'reject', item });
              }}
              onSuspend={() => {
                setActionError(null);
                setReason('');
                setReasonTarget({ type: 'suspend', item });
              }}
              onReinstate={() => handleReinstate(item.id)}
              approvePending={approveMutation.isPending}
              reinstatePending={reinstateMutation.isPending}
            />
          ))}
        </ul>
        )}
      </ListState>

      {reasonTarget && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-5">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
              {t(reasonTarget.type === 'reject' ? 'fosterHomes:admin.reject' : 'fosterHomes:admin.suspend')} —{' '}
              {reasonTarget.item.city}
            </h3>
            <label htmlFor="foster-home-reason" className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
              {t('fosterHomes:admin.reasonLabel')}
            </label>
            {/* El moderador tiene que saber que esto NO es una nota interna. El
                motivo se guarda en `rejection_reason` y se le muestra al dueño
                palabra por palabra — si acá dice "Motivo de la denuncia", que es
                lo que decía antes, alguien va a escribir quién denunció. */}
            <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">
              {t('fosterHomes:admin.reasonOwnerNotice')}
            </p>
            <textarea
              id="foster-home-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('fosterHomes:admin.reasonPlaceholder')}
              maxLength={REASON_MAX_LEN}
              rows={4}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {!reason.trim() && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('fosterHomes:admin.reasonRequired')}</p>
            )}
            <div className="flex justify-end gap-3 mt-4">
              <button type="button" onClick={closeReasonModal} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
                {t('common:cancel')}
              </button>
              <button
                type="button"
                disabled={!reason.trim() || reasonMutation.isPending}
                onClick={handleConfirmReason}
                className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {t(reasonTarget.type === 'reject' ? 'fosterHomes:admin.reject' : 'fosterHomes:admin.suspend')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FosterHomeAdminItem({
  item,
  onApprove,
  onReject,
  onSuspend,
  onReinstate,
  approvePending,
  reinstatePending,
}: {
  item: MyFosterHome;
  onApprove: () => void;
  onReject: () => void;
  onSuspend: () => void;
  onReinstate: () => void;
  approvePending: boolean;
  reinstatePending: boolean;
}) {
  const { t } = useTranslation(['fosterHomes', 'errors', 'common']);
  const [panel, setPanel] = useState<'logs' | 'history' | null>(null);

  const logsQuery = useFosterHomeLogs(item.id, panel === 'logs');
  const historyQuery = useFosterHomeHistory(item.id, panel === 'history');

  const togglePanel = (target: 'logs' | 'history') => {
    setPanel((current) => (current === target ? null : target));
  };

  return (
    <li className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {/* El 📍 pasa a ícono. Es page-local, así que no arrastra a nadie
              — los de `BADGE_META` viven en shared y los dibujan ocho archivos
              entre web y mobile (#164). Va decorativo: la ciudad de al lado ya
              dice qué es, y un lector no tiene por qué oír "pin". */}
          <h3 className="flex items-center gap-1.5 font-display font-semibold text-gray-900 dark:text-gray-100">
            <Icon name="location-on" className="h-4 w-4 flex-shrink-0" />
            {item.city}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t(`fosterHomes:housingType.${item.housing_type}`)} · {t('fosterHomes:directory.capacity')}:{' '}
            {item.capacity}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {item.owner_name && <span className="font-medium">{item.owner_name} · </span>}
            {item.owner_email || item.owner_user_id}
          </p>
        </div>
        <span
          className={`text-xs font-semibold rounded-full px-3 py-1 ${
            item.status === 'approved'
              ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
              : item.status === 'suspended'
                ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                : item.status === 'rejected'
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                  : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
          }`}
        >
          {t(`fosterHomes:status.${item.status}`)}
        </span>
      </div>

      <div className="flex flex-wrap gap-1 mt-2">
        {item.animal_types.map((kind: AnimalKind) => (
          <span
            key={kind}
            className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full"
          >
            {t(`fosterHomes:animalType.${kind}`)}
          </span>
        ))}
      </div>

      {item.description && <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{item.description}</p>}

      {item.photos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 mt-3">
          {item.photos.map((photo) => (
            <a
              key={photo.id}
              href={photo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block aspect-square overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 hover:opacity-90 transition-opacity"
            >
              <img src={cloudinaryThumb(photo.url, 224)} alt={item.city} loading="lazy" className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        {item.status === 'pending' && (
          <>
            <button
              type="button"
              onClick={onApprove}
              disabled={approvePending}
              className="text-sm font-semibold text-white bg-green-600 px-4 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {t('fosterHomes:admin.approve')}
            </button>
            <button
              type="button"
              onClick={onReject}
              className="text-sm font-semibold text-red-600 border border-red-600 px-4 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              {t('fosterHomes:admin.reject')}
            </button>
          </>
        )}
        {item.status === 'approved' && (
          <button
            type="button"
            onClick={onSuspend}
            className="text-sm font-semibold text-red-600 border border-red-600 px-4 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
          >
            {t('fosterHomes:admin.suspend')}
          </button>
        )}
        {item.status === 'suspended' && (
          <button
            type="button"
            onClick={onReinstate}
            disabled={reinstatePending}
            className="text-sm font-semibold text-white bg-green-600 px-4 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {t('fosterHomes:admin.reinstate')}
          </button>
        )}

        <button
          type="button"
          onClick={() => togglePanel('logs')}
          className="text-sm font-semibold text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          {t('fosterHomes:admin.viewLogs')}
        </button>
        <button
          type="button"
          onClick={() => togglePanel('history')}
          className="text-sm font-semibold text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          {t('fosterHomes:admin.viewHistory')}
        </button>
      </div>

      {panel === 'logs' && (
        <div className="mt-4 rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
            {t('fosterHomes:admin.logsTitle')}
          </h4>
          {logsQuery.isLoading ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('common:loading')}</p>
          ) : !logsQuery.data || logsQuery.data.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('fosterHomes:admin.noLogs')}</p>
          ) : (
            <ul className="space-y-3">
              {logsQuery.data.map((log) => (
                <ModerationLogEntry key={log.id} log={log} />
              ))}
            </ul>
          )}
        </div>
      )}

      {panel === 'history' && (
        <div className="mt-4 rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
            {t('fosterHomes:admin.historyTitle')}
          </h4>
          {historyQuery.isLoading ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('common:loading')}</p>
          ) : !historyQuery.data || historyQuery.data.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('fosterHomes:admin.noLogs')}</p>
          ) : (
            <ul className="space-y-3">
              {historyQuery.data.map((entry) => (
                <ChangeLogEntry key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function OwnerSnapshot({
  email,
  phone,
  whatsapp,
}: {
  email?: string;
  phone?: string;
  whatsapp?: string;
}) {
  const { t } = useTranslation(['fosterHomes']);
  if (!email && !phone && !whatsapp) return null;
  return (
    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
      <span className="font-semibold">{t('fosterHomes:admin.ownerSnapshot')}:</span>{' '}
      {[email, phone, whatsapp].filter(Boolean).join(' · ')}
    </p>
  );
}

function ModerationLogEntry({ log }: { log: FosterHomeModerationLog }) {
  const { t } = useTranslation(['fosterHomes']);
  return (
    <li className="text-xs border-b border-gray-200 dark:border-gray-700 pb-2 last:border-0 last:pb-0">
      <p className="font-semibold text-gray-800 dark:text-gray-100">{t(ACTION_LABEL_KEY[log.action])}</p>
      {log.reason && <p className="text-gray-600 dark:text-gray-300 mt-0.5">{log.reason}</p>}
      <OwnerSnapshot email={log.owner_email} phone={log.owner_phone} whatsapp={log.owner_whatsapp} />
      <p className="text-gray-400 dark:text-gray-500 mt-0.5">{new Date(log.created_at).toLocaleString()}</p>
    </li>
  );
}

function ChangeLogEntry({ entry }: { entry: FosterHomeChangeLog }) {
  const fields = entry.changed_fields ? Object.entries(entry.changed_fields) : [];
  return (
    <li className="text-xs border-b border-gray-200 dark:border-gray-700 pb-2 last:border-0 last:pb-0">
      <p className="font-semibold text-gray-800 dark:text-gray-100 capitalize">
        {entry.change_type.replace(/_/g, ' ')}
      </p>
      {fields.length > 0 && (
        <ul className="mt-0.5 space-y-0.5">
          {fields.map(([field, change]) => (
            <li key={field} className="text-gray-600 dark:text-gray-300">
              <span className="font-medium">{field}</span>: {change.old || '—'} → {change.new || '—'}
            </li>
          ))}
        </ul>
      )}
      <OwnerSnapshot email={entry.owner_email} phone={entry.owner_phone} whatsapp={entry.owner_whatsapp} />
      <p className="text-gray-400 dark:text-gray-500 mt-0.5">{new Date(entry.created_at).toLocaleString()}</p>
    </li>
  );
}
