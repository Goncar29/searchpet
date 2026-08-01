import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@shared/api/client';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/Logo';

type Step = 'email' | 'code';

// Igual al min=6 de ResetPasswordRequest en el backend, que a su vez iguala a
// RegisterRequest: exigir más en la recuperación que en el alta sería incoherente.
const MIN_PASSWORD_LENGTH = 6;

const RESEND_COOLDOWN_MS = 60_000;

// sessionStorage, NO localStorage. El tamaño no es el problema (son ~13 bytes
// contra un presupuesto de 5-10 MB por origen, y se sobrescribe en vez de
// acumularse): el problema es la vida útil. localStorage no expira nunca, así que
// una clave escrita en un reset que hacés una vez en la vida queda para siempre.
// sessionStorage lo borra el navegador al cerrar la pestaña, que es exactamente
// lo que dura un contador de 60 segundos, y no necesita código de limpieza.
//
// Sobrevive un F5, que es el caso que importa: si recargás y reenviás enseguida,
// el servidor se come el pedido en silencio por el cooldown y no llega ningún mail.
const RESEND_DEADLINE_KEY = 'searchpet:pwreset:resendAt';

function readResendDeadline(): number {
  try {
    const raw = sessionStorage.getItem(RESEND_DEADLINE_KEY);
    const at = raw ? Number(raw) : 0;
    return Number.isFinite(at) ? at : 0;
  } catch {
    // Safari en modo privado tira al tocar storage. Sin contador se vive; con una
    // excepción sin atrapar se rompe la pantalla entera.
    return 0;
  }
}

function writeResendDeadline(at: number): void {
  try {
    sessionStorage.setItem(RESEND_DEADLINE_KEY, String(at));
  } catch {
    /* ver readResendDeadline */
  }
}

const inputClass =
  'w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

