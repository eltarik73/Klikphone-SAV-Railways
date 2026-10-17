import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, memo, lazy, Suspense } from 'react';
import {
  Tag, Search, RefreshCw, ChevronDown, ChevronRight, Smartphone, Battery, Plug, Camera, Package, Volume2,
  Headphones, PackageX, Tablet, Laptop, Lock, Unlock, FileSpreadsheet, SlidersHorizontal, Calculator, History,
  AlertTriangle, Clock, CheckCircle2, X, Inbox, PackagePlus, Filter, Loader2,
} from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { useApi, invalidateCache } from '../hooks/useApi';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useToast } from '../components/Toast';
import AdminLoginModal from '../components/AdminLoginModal';
import HistoriquePrix, {
  BadgeDatePrix, BoutonVerrou, FiltreAnciens, SEUILS_FRAICHEUR,
  dateFr, estEcran, euros, fraicheurPrix, lireDate, messageErreurPrix, plusDeTroisMois,
} from '../components/HistoriquePrix';

// Fenêtres admin chargées à la demande (le personnel de l'accueil ne les ouvre jamais)
const ImportPrixModal = lazy(() => import('../components/ImportPrixModal'));
const ReglesPrixPanel = lazy(() => import('../components/ReglesPrixPanel'));
const FenetreRecalcul = lazy(() => import('../components/ReglesPrixPanel').then((m) => ({ default: m.FenetreRecalcul })));
const AjoutPiecePrix = lazy(() => import('../components/ReglesPrixPanel').then((m) => ({ default: m.AjoutPiecePrix })));

// ─── Constantes ──────────────────────────────────
const AUCUNE_LIGNE = Object.freeze([]);
const BRAND_CONFIG = {
  Apple:    { bg: '#18181b', text: '#fff', logo: 'apple' },
  Samsung:  { bg: '#2563eb', text: '#fff', logo: 'samsung' },
  Xiaomi:   { bg: '#c2410c', text: '#fff', logo: 'xiaomi' },
  Huawei:   { bg: '#dc2626', text: '#fff', logo: 'huawei' },
  Honor:    { bg: '#6d28d9', text: '#fff', logo: 'honor' },
  Google:   { bg: '#15803d', text: '#fff', logo: 'google' },
  Oppo:     { bg: '#047857', text: '#fff', logo: 'oppo' },
  OnePlus:  { bg: '#dc2626', text: '#fff', logo: 'oneplus' },
  Motorola: { bg: '#0e7490', text: '#fff', logo: 'motorola' },
  Nothing:  { bg: '#18181b', text: '#fff', logo: 'nothing' },
  Realme:   { bg: '#b45309', text: '#fff', logo: 'realme' },
  Vivo:     { bg: '#1d4ed8', text: '#fff', logo: 'vivo' },
};
const DEFAULT_BRAND = { bg: '#6d28d9', text: '#fff', logo: null };

const BrandLogo = memo(function BrandLogo({ slug, size = 16 }) {
  const [error, setError] = useState(false);
  if (!slug || error) return <Smartphone className="w-4 h-4" aria-hidden="true" />;
  return (
    <img src={`https://cdn.simpleicons.org/${slug}/ffffff`} alt="" width={size} height={size}
      className="shrink-0" style={{ minWidth: size }} loading="lazy" onError={() => setError(true)} />
  );
});

