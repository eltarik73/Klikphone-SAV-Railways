import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle, Bookmark, CheckCircle2, ChevronDown, ClipboardPaste, Copy, Info, KeyRound, Loader2, RefreshCw, SearchX, Truck, Unplug,
} from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/utils';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useToast } from './Toast';

/**
 * Synchro automatique des tarifs fournisseurs (écran « Réparation smartphones »).
 *
 * Mobilax — une seule étape pour le gérant : connecté sur mobilax.fr, il copie les jetons de son
 * navigateur (console → copy(JSON.stringify(localStorage))) et les colle ici. Ensuite le serveur
 * met les prix d'achat à jour chaque jour (GET /api/tarifs/fournisseurs/etat pour l'état ;
 * POST …/mobilax/sync pour « Synchroniser maintenant »). Aucun jeton n'est jamais affiché.
 *
 * Utopya — le site refuse les serveurs (prix sous connexion, Cloudflare) : la collecte passe par
 * le navigateur du gérant. Un favori « Collecte Utopya » (script + clé, GET …/utopya/collecteur,
 * admin) se glisse une fois dans la barre des favoris ; cliqué sur utopya.fr connecté, il lit les
 * pages des modèles de la grille et envoie noms et prix au serveur, qui importe comme Mobilax.
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
    if (n(r.remplaces)) morceaux.push(`dont ${n(r.remplaces)} prix estimé${n(r.remplaces) > 1 ? 's' : ''} ou périmé${n(r.remplaces) > 1 ? 's' : ''} remplacé${n(r.remplaces) > 1 ? 's' : ''} sans validation`);
    if (n(r.propositions)) morceaux.push(`${n(r.propositions)} à valider (Propositions)`);
    if (n(r.propositions_fermees)) morceaux.push(`${n(r.propositions_fermees)} proposition${n(r.propositions_fermees) > 1 ? 's' : ''} réglée${n(r.propositions_fermees) > 1 ? 's' : ''}`);
    if (n(r.plus_cher_ailleurs)) morceaux.push(`${n(r.plus_cher_ailleurs)} resté${n(r.plus_cher_ailleurs) > 1 ? 's' : ''} chez Utopya (moins cher)`);
    if (n(r.verrouillees)) morceaux.push(`${n(r.verrouillees)} verrouillé${n(r.verrouillees) > 1 ? 's' : ''}`);
    if (n(r.sans_prix)) morceaux.push(`${n(r.sans_prix)} pièce${n(r.sans_prix) > 1 ? 's' : ''} de la grille sans prix Mobilax`);
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

/** Phrase d'état de la collecte Utopya (exportée pour les tests) : { ton, titre, detail }. */
export function decrireUtopya(u) {
  if (!u || u.disponible === false) {
    return { ton: 'neutre', titre: 'Utopya : collecte indisponible', detail: u?.raison || 'Passez par « Importer une liste de prix ».' };
  }
  if (u.en_cours) {
    return { ton: 'info', titre: 'Collecte Utopya en cours…', detail: 'Le serveur met les prix à jour : une minute environ.' };
  }
  if (!u.configure) {
    return {
      ton: 'attention', titre: 'Utopya : collecteur à installer',
      detail: 'Un favori à glisser une fois dans votre navigateur : cliqué sur utopya.fr (connecté), il remonte les prix dans Klikphone.',
    };
  }
  const r = u.resume || {};
  if (u.ok === false) {
    return {
      ton: 'danger',
      titre: `Dernière collecte Utopya échouée${u.derniere_collecte ? ` (${formatDate(u.derniere_collecte)})` : ''}`,
      detail: u.erreur || 'Erreur inconnue — relancez la collecte depuis utopya.fr.',
    };
  }
  if (u.ok === true) {
    const morceaux = [`${pluriel(n(r.modifies), 'prix mis à jour', 'prix mis à jour')}`];
    if (n(r.remplaces)) morceaux.push(`dont ${n(r.remplaces)} prix estimé${n(r.remplaces) > 1 ? 's' : ''} ou périmé${n(r.remplaces) > 1 ? 's' : ''} remplacé${n(r.remplaces) > 1 ? 's' : ''}`);
    if (n(r.propositions)) morceaux.push(`${n(r.propositions)} à valider (Propositions)`);
    if (n(r.plus_cher_ailleurs)) morceaux.push(`${n(r.plus_cher_ailleurs)} resté${n(r.plus_cher_ailleurs) > 1 ? 's' : ''} chez Mobilax (moins cher)`);
    if (n(r.verrouillees)) morceaux.push(`${n(r.verrouillees)} verrouillé${n(r.verrouillees) > 1 ? 's' : ''}`);
    if (n(r.sans_prix)) morceaux.push(`${n(r.sans_prix)} pièce${n(r.sans_prix) > 1 ? 's' : ''} de la grille sans prix Utopya`);
    if (r.interrompu) morceaux.push('collecte arrêtée avant la fin');
    else if (n(r.erreurs_pages)) morceaux.push(`${n(r.erreurs_pages)} page${n(r.erreurs_pages) > 1 ? 's' : ''} illisible${n(r.erreurs_pages) > 1 ? 's' : ''}`);
    return {
      ton: 'ok',
      titre: `Dernière collecte Utopya : ${formatDate(u.derniere_collecte)}`,
      detail: `${morceaux.join(' · ')} — ${n(r.produits)} produits lus sur ${n(r.pages_lues)} pages.`,
    };
  }
  return {
    ton: 'neutre', titre: 'Collecteur Utopya installé',
    detail: 'Sur utopya.fr, connecté à votre compte, cliquez le favori « Collecte Utopya » : les prix remontent ici.',
  };
}

