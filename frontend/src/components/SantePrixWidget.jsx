import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, Clock, Inbox, ListChecks, PlugZap, RefreshCw, RotateCcw, Smartphone, TrendingDown, Loader2,
} from 'lucide-react';
import api from '../lib/api';
import { formatDate, formatDateShort } from '../lib/utils';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useToast } from './Toast';
import { cheminPrixARevoir } from './PropositionsPrix';

// ─── Synchro LCD-Phone (catalogue des téléphones à vendre) ──────────────────

export const INTERVALLE_SUIVI_SYNCHRO = 5000;
const SUIVI_MAX_TOURS = 120; // ~10 min
// Synchro plus ancienne : signalée en orange dans la santé des prix
export const JOURS_SYNCHRO_ANCIENNE = 30;

const booleen = (v) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null);

/**
 * GET /api/telephones/sync-status → { enCours, date, ok, erreur, total }.
 * Statut durable (params LCDPHONE_*) relu après un redéploiement ; repli sur l'ancien format en mémoire.
 */
export function lireStatutSynchro(st) {
  const resume = (st?.resume && typeof st.resume === 'object' ? st.resume : null)
    || (st?.last_result && typeof st.last_result === 'object' ? st.last_result : null);
  const date = st?.derniere_synchro || st?.last_sync_at || st?.finished_at || null;
  let ok = booleen(st?.ok);
  if (ok === null) ok = booleen(st?.synchro_ok);
  if (ok === null && resume && typeof resume.success === 'boolean') ok = resume.success;
  const total = Number.isFinite(Number(resume?.total)) && resume?.total !== null ? Number(resume.total) : null;
  return {
    enCours: Boolean(st?.running ?? st?.en_cours),
    date,
    ok,
    erreur: resume?.error || st?.erreur || null,
    total,
  };
}

/** Réponse de GET /api/telephones/probe → { ok, avertissement, message }. */
export function analyserProbe(res) {
  if (!res || res.success === false) {
    return { ok: false, avertissement: false, message: `Connexion LCD-Phone refusée : ${res?.error || 'erreur inconnue'}` };
  }
  const categories = Object.values(res.categories || {});
  const lues = categories.filter(c => c && !c.error && (Number(c.nb_products_json) > 0 || Number(c.nb_products_html) > 0));
  if (categories.length && !lues.length) {
    return {
      ok: false, avertissement: false,
      message: 'Connexion LCD-Phone établie mais aucun produit lu : le site a peut-être changé. Synchronisation bloquée, prévenez le développeur.',
    };
  }
  const incompletes = categories.length - lues.length;
  return {
    ok: true,
    avertissement: incompletes > 0,
    message: categories.length
      ? `Connexion LCD-Phone OK : ${lues.length} catégorie${lues.length > 1 ? 's' : ''} sur ${categories.length} lue${lues.length > 1 ? 's' : ''}.`
      : 'Connexion LCD-Phone OK.',
  };
}

const attendre = (ms) => new Promise(r => setTimeout(r, ms));

const STYLES_SYNCHRO = {
  sombre: {
    texte: 'text-slate-300', faible: 'text-slate-400',
    secondaire: 'bg-slate-800 text-slate-100 border border-slate-600 hover:bg-slate-700 focus-visible:ring-amber-400',
    principal: 'bg-amber-500 text-slate-950 hover:bg-amber-400 focus-visible:ring-amber-300',
    ok: 'text-emerald-300', ko: 'text-red-300',
  },
  clair: {
    texte: 'text-slate-700', faible: 'text-slate-600',
    secondaire: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 focus-visible:ring-brand-500',
    principal: 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-400',
    ok: 'text-emerald-700', ko: 'text-red-700',
  },
};

/**
 * Bloc « Synchro LCD-Phone » des pages Téléphones : date de la dernière synchro (durable) pour tous ;
 * pour l'admin, « Tester la connexion » (/probe) puis « Synchroniser ». Erreurs en toast.
 * `dateRepli` : date du catalogue (MAX(derniere_sync) de /api/telephones/stats), affichée tant
 * qu'aucune synchro n'est enregistrée dans les paramètres (juste après le déploiement).
 */
