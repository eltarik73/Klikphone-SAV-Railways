import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ClipboardPaste, Copy, Info, KeyRound, Loader2, RefreshCw, Truck, Unplug,
} from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/utils';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useToast } from './Toast';

/**
 * Synchro automatique des tarifs Mobilax (écran « Réparation smartphones »).
 *
 * Une seule étape pour le gérant : connecté sur mobilax.fr, il copie les jetons de son
 * navigateur (console → copy(JSON.stringify(localStorage))) et les colle ici. Ensuite le serveur
 * met les prix d'achat à jour chaque jour (GET /api/tarifs/fournisseurs/etat pour l'état ;
 * POST …/mobilax/sync pour « Synchroniser maintenant »). Aucun jeton n'est jamais affiché.
 * Utopya : pas de synchro possible (prix sous connexion, Cloudflare) → import de fichier.
 */

export const INTERVALLE_SUIVI = 5000;
const SUIVI_MAX_TOURS = 240; // ~20 min
export const COMMANDE_CONSOLE = 'copy(JSON.stringify(localStorage))';

const n = (v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : 0);
const pluriel = (k, un, plus) => `${k} ${k > 1 ? plus : un}`;

/** Phrase d'état de la synchro Mobilax (exportée pour les tests) : { ton, titre, detail }. */
export function decrireMobilax(m) {
  if (!m) return { ton: 'neutre', titre: 'Synchro Mobilax : état inconnu', detail: '' };
  if (m.en_cours) {
    return { ton: 'info', titre: 'Synchronisation Mobilax en cours…', detail: m.debut ? `Lancée le ${formatDate(m.debut)} — quelques minutes.` : 'Quelques minutes.' };
  }
  if (!m.configure) {
    return {
      ton: 'attention', titre: 'Mobilax : pas encore connecté',
      detail: 'Une seule étape : collez vos jetons mobilax.fr (bouton « Connecter Mobilax »), puis les prix d’achat se mettent à jour seuls chaque jour.',
    };
  }
  if (m.connexion === 'expiree') {
    return { ton: 'danger', titre: 'Connexion Mobilax expirée', detail: 'Reconnectez-vous une fois (collez à nouveau vos jetons) : la synchro quotidienne reprendra.' };
  }
  const r = m.resume || {};
  if (m.ok === false) {
    return {
      ton: 'danger',
      titre: `Dernière synchro Mobilax échouée${m.derniere_synchro ? ` (${formatDate(m.derniere_synchro)})` : ''}`,
      detail: m.erreur || 'Erreur inconnue — nouvel essai automatique dans l’heure.',
    };
  }
  if (m.ok === true) {
    const morceaux = [`${pluriel(n(r.modifies), 'prix mis à jour', 'prix mis à jour')}`, `${n(r.confirmes)} confirmé${n(r.confirmes) > 1 ? 's' : ''}`];
    if (n(r.propositions)) morceaux.push(`${n(r.propositions)} à valider (Propositions)`);
    if (n(r.verrouillees)) morceaux.push(`${n(r.verrouillees)} verrouillé${n(r.verrouillees) > 1 ? 's' : ''}`);
    if (r.incomplet) morceaux.push('passage incomplet (temps écoulé)');
    return {
      ton: 'ok',
      titre: `Dernière synchro Mobilax : ${formatDate(m.derniere_synchro)}`,
      detail: `${morceaux.join(' · ')} — ${n(r.produits)} produits lus pour ${n(r.modeles)} modèles.`,
    };
  }
  return {
    ton: 'neutre', titre: 'Mobilax connecté',
    detail: m.active ? 'Première synchro cette nuit, ou tout de suite avec « Synchroniser maintenant ».' : 'Synchro quotidienne coupée.',
  };
}

const TONS = {
  ok: { boite: 'callout-success', Icone: CheckCircle2 },
  info: { boite: 'callout-info', Icone: Loader2 },
  attention: { boite: 'callout-warning', Icone: KeyRound },
  danger: { boite: 'callout-danger', Icone: AlertTriangle },
  neutre: { boite: 'callout-info', Icone: Truck },
};

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function messageErreur(err, defaut) {
  if (err?.code === 'admin_cancelled') return null;
  if (err?.status === 403) return 'Réservé au gérant (compte administrateur).';
  return `${defaut} : ${err?.message || 'erreur inconnue'}`;
}

/**
 * Bloc « Synchro Mobilax » : état pour tout le personnel ; pour l'admin, « Synchroniser maintenant »,
 * « Connecter Mobilax » (collage des jetons, en 3 étapes), synchro quotidienne en marche ou coupée.
 */
