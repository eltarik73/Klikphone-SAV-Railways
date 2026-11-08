import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import { ArrowLeft, Loader2, MapPin, Phone, RefreshCw, AlertTriangle } from 'lucide-react';
import LogoK from '../components/LogoK';

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

  // Cases PIN : 56 px, saisie 24 px, anneau brand au focus (contrôle 16 px minimum → pas de zoom iOS)
  const pinCls = `w-14 h-14 text-center text-2xl font-semibold rounded-md border border-slate-200 bg-white text-slate-900
    hover:border-slate-300 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40 transition-colors duration-150`;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-6 sm:p-6 bg-slate-50">
      <div className="w-full max-w-[400px]">
        <button type="button" onClick={() => isSwitchMode ? navigate(-1) : navigate('/')}
          className="btn-ghost min-h-11 -ml-3 mb-4 text-slate-600">
          <ArrowLeft aria-hidden="true" /> Retour
        </button>

        <div className="card p-6 sm:p-8">
          {/* Logo : « K » en aplat brand-600 (le PNG est un dégradé) */}
          <div className="flex justify-center mb-5">
            <LogoK className="w-14 h-14" label="Klikphone" />
          </div>

          <h1 className="t-h1 text-center mb-1">
            {isSwitchMode ? "Changer d'utilisateur" : isAccueil ? 'Espace Accueil' : 'Espace Technicien'}
          </h1>
          <p className="text-sm text-slate-500 text-center mb-6 sm:mb-8">
            {isSwitchMode ? 'Sélectionnez votre profil' : 'Entrez votre PIN pour continuer'}
          </p>

          {isSwitchMode ? (
            /* ─── Switch mode: user selector only ─── */
            <div className="space-y-5">
              <div>
                <label className="input-label" htmlFor="login-user">Utilisateur</label>
                {teamLoading ? (
                  <div className="input flex items-center justify-center" role="status" aria-label="Chargement de l'équipe">
                    <Loader2 className="w-4 h-4 animate-spin text-slate-500" aria-hidden="true" />
                  </div>
                ) : (
                  <select id="login-user" value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className="select">
                    {team.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                )}
              </div>

              {error && (
                <div role="alert" className="callout callout-danger">
                  <AlertTriangle aria-hidden="true" />
                  <span className="font-medium">{error}</span>
                </div>
              )}

              <button type="button" onClick={handleSwitchUser} disabled={loading || !selectedUser}
                className="btn-primary btn-lg btn-block">
                {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <><RefreshCw aria-hidden="true" /> Continuer</>}
              </button>
            </div>
          ) : (
            /* ─── Normal login mode ─── */
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="input-label" htmlFor="login-user">Utilisateur</label>
                {teamLoading ? (
                  <div className="input flex items-center justify-center" role="status" aria-label="Chargement de l'équipe">
                    <Loader2 className="w-4 h-4 animate-spin text-slate-500" aria-hidden="true" />
                  </div>
                ) : (
                  <select id="login-user" value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className="select">
                    {team.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                )}
              </div>

              <div>
                <span className="input-label" id="login-pin-label">Code PIN</span>
                <div className="flex gap-3 justify-center" role="group" aria-labelledby="login-pin-label">
                  {digits.map((d, i) => (
                    <input key={i} ref={refs[i]} type="password" inputMode="numeric" maxLength={1}
                      aria-label={`Chiffre ${i + 1} sur 4`} autoComplete="off"
                      value={d}
                      onChange={e => handleDigit(i, e.target.value)}
                      onKeyDown={e => handleKeyDown(i, e)}
                      className={pinCls}
                    />
                  ))}
                </div>
              </div>

              {error && (
                <div role="alert" className="callout callout-danger">
                  <AlertTriangle aria-hidden="true" />
                  <span className="font-medium">{error}</span>
                </div>
              )}

              <button type="submit" disabled={loading || digits.some(d => !d)}
                className="btn-primary btn-lg btn-block">
                {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : 'Se connecter'}
              </button>
            </form>
          )}
        </div>

        <div className="text-center text-xs text-slate-500 mt-6 space-y-1">
          <p className="font-medium text-slate-700">Klikphone SAV</p>
          <p className="flex items-center justify-center gap-1.5"><MapPin className="w-4 h-4 text-slate-400" aria-hidden="true" /> 79 Place Saint Léger, Chambéry</p>
          <p className="flex items-center justify-center gap-1.5"><Phone className="w-4 h-4 text-slate-400" aria-hidden="true" /> 04 79 60 89 22</p>
        </div>
      </div>
    </div>
  );
}
