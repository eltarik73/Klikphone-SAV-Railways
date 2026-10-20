import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import {
  Tag, Search, RefreshCw, ChevronDown, ChevronRight, ChevronLeft, Smartphone, Tablet, Lock, Unlock, FileSpreadsheet,
  SlidersHorizontal, Calculator, History, AlertTriangle, Clock, CheckCircle2, X, Inbox, PackagePlus, Filter, Loader2,
  Info, ListPlus, Wrench,
} from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { useApi, invalidateCache } from '../hooks/useApi';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useToast } from '../components/Toast';
import AdminLoginModal from '../components/AdminLoginModal';
import HistoriquePrix, {
  BadgeDatePrix, FiltreAnciens, SEUILS_FRAICHEUR, dateFr, estEcran, euros, fraicheurPrix, fusionnerRegles, lireDate,
  messageErreurPrix, plusDeTroisMois,
} from '../components/HistoriquePrix';
import { TableauPieces, detailCalcul, estPieceApple, idPiece, liensFournisseur, nomPiece, sansAccents, texteCalcul } from '../components/PieceFournisseurRow';

// Fenêtres admin chargées à la demande (le personnel de l'accueil ne les ouvre jamais)
const ImportPrixModal = lazy(() => import('../components/ImportPrixModal'));
const ReglesPrixPanel = lazy(() => import('../components/ReglesPrixPanel'));
const FenetreRecalcul = lazy(() => import('../components/ReglesPrixPanel').then((m) => ({ default: m.FenetreRecalcul })));
const AjoutPiecePrix = lazy(() => import('../components/ReglesPrixPanel').then((m) => ({ default: m.AjoutPiecePrix })));

/**
 * « Réparation smartphones » : la grille des prix fournisseur (Mobilax / Utopya) de toutes les marques
 * hors iPhone (iPad / Mac compris), avec la méthode de calcul du prix client.
 * - Les iPhone ont leur grille boutique (« Réparation iPhone ») : un bandeau le rappelle.
 * - Navigation marque → modèle (catalogue ∪ pièces), tableau d'une ligne par pièce : prix d'achat HT
 *   (admin), détail du calcul, prix client TTC, fraîcheur, stock, cadenas, mise à jour du HT avec aperçu.
 * - Les tuiles « Santé des prix » du tableau de bord arrivent avec ?source= / ?fraicheur= / ?marge= :
 *   la page montre alors la liste des pièces concernées, toutes marques (mode filtré).
 * Aucune requête vers les sites fournisseurs : seulement des liens que le gérant ouvre dans son navigateur.
 */

// ─── Constantes ──────────────────────────────────
const AUCUNE_LIGNE = Object.freeze([]);
const BRAND_ORDER = ['Samsung', 'Xiaomi', 'Huawei', 'Honor', 'Google', 'Oppo', 'OnePlus', 'Motorola', 'Nothing', 'Realme', 'Vivo', 'Apple'];
const LIBELLE_MARQUE = { Apple: 'Apple (iPad / Mac)' };
const LIBELLE_CATEGORIE = { standard: 'Écran standard', haut_de_gamme: 'Écran haut de gamme', pliant: 'Écran pliant', ipad: 'iPad', macbook: 'MacBook' };
const SEUIL_MARGE_DEFAUT = 40;
const TVA_DEFAUT = 1.2;

