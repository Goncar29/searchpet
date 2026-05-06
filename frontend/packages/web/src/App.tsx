import { Routes, Route } from 'react-router';
import { MainLayout } from './layouts/MainLayout';
import { HomePage } from './pages/HomePage';
import { MapPage } from './pages/MapPage';
import { PetDetailPage } from './pages/PetDetailPage';
import { SharedPetPage } from './pages/SharedPetPage';
import { SheltersPage } from './pages/SheltersPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

export default function App() {
  return (
    <Routes>
      {/* Rutas públicas con layout */}
      <Route element={<MainLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/pets/:id" element={<PetDetailPage />} />
        <Route path="/shelters" element={<SheltersPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      {/* Landing page compartida (sin layout) */}
      <Route path="/pet/:token" element={<SharedPetPage />} />
    </Routes>
  );
}
