import { useStats } from '@shared/hooks';

export function SheltersPage() {
  const { data: stats } = useStats();

  // TODO: Conectar con API real de refugios
  const shelters = [
    { id: '1', name: 'Refugio Animal Uruguay', city: 'Montevideo', phone: '+598 99 111 222', website_url: 'https://ejemplo.com', donation_url: 'https://ejemplo.com/donar', description: 'Refugio dedicado al rescate y adopción de perros y gatos.' },
    { id: '2', name: 'Patitas Felices', city: 'Canelones', phone: '+598 99 333 444', website_url: 'https://ejemplo.com', donation_url: 'https://ejemplo.com/donar', description: 'Organización sin fines de lucro para el bienestar animal.' },
    { id: '3', name: 'Salvando Huellas', city: 'Maldonado', phone: '+598 99 555 666', website_url: 'https://ejemplo.com', donation_url: 'https://ejemplo.com/donar', description: 'Rescate, rehabilitación y adopción responsable.' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">Refugios y Organizaciones</h1>
        <p className="text-gray-500 max-w-2xl mx-auto">
          Estos son los refugios locales que trabajan rescatando y protegiendo animales.
          Si quieres ayudar, visita sus páginas para donar directamente a ellos.
        </p>
      </div>

      {/* Impacto */}
      <div className="bg-gradient-to-r from-primary to-primary-dark rounded-2xl p-8 text-white mb-10">
        <h2 className="text-xl font-bold mb-4 text-center">Nuestro Impacto</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-3xl font-bold">{stats?.found_pets || 0}</p>
            <p className="text-sm text-white/70">Mascotas encontradas</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold">{stats?.total_users || 0}</p>
            <p className="text-sm text-white/70">Usuarios ayudando</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold">{stats?.total_reports || 0}</p>
            <p className="text-sm text-white/70">Reportes creados</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold">{stats?.total_pets || 0}</p>
            <p className="text-sm text-white/70">Mascotas registradas</p>
          </div>
        </div>
      </div>

      {/* Lista de refugios */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {shelters.map((shelter) => (
          <div key={shelter.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
            <h3 className="text-lg font-bold text-gray-900 mb-1">{shelter.name}</h3>
            <p className="text-sm text-gray-500 mb-3">📍 {shelter.city}</p>
            <p className="text-sm text-gray-600 mb-4">{shelter.description}</p>

            {shelter.phone && (
              <p className="text-sm text-gray-500 mb-1">
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
                  Visitar web
                </a>
              )}
              {shelter.donation_url && (
                <a
                  href={shelter.donation_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center text-sm font-semibold text-white bg-green-500 py-2 rounded-lg hover:bg-green-600 transition-colors"
                >
                  Donar
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="text-center mt-10">
        <p className="text-sm text-gray-400">
          ¿Eres un refugio y quieres aparecer aquí? Contáctanos.
        </p>
      </div>
    </div>
  );
}
