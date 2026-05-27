import { useTranslation } from 'react-i18next';
import { useStats } from '@shared/hooks';

export function SheltersPage() {
  const { t } = useTranslation(['shelters', 'common']);
  const { data: stats } = useStats();

  const shelters = [
    {
      id: '1',
      name: 'SOS Rescate Animal Uruguay',
      city: 'Montevideo',
      phone: '+598 99 123 456',
      website_url: 'https://www.sosrescateanimal.org.uy',
      donation_url: 'https://www.sosrescateanimal.org.uy/donar',
      description: 'Organización sin fines de lucro dedicada al rescate, rehabilitación y adopción responsable de perros y gatos en situación de calle.',
    },
    {
      id: '2',
      name: 'Patitas al Rescate',
      city: 'Montevideo',
      phone: '+598 98 765 432',
      website_url: 'https://www.patitasalrescate.org',
      donation_url: 'https://www.patitasalrescate.org/colaborar',
      description: 'Red de hogares de tránsito y voluntarios que trabajan para dar una segunda oportunidad a animales abandonados.',
    },
    {
      id: '3',
      name: 'Refugio Huellas Felices',
      city: 'Canelones',
      phone: '+598 94 321 654',
      website_url: 'https://www.huellasfelices.uy',
      donation_url: 'https://www.huellasfelices.uy/apoyanos',
      description: 'Refugio físico con capacidad para más de 80 animales. Realizan jornadas de adopción mensuales abiertas a toda la comunidad.',
    },
    {
      id: '4',
      name: 'Asociación Protectora del Animal',
      city: 'Montevideo',
      phone: '+598 2 924 0000',
      website_url: 'https://www.spa.org.uy',
      donation_url: 'https://www.spa.org.uy/donaciones',
      description: 'Una de las organizaciones protectoras de animales más antiguas de Uruguay. Servicios veterinarios, adopción y control poblacional.',
    },
    {
      id: '5',
      name: 'Salvando Huellas Maldonado',
      city: 'Maldonado',
      phone: '+598 98 456 789',
      website_url: null,
      donation_url: null,
      description: 'Grupo de voluntarios del este del país enfocados en rescate de emergencia, castración y búsqueda de hogares adoptivos.',
    },
    {
      id: '6',
      name: 'Mundo Animal Rivera',
      city: 'Rivera',
      phone: '+598 96 789 123',
      website_url: null,
      donation_url: null,
      description: 'Organización local que cubre el norte del país. Trabajan en conjunto con la Intendencia en programas de tenencia responsable.',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 bg-gray-50 dark:bg-gray-950 min-h-screen">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-3">{t('shelters:title')}</h1>
        <p className="text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
          {t('shelters:description')}
        </p>
      </div>

      {/* Impacto */}
      <div className="bg-gradient-to-r from-primary to-primary-dark rounded-2xl p-8 text-white mb-10">
        <h2 className="text-xl font-bold mb-4 text-center">{t('shelters:impact')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-3xl font-bold">{stats?.found_pets || 0}</p>
            <p className="text-sm text-white/70">{t('shelters:impactFound')}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold">{stats?.total_users || 0}</p>
            <p className="text-sm text-white/70">{t('shelters:impactUsers')}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold">{stats?.total_reports || 0}</p>
            <p className="text-sm text-white/70">{t('shelters:impactReports')}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold">{stats?.total_pets || 0}</p>
            <p className="text-sm text-white/70">{t('shelters:impactPets')}</p>
          </div>
        </div>
      </div>

      {/* Lista de refugios */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {shelters.map((shelter) => (
          <div
            key={shelter.id}
            className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 hover:shadow-md transition-shadow"
          >
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">{shelter.name}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">📍 {shelter.city}</p>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{shelter.description}</p>

            {shelter.phone && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                📱 <a href={`tel:${shelter.phone}`} className="text-primary hover:underline">{shelter.phone}</a>
              </p>
            )}

            <div className="flex gap-2 mt-4">
              {shelter.website_url && (
                <a
                  href={shelter.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center text-sm font-semibold text-primary border border-primary py-2 rounded-lg hover:bg-primary/5 transition-colors"
                >
                  {t('shelters:visitWeb')}
                </a>
              )}
              {shelter.donation_url && (
                <a
                  href={shelter.donation_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center text-sm font-semibold text-white bg-green-500 dark:bg-green-600 py-2 rounded-lg hover:bg-green-600 dark:hover:bg-green-700 transition-colors"
                >
                  {t('shelters:donate')}
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="text-center mt-10">
        <p className="text-sm text-gray-400 dark:text-gray-500">
          {t('shelters:contactCta')}
        </p>
      </div>
    </div>
  );
}