const libelleMarque = (m) => LIBELLE_MARQUE[m] || m;
const trierMarques = (a, b) => {
  const ia = BRAND_ORDER.indexOf(a); const ib = BRAND_ORDER.indexOf(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1; if (ib >= 0) return 1;
  return a.localeCompare(b);
};
const mots = (texte) => sansAccents(texte).split(/\s+/).filter(Boolean);

// « Samsung Galaxy A12 » → marque + modèle quand le premier mot est une marque de la grille
export function decouperRecherche(texte, marques) {
  const t = String(texte || '').trim().replace(/\s+/g, ' ');
  const [premier, ...reste] = t.split(' ');
  const marque = marques.find((m) => m.toLowerCase() === (premier || '').toLowerCase());
  return marque && reste.length ? { marque, modele: reste.join(' ') } : { marque: '', modele: t };
}

// Modèles qui répondent à une recherche, toutes marques (chaque mot dans « marque modèle »)
export function chercherModeles(marques, texte) {
  const m = mots(texte);
  if (!m.length) return [];
  const out = [];
  for (const groupe of marques) {
    for (const x of groupe.modeles || []) {
      const cible = sansAccents(`${groupe.marque} ${x.modele}`);
      if (m.every((w) => cible.includes(w))) out.push({ ...x, marque: groupe.marque });
    }
  }
  return out;
}

// ─── Liste des modèles d'une marque : ceux qui ont des prix d'abord ───
// Le catalogue classe les modèles du plus récent au plus ancien : les nouveautés « à créer » (sans aucune
// pièce) passeraient devant les 77 modèles Samsung qui ont des prix. Le gérant cherche un prix : la vue
// « Avec prix » est le défaut, « À créer » isole les modèles vides, « Tous » garde l'ordre du catalogue
// avec les modèles sans prix en fin de liste.
export const VUES_MODELES = Object.freeze([
  { cle: 'prix', libelle: 'Avec prix' },
  { cle: 'a_creer', libelle: 'À créer' },
  { cle: 'tous', libelle: 'Tous' },
]);
export const modeleAvecPrix = (m) => Number(m?.nb_pieces) > 0;
export function trierModeles(modeles) {
  // Tri stable : l'ordre du catalogue est conservé dans chaque groupe
  return [...modeles].sort((a, b) => Number(modeleAvecPrix(b)) - Number(modeleAvecPrix(a)));
}
export function filtrerModeles(modeles, vue) {
  if (vue === 'prix') return modeles.filter(modeleAvecPrix);
  if (vue === 'a_creer') return modeles.filter((m) => !modeleAvecPrix(m));
  return trierModeles(modeles);
}

/** Phrase de la méthode de calcul (règles en vigueur), lisible en 5 secondes. */
export function phraseMethode(regles) {
  const r = fusionnerRegles(regles);
  const tva = String(r.tva).replace('.', ',');
  const arrondi = r.arrondi === 'entier' ? 'arrondi à l’euro supérieur' : 'arrondi au 9 supérieur';
  const marges = r.autre === r.ecran.standard
    ? `marge ${r.ecran.standard} € (écran standard, autres pièces), ${r.ecran.haut_de_gamme} € (écran haut de gamme), ${r.ecran.pliant} € (pliant)`
    : `marge ${r.ecran.standard} € (écran standard), ${r.ecran.haut_de_gamme} € (écran haut de gamme), ${r.ecran.pliant} € (pliant), ${r.autre} € (autres pièces)`;
  return `Prix client = ${arrondi} de (prix fournisseur HT × ${tva} + marge) · ${marges} · iPad +${r.ipad} €, MacBook +${r.macbook} €`;
}

// ─── Filtres reçus par l'URL (tuiles « Santé des prix » du tableau de bord) ───
// ?source=estimation, ?fraicheur=a_revoir|perime, ?marge=faible : valeurs connues uniquement (une valeur
// inconnue est ignorée). ?q= est géré à part (recherche préremplie).
export const FILTRES_URL = Object.freeze({
  source: Object.freeze(['estimation']),
  fraicheur: Object.freeze(['a_revoir', 'perime']),
  marge: Object.freeze(['faible']),
});

export function lireFiltresUrl(params) {
  const lire = (cle) => {
    const v = params?.get?.(cle);
    return FILTRES_URL[cle].includes(v) ? v : null;
  };
  return { source: lire('source'), fraicheur: lire('fraicheur'), marge: lire('marge') };
}

/**
 * Marge d'un écran : prix client − achat HT × TVA, au centime (même calcul que services/prix.sante).
 * Pièce fournisseur (écrans seulement) ou iPad / MacBook (`apple` : ecran_prix_vente − ecran_prix_ht).
 * null si ce n'est pas un écran ou si le prix d'achat est inconnu (masqué sans le code admin).
 */
export function margeEcran(row, tva = TVA_DEFAUT, apple = false) {
  if (!row) return null;
  if (!apple && !estEcran(row.type_piece)) return null;
  const ht = apple ? row.ecran_prix_ht : row.prix_fournisseur_ht;
  const prix = apple ? row.ecran_prix_vente : row.prix_client;
  if (ht === null || ht === undefined || ht === '' || prix === null || prix === undefined || prix === '') return null;
  const h = Number(ht);
  const p = Number(prix);
  const t = Number(tva) || TVA_DEFAUT;
  if (!Number.isFinite(h) || !Number.isFinite(p)) return null;
  return Math.round((p - h * t) * 100) / 100;
}

/** Une ligne (pièce, ou iPad / MacBook avec `apple`) passe-t-elle les filtres de l'URL ? */
export function correspondFiltresUrl(row, filtres, { seuils = SEUILS_FRAICHEUR, tva = TVA_DEFAUT, seuilMarge = SEUIL_MARGE_DEFAUT, apple = false } = {}) {
  if (!filtres) return true;
  const f = fraicheurPrix(row, seuils);
  if (filtres.source === 'estimation' && !f.estime) return false;
  if (filtres.fraicheur && f.niveau !== filtres.fraicheur) return false;
  if (filtres.marge === 'faible') {
    const m = margeEcran(row, tva, apple);
    if (m === null || !(m < seuilMarge)) return false;
  }
  return true;
}

// Libellés des filtres actifs (puces effaçables), seuils en vigueur compris
function libellesFiltresUrl(filtres, seuils, seuilMarge) {
  const out = [];
  if (filtres.source === 'estimation') out.push({ cle: 'source', libelle: 'Prix estimés (jamais vérifiés)' });
  if (filtres.fraicheur === 'a_revoir') out.push({ cle: 'fraicheur', libelle: `À revoir (plus de ${seuils.jours_a_revoir} jours)` });
  if (filtres.fraicheur === 'perime') out.push({ cle: 'fraicheur', libelle: `Périmés (plus de ${seuils.jours_perime} jours)` });
  if (filtres.marge === 'faible') out.push({ cle: 'marge', libelle: `Marges faibles (écrans, sous ${euros(seuilMarge)})` });
  return out;
}

// ─── Bandeau « Prix du fournisseur » (santé des prix) ─────────────
function resumeFraicheur(lignes, seuils, sante) {
  const total = lignes.length;
  let estimes = 0; let aRevoir = 0; let perimes = 0;
  let dateEstimation = null; let plusRecent = null;
  for (const l of lignes) {
    const f = fraicheurPrix(l, seuils);
    const d = lireDate(f.date);
    if (f.estime) {
      estimes += 1;
      if (d && (!dateEstimation || d < dateEstimation)) dateEstimation = d;
    }
    if (f.niveau === 'a_revoir') aRevoir += 1;
    if (f.niveau === 'perime') perimes += 1;
    if (d && (!plusRecent || d > plusRecent)) plusRecent = d;
  }
  // Les comptages du serveur font foi quand ils existent (même périmètre : pièces + iPad/MacBook)
  if (sante && Number.isFinite(sante.total) && sante.total > 0) {
    return {
      total: sante.total,
      estimes: Number(sante.estimes) || 0,
      aRevoir: Number(sante.a_revoir) || 0,
      perimes: Number(sante.perimes) || 0,
      dateEstimation,
      plusRecent: plusRecent || lireDate(sante.derniere_maj || sante.plus_recent) || null,
    };
  }
  return { total, estimes, aRevoir, perimes, dateEstimation, plusRecent };
}

function BandeauPrix({ resume, sante, chargement = false, isAdmin, onImporter, onRegles, onRecalculer, onHistorique, onAjouter, onDevenirAdmin, basePath }) {
  const { total, estimes, aRevoir, perimes, dateEstimation, plusRecent } = resume;
  const tousEstimes = total > 0 && estimes >= total;
  let titre;
  if (!total && chargement) titre = 'Prix du fournisseur : lecture de l’état des prix…';
  else if (!total) titre = 'Prix du fournisseur : aucun prix enregistré';
  else if (tousEstimes) titre = `Prix du fournisseur : estimés le ${dateEstimation ? dateFr(dateEstimation) : '15/02/2026'}`;
  else if (estimes > 0) titre = `Prix du fournisseur : ${total - estimes} mis à jour, ${estimes} encore estimés${dateEstimation ? ` (${dateFr(dateEstimation)})` : ''}`;
  else titre = `Prix du fournisseur : mis à jour${plusRecent ? ` le ${dateFr(plusRecent)}` : ''}`;

  // Prix périmés ou à revoir = attention (ambre) ; grille à jour = succès. Jamais de rouge pour un simple rappel.
  const ton = perimes > 0
    ? { boite: 'callout-warning', icone: AlertTriangle }
    : aRevoir > 0
      ? { boite: 'callout-warning', icone: Clock }
      : { boite: 'callout-success', icone: CheckCircle2 };
  const Icone = ton.icone;
  const details = [];
  if (perimes > 0) details.push(`${perimes} prix de plus de 6 mois`);
  if (aRevoir > 0) details.push(`${aRevoir} à revoir (plus de 3 mois)`);
  if (tousEstimes) details.push('jamais vérifiés depuis');
  if (sante?.propositions_en_attente > 0) details.push(`${sante.propositions_en_attente} proposition${sante.propositions_en_attente > 1 ? 's' : ''} venant des commandes à valider`);
  if (sante?.marges_faibles > 0) details.push(`${sante.marges_faibles} marge${sante.marges_faibles > 1 ? 's' : ''} trop faible${sante.marges_faibles > 1 ? 's' : ''}`);

  const action = 'btn-secondary btn-sm';
  const actionPrincipale = 'btn-primary btn-sm';
  return (
    <section aria-label="État des prix" className={`callout ${ton.boite} flex-wrap items-center`}>
      <Icone aria-hidden="true" />
      <div className="min-w-[240px] flex-1">
        <p className="font-semibold">{titre}</p>
        {/* Ligne réservée pendant la lecture : l'arrivée des détails ne décale pas la page (CLS) */}
        {(details.length > 0 || chargement) && <p className="text-xs sm:text-sm min-h-4 sm:min-h-5">{details.join(' · ')}</p>}
      </div>
      {isAdmin ? (
        // Actions sur leur propre ligne : la longueur du texte (arrivé après coup) ne les déplace pas
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full">
          <button type="button" onClick={onRegles} className={action}>
            <SlidersHorizontal aria-hidden="true" /> Règles de prix
          </button>
          <button type="button" onClick={onRecalculer} className={action}>
            <Calculator aria-hidden="true" /> Recalculer
          </button>
          <button type="button" onClick={onHistorique} className={action}>
            <History aria-hidden="true" /> Historique
          </button>
          <button type="button" onClick={onAjouter} className={action}>
            <PackagePlus aria-hidden="true" /> Ajouter une pièce
          </button>
          {/* Toujours présent (le nombre arrive avec la santé des prix) : aucun bouton ne saute de ligne */}
          <Link to={`${basePath}/prix-a-revoir?onglet=propositions`} className={`${action} col-span-2`}>
            <Inbox aria-hidden="true" /> Propositions des commandes{sante?.propositions_en_attente > 0 ? ` (${sante.propositions_en_attente})` : ''}
          </Link>
          {/* Action principale toujours sur la ligne suivante : stable quel que soit le nombre de propositions */}
          <span className="hidden sm:block basis-full h-0" aria-hidden="true" />
          <button type="button" onClick={onImporter} className={`${actionPrincipale} col-span-2`}>
            <FileSpreadsheet aria-hidden="true" /> Importer une liste de prix
          </button>
        </div>
      ) : (
        <button type="button" onClick={onDevenirAdmin} className={action}>
          <Lock aria-hidden="true" /> Mettre à jour les prix (admin)
        </button>
      )}
    </section>
  );
}

// ─── Encadré « Méthode de calcul » ───────────────
// Règles lues (code admin) : phrase et exemple calculés ici, à jour dès une modification. Sinon phrase
// du serveur (GET /api/tarifs/methode-calcul) : sans montants pour le personnel, qui pourrait en déduire
// le coût HT masqué ; jamais de « valeurs par défaut » supposées, fausses dès qu'une marge change.
function MethodeCalcul({ regles, methode, isAdmin, onModifier }) {
  const texte = regles ? phraseMethode(regles) : methode?.texte || '';
  const exemple = regles ? detailCalcul(42, 'Ecran', 'standard', regles) : methode?.exemple || null;
  return (
    <section aria-labelledby="methode-calcul-titre" className="card card-body flex flex-wrap items-start gap-3">
      <Calculator className="w-5 h-5 shrink-0 text-brand-600 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-[240px]">
        <h2 id="methode-calcul-titre" className="t-h3">Méthode de calcul</h2>
        {texte
          ? <p className="t-body mt-1 text-slate-800">{texte}</p>
          : <p className="t-body mt-1 text-slate-500 min-h-[3rem]">Prix client = prix fournisseur HT × TVA + marge selon la pièce, arrondi.</p>}
        {exemple && (
          <p className="t-caption mt-1 tabular-nums">
            Exemple, écran standard acheté 42,00 € HT : {texteCalcul(exemple)}
          </p>
        )}
      </div>
      {isAdmin && (
        <button type="button" onClick={onModifier} className="btn-secondary btn-sm">
          <SlidersHorizontal aria-hidden="true" /> Modifier les règles
        </button>
      )}
    </section>
  );
}

// ─── Badge d'âge d'un modèle (plus vieux prix) ───
function AgeModele({ jours, seuils }) {
  if (jours === null || jours === undefined) return null;
  const j = Number(jours);
  if (!Number.isFinite(j)) return null;
  const titre = `Prix le plus ancien : ${j} jours`;
  if (j > seuils.jours_perime) return <span className="badge badge-sm badge-danger" title={`${titre} (périmé)`}><AlertTriangle className="w-3 h-3" aria-hidden="true" /> {j} j<span className="sr-only">, prix périmé</span></span>;
  if (j > seuils.jours_a_revoir) return <span className="badge badge-sm badge-warning" title={`${titre} (à revoir)`}><Clock className="w-3 h-3" aria-hidden="true" /> {j} j<span className="sr-only">, prix à revoir</span></span>;
  return null;
}

// ─── Composant principal ─────────────────────────
export default function TarifsPage() {
  const toast = useToast();
  const location = useLocation();
  const basePath = location.pathname.startsWith('/tech') ? '/tech' : '/accueil';
  const { sensible: sensibleBrut, adminPrompt } = useAdminElevation();
  const [searchParams, setSearchParams] = useSearchParams();
  const rechercheLien = searchParams.get('q') || '';
  const marqueUrl = searchParams.get('marque') || '';
  const modeleUrl = searchParams.get('modele') || '';
  // Filtres envoyés par les tuiles « Santé des prix » : l'URL fait foi (retour arrière, lien partagé)
  const { source: filtreSource, fraicheur: filtreFraicheur, marge: filtreMarge } = lireFiltresUrl(searchParams);
  const filtresUrl = useMemo(
    () => ({ source: filtreSource, fraicheur: filtreFraicheur, marge: filtreMarge }),
    [filtreSource, filtreFraicheur, filtreMarge],
  );
  const filtreUrlActif = Boolean(filtreSource || filtreFraicheur || filtreMarge);
  const [anciensSeuls, setAnciensSeuls] = useState(false);
  const modeFiltre = filtreUrlActif || anciensSeuls;
  const [vueModeles, setVueModeles] = useState('prix'); // 'prix' | 'a_creer' | 'tous' (liste d'une marque)
  const rechercheRef = useRef(null);
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem('klikphone_admin') === 'true');
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [fenetre, setFenetre] = useState(null); // 'import' | 'regles' | 'historique' | 'recalcul' | 'ajout'
  const [ajoutInitial, setAjoutInitial] = useState(null);
  const [enCours, setEnCours] = useState(null);
  const [sante, setSante] = useState(null);
  const [regles, setReglesEtat] = useState(null);
  const [methode, setMethode] = useState(null);
  const [santeLue, setSanteLue] = useState(false);
  const isAdminRef = useRef(isAdmin);
  isAdminRef.current = isAdmin;
  const methodeAdminRef = useRef(false);
  methodeAdminRef.current = methode?.admin === true;
  const chargerMethode = useCallback(() => {
    if (typeof api.getMethodeCalcul !== 'function') return;
    Promise.resolve().then(() => api.getMethodeCalcul())
      .then((m) => setMethode(m && typeof m === 'object' && !Array.isArray(m) ? m : null)).catch(() => {});
  }, []);
  const reglesRef = useRef(null);
  const setRegles = useCallback((r) => { reglesRef.current = r; setReglesEtat(r); }, []);

  // « Saisir le prix » (modèles sans prix) arrive avec ?q=<marque modèle> : recherche préremplie
  const [search, setSearch] = useState(rechercheLien);
  const [debouncedSearch, setDebouncedSearch] = useState(rechercheLien);
  const searchTimer = useRef(null);

  // ─── Données : marques → modèles, puis le modèle choisi ───
  const { data: marquesData, loading: loadingMarques, error: erreurMarques, isRevalidating, mutate: mutateMarques } = useApi(
    'rs-marques', () => api.getReparationSmartphonesMarques(), { tags: ['tarifs'], ttl: 300_000 },
  );
  const marques = useMemo(() => {
    const liste = Array.isArray(marquesData) ? marquesData : [];
    return liste.filter((m) => m?.marque).map((m) => ({ ...m, modeles: Array.isArray(m.modeles) ? m.modeles : [] }))
      .sort((a, b) => trierMarques(a.marque, b.marque));
  }, [marquesData]);
  const nomsMarques = useMemo(() => marques.map((m) => m.marque), [marques]);
  const cleModele = marqueUrl && modeleUrl ? `rs-modele:${marqueUrl}::${modeleUrl}` : null;
  const { data: modeleData, loading: loadingModele, error: erreurModele, mutate: mutateModele } = useApi(
    cleModele, () => api.getReparationSmartphonesModele({ marque: marqueUrl, modele: modeleUrl }), { tags: ['tarifs'], ttl: 300_000 },
  );
  const pieces = useMemo(() => (Array.isArray(modeleData?.pieces) ? modeleData.pieces : AUCUNE_LIGNE), [modeleData]);

  // Liste complète des pièces : seulement en mode filtré (tuiles du tableau de bord, « plus de 3 mois »)
  // et pour les fenêtres qui associent ou ajustent toute la grille (import, règles)
  const listeUtile = modeFiltre || fenetre === 'import' || fenetre === 'regles';
  const { data: tarifsData, loading: loadingListe, mutate: mutateListe } = useApi(
    listeUtile ? 'tarifs' : null,
    async () => {
      const [t, ad] = await Promise.all([api.getTarifs(), api.getAppleDevices().catch(() => [])]);
      return { tarifs: Array.isArray(t) ? t : [], appleDevices: ad || [] };
    },
    { tags: ['tarifs'], ttl: 300_000 },
  );
  const tousTarifs = tarifsData?.tarifs ?? AUCUNE_LIGNE;
  const tarifs = useMemo(() => tousTarifs.filter((t) => !t.obsolete), [tousTarifs]);
  const appleDevices = tarifsData?.appleDevices ?? AUCUNE_LIGNE;

  // Prix d'achat HT : envoyés par le serveur seulement avec le code admin saisi sur ce poste
  const adminReconnu = modeleData?.admin === true || (modeleData?.admin === undefined && pieces.some((p) => p.prix_fournisseur_ht !== null && p.prix_fournisseur_ht !== undefined));
  const htVisibleModele = isAdmin && adminReconnu;
  const htMasqueModele = isAdmin && !!modeleData && !adminReconnu && (pieces.length > 0 || modeleData.admin === false);
  const htMasquesListe = tousTarifs.length > 0 && !tousTarifs.some((t) => Object.prototype.hasOwnProperty.call(t, 'prix_fournisseur_ht'));
  const htVisibleListe = isAdmin && tousTarifs.length > 0 && !htMasquesListe;
  const htMasqueRef = useRef(false);
  htMasqueRef.current = htMasqueModele || (modeFiltre && htMasquesListe);
  const mutateModeleRef = useRef(mutateModele);
  mutateModeleRef.current = mutateModele;
  const mutateListeRef = useRef(mutateListe);
  mutateListeRef.current = mutateListe;
  const relectureHt = useRef(null);
  const relirePrixAchat = useCallback(() => {
    if (!relectureHt.current) {
      relectureHt.current = api.getPrixAchat()
        .then(({ tarifs: t, appleDevices: ad }) => {
          if (!t.some((x) => Object.prototype.hasOwnProperty.call(x, 'prix_fournisseur_ht'))) return false;
          mutateListeRef.current((prev) => (prev ? { ...prev, tarifs: t, appleDevices: ad } : { tarifs: t, appleDevices: ad }));
          return true;
        })
        .catch(() => false)
        .finally(() => { relectureHt.current = null; });
    }
    return relectureHt.current;
  }, []);
  const modeFiltreRef = useRef(modeFiltre);
  modeFiltreRef.current = modeFiltre;
  // Après une action admin réussie : règles relues si elles manquaient, prix d'achat relus s'ils étaient masqués
  const sensible = useCallback(async (fn) => {
    const res = await sensibleBrut(fn);
    if (!reglesRef.current) api.getReglesPrix().then(setRegles).catch(() => {});
    if (!methodeAdminRef.current) chargerMethode();
    if (htMasqueRef.current) {
      if (modeFiltreRef.current) relirePrixAchat();
      mutateModeleRef.current();
    }
    return res;
  }, [sensibleBrut, relirePrixAchat, setRegles, chargerMethode]);

  // Santé des prix et méthode de calcul (personnel) : lues sans rien demander, un refus est sans effet.
  // Règles (montants des marges) : seulement en mode admin ou avec l'élévation, sinon 403 assuré à
  // chaque ouverture ; relues après la saisie du code.
  const chargerSante = useCallback(() => {
    if (typeof api.getSantePrix !== 'function') { setSanteLue(true); return; }
    Promise.resolve().then(() => api.getSantePrix()).then(setSante).catch(() => {}).finally(() => setSanteLue(true));
  }, []);
  const chargerRegles = useCallback(() => {
    if (typeof api.getReglesPrix !== 'function') return;
    if (!isAdminRef.current && api.hasAdminToken?.() !== true) return;
    Promise.resolve().then(() => api.getReglesPrix()).then(setRegles).catch(() => {});
  }, [setRegles]);
  useEffect(() => { chargerSante(); chargerMethode(); chargerRegles(); }, [chargerSante, chargerMethode, chargerRegles]);
  useEffect(() => { if (rechercheLien) setSearch(rechercheLien); }, [rechercheLien]);

  // Recherche différée (300 ms)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  // Règles lues avec le code admin ; à défaut, seuils renvoyés par la santé des prix (personnel)
  const seuils = useMemo(() => ({
    jours_a_revoir: Number(regles?.jours_a_revoir ?? sante?.seuils?.jours_a_revoir) || SEUILS_FRAICHEUR.jours_a_revoir,
    jours_perime: Number(regles?.jours_perime ?? sante?.seuils?.jours_perime) || SEUILS_FRAICHEUR.jours_perime,
  }), [regles, sante]);
  const contexteFiltres = useMemo(() => {
    const seuilLu = regles?.seuil_marge_alerte ?? sante?.seuils?.seuil_marge_alerte;
    const seuilMarge = seuilLu !== null && seuilLu !== undefined && seuilLu !== '' && Number.isFinite(Number(seuilLu))
      ? Number(seuilLu) : SEUIL_MARGE_DEFAUT;
    return { seuils, tva: Number(regles?.tva) || TVA_DEFAUT, seuilMarge };
  }, [seuils, regles, sante]);

  const relire = useCallback(() => {
    invalidateCache('tarifs');
    chargerSante();
    chargerMethode();
    chargerRegles();
  }, [chargerSante, chargerMethode, chargerRegles]);

  // ─── Navigation marque → modèle (dans l'URL : retour arrière, lien partageable) ───
  const resultatsRecherche = useMemo(() => (mots(debouncedSearch).length ? chercherModeles(marques, debouncedSearch) : null), [marques, debouncedSearch]);
  const marqueActive = marqueUrl || marques[0]?.marque || '';
  const groupeActif = marques.find((m) => m.marque === marqueActive) || null;
  const modeleActif = groupeActif?.modeles.find((x) => x.modele === modeleUrl) || null;
  const modeleChoisi = Boolean(marqueUrl && modeleUrl);

  const poserParams = useCallback((fn, options) => {
    setSearchParams((prev) => { const p = new URLSearchParams(prev); fn(p); return p; }, options);
  }, [setSearchParams]);
  const choisirMarque = useCallback((m) => {
    poserParams((p) => { if (m) p.set('marque', m); else p.delete('marque'); p.delete('modele'); });
  }, [poserParams]);
  const choisirModele = useCallback((marque, modele, options) => {
    poserParams((p) => { p.set('marque', marque); p.set('modele', modele); }, options);
  }, [poserParams]);

  // Arrivée avec ?q= (« Saisir le prix ») : un seul modèle correspond → ouvert tout de suite
  const autoChoisi = useRef(false);
  useEffect(() => {
    if (autoChoisi.current || !rechercheLien || loadingMarques || marqueUrl || modeFiltre) return;
    autoChoisi.current = true;
    const res = chercherModeles(marques, rechercheLien);
    if (res.length === 1) choisirModele(res[0].marque, res[0].modele, { replace: true });
  }, [rechercheLien, loadingMarques, marques, marqueUrl, modeFiltre, choisirModele]);

  // Puce « × » d'un filtre de l'URL : retiré de l'adresse (les autres paramètres, dont ?q=, restent)
  function retirerFiltresUrl(cles) {
    poserParams((p) => { for (const c of cles) p.delete(c); }, { replace: true });
    // Le bouton disparaît : le focus revient sur la recherche plutôt que d'être perdu
    rechercheRef.current?.focus();
  }

  // Filtre « marges faibles » : il faut les prix d'achat HT (code admin), relus puis la grille filtrée
  const [lectureMarges, setLectureMarges] = useState(false);
  async function afficherMarges() {
    setLectureMarges(true);
    try {
      await sensibleBrut(() => api.getReglesPrix()).then(setRegles);
      if (await relirePrixAchat()) {
        try { if (localStorage.getItem('klikphone_admin') === 'true') setIsAdmin(true); } catch { /* stockage indisponible */ }
      } else {
        toast.error('Prix d’achat HT indisponibles : identification administrateur requise.');
      }
    } catch (e) {
      const msg = messageErreurPrix(e, 'Marges indisponibles');
      if (msg) toast.error(msg);
    } finally {
      setLectureMarges(false);
    }
  }

  // Prix d'achat masqués (admin sans le code sur ce poste) : identification puis relecture du modèle
  const [lectureHt, setLectureHt] = useState(false);
  async function afficherPrixAchat() {
    setLectureHt(true);
    try {
      await sensibleBrut(() => api.getReglesPrix()).then(setRegles);
      await mutateModele();
    } catch (e) {
      const msg = messageErreurPrix(e, 'Prix d’achat HT indisponibles');
      if (msg) toast.error(msg);
    } finally {
      setLectureHt(false);
    }
  }

  // ─── Écritures (admin prouvé) ───
  // Une pièce modifiée est mise à jour dans le modèle ouvert et dans la liste filtrée
  const majPiece = useCallback((ident, patch) => {
    const appliquer = (p) => (idPiece(p) === ident ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } : p);
    mutateModeleRef.current((prev) => (prev?.pieces ? { ...prev, pieces: prev.pieces.map(appliquer) } : prev));
    mutateListeRef.current((prev) => (prev?.tarifs ? { ...prev, tarifs: prev.tarifs.map(appliquer) } : prev));
  }, []);

  async function enregistrerHt(piece, corps) {
    const ident = idPiece(piece);
    setEnCours(ident);
    try {
      let client;
      if (estPieceApple(piece)) {
        // Écran / batterie d'un iPad ou MacBook : route dédiée, prix de vente recalculé par le serveur
        const { url_fournisseur: _url, ...reste } = corps;
        const res = await sensible(() => api.patchPrixAppleDevice(piece.device_id, { ...reste, piece: piece.piece }));
        client = res?.nouveau_client ?? piece.prix_client;
        majPiece(ident, {
          prix_fournisseur_ht: res?.nouveau_ht ?? corps.prix_fournisseur_ht, prix_client: client, prix_source: corps.source,
          prix_maj_le: new Date().toISOString(), age_jours: 0, fraicheur: 'ok', estime: false, a_renseigner: false, calcul: null,
          ref_fournisseur: corps.ref_fournisseur ?? piece.ref_fournisseur,
        });
      } else {
        const res = await sensible(() => api.patchPrixPiece(piece.id, corps));
        const ligne = res && typeof res === 'object' ? res : {};
        client = ligne.prix_client ?? piece.prix_client;
        majPiece(ident, (p) => ({
          ...ligne,
          prix_fournisseur_ht: ligne.prix_fournisseur_ht ?? corps.prix_fournisseur_ht,
          verrou: ligne.verrou ?? ligne.verrou_manuel ?? p.verrou ?? p.verrou_manuel,
          a_renseigner: false,
          calcul: ligne.calcul ?? null,
        }));
      }
      toast.success(`${nomPiece(piece, marqueUrl, modeleUrl)} : achat ${euros(corps.prix_fournisseur_ht)} HT → prix client ${euros(client)}.`);
      invalidateCache('tarifs');
      chargerSante();
    } finally {
      setEnCours(null);
    }
  }

  async function basculerVerrou(piece, marque = marqueUrl, modele = modeleUrl) {
    const ident = idPiece(piece);
    setEnCours(ident);
    const verrouiller = !(piece.verrou ?? piece.verrou_manuel);
    try {
      const res = await sensible(() => (estPieceApple(piece)
        ? api.setVerrouPrix(piece.device_id, verrouiller, 'tarifs_apple_devices')
        : api.setVerrouPrix(piece.id, verrouiller)));
      const valeur = typeof res?.verrou_manuel === 'boolean' ? res.verrou_manuel : verrouiller;
      majPiece(ident, { verrou: valeur, verrou_manuel: valeur });
      toast.success(valeur ? `${nomPiece(piece, marque, modele)} : prix verrouillé.` : `${nomPiece(piece, marque, modele)} : prix déverrouillé.`);
    } catch (e) {
      const msg = messageErreurPrix(e, 'Verrou non enregistré');
      if (msg) toast.error(msg);
    } finally {
      setEnCours(null);
    }
  }

  async function basculerStock(piece) {
    try {
      const res = await sensible(() => api.toggleTarifStock(piece.id));
      majPiece(idPiece(piece), { en_stock: typeof res?.en_stock === 'boolean' ? res.en_stock : piece.en_stock === false });
    } catch (e) {
      const msg = messageErreurPrix(e, 'Stock non modifié');
      if (msg) toast.error(msg);
    }
  }

  async function ajouterPiecesCourantes() {
    setEnCours('courantes');
    try {
      const res = await sensible(() => api.creerPiecesCourantes({ marque: marqueUrl, modele: modeleUrl }));
      const crees = Array.isArray(res) ? res.length : (res?.crees?.length ?? res?.pieces?.length ?? null);
      toast.success(crees === 0
        ? `${marqueUrl} ${modeleUrl} : les pièces courantes existent déjà.`
        : `${marqueUrl} ${modeleUrl} : ${crees ?? 'les'} pièce${crees === 1 ? '' : 's'} courante${crees === 1 ? '' : 's'} ajoutée${crees === 1 ? '' : 's'}, prix à renseigner.`);
      invalidateCache('tarifs');
      chargerSante();
    } catch (e) {
      const msg = messageErreurPrix(e, 'Pièces non ajoutées');
      if (msg) toast.error(msg);
    } finally {
      setEnCours(null);
    }
  }

  function ouvrirAjout(initial) {
    setAjoutInitial(typeof initial === 'string' ? decouperRecherche(initial, nomsMarques) : initial);
    setFenetre('ajout');
  }
  // Pièce ajoutée (ou déjà existante) : grille relue, le modèle concerné s'ouvre
  function pieceAjoutee(ligne) {
    setFenetre(null);
    relire();
    if (ligne?.marque && ligne?.modele) choisirModele(ligne.marque, ligne.modele);
  }
  const fermerFenetre = () => setFenetre(null);

  // ─── Mode filtré : pièces concernées, toutes marques ───
  const filtered = useMemo(() => {
    if (!modeFiltre) return AUCUNE_LIGNE;
    let result = tarifs;
    if (anciensSeuls) result = result.filter((t) => plusDeTroisMois(t, seuils));
    if (filtreUrlActif) result = result.filter((t) => correspondFiltresUrl(t, filtresUrl, contexteFiltres));
    const m = mots(debouncedSearch);
    if (m.length) {
      result = result.filter((t) => {
        const texte = sansAccents(`${t.marque} ${t.modele} ${t.type_piece} ${t.qualite || ''}`);
        return m.every((w) => texte.includes(w));
      });
    }
    return result;
  }, [modeFiltre, tarifs, anciensSeuls, seuils, filtreUrlActif, filtresUrl, contexteFiltres, debouncedSearch]);
  const groupes = useMemo(() => {
    const parMarque = new Map();
    for (const t of filtered) {
      if (!parMarque.has(t.marque)) parMarque.set(t.marque, new Map());
      const modeles = parMarque.get(t.marque);
      if (!modeles.has(t.modele)) modeles.set(t.modele, []);
      modeles.get(t.modele).push(t);
    }
    return [...parMarque.entries()].sort(([a], [b]) => trierMarques(a, b)).map(([marque, modeles]) => ({
      marque,
      modeles: [...modeles.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([modele, items]) => ({ modele, items })),
    }));
  }, [filtered]);
  const devicesVisibles = useMemo(() => {
    if (!modeFiltre) return AUCUNE_LIGNE;
    let liste = appleDevices;
    if (anciensSeuls) liste = liste.filter((d) => plusDeTroisMois(d, seuils));
    if (filtreUrlActif) liste = liste.filter((d) => correspondFiltresUrl(d, filtresUrl, { ...contexteFiltres, apple: true }));
    const m = mots(debouncedSearch);
    if (m.length) liste = liste.filter((d) => m.every((w) => sansAccents(`Apple ${d.categorie || ''} ${d.modele || ''}`).includes(w)));
    return liste;
  }, [modeFiltre, appleDevices, anciensSeuls, seuils, filtreUrlActif, filtresUrl, contexteFiltres, debouncedSearch]);
  const filtresActifs = useMemo(
    () => libellesFiltresUrl(filtresUrl, seuils, contexteFiltres.seuilMarge),
    [filtresUrl, seuils, contexteFiltres.seuilMarge],
  );
  const nbCorrespondants = filtered.length + devicesVisibles.length;
  const htAppleMasques = appleDevices.length > 0 && !appleDevices.some((d) => Object.prototype.hasOwnProperty.call(d, 'ecran_prix_ht'));
  const margesMasquees = modeFiltre && filtreMarge === 'faible' && (htMasquesListe || htAppleMasques);
  const nombreAnciens = sante ? (Number(sante.a_revoir) || 0) + (Number(sante.perimes) || 0) : null;
  const resume = useMemo(() => resumeFraicheur(modeFiltre ? [...tarifs, ...appleDevices] : [], seuils, sante), [modeFiltre, tarifs, appleDevices, seuils, sante]);
  // Marques repliées à la main (ouvertes par défaut quand les résultats restent lisibles)
  const [replies, setReplies] = useState(() => new Set());
  const ouvertesParDefaut = nbCorrespondants > 0 && nbCorrespondants <= 40;
  const marqueOuverte = (m) => (replies.has(m) ? !ouvertesParDefaut : ouvertesParDefaut);
  const basculerMarque = (m) => setReplies((prev) => { const n = new Set(prev); n.has(m) ? n.delete(m) : n.add(m); return n; });
  const margeDe = filtreMarge === 'faible'
    ? (p) => { const m = margeEcran(p, contexteFiltres.tva); return m === null ? null : `Marge : ${euros(m)} (seuil ${euros(contexteFiltres.seuilMarge)})`; }
    : null;

  // Libellés de l'historique (table + ligne → pièce)
  const nommer = useCallback((l) => {
    if (l.label) return l.label;
    if (l.table_nom === 'tarifs') {
      const t = tousTarifs.find((x) => x.id === l.ligne_id) || (modeleData?.pieces || []).find((x) => x.id === l.ligne_id);
      return t ? nomPiece(t, t.marque || marqueUrl, t.modele || modeleUrl) : null;
    }
    if (l.table_nom === 'tarifs_apple_devices') {
      const d = appleDevices.find((x) => x.id === l.ligne_id);
      return d ? d.modele : null;
    }
    return null;
  }, [tousTarifs, appleDevices, modeleData, marqueUrl, modeleUrl]);

  const nbModeles = marques.reduce((s, m) => s + m.modeles.length, 0);
  const nbPieces = marques.reduce((s, m) => s + m.modeles.reduce((x, y) => x + (Number(y.nb_pieces) || 0), 0), 0);
  const liensModele = modeleData?.liens || liensFournisseur({ marque: marqueUrl, modele: modeleUrl });
  const catalogueAjout = useMemo(() => pieces.map((p) => ({ ...p, marque: marqueUrl, modele: modeleUrl })), [pieces, marqueUrl, modeleUrl]);

  // ─── Rendus ───
  function renderListeModeles() {
    const base = resultatsRecherche ?? (groupeActif?.modeles.map((x) => ({ ...x, marque: groupeActif.marque })) || []);
    const nbAvecPrix = base.filter(modeleAvecPrix).length;
    const nbACreer = base.length - nbAvecPrix;
    // Recherche : tous les résultats, ceux qui ont des prix d'abord. Marque : « Avec prix » par défaut,
    // sauf quand la marque n'a encore aucun prix (la liste serait vide d'emblée)
    const vue = resultatsRecherche || (vueModeles === 'prix' && nbAvecPrix === 0) ? 'tous' : vueModeles;
    const liste = filtrerModeles(base, vue);
    const compteurs = { prix: nbAvecPrix, a_creer: nbACreer, tous: base.length };
    const titre = resultatsRecherche
      ? `${base.length} modèle${base.length > 1 ? 's' : ''} pour « ${debouncedSearch.trim()} »`
      : `${libelleMarque(marqueActive)} · ${base.length} modèle${base.length > 1 ? 's' : ''}`;
    let vide;
    if (resultatsRecherche) vide = `Aucun modèle pour « ${debouncedSearch.trim()} ».`;
    else if (base.length === 0) vide = 'Aucun modèle pour cette marque.';
    else if (vue === 'a_creer') vide = `Tous les modèles ${libelleMarque(marqueActive)} ont des prix.`;
    else vide = 'Aucun modèle avec prix pour cette marque.';
    return (
      <div className={`card overflow-hidden min-w-0 ${modeleChoisi ? 'hidden xl:block' : ''}`}>
        <div className="card-header py-3 flex-col items-stretch gap-2">
          <h2 className="t-h3 truncate">{titre}</h2>
          {!resultatsRecherche && base.length > 0 && (
            <div className="segmented w-full" role="group" aria-label="Modèles affichés">
              {VUES_MODELES.map((v) => (
                <button key={v.cle} type="button" aria-pressed={vue === v.cle} onClick={() => setVueModeles(v.cle)}
                  className={`segmented-item flex-1 px-2 ${vue === v.cle ? 'segmented-item-active' : ''}`}>
                  {v.libelle} <span className="text-slate-500 tabular-nums">{compteurs[v.cle]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {liste.length === 0 ? (
          <div className="empty-state max-h-none">
            <div className="empty-state-icon"><Search aria-hidden="true" /></div>
            <p className="t-body text-slate-500 max-w-sm">{vide}</p>
            {resultatsRecherche && (isAdmin ? (
              <button type="button" onClick={() => ouvrirAjout(debouncedSearch)} className="btn-primary">
                <PackagePlus aria-hidden="true" /> Ajouter une pièce pour ce modèle
              </button>
            ) : (
              <p className="text-sm text-slate-500">Un administrateur peut l’ajouter : « Mettre à jour les prix (admin) » en haut de page.</p>
            ))}
          </div>
        ) : (
          /* `relative` : les textes « sr-only » des badges sont en position absolue ; sans ancêtre positionné
             dans la liste, ils échappent au rognage et étendent le document de toute la hauteur de la liste */
          <ul className="relative divide-y divide-slate-100 border-t border-slate-100 max-h-[60vh] xl:max-h-[70vh] overflow-y-auto" aria-label="Modèles">
            {liste.map((x) => {
              const actif = x.marque === marqueUrl && x.modele === modeleUrl;
              const sansPiece = !(Number(x.nb_pieces) > 0);
              return (
                <li key={`${x.marque}::${x.modele}`}>
                  <button type="button" onClick={() => choisirModele(x.marque, x.modele)} aria-current={actif ? 'true' : undefined}
                    className={`w-full min-h-12 px-4 py-2 flex items-center gap-2 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${actif ? 'bg-brand-50/60' : 'hover:bg-slate-50'}`}>
                    <ChevronRight className={`w-4 h-4 shrink-0 ${actif ? 'text-brand-600' : 'text-slate-300'}`} aria-hidden="true" />
                    <span className="flex-1 min-w-0">
                      <span className={`block text-sm truncate ${actif ? 'font-semibold text-brand-800' : 'font-medium text-slate-900'}`}>
                        {resultatsRecherche ? `${x.marque} ${x.modele}` : x.modele}
                      </span>
                      <span className="block t-caption">
                        {sansPiece ? 'Aucune pièce' : `${x.nb_pieces} pièce${x.nb_pieces > 1 ? 's' : ''}`}
                        {x.marque === 'Apple' && x.categorie ? ` · ${x.categorie}` : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      {Number(x.nb_sans_prix) > 0 && <span className="badge badge-sm badge-warning">{x.nb_sans_prix} à renseigner</span>}
                      {sansPiece && <span className="badge badge-sm badge-neutral">à créer</span>}
                      <AgeModele jours={x.plus_vieux_jours} seuils={seuils} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  function renderModele() {
    if (!modeleChoisi) {
      return (
        <div className="card empty-state hidden xl:flex">
          <div className="empty-state-icon"><Smartphone aria-hidden="true" /></div>
          <p className="t-body text-slate-500 max-w-sm">Choisissez un modèle : ses pièces, leur prix client et, pour l’administrateur, le prix fournisseur et le calcul.</p>
        </div>
      );
    }
    const categoriePrix = pieces.find((p) => p.categorie && LIBELLE_CATEGORIE[p.categorie])?.categorie || null;
    const categorieCatalogue = modeleData?.categorie || modeleActif?.categorie || null;
    // Marge de la catégorie : seulement avec les règles du gérant (code admin), jamais une valeur supposée
    const r = regles ? fusionnerRegles(regles) : null;
    const margeCategorie = !r ? null : categoriePrix === 'ipad' ? r.ipad : categoriePrix === 'macbook' ? r.macbook : categoriePrix ? (r.ecran[categoriePrix] ?? null) : null;
    const autresNoms = Array.isArray(modeleData?.noms) ? modeleData.noms.filter(Boolean) : [];
    return (
      <section aria-labelledby="modele-titre" className="card overflow-hidden min-w-0">
        <div className="card-header flex-wrap">
          <div className="min-w-0 flex items-start gap-2">
            <button type="button" onClick={() => poserParams((p) => p.delete('modele'))} className="btn-ghost btn-icon xl:hidden -ml-2" aria-label={`Retour aux modèles ${libelleMarque(marqueUrl)}`}>
              <ChevronLeft aria-hidden="true" />
            </button>
            <div className="min-w-0">
              <h2 id="modele-titre" className="t-h2 truncate">{marqueUrl} {modeleUrl}</h2>
              <p className="t-caption flex flex-wrap items-center gap-x-2">
                <span>{pieces.length} pièce{pieces.length > 1 ? 's' : ''}</span>
                {categorieCatalogue && !LIBELLE_CATEGORIE[categorieCatalogue] && <span>· {categorieCatalogue}</span>}
                {categoriePrix && (
                  <span>· {LIBELLE_CATEGORIE[categoriePrix]}{margeCategorie !== null && margeCategorie !== undefined ? ` : marge ${margeCategorie} €` : ''}</span>
                )}
                {autresNoms.length > 0 && <span>· chez le fournisseur : {autresNoms.join(', ')}</span>}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {liensModele?.utopya && (
              <a href={liensModele.utopya} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
                Chercher chez Utopya<span className="sr-only"> (nouvel onglet)</span>
              </a>
            )}
            {liensModele?.mobilax && (
              <a href={liensModele.mobilax} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
                Chercher chez Mobilax<span className="sr-only"> (nouvel onglet)</span>
              </a>
            )}
            {isAdmin && (
              <button type="button" onClick={() => ouvrirAjout({ marque: marqueUrl, modele: modeleUrl })} className="btn-primary btn-sm">
                <PackagePlus aria-hidden="true" /> Ajouter une pièce
              </button>
            )}
          </div>
        </div>

        {htMasqueModele && (
          <div role="status" className="callout callout-warning items-center flex-wrap mx-4 sm:mx-5 mb-3">
            <Lock aria-hidden="true" />
            <span className="flex-1 min-w-[220px]">Prix d’achat HT masqués tant que le code administrateur n’est pas saisi sur ce poste.</span>
            <button type="button" onClick={afficherPrixAchat} disabled={lectureHt} className="btn-primary btn-sm">
              <Unlock aria-hidden="true" /> {lectureHt ? 'Lecture…' : 'Afficher les prix d’achat (code admin)'}
            </button>
          </div>
        )}

        {loadingModele ? (
          <div className="loading-inline justify-center w-full py-10" role="status"><Loader2 aria-hidden="true" /> Chargement des pièces…</div>
        ) : erreurModele ? (
          <div role="alert" className="error-state items-center mx-4 sm:mx-5 mb-4">
            <AlertTriangle aria-hidden="true" />
            <span className="flex-1">Pièces indisponibles : {erreurModele.message || 'erreur inconnue'}.</span>
            <button type="button" onClick={() => mutateModele()} className="btn-secondary btn-sm">Réessayer</button>
          </div>
        ) : pieces.length === 0 ? (
          <div className="empty-state max-h-none border-t border-slate-100">
            <div className="empty-state-icon"><Tag aria-hidden="true" /></div>
            <p className="t-body text-slate-500 max-w-sm">Aucune pièce enregistrée pour {marqueUrl} {modeleUrl}.</p>
            {isAdmin ? (
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" onClick={ajouterPiecesCourantes} disabled={enCours === 'courantes'} className="btn-primary">
                  {enCours === 'courantes' ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <ListPlus aria-hidden="true" />}
                  Ajouter les pièces courantes
                </button>
                <button type="button" onClick={() => ouvrirAjout({ marque: marqueUrl, modele: modeleUrl })} className="btn-secondary">
                  <PackagePlus aria-hidden="true" /> Ajouter une pièce
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Un administrateur peut créer l’écran, la batterie et le connecteur (prix à renseigner).</p>
            )}
            {isAdmin && <p className="t-caption max-w-sm">Écran, batterie et connecteur créés à 0 € HT, « prix à renseigner », exclus des suggestions tant que le HT n’est pas saisi.</p>}
          </div>
        ) : (
          <div className="border-t border-slate-100">
            <TableauPieces pieces={pieces} marque={marqueUrl} modele={modeleUrl} regles={regles} seuils={seuils} isAdmin={isAdmin}
              htVisible={htVisibleModele} onEnregistrer={enregistrerHt} onVerrou={basculerVerrou} onStock={basculerStock} enCours={enCours} />
          </div>
        )}
      </section>
    );
  }

  function renderVueFiltree() {
    if (loadingListe && !tarifsData) {
      return <div className="loading-inline justify-center w-full py-20" role="status"><Loader2 aria-hidden="true" /> Chargement des prix…</div>;
    }
    if (groupes.length === 0 && devicesVisibles.length === 0) {
      return (
        <div className="empty-state max-h-none card">
          <div className="empty-state-icon"><Tag aria-hidden="true" /></div>
          <p className="t-body text-slate-500 max-w-sm">
            {margesMasquees ? 'Saisissez le code administrateur pour voir les marges faibles.'
              : filtreUrlActif ? `Aucun prix pour ce filtre : ${filtresActifs.map((f) => f.libelle).join(', ')}.`
                : debouncedSearch.trim() ? `Aucun prix de plus de 3 mois pour « ${debouncedSearch.trim()} ».` : 'Aucun prix de plus de 3 mois.'}
          </p>
          {filtreUrlActif && !margesMasquees && (
            <button type="button" onClick={() => retirerFiltresUrl(filtresActifs.map((f) => f.cle))} className="btn-secondary">
              <X aria-hidden="true" /> Voir toute la grille
            </button>
          )}
          {!filtreUrlActif && anciensSeuls && (
            <button type="button" onClick={() => setAnciensSeuls(false)} className="btn-secondary">
              <X aria-hidden="true" /> Voir toute la grille
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {groupes.map(({ marque, modeles }) => {
          const ouverte = marqueOuverte(marque);
          const nb = modeles.reduce((s, m) => s + m.items.length, 0);
          return (
            <div key={marque} className={`card overflow-hidden ${ouverte ? 'border-brand-300' : ''}`}>
              <button type="button" onClick={() => basculerMarque(marque)} aria-expanded={ouverte}
                className="w-full min-h-14 px-4 sm:px-5 py-3 flex items-center justify-between gap-3 cursor-pointer transition-colors duration-150 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500">
                <div className="flex items-center gap-3 min-w-0">
                  {ouverte ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />}
                  <span className="t-h2 truncate">{marque}</span>
                </div>
                <span className="t-caption shrink-0">{modeles.length} modele{modeles.length > 1 ? 's' : ''}<span className="sr-only">, {nb} prix</span></span>
              </button>
              {ouverte && modeles.map(({ modele, items }) => (
                <div key={modele} className="border-t border-slate-100">
                  <div className="px-4 sm:px-5 py-2 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-sm text-slate-900">{modele}</h3>
                    <button type="button" className="btn-ghost btn-sm"
                      onClick={() => {
                        setAnciensSeuls(false);
                        poserParams((p) => { for (const c of ['source', 'fraicheur', 'marge']) p.delete(c); p.set('marque', marque); p.set('modele', modele); });
                      }}>
                      Ouvrir le modèle <ChevronRight aria-hidden="true" />
                    </button>
                  </div>
                  <TableauPieces pieces={items} marque={marque} modele={modele} regles={regles} seuils={seuils} isAdmin={isAdmin}
                    htVisible={htVisibleListe} onEnregistrer={(p, corps) => enregistrerHt({ ...p, marque, modele }, corps)}
                    onVerrou={(p) => basculerVerrou(p, marque, modele)} onStock={basculerStock} enCours={enCours} margeDe={margeDe} dense />
                </div>
              ))}
            </div>
          );
        })}

        {devicesVisibles.length > 0 && (
          <div className="card overflow-hidden">
            <div className="min-h-14 px-4 sm:px-5 py-3 flex items-center gap-3">
              <Tablet className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
              <span className="t-h2">Apple · iPad / MacBook</span>
              <span className="t-caption">{devicesVisibles.length} appareil{devicesVisibles.length > 1 ? 's' : ''}</span>
            </div>
            <div className="table-wrap relative rounded-none border-0 border-t border-slate-100">
              <table className="table table-dense">
                <thead>
                  <tr className="table-header border-b border-slate-200 bg-slate-50">
                    <th scope="col">Modèle</th>
                    <th scope="col" className="text-right">Écran</th>
                    <th scope="col" className="text-right">Batterie</th>
                    <th scope="col">Prix du</th>
                  </tr>
                </thead>
                <tbody>
                  {devicesVisibles.map((d) => {
                    const m = filtreMarge === 'faible' ? margeEcran(d, contexteFiltres.tva, true) : null;
                    return (
                      <tr key={d.id} className="table-row">
                        <td className="font-semibold text-slate-900">{d.modele}</td>
                        <td className="table-cell-num">
                          {d.ecran_prix_vente ? euros(d.ecran_prix_vente) : <span className="text-slate-400 font-normal">—</span>}
                          {htVisibleListe && d.ecran_prix_ht != null && <div className="table-cell-muted font-normal">achat {Number(d.ecran_prix_ht).toFixed(2).replace('.', ',')} € HT</div>}
                          {m !== null && <div className="text-xs mt-1 font-semibold text-red-700">Marge : {euros(m)} (seuil {euros(contexteFiltres.seuilMarge)})</div>}
                        </td>
                        <td className="table-cell-num">{d.batterie_prix_vente ? euros(d.batterie_prix_vente) : <span className="text-slate-400 font-normal">—</span>}</td>
                        <td><BadgeDatePrix row={d} seuils={seuils} court /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── RENDER ────────────────────────────────────
  return (
    <div className="page max-w-[1280px]">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-header-title">Réparation smartphones</h1>
          <p className="page-header-subtitle">
            Prix fournisseur Mobilax / Utopya et méthode de calcul
            {/* Compteurs sur leur propre ligne, hauteur réservée : leur arrivée ne décale rien (CLS) */}
            <span className="block min-h-5 tabular-nums">
              {nbModeles > 0 && `${marques.length} marque${marques.length > 1 ? 's' : ''} · ${nbModeles} modèle${nbModeles > 1 ? 's' : ''} · ${nbPieces} pièce${nbPieces > 1 ? 's' : ''}`}
            </span>
          </p>
        </div>
        <div className="page-header-actions max-w-full">
          <button type="button" onClick={relire} disabled={isRevalidating} aria-label="Actualiser les tarifs" className="btn-secondary">
            <RefreshCw className={isRevalidating ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
            <span className="hidden sm:inline">{isRevalidating ? 'Chargement...' : 'Actualiser'}</span>
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Où sont les prix ? Une phrase, lisible en 5 secondes */}
        <div className="callout callout-info items-center flex-wrap">
          <Info aria-hidden="true" />
          <p className="flex-1 min-w-[240px]">
            <strong>Où sont les prix ?</strong> iPhone → grille boutique{' '}
            {/* Cible tactile de 44 px dans la phrase : marges négatives pour ne pas écarter la ligne */}
            <Link to={`${basePath}/tarifs-reparation`}
              className="font-semibold underline underline-offset-2 inline-flex items-center gap-1 min-h-[44px] -my-[10px] rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              <Wrench className="w-3.5 h-3.5" aria-hidden="true" /> Réparation iPhone
            </Link>
            {' '}; autres marques et iPad / Mac → ici : prix fournisseur Mobilax / Utopya + méthode de calcul.
          </p>
        </div>

        <BandeauPrix
          resume={resume}
          sante={sante}
          chargement={!santeLue && !modeFiltre}
          isAdmin={isAdmin}
          basePath={basePath}
          onImporter={() => setFenetre('import')}
          onRegles={() => setFenetre('regles')}
          onRecalculer={() => setFenetre('recalcul')}
          onHistorique={() => setFenetre('historique')}
          onAjouter={() => ouvrirAjout(modeleChoisi ? { marque: marqueUrl, modele: modeleUrl } : search)}
          onDevenirAdmin={() => setShowAdminLogin(true)}
        />

        <MethodeCalcul regles={regles} methode={methode} isAdmin={isAdmin} onModifier={() => setFenetre('regles')} />

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 sm:min-w-[220px]">
            <label htmlFor="tarifs-recherche" className="sr-only">Rechercher un modèle</label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
            <input ref={rechercheRef} id="tarifs-recherche" type="search" placeholder="Rechercher un modèle (ex. Galaxy A54)…" value={search}
              onChange={(e) => setSearch(e.target.value)} className="input pl-10" />
          </div>
          <div className="flex gap-2 items-center min-w-0" role="group" aria-label="Filtres">
            <FiltreAnciens actif={anciensSeuls} onChange={setAnciensSeuls} nombre={nombreAnciens ?? undefined} />
          </div>
        </div>

        {/* Filtres arrivés par l'URL (tuiles « Santé des prix ») : visibles et effaçables */}
        {filtresActifs.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtres actifs">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Filter className="w-4 h-4 text-slate-400" aria-hidden="true" /> Filtré :
            </span>
            {filtresActifs.map((f) => (
              <button key={f.cle} type="button" onClick={() => retirerFiltresUrl([f.cle])}
                aria-label={`Retirer le filtre ${f.libelle}`}
                className="min-h-[44px] pl-3 pr-2 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-brand-100 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                {f.libelle}
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            ))}
            {filtresActifs.length > 1 && (
              <button type="button" onClick={() => retirerFiltresUrl(filtresActifs.map((f) => f.cle))} className="btn-ghost btn-sm underline underline-offset-2">
                Effacer les filtres
              </button>
            )}
            {tarifsData && !margesMasquees && (
              <span role="status" className="t-caption">
                {nbCorrespondants} prix correspond{nbCorrespondants > 1 ? 'ent' : ''}
              </span>
            )}
          </div>
        )}
        {margesMasquees && tarifsData && (
          <div role="status" className="callout callout-warning items-center flex-wrap">
            <Lock aria-hidden="true" />
            <span className="flex-1 min-w-[220px]">
              Les marges se calculent avec les prix d’achat HT, masqués tant que le code administrateur n’est pas saisi sur ce poste.
            </span>
            <button type="button" onClick={afficherMarges} disabled={lectureMarges} className="btn-primary btn-sm">
              <Unlock aria-hidden="true" />
              {lectureMarges ? 'Lecture des marges…' : 'Afficher les marges (code admin)'}
            </button>
          </div>
        )}

        {modeFiltre ? renderVueFiltree() : loadingMarques && !marquesData ? (
          <div className="loading-inline justify-center w-full py-20" role="status"><Loader2 aria-hidden="true" /> Chargement des marques…</div>
        ) : erreurMarques && marques.length === 0 ? (
          <div role="alert" className="error-state items-center flex-wrap">
            <AlertTriangle aria-hidden="true" />
            <span className="flex-1 min-w-[220px]">Grille indisponible : {erreurMarques.message || 'erreur inconnue'}.</span>
            <button type="button" onClick={() => mutateMarques()} className="btn-secondary btn-sm">Réessayer</button>
          </div>
        ) : (
          <>
            {/* Marques : puces sur grand écran, liste déroulante sur téléphone */}
            {!resultatsRecherche && (
              <div>
                <label htmlFor="tarifs-marque" className="sr-only">Marque</label>
                <select id="tarifs-marque" value={marqueActive} onChange={(e) => choisirMarque(e.target.value)} className="select sm:hidden">
                  {marques.map((m) => <option key={m.marque} value={m.marque}>{libelleMarque(m.marque)} ({m.modeles.length})</option>)}
                </select>
                <div className="hidden sm:flex flex-wrap gap-2" role="group" aria-label="Marques">
                  {marques.map((m) => {
                    const actif = m.marque === marqueActive;
                    return (
                      <button key={m.marque} type="button" aria-pressed={actif} onClick={() => choisirMarque(m.marque)}
                        className={`btn-sm rounded-full border transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${actif ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}>
                        {m.marque === 'Apple' && <Tablet className="w-4 h-4" aria-hidden="true" />}
                        {libelleMarque(m.marque)}
                        {/* Contraste AA : blanc sur brand-600, slate-500 sur blanc */}
                        <span className={`text-xs ${actif ? 'text-white' : 'text-slate-500'}`}>{m.modeles.length}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {/* grid-cols-1 : une colonne bornée (un tableau large défile dans sa carte, jamais la page) ;
                320 px : la liste et ses trois vues « Avec prix / À créer / Tous » tiennent sans rognage */}
            <div className="grid gap-4 grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] items-start">
              {renderListeModeles()}
              {renderModele()}
            </div>
          </>
        )}
      </div>

      {/* ─── Fenêtres admin ─── */}
      {fenetre === 'historique' && (
        <HistoriquePrix open onClose={fermerFenetre} sensible={sensible} nommer={nommer} onAnnule={relire} />
      )}

      <Suspense fallback={null}>
        {fenetre === 'recalcul' && (
          <FenetreRecalcul open onClose={fermerFenetre} sensible={sensible} onApplique={relire} />
        )}
        {fenetre === 'ajout' && (
          <AjoutPiecePrix open onClose={fermerFenetre} sensible={sensible} regles={regles} catalogue={modeFiltre ? tarifs : catalogueAjout}
            initial={ajoutInitial} onAjoute={pieceAjoutee} />
        )}
        {fenetre === 'import' && (
          <ImportPrixModal open onClose={fermerFenetre} sensible={sensible} regles={regles}
            catalogue={{ tarifs: tousTarifs, appleDevices }} onApplique={relire} />
        )}
        {fenetre === 'regles' && (
          <ReglesPrixPanel open onClose={fermerFenetre} sensible={sensible}
            tarifs={tarifs} appleDevices={appleDevices} onApplique={relire} />
        )}
      </Suspense>

      <AdminLoginModal
        open={showAdminLogin}
        onClose={() => setShowAdminLogin(false)}
        onSuccess={() => {
          setShowAdminLogin(false);
          setIsAdmin(true);
          isAdminRef.current = true;
          chargerRegles();
          chargerMethode();
          // Modèle ouvert (et liste filtrée) relus : les prix d'achat HT ne sont plus masqués
          if (modeFiltreRef.current) relirePrixAchat();
          if (cleModele) mutateModeleRef.current();
        }}
      />
      {adminPrompt}
    </div>
  );
}
