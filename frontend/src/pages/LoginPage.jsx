import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Smartphone, Monitor, Wrench, ArrowLeft, Loader2, Lock } from 'lucide-react';

export default function LoginPage() {
  const { target } = useParams();
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [team] = useState(['Marina', 'Jonathan', 'Tarik', 'Oualid', 'Agent accueil']);
  const [selectedUser, setSelectedUser] = useState('Marina');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef();

  useEffect(() => {
    if (user) {
      navigate(user.target === 'tech' ? '/tech' : '/accueil');
    }
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pin) return;
    setError('');
    setLoading(true);

    try {
      await login(pin, target, selectedUser);
      navigate(target === 'tech' ? '/tech' : '/accueil');
    } catch (err) {
      setError(err.message || 'PIN incorrect');
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  const isAccueil = target === 'accueil';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Back */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-300 mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl shadow-black/20 p-8 animate-in">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${
              isAccueil ? 'bg-sky-50' : 'bg-violet-50'
            }`}>
              {isAccueil
                ? <Monitor className="w-8 h-8 text-sky-600" />
                : <Wrench className="w-8 h-8 text-violet-600" />
              }
            </div>
          </div>

          <h1 className="text-xl font-bold text-center text-slate-900 mb-1">
            {isAccueil ? 'Espace Accueil' : 'Espace Technicien'}
          </h1>
          <p className="text-sm text-slate-400 text-center mb-6">Entrez votre PIN pour continuer</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* User select */}
            <div>
              <label className="input-label">Utilisateur</label>
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="input"
              >
                {team.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            {/* PIN */}
            <div>
              <label className="input-label">Code PIN</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  ref={inputRef}
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="\u2022\u2022\u2022\u2022"
                  className="input pl-10 text-center text-xl tracking-[0.4em] font-bold"
                  maxLength={6}
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-600 font-medium text-center animate-in">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !pin}
              className={`w-full btn text-white shadow-lg ${
                isAccueil
                  ? 'bg-sky-500 hover:bg-sky-600 shadow-sky-500/25'
                  : 'bg-violet-500 hover:bg-violet-600 shadow-violet-500/25'
              }`}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Se connecter'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-600 mt-6">
          Klikphone SAV \u2014 Chamb\u00E9ry
        </p>
      </div>
    </div>
  );
}