export function SynchroLcdPhone({ estAdmin = false, theme = 'clair', onTerminee, intervalle = INTERVALLE_SUIVI_SYNCHRO, className = '', dateRepli = null }) {
  const toast = useToast();
  const { sensible, adminPrompt } = useAdminElevation();
  const [statut, setStatut] = useState(null);
  const [test, setTest] = useState({ etat: 'jamais', message: '' });
  const [synchro, setSynchro] = useState(false);
  const monteRef = useRef(true);
  const suiviRef = useRef(false);
  const onTermineeRef = useRef(onTerminee);
  onTermineeRef.current = onTerminee;
  const st = STYLES_SYNCHRO[theme] || STYLES_SYNCHRO.clair;
  const aideId = useId();

  const relire = useCallback(async () => {
    const s = lireStatutSynchro(await api.getSyncStatus());
    if (monteRef.current) setStatut(s);
    return s;
  }, []);

  const suivre = useCallback(async (annoncer) => {
    if (suiviRef.current) return;
    suiviRef.current = true;
    setSynchro(true);
    try {
      for (let tour = 0; tour < SUIVI_MAX_TOURS && monteRef.current; tour++) {
        await attendre(intervalle);
        if (!monteRef.current) return;
        let s;
        try { s = await relire(); } catch { continue; }
        if (s.enCours) continue;
        if (annoncer) {
          if (s.ok === false) toast.error(`Synchronisation LCD-Phone échouée : ${s.erreur || 'erreur inconnue'}`);
          else toast.success(`Synchronisation LCD-Phone terminée${s.total !== null ? ` : ${s.total} téléphones` : ''}`);
        }
        onTermineeRef.current?.(s);
        return;
      }
    } finally {
      suiviRef.current = false;
      if (monteRef.current) setSynchro(false);
    }
  }, [intervalle, relire, toast]);

  useEffect(() => {
    monteRef.current = true;
    relire().then((s) => { if (s.enCours) suivre(false); }).catch(() => {});
    return () => { monteRef.current = false; };
  }, [relire, suivre]);

  const tester = async () => {
    if (test.etat === 'encours') return;
    setTest({ etat: 'encours', message: '' });
    try {
      const a = analyserProbe(await sensible(() => api.probeTelephones()));
      if (!monteRef.current) return;
      setTest({ etat: a.ok ? 'ok' : 'ko', message: a.message });
      if (!a.ok) toast.error(a.message);
      else if (a.avertissement) toast.warning(a.message);
      else toast.success(a.message);
    } catch (err) {
      if (!monteRef.current) return;
      if (err?.code === 'admin_cancelled') { setTest({ etat: 'jamais', message: '' }); return; }
      const message = `Test LCD-Phone impossible : ${err?.message || 'erreur inconnue'}`;
      setTest({ etat: 'ko', message });
      toast.error(message);
    }
  };

  const synchroniser = async () => {
    if (synchro || test.etat !== 'ok') return;
    setSynchro(true);
    try {
      const res = await sensible(() => api.syncTelephones());
      toast.info(/d[ée]j[àa]/i.test(String(res?.message || '')) ? 'Synchronisation déjà en cours…' : 'Synchronisation lancée : quelques minutes.');
      setStatut(s => ({ ...(s || {}), enCours: true }));
      setSynchro(false);
      await suivre(true);
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(`Synchronisation LCD-Phone impossible : ${err?.message || 'erreur inconnue'}`);
      if (monteRef.current) setSynchro(false);
    }
  };

  const enCours = synchro || Boolean(statut?.enCours);
  const date = statut?.date || dateRepli || null;
  const issue = statut?.ok === false ? ' · échouée' : statut?.ok === true && statut?.date ? ' · réussie' : '';
  const ligneStatut = !statut && !date ? 'Dernière synchro LCD-Phone : …'
    : date ? `Dernière synchro LCD-Phone : ${formatDate(date)}${issue}`
      : 'Aucune synchro LCD-Phone enregistrée';

  return (
    <div className={`flex flex-col items-start sm:items-end gap-2 ${className}`}>
      {estAdmin && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={tester} disabled={test.etat === 'encours' || enCours} aria-busy={test.etat === 'encours' || undefined}
            className={`inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 ${st.secondaire}`}>
            {test.etat === 'encours'
              ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
              : <PlugZap className="w-4 h-4" aria-hidden="true" />}
            {test.etat === 'encours' ? 'Test en cours…' : 'Tester la connexion'}
          </button>
          <button type="button" onClick={synchroniser} disabled={enCours || test.etat !== 'ok'} aria-busy={enCours || undefined}
            aria-describedby={test.etat !== 'ok' ? aideId : undefined}
            className={`inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 ${st.principal}`}>
            <RefreshCw className={`w-4 h-4 ${enCours ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
            {enCours ? 'Synchronisation…' : 'Synchroniser'}
          </button>
        </div>
      )}
      <p className={`text-xs ${st.texte}`} role="status" aria-live="polite">
        {enCours ? 'Synchronisation LCD-Phone en cours…' : ligneStatut}
        {!enCours && statut?.ok === false && statut.erreur ? <span className={`block ${st.ko}`}>{statut.erreur}</span> : null}
      </p>
      {estAdmin && test.etat !== 'ok' && !enCours && (
        <p id={aideId} className={`text-[11px] ${test.etat === 'ko' ? st.ko : st.faible}`}>
          {test.etat === 'ko' ? test.message : 'Testez la connexion avant de synchroniser.'}
        </p>
      )}
      {adminPrompt}
    </div>
  );
}

// ─── Santé des prix (tableau de bord admin) ──────────────────────────────────

// null / absent (ex. modèles sans prix avant la première veille) : inconnu, jamais 0
const entier = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
};
const fr = (n) => (n === null ? '—' : n.toLocaleString('fr-FR'));

const TONS = {
  neutre: 'border-slate-200 bg-white',
  orange: 'border-amber-300 bg-amber-50',
  rouge: 'border-red-200 bg-red-50',
  marque: 'border-brand-200 bg-brand-50',
};
const TONS_ICONE = { neutre: 'text-slate-600', orange: 'text-amber-800', rouge: 'text-red-700', marque: 'text-brand-700' };

/** Réponse de GET /api/tarifs/sante → tuiles affichées (exportée pour les tests). */
export function tuilesSante(d, basePath = '/accueil', maintenant = Date.now()) {
  const total = entier(d?.total);
  const estimes = entier(d?.estimes);
  const aRevoir = entier(d?.a_revoir);
  const perimes = entier(d?.perimes);
  const propositions = entier(d?.propositions_en_attente);
  const marges = entier(d?.marges_faibles);
  const sansPrix = entier(d?.modeles_sans_prix);
  const lcd = d?.lcdphone || {};
  const lcdDate = lcd.derniere_synchro ? new Date(lcd.derniere_synchro) : null;
  const lcdJours = lcdDate && !Number.isNaN(lcdDate.getTime()) ? Math.floor((maintenant - lcdDate.getTime()) / 86_400_000) : null;
  const lcdOk = booleen(lcd.ok);
  const grille = `${basePath}/tarifs`;
  // Filtre de la grille dans l'URL (?source= / ?fraicheur= / ?marge=), appliqué par TarifsPage (lireFiltresUrl)
  const grilleFiltree = (filtre) => `${grille}?${filtre}`;
  const jRevoir = entier(d?.seuils?.jours_a_revoir) ?? 90;
  const jPerime = entier(d?.seuils?.jours_perime) ?? 180;
  return [
    {
      cle: 'estimes', icone: Activity, valeur: fr(estimes), titre: 'Prix estimés',
      detail: total !== null ? `sur ${fr(total)} prix` : 'jamais confirmés', lien: grilleFiltree('source=estimation'),
      ton: estimes ? 'orange' : 'neutre',
      aria: `${fr(estimes)} prix estimés${total !== null ? ` sur ${fr(total)}` : ''}, voir la grille`,
    },
    {
      cle: 'a_revoir', icone: Clock, valeur: fr(aRevoir), titre: 'À revoir', detail: `plus de ${jRevoir} jours`, lien: grilleFiltree('fraicheur=a_revoir'),
      ton: aRevoir ? 'orange' : 'neutre', aria: `${fr(aRevoir)} prix à revoir, plus de ${jRevoir} jours, voir la grille`,
    },
    {
      cle: 'perimes', icone: AlertTriangle, valeur: fr(perimes), titre: 'Périmés', detail: `plus de ${jPerime} jours`, lien: grilleFiltree('fraicheur=perime'),
      ton: perimes ? 'rouge' : 'neutre', aria: `${fr(perimes)} prix périmés, plus de ${jPerime} jours, voir la grille`,
    },
    {
      cle: 'marges', icone: TrendingDown, valeur: fr(marges), titre: 'Marges faibles', detail: 'sous le seuil d’alerte', lien: grilleFiltree('marge=faible'),
      ton: marges ? 'rouge' : 'neutre', aria: `${fr(marges)} marges sous le seuil d’alerte, voir la grille`,
    },
    {
      cle: 'propositions', icone: Inbox, valeur: fr(propositions), titre: 'Propositions', detail: 'issues des commandes',
      lien: cheminPrixARevoir(basePath, 'propositions'), ton: propositions ? 'marque' : 'neutre', badge: Boolean(propositions),
      aria: `${fr(propositions)} proposition${propositions > 1 ? 's' : ''} de prix en attente, à valider`,
    },
    {
      cle: 'sans_prix', icone: ListChecks, valeur: fr(sansPrix), titre: 'Modèles sans prix',
      detail: sansPrix === null ? 'compté par la veille' : 'au catalogue',
      lien: cheminPrixARevoir(basePath, 'sans-prix'), ton: sansPrix ? 'orange' : 'neutre',
      aria: sansPrix === null ? 'Modèles du catalogue sans prix de réparation, voir la liste'
        : `${fr(sansPrix)} modèles du catalogue sans prix de réparation`,
    },
    {
      cle: 'lcdphone', icone: Smartphone,
      valeur: lcdJours === null ? '—' : lcdJours === 0 ? 'Auj.' : `${lcdJours} j`,
      titre: 'Synchro LCD-Phone',
      detail: lcdDate && lcdJours !== null ? `${formatDateShort(lcd.derniere_synchro)}${lcdOk === false ? ' · échouée' : ''}` : 'jamais faite',
      lien: `${basePath}/tarifs-telephones`,
      ton: lcdOk === false ? 'rouge' : lcdJours === null || lcdJours > JOURS_SYNCHRO_ANCIENNE ? 'orange' : 'neutre',
      aria: lcdDate && lcdJours !== null
        ? `Dernière synchro LCD-Phone le ${formatDateShort(lcd.derniere_synchro)}${lcdOk === false ? ', échouée' : ''}, voir les téléphones`
        : 'Aucune synchro LCD-Phone, voir les téléphones',
    },
  ];
}

/**
 * Aucune synchro LCD-Phone enregistrée (paramètres vides juste après le déploiement) : date du
 * catalogue déjà synchronisé (MAX(derniere_sync) de /api/telephones/stats), sans statut réussi / échoué.
 */
async function avecRepliSynchro(data) {
  const d = data && typeof data === 'object' ? data : {};
  if (d.lcdphone?.derniere_synchro || typeof api.getTelephoneStats !== 'function') return d;
  const stats = await Promise.resolve().then(() => api.getTelephoneStats()).catch(() => null);
  return stats?.derniere_sync ? { ...d, lcdphone: { ...(d.lcdphone || {}), derniere_synchro: stats.derniere_sync } } : d;
}

/** Widget admin « Santé des prix » : fraîcheur de la grille, propositions, modèles sans prix, LCD-Phone. */
export default function SantePrixWidget({ basePath = '/accueil' }) {
  const titreId = useId();
  const [etat, setEtat] = useState({ statut: 'chargement', data: null });
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    let annule = false;
    setEtat(e => ({ ...e, statut: e.data ? 'pret' : 'chargement' }));
    // Promise.resolve : une méthode absente (ancien client) devient une erreur affichée, pas un plantage
    Promise.resolve().then(() => api.getSantePrix())
      .then(avecRepliSynchro)
      .then((data) => { if (!annule) setEtat({ statut: 'pret', data: data || {} }); })
      .catch(() => { if (!annule) setEtat(e => ({ statut: e.data ? 'pret' : 'erreur', data: e.data })); });
    return () => { annule = true; };
  }, [essai]);

  const { statut, data } = etat;
  const tuiles = statut === 'pret' ? tuilesSante(data, basePath) : [];

  return (
    <section aria-labelledby={titreId} className="mt-8 pt-6 border-t border-slate-200/70">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id={titreId} className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-600">Santé des prix</h2>
        {statut === 'pret' && (
          <p className="text-[11px] text-slate-600">
            {data?.derniere_veille ? `Veille hebdomadaire du ${formatDateShort(data.derniere_veille)}` : 'Veille hebdomadaire : pas encore passée'}
          </p>
        )}
      </div>
      {statut === 'chargement' ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3" aria-hidden="true">
          {Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-[88px] rounded-xl bg-slate-100 motion-safe:animate-pulse" />)}
        </div>
      ) : statut === 'erreur' ? (
        <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-xl bg-white border border-slate-200">
          <p className="text-sm text-slate-700">Santé des prix indisponible pour le moment.</p>
          <button type="button" onClick={() => setEssai(n => n + 1)} className="btn-secondary min-h-[44px] text-xs">
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Réessayer
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
          {tuiles.map(({ cle, icone: Icone, valeur, titre, detail, lien, ton, aria, badge }) => (
            <li key={cle}>
              <Link to={lien} aria-label={aria}
                className={`relative flex flex-col h-full min-h-[88px] px-3 py-2.5 rounded-xl border transition-colors hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${TONS[ton] || TONS.neutre}`}>
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                  <Icone className={`w-3.5 h-3.5 shrink-0 ${TONS_ICONE[ton] || TONS_ICONE.neutre}`} aria-hidden="true" />
                  <span className="truncate">{titre}</span>
                </span>
                <span className="mt-1 text-lg font-bold text-slate-900 tracking-tight">{valeur}</span>
                <span className="text-[11px] text-slate-600 truncate">{detail}</span>
                {badge && (
                  <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-brand-600 ring-2 ring-white" aria-hidden="true" />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
