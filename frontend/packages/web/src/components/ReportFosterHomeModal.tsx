import { useState } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useSubmitAbuseReport } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';

interface ReportFosterHomeModalProps {
  fosterHomeId: string;
  onClose: () => void;
}

export function ReportFosterHomeModal({ fosterHomeId, onClose }: ReportFosterHomeModalProps) {
  const { t } = useTranslation(['fosterHomes', 'errors']);
  const submitAbuseReport = useSubmitAbuseReport();
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setValidationError(t('common:required'));
      return;
    }
    setValidationError('');
    submitAbuseReport.mutate(
      { target_foster_home_id: fosterHomeId, reason: trimmed },
      {
        onSuccess: () => {
          setSuccess(true);
          setTimeout(onClose, 1500);
        },
      },
    );
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={t('fosterHomes:report.title')}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-6 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          aria-label={t('common:cancel')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-4">
          {t('fosterHomes:report.title')}
        </h2>

        {success ? (
          <p className="text-sm text-green-600 dark:text-green-400 font-medium">
            {t('fosterHomes:report.success')}
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="fh-report-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('fosterHomes:report.reasonLabel')}
              </label>
              <textarea
                id="fh-report-reason"
                value={reason}
                onChange={(e) => { setReason(e.target.value); setValidationError(''); }}
                placeholder={t('fosterHomes:report.reasonPlaceholder')}
                rows={4}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
              {validationError && (
                <p className="text-sm text-red-500 dark:text-red-400 mt-1">{validationError}</p>
              )}
            </div>

            {submitAbuseReport.isError && (
              <p className="text-sm text-red-500 dark:text-red-400">
                {getErrorMessage(submitAbuseReport.error, t)}
              </p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitAbuseReport.isPending}
              className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 transition-colors"
            >
              {submitAbuseReport.isPending ? t('fosterHomes:report.submitting') : t('fosterHomes:report.submit')}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
