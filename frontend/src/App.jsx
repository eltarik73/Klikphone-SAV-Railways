import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { SettingsProvider } from './hooks/useSettings';
import Navbar from './components/Navbar';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import ChatWidget from './components/ChatWidget';
import { ShieldX, ArrowLeft, RefreshCw, Home } from 'lucide-react';

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

// ─── Access Denied page (replaces blank page) ──────────────
function AccessDenied() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 max-w-sm w-full p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-5">
          <ShieldX className="w-7 h-7 text-amber-500" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-2">Accès restreint</h2>
        <p className="text-sm text-slate-500 mb-6">
          Cette page nécessite les droits administrateur. Veuillez vous connecter en tant qu'admin depuis le menu.
        </p>
        <div className="space-y-2">
          <button onClick={() => navigate(basePath, { replace: true })}
            className="w-full py-3 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2">
            <Home className="w-4 h-4" /> Retour au dashboard
          </button>
          <button onClick={() => navigate(-1)}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium transition-colors flex items-center justify-center gap-2">
            <ArrowLeft className="w-4 h-4" /> Page précédente
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Floating back button (webapp mode) ─────────────────────
function FloatingBackButton() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isWebapp] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );

  if (!user) return null;

  // Don't show on dashboard (root pages)
  const basePath = user.target === 'tech' ? '/tech' : '/accueil';
  const isDashboard = location.pathname === basePath || location.pathname === basePath + '/';
  if (isDashboard) return null;

  // Only show on mobile or in webapp mode
  return (
    <button
      onClick={() => {
        if (window.history.length > 1) {
          navigate(-1);
        } else {
          navigate(basePath, { replace: true });
        }
      }}
      className={`fixed bottom-4 left-4 z-30 w-11 h-11 rounded-full bg-slate-900/80 backdrop-blur-sm text-white shadow-lg flex items-center justify-center active:scale-90 transition-transform ${isWebapp ? '' : 'lg:hidden'}`}
      aria-label="Retour"
    >
      <ArrowLeft className="w-5 h-5" />
    </button>
  );
}

// ─── Protected Route ────────────────────────────────────────
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
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </main>
      <FloatingBackButton />
    </div>
  );
}

const P = ({ children, targets }) => <ProtectedRoute allowedTargets={targets}>{children}</ProtectedRoute>;

function AdminGuard({ children }) {
  const { user } = useAuth();
  if (localStorage.getItem('klikphone_admin') !== 'true') {
    return <AccessDenied />;
  }
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
            <ErrorBoundary>
              <AppRoutes />
            </ErrorBoundary>
          </ToastProvider>
        </AuthProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}
