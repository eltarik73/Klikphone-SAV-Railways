import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import { Monitor, Wrench, ArrowLeft, Loader2, Lock, MapPin, Phone, RefreshCw } from 'lucide-react';

export default function LoginPage() {
  const { target } = useParams();
  const [searchParams] = useSearchParams();
  const isSwitchMode = searchParams.get('switch') === '1';
  const { login, switchUser, user } = useAuth();
  const navigate = useNavigate();
  const [digits, setDigits] = useState(['', '', '', '']);
  const [team, setTeam] = useState([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const refs = [useRef(), useRef(), useRef(), useRef()];

  // If already logged in and NOT in switch mode, redirect
  useEffect(() => {
    if (user && !isSwitchMode) navigate(user.target === 'tech' ? '/tech' : '/accueil');
  }, [user, isSwitchMode]);

  useEffect(() => {
    if (!isSwitchMode) refs[0].current?.focus();
  }, [isSwitchMode]);

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

  const handleSwitchUser = async () => {
    if (!selectedUser) return;
    setError('');
    setLoading(true);
    try {
      await switchUser(selectedUser);
      navigate(target === 'tech' ? '/tech' : '/accueil');
    } catch (err) {
      setError(err.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isSwitchMode && digits.every(d => d !== '')) handleSubmit();
  }, [digits]);

  const isAccueil = target === 'accueil';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-md">
        <button onClick={() => isSwitchMode ? navigate(-1) : navigate('/')}
          className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-600 mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-8 animate-in">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 rounded-2xl bg-white border border-slate-100 p-1.5 overflow-hidden">
              <img src="/logo_k.png" alt="Klikphone" className="w-full h-full object-contain" />
            </div>
          </div>

          <h1 className="text-xl font-display font-bold text-center text-slate-900 mb-1">
            {isSwitchMode ? "Changer d'utilisateur" : (isAccueil ? 'Espace Accueil' : 'Espace Technicien')}
          </h1>
          <p className="text-sm text-slate-400 text-center mb-8">
            {isSwitchMode ? 'Sélectionnez votre profil' : 'Entrez votre PIN pour continuer'}
          </p>

          {isSwitchMode ? (
            /* ─── Switch mode: user selector only ─── */
            <div className="space-y-5">
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

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-600 font-medium text-center animate-in">
                  {error}
                </div>
              )}

              <button onClick={handleSwitchUser} disabled={loading || !selectedUser}
                className={`w-full btn text-white shadow-sm ${
                  isAccueil ? 'bg-sky-500 hover:bg-sky-600' : 'bg-brand-600 hover:bg-brand-700'
                }`}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><RefreshCw className="w-4 h-4" /> Continuer</>}
              </button>
            </div>
          ) : (
            /* ─── Normal login mode ─── */
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
                className={`w-full btn text-white shadow-sm ${
                  isAccueil ? 'bg-sky-500 hover:bg-sky-600' : 'bg-brand-600 hover:bg-brand-700'
                }`}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Se connecter'}
              </button>
            </form>
          )}
        </div>

        <div className="text-center text-xs text-slate-400 mt-6 space-y-1">
          <p className="font-medium">Klikphone SAV</p>
          <p className="flex items-center justify-center gap-1.5"><MapPin className="w-3 h-3" /> 79 Place Saint Léger, Chambéry</p>
          <p className="flex items-center justify-center gap-1.5"><Phone className="w-3 h-3" /> 04 79 60 89 22</p>
          <p className="text-[10px] text-zinc-400 pt-2">Propulsé par tKs26 — une solution Klik&Dev</p>
        </div>
      </div>
    </div>
  );
}