export default function SynchroFournisseur({ estAdmin = false, className = '', intervalle = INTERVALLE_SUIVI }) {
  const toast = useToast();
  const { sensible, adminPrompt } = useAdminElevation();
  const titreId = useId();
  const texteId = useId();
  const [etat, setEtat] = useState(null);
  const [indisponible, setIndisponible] = useState(false);
  const [panneau, setPanneau] = useState(false);
  const [texte, setTexte] = useState('');
  const [occupe, setOccupe] = useState(''); // 'sync' | 'connexion' | 'oubli' | 'active' | ''
  const monteRef = useRef(true);
  const suiviRef = useRef(false);

  const relire = useCallback(async () => {
    const e = await api.getEtatFournisseurs();
    if (monteRef.current) { setEtat(e); setIndisponible(false); }
    return e;
  }, []);

  const suivre = useCallback(async (annoncer) => {
    if (suiviRef.current) return;
    suiviRef.current = true;
    try {
      for (let tour = 0; tour < SUIVI_MAX_TOURS && monteRef.current; tour++) {
        await attendre(intervalle);
        if (!monteRef.current) return;
        let e;
        try { e = await relire(); } catch { continue; }
        const m = e?.mobilax;
        if (m?.en_cours) continue;
        if (annoncer && m) {
          if (m.message) toast.warning(m.message);
          else if (m.ok === false) toast.error(`Synchronisation Mobilax échouée : ${m.erreur || 'erreur inconnue'}`);
          else toast.success(`Synchronisation Mobilax terminée : ${n(m.resume?.modifies)} prix mis à jour${n(m.resume?.propositions) ? `, ${n(m.resume?.propositions)} à valider` : ''}`);
        }
        return;
      }
    } finally {
      suiviRef.current = false;
    }
  }, [intervalle, relire, toast]);

  useEffect(() => {
    monteRef.current = true;
    relire()
      .then((e) => { if (e?.mobilax?.en_cours) suivre(false); })
      .catch(() => { if (monteRef.current) setIndisponible(true); });
    return () => { monteRef.current = false; };
  }, [relire, suivre]);

  const m = etat?.mobilax || null;
  const enCours = Boolean(m?.en_cours) || occupe === 'sync';

  const synchroniser = async () => {
    if (enCours || !m?.configure) return;
    setOccupe('sync');
    try {
      const res = await sensible(() => api.syncMobilax());
      toast.info(res?.message || 'Synchronisation lancée : quelques minutes.');
      setEtat((e) => ({ ...(e || {}), mobilax: { ...(e?.mobilax || {}), en_cours: true } }));
      setOccupe('');
      await suivre(true);
    } catch (err) {
      const msg = messageErreur(err, 'Synchronisation Mobilax impossible');
      if (msg) toast.error(msg);
      if (monteRef.current) setOccupe('');
    }
  };

  const connecter = async () => {
    if (occupe || !texte.trim()) return;
    setOccupe('connexion');
    try {
      const e = await sensible(() => api.connecterMobilax(texte));
      if (!monteRef.current) return;
      setEtat(e);
      setTexte('');
      setPanneau(false);
      toast.success('Mobilax connecté : les prix d’achat se mettront à jour chaque jour. Vous pouvez lancer une première synchro maintenant.');
    } catch (err) {
      const msg = messageErreur(err, 'Connexion Mobilax refusée');
      if (msg) toast.error(msg);
    } finally {
      if (monteRef.current) setOccupe('');
    }
  };

  const oublier = async () => {
    if (occupe) return;
    setOccupe('oubli');
    try {
      const e = await sensible(() => api.deconnecterMobilax());
      if (monteRef.current) { setEtat(e); toast.info('Connexion Mobilax oubliée : plus aucune synchro.'); }
    } catch (err) {
      const msg = messageErreur(err, 'Impossible d’oublier la connexion');
      if (msg) toast.error(msg);
    } finally {
      if (monteRef.current) setOccupe('');
    }
  };

  const basculerActive = async () => {
    if (occupe || !m) return;
    setOccupe('active');
    try {
      const e = await sensible(() => api.reglerSynchroMobilax(!m.active));
      if (monteRef.current) setEtat(e);
    } catch (err) {
      const msg = messageErreur(err, 'Réglage impossible');
      if (msg) toast.error(msg);
    } finally {
      if (monteRef.current) setOccupe('');
    }
  };

  const copierCommande = async () => {
    try {
      await navigator.clipboard.writeText(COMMANDE_CONSOLE);
      toast.success('Commande copiée : collez-la dans la console de mobilax.fr.');
    } catch {
      toast.warning('Copie impossible : sélectionnez la commande à la main.');
    }
  };

  const description = indisponible
    ? { ton: 'neutre', titre: 'Synchro Mobilax : état indisponible pour le moment', detail: '' }
    : etat ? decrireMobilax(enCours ? { ...m, en_cours: true } : m) : { ton: 'neutre', titre: 'Synchro Mobilax : lecture de l’état…', detail: '' };
  const ton = TONS[description.ton] || TONS.neutre;
  const Icone = ton.Icone;

  return (
    <section aria-labelledby={titreId} className={`callout ${ton.boite} flex-wrap items-center ${className}`}>
      <Icone aria-hidden="true" className={description.ton === 'info' ? 'motion-safe:animate-spin' : ''} />
      <div className="min-w-[240px] flex-1">
        <p id={titreId} className="font-semibold" role="status" aria-live="polite">{description.titre}</p>
        {description.detail && <p className="text-xs sm:text-sm">{description.detail}</p>}
        <p className="text-xs opacity-80 mt-1">
          Utopya : pas de synchro automatique possible (prix visibles seulement connecté, site protégé par Cloudflare) — passez par « Importer une liste de prix ».
        </p>
      </div>

      {estAdmin && (
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full">
          <button type="button" onClick={synchroniser} disabled={enCours || !m?.configure || Boolean(occupe)}
            aria-busy={enCours || undefined} className="btn-primary btn-sm">
            <RefreshCw className={enCours ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
            {enCours ? 'Synchronisation…' : 'Synchroniser maintenant'}
          </button>
          <button type="button" onClick={() => setPanneau((p) => !p)} aria-expanded={panneau} className="btn-secondary btn-sm">
            <KeyRound aria-hidden="true" /> {m?.configure ? 'Reconnecter Mobilax' : 'Connecter Mobilax'}
          </button>
          {m?.configure && (
            <>
              <label className="btn-secondary btn-sm cursor-pointer select-none">
                <input type="checkbox" className="accent-brand-600" checked={Boolean(m.active)} onChange={basculerActive}
                  disabled={Boolean(occupe)} />
                Chaque jour
              </label>
              <button type="button" onClick={oublier} disabled={Boolean(occupe)} className="btn-secondary btn-sm">
                <Unplug aria-hidden="true" /> Oublier la connexion
              </button>
            </>
          )}
        </div>
      )}

      {estAdmin && panneau && (
        <div className="w-full rounded-xl border border-slate-200 bg-white p-4 text-slate-800">
          <p className="font-semibold flex items-center gap-2"><Info aria-hidden="true" className="w-4 h-4" /> Connecter Mobilax en une fois</p>
          <ol className="mt-2 space-y-2 text-sm list-decimal pl-5">
            <li>
              Ouvrez <a href="https://www.mobilax.fr/" target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">mobilax.fr<span className="sr-only"> (nouvel onglet)</span></a> et connectez-vous à votre compte.
            </li>
            <li>
              Sur la page, ouvrez la console du navigateur (touche F12, ou Cmd + Option + J sur Mac, onglet « Console »),
              collez cette commande puis appuyez sur Entrée :
              <span className="mt-1 flex flex-wrap items-center gap-2">
                <code className="rounded bg-slate-100 px-2 py-1 text-xs select-all">{COMMANDE_CONSOLE}</code>
                <button type="button" onClick={copierCommande} className="btn-secondary btn-sm">
                  <Copy aria-hidden="true" /> Copier la commande
                </button>
              </span>
              <span className="block text-xs text-slate-600 mt-1">Si la console refuse le collage, tapez « allow pasting » puis Entrée, et recollez.</span>
            </li>
            <li>
              Le texte est copié : collez-le ci-dessous. Il reste sur le serveur de la boutique et n’est jamais affiché.
            </li>
          </ol>
          <label htmlFor={texteId} className="block mt-3 mb-1 text-sm font-medium text-slate-700">Texte copié depuis mobilax.fr</label>
          <textarea id={texteId} value={texte} onChange={(e) => setTexte(e.target.value)} rows={3} spellCheck={false}
            autoComplete="off" className="input font-mono text-xs" placeholder='{"web_mobi_token":"…","web_mobi_refresh_token":"…"}' />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={connecter} disabled={!texte.trim() || Boolean(occupe)} aria-busy={occupe === 'connexion' || undefined}
              className="btn-primary btn-sm">
              {occupe === 'connexion' ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <ClipboardPaste aria-hidden="true" />}
              {occupe === 'connexion' ? 'Vérification…' : 'Enregistrer la connexion'}
            </button>
            <button type="button" onClick={() => { setPanneau(false); setTexte(''); }} className="btn-secondary btn-sm">Annuler</button>
          </div>
        </div>
      )}
      {adminPrompt}
    </section>
  );
}
