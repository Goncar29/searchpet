import { Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { Analytics } from '@vercel/analytics/react';
import { MainLayout } from './layouts/MainLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminRoute } from './components/AdminRoute';
import { HomePage } from './pages/HomePage';
import { MY_PETS_ROUTE } from './routes';
import { InstallPWA } from './components/InstallPWA';
import { RouteFallback } from './components/RouteFallback';
import { lazyPage } from './lazyPage';

// Every page except the home is its own chunk; the home stays eager because it
// is where most visits land and its <h1> is the LCP element.
const AdminLayout = lazyPage(() => import('./pages/admin/AdminLayout'), 'AdminLayout');
const AbuseReportsPage = lazyPage(() => import('./pages/admin/AbuseReportsPage'), 'AbuseReportsPage');
const StoriesAdminPage = lazyPage(() => import('./pages/admin/StoriesAdminPage'), 'StoriesAdminPage');
const GroupsAdminPage = lazyPage(() => import('./pages/admin/GroupsAdminPage'), 'GroupsAdminPage');
const AdminsPage = lazyPage(() => import('./pages/admin/AdminsPage'), 'AdminsPage');
const SheltersAdminPage = lazyPage(() => import('./pages/admin/SheltersAdminPage'), 'SheltersAdminPage');
const MapPage = lazyPage(() => import('./pages/MapPage'), 'MapPage');
const PetDetailPage = lazyPage(() => import('./pages/PetDetailPage'), 'PetDetailPage');
const SharedPetPage = lazyPage(() => import('./pages/SharedPetPage'), 'SharedPetPage');
const SheltersPage = lazyPage(() => import('./pages/SheltersPage'), 'SheltersPage');
const ImpactPage = lazyPage(() => import('./pages/ImpactPage'), 'ImpactPage');
const AdoptPage = lazyPage(() => import('./pages/AdoptPage'), 'AdoptPage');
const LoginPage = lazyPage(() => import('./pages/LoginPage'), 'LoginPage');
const RegisterPage = lazyPage(() => import('./pages/RegisterPage'), 'RegisterPage');
const ForgotPasswordPage = lazyPage(() => import('./pages/ForgotPasswordPage'), 'ForgotPasswordPage');
const CreatePetPage = lazyPage(() => import('./pages/CreatePetPage'), 'CreatePetPage');
const EditPetPage = lazyPage(() => import('./pages/EditPetPage'), 'EditPetPage');
const ProfilePage = lazyPage(() => import('./pages/ProfilePage'), 'ProfilePage');
const MyPetsPage = lazyPage(() => import('./pages/MyPetsPage'), 'MyPetsPage');
const CreateReportPage = lazyPage(() => import('./pages/CreateReportPage'), 'CreateReportPage');
const CreateStoryPage = lazyPage(() => import('./pages/CreateStoryPage'), 'CreateStoryPage');
const LeaderboardPage = lazyPage(() => import('./pages/LeaderboardPage'), 'LeaderboardPage');
const UserProfilePage = lazyPage(() => import('./pages/UserProfilePage'), 'UserProfilePage');
const DownloadPage = lazyPage(() => import('./pages/DownloadPage'), 'DownloadPage');
const StoriesPage = lazyPage(() => import('./pages/StoriesPage'), 'StoriesPage');
const StoryDetailPage = lazyPage(() => import('./pages/StoryDetailPage'), 'StoryDetailPage');
const GroupsPage = lazyPage(() => import('./pages/GroupsPage'), 'GroupsPage');
const GroupDetailPage = lazyPage(() => import('./pages/GroupDetailPage'), 'GroupDetailPage');
const BlockedUsersPage = lazyPage(() => import('./pages/BlockedUsersPage'), 'BlockedUsersPage');
const MessagesPage = lazyPage(() => import('./pages/MessagesPage'), 'MessagesPage');
const ChatPage = lazyPage(() => import('./pages/ChatPage'), 'ChatPage');
const AlertsPage = lazyPage(() => import('./pages/AlertsPage'), 'AlertsPage');
const PublishWizardPage = lazyPage(() => import('./pages/PublishWizardPage'), 'PublishWizardPage');
const RegisterShelterPage = lazyPage(() => import('./pages/RegisterShelterPage'), 'RegisterShelterPage');
const MyShelterPage = lazyPage(() => import('./pages/MyShelterPage'), 'MyShelterPage');
const FosterHomesPage = lazyPage(() => import('./pages/FosterHomesPage'), 'FosterHomesPage');
const FosterHomeDetailPage = lazyPage(() => import('./pages/FosterHomeDetailPage'), 'FosterHomeDetailPage');
const RegisterFosterHomePage = lazyPage(() => import('./pages/RegisterFosterHomePage'), 'RegisterFosterHomePage');
const MyFosterHomePage = lazyPage(() => import('./pages/MyFosterHomePage'), 'MyFosterHomePage');
const FosterHomesAdminPage = lazyPage(() => import('./pages/admin/FosterHomesAdminPage'), 'FosterHomesAdminPage');
const VetsAdminPage = lazyPage(() => import('./pages/admin/VetsAdminPage'), 'VetsAdminPage');

// Preserves the :id param when redirecting the legacy foster-home detail path.
function FosterHomeLegacyRedirect() {
  const { id } = useParams();
  return <Navigate to={`/fosterhomes/${id}`} replace />;
}

// The backend builds share URLs as <APP_URL>/share/<token> (share_dto.go), and in
// production a vercel.json rewrite sends that path to the api/share serverless
// function, which serves the OpenGraph preview to crawlers and redirects people to
// /pet/<token>. Vite does not read vercel.json, so under `pnpm dev` the path fell
// through to the SPA, matched nothing, and rendered a blank page — a copied share
// link looked broken locally while working fine in production.
//
// This route is NOT dead code in production, and deleting it would bring the blank
// page back for real users. The edge rewrite normally consumes /share/:token before
// index.html is served, but sw.js is network-first and falls back to the cached
// index.html shell for any request with mode === 'navigate'. So when the network
// fails the rewrite is never reached, the SPA boots at /share/<token>, and this is
// the route that rescues it — measured in a browser with the service worker
// controlling and the network off.
//
// The token is validated instead of forwarded raw, and the check mirrors the one
// api/share.js applies before it will touch a token, so the two paths that serve
// /share/<token> agree on malformed input: both send it to the home page.
//
// Forwarding raw was not merely untidy. useParams decodes %2F, so `..%2F..%2Fmap`
// became /pet/../../map and resolved to /map, and `..%2F..%2F%2Fevil.com` resolved
// to /evil.com — no route, blank page, the very thing this route exists to prevent.
// It never left the origin (resolvePath collapses repeated slashes and backslashes,
// `..` normalizes from the root, and pushState throws on a cross-origin URL), so it
// was never a redirect anyone could aim; it was a blank page reachable through the
// fix for blank pages.
const SHARE_TOKEN_RE = /^[a-f0-9]{32}$/;

function ShareLinkRedirect() {
  const { token } = useParams();
  return <Navigate to={token && SHARE_TOKEN_RE.test(token) ? `/pet/${token}` : '/'} replace />;
}

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
          <Route path="/download" element={<DownloadPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />

          {/* Legacy Spanish route redirects → English. Keep old shared/bookmarked
              links working; targets enforce their own auth. */}
          <Route path="/adoptar" element={<Navigate to="/adopt" replace />} />
          <Route path="/hogares" element={<Navigate to="/fosterhomes" replace />} />
          <Route path="/hogares/registrar" element={<Navigate to="/fosterhomes/register" replace />} />
          <Route path="/hogares/mio" element={<Navigate to="/fosterhomes/mine" replace />} />
          <Route path="/hogares/:id" element={<FosterHomeLegacyRedirect />} />
          <Route path="/descargar" element={<Navigate to="/download" replace />} />

          {/* Rutas protegidas (requieren autenticación) */}
          <Route element={<ProtectedRoute />}>
            <Route path="/pets/create" element={<CreatePetPage />} />
            <Route path="/pets/:id/edit" element={<EditPetPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path={MY_PETS_ROUTE} element={<MyPetsPage />} />
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
              <Route path="vets" element={<VetsAdminPage />} />
            </Route>
          </Route>
        </Route>

        {/* Landing page compartida (sin layout) */}
        <Route
          path="/pet/:token"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SharedPetPage />
            </Suspense>
          }
        />
        <Route path="/share/:token" element={<ShareLinkRedirect />} />
      </Routes>
      <InstallPWA />
      <SpeedInsights />
      <Analytics />
    </>
  );
}