const QUALITY_COLORS = {
  'Original':       { color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  'Soft OLED':      { color: '#6d28d9', bg: '#f5f3ff', border: '#c4b5fd' },
  'OLED':           { color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
  'Incell':         { color: '#92400e', bg: '#fffbeb', border: '#fcd34d' },
  'LCD':            { color: '#3f3f46', bg: '#f4f4f5', border: '#d4d4d8' },
  'Reconditionnee': { color: '#155e75', bg: '#ecfeff', border: '#67e8f9' },
  'Compatible':     { color: '#be123c', bg: '#fff1f2', border: '#fda4af' },
};
const DEFAULT_QUALITY = { color: '#3f3f46', bg: '#f4f4f5', border: '#d4d4d8' };

const BRAND_ORDER = ['Apple', 'Samsung', 'Xiaomi', 'Huawei', 'Honor', 'Google', 'Oppo', 'OnePlus', 'Motorola', 'Nothing', 'Realme', 'Vivo'];
const BRAND_FILTERS = ['Toutes', ...BRAND_ORDER];

const PIECE_ICONS = { ecran: Smartphone, batterie: Battery, connecteur: Plug, camera: Camera, vitre: Package, 'haut-parleur': Volume2, ecouteur: Headphones };
const PIECE_TYPE_COLORS = {
  batterie:               { color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  'connecteur de charge': { color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
  'camera arriere':       { color: '#92400e', bg: '#fffbeb', border: '#fcd34d' },
  'vitre arriere':        { color: '#6d28d9', bg: '#f5f3ff', border: '#c4b5fd' },
  'haut-parleur':         { color: '#0f766e', bg: '#f0fdfa', border: '#99f6e4' },
  'ecouteur interne':     { color: '#be185d', bg: '#fdf2f8', border: '#f9a8d4' },
  'vitre camera arriere': { color: '#4338ca', bg: '#eef2ff', border: '#a5b4fc' },
};
const DEFAULT_PIECE_TYPE = { color: '#3f3f46', bg: '#f4f4f5', border: '#d4d4d8' };

function getPieceIcon(type) {
  const t = (type || '').toLowerCase();
  for (const [key, Icon] of Object.entries(PIECE_ICONS)) { if (t.includes(key)) return Icon; }
  return Package;
}
function getPieceTypeColor(type) {
  const t = (type || '').toLowerCase();
  for (const [key, val] of Object.entries(PIECE_TYPE_COLORS)) { if (t.includes(key)) return val; }
  return DEFAULT_PIECE_TYPE;
}
function formatPrice(n) { if (n == null) return null; return `${n} €`; }
const nomPiece = (t) => `${t.marque} ${t.modele} · ${t.type_piece}${t.qualite ? ` ${t.qualite}` : ''}`;
const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// « Samsung Galaxy A12 » → marque + modèle quand le premier mot est une marque de la grille
function decouperRecherche(texte, marques) {
  const t = String(texte || '').trim().replace(/\s+/g, ' ');
  const [premier, ...reste] = t.split(' ');
  const marque = marques.find((m) => m.toLowerCase() === (premier || '').toLowerCase());
  return marque && reste.length ? { marque, modele: reste.join(' ') } : { marque: '', modele: t };
}

// ─── Filtres reçus par l'URL (tuiles « Santé des prix » du tableau de bord) ───
// ?source=estimation, ?fraicheur=a_revoir|perime, ?marge=faible : valeurs connues uniquement (une valeur
// inconnue est ignorée). ?q= est géré à part (recherche préremplie).
export const FILTRES_URL = Object.freeze({
  source: Object.freeze(['estimation']),
  fraicheur: Object.freeze(['a_revoir', 'perime']),
  marge: Object.freeze(['faible']),
});
const SEUIL_MARGE_DEFAUT = 40;
const TVA_DEFAUT = 1.2;

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

// ─── iPhone series helpers ──────────────────────
const SERIES_ORDER = ['17', '16', '15', '14', '13', '12', '11', 'SE', 'X/XS/XR', '8', '7'];

function getIPhoneSerie(modele) {
  const m = modele.match(/iPhone\s*(\d+|SE|X[SR]?)/i);
  if (!m) return 'Autre';
  const num = m[1].toUpperCase();
  if (['X', 'XS', 'XR'].includes(num)) return 'X/XS/XR';
  return num;
}

function iPhoneModelSort(a, b) {
  const order = m => {
    if (/Pro Max/i.test(m)) return 0;
    if (/Pro/i.test(m)) return 1;
    if (/Plus/i.test(m)) return 2;
    if (/Mini/i.test(m)) return 3;
    return 4;
  };
  return order(a) - order(b);
}

// Le plus ancien prix d'un groupe (pour le résumé d'un modèle)
function plusAncien(items) {
  let pire = null;
  for (const t of items) {
    const d = lireDate(t.prix_maj_le || t.updated_at);
    if (d && (!pire || d < lireDate(pire.prix_maj_le || pire.updated_at))) pire = t;
  }
  return pire;
}

// ─── Bandeau « Prix du fournisseur » ─────────────
function resumeFraicheur(lignes, seuils, sante) {
  const total = lignes.length;
  let estimes = 0; let aRevoir = 0; let perimes = 0;
  let dateEstimation = null; let plusRecent = null; let plusVieux = null;
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
    if (d && (!plusVieux || d < plusVieux)) plusVieux = d;
  }
  // Les comptages du serveur font foi quand ils existent (même périmètre : pièces + iPad/MacBook)
  if (sante && Number.isFinite(sante.total) && sante.total > 0) {
    return {
      total: sante.total,
      estimes: Number(sante.estimes) || 0,
      aRevoir: Number(sante.a_revoir) || 0,
      perimes: Number(sante.perimes) || 0,
      dateEstimation, plusRecent, plusVieux,
    };
  }
  return { total, estimes, aRevoir, perimes, dateEstimation, plusRecent, plusVieux };
}

function BandeauPrix({ resume, sante, isAdmin, onImporter, onRegles, onRecalculer, onHistorique, onAjouter, onDevenirAdmin, nbObsoletes, basePath }) {
  const { total, estimes, aRevoir, perimes, dateEstimation, plusRecent } = resume;
  const tousEstimes = total > 0 && estimes >= total;
  let titre;
  if (!total) titre = 'Prix du fournisseur : aucun prix enregistré';
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
  if (nbObsoletes > 0) details.push(`${nbObsoletes} pièce${nbObsoletes > 1 ? 's' : ''} obsolète${nbObsoletes > 1 ? 's' : ''} masquée${nbObsoletes > 1 ? 's' : ''}`);

  const action = 'btn-secondary btn-sm';
  const actionPrincipale = 'btn-primary btn-sm';
  return (
    <section aria-label="État des prix" className={`callout ${ton.boite} mb-4 flex-wrap items-center`}>
      <Icone aria-hidden="true" />
      <div className="min-w-[240px] flex-1">
        <p className="font-semibold">{titre}</p>
        {details.length > 0 && <p className="text-xs sm:text-sm">{details.join(' · ')}</p>}
      </div>
      {isAdmin ? (
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full sm:w-auto">
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
          {sante?.propositions_en_attente > 0 && (
            <Link to={`${basePath}/prix-a-revoir?onglet=propositions`} className={`${action} col-span-2`}>
              <Inbox aria-hidden="true" /> Propositions des commandes ({sante.propositions_en_attente})
            </Link>
          )}
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

// ─── Composant principal ─────────────────────────
export default function TarifsPage() {
  const toast = useToast();
  const location = useLocation();
  const basePath = location.pathname.startsWith('/tech') ? '/tech' : '/accueil';
  const { sensible: sensibleBrut, adminPrompt } = useAdminElevation();
  const [searchParams, setSearchParams] = useSearchParams();
  const rechercheLien = searchParams.get('q') || '';
  // Filtres envoyés par les tuiles « Santé des prix » : l'URL fait foi (retour arrière, lien partagé)
  const { source: filtreSource, fraicheur: filtreFraicheur, marge: filtreMarge } = lireFiltresUrl(searchParams);
  const filtresUrl = useMemo(
    () => ({ source: filtreSource, fraicheur: filtreFraicheur, marge: filtreMarge }),
    [filtreSource, filtreFraicheur, filtreMarge],
  );
  const filtreUrlActif = Boolean(filtreSource || filtreFraicheur || filtreMarge);
  const rechercheRef = useRef(null);
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem('klikphone_admin') === 'true');
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  const { data: tarifsData, loading, isRevalidating, mutate: mutateTarifs } = useApi(
    'tarifs',
    async () => {
      const [t, s, ad] = await Promise.all([
        api.getTarifs(), api.getTarifsStats(), api.getAppleDevices().catch(() => []),
      ]);
      return { tarifs: t, stats: s, appleDevices: ad || [] };
    },
    { tags: ['tarifs'], ttl: 300_000 }
  );
  // Listes stables pendant le chargement : un [] neuf à chaque rendu relancerait sans fin l'effet qui
  // déplie les marques quand une recherche est déjà saisie (arrivée par ?q=)
  const tousTarifs = tarifsData?.tarifs ?? AUCUNE_LIGNE;
  const tarifs = useMemo(() => tousTarifs.filter((t) => !t.obsolete), [tousTarifs]);
  const nbObsoletes = tousTarifs.length - tarifs.length;
  const stats = tarifsData?.stats ?? null;

  // Prix d'achat HT masqués par le serveur tant que le code admin n'est pas saisi : relus une fois
  // dès la première action admin réussie (aperçus, comptages, import en ont besoin). `sensible` reste
  // stable : les fenêtres qui en dépendent ne relancent pas leurs lectures.
  const htMasques = tousTarifs.length > 0 && !tousTarifs.some((t) => Object.prototype.hasOwnProperty.call(t, 'prix_fournisseur_ht'));
  const htMasquesRef = useRef(htMasques);
  htMasquesRef.current = htMasques;
  const mutateRef = useRef(mutateTarifs);
  mutateRef.current = mutateTarifs;
  const relectureHt = useRef(null);
  const relirePrixAchat = useCallback(() => {
    if (!relectureHt.current) {
      relectureHt.current = api.getPrixAchat()
        .then(({ tarifs: t, appleDevices: ad }) => {
          if (!t.some((x) => Object.prototype.hasOwnProperty.call(x, 'prix_fournisseur_ht'))) return false;
          mutateRef.current((prev) => (prev ? { ...prev, tarifs: t, appleDevices: ad } : prev));
          return true;
        })
        .catch(() => false)
        .finally(() => { relectureHt.current = null; });
    }
    return relectureHt.current;
  }, []);
  const [regles, setReglesEtat] = useState(null);
  const reglesRef = useRef(null);
  const setRegles = useCallback((r) => { reglesRef.current = r; setReglesEtat(r); }, []);
  const sensible = useCallback(async (fn) => {
    const res = await sensibleBrut(fn);
    if (htMasquesRef.current) relirePrixAchat();
    // Règles lues sans le code à l'ouverture de la page : refus, relues maintenant
    if (!reglesRef.current) api.getReglesPrix().then(setRegles).catch(() => {});
    return res;
  }, [sensibleBrut, relirePrixAchat, setRegles]);
  const appleDevices = tarifsData?.appleDevices ?? AUCUNE_LIGNE;

  // « Saisir le prix » (modèles sans prix) arrive avec ?q=<marque modèle> : recherche préremplie
  const [search, setSearch] = useState(rechercheLien);
  const [debouncedSearch, setDebouncedSearch] = useState(rechercheLien);
  const searchTimer = useRef(null);
  const [brandFilter, setBrandFilter] = useState('Toutes');
  const [anciensSeuls, setAnciensSeuls] = useState(false);
  const [expandedBrands, setExpandedBrands] = useState(new Set());
  const [expandedModels, setExpandedModels] = useState(new Set());
  const [expandedSeries, setExpandedSeries] = useState(new Set());
  const [checkingStock, setCheckingStock] = useState(false);
  const [stockResult, setStockResult] = useState(null);
  const [showHT, setShowHT] = useState(false);
  const [fenetre, setFenetre] = useState(null); // 'import' | 'regles' | 'historique' | 'recalcul' | 'ajout'
  const [ajoutInitial, setAjoutInitial] = useState(null);
  const [verrouEnCours, setVerrouEnCours] = useState(null);
  const [sante, setSante] = useState(null);

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

  // Santé des prix (personnel) et règles (admin) : lues sans rien demander, un refus est sans effet
  const chargerSante = useCallback(() => {
    if (typeof api.getSantePrix !== 'function') return;
    Promise.resolve().then(() => api.getSantePrix()).then(setSante).catch(() => {});
  }, []);
  useEffect(() => { chargerSante(); }, [chargerSante]);
  useEffect(() => {
    if (!isAdmin) return;
    api.getReglesPrix().then(setRegles).catch(() => {});
  }, [isAdmin]);

  useEffect(() => { if (rechercheLien) setSearch(rechercheLien); }, [rechercheLien]);

  // Debounced search (300ms)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  const relire = useCallback(() => {
    invalidateCache('tarifs');
    chargerSante();
    if (isAdmin) api.getReglesPrix().then(setRegles).catch(() => {});
  }, [chargerSante, isAdmin]);

  // « Prix HT » : sans le code admin, les prix d'achat ne sont pas envoyés par le serveur
  async function basculerHT() {
    if (showHT || !htMasques) { setShowHT(!showHT); return; }
    try {
      await sensible(() => api.getReglesPrix());
      if (await relirePrixAchat()) setShowHT(true);
      else toast.error('Prix d’achat HT indisponibles : identification administrateur requise.');
    } catch (e) {
      const msg = messageErreurPrix(e, 'Prix d’achat HT indisponibles');
      if (msg) toast.error(msg);
    }
  }

  // Filtre « marges faibles » : il faut les prix d'achat HT (code admin), relus puis la grille filtrée
  const [lectureMarges, setLectureMarges] = useState(false);
  async function afficherMarges() {
    setLectureMarges(true);
    try {
      await sensible(() => api.getReglesPrix());
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

  // Puce « × » d'un filtre de l'URL : retiré de l'adresse (les autres paramètres, dont ?q=, restent)
  function retirerFiltresUrl(cles) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      for (const c of cles) p.delete(c);
      return p;
    }, { replace: true });
    // Le bouton disparaît : le focus revient sur la recherche plutôt que d'être perdu
    rechercheRef.current?.focus();
  }

  async function handleToggleStock(id) {
    try {
      const res = await sensible(() => api.toggleTarifStock(id));
      mutateTarifs(prev => prev ? {
        ...prev, tarifs: prev.tarifs.map(t => t.id === id ? { ...t, en_stock: res.en_stock } : t)
      } : prev);
    } catch (e) {
      const msg = messageErreurPrix(e, 'Stock non modifié');
      if (msg) toast.error(msg);
    }
  }

  async function handleCheckStock() {
    setCheckingStock(true); setStockResult(null);
    try {
      const res = await sensible(() => api.checkTarifStock());
      setStockResult(res || {}); invalidateCache('tarifs');
    } catch (e) {
      const msg = messageErreurPrix(e, 'Vérification du stock impossible');
      if (msg) { toast.error(msg); setStockResult({ error: msg }); }
    } finally { setCheckingStock(false); }
  }

  async function basculerVerrou(t) {
    setVerrouEnCours(t.id);
    const verrouiller = !t.verrou_manuel;
    try {
      const res = await sensible(() => api.setVerrouPrix(t.id, verrouiller));
      const valeur = typeof res?.verrou_manuel === 'boolean' ? res.verrou_manuel : verrouiller;
      mutateTarifs(prev => prev ? {
        ...prev, tarifs: prev.tarifs.map(x => x.id === t.id ? { ...x, verrou_manuel: valeur } : x),
      } : prev);
      toast.success(valeur ? `${nomPiece(t)} : prix verrouillé.` : `${nomPiece(t)} : prix déverrouillé.`);
    } catch (e) {
      const msg = messageErreurPrix(e, 'Verrou non enregistré');
      if (msg) toast.error(msg);
    } finally {
      setVerrouEnCours(null);
    }
  }

  async function basculerVerrouAppareil(d) {
    const cle = `apple-${d.id}`;
    setVerrouEnCours(cle);
    const verrouiller = !d.verrou_manuel;
    try {
      const res = await sensible(() => api.setVerrouPrix(d.id, verrouiller, 'tarifs_apple_devices'));
      const valeur = typeof res?.verrou_manuel === 'boolean' ? res.verrou_manuel : verrouiller;
      mutateTarifs(prev => prev ? {
        ...prev, appleDevices: prev.appleDevices.map(x => x.id === d.id ? { ...x, verrou_manuel: valeur } : x),
      } : prev);
      toast.success(valeur ? `${d.modele} : prix verrouillés.` : `${d.modele} : prix déverrouillés.`);
    } catch (e) {
      const msg = messageErreurPrix(e, 'Verrou non enregistré');
      if (msg) toast.error(msg);
    } finally {
      setVerrouEnCours(null);
    }
  }

  const nombreAnciens = useMemo(
    () => tarifs.filter((t) => plusDeTroisMois(t, seuils)).length + appleDevices.filter((d) => plusDeTroisMois(d, seuils)).length,
    [tarifs, appleDevices, seuils],
  );

  const filtered = useMemo(() => {
    let result = tarifs;
    if (brandFilter !== 'Toutes') result = result.filter(t => t.marque === brandFilter);
    if (anciensSeuls) result = result.filter(t => plusDeTroisMois(t, seuils));
    if (filtreUrlActif) result = result.filter(t => correspondFiltresUrl(t, filtresUrl, contexteFiltres));
    // Chaque mot doit se retrouver dans la pièce (« samsung galaxy a12 batterie »)
    const mots = sansAccents(debouncedSearch).split(/\s+/).filter(Boolean);
    if (mots.length) {
      result = result.filter(t => {
        const texte = sansAccents(`${t.marque} ${t.modele} ${t.type_piece} ${t.qualite || ''}`);
        return mots.every(m => texte.includes(m));
      });
    }
    return result;
  }, [tarifs, brandFilter, debouncedSearch, anciensSeuls, seuils, filtreUrlActif, filtresUrl, contexteFiltres]);

  const grouped = useMemo(() => {
    const byBrand = {};
    for (const t of filtered) {
      if (!byBrand[t.marque]) byBrand[t.marque] = {};
      if (!byBrand[t.marque][t.modele]) byBrand[t.marque][t.modele] = [];
      byBrand[t.marque][t.modele].push(t);
    }
    const brands = Object.keys(byBrand).sort((a, b) => {
      const ia = BRAND_ORDER.indexOf(a), ib = BRAND_ORDER.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1; if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
    return brands.map(brand => ({
      brand,
      models: Object.entries(byBrand[brand]).sort(([a], [b]) => a.localeCompare(b)).map(([model, items]) => ({ model, items })),
    }));
  }, [filtered]);

  // Apple iPhone series grouping
  const appleIPhoneSeries = useMemo(() => {
    const appleGroup = grouped.find(g => g.brand === 'Apple');
    if (!appleGroup) return [];
    const bySerieMap = {};
    for (const { model, items } of appleGroup.models) {
      if (!model.toLowerCase().includes('iphone')) continue;
      const serie = getIPhoneSerie(model);
      if (!bySerieMap[serie]) bySerieMap[serie] = [];
      bySerieMap[serie].push({ model, items });
    }
    for (const serie of Object.keys(bySerieMap)) {
      bySerieMap[serie].sort((a, b) => iPhoneModelSort(a.model, b.model));
    }
    return Object.entries(bySerieMap).sort(([a], [b]) => {
      const ia = SERIES_ORDER.indexOf(a), ib = SERIES_ORDER.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1; if (ib >= 0) return 1;
      return 0;
    }).map(([serie, models]) => ({ serie, models }));
  }, [grouped]);

  const appleOtherModels = useMemo(() => {
    const appleGroup = grouped.find(g => g.brand === 'Apple');
    if (!appleGroup) return [];
    return appleGroup.models.filter(({ model }) => !model.toLowerCase().includes('iphone'));
  }, [grouped]);

  // iPad / MacBook from appleDevices
  const devicesVisibles = useMemo(() => {
    let liste = appleDevices;
    if (anciensSeuls) liste = liste.filter((d) => plusDeTroisMois(d, seuils));
    if (filtreUrlActif) liste = liste.filter((d) => correspondFiltresUrl(d, filtresUrl, { ...contexteFiltres, apple: true }));
    // Grille filtrée : la recherche vaut aussi pour les iPad / MacBook (« samsung » ne les montre pas)
    const mots = anciensSeuls || filtreUrlActif ? sansAccents(debouncedSearch).split(/\s+/).filter(Boolean) : [];
    if (mots.length) {
      liste = liste.filter((d) => {
        const texte = sansAccents(`Apple ${d.categorie || ''} ${d.modele || ''}`);
        return mots.every((m) => texte.includes(m));
      });
    }
    return liste;
  }, [appleDevices, anciensSeuls, seuils, filtreUrlActif, filtresUrl, contexteFiltres, debouncedSearch]);
  // Filtre de la grille en cours (« plus de 3 mois » ou filtre de l'URL) : iPad / MacBook concernés montrés seuls
  const filtreActif = anciensSeuls || filtreUrlActif;
  const appleVisible = brandFilter === 'Toutes' || brandFilter === 'Apple';
  const filtresActifs = useMemo(
    () => libellesFiltresUrl(filtresUrl, seuils, contexteFiltres.seuilMarge),
    [filtresUrl, seuils, contexteFiltres.seuilMarge],
  );
  const nbCorrespondants = filtered.length + (appleVisible ? devicesVisibles.length : 0);
  // Marges incalculables tant que les prix d'achat HT sont masqués (code admin pas saisi sur ce poste)
  const htAppleMasques = appleDevices.length > 0 && !appleDevices.some((d) => Object.prototype.hasOwnProperty.call(d, 'ecran_prix_ht'));
  const margesMasquees = filtreMarge === 'faible' && (htMasques || htAppleMasques);
  const iPadDevices = useMemo(() => devicesVisibles.filter(d => d.categorie === 'ipad'), [devicesVisibles]);
  const macBookDevices = useMemo(() => devicesVisibles.filter(d => d.categorie === 'macbook'), [devicesVisibles]);

  const resume = useMemo(() => resumeFraicheur([...tarifs, ...appleDevices], seuils, sante), [tarifs, appleDevices, seuils, sante]);

  // Libellés de l'historique (table + ligne → pièce)
  const nommer = useCallback((l) => {
    if (l.label) return l.label;
    if (l.table_nom === 'tarifs') {
      const t = tousTarifs.find((x) => x.id === l.ligne_id);
      return t ? nomPiece(t) : null;
    }
    if (l.table_nom === 'tarifs_apple_devices') {
      const d = appleDevices.find((x) => x.id === l.ligne_id);
      return d ? d.modele : null;
    }
    return null;
  }, [tousTarifs, appleDevices]);

  useEffect(() => { if (search.trim()) setExpandedBrands(new Set(grouped.map(g => g.brand))); }, [search, grouped]);
  useEffect(() => { if (brandFilter !== 'Toutes') setExpandedBrands(new Set([brandFilter])); }, [brandFilter]);
  useEffect(() => { if (anciensSeuls) setExpandedBrands(new Set(grouped.map(g => g.brand))); }, [anciensSeuls]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtre de l'URL : marques dépliées ; peu de résultats → modèles, séries iPhone et iPad / MacBook aussi.
  // Une fois par filtre (puis après la relecture des HT pour les marges) : un repli à la main n'est pas annulé.
  // Avant l'affichage (useLayoutEffect) : pas de grille repliée qui saute à l'écran une image plus tard.
  const filtresDeplies = useRef('');
  const cleDepliage = filtreUrlActif ? `${filtreSource}|${filtreFraicheur}|${filtreMarge}|${margesMasquees ? 'ht' : ''}` : '';
  useLayoutEffect(() => {
    if (!cleDepliage) { filtresDeplies.current = ''; return; }
    if (loading || filtresDeplies.current === cleDepliage) return;
    filtresDeplies.current = cleDepliage;
    setExpandedBrands(new Set(grouped.map((g) => g.brand)));
    if (nbCorrespondants > 0 && nbCorrespondants <= 40) {
      setExpandedModels(new Set(grouped.flatMap((g) => g.models.map((m) => `${g.brand}::${m.model}`))));
      setExpandedSeries(new Set([
        ...appleIPhoneSeries.map((s) => `apple-serie-${s.serie}`),
        ...(iPadDevices.length ? ['apple-ipad'] : []),
        ...(macBookDevices.length ? ['apple-macbook'] : []),
      ]));
    }
  }, [cleDepliage, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleBrand(brand) {
    setExpandedBrands(prev => {
      const n = new Set(prev);
      if (n.has(brand)) {
        n.delete(brand);
      } else {
        n.add(brand);
        // Auto-expand first iPhone series when opening Apple
        if (brand === 'Apple' && appleIPhoneSeries.length > 0) {
          setExpandedSeries(sp => {
            const ns = new Set(sp);
            ns.add(`apple-serie-${appleIPhoneSeries[0].serie}`);
            return ns;
          });
        }
      }
      return n;
    });
  }
  function toggleModel(key) {
    setExpandedModels(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }
  function toggleSerie(key) {
    setExpandedSeries(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  // Fonctions de rendu (pas des composants : pas de remontage, le focus clavier reste en place)
  function renderStockBadge(tarif) {
    const inStock = tarif.en_stock !== false;
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); handleToggleStock(tarif.id); }}
        aria-pressed={!inStock}
        aria-label={`${nomPiece(tarif)} : ${inStock ? 'en stock' : 'en rupture'}. Changer`}
        className="inline-flex items-center justify-center min-h-[44px] -my-2 px-1 rounded-lg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <span className={`badge badge-sm ${inStock ? 'badge-success hover:bg-emerald-100' : 'badge-danger hover:bg-red-100'}`}>
          {inStock ? 'En stock' : 'Rupture'}
        </span>
      </button>
    );
  }

  function renderPiedCarte(t) {
    return (
      <div className="mt-2 flex items-center justify-between gap-1.5">
        <BadgeDatePrix row={t} seuils={seuils} court />
        <div className="flex items-center gap-1">
          {isAdmin
            ? <BoutonVerrou verrouille={!!t.verrou_manuel} onClick={() => basculerVerrou(t)} disabled={verrouEnCours === t.id} nom={`le prix de ${nomPiece(t)}`} />
            : <BoutonVerrou verrouille={!!t.verrou_manuel} lectureSeule nom={nomPiece(t)} />}
        </div>
      </div>
    );
  }

  // Filtre « marges faibles » : marge réelle de l'écran sous le prix (prix client − achat HT × TVA)
  function renderMarge(row, apple = false) {
    if (filtreMarge !== 'faible') return null;
    const m = margeEcran(row, contexteFiltres.tva, apple);
    if (m === null) return null;
    return (
      <div className="text-xs mt-1 font-semibold text-red-700 tabular-nums">
        Marge : {euros(m)} (seuil {euros(contexteFiltres.seuilMarge)})
      </div>
    );
  }

  function getModelSummary(items) {
    const screenItems = items.filter(t => (t.type_piece || '').toLowerCase().includes('ecran'));
    const qualityCount = new Set(screenItems.map(t => t.qualite).filter(Boolean)).size;
    const getPrice = (kw) => {
      const m = items.filter(t => (t.type_piece || '').toLowerCase().includes(kw));
      return m.length ? Math.min(...m.map(t => t.prix_client)) : null;
    };
    const otherItems = items.filter(t => !(t.type_piece || '').toLowerCase().includes('ecran'));
    const otherByType = {};
    for (const t of otherItems) { const k = t.type_piece; if (!otherByType[k]) otherByType[k] = []; otherByType[k].push(t); }
    return { qualityCount, screenItems, batterie: getPrice('batter'), connecteur: getPrice('connect'), camera: getPrice('cam'), otherByType, outOfStock: items.filter(t => t.en_stock === false).length, ancien: plusAncien(items) };
  }

  const totalModels = grouped.reduce((sum, g) => sum + g.models.length, 0);
  const COLOR_BATT = PIECE_TYPE_COLORS['batterie'];
  const COLOR_CONN = PIECE_TYPE_COLORS['connecteur de charge'];
  const COLOR_CAM  = PIECE_TYPE_COLORS['camera arriere'];

  function renderPriceBadge(value, Icon, color, mobile = false) {
    if (value == null) return null;
    if (mobile) {
      return <span className="badge badge-sm badge-neutral tabular-nums gap-1">
        <Icon className="w-3 h-3" aria-hidden="true" />{formatPrice(value)}</span>;
    }
    return <span className="hidden sm:inline-flex badge badge-neutral tabular-nums gap-1">
      <Icon className="w-3 h-3" aria-hidden="true" />{formatPrice(value)}</span>;
  }

  // ─── Render model row (reusable for all brands) ────
  function renderModelRow(brand, model, items, idx) {
    const modelKey = `${brand}::${model}`;
    const isModelOpen = expandedModels.has(modelKey);
    const summary = getModelSummary(items);
    const idPanneau = `modele-${brand}-${model}`.replace(/[^a-zA-Z0-9_-]/g, '-');
    return (
      <div key={model}>
        <button type="button" onClick={() => toggleModel(modelKey)}
          aria-expanded={isModelOpen} aria-controls={idPanneau}
          className={`w-full min-h-12 flex items-center px-4 sm:px-5 py-2 text-left border-t border-slate-100 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500
            ${isModelOpen ? 'bg-brand-50/60' : 'bg-white hover:bg-slate-50'}`}>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {isModelOpen ? <ChevronDown className="w-4 h-4 text-brand-600 shrink-0" aria-hidden="true" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />}
            <span className="font-semibold text-sm text-slate-900 truncate">{model}</span>
            {summary.qualityCount > 0 && (
              <span className={`badge badge-sm ${isModelOpen ? 'badge-brand' : 'badge-neutral'}`}>
                {summary.qualityCount} qualit{summary.qualityCount > 1 ? 'es' : 'e'}
              </span>
            )}
            {summary.outOfStock > 0 && (
              <span className="badge badge-sm badge-danger">
                {summary.outOfStock} rupture{summary.outOfStock > 1 ? 's' : ''}
              </span>
            )}
            {summary.ancien && <BadgeDatePrix row={summary.ancien} seuils={seuils} court className="hidden md:inline-flex" />}
          </div>
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            {renderPriceBadge(summary.batterie, Battery, COLOR_BATT)}
            {renderPriceBadge(summary.connecteur, Plug, COLOR_CONN)}
            {renderPriceBadge(summary.camera, Camera, COLOR_CAM)}
          </div>
          <div className="flex sm:hidden items-center gap-1 shrink-0 ml-2">
            {renderPriceBadge(summary.batterie, Battery, COLOR_BATT, true)}
            {renderPriceBadge(summary.connecteur, Plug, COLOR_CONN, true)}
            {renderPriceBadge(summary.camera, Camera, COLOR_CAM, true)}
          </div>
        </button>

        {isModelOpen && (
          <div id={idPanneau} className="px-4 sm:px-5 py-4 bg-slate-50 border-t border-slate-100">
            {summary.screenItems.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Smartphone className="w-4 h-4 text-slate-400" aria-hidden="true" />
                  <span className="t-h3">Ecrans disponibles</span>
                </div>
                <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {summary.screenItems.map((t) => {
                    const qc = QUALITY_COLORS[t.qualite] || DEFAULT_QUALITY;
                    return (
                      <div key={t.id} className={`card p-3 ${t.en_stock === false ? 'border-red-200 opacity-70' : ''}`}>
                        <div className="flex items-center justify-between gap-1 mb-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: qc.color }} aria-hidden="true" />
                            <span className="text-xs font-semibold text-slate-700 truncate">{t.qualite || 'Standard'}</span>
                          </div>
                          {renderStockBadge(t)}
                        </div>
                        <div className="text-xl font-semibold leading-none text-slate-900 tabular-nums">{formatPrice(t.prix_client)}</div>
                        {showHT && isAdmin && t.prix_fournisseur_ht != null && (
                          <div className="t-caption mt-1.5 tabular-nums">
                            Achat : {Number(t.prix_fournisseur_ht).toFixed(2)} € HT
                          </div>
                        )}
                        {renderMarge(t)}
                        {renderPiedCarte(t)}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {Object.keys(summary.otherByType).length > 0 && (
              <div className={summary.screenItems.length > 0 ? 'mt-4' : ''}>
                <div className="flex items-center gap-2 mb-3">
                  <Package className="w-4 h-4 text-slate-400" aria-hidden="true" />
                  <span className="t-h3">Autres pieces</span>
                </div>
                <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {Object.entries(summary.otherByType).map(([type, pieces]) => {
                    const pc = getPieceTypeColor(type); const Icon = getPieceIcon(type);
                    return pieces.map((t) => (
                      <div key={t.id} className={`card p-3 ${t.en_stock === false ? 'border-red-200 opacity-70' : ''}`}>
                        <div className="flex items-center justify-between gap-1 mb-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Icon className="w-4 h-4 shrink-0" style={{ color: pc.color }} aria-hidden="true" />
                            <span className="text-xs font-semibold text-slate-700 truncate">{type}{t.qualite ? ` ${t.qualite}` : ''}</span>
                          </div>
                          {renderStockBadge(t)}
                        </div>
                        <div className="text-lg font-semibold leading-none text-slate-900 tabular-nums">{formatPrice(t.prix_client)}</div>
                        {showHT && isAdmin && t.prix_fournisseur_ht != null && (
                          <div className="t-caption mt-1.5 tabular-nums">
                            Achat : {Number(t.prix_fournisseur_ht).toFixed(2)} € HT
                          </div>
                        )}
                        {renderPiedCarte(t)}
                      </div>
                    ));
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─── Device table for iPad/MacBook ────
  function renderDeviceSection({ devices, label, icon: SIcon, color, marge, sectionKey }) {
    // Section vide : montrée à l'admin pour ajouter des prix, jamais quand la grille est filtrée
    if (!devices.length && (!isAdmin || filtreActif)) return null;
    const isOpen = expandedSeries.has(sectionKey);
    const tva = String(regles?.tva ?? 1.2).replace('.', ',');
    return (
      <div key={sectionKey}>
        <button type="button" onClick={() => toggleSerie(sectionKey)} aria-expanded={isOpen}
          className={`w-full min-h-12 px-4 sm:px-5 py-2 border-t border-slate-100 flex items-center justify-between cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${isOpen ? 'bg-brand-50/60' : 'bg-white hover:bg-slate-50'}`}>
          <div className="flex items-center gap-2">
            {isOpen ? <ChevronDown className="w-4 h-4 text-brand-600" aria-hidden="true" /> : <ChevronRight className="w-4 h-4 text-slate-400" aria-hidden="true" />}
            <SIcon className="w-4 h-4 text-slate-400" aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-900">{label}</span>
            <span className="t-caption">({devices.length})</span>
          </div>
        </button>

        {isOpen && (
          <>
            {isAdmin && (
              <div className="px-4 sm:px-5 py-2 border-t border-slate-100 bg-slate-50 flex items-center gap-2">
                <Calculator className="w-4 h-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span className="t-caption">
                  Formule : (prix pièce HT × {tva}) + {marge} € de main d’œuvre, arrondi au 9
                </span>
              </div>
            )}

            {devices.length === 0 ? (
              <div className="px-5 py-6 text-center t-caption">Aucun tarif {label} pour le moment</div>
            ) : (
              <div className="divide-y divide-slate-100 border-t border-slate-100">
                <div className="hidden sm:flex items-center px-4 sm:px-5 py-2 bg-slate-50 table-header">
                  <div className="flex-1 pl-2">Modele</div>
                  <div className="w-28 text-center">Ecran</div>
                  {showHT && isAdmin && <div className="w-24 text-center">Ecran HT</div>}
                  <div className="w-28 text-center">Batterie</div>
                  {showHT && isAdmin && <div className="w-24 text-center">Batterie HT</div>}
                  <div className="w-36 text-center">Prix du</div>
                </div>
                {devices.map((d, i) => (
                  <div key={d.id || i} className="flex flex-col sm:flex-row items-start sm:items-center px-4 sm:px-5 py-2 gap-2 sm:gap-0 min-h-12 bg-white hover:bg-slate-50 transition-colors duration-150">
                    <div className="flex-1 pl-2 font-semibold text-sm text-slate-900 flex items-center gap-1.5">
                      {isAdmin
                        ? <BoutonVerrou verrouille={!!d.verrou_manuel} onClick={() => basculerVerrouAppareil(d)} disabled={verrouEnCours === `apple-${d.id}`} nom={`les prix de ${d.modele}`} />
                        : <BoutonVerrou verrouille={!!d.verrou_manuel} lectureSeule nom={d.modele} />}
                      {d.modele}
                    </div>
                    <div className="w-28 sm:text-center">
                      {d.ecran_prix_vente ? <span className="t-num text-sm"><span className="sm:hidden text-slate-500 font-medium">Écran : </span>{formatPrice(d.ecran_prix_vente)}</span> : <span className="text-slate-400" aria-label="pas de prix">-</span>}
                      {renderMarge(d, true)}
                    </div>
                    {showHT && isAdmin && (
                      <div className="w-24 sm:text-center t-caption tabular-nums">
                        {d.ecran_prix_ht != null ? `${Number(d.ecran_prix_ht).toFixed(2)} € HT` : '-'}
                      </div>
                    )}
                    <div className="w-28 sm:text-center">
                      {d.batterie_prix_vente ? <span className="t-num text-sm"><span className="sm:hidden text-slate-500 font-medium">Batterie : </span>{formatPrice(d.batterie_prix_vente)}</span> : <span className="text-slate-400" aria-label="pas de prix">-</span>}
                    </div>
                    {showHT && isAdmin && (
                      <div className="w-24 sm:text-center t-caption tabular-nums">
                        {d.batterie_prix_ht != null ? `${Number(d.batterie_prix_ht).toFixed(2)} € HT` : '-'}
                      </div>
                    )}
                    <div className="sm:w-36 sm:text-center">
                      <BadgeDatePrix row={d} seuils={seuils} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // Sections iPad / MacBook : mêmes neutres que le reste de la grille (la couleur ne porte plus la hiérarchie)
  const IPAD_COLOR = {};
  const MACBOOK_COLOR = {};
  const fermerFenetre = () => setFenetre(null);
  const marquesGrille = [...new Set(tousTarifs.map((t) => t.marque).filter(Boolean))];
  function ouvrirAjout(texte) {
    setAjoutInitial(decouperRecherche(texte, marquesGrille));
    setFenetre('ajout');
  }
  // Pièce ajoutée (ou déjà existante) : la grille est relue et la recherche montre ce modèle
  function pieceAjoutee(ligne) {
    setFenetre(null);
    relire();
    const texte = [ligne?.marque, ligne?.modele].filter(Boolean).join(' ');
    if (texte) setSearch(texte);
  }

  // ─── RENDER ────────────────────────────────────
  return (
    <div className="page max-w-[1280px]">
      {/* Header */}
      <div>
        <div className="page-header">
            <div className="min-w-0">
              <h1 className="page-header-title">Grille Tarifaire</h1>
              <p className="page-header-subtitle truncate">
                {stats ? `${stats.modeles} modeles · ${stats.marques} marques · ${formatPrice(stats.prix_min)} → ${formatPrice(stats.prix_max)}` : 'Chargement...'}
              </p>
            </div>
            <div className="page-header-actions max-w-full">
              {/* HT toggle — admin only */}
              {isAdmin && (
                <button type="button" onClick={basculerHT} aria-pressed={showHT}
                  className={`btn-secondary ${showHT ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100' : ''}`}>
                  {showHT ? <Unlock aria-hidden="true" /> : <Lock aria-hidden="true" />}
                  <span className="hidden sm:inline">{showHT ? 'Prix HT visibles' : 'Prix HT masques'}</span>
                  <span className="sm:hidden sr-only">Prix d’achat HT</span>
                </button>
              )}
              {isAdmin && (
                <button type="button" onClick={handleCheckStock} disabled={checkingStock || isRevalidating}
                  aria-label="Vérifier le stock chez Mobilax"
                  className="btn-secondary">
                  <PackageX className={checkingStock ? 'motion-safe:animate-pulse' : ''} aria-hidden="true" />
                  <span className="hidden sm:inline">{checkingStock ? 'Verification...' : 'Verifier stock'}</span>
                </button>
              )}
              <button type="button" onClick={relire}
                disabled={isRevalidating || checkingStock}
                aria-label="Actualiser les tarifs"
                className="btn-secondary">
                <RefreshCw className={isRevalidating ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
                <span className="hidden sm:inline">{isRevalidating ? 'Chargement...' : 'Actualiser'}</span>
              </button>
            </div>
        </div>
        <div>

          {!loading && (
            <BandeauPrix
              resume={resume}
              sante={sante}
              isAdmin={isAdmin}
              nbObsoletes={nbObsoletes}
              basePath={basePath}
              onImporter={() => setFenetre('import')}
              onRegles={() => setFenetre('regles')}
              onRecalculer={() => setFenetre('recalcul')}
              onHistorique={() => setFenetre('historique')}
              onAjouter={() => ouvrirAjout(search)}
              onDevenirAdmin={() => setShowAdminLogin(true)}
            />
          )}

          {stockResult && !stockResult.error && (
            <div role="status" className="callout callout-success mb-4">
              <div className="flex items-center justify-between gap-2 flex-1">
                <div>
                  {stockResult.models_found != null ? (
                    <>
                      <span className="font-semibold">{stockResult.models_found}</span> modeles trouves sur Mobilax
                      {' / '}<span className="font-semibold">{stockResult.models_checked}</span> verifies
                      {' — '}<span className="font-semibold">{stockResult.tarifs_updated}</span> mises a jour
                      {stockResult.now_rupture > 0 && <span className="text-red-700 font-semibold ml-2">({stockResult.now_rupture} ruptures)</span>}
                      {stockResult.now_in_stock > 0 && <span className="font-semibold ml-2">({stockResult.now_in_stock} retour en stock)</span>}
                    </>
                  ) : (
                    <>{stockResult.message || 'Vérification du stock lancée en arrière-plan'} : actualisez dans quelques minutes pour voir les ruptures.</>
                  )}
                </div>
                <button type="button" onClick={() => setStockResult(null)} aria-label="Masquer le résultat"
                  className="btn-ghost btn-icon shrink-0 -my-2 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900">
                  <X aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
          {stockResult?.error && (
            <div role="alert" className="callout callout-danger items-center mb-4">
              <span className="flex-1">{typeof stockResult.error === 'string' ? stockResult.error : 'Erreur lors de la verification du stock.'}</span>
              <button type="button" onClick={() => setStockResult(null)} aria-label="Masquer le message"
                className="btn-ghost btn-icon shrink-0 -my-2 text-red-700 hover:bg-red-100 hover:text-red-800">
                <X aria-hidden="true" />
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 sm:min-w-[220px]">
              <label htmlFor="tarifs-recherche" className="sr-only">Rechercher un modèle</label>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
              <input ref={rechercheRef} id="tarifs-recherche" type="search" placeholder="Rechercher un modele..." value={search} onChange={e => setSearch(e.target.value)}
                className="input pl-10" />
            </div>
            <div className="flex gap-2 items-center min-w-0" role="group" aria-label="Filtres">
              <FiltreAnciens actif={anciensSeuls} onChange={setAnciensSeuls} nombre={nombreAnciens} />
              <div className="scroll-fade-x min-w-0">
                <div className="segmented">
                  {BRAND_FILTERS.filter(b => b === 'Toutes' || grouped.some(g => g.brand === b) || brandFilter === b).map(b => (
                    <button key={b} type="button" aria-pressed={brandFilter === b}
                      onClick={() => { setBrandFilter(b); if (b === 'Toutes') { setExpandedBrands(new Set()); setExpandedModels(new Set()); setExpandedSeries(new Set()); } }}
                      className={`segmented-item ${brandFilter === b ? 'segmented-item-active' : ''}`}>
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Filtres arrivés par l'URL (tuiles « Santé des prix ») : visibles et effaçables */}
          {filtresActifs.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filtres actifs">
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
                <button type="button" onClick={() => retirerFiltresUrl(filtresActifs.map((f) => f.cle))}
                  className="btn-ghost btn-sm underline underline-offset-2">
                  Effacer les filtres
                </button>
              )}
              {!loading && !margesMasquees && (
                <span role="status" className="t-caption">
                  {nbCorrespondants} prix correspond{nbCorrespondants > 1 ? 'ent' : ''}
                </span>
              )}
            </div>
          )}
          {margesMasquees && !loading && (
            <div role="status" className="callout callout-warning items-center flex-wrap mt-3">
              <Lock aria-hidden="true" />
              <span className="flex-1 min-w-[220px]">
                Les marges se calculent avec les prix d’achat HT, masqués tant que le code administrateur n’est pas saisi sur ce poste.
              </span>
              <button type="button" onClick={afficherMarges} disabled={lectureMarges}
                className="btn-primary btn-sm">
                <Unlock aria-hidden="true" />
                {lectureMarges ? 'Lecture des marges…' : 'Afficher les marges (code admin)'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="mt-6 space-y-4">
        {loading ? (
          <div className="loading-inline justify-center w-full py-20" role="status">
            <Loader2 aria-hidden="true" /> Chargement des tarifs...
          </div>
        ) : grouped.length === 0 && !(filtreActif && appleVisible && devicesVisibles.length) ? (
          <div className="empty-state card">
            <div className="empty-state-icon"><Tag aria-hidden="true" /></div>
            <p className="t-body text-slate-500 max-w-sm">
              {margesMasquees ? 'Saisissez le code administrateur pour voir les marges faibles.'
                : filtreUrlActif ? `Aucun prix pour ce filtre : ${filtresActifs.map((f) => f.libelle).join(', ')}.`
                  : anciensSeuls ? 'Aucun prix de plus de 3 mois.' : debouncedSearch.trim() ? `Aucune pièce pour « ${debouncedSearch.trim()} ».` : 'Aucun tarif trouvé.'}
            </p>
            {filtreUrlActif && !margesMasquees && (
              <button type="button" onClick={() => retirerFiltresUrl(filtresActifs.map((f) => f.cle))}
                className="btn-secondary">
                <X aria-hidden="true" /> Voir toute la grille
              </button>
            )}
            {!filtreActif && debouncedSearch.trim() && (isAdmin ? (
              <button type="button" onClick={() => ouvrirAjout(debouncedSearch)}
                className="btn-primary">
                <PackagePlus aria-hidden="true" /> Ajouter une pièce pour ce modèle
              </button>
            ) : (
              <p className="text-sm text-slate-500">Un administrateur peut l’ajouter : « Mettre à jour les prix (admin) » en haut de page.</p>
            ))}
          </div>
        ) : (
          grouped.map(({ brand, models }) => {
            const bc = BRAND_CONFIG[brand] || DEFAULT_BRAND;
            const isBrandOpen = expandedBrands.has(brand);
            const isApple = brand === 'Apple';

            return (
              <div key={brand} className={`card overflow-hidden ${isBrandOpen ? 'border-brand-300' : ''}`}>
                {/* NIVEAU 1 : Header marque — la couleur de marque tient sur une pastille de 32 px */}
                <button type="button" onClick={() => toggleBrand(brand)} aria-expanded={isBrandOpen}
                  className="w-full min-h-14 px-4 sm:px-5 py-3 flex items-center justify-between gap-3 cursor-pointer transition-colors duration-150 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500">
                  <div className="flex items-center gap-3 min-w-0">
                    {isBrandOpen ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />}
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: bc.bg, color: bc.text }} aria-hidden="true">
                      <BrandLogo slug={bc.logo} />
                    </span>
                    <span className="t-h2 truncate">{brand}</span>
                  </div>
                  <span className="t-caption shrink-0">
                    {models.length} modele{models.length > 1 ? 's' : ''}
                  </span>
                </button>

                {/* ═══════ APPLE: iPhone series + iPad + MacBook ═══════ */}
                {isBrandOpen && isApple && (
                  <div>
                    <div className="px-4 sm:px-5 py-2 border-t border-slate-100 bg-slate-50 flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-slate-400" aria-hidden="true" />
                      <span className="t-h3">iPhone</span>
                      <span className="t-caption">({appleIPhoneSeries.reduce((s, sr) => s + sr.models.length, 0)} modeles)</span>
                    </div>

                    {appleIPhoneSeries.map(({ serie, models: serieModels }) => {
                      const serieKey = `apple-serie-${serie}`;
                      const isSerieOpen = expandedSeries.has(serieKey);
                      return (
                        <div key={serie}>
                          <button type="button" onClick={() => toggleSerie(serieKey)} aria-expanded={isSerieOpen}
                            className={`w-full min-h-12 flex items-center px-4 sm:px-5 py-2 text-left transition-colors duration-150 border-t border-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${isSerieOpen ? 'bg-brand-50/60' : 'hover:bg-slate-50 bg-white'}`}>
                            <div className="flex items-center gap-2 flex-1">
                              {isSerieOpen ? <ChevronDown className="w-4 h-4 text-brand-600 shrink-0" aria-hidden="true" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />}
                              <span className="font-semibold text-sm text-slate-900">Serie {serie === 'X/XS/XR' ? serie : `iPhone ${serie}`}</span>
                              <span className="badge badge-sm badge-neutral">
                                {serieModels.length} modele{serieModels.length > 1 ? 's' : ''}
                              </span>
                            </div>
                          </button>
                          {isSerieOpen && (
                            <div>
                              <div className="hidden sm:flex items-center px-4 sm:px-5 py-2 bg-slate-50 border-t border-slate-100 table-header">
                                <div className="flex-1 pl-7">Modele</div>
                                <div className="text-right pr-1">Pieces disponibles</div>
                              </div>
                              {serieModels.map(({ model, items }, idx) => renderModelRow('Apple', model, items, idx))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {appleOtherModels.length > 0 && appleOtherModels.map(({ model, items }, idx) => renderModelRow('Apple', model, items, idx))}

                    {renderDeviceSection({ devices: iPadDevices, label: 'iPad', icon: Tablet, color: IPAD_COLOR, marge: regles?.ipad ?? 110, sectionKey: 'apple-ipad' })}
                    {renderDeviceSection({ devices: macBookDevices, label: 'MacBook', icon: Laptop, color: MACBOOK_COLOR, marge: regles?.macbook ?? 120, sectionKey: 'apple-macbook' })}
                  </div>
                )}

                {/* ═══════ OTHER BRANDS: flat model list ═══════ */}
                {isBrandOpen && !isApple && (
                  <div>
                    <div className="hidden sm:flex items-center px-4 sm:px-5 py-2 bg-slate-50 border-t border-slate-100 table-header">
                      <div className="flex-1 pl-7">Modele</div>
                      <div className="text-right pr-1">Pieces disponibles</div>
                    </div>
                    {models.map(({ model, items }, idx) => renderModelRow(brand, model, items, idx))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Grille filtrée (« plus de 3 mois », filtre de l'URL) : iPad / MacBook concernés même sans pièce Apple retenue */}
        {!loading && filtreActif && appleVisible && !grouped.some((g) => g.brand === 'Apple') && devicesVisibles.length > 0 && (
          <div className="card overflow-hidden">
            {renderDeviceSection({ devices: iPadDevices, label: 'iPad', icon: Tablet, color: IPAD_COLOR, marge: regles?.ipad ?? 110, sectionKey: 'apple-ipad' })}
            {renderDeviceSection({ devices: macBookDevices, label: 'MacBook', icon: Laptop, color: MACBOOK_COLOR, marge: regles?.macbook ?? 120, sectionKey: 'apple-macbook' })}
          </div>
        )}
      </div>

      {!loading && totalModels > 0 && (
        <div className="mt-6">
          <div className="text-center t-caption space-y-1">
            <p>{totalModels} modèle{totalModels > 1 ? 's' : ''} · {grouped.length} marque{grouped.length > 1 ? 's' : ''} · Source : Mobilax</p>
          </div>
        </div>
      )}

      {/* ─── Fenêtres admin ─── */}
      {fenetre === 'historique' && (
        <HistoriquePrix open onClose={fermerFenetre} sensible={sensible} nommer={nommer} onAnnule={relire} />
      )}

      <Suspense fallback={null}>
        {fenetre === 'recalcul' && (
          <FenetreRecalcul open onClose={fermerFenetre} sensible={sensible} onApplique={relire} />
        )}
        {fenetre === 'ajout' && (
          <AjoutPiecePrix open onClose={fermerFenetre} sensible={sensible} regles={regles} catalogue={tarifs}
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
        onSuccess={() => { setShowAdminLogin(false); setIsAdmin(true); }}
      />
      {adminPrompt}
    </div>
  );
}
