import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import { Wrench, Monitor, ArrowLeft, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const { target } = useParams(); // "accueil" ou "tech"
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [team, setTeam] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef();

  // Charger la liste de l'équipe
  useEffect(() => {
    // Pour l'instant on utilise une liste statique (sera dynamique après login)
    const defaultTeam = [
      'Marina', 'Jonathan', 'Tarik', 'Oualid', 'Agent accueil',
    ];
    setTeam(defaultTeam);
    setSelectedUser(defaultTeam[0]);
  }, []);

  // Rediriger si déjà connecté
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-brand-50/30 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Retour */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>

        {/* Card */}
        <div className="card p-8">
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

          <h1 className="text-xl font-bold text-center mb-1">
            {isAccueil ? 'Espace Accueil' : 'Espace Technicien'}
          </h1>
          <p className="text-sm text-gray-400 text-center mb-6">Entrez votre PIN pour continuer</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Sélection utilisateur */}
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
              <input
                ref={inputRef}
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className="input text-center text-2xl tracking-[0.5em] font-bold"
                maxLength={6}
                autoFocus
              />
            </div>

            {error && (
              <p className="text-sm text-rose-500 text-center font-medium animate-in">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !pin}
              className={`w-full btn text-white shadow-sm ${
                isAccueil
                  ? 'bg-sky-500 hover:bg-sky-600'
                  : 'bg-violet-500 hover:bg-violet-600'
              }`}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Se connecter'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
