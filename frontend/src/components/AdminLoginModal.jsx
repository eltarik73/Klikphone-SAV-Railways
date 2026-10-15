import { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import api from '../lib/api';
import { useFocusTrap } from '../hooks/useFocusTrap';

// Mauvais identifiants : 401/403. Verrou anti-essais (429), réseau ou serveur : message du serveur.
function messageRefus(err) {
  if (err?.status === 401 || err?.status === 403) return 'Identifiants incorrects';
  if (err?.status === 429) return err.message || 'Trop d\'essais : réessayez dans quelques minutes.';
  if (!err?.status) return 'Connexion au serveur impossible. Vérifiez le réseau puis réessayez.';
  return err.message || 'Erreur du serveur, réessayez.';
}

export default function AdminLoginModal({ open, onClose, onSuccess }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const formRef = useRef(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (open) {
      setLogin('');
      setPassword('');
      setError('');
      setShowPwd(false);
    }
  }, [open]);

  useFocusTrap(formRef, open, { initialFocus: '#admin-login', onEscape: () => onClose?.() });

  const handleSubmit = async (e) => {
    e?.preventDefault();
    // Un seul essai à la fois : chaque essai compte dans le verrou anti brute-force
    if (!login || !password || busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setError('');
    try {
      await api.verifyAdmin(login, password);
      localStorage.setItem('klikphone_admin', 'true');
      onSuccess();
    } catch (err) {
      setError(messageRefus(err));
      setShake(true);
      setTimeout(() => setShake(false), 400);
    } finally {
      busyRef.current = false;
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
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-login-titre"
        aria-describedby="admin-login-texte"
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
            <Lock style={{ width: 28, height: 28, color: '#F59E0B' }} aria-hidden="true" />
          </div>
        </div>

        {/* Title */}
        <h2 id="admin-login-titre" style={{ color: '#F1F5F9', fontSize: 18, fontWeight: 800, textAlign: 'center', marginBottom: 4 }}>
          Accès Administrateur
        </h2>
        <p id="admin-login-texte" style={{ color: '#94A3B8', fontSize: 13, textAlign: 'center', marginBottom: 20 }}>
          Zone protégée — Identifiez-vous
        </p>

        {/* Error */}
        {error && (
          <div role="alert" style={{
            background: '#EF444420', border: '1px solid #EF444440',
            borderRadius: 8, padding: '8px 12px', marginBottom: 16,
            color: '#FCA5A5', fontSize: 13, textAlign: 'center', fontWeight: 600,
          }}>
            {error}
          </div>
        )}

        {/* Login field */}
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="admin-login" style={{ display: 'block', color: '#94A3B8', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Identifiant
          </label>
          <input
            id="admin-login"
            type="text"
            value={login}
            onChange={(e) => { setLogin(e.target.value); setError(''); }}
            placeholder="admin"
            autoComplete="username"
            style={{
              width: '100%', padding: '10px 14px', minHeight: 44,
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
          <label htmlFor="admin-password" style={{ display: 'block', color: '#94A3B8', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Mot de passe
          </label>
          <div style={{ position: 'relative' }}>
            <input
              id="admin-password"
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              placeholder="••••••••"
              autoComplete="current-password"
              style={{
                width: '100%', padding: '10px 48px 10px 14px', minHeight: 44,
                background: '#0F172A', border: '1px solid #334155', borderRadius: 8,
                color: '#F1F5F9', fontSize: 14, outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => e.target.style.borderColor = '#F59E0B'}
              onBlur={(e) => e.target.style.borderColor = '#334155'}
            />
            <button
              type="button"
              onClick={() => setShowPwd(!showPwd)}
              aria-label="Afficher le mot de passe"
              aria-pressed={showPwd}
              aria-controls="admin-password"
              className="focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded-lg"
              style={{
                position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
                width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#94A3B8',
              }}
            >
              {showPwd
                ? <EyeOff style={{ width: 18, height: 18 }} aria-hidden="true" />
                : <Eye style={{ width: 18, height: 18 }} aria-hidden="true" />
              }
            </button>
          </div>
        </div>

        {/* Submit button */}
        <button
          type="submit"
          disabled={loading || !login || !password}
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-800"
          style={{
            width: '100%', padding: '12px 0', minHeight: 44,
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
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 rounded-lg"
          style={{
            width: '100%', padding: '10px 0', minHeight: 44,
            background: 'none', border: 'none',
            color: '#94A3B8', fontSize: 13, cursor: 'pointer',
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
        @media (prefers-reduced-motion: no-preference) {
          .animate-shake { animation: shake 0.4s ease-in-out; }
        }
      `}</style>
    </div>
  );
}
