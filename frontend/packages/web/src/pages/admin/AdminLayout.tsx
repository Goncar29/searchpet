import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';

const navLinks = [
  { to: '/admin/abuse-reports', labelKey: 'nav.abuseReports' },
  { to: '/admin/stories', labelKey: 'nav.stories' },
  { to: '/admin/groups', labelKey: 'nav.groups' },
  { to: '/admin/admins', labelKey: 'nav.admins' },
];

export function AdminLayout() {
  const { t } = useTranslation('admin');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('panel.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('panel.subtitle')}</p>
      </div>

      {/* Nav tabs — horizontal on all screens, sidebar on md+ */}
      <div className="flex flex-col md:flex-row gap-6">
        <nav className="flex md:flex-col gap-1 flex-shrink-0 md:w-48">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `text-sm font-medium py-2 px-3 rounded-md transition-colors duration-150 whitespace-nowrap ${
                  isActive
                    ? 'text-primary bg-orange-50 dark:bg-orange-950'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`
              }
            >
              {t(link.labelKey)}
            </NavLink>
          ))}
        </nav>

        {/* Page content */}
        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