export function ForgotPasswordPage() {
  const { t } = useTranslation(['auth', 'common', 'errors']);
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);
  // Se inicializa leyendo el deadline para que un F5 en mitad del cooldown no
  // reactive el botón: sin esto, recargar y reenviar hace que el servidor se coma
  // el pedido en silencio y no llegue ningún mail.
  const [resendAt, setResendAt] = useState(readResendDeadline);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // La dependencia es el DEADLINE, no secondsLeft. Con secondsLeft el efecto se
  // vuelve a correr en cada tick, destruyendo y recreando el intervalo una vez por
  // segundo — que además de derrochador rompe los tests con timers falsos, porque
  // el intervalo nuevo se agenda contra el reloj ya avanzado. resendAt sólo cambia
  // cuando se pide un código, así que el intervalo es estable mientras dura la cuenta.
  useEffect(() => {
    // Sin deadline no hay nada que contar: arrancar el intervalo igual sería un
    // tick por segundo sin propósito, y en los tests dispara warnings de act()
    // por actualizar estado fuera de toda interacción.
    if (resendAt === 0) return;

    const tick = () => {
      const ms = resendAt - Date.now();
      setSecondsLeft(ms > 0 ? Math.ceil(ms / 1000) : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [resendAt]);

  // `e` es opcional para que el botón de reenvío pueda llamarla sin evento.
  const handleRequest = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setApiError('');
    setLoading(true);
    try {
      await apiClient.forgotPassword(email.trim());
      // Un pedido nuevo hace que el backend retire los códigos anteriores
      // (MarkAllUsedByUserExcept), así que lo que haya tipeado el usuario ya no
      // sirve. Dejarlo ahí invita a enviarlo: come otp_invalid y encima quema uno
      // de los 5 intentos del token nuevo.
      setCode('');
      const deadline = Date.now() + RESEND_COOLDOWN_MS;
      writeResendDeadline(deadline);
      setResendAt(deadline);
      // Always advance. The backend answers 200 whether or not the address is
      // registered; branching here would rebuild — in the client — the exact
      // enumeration oracle the backend deliberately closed.
      setStep('code');
    } catch (err) {
      setApiError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError('');

    // Sin este chequeo una contraseña corta viaja igual y vuelve como
    // binding_failed — "Los datos de entrada no son válidos", que no dice cuál
    // dato. En una pantalla donde el fallo esperado es "el código está mal", ese
    // mensaje genérico apunta al campo equivocado. RegisterPage ya valida así.
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setApiError(t('auth:register.passwordMin'));
      return;
    }

    setLoading(true);
    try {
      await apiClient.resetPassword(email.trim(), code.trim(), newPassword);
      // Drop the local session before leaving. The reset just invalidated every
      // token issued before it, so anything still held here is dead — and while
      // it is held, LoginPage's isAuthenticated guard bounces this navigation
      // straight back to "/", where the user sits with a token that 401s on the
      // next request and never sees the confirmation.
      logout();
      navigate('/login', { state: { notice: t('forgotPassword.success') } });
    } catch (err) {
      setApiError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16 bg-gray-50 dark:bg-gray-950 min-h-screen">
      <div className="text-center mb-8">
        <Logo className="h-14 w-14 mx-auto mb-3 text-primary" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('forgotPassword.title')}
        </h1>
      </div>

      {step === 'email' ? (
        <form
          onSubmit={handleRequest}
          noValidate
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-4"
        >
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('forgotPassword.emailStepDescription')}
          </p>

          {/* Texto FIJO: informa la POLÍTICA, nunca el estado de la cuenta. Un
              contador real ("te quedan 2 de 3") sólo se puede calcular para una
              cuenta que existe, así que mostrarlo reconstruiría en el cliente el
              oráculo de enumeración que el backend cierra a propósito. */}
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('forgotPassword.dailyLimitNotice')}
          </p>

          {apiError && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg">
              {apiError}
            </div>
          )}

          <div>
            <label htmlFor="forgot-email" className={labelClass}>
              {t('forgotPassword.email')}
            </label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* `secondsLeft` también acá, no sólo en el reenvío. El paso no se
              persiste, así que un F5 durante el cooldown devuelve al usuario a esta
              pantalla: sin esta guarda vuelve a mandar, el servidor se lo come en
              silencio (cooldown, no se acuña nada, no sale ningún mail), la UI
              avanza igual diciendo que envió un código, y encima el submit PISA el
              deadline vivo dejándolo esperando más que el cooldown real. */}
          <button
            type="submit"
            disabled={loading || !email.trim() || secondsLeft > 0}
            className="w-full bg-primary text-white font-bold py-3 rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-60"
          >
            {loading
              ? t('common:loading')
              : secondsLeft > 0
                ? t('forgotPassword.resendIn', { seconds: secondsLeft })
                : t('forgotPassword.sendCode')}
          </button>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            <Link to="/login" className="text-primary font-semibold hover:underline">
              {t('forgotPassword.backToLogin')}
            </Link>
          </p>
        </form>
      ) : (
        <form
          onSubmit={handleReset}
          noValidate
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-4"
        >
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('forgotPassword.codeStepDescription')}
          </p>

          {/* La cuenta regresiva sale del reloj del cliente, no del servidor:
              refleja lo que hizo ESTE navegador. El servidor no puede informarla
              sin delatar si la cuenta existe. */}
          <button
            type="button"
            onClick={() => {
              void handleRequest();
            }}
            disabled={secondsLeft > 0 || loading}
            className="text-sm text-primary underline disabled:no-underline disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            {secondsLeft > 0
              ? t('forgotPassword.resendIn', { seconds: secondsLeft })
              : t('forgotPassword.resend')}
          </button>

          {apiError && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg">
              {apiError}
            </div>
          )}

          <div>
            <label htmlFor="forgot-code" className={labelClass}>
              {t('forgotPassword.code')}
            </label>
            <input
              id="forgot-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="forgot-new-password" className={labelClass}>
              {t('forgotPassword.newPassword')}
            </label>
            <input
              id="forgot-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('forgotPassword.sessionsWarning')}
          </p>

          <button
            type="submit"
            disabled={loading || !code.trim() || !newPassword}
            className="w-full bg-primary text-white font-bold py-3 rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-60"
          >
            {loading ? t('common:loading') : t('forgotPassword.submit')}
          </button>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            <Link to="/login" className="text-primary font-semibold hover:underline">
              {t('forgotPassword.backToLogin')}
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
