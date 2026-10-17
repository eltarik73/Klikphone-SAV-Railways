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
      className="modal-overlay z-[60] items-center p-4"
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
        className={`modal sm:max-w-[400px] rounded-xl p-6 sm:p-8 ${shake ? 'animate-shake' : ''}`}
      >
        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
            <Lock className="w-7 h-7" aria-hidden="true" />
          </div>
        </div>

        {/* Title */}
        <h2 id="admin-login-titre" className="t-h2 text-center mb-1">
          Accès Administrateur
        </h2>
        <p id="admin-login-texte" className="text-sm text-slate-500 text-center mb-5">
          Zone protégée — Identifiez-vous
        </p>

        {/* Error */}
        {error && (
          <div role="alert" className="callout callout-danger justify-center font-medium mb-4">
            {error}
          </div>
        )}

        {/* Login field */}
        <div className="mb-3">
          <label htmlFor="admin-login" className="input-label">
            Identifiant
          </label>
          <input
            id="admin-login"
            type="text"
            value={login}
            onChange={(e) => { setLogin(e.target.value); setError(''); }}
            placeholder="admin"
            autoComplete="username"
            className="input"
          />
        </div>

        {/* Password field */}
        <div className="mb-5">
          <label htmlFor="admin-password" className="input-label">
            Mot de passe
          </label>
          <div className="relative">
            <input
              id="admin-password"
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              placeholder="••••••••"
              autoComplete="current-password"
              className="input pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPwd(!showPwd)}
              aria-label="Afficher le mot de passe"
              aria-pressed={showPwd}
              aria-controls="admin-password"
              className="btn-ghost btn-icon absolute right-0 top-1/2 -translate-y-1/2 text-slate-500"
            >
              {showPwd
                ? <EyeOff aria-hidden="true" />
                : <Eye aria-hidden="true" />
              }
            </button>
          </div>
        </div>

        {/* Submit button */}
        <button
          type="submit"
          disabled={loading || !login || !password}
          className={`btn-primary btn-lg btn-block mb-2 ${loading ? 'cursor-wait' : ''}`}
        >
          {loading ? 'Vérification...' : 'Se connecter'}
        </button>

        {/* Cancel */}
        <button
          type="button"
          onClick={onClose}
          className="btn-ghost btn-block"
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
