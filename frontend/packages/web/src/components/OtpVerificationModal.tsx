import { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useSendSmsOTP, useConfirmSmsOTP } from '@shared/hooks';

interface OtpVerificationModalProps {
  onSuccess: () => void;
  onClose: () => void;
}

type Step = 'phone' | 'code';

export function OtpVerificationModal({ onSuccess, onClose }: OtpVerificationModalProps) {
  const { t } = useTranslation('otp');
  const sendSmsOTP = useSendSmsOTP();
  const confirmSmsOTP = useConfirmSmsOTP();

  function getErrorMessage(err: unknown): string {
    if (!err) return t('errorUnexpected');
    const e = err as any;
    if (e?.status === 429 || e?.status === 'rate_limit') return t('errorRateLimit');
    if (e?.status === 422 || e?.message?.toLowerCase().includes('max')) return t('errorMaxAttempts');
    if (e?.message) return e.message;
    return t('errorUnexpected');
  }

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [resendCountdown, setResendCountdown] = useState(0);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setTimeout(() => setResendCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  const handleSendCode = async () => {
    setPhoneError('');
    if (!phone.trim()) {
      setPhoneError(t('errorRequired'));
      return;
    }
    try {
      await sendSmsOTP.mutateAsync(phone.trim());
      setStep('code');
      setResendCountdown(60);
    } catch (err) {
      setPhoneError(getErrorMessage(err));
    }
  };

  const handleResend = async () => {
    setCodeError('');
    try {
      await sendSmsOTP.mutateAsync(phone.trim());
      setResendCountdown(60);
    } catch (err) {
      setCodeError(getErrorMessage(err));
    }
  };

  const handleVerify = async () => {
    setCodeError('');
    if (code.length !== 6) {
      setCodeError(t('errorCodeLength'));
      return;
    }
    try {
      await confirmSmsOTP.mutateAsync({ phone: phone.trim(), code });
      onSuccess();
    } catch (err) {
      setCodeError(getErrorMessage(err));
    }
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
      aria-label={t('ariaLabel')}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-6 relative">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          aria-label={t('close')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">
          {t('title')}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          {step === 'phone'
            ? t('stepPhoneDesc')
            : t('stepCodeDesc', { phone })}
        </p>

        {step === 'phone' ? (
          <div className="space-y-4">
            <div>
              <label htmlFor="otp-phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('phoneLabel')}
              </label>
              <input
                id="otp-phone"
                type="tel"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setPhoneError(''); }}
                placeholder="+598 99 000 000"
                autoComplete="tel"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {phoneError && (
                <p className="text-sm text-red-500 dark:text-red-400 mt-1">{phoneError}</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleSendCode}
              disabled={sendSmsOTP.isPending}
              className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 transition-colors"
            >
              {sendSmsOTP.isPending ? t('sending') : t('send')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="otp-code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('codeLabel')}
              </label>
              <input
                id="otp-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setCodeError(''); }}
                placeholder="000000"
                autoComplete="one-time-code"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-center text-2xl tracking-widest focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {codeError && (
                <p className="text-sm text-red-500 dark:text-red-400 mt-1">{codeError}</p>
              )}
            </div>

            <button
              type="button"
              onClick={handleVerify}
              disabled={confirmSmsOTP.isPending}
              className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 transition-colors"
            >
              {confirmSmsOTP.isPending ? t('verifying') : t('verify')}
            </button>

            <div className="text-center">
              {resendCountdown > 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {t('resendIn', { seconds: resendCountdown })}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={sendSmsOTP.isPending}
                  className="text-xs text-primary font-medium disabled:opacity-60"
                >
                  {sendSmsOTP.isPending ? t('sending') : t('resend')}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => { setStep('phone'); setCode(''); setCodeError(''); }}
              className="w-full text-sm text-gray-400 dark:text-gray-500 text-center"
            >
              {t('changeNumber')}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
