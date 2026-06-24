import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@shared/api/client';
import type { AbuseReport } from '@shared/types';
import { ConfirmModal } from '../../components/ConfirmModal';

type FilterMode = 'all' | 'pending' | 'resolved';

// A moderation action awaiting confirmation in the modal.
type PendingAction =
  | { type: 'delete'; reportId: string; petName: string }
  | { type: 'ban'; userId: string; userName: string }
  | { type: 'unban'; userId: string; userName: string };

export function AbuseReportsPage() {
  const [filter, setFilter] = useState<FilterMode>('all');
  const queryClient = useQueryClient();

  const resolvedParam =
    filter === 'pending' ? false : filter === 'resolved' ? true : undefined;

  const { data: reports, isLoading } = useQuery({
    queryKey: ['abuseReports', filter],
    queryFn: () => apiClient.listAbuseReports({ resolved: resolvedParam, limit: 50 }),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'resolved' | 'dismissed' }) =>
      apiClient.resolveAbuseReport(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['abuseReports'] }),
  });

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');

  const closeModal = () => setPending(null);
  const afterAction = () => {
    queryClient.invalidateQueries({ queryKey: ['abuseReports'] });
    closeModal();
  };

  const deleteMutation = useMutation({
    mutationFn: (reportId: string) => apiClient.deleteReport(reportId),
    onSuccess: afterAction,
  });
  const banMutation = useMutation({
    mutationFn: (vars: { userId: string; reason: string }) =>
      apiClient.banUser(vars.userId, vars.reason),
    onSuccess: afterAction,
  });
  const unbanMutation = useMutation({
    mutationFn: (userId: string) => apiClient.unbanUser(userId),
    onSuccess: afterAction,
  });

  const filterTabs: { key: FilterMode; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'resolved', label: 'Resolved' },
  ];

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Abuse Reports</h2>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`text-sm font-medium py-1.5 px-4 rounded-lg transition-colors duration-150 ${
              filter === tab.key
                ? 'bg-primary text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-gray-400">Loading reports...</p>
        </div>
      ) : reports && reports.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">ID</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">Reporter</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">Reason</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">Status</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">Target</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">Created</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report: AbuseReport) => (
                <tr
                  key={report.id}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <td className="py-2 px-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {report.id.slice(0, 8)}
                  </td>
                  <td className="py-2 px-3">
                    {report.reporter ? (
                      <Link to={`/users/${report.reporter.id}`} className="text-primary hover:underline">
                        {report.reporter.name}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                        {report.reporter_id.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-gray-900 dark:text-gray-100 capitalize">
                    {report.reason}
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${
                        report.status === 'pending'
                          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
                          : report.status === 'resolved'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {report.status}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    {report.target_user ? (
                      <Link to={`/users/${report.target_user.id}`} className="text-primary hover:underline">
                        {report.target_user.name}
                      </Link>
                    ) : report.target_report ? (
                      <Link to={`/pets/${report.target_report.pet_id}`} className="text-primary hover:underline">
                        {report.target_report.pet_name}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                        {report.target_user_id
                          ? `user: ${report.target_user_id.slice(0, 8)}`
                          : report.target_report_id
                          ? `report: ${report.target_report_id.slice(0, 8)}`
                          : '—'}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-gray-500 dark:text-gray-400">
                    {new Date(report.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex flex-wrap gap-2">
                      {report.status === 'pending' && (
                        <>
                          <button
                            onClick={() =>
                              resolveMutation.mutate({
                                id: report.id,
                                status: 'resolved',
                              })
                            }
                            disabled={resolveMutation.isPending}
                            className="text-xs font-medium px-2 py-1 rounded bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300 dark:hover:bg-green-900/60 transition-colors disabled:opacity-50"
                          >
                            Resolve
                          </button>
                          <button
                            onClick={() =>
                              resolveMutation.mutate({
                                id: report.id,
                                status: 'dismissed',
                              })
                            }
                            disabled={resolveMutation.isPending}
                            className="text-xs font-medium px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
                          >
                            Dismiss
                          </button>
                        </>
                      )}

                      {report.target_report && (
                        <button
                          onClick={() =>
                            setPending({
                              type: 'delete',
                              reportId: report.target_report!.id,
                              petName: report.target_report!.pet_name,
                            })
                          }
                          className="text-xs font-medium px-2 py-1 rounded bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60 transition-colors"
                        >
                          Delete content
                        </button>
                      )}

                      {report.target_user &&
                        (report.target_user.is_banned ? (
                          <button
                            onClick={() =>
                              setPending({
                                type: 'unban',
                                userId: report.target_user!.id,
                                userName: report.target_user!.name,
                              })
                            }
                            className="text-xs font-medium px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
                          >
                            Unban
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setReason('');
                              setPending({
                                type: 'ban',
                                userId: report.target_user!.id,
                                userName: report.target_user!.name,
                              });
                            }}
                            className="text-xs font-medium px-2 py-1 rounded bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60 transition-colors"
                          >
                            Ban
                          </button>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          No abuse reports found.
        </div>
      )}

      {pending?.type === 'delete' && (
        <ConfirmModal
          title="Delete content"
          message={`Delete the reported content "${pending.petName}"? This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(pending.reportId)}
          onCancel={closeModal}
        />
      )}

      {pending?.type === 'ban' && (
        <ConfirmModal
          title="Ban user"
          message={`Ban ${pending.userName}? They won't be able to log in.`}
          confirmLabel="Ban"
          destructive
          loading={banMutation.isPending}
          onConfirm={() => banMutation.mutate({ userId: pending.userId, reason })}
          onCancel={closeModal}
        >
          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-300">Reason (optional)</span>
            <input
              aria-label="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
            />
          </label>
        </ConfirmModal>
      )}

      {pending?.type === 'unban' && (
        <ConfirmModal
          title="Unban user"
          message={`Unban ${pending.userName}? They will be able to log in again.`}
          confirmLabel="Unban"
          loading={unbanMutation.isPending}
          onConfirm={() => unbanMutation.mutate(pending.userId)}
          onCancel={closeModal}
        />
      )}
    </div>
  );
}
