import { useState, useEffect, createContext, useContext } from 'react';
import api from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restaurer la session depuis localStorage
    const token = localStorage.getItem('kp_token');
    const target = localStorage.getItem('kp_target');
    const utilisateur = localStorage.getItem('kp_user');

    if (token && target && utilisateur) {
      api.setToken(token);
      setUser({ target, utilisateur });
    }
    setLoading(false);
  }, []);

  const login = async (pin, target, utilisateur) => {
    const data = await api.login(pin, target, utilisateur);
    setUser({ target: data.target, utilisateur: data.utilisateur });
    return data;
  };

  const logout = () => {
    api.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
