import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { SettingsProvider } from './hooks/useSettings';
import Navbar from './components/Navbar';
import { ToastProvider } from './components/Toast';
import ChatWidget from './components/ChatWidget';

import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import SuiviPage from './pages/SuiviPage';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const TicketDetailPage = lazy(() => import('./pages/TicketDetailPage'));
const ClientFormPage = lazy(() => import('./pages/ClientFormPage'));
const ClientsPage = lazy(() => import('./pages/ClientsPage'));
const CommandesPage = lazy(() => import('./pages/CommandesPage'));
const AttestationPage = lazy(() => import('./pages/AttestationPage'));
const ConfigPage = lazy(() => import('./pages/ConfigPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const TarifsPage = lazy(() => import('./pages/TarifsPage'));
const DepotPage = lazy(() => import('./pages/DepotPage'));
const AvisGooglePage = lazy(() => import('./pages/AvisGoogle'));
const CommunityManagerPage = lazy(() => import('./pages/CommunityManager'));
const TarifsTelephonesPage = lazy(() => import('./pages/TarifsTelephonesPage'));
const DevisPage = lazy(() => import('./pages/DevisPage'));
const DevisFlashPage = lazy(() => import('./pages/DevisFlashPage'));
const TelephonesVentePage = lazy(() => import('./pages/TelephonesVentePage'));
const DeposerPage = lazy(() => import('./pages/DeposerPage'));

// Preload frequent pages after initial render
const preloadPages = () => {
  import('./pages/DashboardPage');
  import('./pages/TarifsPage');
  import('./pages/ClientsPage');
};
if (typeof window !== 'undefined') {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(preloadPages);
  } else {
    setTimeout(preloadPages, 2000);
  }
}

function ProtectedRoute({ children, allowedTargets }) {
  const { user, loading } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('kp_sidebar_collapsed') === '1'
  );

  useEffect(() => {
    const handler = (e) => setSidebarCollapsed(e.detail.collapsed);
    window.addEventListener('sidebar-toggle', handler);
    return () => window.removeEventListener('sidebar-toggle', handler);
  }, []);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-400 font-medium">Chargement...</p>
      </div>
    </div>
  );

  if (!user) return <Navigate to="/" replace />;
  if (allowedTargets && !allowedTargets.includes(user.target)) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main className={`pt-14 lg:pt-0 min-h-screen transition-all duration-300 ${sidebarCollapsed ? 'lg:pl-[68px]' : 'lg:pl-64'}`}>
        {children}
      </main>
    </div>
  );
}

const P = ({ children, targets }) => <ProtectedRoute allowedTargets={targets}>{children}</ProtectedRoute>;

function AdminGuard({ children }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  useEffect(() => {
    if (localStorage.getItem('klikphone_admin') !== 'true') {
      navigate(`/${user?.target || 'accueil'}`, { replace: true });
    }
  }, []);
  if (localStorage.getItem('klikphone_admin') !== 'true') return null;
  return children;
}

const AG = ({ children, targets }) => <P targets={targets}><AdminGuard>{children}</AdminGuard></P>;

function ChatOverlay() {
  const { user } = useAuth();
  if (!user) return null;
  return <ChatWidget />;
}

const LazyFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50">
    <div className="w-6 h-6 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
  </div>
);

function AppRoutes() {
  return (
    <Suspense fallback={<LazyFallback />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login/:target" element={<LoginPage />} />
        <Route path="/client" element={<ClientFormPage />} />
        <Route path="/depot" element={<DepotPage />} />
        <Route path="/suivi" element={<SuiviPage />} />
        <Route path="/deposer" element={<DeposerPage />} />

        <Route path="/accueil" element={<P targets={['accueil']}><DashboardPage /></P>} />
        <Route path="/accueil/ticket/:id" element={<P targets={['accueil']}><TicketDetailPage /></P>} />
        <Route path="/accueil/clients" element={<P targets={['accueil']}><ClientsPage /></P>} />
        <Route path="/accueil/commandes" element={<P targets={['accueil']}><CommandesPage /></P>} />
        <Route path="/accueil/attestation" element={<P targets={['accueil']}><AttestationPage /></P>} />
        <Route path="/accueil/tarifs" element={<P targets={['accueil']}><TarifsPage /></P>} />
        <Route path="/accueil/tarifs-telephones" element={<P targets={['accueil']}><TarifsTelephonesPage /></P>} />
        <Route path="/accueil/devis" element={<P targets={['accueil']}><DevisPage /></P>} />
        <Route path="/accueil/devis-flash" element={<P targets={['accueil']}><DevisFlashPage /></P>} />
        <Route path="/accueil/telephones-vente" element={<P targets={['accueil']}><TelephonesVentePage /></P>} />
        <Route path="/accueil/config" element={<AG targets={['accueil']}><ConfigPage /></AG>} />
        <Route path="/accueil/avis-google" element={<AG targets={['accueil']}><AvisGooglePage /></AG>} />
        <Route path="/accueil/community" element={<AG targets={['accueil']}><CommunityManagerPage /></AG>} />
        <Route path="/accueil/admin" element={<AG targets={['accueil']}><AdminPage /></AG>} />

        <Route path="/tech" element={<P targets={['tech']}><DashboardPage /></P>} />
        <Route path="/tech/ticket/:id" element={<P targets={['tech']}><TicketDetailPage /></P>} />
        <Route path="/tech/clients" element={<P targets={['tech']}><ClientsPage /></P>} />
        <Route path="/tech/commandes" element={<P targets={['tech']}><CommandesPage /></P>} />
        <Route path="/tech/attestation" element={<P targets={['tech']}><AttestationPage /></P>} />
        <Route path="/tech/tarifs" element={<P targets={['tech']}><TarifsPage /></P>} />
        <Route path="/tech/tarifs-telephones" element={<P targets={['tech']}><TarifsTelephonesPage /></P>} />
        <Route path="/tech/devis" element={<P targets={['tech']}><DevisPage /></P>} />
        <Route path="/tech/devis-flash" element={<P targets={['tech']}><DevisFlashPage /></P>} />
        <Route path="/tech/telephones-vente" element={<P targets={['tech']}><TelephonesVentePage /></P>} />
        <Route path="/tech/config" element={<AG targets={['tech']}><ConfigPage /></AG>} />
        <Route path="/tech/avis-google" element={<AG targets={['tech']}><AvisGooglePage /></AG>} />
        <Route path="/tech/community" element={<AG targets={['tech']}><CommunityManagerPage /></AG>} />
        <Route path="/tech/admin" element={<AG targets={['tech']}><AdminPage /></AG>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ChatOverlay />
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SettingsProvider>
        <AuthProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AuthProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}
