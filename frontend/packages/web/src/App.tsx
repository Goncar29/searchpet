import { Routes, Route, Navigate } from 'react-router';
import { MainLayout } from './layouts/MainLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminRoute } from './components/AdminRoute';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AbuseReportsPage } from './pages/admin/AbuseReportsPage';
import { StoriesAdminPage } from './pages/admin/StoriesAdminPage';
import { GroupsAdminPage } from './pages/admin/GroupsAdminPage';
import { AdminsPage } from './pages/admin/AdminsPage';
import { SheltersAdminPage } from './pages/admin/SheltersAdminPage';
import { HomePage } from './pages/HomePage';
import { MapPage } from './pages/MapPage';
import { PetDetailPage } from './pages/PetDetailPage';
import { SharedPetPage } from './pages/SharedPetPage';
import { SheltersPage } from './pages/SheltersPage';
import { ImpactPage } from './pages/ImpactPage';
import { AdoptPage } from './pages/AdoptPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { CreatePetPage } from './pages/CreatePetPage';
import { EditPetPage } from './pages/EditPetPage';
import { ProfilePage } from './pages/ProfilePage';
import { MyPetsPage } from './pages/MyPetsPage';
import { CreateReportPage } from './pages/CreateReportPage';
import { CreateStoryPage } from './pages/CreateStoryPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { UserProfilePage } from './pages/UserProfilePage';
import { InstallPWA } from './components/InstallPWA';
import { DownloadPage } from './pages/DownloadPage';
import { StoriesPage } from './pages/StoriesPage';
import { StoryDetailPage } from './pages/StoryDetailPage';
import { GroupsPage } from './pages/GroupsPage';
import { GroupDetailPage } from './pages/GroupDetailPage';
import { BlockedUsersPage } from './pages/BlockedUsersPage';
import { MessagesPage } from './pages/MessagesPage';
import { ChatPage } from './pages/ChatPage';
import { AlertsPage } from './pages/AlertsPage';
import { PublishWizardPage } from './pages/PublishWizardPage';
import { RegisterShelterPage } from './pages/RegisterShelterPage';
import { MyShelterPage } from './pages/MyShelterPage';
import { FosterHomesPage } from './pages/FosterHomesPage';
import { FosterHomeDetailPage } from './pages/FosterHomeDetailPage';
import { RegisterFosterHomePage } from './pages/RegisterFosterHomePage';
import { MyFosterHomePage } from './pages/MyFosterHomePage';
import { FosterHomesAdminPage } from './pages/admin/FosterHomesAdminPage';

export default function App() {
  return (
    <>
      <Routes>
        {/* Rutas con layout */}
        <Route element={<MainLayout />}>
          {/* Rutas públicas */}
          <Route path="/" element={<HomePage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/publish" element={<PublishWizardPage />} />
          <Route path="/pets/:id" element={<PetDetailPage />} />
          <Route path="/adopt" element={<AdoptPage />} />
          <Route path="/shelters" element={<SheltersPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/stories" element={<StoriesPage />} />
          <Route path="/stories/:id" element={<StoryDetailPage />} />
          <Route path="/users/:id" element={<UserProfilePage />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/groups/:id" element={<GroupDetailPage />} />
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
            <Route path="/stories/create" element={<CreateStoryPage />} />
            <Route path="/blocked-users" element={<BlockedUsersPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:userId" element={<ChatPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/shelters/register" element={<RegisterShelterPage />} />
            <Route path="/shelters/mine" element={<MyShelterPage />} />
            <Route path="/fosterhomes" element={<FosterHomesPage />} />
            <Route path="/fosterhomes/register" element={<RegisterFosterHomePage />} />
            <Route path="/fosterhomes/mine" element={<MyFosterHomePage />} />
            <Route path="/fosterhomes/:id" element={<FosterHomeDetailPage />} />
          </Route>
          {/* Admin routes — protected by AdminRoute guard */}
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="/admin/abuse-reports" replace />} />
              <Route path="abuse-reports" element={<AbuseReportsPage />} />
              <Route path="stories" element={<StoriesAdminPage />} />
              <Route path="groups" element={<GroupsAdminPage />} />
              <Route path="admins" element={<AdminsPage />} />
              <Route path="shelters" element={<SheltersAdminPage />} />
              <Route path="foster-homes" element={<FosterHomesAdminPage />} />
              <Route path="impact" element={<ImpactPage />} />
            </Route>
          </Route>
        </Route>

        {/* Landing page compartida (sin layout) */}
        <Route path="/pet/:token" element={<SharedPetPage />} />
      </Routes>
      <InstallPWA />
    </>
  );
}
