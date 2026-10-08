import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    // Path AND query, encoded: pet detail links to /reports/create?petId=…, and
    // without the query the user came back from login to a form with no pet
    // picked. Unencoded, a second `&param` would end the returnUrl and become a
    // parameter of /login instead.
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnUrl=${returnUrl}`} replace />;
  }

  return <Outlet />;
}
