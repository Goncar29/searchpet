import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useStats, useNearbyReports } from '@shared/hooks';
import type { Report } from '@shared/types';
import { useAuth } from '../context/AuthContext';
import { PetCardWeb } from '../components/PetCardWeb';

export function HomePage() {
  const { t } = useTranslation(['home', 'common']);
  const { isAuthenticated } = useAuth();
  const { data: stats } = useStats();
  // Default: Montevideo
  const { data: reports, isLoading } = useNearbyReports(-34.9011, -56.1645, 20, true);

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-primary to-primary-dark text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <h1 className="text-4xl md:text-5xl font-extrabold mb-4">
            {t('home:hero.title')}
          </h1>
          <p className="text-lg md:text-xl text-white/80 max-w-2xl mx-auto mb-8">
            {t('home:hero.subtitle')}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/map"
              className="inline-flex items-center justify-center px-8 py-3 bg-white text-primary font-bold rounded-lg hover:bg-gray-100 transition-colors"
            >
              {t('home:viewMap')}
            </Link>
            <Link
              to={isAuthenticated ? '/pets/create' : '/register'}
              className="inline-flex items-center justify-center px-8 py-3 border-2 border-white text-white font-bold rounded-lg hover:bg-white/10 transition-colors"
            >
              {t('home:publish')}
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="text-center">
            <p className="text-3xl font-bold text-primary">{stats?.found_pets || 0}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.found')}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-primary">{stats?.total_users || 0}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.users')}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-primary">{stats?.total_reports || 0}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.reports')}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-primary">{stats?.total_pets || 0}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.pets')}</p>
          </div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 text-center mb-10">
          {t('home:how.title')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center p-6">
            <div className="text-5xl mb-4">📝</div>
            <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100 mb-2">{t('home:how.step1.title')}</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {t('home:how.step1.description')}
            </p>
          </div>
          <div className="text-center p-6">
            <div className="text-5xl mb-4">🗺️</div>
            <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100 mb-2">{t('home:how.step2.title')}</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {t('home:how.step2.description')}
            </p>
          </div>
          <div className="text-center p-6">
            <div className="text-5xl mb-4">📱</div>
            <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100 mb-2">{t('home:how.step3.title')}</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {t('home:how.step3.description')}
            </p>
          </div>
        </div>
      </section>

      {/* Reportes recientes */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          {t('home:recentReports')}
        </h2>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-500 dark:text-gray-400">{t('common:loading')}</p>
          </div>
        ) : reports && reports.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {reports.slice(0, 6).map((report: Report) => (
              <PetCardWeb key={report.id} report={report} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-5xl mb-4">🐾</p>
            <p className="text-gray-500 dark:text-gray-400">{t('home:noReports')}</p>
          </div>
        )}

        {reports && reports.length > 6 && (
          <div className="text-center mt-8">
            <Link
              to="/map"
              className="inline-flex items-center px-6 py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary-dark transition-colors"
            >
              {t('home:viewAll')}
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
