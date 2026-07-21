import { useState, useEffect, useRef } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useQueryClient } from '@tanstack/react-query';
import { useUnreadCount, useWebSocket, useMyShelter } from '@shared/hooks';
import type { WsEnvelope, WsBadgeUpdate } from '@shared/hooks';

export function MainLayout() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, isAdmin, user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation(['layout', 'footer', 'fosterHomes']);
  const queryClient = useQueryClient();

  // "Mi refugio" solo aparece si el usuario tiene uno (dueño). enabled ligado a
  // la sesión para no pegarle a /shelters/mine deslogueado.
  const { data: myShelter } = useMyShelter(isAuthenticated);

  // Badge de mensajes sin leer: REST para el valor inicial, WebSocket
  // (badge_update) para tiempo real. El Hub soporta múltiples conexiones
  // por usuario, así que esta conexión app-wide convive con la del chat.
  const { data: unreadData } = useUnreadCount(isAuthenticated);
  const unreadCount = unreadData?.count ?? 0;
  const unreadLabel = unreadCount > 9 ? '9+' : String(unreadCount);

  useWebSocket({
    enabled: isAuthenticated,
    onMessage: (envelope: WsEnvelope) => {
      if (envelope.type === 'badge_update') {
        const payload = envelope.payload as WsBadgeUpdate;
        queryClient.setQueryData(['messages', 'unread-count'], { count: payload.unread_count });
      } else if (envelope.type === 'chat_message') {
        queryClient.invalidateQueries({ queryKey: ['messages'] });
      }
    },
  });

  const unreadBadge =
    unreadCount > 0 ? (
      <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-primary text-white text-xs font-bold">
        {unreadLabel}
      </span>
    ) : null;

  // Auto-close both menus on route change
  useEffect(() => {
    setIsMenuOpen(false);
    setIsUserMenuOpen(false);
  }, [location.pathname]);

  // Close the profile dropdown on outside click or Escape
  useEffect(() => {
    if (!isUserMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isUserMenuOpen]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  // Links always visible regardless of auth state
  const publicNavLinks = [
    { to: '/', label: t('home') },
    { to: '/map', label: t('map') },
    { to: '/adoptar', label: t('adopt') },
    { to: '/shelters', label: t('shelters') },
    { to: '/leaderboard', label: '🏆 Ranking' },
  ];

  // Private links: only for authenticated users. Moved out of the main nav
  // into the profile dropdown to keep the navbar uncluttered.
  const userMenuLinks: { to: string; label: string; badge?: boolean }[] = [
    { to: '/profile', label: t('profile') },
    { to: '/pets/mine', label: t('myPets') },
    { to: '/messages', label: t('messages'), badge: true },
    { to: '/alerts', label: t('alerts') },
    ...(myShelter ? [{ to: '/shelters/mine', label: t('myShelter') }] : []),
    { to: '/hogares', label: t('fosterHomes:nav') },
    ...(isAdmin ? [{ to: '/admin/abuse-reports', label: t('admin') }] : []),
  ];

  const isActive = (path: string) => location.pathname === path;

  const activeLinkClass = 'text-primary font-semibold';
  const inactiveLinkClass =
    'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-50 transition-colors duration-150';

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* Navbar */}
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Grid de 3 columnas: logo | nav-links | controles
              Las columnas laterales tienen ancho natural (auto), la central
              toma el espacio restante (1fr) y centra el contenido. */}
          <div
            className="grid items-center h-16 w-full"
            style={{ gridTemplateColumns: 'auto 1fr auto' }}
          >
            {/* Columna 1 — Logo */}
            <Link to="/" className="inline-flex items-center gap-2 pr-6">
              <span className="text-2xl">🐾</span>
              <span className="text-xl font-bold text-gray-900 dark:text-gray-50">
                Search<span className="text-primary">Pet</span>
              </span>
            </Link>

            {/* Columna 2 — Nav links centrados (solo desktop) */}
            <div className="hidden min-[960px]:flex items-center justify-center gap-6">
              {publicNavLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`text-sm font-medium whitespace-nowrap ${isActive(link.to) ? activeLinkClass : inactiveLinkClass}`}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            {/* Columna 3 — Controles + auth, siempre visible a la derecha */}
            <div className="flex items-center gap-2 pl-4 justify-end">
              {/* Tema e idioma: siempre visibles */}
              <button
                onClick={toggleTheme}
                aria-label={t('darkMode')}
                className="p-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-150"
              >
                {theme === 'dark' ? '☀️' : '🌙'}
              </button>
              <LanguageSwitcher />

              {/* Auth section — solo desktop */}
              <div className="hidden min-[960px]:flex items-center gap-3 ml-1">
                {isAuthenticated ? (
                  <>
                    <Link
                      to="/publish"
                      className="text-sm font-semibold text-white bg-primary hover:bg-primary-dark px-4 py-2 rounded-lg transition-colors duration-150 whitespace-nowrap"
                    >
                      {t('publish')}
                    </Link>
                    <div
                      className="relative"
                      ref={userMenuRef}
                      onMouseEnter={() => setIsUserMenuOpen(true)}
                      onMouseLeave={() => setIsUserMenuOpen(false)}
                    >
                      <button
                        type="button"
                        onClick={() => setIsUserMenuOpen((prev) => !prev)}
                        aria-haspopup="menu"
                        aria-expanded={isUserMenuOpen}
                        aria-label={t('userMenu')}
                        className="relative flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      >
                        <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-white text-sm font-bold">
                          {user?.name?.charAt(0).toUpperCase() ?? '?'}
                        </span>
                        <span className="hidden lg:inline text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-[8rem] truncate">
                          {user?.name}
                        </span>
                        <svg
                          className={`h-4 w-4 text-gray-400 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`}
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path
                            fillRule="evenodd"
                            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                            clipRule="evenodd"
                          />
                        </svg>
                        {unreadCount > 0 && (
                          <span className="absolute -top-0.5 left-6 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-primary text-white text-[0.65rem] font-bold ring-2 ring-white dark:ring-gray-900">
                            {unreadLabel}
                          </span>
                        )}
                      </button>

                      {isUserMenuOpen && (
                        <div className="absolute right-0 top-full pt-2 z-50">
                          <div
                            role="menu"
                            className="w-56 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-700 shadow-lg py-1"
                          >
                          {userMenuLinks.map((link) => (
                            <Link
                              key={link.to}
                              to={link.to}
                              role="menuitem"
                              className={`flex items-center justify-between px-4 py-2 text-sm ${
                                isActive(link.to)
                                  ? 'text-primary font-semibold bg-orange-50 dark:bg-orange-950'
                                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                              } transition-colors`}
                            >
                              <span>{link.label}</span>
                              {link.badge && unreadBadge}
                            </Link>
                          ))}
                          <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
                          <button
                            onClick={handleLogout}
                            role="menuitem"
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          >
                            {t('logout')}
                          </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <Link
                      to="/login"
                      className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-50 transition-colors duration-150"
                    >
                      {t('login')}
                    </Link>
                    <Link
                      to="/register"
                      className="text-sm font-semibold text-white bg-primary hover:bg-primary-dark px-4 py-2 rounded-lg transition-colors duration-150"
                    >
                      {t('register')}
                    </Link>
                  </>
                )}
              </div>

              {/* Hamburger — solo mobile (< 920px) */}
              <div className="flex min-[960px]:hidden items-center gap-2">
              <button
                onClick={() => setIsMenuOpen((prev) => !prev)}
                aria-label={isMenuOpen ? t('closeMenu') : t('openMenu')}
                aria-expanded={isMenuOpen}
                className="p-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-150"
              >
                {isMenuOpen ? (
                  /* Close icon: ✕ */
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  /* Hamburger icon: ☰ */
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
        </div>

        {/* Mobile nav panel */}
        {isMenuOpen && (
          <div className="min-[960px]:hidden border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col gap-1">
              {publicNavLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`text-sm font-medium py-2 px-3 rounded-md ${
                    isActive(link.to)
                      ? 'text-primary bg-orange-50 dark:bg-orange-950'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  } transition-colors duration-150`}
                >
                  {link.label}
                </Link>
              ))}

              {isAuthenticated ? (
                <>
                  <Link
                    to="/pets/mine"
                    className={`text-sm font-medium py-2 px-3 rounded-md ${
                      isActive('/pets/mine')
                        ? 'text-primary bg-orange-50 dark:bg-orange-950'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    } transition-colors duration-150`}
                  >
                    {t('myPets')}
                  </Link>
                  <Link
                    to="/messages"
                    className={`text-sm font-medium py-2 px-3 rounded-md flex items-center ${
                      isActive('/messages')
                        ? 'text-primary bg-orange-50 dark:bg-orange-950'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    } transition-colors duration-150`}
                  >
                    {t('messages')}
                    {unreadBadge}
                  </Link>
                  <Link
                    to="/alerts"
                    className={`text-sm font-medium py-2 px-3 rounded-md ${
                      isActive('/alerts')
                        ? 'text-primary bg-orange-50 dark:bg-orange-950'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    } transition-colors duration-150`}
                  >
                    {t('alerts')}
                  </Link>
                  {myShelter && (
                    <Link
                      to="/shelters/mine"
                      className={`text-sm font-medium py-2 px-3 rounded-md ${
                        isActive('/shelters/mine')
                          ? 'text-primary bg-orange-50 dark:bg-orange-950'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                      } transition-colors duration-150`}
                    >
                      {t('myShelter')}
                    </Link>
                  )}
                  <Link
                    to="/hogares"
                    className={`text-sm font-medium py-2 px-3 rounded-md ${
                      isActive('/hogares')
                        ? 'text-primary bg-orange-50 dark:bg-orange-950'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    } transition-colors duration-150`}
                  >
                    {t('fosterHomes:nav')}
                  </Link>
                  {isAdmin && (
                    <Link
                      to="/admin/abuse-reports"
                      className={`text-sm font-medium py-2 px-3 rounded-md ${
                        location.pathname.startsWith('/admin')
                          ? 'text-primary bg-orange-50 dark:bg-orange-950'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                      } transition-colors duration-150`}
                    >
                      {t('admin')}
                    </Link>
                  )}
                  <Link
                    to="/publish"
                    className="text-sm font-semibold text-white bg-primary hover:bg-primary-dark py-2 px-3 rounded-md mt-1 text-center transition-colors duration-150"
                  >
                    {t('publish')}
                  </Link>
                  <div className="border-t border-gray-100 dark:border-gray-800 mt-2 pt-2">
                    <Link
                      to="/profile"
                      className="block text-xs font-medium text-primary px-3 mb-1 hover:underline"
                    >
                      {t('greeting', { name: user?.name })}
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left text-sm font-medium py-2 px-3 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-150"
                    >
                      {t('logout')}
                    </button>
                  </div>
                </>
              ) : (
                <div className="border-t border-gray-100 dark:border-gray-800 mt-2 pt-2 flex flex-col gap-1">
                  <Link
                    to="/login"
                    className="text-sm font-medium py-2 px-3 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-150"
                  >
                    {t('login')}
                  </Link>
                  <Link
                    to="/register"
                    className="text-sm font-semibold text-white bg-primary hover:bg-primary-dark py-2 px-3 rounded-md text-center transition-colors duration-150"
                  >
                    {t('register')}
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* Page content */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">🐾</span>
                <span className="font-bold text-gray-900 dark:text-gray-50">SearchPet</span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('footer:description')}
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-gray-50 mb-3">
                {t('footer:links')}
              </h4>
              <div className="flex flex-col gap-2">
                <Link to="/map" className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary transition-colors">
                  {t('map')}
                </Link>
                <Link to="/shelters" className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary transition-colors">
                  {t('shelters')}
                </Link>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-gray-50 mb-3">
                {t('footer:contact')}
              </h4>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('footer:contactText')}
              </p>
              <a
                href="https://github.com/Goncar29/searchpet"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline mt-1 inline-block"
              >
                {t('footer:contactRepo')}
              </a>
            </div>
          </div>
          <div className="border-t border-gray-200 dark:border-gray-700 mt-8 pt-6">
            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
              {t('footer:madeWith')}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
