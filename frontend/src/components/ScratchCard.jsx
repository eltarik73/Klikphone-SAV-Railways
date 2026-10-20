import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api';
import { Loader2, Gift, PartyPopper, Smile, Coins, Sparkles, Eye, KeyRound } from 'lucide-react';

// Icône du gain : film verre trempé = cadeau, sinon réduction = pièces
function IconeGain({ gain, className = 'w-5 h-5' }) {
  const Icone = gain === 'film' ? Gift : Coins;
  return <Icone className={`${className} shrink-0`} aria-hidden="true" />;
}

// « Valable pour votre prochaine réparation » : pastille ambre (attention : pas pour celle-ci)
function Validite() {
  return (
    <p className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-800">
      <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>Valable pour votre <strong className="font-bold">prochaine réparation</strong></span>
    </p>
  );
}

// Le grattage exige la preuve du suivi : jeton `t` du lien (dans l'URL) ou 4 derniers chiffres
const cheminGrattage = (code, suffixe = '') => `/api/fidelite/grattage/${encodeURIComponent(code)}${suffixe}`;
const preuveRefusee = (err) => err?.status === 401 || err?.status === 403;

function jetonDuLien() {
  try {
    return new URLSearchParams(window.location.search).get('t') || '';
  } catch {
    return '';
  }
}

function messageErreur(err) {
  if (err?.status === 429) return 'Trop de tentatives. Réessayez dans quelques minutes.';
  if (preuveRefusee(err)) return 'Ces 4 chiffres ne correspondent pas au numéro de téléphone du dossier.';
  return err?.message || 'Une erreur est survenue, réessayez.';
}

