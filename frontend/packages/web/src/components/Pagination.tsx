import { useTranslation } from 'react-i18next';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

// Reusable prev/next pager with a "page X of Y" indicator. Renders nothing when
// there's a single page. Copy lives in the `pagination` i18n namespace.
export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  const { t } = useTranslation('pagination');
  if (totalPages <= 1) return null;

  const btn =
    'text-sm font-medium px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="flex items-center justify-between mt-4">
      <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} className={btn}>
        {t('prev')}
      </button>
      <span className="text-sm text-gray-500 dark:text-gray-400">
        {t('pageOf', { page, pages: totalPages })}
      </span>
      <button
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className={btn}
      >
        {t('next')}
      </button>
    </div>
  );
}
