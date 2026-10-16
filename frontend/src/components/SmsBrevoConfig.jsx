import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';
import { MessageSquare, Loader2, AlertTriangle, Check } from 'lucide-react';

const formatCredits = (n) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/**
 * Réglages des SMS envoyés par le serveur (Brevo), onglet Notifications de la configuration.
 * La clé API reste dans la variable d'environnement BREVO_API_KEY : elle n'est jamais lue ici,
 * seule sa présence est indiquée. L'interrupteur est enregistré tout de suite (élévation admin),
 * l'expéditeur avec le bouton « Enregistrer » de la page.
 */
export default function SmsBrevoConfig({ config, updateConfig, saveParamNow }) {
  const [etat, setEtat] = useState(null);
  const [credits, setCredits] = useState({ chargement: false, valeur: null, erreur: '' });
  const actif = config.SMS_BREVO_ACTIF === '1';

  const chargerCredits = useCallback(async () => {
    setCredits((c) => ({ ...c, chargement: true, erreur: '' }));
    try {
      const res = await api.getSmsCredits();
      setCredits({ chargement: false, valeur: res?.credits ?? null, erreur: '' });
    } catch (err) {
      setCredits({ chargement: false, valeur: null, erreur: err?.message || 'Solde indisponible' });
    }
  }, []);

  useEffect(() => {
    let vivant = true;
    api.getSmsEtat({ fresh: true })
      .then((e) => {
        if (!vivant) return;
        setEtat(e || null);
        if (e?.cle_configuree) chargerCredits();
      })
      .catch(() => { if (vivant) setEtat({ cle_configuree: false, erreur: true }); });
    return () => { vivant = false; };
  }, [chargerCredits]);

  const basculer = async () => {
    const valeur = actif ? '0' : '1';
    await saveParamNow('SMS_BREVO_ACTIF', valeur, valeur === '1'
      ? 'SMS envoyés par le serveur (Brevo)'
      : 'SMS par l’app Messages de l’appareil');
    // Les écrans relisent l'état (cache de 60 s) : on le rafraîchit tout de suite
    api.getSmsEtat({ fresh: true }).then((e) => setEtat(e || null)).catch(() => {});
  };

  const cleAbsente = etat && !etat.cle_configuree;

  return (
    <section className="card p-5" aria-labelledby="cfg-sms-titre">
      <h2 id="cfg-sms-titre" className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-brand-600" aria-hidden="true" /> SMS (Brevo)
      </h2>

      {!etat ? (
        <p className="text-xs text-slate-600 mb-4 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Vérification de la configuration…
        </p>
      ) : cleAbsente ? (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4 flex gap-2" role="status">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-amber-900">
            {etat.erreur
              ? 'État des SMS illisible : vérifiez la connexion au serveur.'
              : <>Clé API Brevo absente du serveur. Ajoutez la variable <code className="font-mono">BREVO_API_KEY</code> dans
                Railway (onglet Variables) : le serveur redémarre et les SMS peuvent alors être activés.</>}
          </p>
        </div>
      ) : (
        <p className="text-xs text-emerald-800 mb-4 flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" aria-hidden="true" /> Clé API Brevo présente sur le serveur (jamais affichée).
        </p>
      )}

      <div className="flex items-center justify-between gap-3 py-2 border-t border-slate-100">
        <div className="min-w-0">
          <p id="cfg-sms-actif" className="text-sm font-medium text-slate-800">Envoyer les SMS depuis le serveur (Brevo)</p>
          <p className="text-xs text-slate-600 mt-0.5">
            Sinon, le bouton SMS ouvre l’app Messages de l’appareil, comme avant. Chaque SMS consomme des crédits Brevo.
          </p>
        </div>
        <button
          type="button"
          onClick={basculer}
          disabled={!etat || (cleAbsente && !actif)}
          role="switch"
          aria-checked={actif}
          aria-labelledby="cfg-sms-actif"
          className="relative shrink-0 inline-flex items-center justify-center w-14 h-11 rounded-full disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <span className={`relative w-11 h-6 rounded-full transition-colors motion-reduce:transition-none ${actif ? 'bg-brand-600' : 'bg-slate-300'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform motion-reduce:transition-none ${actif ? 'translate-x-5' : 'translate-x-0'}`} />
          </span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-100">
        <div>
          <label className="input-label" htmlFor="cfg-sms-expediteur">Expéditeur</label>
          <input
            id="cfg-sms-expediteur"
            value={config.SMS_SENDER || ''}
            onChange={(e) => updateConfig('SMS_SENDER', e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 11))}
            maxLength={11}
            autoComplete="off"
            spellCheck={false}
            className="input font-mono"
            placeholder="KLIKPHONE"
            aria-describedby="cfg-sms-expediteur-aide"
          />
          <p id="cfg-sms-expediteur-aide" className="text-xs text-slate-600 mt-1">
            Nom affiché à la place d’un numéro : 11 lettres ou chiffres, sans espace ni accent.
          </p>
        </div>
        <div>
          <p className="input-label">Solde de crédits SMS</p>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-800 min-w-0" aria-live="polite">
              {cleAbsente ? '—'
                : credits.chargement ? 'Lecture…'
                  : credits.erreur ? <span className="text-red-700 font-medium text-xs">{credits.erreur}</span>
                    : credits.valeur != null ? `${formatCredits(credits.valeur)} crédit${credits.valeur >= 2 ? 's' : ''}`
                      : '—'}
            </p>
            <button
              type="button"
              onClick={chargerCredits}
              disabled={!etat?.cle_configuree || credits.chargement}
              className="btn-secondary min-h-[44px] px-3 text-xs ml-auto shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {credits.chargement ? <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : 'Actualiser'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
