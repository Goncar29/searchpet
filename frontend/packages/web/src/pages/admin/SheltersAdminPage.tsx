import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@shared/api/client';
import type { AdminShelter } from '@shared/types';

export function SheltersAdminPage() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();

  const { data: shelters, isLoading, isError, refetch } = useQuery({
    queryKey: ['adminShelters', 'pending'],
    queryFn: () => apiClient.getPendingShelters(),
  });

  const [rejecting, setRejecting] = useState<AdminShelter | null>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const invalidate = () => {
    setActionError(null);
    queryClient.invalidateQueries({ queryKey: ['adminShelters'] });
    queryClient.invalidateQueries({ queryKey: ['shelters'] });
  };
  const onError = () => setActionError(t('admin:sheltersQueue.actionError'));

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiClient.approveShelter(id),
    onSuccess: invalidate,
    onError,
  });
  const rejectMutation = useMutation({
    mutationFn: (vars: { id: string; reason: string }) => apiClient.rejectShelter(vars.id, vars.reason),
    onSuccess: () => {
      setRejecting(null);
      setReason('');
      invalidate();
    },
    onError,
  });
  const approveLinksMutation = useMutation({
    mutationFn: (id: string) => apiClient.approveShelterLinks(id),
    onSuccess: invalidate,
    onError,
  });
  const rejectLinksMutation = useMutation({
    mutationFn: (id: string) => apiClient.rejectShelterLinks(id),
    onSuccess: invalidate,
    onError,
  });

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-500 dark:text-gray-400">{t('admin:sheltersQueue.loading')}</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 dark:text-red-400 mb-4">{t('admin:sheltersQueue.error')}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-sm font-semibold text-primary border border-primary px-4 py-2 rounded-lg hover:bg-primary/5"
        >
          {t('admin:sheltersQueue.retry')}
        </button>
      </div>
    );
  }

  const queue = shelters ?? [];

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">{t('admin:sheltersQueue.title')}</h2>

      {actionError && <p className="text-sm text-red-600 mb-4">{actionError}</p>}

      {queue.length === 0 ? (
        <p className="text-gray-400 dark:text-gray-500 py-8 text-center">{t('admin:sheltersQueue.empty')}</p>
      ) : (
        <ul className="space-y-4">
          {queue.map((shelter) => {
            const isLinkChange = shelter.status === 'approved';
            return (
              <li
                key={shelter.id}
                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-gray-100">{shelter.name}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">📍 {shelter.city}</p>
                  </div>
                  <span
                    className={`text-xs font-semibold rounded-full px-3 py-1 ${
                      isLinkChange
                        ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                        : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                    }`}
                  >
                    {isLinkChange ? t('admin:sheltersQueue.linkChange') : t('admin:sheltersQueue.newRegistration')}
                  </span>
                </div>

                {shelter.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{shelter.description}</p>
                )}
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-2 space-y-1">
                  {shelter.phone && <p>📱 {shelter.phone}</p>}
                  {shelter.email && <p>✉️ {shelter.email}</p>}
                </div>

                {isLinkChange ? (
                  <div className="mt-3 space-y-2">
                    {shelter.pending_website_url !== undefined && (
                      <LinkDiff
                        label={t('admin:sheltersQueue.website')}
                        current={shelter.website_url}
                        proposed={shelter.pending_website_url}
                        currentLabel={t('admin:sheltersQueue.current')}
                        proposedLabel={t('admin:sheltersQueue.proposed')}
                        removedLabel={t('admin:sheltersQueue.removed')}
                      />
                    )}
                    {shelter.pending_donation_url !== undefined && (
                      <LinkDiff
                        label={t('admin:sheltersQueue.donation')}
                        current={shelter.donation_url}
                        proposed={shelter.pending_donation_url}
                        currentLabel={t('admin:sheltersQueue.current')}
                        proposedLabel={t('admin:sheltersQueue.proposed')}
                        removedLabel={t('admin:sheltersQueue.removed')}
                      />
                    )}
                  </div>
                ) : (
                  <div className="mt-3 space-y-1 text-sm">
                    {shelter.website_url && (
                      <p>
                        {t('admin:sheltersQueue.website')}:{' '}
                        <a href={shelter.website_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
                          {shelter.website_url}
                        </a>
                      </p>
                    )}
                    {shelter.donation_url && (
                      <p>
                        {t('admin:sheltersQueue.donation')}:{' '}
                        <a href={shelter.donation_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
                          {shelter.donation_url}
                        </a>
                      </p>
                    )}
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  {isLinkChange ? (
                    <>
                      <button
                        type="button"
                        onClick={() => approveLinksMutation.mutate(shelter.id)}
                        className="text-sm font-semibold text-white bg-green-600 px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                      >
                        {t('admin:sheltersQueue.approveLinks')}
                      </button>
                      <button
                        type="button"
                        onClick={() => rejectLinksMutation.mutate(shelter.id)}
                        className="text-sm font-semibold text-red-600 border border-red-600 px-4 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                      >
                        {t('admin:sheltersQueue.rejectLinks')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => approveMutation.mutate(shelter.id)}
                        className="text-sm font-semibold text-white bg-green-600 px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                      >
                        {t('admin:sheltersQueue.approve')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejecting(shelter)}
                        className="text-sm font-semibold text-red-600 border border-red-600 px-4 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                      >
                        {t('admin:sheltersQueue.reject')}
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {rejecting && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-5">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
              {t('admin:sheltersQueue.reject')} — {rejecting.name}
            </h3>
            <label htmlFor="reject-reason" className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
              {t('admin:sheltersQueue.reasonLabel')}
            </label>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('admin:sheltersQueue.reasonPlaceholder')}
              rows={4}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={() => {
                  setRejecting(null);
                  setReason('');
                }}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300"
              >
                {t('admin:sheltersQueue.cancel')}
              </button>
              <button
                type="button"
                disabled={!reason.trim() || rejectMutation.isPending}
                onClick={() => rejectMutation.mutate({ id: rejecting.id, reason: reason.trim() })}
                className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {t('admin:sheltersQueue.confirmReject')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// LinkDiff shows current → proposed for one staged link. proposed === ''
// means a staged CLEAR (the *string omitempty gotcha — '' is present, undefined is absent).
function LinkDiff({
  label,
  current,
  proposed,
  currentLabel,
  proposedLabel,
  removedLabel,
}: {
  label: string;
  current?: string;
  proposed: string;
  currentLabel: string;
  proposedLabel: string;
  removedLabel: string;
}) {
  return (
    <div className="text-sm rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
      <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">{label}</p>
      <p className="text-gray-500 dark:text-gray-400">
        {currentLabel}:{' '}
        {current ? (
          <a href={current} target="_blank" rel="noopener noreferrer" className="line-through break-all hover:underline">
            {current}
          </a>
        ) : (
          '—'
        )}
      </p>
      <p className="text-gray-900 dark:text-gray-100">
        {proposedLabel}:{' '}
        {proposed ? (
          <a href={proposed} target="_blank" rel="noopener noreferrer" className="text-primary break-all hover:underline">
            {proposed}
          </a>
        ) : (
          removedLabel
        )}
      </p>
    </div>
  );
}
