import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { SettingsProvider } from './hooks/useSettings';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import ScanListener, { QuickScanMount } from './components/ScanListener';
// Bandeau « Nouvelle version disponible » des écrans du personnel (lib/miseAJour.js)
import NouvelleVersion from './components/NouvelleVersion';
import { Lock, ArrowLeft, Home, Loader2 } from 'lucide-react';

// Accueil et suivi client (QR) restent dans le chunk d'entrée : premier affichage sans
// aller-retour réseau de plus. Connexion et shell staff sont chargés à la demande.
import HomePage from './pages/HomePage';
import SuiviPage from './pages/SuiviPage';

const loadLoginPage = () => import('./pages/LoginPage');
const LoginPage = lazy(loadLoginPage);
const loadNavbar = () => import('./components/Navbar');
const Navbar = lazy(loadNavbar);
const loadChatWidget = () => import('./components/ChatWidget');
const ChatWidget = lazy(loadChatWidget);
// Palette de recherche du personnel : hors chunk d'entrée, montée seulement une fois connecté
const SearchPalette = lazy(() => import('./components/SearchPalette'));

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
const TarifsReparationPage = lazy(() => import('./pages/TarifsReparationPage'));
const AdminTarifsIphonePage = lazy(() => import('./pages/AdminTarifsIphonePage'));
const AdminTarifsSmartphonesPage = lazy(() => import('./pages/AdminTarifsSmartphonesPage'));
const DemoDesignPage = lazy(() => import('./pages/DemoDesignPage'));
const AdminSiteTarifsPage = lazy(() => import('./pages/AdminSiteTarifsPage'));
const DemandesCommandesPage = lazy(() => import('./pages/DemandesCommandesPage'));
const ConfidentialitePage = lazy(() => import('./pages/ConfidentialitePage'));
// Prix à revoir (admin) : propositions issues des commandes, modèles sans prix, alias
const ModelesSansPrixPage = lazy(() => import('./pages/ModelesSansPrixPage'));

// Shell et pages staff les plus fréquentes, préchargés au repos UNIQUEMENT pour un utilisateur
// connecté : un client sur /, /suivi ou /deposer ne télécharge aucun chunk réservé au personnel.
// AdminPage (378 kB) et Community/AvisGoogle restent chargées à la demande.
const preloadStaffPages = () => {
  loadNavbar();
  loadChatWidget();
  import('./pages/DashboardPage');
  import('./pages/TicketDetailPage');
  import('./pages/ClientsPage');
};
let staffPreloadScheduled = false;
function scheduleStaffPreload() {
  if (staffPreloadScheduled || typeof window === 'undefined') return;
  staffPreloadScheduled = true;
  if ('requestIdleCallback' in window) window.requestIdleCallback(preloadStaffPages, { timeout: 3000 });
  else setTimeout(preloadStaffPages, 2000);
}

function StaffPreload() {
  const { user } = useAuth();
  useEffect(() => {
    if (user) scheduleStaffPreload();
  }, [user]);
  return null;
}

