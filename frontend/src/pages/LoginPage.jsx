import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import { Monitor, Wrench, ArrowLeft, Loader2, Lock, MapPin, Phone } from 'lucide-react';

export default function LoginPage() {
  const { target } = useParams();
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [digits, setDigits] = useState(['', '', '', '']);
  const [team, setTeam] = useState([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const refs = [useRef(), useRef(), useRef(), useRef()];

  useEffect(() => {
    if (user) navigate(user.target === 'tech' ? '/tech' : '/accueil');
  }, [user]);

  useEffect(() => { refs[0].current?.focus(); }, []);

  // Load team from API
  useEffect(() => {
    api.getActiveTeam()
      .then(members => {
        const names = members.map(m => m.nom.trim());
        setTeam(names);
        if (names.length > 0) setSelectedUser(names[0]);
      })
      .catch(() => {
        setTeam(['Utilisateur']);
        setSelectedUser('Utilisateur');
      })
      .finally(() => setTeamLoading(false));
  }, []);

  const handleDigit = (idx, val) => {
    if (!/^\d?$/.test(val)) return;
    const next = [...digits];
    next[idx] = val;
    setDigits(next);
    if (val && idx < 3) refs[idx + 1].current?.focus();
  };

  const handleKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      refs[idx - 1].current?.focus();
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    const pin = digits.join('');
    if (pin.length < 4) return;
    setError('');
    setLoading(true);
    try {
      await login(pin, target, selectedUser);
      navigate(target === 'tech' ? '/tech' : '/accueil');
    } catch (err) {
      setError(err.message || 'PIN incorrect');
      setDigits(['', '', '', '']);
      refs[0].current?.focus();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (digits.every(d => d !== '')) handleSubmit();
  }, [digits]);

  const isAccueil = target === 'accueil';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #F5F3FF 0%, #FFFFFF 40%, #F8FAFC 100%)' }}>
      {/* Decorative background elements */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-brand-200/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-72 h-72 bg-brand-300/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

      <div className="w-full max-w-md relative z-10">
        <button onClick={() => navigate('/')}
          className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-600 mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>

        <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-2xl shadow-brand-600/5 p-8 border border-white/60 animate-in">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <img src="/logo_k.png" alt="Klikphone"
              className="w-24 h-24 rounded-2xl object-contain shadow-lg shadow-brand-600/10"
            />
          </div>

          <h1 className="text-xl font-display font-bold text-center text-slate-900 mb-1">
            {isAccueil ? 'Espace Accueil' : 'Espace Technicien'}
          </h1>
          <p className="text-sm text-slate-400 text-center mb-8">Entrez votre PIN pour continuer</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="input-label">Utilisateur</label>
              {teamLoading ? (
                <div className="input flex items-center justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                </div>
              ) : (
                <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className="input">
                  {team.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              )}
            </div>

            <div>
              <label className="input-label">Code PIN</label>
              <div className="flex gap-3 justify-center">
                {digits.map((d, i) => (
                  <input key={i} ref={refs[i]} type="password" inputMode="numeric" maxLength={1}
                    value={d}
                    onChange={e => handleDigit(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    className="w-14 h-14 text-center text-2xl font-bold rounded-xl border-2 border-slate-200 bg-slate-50/50
                      focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:bg-white outline-none transition-all"
                  />
                ))}
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-600 font-medium text-center animate-in">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading || digits.some(d => !d)}
              className="w-full btn text-white shadow-lg"
              style={{
                background: isAccueil
                  ? 'linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%)'
                  : 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
                boxShadow: isAccueil
                  ? '0 4px 12px rgba(14,165,233,0.25)'
                  : '0 4px 12px rgba(124,58,237,0.25)',
              }}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Se connecter'}
            </button>
          </form>
        </div>

        <div className="text-center text-xs text-slate-400 mt-6 space-y-1">
          <p className="font-medium">Klikphone SAV</p>
          <p className="flex items-center justify-center gap-1.5"><MapPin className="w-3 h-3" /> 79 Place Saint Léger, Chambéry</p>
          <p className="flex items-center justify-center gap-1.5"><Phone className="w-3 h-3" /> 04 79 60 89 22</p>
        </div>
      </div>
    </div>
  );
}
