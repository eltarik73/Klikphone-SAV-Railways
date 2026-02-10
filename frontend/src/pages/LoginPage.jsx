import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Smartphone, Monitor, Wrench, ArrowLeft, Loader2, Lock } from 'lucide-react';

export default function LoginPage() {
  const { target } = useParams();
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [digits, setDigits] = useState(['', '', '', '']);
  const [team] = useState(['Marina', 'Jonathan', 'Tarik', 'Oualid', 'Agent accueil']);
  const [selectedUser, setSelectedUser] = useState('Marina');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const refs = [useRef(), useRef(), useRef(), useRef()];

  useEffect(() => {
    if (user) navigate(user.target === 'tech' ? '/tech' : '/accueil');
  }, [user]);

  useEffect(() => { refs[0].current?.focus(); }, []);

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
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-slate-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <button onClick={() => navigate('/')}
          className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-600 mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>

        <div className="bg-white rounded-2xl shadow-2xl shadow-brand-600/5 p-8 border border-slate-100 animate-in">
          <div className="flex justify-center mb-6">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg ${
              isAccueil ? 'bg-sky-500 shadow-sky-500/25' : 'bg-brand-600 shadow-brand-600/25'
            }`}>
              {isAccueil
                ? <Monitor className="w-8 h-8 text-white" />
                : <Wrench className="w-8 h-8 text-white" />
              }
            </div>
          </div>

          <h1 className="text-xl font-display font-bold text-center text-slate-900 mb-1">
            {isAccueil ? 'Espace Accueil' : 'Espace Technicien'}
          </h1>
          <p className="text-sm text-slate-400 text-center mb-8">Entrez votre PIN pour continuer</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="input-label">Utilisateur</label>
              <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className="input">
                {team.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>

            <div>
              <label className="input-label">Code PIN</label>
              <div className="flex gap-3 justify-center">
                {digits.map((d, i) => (
                  <input key={i} ref={refs[i]} type="password" inputMode="numeric" maxLength={1}
                    value={d}
                    onChange={e => handleDigit(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    className="w-14 h-14 text-center text-2xl font-bold rounded-xl border-2 border-slate-200 bg-slate-50
                      focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:bg-white outline-none transition-all"
                  />
                ))}
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-600 font-medium text-center animate-in">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading || digits.some(d => !d)}
              className={`w-full btn text-white shadow-lg ${
                isAccueil
                  ? 'bg-sky-500 hover:bg-sky-600 shadow-sky-500/25'
                  : 'bg-brand-600 hover:bg-brand-700 shadow-brand-600/25'
              }`}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Se connecter'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Klikphone SAV — Chambéry
        </p>
      </div>
    </div>
  );
}
