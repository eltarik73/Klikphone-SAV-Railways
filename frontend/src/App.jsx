import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Navbar from './components/Navbar';
import { ToastProvider } from './components/Toast';

import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import TicketDetailPage from './pages/TicketDetailPage';
import ClientFormPage from './pages/ClientFormPage';
import SuiviPage from './pages/SuiviPage';
import ClientsPage from './pages/ClientsPage';
import CommandesPage from './pages/CommandesPage';
import AttestationPage from './pages/AttestationPage';
import ConfigPage from './pages/ConfigPage';
import AdminPage from './pages/AdminPage';
import DepotPage from './pages/DepotPage';

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

function AppRoutes() {
  return (
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
      <Route path="/accueil/admin" element={<P targets={['accueil']}><AdminPage /></P>} />

      <Route path="/tech" element={<P targets={['tech']}><DashboardPage /></P>} />
      <Route path="/tech/ticket/:id" element={<P targets={['tech']}><TicketDetailPage /></P>} />
      <Route path="/tech/clients" element={<P targets={['tech']}><ClientsPage /></P>} />
      <Route path="/tech/commandes" element={<P targets={['tech']}><CommandesPage /></P>} />
      <Route path="/tech/attestation" element={<P targets={['tech']}><AttestationPage /></P>} />
      <Route path="/tech/config" element={<P targets={['tech']}><ConfigPage /></P>} />
      <Route path="/tech/admin" element={<P targets={['tech']}><AdminPage /></P>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
