import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@shared/api/client';
import { isJwtExpired } from '@shared/utils/jwt';
import type { User } from '@shared/types';
import { registerWebPushToken, listenForegroundMessages } from '../utils/notifications';

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, phone?: string, city?: string) => Promise<void>;
  /** Resolves to `is_new_user` so the caller can decide whether to run onboarding. */
  loginWithGoogle: (idToken: string) => Promise<boolean>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  /**
   * La caché de React Query se vacía cuando cambia QUIÉN está logueado.
   *
   * EL PROBLEMA: ninguna clave de query lleva el id del usuario — `['me']`,
   * `['messages']`, `['pets','mine']`, `['reports']` son todas globales — y
   * cerrar sesión navega con el router, sin recargar la página. Así que la
   * caché del usuario anterior sobrevivía y se le servía al siguiente hasta que
   * cada query terminara de refetchear. Reportado por un usuario: cambiaba de
   * cuenta y veía "rastros" de la sesión anterior, a veces un segundo, a veces
   * hasta recargar. No es cosmético: durante ese rato B ve la lista de
   * conversaciones de A, con nombres y previews de mensajes ajenos.
   *
   * VA EN UN SOLO LUGAR, y ese es el punto. Hay SEIS caminos que cambian de
   * identidad —`login`, `register`, `loginWithGoogle`, `logout`, el listener de
   * `auth:session-expired` y el de token vencido al volver a la pestaña— y
   * ponerle un `clear()` a cada uno es una lista que alguien va a olvidar
   * ampliar. Un efecto sobre el id los cubre a todos, incluido el que se agregue
   * mañana.
   *
   * LA PREGUNTA ES SI HUBO UNA SESIÓN ANTES, NO SI HAY DATOS AHORA. El primer
   * login de una carga de página no tiene nada de nadie que limpiar: lo que
   * pueda haber cacheado es público y lo pidió este mismo usuario navegando
   * (`stats`, `stories`, `pets/search` los carga el home sin sesión). Limpiar
   * ahí es puro desperdicio. En cambio, en cuanto hubo UNA sesión en esta
   * página, todo login posterior tiene que limpiar aunque el id anterior sea
   * null — porque entre medio pudo aterrizar una escritura de la sesión vieja.
   *
   * Una versión anterior preguntaba `hayDatosCacheados` (`data !== undefined`).
   * Cubría lo mismo en seguridad y costaba caro: MEDIDO en el browser, entrar
   * desde el home pasaba de 5 a 10 requests, porque el home sin sesión ya deja
   * el feed en la caché y eso disparaba el `clear()` en el caso más común que
   * hay. La bandera da la misma cobertura gratis.
   *
   * LO QUE ESTA GUARDA NO PUEDE CERRAR, y por eso no vive sola: una escritura
   * que aterriza DESPUÉS del login siguiente. Las mutaciones sobreviven al
   * `clear()` y al unmount —`MutationCache.clear()` las saca del set pero no
   * cancela `execute()`— así que un envío que rechaza tarde restauraría el hilo
   * de A cuando ya no queda ninguna transición de identidad por delante.
   * Limpiar al cambiar de identidad no alcanza contra algo que llega después
   * del cambio: eso se repara en la escritura, en `useSendMessageTo.onError`,
   * que se abstiene si el token de la sesión cambió.
   */
  const idAnteriorRef = useRef<string | null>(null);
  const huboSesionRef = useRef(false);
  useEffect(() => {
    const actual = user?.id ?? null;
    const anterior = idAnteriorRef.current;
    if (anterior === actual) return;
    idAnteriorRef.current = actual;

    if (anterior !== null || huboSesionRef.current) queryClient.clear();
    if (actual !== null) huboSesionRef.current = true;
  }, [user?.id, queryClient]);

  // Al iniciar, recuperamos el token de localStorage si existe.
  // isLoading evita que ProtectedRoute redirija antes de que este efecto termine.
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    try {
      // Only restore a session whose token has NOT already expired — otherwise the
      // UI would show the user as logged in until the first request gets a 401.
      // Parse the user BEFORE any setState so a corrupt value can't leave the
      // context half-initialized (token set, user missing).
      if (savedToken && savedUser && !isJwtExpired(savedToken)) {
        const parsedUser: User = JSON.parse(savedUser);
        setToken(savedToken);
        setUser(parsedUser);
        apiClient.setToken(savedToken);
      } else if (savedToken || savedUser) {
        // Expired or partial session — drop it so it never appears active.
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    } catch {
      // Corrupt persisted session (e.g. invalid user JSON) — drop it so the app
      // never hangs on load; the user simply logs in again.
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
    setIsLoading(false);
  }, []);

  // Reconciliar el usuario cacheado con el servidor al montar.
  //
  // localStorage guarda el usuario tal como vino de la respuesta de login, y esa
  // respuesta puede quedar vieja: la foto de perfil de Google se importa DESPUÉS
  // de emitir el token (fuera del camino de respuesta), así que el usuario recién
  // creado se persiste sin foto y el avatar del nav nunca la mostraría.
  // Es best-effort: si falla, seguimos con lo cacheado.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiClient
      .getMe()
      .then((fresh) => {
        // Guard: never let a malformed response blank out a good cached user.
        if (cancelled || !fresh?.id) return;
        setUser(fresh);
        localStorage.setItem('user', JSON.stringify(fresh));
      })
      .catch(() => {
        /* sin red o 401 — el interceptor del client ya maneja la sesión expirada */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Escuchar notificaciones en primer plano cuando el usuario está autenticado.
  // El listener se limpia al hacer logout o desmontar el componente.
  useEffect(() => {
    if (!token) return;
    const unsubscribe = listenForegroundMessages();
    return () => { unsubscribe?.(); };
  }, [token]);

  // Limpiar sesión cuando el API client detecta un 401 (token expirado o inválido).
  useEffect(() => {
    const handleSessionExpired = (event: Event) => {
      setToken(null);
      setUser(null);
      localStorage.removeItem('token');
      localStorage.removeItem('user');

      // `session_expired` specifically means the JWT predates a password
      // change (see backend middleware.Auth) — that token will NEVER work
      // again. Clearing local state is not enough: if the request that
      // surfaced this happened on a public page (e.g. liking a story while
      // logged in), the user would be silently logged out with no prompt to
      // sign back in. A run-of-the-mill `unauthorized` 401 (bad/missing
      // token) does not force this — that already happens routinely (e.g. a
      // stale tab) and forcibly yanking the user off whatever page they are
      // on would be disruptive for no security reason.
      const code = (event as CustomEvent<{ code?: string }>).detail?.code;
      if (code === 'session_expired') {
        // Carry where the user was: LoginPage reads `returnUrl` and navigates back
        // after a successful sign-in. Without it a forced logout always dumps them
        // on the home page, which is a needless detour right after they proved who
        // they are. `/login` itself is excluded — pointing returnUrl at the login
        // page would bounce the user straight back to it after signing in.
        const current = window.location.pathname + window.location.search;
        const target = current.startsWith('/login')
          ? '/login'
          : `/login?returnUrl=${encodeURIComponent(current)}`;
        window.location.assign(target);
      }
    };
    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth:session-expired', handleSessionExpired);
  }, []);

  // When the tab regains focus/visibility after sitting idle, proactively drop a
  // token that expired while away — so returning to the app never shows a stale
  // logged-in state that only fails (spinning) on the next request.
  useEffect(() => {
    if (!token) return;
    const dropIfExpired = () => {
      if (isJwtExpired(token)) {
        setToken(null);
        setUser(null);
        apiClient.setToken(null);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    };
    window.addEventListener('focus', dropIfExpired);
    document.addEventListener('visibilitychange', dropIfExpired);
    return () => {
      window.removeEventListener('focus', dropIfExpired);
      document.removeEventListener('visibilitychange', dropIfExpired);
    };
  }, [token]);

  const login = async (email: string, password: string) => {
    const resp = await apiClient.login({ email, password });
    setToken(resp.token);
    setUser(resp.user);
    localStorage.setItem('token', resp.token);
    localStorage.setItem('user', JSON.stringify(resp.user));
    // Registrar token FCM — en background, falla silenciosamente
    registerWebPushToken();
  };

  const register = async (email: string, password: string, name: string, phone?: string, city?: string) => {
    const resp = await apiClient.register({ email, password, name, phone, city });
    setToken(resp.token);
    setUser(resp.user);
    localStorage.setItem('token', resp.token);
    localStorage.setItem('user', JSON.stringify(resp.user));
    // Registrar token FCM — en background, falla silenciosamente
    registerWebPushToken();
  };

  const loginWithGoogle = async (idToken: string): Promise<boolean> => {
    const resp = await apiClient.loginWithGoogle(idToken);
    setToken(resp.token);
    setUser(resp.user);
    localStorage.setItem('token', resp.token);
    localStorage.setItem('user', JSON.stringify(resp.user));
    // Registrar token FCM — en background, falla silenciosamente
    registerWebPushToken();
    return resp.is_new_user;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    apiClient.logout();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  const refreshUser = async () => {
    try {
      const updated = await apiClient.getMe();
      setUser(updated);
      localStorage.setItem('user', JSON.stringify(updated));
    } catch {
      // Si falla, mantenemos el usuario actual
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, login, register, loginWithGoogle, logout, refreshUser, isAuthenticated: !!token, isAdmin: user?.is_admin ?? false, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook para usar el contexto fácilmente en cualquier componente
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
