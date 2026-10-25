import { useState, useEffect, createContext, useContext } from 'react';
import { useInRouterContext, useLocation } from 'react-router-dom';
import api from '../lib/api';
import { clearCache } from './useApi';
import { appareilClient, lancerPointage, lirePoste } from '../lib/pointage';

const AuthContext = createContext(null);

// Nouvel essai de /api/auth/me après une erreur réseau, 5xx ou timeout (la session est conservée)
const VERIFY_RETRY_MS = [15_000, 30_000, 60_000];

// Détection de l'appareil préparée sur l'écran de connexion du personnel SEULEMENT (/login/…) :
// la connexion n'a plus rien à attendre. Jamais pour un client (accueil public, suivi, borne).
function PreparerAppareil() {
  const surConnexion = useLocation().pathname.startsWith('/login');
  useEffect(() => {
    if (surConnexion) appareilClient({ delaiMs: 0 }).catch(() => null);
  }, [surConnexion]);
  return null;
}

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
  const dansRouteur = useInRouterContext();

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

  // Journal des connexions : chaque connexion par PIN et chaque changement d'utilisateur envoie le
  // nom du poste et l'appareil détecté (attendu 400 ms au plus). Après la connexion, le pointage de
  // présence part en arrière-plan (lib/pointage.lancerPointage : rien si inactif, une fois par session) ;
  // l'arrivée sur le tableau de bord ne l'attend jamais.
  const pointerEnArrierePlan = (token) => {
    setTimeout(() => { lancerPointage(api, token).catch(() => null); }, 0);
  };

  const login = async (pin, target, utilisateur) => {
    const appareil = await appareilClient().catch(() => null);
    const data = await api.login(pin, target, utilisateur, { poste: lirePoste(), appareil });
    const role = await fetchRole();
    setUser({ target: data.target, utilisateur: data.utilisateur, role });
    pointerEnArrierePlan(data.access_token);
    return data;
  };

  const switchUser = async (utilisateur) => {
    // Nouvelle ligne du journal (la session précédente du poste est close « changement »)
    const appareil = await appareilClient().catch(() => null);
    const data = await api.post('/api/auth/switch-user', {
      utilisateur, poste: lirePoste() || undefined, appareil: appareil || undefined,
    });
    api.setToken(data.access_token);
    localStorage.setItem('kp_token', data.access_token);
    localStorage.setItem('kp_user', data.utilisateur);
    const role = await fetchRole();
    setUser({ target: data.target, utilisateur: data.utilisateur, role });
    pointerEnArrierePlan(data.access_token);
    return data;
  };

  // Le serveur clôt la session (journal des connexions) avant que le jeton ne soit oublié ;
  // l'envoi part sans attendre : un réseau coupé n'empêche jamais de se déconnecter.
  const logout = () => {
    try { api.logoutSession?.()?.catch?.(() => null); } catch { /* jamais bloquant */ }
    api.logout();
    localStorage.removeItem('kp_role');
    clearCache();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, switchUser, loading: false, verifying, isAuthenticated: !!user }}>
      {!user && dansRouteur && <PreparerAppareil />}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