// Réserve la place de la sidebar (et de la barre mobile) pendant le chargement du shell : pas de saut.
// Squelette aux dimensions réelles de la barre (en-tête 64 px, recherche 44 px, entrées 44 px).
function NavbarPlaceholder({ collapsed }) {
  return (
    <>
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-slate-900 z-40" aria-hidden="true" />
      <div className={`hidden lg:flex flex-col fixed top-0 left-0 bottom-0 bg-slate-900 z-50 border-r border-white/[0.06] ${collapsed ? 'w-[72px]' : 'w-64'}`} aria-hidden="true">
        <div className="h-16 border-b border-white/[0.06] flex items-center px-4 gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 shrink-0" />
          {!collapsed && <div className="h-4 w-28 rounded bg-white/10" />}
        </div>
        <div className="p-2 pt-4 space-y-2">
          <div className={`rounded-lg bg-white/[0.07] ${collapsed ? 'w-11 h-11 mx-auto' : 'h-11'}`} />
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className={`rounded-lg bg-white/[0.04] ${collapsed ? 'w-11 h-11 mx-auto' : 'h-11'}`} />
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Access Denied page (replaces blank page) ──────────────
function AccessDenied() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <div className="card shadow-lg max-w-sm w-full p-6 sm:p-8">
        <div className="empty-state min-h-0 max-h-none py-0 px-0 mb-6">
          <div className="empty-state-icon bg-amber-50 text-amber-700">
            <Lock aria-hidden="true" />
          </div>
          <h2 className="t-h2">Accès restreint</h2>
          <p className="t-body text-slate-500 max-w-sm">
            Cette page nécessite les droits administrateur. Veuillez vous connecter en tant qu'admin depuis le menu.
          </p>
        </div>
        <div className="space-y-2">
          <button type="button" onClick={() => navigate(basePath, { replace: true })} className="btn-primary btn-block">
            <Home aria-hidden="true" /> Retour au dashboard
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary btn-block">
            <ArrowLeft aria-hidden="true" /> Page précédente
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Floating back button (webapp mode) ─────────────────────
// Une page qui a déjà son propre bouton Retour dans son en-tête (`.page-header [aria-label="Retour"]` :
// Demandes de commande, grilles Tarifs iPhones / Smartphones…) n'a pas besoin du bouton flottant,
// qui recouvrait alors inutilement la première colonne (cases à cocher, titres de ligne) sous lg.
function useOwnBackControl(pathname) {
  const [own, setOwn] = useState(false);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
    const main = document.querySelector('main');
    if (!main) { setOwn(false); return undefined; }
    let timer = 0;
    const check = () => {
      timer = 0;
      const el = main.querySelector('.page-header [aria-label="Retour"]');
      setOwn(Boolean(el && el.getClientRects().length > 0));
    };
    const schedule = () => { if (!timer) timer = window.setTimeout(check, 60); };
    check();
    const mo = new MutationObserver(schedule);
    mo.observe(main, { childList: true, subtree: true });
    return () => { mo.disconnect(); if (timer) window.clearTimeout(timer); };
  }, [pathname]);
  return own;
}

function FloatingBackButton() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isWebapp] = useState(() =>
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true
  );
  const pageHasBack = useOwnBackControl(location.pathname);

  if (!user) return null;

  // Don't show on dashboard (root pages)
  const basePath = user.target === 'tech' ? '/tech' : '/accueil';
  const isDashboard = location.pathname === basePath || location.pathname === basePath + '/';
  if (isDashboard || pageHasBack) return null;

  // Only show on mobile or in webapp mode. Disque 44 px translucide (flou d'arrière-plan) : le contenu
  // qu'il survole reste lisible ; `.page` garde pb-24 sous lg pour que la dernière ligne se dégage.
  return (
    <button
      onClick={() => {
        if (window.history.length > 1) {
          navigate(-1);
        } else {
          navigate(basePath, { replace: true });
        }
      }}
      type="button"
      className={`fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-30 w-11 h-11 rounded-full bg-slate-900/70 backdrop-blur-sm text-white shadow-md
        flex items-center justify-center transition-colors duration-150 hover:bg-slate-900
        focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${isWebapp ? '' : 'lg:hidden'}`}
      aria-label="Retour"
    >
      <ArrowLeft className="w-5 h-5" aria-hidden="true" />
    </button>
  );
}

// ─── Protected Route ────────────────────────────────────────
// La session est reprise du stockage dès le premier rendu (useAuth) : pas d'écran d'attente ici
function ProtectedRoute({ children, allowedTargets }) {
  const { user } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('kp_sidebar_collapsed') === '1'
  );

  useEffect(() => {
    const handler = (e) => setSidebarCollapsed(e.detail.collapsed);
    window.addEventListener('sidebar-toggle', handler);
    return () => window.removeEventListener('sidebar-toggle', handler);
  }, []);

  if (!user) return <Navigate to="/" replace />;
  if (allowedTargets && !allowedTargets.includes(user.target)) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-slate-50">
      <Suspense fallback={<NavbarPlaceholder collapsed={sidebarCollapsed} />}>
        <Navbar />
      </Suspense>
      <main className={`pt-14 lg:pt-0 min-h-screen min-w-0 overflow-x-clip transition-[padding] duration-200 motion-reduce:transition-none ${sidebarCollapsed ? 'lg:pl-[72px]' : 'lg:pl-64'}`}>
        <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            {children}
          </Suspense>
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

function SearchOverlay() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <Suspense fallback={null}>
      <SearchPalette />
    </Suspense>
  );
}

