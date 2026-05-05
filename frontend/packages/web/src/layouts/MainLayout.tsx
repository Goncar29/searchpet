import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function MainLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const navLinks = [
    { to: '/', label: 'Inicio' },
    { to: '/map', label: 'Mapa' },
    { to: '/shelters', label: 'Refugios' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Navbar */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2">
              <span className="text-2xl">🐾</span>
              <span className="text-xl font-bold text-gray-900">
                Search<span className="text-primary">Pet</span>
              </span>
            </Link>

            {/* Nav Links */}
            <div className="hidden md:flex items-center gap-6">
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`text-sm font-medium transition-colors ${
                    location.pathname === link.to
                      ? 'text-primary'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            {/* Auth Buttons */}
            <div className="flex items-center gap-3">
              {isAuthenticated ? (
                <>
                  <span className="text-sm font-medium text-gray-700">Hola, {user?.name}</span>
                  <button
                    onClick={handleLogout}
                    className="text-sm font-medium text-gray-600 hover:text-gray-900"
                  >
                    Cerrar Sesión
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="text-sm font-medium text-gray-600 hover:text-gray-900"
                  >
                    Iniciar Sesión
                  </Link>
                  <Link
                    to="/register"
                    className="text-sm font-medium text-white bg-primary hover:bg-primary-dark px-4 py-2 rounded-lg transition-colors"
                  >
                    Registrarse
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">🐾</span>
                <span className="font-bold text-gray-900">SearchPet</span>
              </div>
              <p className="text-sm text-gray-500">
                Plataforma gratuita para encontrar mascotas perdidas.
                Un proyecto de causa social, sin monetización.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-3">Links</h4>
              <div className="flex flex-col gap-2">
                <Link to="/map" className="text-sm text-gray-500 hover:text-primary">Mapa</Link>
                <Link to="/shelters" className="text-sm text-gray-500 hover:text-primary">Refugios</Link>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-3">Contacto</h4>
              <p className="text-sm text-gray-500">
                ¿Quieres contribuir? Este es un proyecto open source.
              </p>
            </div>
          </div>
          <div className="border-t border-gray-200 mt-8 pt-6">
            <p className="text-center text-sm text-gray-400">
              Hecho con ❤️ para ayudar a encontrar mascotas perdidas
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
