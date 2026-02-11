import { useState, useEffect, createContext, useContext } from 'react';
import api from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('kp_token');
    const target = localStorage.getItem('kp_target');
    const utilisateur = localStorage.getItem('kp_user');

    if (token && target && utilisateur) {
      api.setToken(token);
      // Vérifier la validité du token
      api.get('/api/auth/me')
        .then((data) => {
          const role = data.role || '';
          localStorage.setItem('kp_role', role);
          setUser({ target, utilisateur, role });
          setLoading(false);
        })
        .catch(() => {
          api.logout();
          localStorage.removeItem('kp_role');
          setUser(null);
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (pin, target, utilisateur) => {
    const data = await api.login(pin, target, utilisateur);
    // Fetch role after login
    try {
      const me = await api.get('/api/auth/me');
      localStorage.setItem('kp_role', me.role || '');
      setUser({ target: data.target, utilisateur: data.utilisateur, role: me.role || '' });
    } catch {
      setUser({ target: data.target, utilisateur: data.utilisateur, role: '' });
    }
    return data;
  };

  const switchUser = async (utilisateur) => {
    const data = await api.post('/api/auth/switch-user', { utilisateur });
    api.setToken(data.access_token);
    localStorage.setItem('kp_token', data.access_token);
    localStorage.setItem('kp_user', data.utilisateur);
    // Fetch role for new user
    try {
      const me = await api.get('/api/auth/me');
      localStorage.setItem('kp_role', me.role || '');
      setUser({ target: data.target, utilisateur: data.utilisateur, role: me.role || '' });
    } catch {
      setUser({ target: data.target, utilisateur: data.utilisateur, role: '' });
    }
    return data;
  };

  const logout = () => {
    api.logout();
    localStorage.removeItem('kp_role');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, switchUser, loading, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