const RAISONS_DEFAUT = (nom) => ({
  aucun_produit: `${nom} ne renvoie aucun produit pour ce modèle`,
  piece_absente: `${nom} a des produits pour ce modèle, mais pas cette pièce`,
  non_reconnue: `Des produits ${nom} ressemblent, sans être rattachés à la pièce (nom à vérifier)`,
  non_cherchee: 'Modèle non cherché (passage incomplet)',
});
const ORDRE_RAISONS = ['non_reconnue', 'piece_absente', 'aucun_produit', 'non_cherchee'];
const euros = (v) => (Number.isFinite(Number(v)) ? `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € HT` : '');

/**
 * Pièces de la grille restées sans prix chez un fournisseur au dernier passage (GET …/<fournisseur>/diagnostic),
 * groupées par raison, avec les produits ressemblants (prix pour l'admin). Rien quand tout a un prix.
 */
export function DiagnosticFournisseur({ nombre, estAdmin = false, nom = 'Mobilax', charger }) {
  const [ouvert, setOuvert] = useState(false);
  const [diag, setDiag] = useState(null);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(false);
  const [tout, setTout] = useState(false);
  const id = useId();
  if (!n(nombre)) return null;
  const basculer = async () => {
    const suivant = !ouvert;
    setOuvert(suivant);
    if (!suivant || diag || chargement) return;
    setChargement(true);
    setErreur('');
    try {
      setDiag(await charger());
    } catch (e) {
      setErreur(e?.message || 'Lecture du diagnostic impossible');
    } finally {
      setChargement(false);
    }
  };
  const raisons = { ...RAISONS_DEFAUT(nom), ...(diag?.raisons || {}) };
  const pieces = Array.isArray(diag?.pieces) ? diag.pieces : [];
  const groupes = ORDRE_RAISONS.map((r) => ({ raison: r, pieces: pieces.filter((p) => p.raison === r) })).filter((g) => g.pieces.length);
  const LIMITE = 40;
  return (
    <div className="w-full">
      <button type="button" onClick={basculer} aria-expanded={ouvert} aria-controls={id} className="btn-secondary btn-sm">
        <SearchX aria-hidden="true" /> {pluriel(n(nombre), `pièce sans prix ${nom}`, `pièces sans prix ${nom}`)}
        <ChevronDown aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${ouvert ? 'rotate-180' : ''}`} />
      </button>
      {ouvert && (
        <div id={id} className="mt-2 rounded-xl border border-slate-200 bg-white p-4 text-slate-800 text-sm">
          {chargement && <p className="loading-inline" role="status"><Loader2 aria-hidden="true" /> Lecture du diagnostic…</p>}
          {erreur && <p role="alert" className="text-red-700">{erreur}</p>}
          {diag && !pieces.length && <p>Toutes les pièces de la grille ont reçu un prix au dernier passage.</p>}
          {groupes.map((g) => (
            <section key={g.raison} className="mb-3 last:mb-0">
              <h3 className="font-semibold">{raisons[g.raison] || g.raison} <span className="font-normal text-slate-500">({g.pieces.length})</span></h3>
              <ul className="mt-1 space-y-1">
                {(tout ? g.pieces : g.pieces.slice(0, LIMITE)).map((p) => (
                  <li key={p.cle} className="flex flex-wrap gap-x-2">
                    <span className="font-medium">{p.marque} {p.modele} — {p.type_piece}{p.qualite ? ` ${p.qualite}` : ''}</span>
                    {Array.isArray(p.candidats) && p.candidats.length > 0 && (
                      <span className="text-slate-600">
                        {nom} : {p.candidats.map((c) => `${c.nom}${estAdmin && c.prix_ht !== null && c.prix_ht !== undefined ? ` (${euros(c.prix_ht)})` : ''}`).join(' · ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {!tout && g.pieces.length > LIMITE && (
                <button type="button" onClick={() => setTout(true)} className="btn-secondary btn-sm mt-1">Voir les {g.pieces.length} pièces</button>
              )}
            </section>
          ))}
          {diag?.tronque && <p className="text-xs text-slate-500">Liste limitée aux {pieces.length} premières pièces ({n(diag.n)} au total).</p>}
        </div>
      )}
    </div>
  );
}

/** Diagnostic Mobilax (compatibilité : même rendu que DiagnosticFournisseur). */
export function DiagnosticMobilax({ nombre, estAdmin = false }) {
  return <DiagnosticFournisseur nombre={nombre} estAdmin={estAdmin} nom="Mobilax" charger={() => api.getDiagnosticMobilax()} />;
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

/** Lien du favori : l'adresse « javascript: » est posée hors de React (qui la refuse par prudence). */
function LienFavori({ url, onClick }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.setAttribute('href', url || '#');
  }, [url]);
  return (
    <a ref={ref} draggable="true" onClick={onClick} className="btn-primary btn-sm cursor-grab select-none" title="Glissez ce bouton dans la barre des favoris">
      <Bookmark aria-hidden="true" /> Collecte Utopya
    </a>
  );
}

/**
 * Blocs « Synchro Mobilax » et « Collecte Utopya » : état pour tout le personnel ; pour l'admin,
 * « Synchroniser maintenant », « Connecter Mobilax » (collage des jetons, en 3 étapes), synchro
 * quotidienne en marche ou coupée, et l'installation du collecteur Utopya (favori à glisser).
 */
export default function SynchroFournisseur({ estAdmin = false, className = '', intervalle = INTERVALLE_SUIVI }) {
  const toast = useToast();
  const { sensible, adminPrompt } = useAdminElevation();
  const titreId = useId();
  const titreUtopyaId = useId();
  const texteId = useId();
  const [etat, setEtat] = useState(null);
  const [indisponible, setIndisponible] = useState(false);
  const [panneau, setPanneau] = useState(false);
  const [panneauUtopya, setPanneauUtopya] = useState(false);
  const [collecteur, setCollecteur] = useState(null);
  const [texte, setTexte] = useState('');
  const [occupe, setOccupe] = useState(''); // 'sync' | 'connexion' | 'oubli' | 'active' | 'collecteur' | 'cle' | ''
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
        if (m?.en_cours || e?.utopya?.en_cours) continue;
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
      .then((e) => { if (e?.mobilax?.en_cours || e?.utopya?.en_cours) suivre(false); })
      .catch(() => { if (monteRef.current) setIndisponible(true); });
    return () => { monteRef.current = false; };
  }, [relire, suivre]);

  const m = etat?.mobilax || null;
  const u = etat?.utopya || null;
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

  // Collecteur Utopya : ouvrir le panneau charge (et crée au besoin) le favori ; « Nouvelle clé » le remplace
  const ouvrirCollecteur = async () => {
    const suivant = !panneauUtopya;
    setPanneauUtopya(suivant);
    if (!suivant || collecteur || occupe) return;
    setOccupe('collecteur');
    try {
      const c = await sensible(() => api.getCollecteurUtopya());
      if (!monteRef.current) return;
      setCollecteur(c);
      setEtat((e) => (e?.utopya ? { ...e, utopya: { ...e.utopya, configure: true } } : e));
    } catch (err) {
      const msg = messageErreur(err, 'Collecteur Utopya indisponible');
      if (msg) toast.error(msg);
      if (monteRef.current) setPanneauUtopya(false);
    } finally {
      if (monteRef.current) setOccupe('');
    }
  };

  const regenererCle = async () => {
    if (occupe) return;
    setOccupe('cle');
    try {
      const c = await sensible(() => api.regenererCollecteurUtopya());
      if (!monteRef.current) return;
      setCollecteur(c);
      toast.success('Nouvelle clé : remplacez le favori « Collecte Utopya » par celui-ci (l’ancien ne marche plus).');
    } catch (err) {
      const msg = messageErreur(err, 'Nouvelle clé impossible');
      if (msg) toast.error(msg);
    } finally {
      if (monteRef.current) setOccupe('');
    }
  };

  const copierCollecteur = async () => {
    if (!collecteur?.url) return;
    try {
      await navigator.clipboard.writeText(collecteur.url);
      toast.success('Adresse du favori copiée : créez un favori et collez-la à la place de l’adresse.');
    } catch {
      toast.warning('Copie impossible : glissez le bouton dans la barre des favoris.');
    }
  };

  const clicFavori = (e) => {
    e.preventDefault();
    toast.info('Ne cliquez pas ici : glissez ce bouton dans la barre des favoris, puis cliquez-le sur utopya.fr.');
  };

  const description = indisponible
    ? { ton: 'neutre', titre: 'Synchro Mobilax : état indisponible pour le moment', detail: '' }
    : etat ? decrireMobilax(enCours ? { ...m, en_cours: true } : m) : { ton: 'neutre', titre: 'Synchro Mobilax : lecture de l’état…', detail: '' };
  const ton = TONS[description.ton] || TONS.neutre;
  const Icone = ton.Icone;
  const descriptionUtopya = indisponible
    ? { ton: 'neutre', titre: 'Collecte Utopya : état indisponible pour le moment', detail: '' }
    : etat ? decrireUtopya(u) : { ton: 'neutre', titre: 'Collecte Utopya : lecture de l’état…', detail: '' };
  const tonUtopya = TONS[descriptionUtopya.ton] || TONS.neutre;
  const IconeUtopya = tonUtopya.Icone;
  const utopyaDisponible = Boolean(u && u.disponible !== false);

  return (
    <div className={`space-y-3 ${className}`}>
      <section aria-labelledby={titreId} className={`callout ${ton.boite} flex-wrap items-center`}>
        <Icone aria-hidden="true" className={description.ton === 'info' ? 'motion-safe:animate-spin' : ''} />
        <div className="min-w-[240px] flex-1">
          <p id={titreId} className="font-semibold" role="status" aria-live="polite">{description.titre}</p>
          {description.detail && <p className="text-xs sm:text-sm">{description.detail}</p>}
        </div>

        {!enCours && m?.ok === true && <DiagnosticMobilax nombre={m?.resume?.sans_prix} estAdmin={estAdmin} />}

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
      </section>

      <section aria-labelledby={titreUtopyaId} className={`callout ${tonUtopya.boite} flex-wrap items-center`}>
        <IconeUtopya aria-hidden="true" className={descriptionUtopya.ton === 'info' ? 'motion-safe:animate-spin' : ''} />
        <div className="min-w-[240px] flex-1">
          <p id={titreUtopyaId} className="font-semibold" aria-live="polite">{descriptionUtopya.titre}</p>
          {descriptionUtopya.detail && <p className="text-xs sm:text-sm">{descriptionUtopya.detail}</p>}
        </div>

        {utopyaDisponible && !u?.en_cours && u?.ok === true && (
          <DiagnosticFournisseur nombre={u?.resume?.sans_prix} estAdmin={estAdmin} nom="Utopya" charger={() => api.getDiagnosticUtopya()} />
        )}

        {estAdmin && utopyaDisponible && (
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full">
            <button type="button" onClick={ouvrirCollecteur} aria-expanded={panneauUtopya} disabled={occupe === 'collecteur'}
              aria-busy={occupe === 'collecteur' || undefined} className="btn-primary btn-sm">
              {occupe === 'collecteur' ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
              {u?.configure ? 'Réinstaller le collecteur' : 'Installer le collecteur'}
            </button>
          </div>
        )}

        {estAdmin && panneauUtopya && (
          <div className="w-full rounded-xl border border-slate-200 bg-white p-4 text-slate-800">
            <p className="font-semibold flex items-center gap-2"><Info aria-hidden="true" className="w-4 h-4" /> Installer le collecteur Utopya (une fois)</p>
            {occupe === 'collecteur' && <p className="loading-inline mt-2" role="status"><Loader2 aria-hidden="true" /> Préparation du favori…</p>}
            {collecteur && (
              <ol className="mt-2 space-y-2 text-sm list-decimal pl-5">
                <li>
                  Affichez la barre des favoris de votre navigateur (Chrome : Cmd + Maj + B sur Mac, Ctrl + Maj + B sur Windows),
                  puis glissez ce bouton dedans :
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <LienFavori url={collecteur.url} onClick={clicFavori} />
                    <button type="button" onClick={copierCollecteur} className="btn-secondary btn-sm">
                      <Copy aria-hidden="true" /> Copier l’adresse du favori
                    </button>
                  </span>
                  <span className="block text-xs text-slate-600 mt-1">
                    Sans glisser-déposer : créez un favori nommé « Collecte Utopya » et collez l’adresse copiée à la place de l’URL.
                  </span>
                </li>
                <li>
                  Ouvrez <a href={collecteur.site || 'https://www.utopya.fr/'} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">utopya.fr<span className="sr-only"> (nouvel onglet)</span></a> et connectez-vous à votre compte : les prix ne s’affichent que connecté.
                </li>
                <li>
                  Sur utopya.fr, cliquez le favori « Collecte Utopya » : une petite fenêtre suit la lecture des pages des modèles de la grille
                  (quelques minutes), puis Klikphone met les prix d’achat à jour. Le résultat s’affiche ici. À refaire quand vous voulez
                  des prix Utopya frais (chaque semaine, par exemple).
                </li>
              </ol>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={regenererCle} disabled={Boolean(occupe) || !collecteur} aria-busy={occupe === 'cle' || undefined}
                className="btn-secondary btn-sm">
                <KeyRound aria-hidden="true" /> Nouvelle clé (l’ancien favori ne marchera plus)
              </button>
              <button type="button" onClick={() => setPanneauUtopya(false)} className="btn-secondary btn-sm">Fermer</button>
            </div>
          </div>
        )}
      </section>
      {adminPrompt}
    </div>
  );
}
