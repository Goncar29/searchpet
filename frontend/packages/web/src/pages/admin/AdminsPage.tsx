import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@shared/api/client';
import { getErrorMessage } from '@shared/utils/apiErrors';
import type { AdminAuditEntry, AdminRoleResult } from '@shared/types';

const PAGE_SIZE = 10;

export function AdminsPage() {
  const { t, i18n } = useTranslation('admin');
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const { data: changes, isLoading, isError } = useQuery({
    queryKey: ['admin-role-changes', page],
    queryFn: () => apiClient.getRoleChanges(page, PAGE_SIZE),
    placeholderData: keepPreviousData,
  });

  const entries: AdminAuditEntry[] = changes?.data ?? [];
  const total = changes?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const mutation = useMutation({
    mutationFn: ({ targetEmail, grant }: { targetEmail: string; grant: boolean }) =>
      apiClient.setUserAdmin(targetEmail, grant),
    onSuccess: (res: AdminRoleResult, vars) => {
      setError(null);
      if (res.no_change) {
        setNotice(t('admins.noChange', { email: res.email }));
      } else {
        setNotice(t(vars.grant ? 'admins.granted' : 'admins.revoked', { email: res.email }));
      }
      setEmail('');
      // A new audit row lands on page 1 (newest first), so jump there and refetch.
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ['admin-role-changes'] });
    },
    onError: (err: unknown) => {
      setNotice(null);
      setError(getErrorMessage(err, t));
    },
  });

  const submit = (grant: boolean) => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setNotice(null);
    setError(null);
    mutation.mutate({ targetEmail: trimmed, grant });
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">{t('admins.title')}</h2>

      <div className="max-w-md space-y-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('admins.emailLabel')}
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('admins.emailPlaceholder')}
          className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        />
        <div className="flex gap-2">
          <button
            onClick={() => submit(true)}
            disabled={mutation.isPending || !email.trim()}
            className="text-sm font-medium px-3 py-2 rounded bg-primary text-white hover:opacity-90 transition disabled:opacity-50"
          >
            {t('admins.grant')}
          </button>
          <button
            onClick={() => submit(false)}
            disabled={mutation.isPending || !email.trim()}
            className="text-sm font-medium px-3 py-2 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 transition disabled:opacity-50"
          >
            {t('admins.revoke')}
          </button>
        </div>
        {notice && <p className="text-sm text-green-600 dark:text-green-400">{notice}</p>}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-10 mb-4">
        {t('admins.recentTitle')}
      </h3>
      {isLoading ? (
        <p className="text-gray-500 dark:text-gray-400">{t('admins.recentLoading')}</p>
      ) : isError ? (
        <p className="text-red-600 dark:text-red-400">{t('admins.recentError')}</p>
      ) : entries.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                  <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">{t('admins.colDate')}</th>
                  <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">{t('admins.colActor')}</th>
                  <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">{t('admins.colAction')}</th>
                  <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">{t('admins.colTarget')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((c: AdminAuditEntry) => (
                  <tr key={c.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 px-3 text-gray-500 dark:text-gray-400">
                      {new Date(c.created_at).toLocaleString(i18n.language)}
                    </td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-400">{c.actor_email}</td>
                    <td className="py-2 px-3 text-gray-900 dark:text-gray-100">
                      {t(c.action === 'grant' ? 'admins.actionGrant' : 'admins.actionRevoke')}
                    </td>
                    <td className="py-2 px-3 text-gray-900 dark:text-gray-100">{c.target_email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="text-sm font-medium px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('admins.prevPage')}
              </button>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {t('admins.pageOf', { page, pages: totalPages })}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="text-sm font-medium px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('admins.nextPage')}
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="text-gray-400 dark:text-gray-500">{t('admins.recentEmpty')}</p>
      )}
    </div>
  );
}
