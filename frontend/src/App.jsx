import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user || user.role !== 'admin') return <Navigate to={`/${user?.target || ''}`} replace />;
  return children;
}

const A = ({ children, targets }) => <P targets={targets}><AdminRoute>{children}</AdminRoute></P>;

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

        <Route path="/accueil" element={<P targets={['accueil']}><DashboardPage /></P>} />
        <Route path="/accueil/ticket/:id" element={<P targets={['accueil']}><TicketDetailPage /></P>} />
        <Route path="/accueil/clients" element={<P targets={['accueil']}><ClientsPage /></P>} />
        <Route path="/accueil/commandes" element={<P targets={['accueil']}><CommandesPage /></P>} />
        <Route path="/accueil/attestation" element={<P targets={['accueil']}><AttestationPage /></P>} />
        <Route path="/accueil/config" element={<P targets={['accueil']}><ConfigPage /></P>} />
        <Route path="/accueil/tarifs" element={<P targets={['accueil']}><TarifsPage /></P>} />
        <Route path="/accueil/tarifs-telephones" element={<P targets={['accueil']}><TarifsTelephonesPage /></P>} />
        <Route path="/accueil/avis-google" element={<A targets={['accueil']}><AvisGooglePage /></A>} />
        <Route path="/accueil/community" element={<A targets={['accueil']}><CommunityManagerPage /></A>} />
        <Route path="/accueil/admin" element={<A targets={['accueil']}><AdminPage /></A>} />

        <Route path="/tech" element={<P targets={['tech']}><DashboardPage /></P>} />
        <Route path="/tech/ticket/:id" element={<P targets={['tech']}><TicketDetailPage /></P>} />
        <Route path="/tech/clients" element={<P targets={['tech']}><ClientsPage /></P>} />
        <Route path="/tech/commandes" element={<P targets={['tech']}><CommandesPage /></P>} />
        <Route path="/tech/attestation" element={<P targets={['tech']}><AttestationPage /></P>} />
        <Route path="/tech/config" element={<P targets={['tech']}><ConfigPage /></P>} />
        <Route path="/tech/tarifs" element={<P targets={['tech']}><TarifsPage /></P>} />
        <Route path="/tech/tarifs-telephones" element={<P targets={['tech']}><TarifsTelephonesPage /></P>} />
        <Route path="/tech/avis-google" element={<A targets={['tech']}><AvisGooglePage /></A>} />
        <Route path="/tech/community" element={<A targets={['tech']}><CommunityManagerPage /></A>} />
        <Route path="/tech/admin" element={<A targets={['tech']}><AdminPage /></A>} />

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
