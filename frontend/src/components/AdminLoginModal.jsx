import { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import api from '../lib/api';

export default function AdminLoginModal({ open, onClose, onSuccess }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const loginRef = useRef(null);

  useEffect(() => {
    if (open) {
      setLogin('');
      setPassword('');
      setError('');
      setShowPwd(false);
      setTimeout(() => loginRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!login || !password) return;
    setLoading(true);
    setError('');
    try {
      await api.verifyAdmin(login, password);
      localStorage.setItem('klikphone_admin', 'true');
      onSuccess();
    } catch {
      setError('Identifiants incorrects');
      setShake(true);
      setTimeout(() => setShake(false), 400);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className={shake ? 'animate-shake' : ''}
        style={{
          background: '#1E293B',
          border: '1px solid #334155',
          borderRadius: 16,
          padding: '32px 28px',
          width: 360,
          maxWidth: '100%',
          boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
        }}
      >
        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div
            style={{
              width: 56, height: 56, borderRadius: 14,
              background: '#F59E0B20',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Lock style={{ width: 28, height: 28, color: '#F59E0B' }} />
          </div>
        </div>

        {/* Title */}
        <h2 style={{ color: '#F1F5F9', fontSize: 18, fontWeight: 800, textAlign: 'center', marginBottom: 4 }}>
          Accès Administrateur
        </h2>
        <p style={{ color: '#64748B', fontSize: 13, textAlign: 'center', marginBottom: 20 }}>
          Zone protégée — Identifiez-vous
        </p>

        {/* Error */}
        {error && (
          <div style={{
            background: '#EF444420', border: '1px solid #EF444440',
            borderRadius: 8, padding: '8px 12px', marginBottom: 16,
            color: '#EF4444', fontSize: 13, textAlign: 'center', fontWeight: 600,
          }}>
            {error}
          </div>
        )}

        {/* Login field */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', color: '#94A3B8', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Identifiant
          </label>
          <input
            ref={loginRef}
            type="text"
            value={login}
            onChange={(e) => { setLogin(e.target.value); setError(''); }}
            placeholder="admin"
            autoComplete="username"
            style={{
              width: '100%', padding: '10px 14px',
              background: '#0F172A', border: '1px solid #334155', borderRadius: 8,
              color: '#F1F5F9', fontSize: 14, outline: 'none',
              transition: 'border-color 0.2s',
            }}
            onFocus={(e) => e.target.style.borderColor = '#F59E0B'}
            onBlur={(e) => e.target.style.borderColor = '#334155'}
          />
        </div>

        {/* Password field */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', color: '#94A3B8', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Mot de passe
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              placeholder="••••••••"
              autoComplete="current-password"
              style={{
                width: '100%', padding: '10px 42px 10px 14px',
                background: '#0F172A', border: '1px solid #334155', borderRadius: 8,
                color: '#F1F5F9', fontSize: 14, outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => e.target.style.borderColor = '#F59E0B'}
              onBlur={(e) => e.target.style.borderColor = '#334155'}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
            <button
              type="button"
              onClick={() => setShowPwd(!showPwd)}
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                color: '#64748B',
              }}
            >
              {showPwd
                ? <EyeOff style={{ width: 18, height: 18 }} />
                : <Eye style={{ width: 18, height: 18 }} />
              }
            </button>
          </div>
        </div>

        {/* Submit button */}
        <button
          type="submit"
          disabled={loading || !login || !password}
          style={{
            width: '100%', padding: '12px 0',
            background: loading || !login || !password ? '#F59E0B80' : '#F59E0B',
            color: '#000', borderRadius: 10, border: 'none',
            fontSize: 14, fontWeight: 700, cursor: loading ? 'wait' : 'pointer',
            marginBottom: 10,
          }}
        >
          {loading ? 'Vérification...' : 'Se connecter'}
        </button>

        {/* Cancel */}
        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%', padding: '10px 0',
            background: 'none', border: 'none',
            color: '#64748B', fontSize: 13, cursor: 'pointer',
          }}
        >
          Annuler
        </button>
      </form>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </div>
  );
}
