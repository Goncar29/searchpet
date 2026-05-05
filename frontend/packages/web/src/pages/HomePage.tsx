import { Link } from 'react-router-dom';
import { useStats, useNearbyReports } from '@shared/hooks';
import { useAuth } from '../context/AuthContext';
import { PetCardWeb } from '../components/PetCardWeb';

export function HomePage() {
  const { isAuthenticated } = useAuth();
  const { data: stats } = useStats();
  // Default: Montevideo
  const { data: reports, isLoading } = useNearbyReports(-34.9011, -56.1645, 20, true);

  return (
    <div>
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-primary to-primary-dark text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <h1 className="text-4xl md:text-5xl font-extrabold mb-4">
            Ayuda a encontrar mascotas perdidas
          </h1>
          <p className="text-lg md:text-xl text-white/80 max-w-2xl mx-auto mb-8">
            Publica, busca en el mapa y comparte en redes sociales.
            Juntos podemos reunir a las mascotas con sus familias.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/map"
              className="inline-flex items-center justify-center px-8 py-3 bg-white text-primary font-bold rounded-lg hover:bg-gray-100 transition-colors"
            >
              Ver mapa
            </Link>
            <Link
              to={isAuthenticated ? '/pets/create' : '/register'}
              className="inline-flex items-center justify-center px-8 py-3 border-2 border-white text-white font-bold rounded-lg hover:bg-white/10 transition-colors"
            >
              Publicar mascota
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10">
        <div className="bg-white rounded-2xl shadow-lg p-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="text-center">
            <p className="text-3xl font-bold text-primary">{stats?.found_pets || 0}</p>
            <p className="text-sm text-gray-500 mt-1">Mascotas encontradas</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-primary">{stats?.total_users || 0}</p>
            <p className="text-sm text-gray-500 mt-1">Personas ayudando</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-primary">{stats?.total_reports || 0}</p>
            <p className="text-sm text-gray-500 mt-1">Reportes activos</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-primary">{stats?.total_pets || 0}</p>
            <p className="text-sm text-gray-500 mt-1">Mascotas registradas</p>
          </div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-10">
          ¿Cómo funciona?
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center p-6">
            <div className="text-5xl mb-4">📝</div>
            <h3 className="font-bold text-lg text-gray-900 mb-2">1. Publica</h3>
            <p className="text-gray-500 text-sm">
              Sube fotos, descripción y la última ubicación donde fue vista tu mascota.
            </p>
          </div>
          <div className="text-center p-6">
            <div className="text-5xl mb-4">🗺️</div>
            <h3 className="font-bold text-lg text-gray-900 mb-2">2. Busca en el mapa</h3>
            <p className="text-gray-500 text-sm">
              Explora reportes cercanos en el mapa interactivo. Filtra por tipo, raza y ubicación.
            </p>
          </div>
          <div className="text-center p-6">
            <div className="text-5xl mb-4">📱</div>
            <h3 className="font-bold text-lg text-gray-900 mb-2">3. Comparte</h3>
            <p className="text-gray-500 text-sm">
              Difunde en WhatsApp, Instagram, Facebook y Twitter para maximizar la búsqueda.
            </p>
          </div>
        </div>
      </section>

      {/* Reportes recientes */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">
          Reportes recientes
        </h2>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-500">Cargando reportes...</p>
          </div>
        ) : reports && reports.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {reports.slice(0, 6).map((report) => (
              <PetCardWeb key={report.id} report={report} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-5xl mb-4">🐾</p>
            <p className="text-gray-500">No hay reportes recientes en tu zona</p>
          </div>
        )}

        {reports && reports.length > 6 && (
          <div className="text-center mt-8">
            <Link
              to="/map"
              className="inline-flex items-center px-6 py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary-dark transition-colors"
            >
              Ver todos en el mapa
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
