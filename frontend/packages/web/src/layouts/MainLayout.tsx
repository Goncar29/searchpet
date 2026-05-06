import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export function MainLayout() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation(['layout', 'footer']);

  // Auto-close mobile menu on route change
  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  // Links always visible regardless of auth state
  const publicNavLinks = [
    { to: '/', label: t('home') },
    { to: '/map', label: t('map') },
    { to: '/shelters', label: t('shelters') },
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
          <div className="flex justify-between items-center h-16">

            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 shrink-0">
              <span className="text-2xl">🐾</span>
              <span className="text-xl font-bold text-gray-900 dark:text-gray-50">
                Search<span className="text-primary">Pet</span>
              </span>
            </Link>

            {/* Desktop nav links (md+) */}
            <div className="hidden md:flex items-center gap-6">
              {publicNavLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`text-sm font-medium ${isActive(link.to) ? activeLinkClass : inactiveLinkClass}`}
                >
                  {link.label}
                </Link>
              ))}
              {isAuthenticated && (
                <Link
                  to="/pets/mine"
                  className={`text-sm font-medium ${isActive('/pets/mine') ? activeLinkClass : inactiveLinkClass}`}
                >
                  {t('myPets')}
                </Link>
              )}
            </div>

            {/* Desktop right section */}
            <div className="hidden md:flex items-center gap-3">
              {/* Dark mode toggle */}
              <button
                onClick={toggleTheme}
                aria-label={t('darkMode')}
                className="p-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-150"
              >
                {theme === 'dark' ? '☀️' : '🌙'}
              </button>

              {/* Language switcher */}
              <LanguageSwitcher />

              {/* Auth section */}
              {isAuthenticated ? (
                <>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('greeting', { name: user?.name })}
                  </span>
                  <Link
                    to="/pets/create"
                    className="text-sm font-semibold text-white bg-primary hover:bg-primary-dark px-4 py-2 rounded-lg transition-colors duration-150"
                  >
                    {t('publish')}
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-50 transition-colors duration-150"
                  >
                    {t('logout')}
                  </button>
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

            {/* Mobile right section: theme toggle + lang + hamburger */}
            <div className="flex md:hidden items-center gap-2">
              <button
                onClick={toggleTheme}
                aria-label={t('darkMode')}
                className="p-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-150"
              >
                {theme === 'dark' ? '☀️' : '🌙'}
              </button>
              <LanguageSwitcher />
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

        {/* Mobile nav panel */}
        {isMenuOpen && (
          <div className="md:hidden border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
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
                    to="/pets/create"
                    className="text-sm font-semibold text-white bg-primary hover:bg-primary-dark py-2 px-3 rounded-md mt-1 text-center transition-colors duration-150"
                  >
                    {t('publish')}
                  </Link>
                  <div className="border-t border-gray-100 dark:border-gray-800 mt-2 pt-2">
                    <span className="block text-xs text-gray-400 dark:text-gray-500 px-3 mb-1">
                      {t('greeting', { name: user?.name })}
                    </span>
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
            </div>
          </div>
          <div className="border-t border-gray-200 dark:border-gray-700 mt-8 pt-6">
            <p className="text-center text-sm text-gray-400 dark:text-gray-500">
              {t('footer:madeWith')}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
