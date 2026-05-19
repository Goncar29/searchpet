import { Routes, Route } from 'react-router';
import { MainLayout } from './layouts/MainLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { HomePage } from './pages/HomePage';
import { MapPage } from './pages/MapPage';
import { PetDetailPage } from './pages/PetDetailPage';
import { SharedPetPage } from './pages/SharedPetPage';
import { SheltersPage } from './pages/SheltersPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { CreatePetPage } from './pages/CreatePetPage';
import { EditPetPage } from './pages/EditPetPage';
import { ProfilePage } from './pages/ProfilePage';
import { MyPetsPage } from './pages/MyPetsPage';
import { CreateReportPage } from './pages/CreateReportPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { UserProfilePage } from './pages/UserProfilePage';
import { InstallPWA } from './components/InstallPWA';
import { DownloadPage } from './pages/DownloadPage';
import { StoriesPage } from './pages/StoriesPage';

export default function App() {
  return (
    <>
      <Routes>
        {/* Rutas con layout */}
        <Route element={<MainLayout />}>
          {/* Rutas públicas */}
          <Route path="/" element={<HomePage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/pets/:id" element={<PetDetailPage />} />
          <Route path="/shelters" element={<SheltersPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/stories" element={<StoriesPage />} />
          <Route path="/users/:id" element={<UserProfilePage />} />
          <Route path="/descargar" element={<DownloadPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Rutas protegidas (requieren autenticación) */}
          <Route element={<ProtectedRoute />}>
            <Route path="/pets/create" element={<CreatePetPage />} />
            <Route path="/pets/:id/edit" element={<EditPetPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/pets/mine" element={<MyPetsPage />} />
            <Route path="/reports/create" element={<CreateReportPage />} />
          </Route>
        </Route>

        {/* Landing page compartida (sin layout) */}
        <Route path="/pet/:token" element={<SharedPetPage />} />
      </Routes>
      <InstallPWA />
    </>
  );
}