export default function ScratchCard({ ticketCode }) {
  const canvasRef = useRef(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isScratching, setIsScratching] = useState(false);
  const [frequence, setFrequence] = useState(10);
  const [actif, setActif] = useState(true);
  const [eligible, setEligible] = useState(false);
  // Preuve acceptée par le serveur ({ t } ou { tel4 }) ; null : les 4 chiffres sont demandés
  const [preuve, setPreuve] = useState(null);
  const [tel4, setTel4] = useState('');
  const [erreurPreuve, setErreurPreuve] = useState('');
  const [verification, setVerification] = useState(false);
  const revealedRef = useRef(false);
  // Lue au moment du grattage : scratch() est mémorisé avant que la preuve soit connue
  const preuveRef = useRef(null);
  preuveRef.current = preuve;

  const appliquerEtat = useCallback((data) => {
    if (!data.actif) {
      setActif(false);
      return;
    }
    setFrequence(data.frequence || 10);
    setEligible(Boolean(data.eligible));
    if (data.deja_gratte) {
      setResult({
        gagnant: !!data.gain,
        gain: data.gain,
        gain_label: data.gain_label,
        deja_gratte: true,
      });
      setIsRevealed(true);
      revealedRef.current = true;
    }
  }, []);

  // État initial : avec le jeton du lien, l'état complet ; sinon actif / éligible seulement
  useEffect(() => {
    if (!ticketCode) return undefined;
    let annule = false;
    const jeton = jetonDuLien();
    const sansPreuve = () => api.get(cheminGrattage(ticketCode));
    const charger = jeton
      ? api.get(`${cheminGrattage(ticketCode)}?t=${encodeURIComponent(jeton)}`)
        .then((data) => ({ data, preuve: { t: jeton } }))
        .catch((err) => (preuveRefusee(err) ? sansPreuve().then((data) => ({ data, preuve: null })) : Promise.reject(err)))
      : sansPreuve().then((data) => ({ data, preuve: null }));
    charger
      .then(({ data, preuve: p }) => {
        if (annule) return;
        appliquerEtat(data);
        setPreuve(p);
      })
      .catch(() => { if (!annule) setActif(false); })
      .finally(() => { if (!annule) setLoading(false); });
    return () => { annule = true; };
  }, [ticketCode, appliquerEtat]);

  const verifierTel4 = async (e) => {
    e?.preventDefault();
    if (verification) return;
    const chiffres = tel4.replace(/\D/g, '');
    if (chiffres.length !== 4) {
      setErreurPreuve('Saisissez les 4 derniers chiffres de votre numéro.');
      return;
    }
    setVerification(true);
    setErreurPreuve('');
    try {
      const data = await api.post(cheminGrattage(ticketCode, '/etat'), { tel4: chiffres });
      appliquerEtat(data);
      setPreuve({ tel4: chiffres });
    } catch (err) {
      setErreurPreuve(messageErreur(err));
    } finally {
      setVerification(false);
    }
  };

  // Initialize canvas
  useEffect(() => {
    if (loading || isRevealed || !actif || !preuve) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return; // navigateur sans canvas : « Révéler sans gratter » reste disponible

    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#C0C0C0');
    gradient.addColorStop(0.5, '#D4D4D4');
    gradient.addColorStop(1, '#A8A8A8');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Shimmer effect
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(i * 60, 0, 20, canvas.height);
    }

    ctx.fillStyle = '#475569';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GRATTEZ ICI', canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Tentez votre chance !', canvas.width / 2, canvas.height / 2 + 15);
  }, [loading, isRevealed, actif, preuve]);

  const scratch = useCallback((e) => {
    if (revealedRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;
    if (clientX == null) return;

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 25, 0, Math.PI * 2);
    ctx.fill();

    // Calculate scratch percentage
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let transparent = 0;
    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i] === 0) transparent++;
    }
    const pct = (transparent / (imageData.data.length / 4)) * 100;

    if (pct > 45 && !revealedRef.current) {
      revealedRef.current = true;
      revealResult();
    }
  }, [ticketCode]);

  const revealResult = async () => {
    const preuve = preuveRef.current;
    setIsRevealed(true);
    try {
      const data = await api.post(cheminGrattage(ticketCode), preuve || {});
      setResult(data);
    } catch (err) {
      if (preuveRefusee(err)) {
        // Preuve plus valable (lien expiré) : les 4 chiffres sont redemandés, rien n'est gratté
        revealedRef.current = false;
        setIsRevealed(false);
        setPreuve(null);
        setErreurPreuve(preuve?.t ? 'Ce lien de suivi n\'est plus valable : confirmez avec votre numéro de téléphone.' : messageErreur(err));
        return;
      }
      setResult({ gagnant: false, error: err.message });
    }
  };

  // Accès clavier / lecteur d'écran : même résultat sans gratter le canvas
  const revelerSansGratter = () => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    revealResult();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6" role="status" aria-label="Chargement">
        <Loader2 className="w-5 h-5 motion-safe:animate-spin text-brand-600" aria-hidden="true" />
      </div>
    );
  }

  if (!actif || !eligible) return null;

  // Already scratched
  if (isRevealed && result?.deja_gratte) {
    return (
      <div className="card card-body text-center">
        <p className="text-sm text-slate-500">Vous avez déjà gratté ce ticket</p>
        {result.gain && (
          <>
            <p className="mt-2 inline-flex items-center justify-center gap-2 text-lg font-bold text-emerald-700">
              <IconeGain gain={result.gain} /> {result.gain_label}
            </p>
            <div><Validite /></div>
          </>
        )}
        {!result.gain && (
          <p className="text-sm text-slate-500 mt-1">Retentez votre chance au prochain passage !</p>
        )}
      </div>
    );
  }

  if (!preuve) {
    return (
      <div className="card card-body text-center">
        <h3 className="text-lg font-semibold leading-snug text-slate-900 mb-1 inline-flex items-center gap-2">
          <Gift className="w-5 h-5 text-brand-600 shrink-0" aria-hidden="true" /> Tentez votre chance !
        </h3>
        <p className="text-sm text-slate-600 mb-4">Confirmez que ce ticket est le vôtre pour gratter</p>
        <form onSubmit={verifierTel4} className="mx-auto w-full max-w-xs text-left" noValidate>
          <label htmlFor="grattage-tel4" className="input-label">4 derniers chiffres de votre téléphone</label>
          <div className="flex gap-2">
            <input
              id="grattage-tel4"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={tel4}
              onChange={(e) => { setTel4(e.target.value.replace(/\D/g, '').slice(0, 4)); setErreurPreuve(''); }}
              aria-invalid={erreurPreuve ? 'true' : undefined}
              aria-describedby={erreurPreuve ? 'grattage-tel4-erreur' : undefined}
              className="input flex-1 min-h-11 tabular-nums"
            />
            <button type="submit" disabled={verification} aria-busy={verification || undefined}
              className="btn-primary min-h-11">
              {verification
                ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
                : <KeyRound aria-hidden="true" />}
              Valider
            </button>
          </div>
          {erreurPreuve && (
            <p id="grattage-tel4-erreur" role="alert" className="input-error text-sm mt-1">{erreurPreuve}</p>
          )}
        </form>
      </div>
    );
  }

  return (
    <div className="card card-body text-center">
      <h3 className="text-lg font-semibold leading-snug text-slate-900 mb-1 inline-flex items-center gap-2">
        <Gift className="w-5 h-5 text-brand-600 shrink-0" aria-hidden="true" /> Tentez votre chance !
      </h3>
      <p className="text-sm text-slate-500 mb-4">Grattez pour découvrir si vous avez gagné</p>

      <div className="relative inline-block mx-auto max-w-full rounded-xl overflow-hidden bg-slate-100" style={{ width: 280, height: 140 }}>
        {/* Hidden content */}
        <div role="status" aria-live="polite" className={`absolute inset-0 flex items-center justify-center ${
          isRevealed && result?.gagnant ? 'bg-brand-600 text-white' : 'bg-slate-100'
        }`}>
          {isRevealed && result ? (
            result.error ? (
              <div className="text-sm font-semibold text-slate-700 px-4">Grattage indisponible</div>
            ) : result.gagnant ? (
              <div className="text-center motion-safe:animate-[bounceIn_0.5s_ease-out]">
                <PartyPopper className="w-9 h-9 mx-auto mb-1" aria-hidden="true" />
                <div className="text-lg font-extrabold">GAGNÉ !</div>
                <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/90">
                  <IconeGain gain={result.gain} className="w-4 h-4" /> {result.gain_label}
                </div>
              </div>
            ) : (
              <div className="text-center">
                <Smile className="w-8 h-8 mx-auto mb-1 text-slate-500" aria-hidden="true" />
                <div className="text-sm font-semibold text-slate-700">Pas cette fois !</div>
                <div className="text-xs text-slate-500">Retentez au prochain passage</div>
              </div>
            )
          ) : isRevealed ? (
            <Loader2 className="w-5 h-5 motion-safe:animate-spin text-brand-600" aria-label="Grattage en cours" />
          ) : (
            <div className="text-sm text-slate-500" aria-hidden="true">?</div>
          )}
        </div>

        {/* Scratch canvas */}
        {!isRevealed && (
          <canvas
            ref={canvasRef}
            width={280}
            height={140}
            className="absolute inset-0 cursor-pointer"
            style={{ touchAction: 'none' }}
            aria-hidden="true"
            onMouseDown={() => setIsScratching(true)}
            onMouseUp={() => setIsScratching(false)}
            onMouseLeave={() => setIsScratching(false)}
            onMouseMove={(e) => isScratching && scratch(e)}
            onTouchStart={() => setIsScratching(true)}
            onTouchEnd={() => setIsScratching(false)}
            onTouchMove={(e) => scratch(e)}
          />
        )}
      </div>

      {!isRevealed && (
        <div>
          <button type="button" onClick={revelerSansGratter} className="btn-secondary min-h-11 mt-3">
            <Eye aria-hidden="true" /> Révéler sans gratter
          </button>
        </div>
      )}

      {isRevealed && result?.error && (
        <p role="alert" className="input-error text-sm mt-3">{result.error}</p>
      )}

      {isRevealed && result?.gagnant && (
        <div><Validite /></div>
      )}

      <p className="t-caption mt-3">
        1 chance sur {frequence} de gagner un film verre trempé ou une réduction
      </p>

      <style>{`
        @keyframes bounceIn {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.05); }
          70% { transform: scale(0.9); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