function ChatOverlay() {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return null;
  // Écrans staff uniquement : ni pages publiques, ni kiosque (/client, /deposer), ni vitrine
  if (!/^\/(accueil|tech)(\/|$)/.test(location.pathname)) return null;
  return (
    <Suspense fallback={null}>
      <ChatWidget />
    </Suspense>
  );
}

// Loader visible pendant le téléchargement d'une page lazy : sans lui, l'écran
// restait vide plusieurs secondes quand le serveur est chargé (« page blanche »).
// Délai de 150 ms pour éviter le flash quand le chunk est déjà en cache.
function PageLoader({ fullScreen = false }) {
  const [visible, setVisible] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const showId = setTimeout(() => setVisible(true), 150);
    const slowId = setTimeout(() => setSlow(true), 12000);
    return () => { clearTimeout(showId); clearTimeout(slowId); };
  }, []);
  if (!visible) return null;
  // Squelette aux dimensions réelles d'une page de liste (titre 28, tuiles 96, lignes 56) : zéro saut
  return (
    <div role="status" aria-live="polite"
      className={`${fullScreen ? 'min-h-screen bg-slate-50' : 'min-h-[60vh]'} page max-w-[1280px] text-slate-500`}>
      <div className="page-header" aria-hidden="true">
        <div className="space-y-2">
          <div className="skeleton-title" />
          <div className="skeleton-line w-64" />
        </div>
        <div className="skeleton h-10 w-36" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6" aria-hidden="true">
        {[0, 1, 2, 3].map(i => <div key={i} className="skeleton-card" />)}
      </div>
      <div className="card overflow-hidden divide-y divide-slate-100" aria-hidden="true">
        {[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton-row rounded-none" />)}
      </div>
      <div className="flex flex-col items-center gap-3 pt-8">
        <p className="loading-inline">
          <Loader2 className="text-brand-600 motion-reduce:animate-none" aria-hidden="true" />
          <span className="font-medium">Chargement…</span>
        </p>
        {slow && (
          <div className="text-center text-sm max-w-xs">
            <p>Le chargement prend plus de temps que prévu.</p>
            <button type="button" onClick={() => window.location.reload()} className="btn-primary mt-3">
              Recharger
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AppRoutes() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader fullScreen />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login/:target" element={<LoginPage />} />
        <Route path="/client" element={<ClientFormPage />} />
        <Route path="/depot" element={<DepotPage />} />
        <Route path="/suivi" element={<SuiviPage />} />
        <Route path="/deposer" element={<DeposerPage />} />
        <Route path="/confidentialite" element={<ConfidentialitePage />} />
        <Route path="/demo-design" element={<DemoDesignPage />} />
        <Route path="/site-tarifs-iphone" element={<AdminSiteTarifsPage />} />

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
        <Route path="/accueil/tarifs-reparation" element={<P targets={['accueil']}><TarifsReparationPage /></P>} />
        <Route path="/accueil/admin" element={<AG targets={['accueil']}><AdminPage /></AG>} />
        <Route path="/accueil/tarifs-iphone" element={<P targets={['accueil']}><AdminTarifsIphonePage /></P>} />
        <Route path="/accueil/tarifs-smartphones" element={<P targets={['accueil']}><AdminTarifsSmartphonesPage /></P>} />

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
        <Route path="/tech/tarifs-reparation" element={<P targets={['tech']}><TarifsReparationPage /></P>} />
        <Route path="/tech/admin" element={<AG targets={['tech']}><AdminPage /></AG>} />
        <Route path="/tech/tarifs-iphone" element={<P targets={['tech']}><AdminTarifsIphonePage /></P>} />
        <Route path="/tech/tarifs-smartphones" element={<P targets={['tech']}><AdminTarifsSmartphonesPage /></P>} />
        <Route path="/accueil/demandes-commandes" element={<P targets={['accueil']}><DemandesCommandesPage /></P>} />
        <Route path="/tech/demandes-commandes" element={<P targets={['tech']}><DemandesCommandesPage /></P>} />
        <Route path="/accueil/prix-a-revoir" element={<AG targets={['accueil']}><ModelesSansPrixPage /></AG>} />
        <Route path="/tech/prix-a-revoir" element={<AG targets={['tech']}><ModelesSansPrixPage /></AG>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ChatOverlay />
      <NouvelleVersion />
      <StaffPreload />
      <ScanListener />
      <QuickScanMount />
      <SearchOverlay />
      </Suspense>
    </ErrorBoundary>
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
