import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';
import Interrupteur from './Interrupteur';
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
    <section className="card card-body" aria-labelledby="cfg-sms-titre">
      <h2 id="cfg-sms-titre" className="t-h2 mb-4 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-slate-500" aria-hidden="true" /> SMS (Brevo)
      </h2>

      {!etat ? (
        <p className="loading-inline mb-4">
          <Loader2 className="motion-reduce:animate-none" aria-hidden="true" /> Vérification de la configuration…
        </p>
      ) : cleAbsente ? (
        <div className="callout callout-warning mb-4" role="status">
          <AlertTriangle aria-hidden="true" />
          <p>
            {etat.erreur
              ? 'État des SMS illisible : vérifiez la connexion au serveur.'
              : <>Clé API Brevo absente du serveur. Ajoutez la variable <code className="font-mono">BREVO_API_KEY</code> dans
                Railway (onglet Variables) : le serveur redémarre et les SMS peuvent alors être activés.</>}
          </p>
        </div>
      ) : (
        <p className="text-sm font-medium text-emerald-700 mb-4 flex items-center gap-1.5">
          <Check className="w-4 h-4" aria-hidden="true" /> Clé API Brevo présente sur le serveur (jamais affichée).
        </p>
      )}

      <Interrupteur
        id="cfg-sms-actif"
        className="py-3 border-t border-slate-100"
        label="Envoyer les SMS depuis le serveur (Brevo)"
        description="Sinon, le bouton SMS ouvre l’app Messages de l’appareil, comme avant. Chaque SMS consomme des crédits Brevo."
        checked={actif}
        onChange={basculer}
        disabled={!etat || (cleAbsente && !actif)}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
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
          <p id="cfg-sms-expediteur-aide" className="input-help">
            Nom affiché à la place d’un numéro : 11 lettres ou chiffres, sans espace ni accent.
          </p>
        </div>
        <div>
          <p className="input-label">Solde de crédits SMS</p>
          <div className="flex items-center gap-2 min-h-10">
            <p className="t-num text-sm min-w-0" aria-live="polite">
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
              className="btn-secondary btn-sm ml-auto shrink-0"
            >
              {credits.chargement ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : 'Actualiser'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
