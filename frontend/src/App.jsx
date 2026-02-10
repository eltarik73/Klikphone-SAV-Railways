import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Navbar from './components/Navbar';

// Pages
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import TicketDetailPage from './pages/TicketDetailPage';
import ClientFormPage from './pages/ClientFormPage';
import SuiviPage from './pages/SuiviPage';

function ProtectedRoute({ children, allowedTargets }) {
  const { user, loading } = useAuth();

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
    </div>
  );

  if (!user) return <Navigate to="/" replace />;
  if (allowedTargets && !allowedTargets.includes(user.target)) return <Navigate to="/" replace />;

  return (
    <>
      <Navbar />
      <main>{children}</main>
    </>
  );
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<HomePage />} />
      <Route path="/login/:target" element={<LoginPage />} />
      <Route path="/client" element={<ClientFormPage />} />
      <Route path="/suivi" element={<SuiviPage />} />

      {/* Staff - Accueil */}
      <Route path="/accueil" element={
        <ProtectedRoute allowedTargets={['accueil']}>
          <DashboardPage />
        </ProtectedRoute>
      } />
      <Route path="/accueil/ticket/:id" element={
        <ProtectedRoute allowedTargets={['accueil']}>
          <TicketDetailPage />
        </ProtectedRoute>
      } />

      {/* Technicien */}
      <Route path="/tech" element={
        <ProtectedRoute allowedTargets={['tech']}>
          <DashboardPage />
        </ProtectedRoute>
      } />
      <Route path="/tech/ticket/:id" element={
        <ProtectedRoute allowedTargets={['tech']}>
          <TicketDetailPage />
        </ProtectedRoute>
      } />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
