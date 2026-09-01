import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@shared/api/client';
import { getErrorMessage } from '@shared/utils/apiErrors';
import type { AdminAuditEntry, AdminRoleResult } from '@shared/types';
import { FormSection } from '../../components/form/FormSection';
import { FormField } from '../../components/form/FormField';

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
      <div className="mb-6">
        {/* `font-semibold` explícito: `font-display` fija la familia y el
            preflight de Tailwind v4 deja los h1-h6 en `font-weight: inherit`. */}
        <h2 className="font-display font-semibold text-xl text-gray-900 dark:text-gray-100">
          {t('admins.title')}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('admins.subtitle')}</p>
      </div>

      {/* `max-w-2xl` y no `max-w-md`: con los 32px de padding de `FormSection`
          a cada lado, 448px dejaban el campo en ~384px (la medición del #201). */}
      <div className="max-w-2xl mb-10">
        <FormSection>
          {/* El `<label>` que había acá NO tenía `htmlFor` y el `<input>` no
              tenía `id`: el campo donde se escribe el email de alguien a quien
              se le va a dar o sacar admin NO TENÍA NOMBRE ACCESIBLE. Se veía
              perfecto y un lector anunciaba un cuadro de texto sin decir de
              qué. `FormField` lo cierra por construcción — su render prop hace
              imposible olvidarse el cableado. */}
          <FormField label={t('admins.emailLabel')} htmlFor="admin-email">
            {(control) => (
              // Sin `className` propio: el que trae `control` es el del sistema
              // de formularios. Escribir uno acá lo PISA —en JSX gana la prop
              // posterior al spread— y el campo se queda sin el `focus:ring`
              // del sistema, sin que nada falle: `id` y `htmlFor` no se pisan,
              // así que el nombre accesible sigue correcto. Lo cubre el guard
              // `el input adopta el estilado que le entrega FormField`.
              <input
                {...control}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('admins.emailPlaceholder')}
              />
            )}
          </FormField>

          <div className="flex gap-2 mt-4">
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
          {/* `role="status"` y `role="alert"`: el resultado de otorgar o revocar
              admin no puede quedar sólo en el color de un párrafo que aparece
              abajo — quien no ve la pantalla no se entera de si la acción
              ocurrió. El aviso de éxito no interrumpe; el error sí. */}
          {notice && (
            <p role="status" className="text-sm text-green-600 dark:text-green-400 mt-3">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400 mt-3">
              {error}
            </p>
          )}
        </FormSection>
      </div>

      <h3 className="font-display font-semibold text-lg text-gray-900 dark:text-gray-100 mb-4">
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
