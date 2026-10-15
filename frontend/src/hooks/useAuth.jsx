import { useState, useEffect, createContext, useContext } from 'react';
import api from '../lib/api';
import { clearCache } from './useApi';

const AuthContext = createContext(null);

// Nouvel essai de /api/auth/me après une erreur réseau, 5xx ou timeout (la session est conservée)
const VERIFY_RETRY_MS = [15_000, 30_000, 60_000];

function readStoredSession() {
  try {
    const token = localStorage.getItem('kp_token');
    const target = localStorage.getItem('kp_target');
    const utilisateur = localStorage.getItem('kp_user');
    if (!token || !target || !utilisateur) return null;
    return { token, user: { target, utilisateur, role: localStorage.getItem('kp_role') || '' } };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  // Session reprise tout de suite depuis le stockage : le shell s'affiche et les pages lancent
  // leurs requêtes sans attendre /api/auth/me, vérifié en arrière-plan. Un jeton refusé (401)
  // est traité par l'ApiClient (déconnexion + retour à l'accueil) ; les appels n'exposent rien.
  const [stored] = useState(readStoredSession);
  const [user, setUser] = useState(() => stored?.user ?? null);
  const [verifying, setVerifying] = useState(Boolean(stored));

  useEffect(() => {
    if (!stored) return undefined;
    if (api.token !== stored.token) api.setToken(stored.token);
    let cancelled = false;
    let retryTimer = null;

    const verify = (attempt) => {
      api.get('/api/auth/me', { retries: 0 })
        .then((data) => {
          if (cancelled) return;
          const role = data?.role || '';
          try { localStorage.setItem('kp_role', role); } catch { /* stockage indisponible */ }
          setUser((u) => (u && u.role !== role ? { ...u, role } : u));
          setVerifying(false);
        })
        .catch((err) => {
          if (cancelled) return;
          if (err?.status === 401) {
            try { localStorage.removeItem('kp_role'); } catch { /* stockage indisponible */ }
            clearCache();
            setUser(null);
            setVerifying(false);
            return;
          }
          // Réseau coupé, serveur saturé : ne jamais déconnecter pour autant
          if (attempt < VERIFY_RETRY_MS.length) {
            retryTimer = setTimeout(() => verify(attempt + 1), VERIFY_RETRY_MS[attempt]);
          } else {
            setVerifying(false);
          }
        });
    };
    verify(0);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [stored]);

  const fetchRole = async () => {
    try {
      const me = await api.get('/api/auth/me');
      localStorage.setItem('kp_role', me.role || '');
      return me.role || '';
    } catch {
      return '';
    }
  };

  const login = async (pin, target, utilisateur) => {
    const data = await api.login(pin, target, utilisateur);
    const role = await fetchRole();
    setUser({ target: data.target, utilisateur: data.utilisateur, role });
    return data;
  };

  const switchUser = async (utilisateur) => {
    const data = await api.post('/api/auth/switch-user', { utilisateur });
    api.setToken(data.access_token);
    localStorage.setItem('kp_token', data.access_token);
    localStorage.setItem('kp_user', data.utilisateur);
    const role = await fetchRole();
    setUser({ target: data.target, utilisateur: data.utilisateur, role });
    return data;
  };

  const logout = () => {
    api.logout();
    localStorage.removeItem('kp_role');
    clearCache();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, switchUser, loading: false, verifying, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
