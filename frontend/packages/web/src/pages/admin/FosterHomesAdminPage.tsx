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

type ReasonTarget = { type: 'reject' | 'suspend'; item: MyFosterHome };

export function FosterHomesAdminPage() {
  const { t } = useTranslation(['fosterHomes', 'errors', 'common']);

  const { data: queue, isLoading, isError, refetch } = usePendingFosterHomes();

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

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-500 dark:text-gray-400">{t('common:loading')}</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 dark:text-red-400 mb-4">{t('fosterHomes:mine.loadError')}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-sm font-semibold text-primary border border-primary px-4 py-2 rounded-lg hover:bg-primary/5"
        >
          {t('fosterHomes:mine.retry')}
        </button>
      </div>
    );
  }

  const items = queue ?? [];
  const reasonMutation = reasonTarget?.type === 'reject' ? rejectMutation : suspendMutation;

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">{t('fosterHomes:admin.title')}</h2>
      <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4">
        {t('fosterHomes:admin.pendingQueue')}
      </h3>

      {actionError && <p className="text-sm text-red-600 mb-4">{actionError}</p>}

      {items.length === 0 ? (
        <p className="text-gray-400 dark:text-gray-500 py-8 text-center">{t('fosterHomes:directory.empty')}</p>
      ) : (
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

      {reasonTarget && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-5">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
              {t(reasonTarget.type === 'reject' ? 'fosterHomes:admin.reject' : 'fosterHomes:admin.suspend')} —{' '}
              {reasonTarget.item.city}
            </h3>
            <label htmlFor="foster-home-reason" className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
              {t('fosterHomes:report.reasonLabel')}
            </label>
            <textarea
              id="foster-home-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('fosterHomes:report.reasonPlaceholder')}
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
          <h3 className="font-bold text-gray-900 dark:text-gray-100">📍 {item.city}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t(`fosterHomes:housingType.${item.housing_type}`)} · {t('fosterHomes:directory.capacity')}:{' '}
            {item.capacity}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">owner: {item.owner_user_id}</p>
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
