import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@shared/api/client';
import type { AbuseReport } from '@shared/types';

type FilterMode = 'all' | 'pending' | 'resolved';

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
                  <td className="py-2 px-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {report.target_user_id
                      ? `user: ${report.target_user_id.slice(0, 8)}`
                      : report.target_report_id
                      ? `report: ${report.target_report_id.slice(0, 8)}`
                      : '—'}
                  </td>
                  <td className="py-2 px-3 text-gray-500 dark:text-gray-400">
                    {new Date(report.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2 px-3">
                    {report.status === 'pending' && (
                      <div className="flex gap-2">
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
                      </div>
                    )}
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
    </div>
  );
}
