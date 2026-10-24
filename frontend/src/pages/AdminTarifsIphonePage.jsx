import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Smartphone, Save, FileDown, Archive, ArrowLeft, Loader2, Check, X,
  Search, Filter, Rows, AlignJustify, Package, CheckCircle2, CircleOff,
  ChevronRight, AlertTriangle, Sparkles, Power, PowerOff,
  Image as ImageIcon, Star, RefreshCw, SlidersHorizontal, History,
} from 'lucide-react';
import api from '../lib/api';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useEnvoisOptimistes } from '../hooks/useEnvoisOptimistes';
import { useToast } from '../components/Toast';
import HistoriquePrix, { BadgeDatePrix, BoutonVerrou, FenetrePrix, FiltreAnciens, messageErreurPrix, plusDeTroisMois } from '../components/HistoriquePrix';
import { AIDE_VERROU_BOUTIQUE, AjustementColonne, useVerrousBoutique } from '../components/ReglesPrixPanel';

const TABLE = 'iphone_tarifs';
const COLONNES_PRIX = [
  { key: 'prix_1', label: 'Prix 1 (1er stockage)' },
  { key: 'prix_2', label: 'Prix 2 (2e stockage)' },
  { key: 'prix_3', label: 'Prix 3 (3e stockage)' },
];

const API_URL = import.meta.env.VITE_API_URL || '';

// Construit une URL de téléchargement PDF avec le token JWT en query
// (utilisé en _blank pour laisser le navigateur ouvrir l'onglet)
function pdfUrl(path) {
  const token = localStorage.getItem('kp_token');
  const url = `${API_URL}${path}`;
  // On passe le token dans un header via fetch blob pour sécurité
  return { url, token };
}

// Via l'ApiClient : message d'erreur du serveur (« Aucun modèle trouvé »…) plutôt que « Erreur 404 »
async function downloadPdf(path, filename) {
  const blob = await api.requestRaw(path, { as: 'blob', timeoutMs: 120_000 });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function openPdfInNewTab(path) {
  const blob = await api.requestRaw(path, { as: 'blob', timeoutMs: 60_000 });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ─── Modifications non enregistrées : avertir avant de quitter la page ───
// Fermeture ou rechargement de l'onglet : beforeunload. Navigation interne (barre latérale :
// navigate()) : l'app est sous <BrowserRouter>, sans data router, donc sans useBlocker ; tant
// qu'il reste des modifications, la page intercepte history.pushState vers une autre page et
// propose « Enregistrer et quitter » / « Quitter sans enregistrer » / « Rester sur la page ».
// Entrée dans un champ de la ligne : enregistre la ligne (comme le bouton « Enregistrer »)
function entreeLigne(e, dirty, enregistrer) {
  if (e.key !== 'Enter' || !dirty || e.defaultPrevented || e.nativeEvent?.isComposing) return;
  if (e.target?.tagName !== 'INPUT' || ['checkbox', 'radio', 'button'].includes(e.target.type)) return;
  e.preventDefault();
  enregistrer();
}

function useGardeModifications(actif) {
  const navigate = useNavigate();
  const [cible, setCible] = useState(null);
  const laisserPasser = useRef(false);
  useEffect(() => {
    if (!actif || typeof window === 'undefined') return undefined;
    const avantDepart = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avantDepart);
    const historique = window.history;
    const pushOrigine = historique.pushState;
    const pushGarde = function pushState(state, titre, url) {
      let dest = null;
      try { dest = url != null ? new URL(String(url), window.location.href) : null; } catch { dest = null; }
      if (!laisserPasser.current && dest && dest.origin === window.location.origin
          && dest.pathname !== window.location.pathname) {
        setCible(`${dest.pathname}${dest.search}${dest.hash}`);
        return undefined;
      }
      return pushOrigine.call(this, state, titre, url);
    };
    historique.pushState = pushGarde;
    return () => {
      window.removeEventListener('beforeunload', avantDepart);
      if (historique.pushState === pushGarde) historique.pushState = pushOrigine;
    };
  }, [actif]);
  const partir = useCallback((dest) => {
    setCible(null);
    laisserPasser.current = true;
    try { navigate(dest); } finally { laisserPasser.current = false; }
  }, [navigate]);
  const rester = useCallback(() => setCible(null), []);
  return { cible, partir, rester };
}

// `envois` : lignes déjà validées dont l'envoi n'est pas terminé (rien à saisir, seulement à attendre)
function FenetreQuitter({ garde, nombre, envois = 0, enregistrer }) {
  const [enCours, setEnCours] = useState(false);
  const { cible, partir, rester } = garde;
  const seulementEnvois = nombre === 0 && envois > 0;
  async function enregistrerPuisPartir() {
    setEnCours(true);
    try {
      if (await enregistrer()) partir(cible);
    } finally {
      setEnCours(false);
    }
  }
  return (
    <FenetrePrix
      open={!!cible}
      onClose={rester}
      bloquer={enCours}
      largeur="max-w-xl"
      icone={AlertTriangle}
      titre={seulementEnvois ? 'Enregistrement en cours' : 'Modifications non enregistrées'}
      sousTitre={seulementEnvois
        ? `${envois} ligne${envois > 1 ? 's' : ''} en cours d’envoi au serveur.`
        : `${nombre} ligne${nombre > 1 ? 's' : ''} modifiée${nombre > 1 ? 's' : ''} pas encore enregistrée${nombre > 1 ? 's' : ''}.`}
      pied={(
        <div className="flex flex-col-reverse sm:flex-row sm:flex-wrap sm:justify-end gap-2">
          <button type="button" onClick={rester} disabled={enCours} className="btn-ghost">Rester sur la page</button>
          <button type="button" onClick={() => partir(cible)} disabled={enCours} className="btn-secondary">
            {seulementEnvois ? 'Quitter sans attendre' : 'Quitter sans enregistrer'}
          </button>
          <button type="button" onClick={enregistrerPuisPartir} disabled={enCours} className="btn-primary">
            {enCours ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save aria-hidden="true" />}
            {seulementEnvois ? 'Attendre et quitter' : 'Enregistrer et quitter'}
          </button>
        </div>
      )}
    >
      <p className="t-body">
        {seulementEnvois
          ? 'Les nouveaux prix partent vers le serveur. En quittant sans attendre, un échec éventuel sera signalé par une notification.'
          : 'Sans enregistrement, ces changements de prix ou de stock seront perdus.'}
      </p>
    </FenetrePrix>
  );
}

function useBasePath() {
  const location = useLocation();
  return location.pathname.startsWith('/tech') ? '/tech' : '/accueil';
}

// Helpers

function stockLevel(n) {
  const v = Number(n) || 0;
  if (v < 2) return 'low';
  if (v <= 5) return 'mid';
  return 'high';
}

function StockBadge({ value, onChange, label = 'Stock' }) {
  const lvl = stockLevel(value);
  const tone =
    lvl === 'low'
      ? 'border-red-200 bg-red-50 text-red-700 focus-within:border-red-400'
      : lvl === 'mid'
      ? 'border-amber-200 bg-amber-50 text-amber-800 focus-within:border-amber-400'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700 focus-within:border-emerald-400';
  return (
    <div
      className={`inline-flex items-center justify-center rounded-lg border px-1 transition-colors duration-150 focus-within:ring-2 focus-within:ring-brand-500/40 ${tone}`}
      title={lvl === 'low' ? 'Stock faible' : lvl === 'mid' ? 'Stock moyen' : 'Stock OK'}
    >
      <input
        type="number"
        min="0"
        value={value ?? 0}
        onChange={onChange}
        aria-label={label}
        className="w-12 min-h-[40px] bg-transparent text-center font-semibold text-base lg:text-sm tabular-nums outline-none"
      />
    </div>
  );
}

function ConditionPill({ value, onChange, label = 'Condition' }) {
  const isNeuf = value === 'Neuf';
  return (
    <div className="relative">
      <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full pointer-events-none ${isNeuf ? 'bg-emerald-500' : 'bg-blue-500'}`} aria-hidden="true" />
      <select
        value={value || 'Reconditionné Premium'}
        onChange={onChange}
        aria-label={label}
        className="select w-full pl-6 pr-8 font-medium"
      >
        <option value="Neuf">Neuf</option>
        <option value="Reconditionné Premium">Recond. Premium</option>
      </select>
    </div>
  );
}

export default function AdminTarifsIphonePage() {
  const basePath = useBasePath();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  // Lignes envoyées : la ligne quitte l'état « modifiée » tout de suite, l'envoi part derrière (un à la fois par ligne)
  const envois = useEnvoisOptimistes();
  const toastGlobal = useToast(); // notifications de l'application : restent visibles après un changement de page
  const [dirty, setDirty] = useState({}); // { id: true }
  const [toast, setToast] = useState(null);
  const [selected, setSelected] = useState(new Set()); // Set<slug>
  const [generatingId, setGeneratingId] = useState(null);
  const [imagePicker, setImagePicker] = useState(null); // { row, candidates: [urls] }
  const { sensible, adminPrompt } = useAdminElevation();
  const { verrouilles, basculer: basculerVerrou, enCours: verrouEnCours } = useVerrousBoutique(TABLE, sensible);
  const [anciensSeuls, setAnciensSeuls] = useState(false);
  const [fenetre, setFenetre] = useState(null); // 'ajuster' | 'historique'

  // Nouveaux états UI
  const [query, setQuery] = useState('');
  const [conditionFilter, setConditionFilter] = useState('all'); // 'all' | 'Neuf' | 'Reconditionné Premium'
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'active' | 'inactive'
  const [compact, setCompact] = useState(false);
  const [scrollHint, setScrollHint] = useState(false);
  const scrollerRef = useRef(null);

  useEffect(() => {
    load();
  }, []);

  // Détecte si un scroll horizontal est nécessaire (pour afficher le hint mobile)
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const check = () => {
      setScrollHint(el.scrollWidth > el.clientWidth + 4 && el.scrollLeft < 8);
    };
    check();
    el.addEventListener('scroll', check);
    window.addEventListener('resize', check);
    return () => {
      el.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [rows, loading, compact]);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get('/api/iphone-tarifs');
      setRows(data || []);
    } catch (e) {
      showToast('error', messageErreurPrix(e, 'Chargement impossible') || 'Chargement impossible', 5000);
    } finally {
      setLoading(false);
    }
  }

  // Message d'erreur lisible ; rien si l'identification admin a été annulée
  function toastErreur(e, action) {
    const msg = messageErreurPrix(e, action);
    if (msg) showToast('error', msg, 5000);
  }

  function showToast(type, msg, duration = 2500) {
    setToast({ type, msg });
    if (duration > 0) setTimeout(() => setToast(null), duration);
  }

  function updateRow(id, field, value) {
    setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
    setDirty(d => ({ ...d, [id]: true }));
  }

  function buildPayload(row) {
    return {
      modele: row.modele,
      stockage_1: row.stockage_1,
      prix_1: row.prix_1 ? Number(row.prix_1) : null,
      stockage_2: row.stockage_2,
      prix_2: row.prix_2 ? Number(row.prix_2) : null,
      stockage_3: row.stockage_3 || null,
      prix_3: row.prix_3 ? Number(row.prix_3) : null,
      stock_1: row.stock_1 != null ? Number(row.stock_1) : 0,
      stock_2: row.stock_2 != null ? Number(row.stock_2) : 0,
      stock_3: row.stock_3 != null ? Number(row.stock_3) : 0,
      grade: row.grade,
      condition: row.condition || 'Reconditionné Premium',
      das_tete: row.das_tete,
      das_corps: row.das_corps,
      das_membre: row.das_membre,
      actif: row.actif,
      // Inclure image_url pour que saveRow() preserve la photo choisie via le picker.
      // undefined = omit dans le JSON (exclude_unset cote pydantic), null = effacer.
      ...(row.image_url !== undefined ? { image_url: row.image_url } : {}),
    };
  }

  // Optimiste : la ligne n'est plus « modifiée » dès le clic (ou Entrée) ; un échec la remet modifiée,
  // la saisie reste à l'écran et le bouton « Enregistrer » permet de réessayer.
  // La ligne part entière : un envoi plus récent de la même ligne (en file) reprend aussi cette saisie,
  // l'échec d'un envoi dépassé ne remet donc rien en « modifiée ».
  // Page quittée pendant l'envoi : l'échec est signalé par une notification globale.
  async function saveRow(row) {
    const payload = buildPayload(row);
    setDirty(d => { const n = { ...d }; delete n[row.id]; return n; });
    const res = await envois.envoyer(row.id, () => sensible(() => api.patch(`/api/iphone-tarifs/${row.id}`, payload)),
      { apres: { ligne: payload } });
    if (res.ok) {
      if (envois.monte()) showToast('success', `${row.modele} sauvegardé`);
      return true;
    }
    if (res.proteges.has('ligne')) return false;
    const msg = messageErreurPrix(res.erreur, `${row.modele} non enregistré`);
    if (!envois.monte()) {
      if (msg) toastGlobal.error(msg);
      return false;
    }
    setDirty(d => ({ ...d, [row.id]: true }));
    if (msg) showToast('error', msg, 5000);
    return false;
  }

  // Toutes les lignes modifiées (avant un ajustement en %) ; un échec arrête la série.
  // Les envois déjà partis (Entrée) sont attendus aussi.
  async function saveAllDirty() {
    for (const r of rows.filter((x) => dirty[x.id])) {
      if (!(await saveRow(r))) return false;
    }
    return envois.attendre();
  }

  // ─── Recherche d'image via DuckDuckGo (meme pattern que smartphones) ─
  async function generateImage(row) {
    setGeneratingId(row.id);
    try {
      const res = await api.generateIphoneImage(row.modele, row.stockage_1);
      setImagePicker({
        row,
        candidates: [res.image_url, ...(res.alternatives || [])],
        query: res.query || `Apple ${row.modele} png transparent`,
        searching: false,
      });
    } catch (e) {
      showToast('error', `Erreur recherche image : ${e.message}`, 3500);
    } finally {
      setGeneratingId(null);
    }
  }

  // Re-recherche avec une query custom (depuis le modal)
  async function researchWithQuery(customQuery) {
    if (!imagePicker) return;
    setImagePicker(p => ({ ...p, searching: true }));
    try {
      const res = await api.generateIphoneImage(imagePicker.row.modele, imagePicker.row.stockage_1, customQuery);
      setImagePicker(p => ({
        ...p,
        candidates: [res.image_url, ...(res.alternatives || [])],
        query: res.query || customQuery,
        searching: false,
      }));
    } catch (e) {
      showToast('error', `Erreur recherche : ${e.message}`, 3500);
      setImagePicker(p => ({ ...p, searching: false }));
    }
  }

  // Generation IA via Pollinations (fond blanc/cutout garanti)
  async function generateAiVariants() {
    if (!imagePicker) return;
    setImagePicker(p => ({ ...p, searching: true }));
    try {
      const res = await api.generateAiIphoneImage(imagePicker.row.modele, imagePicker.row.stockage_1, null, 4);
      // Ajoute les IA en haut de la liste existante (user peut scroll pour voir DDG ensuite)
      setImagePicker(p => ({
        ...p,
        candidates: [res.image_url, ...(res.alternatives || []), ...p.candidates],
        searching: false,
      }));
      showToast('success', '4 photos IA générées (fond blanc)');
    } catch (e) {
      showToast('error', `Erreur IA : ${e.message}`, 3500);
      setImagePicker(p => ({ ...p, searching: false }));
    }
  }

  async function chooseImage(row, url) {
    try {
      await sensible(() => api.patch(`/api/iphone-tarifs/${row.id}`, { image_url: url }));
      // Reflete l'image_url dans la row en memoire (optimistic)
      setRows(rs => rs.map(r => r.id === row.id ? { ...r, image_url: url } : r));
      setImagePicker(null);
      showToast('success', 'Image enregistrée');
    } catch (e) {
      toastErreur(e, 'Image non enregistrée');
    }
  }

  async function handlePdfOne(row) {
    try {
      await openPdfInNewTab(`/api/iphone-tarifs/pdf?slugs=${row.slug}`);
    } catch (e) {
      showToast('error', `PDF : ${e.message}`);
    }
  }

  function toggleSelect(slug) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else {
        if (next.size >= 2) {
          showToast('error', 'Maximum 2 modèles par PDF (1 page A4)');
          return prev;
        }
        next.add(slug);
      }
      return next;
    });
  }

  async function handlePdfSelection() {
    if (selected.size === 0) return;
    const slugs = rows.filter(r => selected.has(r.slug)).map(r => r.slug).join(',');
    try {
      await openPdfInNewTab(`/api/iphone-tarifs/pdf?slugs=${slugs}`);
      showToast('success', 'PDF ouvert', 2000);
    } catch (e) {
      showToast('error', `PDF : ${e.message}`);
    }
  }

  async function handlePdfAll() {
    try {
      await downloadPdf('/api/iphone-tarifs/pdf/all-zip', 'klikphone_tarifs_iphones.zip');
      showToast('success', 'ZIP téléchargé');
    } catch (e) {
      showToast('error', `ZIP : ${e.message}`);
    }
  }

  async function handlePdfFull() {
    try {
      await openPdfInNewTab('/api/iphone-tarifs/pdf');
    } catch (e) {
      showToast('error', `PDF : ${e.message}`);
    }
  }

  // Action groupée activer/désactiver sur les lignes visibles sélectionnées
  async function bulkToggleActive(value) {
    const targets = filteredRows.filter(r => selected.has(r.slug));
    if (targets.length === 0) {
      showToast('error', 'Aucune ligne sélectionnée');
      return;
    }
    setSavingId('bulk');
    let ok = 0;
    let derniereErreur = null;
    const reussies = new Set();
    for (const r of targets) {
      try {
        await sensible(() => api.patch(`/api/iphone-tarifs/${r.id}`, buildPayload({ ...r, actif: value })));
        ok++;
        reussies.add(r.id);
      } catch (e) {
        derniereErreur = e;
        if (e?.code === 'admin_cancelled') break;
      }
    }
    setRows(rs => rs.map(r => reussies.has(r.id) ? { ...r, actif: value } : r));
    setSavingId(null);
    const echecs = targets.length - ok;
    if (echecs > 0) {
      const detail = messageErreurPrix(derniereErreur, 'Erreur');
      showToast('error', `${ok} ligne${ok > 1 ? 's' : ''} modifiée${ok > 1 ? 's' : ''}, ${echecs} en échec${detail ? ` (${detail})` : ''}`, 6000);
    } else {
      showToast('success', `${ok} ligne${ok > 1 ? 's' : ''} ${value ? 'activée' : 'désactivée'}${ok > 1 ? 's' : ''}`);
    }
  }

  // Groupement par page_group pour bouton "PDF groupe"
  const groups = useMemo(() => {
    const g = {};
    rows.forEach(r => {
      const key = r.page_group || 'autres';
      if (!g[key]) g[key] = [];
      g[key].push(r);
    });
    return g;
  }, [rows]);

  // Stats globales
  const stats = useMemo(() => {
    const total = rows.length;
    const actifs = rows.filter(r => r.actif !== false).length;
    const stockTotal = rows.reduce((sum, r) => {
      return sum + (Number(r.stock_1) || 0) + (Number(r.stock_2) || 0) + (Number(r.stock_3) || 0);
    }, 0);
    const lowStock = rows.filter(r => {
      const s = (Number(r.stock_1) || 0) + (Number(r.stock_2) || 0) + (Number(r.stock_3) || 0);
      return s < 2;
    }).length;
    return { total, actifs, stockTotal, lowStock };
  }, [rows]);

  const nombreAnciens = useMemo(() => rows.filter(r => plusDeTroisMois(r)).length, [rows]);

  // Lignes filtrées
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (anciensSeuls && !plusDeTroisMois(r)) return false;
      if (conditionFilter !== 'all') {
        const c = r.condition || 'Reconditionné Premium';
        if (c !== conditionFilter) return false;
      }
      if (activeFilter === 'active' && r.actif === false) return false;
      if (activeFilter === 'inactive' && r.actif !== false) return false;
      if (!q) return true;
      const hay = `${r.modele || ''} ${r.stockage_1 || ''} ${r.stockage_2 || ''} ${r.condition || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query, conditionFilter, activeFilter, anciensSeuls]);

  const visibleSlugs = useMemo(() => filteredRows.map(r => r.slug), [filteredRows]);
  const allVisibleSelected = visibleSlugs.length > 0 && visibleSlugs.every(s => selected.has(s));

  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      setSelected(prev => {
        const n = new Set(prev);
        visibleSlugs.forEach(s => n.delete(s));
        return n;
      });
    } else {
      // On respecte la limite de 2 pour le PDF mais on autorise plus pour actions groupées
      setSelected(new Set(visibleSlugs));
    }
  }

  const dirtyCount = Object.keys(dirty).length;
  const rowPadY = compact ? 'py-1' : 'py-2';
  // Lignes modifiées OU envois encore en cours : la navigation interne et la fermeture de l'onglet
  // sont gardées (un envoi coupé ou un échec après le départ passerait inaperçu)
  const garde = useGardeModifications(dirtyCount > 0 || envois.nombre > 0);

  return (
    <div className="page max-w-[1280px]">
      {/* Header */}
      <header>
        <div className="page-header">
          <div className="flex items-start gap-2 min-w-0">
            <Link to={basePath} aria-label="Retour" className="btn-ghost btn-icon shrink-0 -ml-2">
              <ArrowLeft aria-hidden="true" />
            </Link>
            <div className="min-w-0">
              <h1 className="page-header-title truncate">Tarifs iPhones reconditionnés</h1>
              <p className="page-header-subtitle truncate">Gestion catalogue & affiches boutique</p>
            </div>
          </div>
          <div className="page-header-actions max-w-full">
            <button
              onClick={handlePdfFull}
              aria-label="PDF complet"
              className="btn-secondary"
            >
              <FileDown />
              <span className="hidden sm:inline">PDF complet</span>
            </button>
            <button
              onClick={handlePdfAll}
              className="btn-primary"
            >
              <Archive />
              <span className="hidden sm:inline">Tout télécharger (ZIP)</span>
              <span className="sm:hidden">ZIP</span>
            </button>
          </div>
        </div>

        {/* Stats rapides */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={Smartphone} label="Modèles" value={stats.total} tone="brand" />
          <StatCard icon={CheckCircle2} label="Actifs" value={stats.actifs} tone="emerald" />
          <StatCard icon={Package} label="Stock total" value={stats.stockTotal} tone="blue" />
          <StatCard
            icon={AlertTriangle}
            label="Stock faible"
            value={stats.lowStock}
            tone={stats.lowStock > 0 ? 'red' : 'slate'}
          />
        </div>
      </header>

      {/* Toast animé top-right */}
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={`toast fixed top-4 right-4 z-[60] items-center animate-in ${
            toast.type === 'success' ? 'border-l-emerald-600' : 'border-l-red-600'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-700" aria-hidden="true" />
          ) : (
            <AlertTriangle className="w-5 h-5 shrink-0 text-red-700" aria-hidden="true" />
          )}
          <span className="flex-1 font-medium">{toast.msg}</span>
          <button
            onClick={() => setToast(null)}
            className="btn-ghost btn-icon shrink-0"
            aria-label="Fermer le message"
          >
            <X />
          </button>
        </div>
      )}

      {/* Barre flottante de sélection */}
      {selected.size > 0 && (
        <div className="card fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-40 shadow-lg px-3 py-2 flex items-center gap-2 border-brand-300 animate-in max-w-[calc(100vw-2rem)]">
          <span className="text-sm font-semibold text-slate-900 px-2 whitespace-nowrap">
            {selected.size} sélection{selected.size > 1 ? 's' : ''}
          </span>
          <div className="w-px h-6 bg-slate-200" aria-hidden="true" />
          <button
            onClick={handlePdfSelection}
            disabled={selected.size > 2}
            title={selected.size > 2 ? 'Maximum 2 modèles pour le PDF' : 'Générer le PDF'}
            className="btn-primary btn-sm"
          >
            <FileDown />
            PDF
          </button>
          <button
            onClick={() => bulkToggleActive(true)}
            disabled={savingId === 'bulk'}
            className="btn-secondary btn-sm"
          >
            <Power className="text-emerald-700" />
            Activer
          </button>
          <button
            onClick={() => bulkToggleActive(false)}
            disabled={savingId === 'bulk'}
            className="btn-secondary btn-sm"
          >
            <PowerOff className="text-slate-500" />
            Désactiver
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="btn-ghost btn-icon"
            title="Annuler la sélection"
            aria-label="Annuler la sélection"
          >
            <X />
          </button>
        </div>
      )}

      {/* Contenu */}
      <main className="mt-6">
        {loading ? (
          <div className="loading-inline justify-center w-full py-20">
            <Loader2 aria-hidden="true" />
            Chargement des tarifs…
          </div>
        ) : (
          <>
            {/* Barre d'outils : recherche, filtres, mode compact */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher un modèle, stockage…"
                  aria-label="Rechercher un modèle"
                  className="input pl-9 pr-12"
                />
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    className="btn-ghost btn-icon absolute right-0 top-1/2 -translate-y-1/2 text-slate-500"
                    aria-label="Effacer la recherche"
                  >
                    <X />
                  </button>
                )}
              </div>

              <div className="segmented">
                <FilterChip
                  active={conditionFilter === 'all'}
                  onClick={() => setConditionFilter('all')}
                >
                  Tous
                </FilterChip>
                <FilterChip
                  active={conditionFilter === 'Neuf'}
                  onClick={() => setConditionFilter('Neuf')}
                  tone="emerald"
                >
                  Neuf
                </FilterChip>
                <FilterChip
                  active={conditionFilter === 'Reconditionné Premium'}
                  onClick={() => setConditionFilter('Reconditionné Premium')}
                  tone="blue"
                >
                  Recond.
                </FilterChip>
              </div>

              <div className="segmented">
                <FilterChip
                  active={activeFilter === 'all'}
                  onClick={() => setActiveFilter('all')}
                >
                  Tous
                </FilterChip>
                <FilterChip
                  active={activeFilter === 'active'}
                  onClick={() => setActiveFilter('active')}
                  tone="emerald"
                >
                  Actifs
                </FilterChip>
                <FilterChip
                  active={activeFilter === 'inactive'}
                  onClick={() => setActiveFilter('inactive')}
                  tone="slate"
                >
                  Inactifs
                </FilterChip>
              </div>

              <FiltreAnciens actif={anciensSeuls} onChange={setAnciensSeuls} nombre={nombreAnciens} />

              <button
                type="button"
                onClick={() => setFenetre('ajuster')}
                className="btn-secondary"
              >
                <SlidersHorizontal aria-hidden="true" />
                Ajuster en %
              </button>
              <button
                type="button"
                onClick={() => setFenetre('historique')}
                className="btn-secondary"
              >
                <History aria-hidden="true" />
                Historique
              </button>

              <button
                onClick={() => setCompact(c => !c)}
                aria-pressed={compact}
                className={`btn-secondary ${compact ? 'bg-brand-50 text-brand-700 border-brand-300 hover:bg-brand-100' : ''}`}
                title="Mode compact"
              >
                {compact ? <AlignJustify /> : <Rows />}
                <span className="hidden sm:inline">{compact ? 'Compact' : 'Confort'}</span>
              </button>

              {dirtyCount > 0 && (
                <div className="ml-auto badge badge-lg badge-warning" role="status">
                  <span className="badge-dot" aria-hidden="true" />
                  {dirtyCount} modification{dirtyCount > 1 ? 's' : ''} non sauvegardée{dirtyCount > 1 ? 's' : ''}
                </div>
              )}
            </div>

            {/* Hint scroll mobile */}
            {scrollHint && (
              <div className="md:hidden mb-2 flex items-center justify-end gap-1 t-caption pr-1">
                <span>Glisser pour voir plus</span>
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </div>
            )}

            <p className="t-caption mb-3">
              {filteredRows.length} résultat{filteredRows.length > 1 ? 's' : ''}
              {filteredRows.length !== rows.length && ` sur ${rows.length}`}
              {' · '}
              Modifiez les valeurs puis cliquez sur{' '}
              <span className="badge badge-sm badge-brand">
                <Save className="w-3 h-3" aria-hidden="true" />
                Enregistrer
              </span>. {AIDE_VERROU_BOUTIQUE.note}
            </p>

            <div
              ref={scrollerRef}
              className="table-wrap scroll-fade-x max-h-[calc(100vh-340px)] overflow-y-auto"
            >
              <table className="table table-dense min-w-[1280px]">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#E2E8F0]">
                  <tr>
                    <th className="table-header text-center w-12 !px-1">
                      <label className="inline-flex items-center justify-center w-11 h-11 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={toggleSelectAllVisible}
                          aria-label="Tout sélectionner (lignes affichées)"
                          className="checkbox"
                          title="Tout sélectionner (visible)"
                        />
                      </label>
                    </th>
                    <th className="table-header">Modèle</th>
                    <th className="table-header w-28">Prix du</th>
                    <th className="table-header w-52">Condition</th>
                    <th className="table-header w-24">Stockage 1</th>
                    <th className="table-header w-20">Prix 1 (€)</th>
                    <th className="table-header text-center w-20">Stock 1</th>
                    <th className="table-header w-24">Stockage 2</th>
                    <th className="table-header w-20">Prix 2 (€)</th>
                    <th className="table-header text-center w-20">Stock 2</th>
                    <th className="table-header w-20">DAS Tête</th>
                    <th className="table-header w-20">DAS Corps</th>
                    <th className="table-header w-20">DAS Membre</th>
                    <th className="table-header text-right w-48 lg:sticky lg:right-0 bg-slate-50 lg:shadow-[inset_1px_0_0_#E2E8F0]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={14}>
                        <div className="empty-state">
                          <div className="empty-state-icon"><Search aria-hidden="true" /></div>
                          <div className="t-body text-slate-500">Aucun résultat pour ces filtres</div>
                          {(query || conditionFilter !== 'all' || activeFilter !== 'all' || anciensSeuls) && (
                            <button
                              onClick={() => { setQuery(''); setConditionFilter('all'); setActiveFilter('all'); setAnciensSeuls(false); }}
                              className="btn-secondary"
                            >
                              Réinitialiser les filtres
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  {filteredRows.map((r) => {
                    const isDirty = !!dirty[r.id];
                    const isSaving = envois.enCours(r.id);
                    const isSelected = selected.has(r.slug);
                    const isInactive = r.actif === false;
                    const verrou = verrouilles.has(r.id);
                    const aideVerrou = verrou ? 'Prix protégés par le cadenas : ouvrez-le pour les modifier' : undefined;
                    return (
                      <tr
                        key={r.id}
                        onKeyDown={(e) => entreeLigne(e, isDirty, () => saveRow(r))}
                        aria-busy={isSaving || undefined}
                        className={`table-row group ${
                          isDirty
                            ? 'bg-amber-50/70 hover:bg-amber-50'
                            : isSelected
                            ? 'table-row-selected'
                            : ''
                        } ${isInactive ? 'opacity-60' : ''}`}
                      >
                        <td className={`!px-1 ${rowPadY} text-center relative`}>
                          {isDirty && (
                            <span
                              className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400"
                              aria-hidden
                            />
                          )}
                          <label className="inline-flex items-center justify-center w-11 h-11 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(r.slug)}
                              aria-label={`Sélectionner ${r.modele}`}
                              className="checkbox"
                            />
                          </label>
                        </td>
                        <td className={`px-3 ${rowPadY}`}>
                          <input
                            type="text"
                            value={r.modele || ''}
                            onChange={(e) => updateRow(r.id, 'modele', e.target.value)}
                            aria-label={`Modèle (ligne ${r.id})`}
                            className="input w-44 font-semibold"
                          />
                        </td>
                        <td className={`px-3 ${rowPadY} whitespace-nowrap`}>
                          <BadgeDatePrix row={r} court />
                        </td>
                        <td className={`px-3 ${rowPadY}`}>
                          <ConditionPill
                            value={r.condition}
                            onChange={(e) => updateRow(r.id, 'condition', e.target.value)}
                            label={`Condition de ${r.modele}`}
                          />
                        </td>
                        <td className={`px-3 ${rowPadY}`}>
                          <input
                            type="text"
                            value={r.stockage_1 || ''}
                            onChange={(e) => updateRow(r.id, 'stockage_1', e.target.value)}
                            aria-label={`Stockage 1 de ${r.modele}`}
                            className="input w-20 px-2"
                          />
                        </td>
                        <td className={`px-3 ${rowPadY}`}>
                          <input
                            type="number"
                            value={r.prix_1 || ''}
                            onChange={(e) => updateRow(r.id, 'prix_1', e.target.value)}
                            readOnly={verrou}
                            title={aideVerrou}
                            aria-label={`Prix 1 de ${r.modele}, en euros${verrou ? ' (verrouillé)' : ''}`}
                            className={`input w-20 px-2 font-semibold tabular-nums ${verrou ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`}
                          />
                        </td>
                        <td className={`px-3 ${rowPadY} text-center`}>
                          <StockBadge
                            value={r.stock_1}
                            onChange={(e) => updateRow(r.id, 'stock_1', e.target.value)}
                            label={`Stock 1 de ${r.modele}`}
                          />
                        </td>
                        <td className={`px-3 ${rowPadY}`}>
                          <input
                            type="text"
                            value={r.stockage_2 || ''}
                            onChange={(e) => updateRow(r.id, 'stockage_2', e.target.value)}
                            aria-label={`Stockage 2 de ${r.modele}`}
                            className="input w-20 px-2"
                          />
                        </td>
                        <td className={`px-3 ${rowPadY}`}>
                          <input
                            type="number"
                            value={r.prix_2 || ''}
                            onChange={(e) => updateRow(r.id, 'prix_2', e.target.value)}
                            readOnly={verrou}
                            title={aideVerrou}
                            aria-label={`Prix 2 de ${r.modele}, en euros${verrou ? ' (verrouillé)' : ''}`}
                            className={`input w-20 px-2 font-semibold tabular-nums ${verrou ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`}
                          />
                        </td>
                        <td className={`px-3 ${rowPadY} text-center`}>
                          <StockBadge
                            value={r.stock_2}
                            onChange={(e) => updateRow(r.id, 'stock_2', e.target.value)}
                            label={`Stock 2 de ${r.modele}`}
                          />
                        </td>
                        <td className={`px-3 ${rowPadY}`}>
                          <input
                            type="text"
                            value={r.das_tete || ''}
                            onChange={(e) => updateRow(r.id, 'das_tete', e.target.value)}
                            aria-label={`DAS tête de ${r.modele}`}
                            className="input w-16 px-2"
                          />
                        </td>
                        <td className={`px-3 ${rowPadY}`}>
                          <input
                            type="text"
                            value={r.das_corps || ''}
                            onChange={(e) => updateRow(r.id, 'das_corps', e.target.value)}
                            aria-label={`DAS corps de ${r.modele}`}
                            className="input w-16 px-2"
                          />
                        </td>
                        <td className={`px-3 ${rowPadY}`}>
                          <input
                            type="text"
                            value={r.das_membre || ''}
                            onChange={(e) => updateRow(r.id, 'das_membre', e.target.value)}
                            aria-label={`DAS membre de ${r.modele}`}
                            className="input w-16 px-2"
                          />
                        </td>
                        <td className={`px-3 ${rowPadY} lg:sticky lg:right-0 bg-white lg:shadow-[inset_1px_0_0_#E2E8F0] ${isDirty ? 'bg-amber-50' : isSelected ? 'bg-brand-50' : 'group-hover:bg-slate-50'}`}>
                          <div className="flex justify-end items-center gap-1.5">
                            <BoutonVerrou
                              verrouille={verrou}
                              onClick={() => basculerVerrou(r.id, r.modele)}
                              disabled={verrouEnCours === r.id}
                              nom={`les prix de ${r.modele}`}
                              aide={verrou ? AIDE_VERROU_BOUTIQUE.oui : AIDE_VERROU_BOUTIQUE.non}
                            />
                            {isDirty ? (
                              <button
                                onClick={() => saveRow(r)}
                                aria-label={`Enregistrer ${r.modele}`}
                                className="btn-primary btn-sm"
                              >
                                <Save />
                                Enregistrer
                              </button>
                            ) : isSaving ? (
                              <span role="status" className="inline-flex items-center gap-1 min-h-9 px-1 text-xs font-medium text-slate-600 whitespace-nowrap">
                                <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" /> Enregistrement…
                              </span>
                            ) : null}
                            <button
                              onClick={() => generateImage(r)}
                              disabled={generatingId === r.id}
                              title={r.image_url ? 'Remplacer la photo (rechercher DuckDuckGo)' : 'Rechercher une photo sur DuckDuckGo'}
                              aria-label={`${r.image_url ? 'Remplacer la photo' : 'Chercher une photo'} de ${r.modele}`}
                              className="btn-secondary btn-sm relative"
                            >
                              {generatingId === r.id ? (
                                <Loader2 className="motion-safe:animate-spin" />
                              ) : (
                                <ImageIcon />
                              )}
                              Photo
                              {r.image_url && (
                                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white" title="Photo personnalisée définie" />
                              )}
                            </button>
                            <button
                              onClick={() => handlePdfOne(r)}
                              disabled={isDirty || isSaving}
                              title={isDirty ? 'Enregistrez d\'abord' : 'Voir le PDF'}
                              aria-label={`PDF de ${r.modele}`}
                              className="btn-secondary btn-sm"
                            >
                              <FileDown />
                              PDF
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* PDFs par groupe (2 modèles/page comme les .docx originaux) */}
            <div className="mt-8">
              <h2 className="t-h2 mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-slate-400" aria-hidden="true" />
                PDFs groupés (2 modèles par page, format original boutique)
              </h2>
              <div className="flex flex-wrap gap-2">
                {Object.entries(groups)
                  .filter(([, items]) => items.length > 0)
                  .map(([key, items]) => (
                    <button
                      key={key}
                      onClick={() => openPdfInNewTab(`/api/iphone-tarifs/pdf?group=${encodeURIComponent(key)}`)
                        .catch((e) => showToast('error', `PDF : ${e.message}`))}
                      className="btn-secondary btn-sm"
                    >
                      <FileDown className="text-brand-600" />
                      {items.map(i => i.modele).join(' + ')}
                    </button>
                  ))}
              </div>
            </div>
          </>
        )}
      </main>

      {/* Modal choix image (meme pattern que AdminTarifsSmartphonesPage) */}
      {imagePicker && (
        <div
          className="modal-overlay"
          onClick={() => setImagePicker(null)}
        >
          <div
            className="modal sm:max-w-5xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                  <ImageIcon className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3 className="t-h2">Choisir la photo</h3>
                  <p className="text-sm text-slate-500 truncate">
                    Apple {imagePicker.row.modele}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setImagePicker(null)}
                aria-label="Fermer le choix de photo"
                className="btn-ghost btn-icon shrink-0"
              >
                <X />
              </button>
            </div>

            <div className="modal-body space-y-3">
              {/* Barre de recherche custom */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const q = e.target.query.value.trim();
                  if (q) researchWithQuery(q);
                }}
                className="flex flex-wrap items-center gap-2"
              >
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
                  <input
                    type="text"
                    name="query"
                    defaultValue={imagePicker.query}
                    placeholder="Ex: iPhone 15 Pro back view cutout, iPhone 16 Pro Max PNG mockup..."
                    aria-label="Recherche de photo"
                    className="input pl-10"
                  />
                </div>
                <button
                  type="submit"
                  disabled={imagePicker.searching}
                  className="btn-secondary"
                >
                  {imagePicker.searching ? <Loader2 className="motion-safe:animate-spin" /> : <RefreshCw />}
                  Rechercher
                </button>
                <button
                  type="button"
                  onClick={generateAiVariants}
                  disabled={imagePicker.searching}
                  className="btn-secondary"
                  title="Génère 4 photos IA fond blanc (Pollinations.ai)"
                >
                  <Sparkles className="text-brand-600" />
                  Générer IA
                </button>
              </form>

              <div className="flex items-center gap-2 t-caption">
                <Search className="w-4 h-4 text-slate-400" aria-hidden="true" />
                <span>
                  {imagePicker.candidates.length} photos — cliquez sur la meilleure. Besoin d'autre chose ?
                  Modifie la recherche ci-dessus ou <strong className="text-brand-700">génère IA</strong> (fond blanc garanti).
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {imagePicker.candidates.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => chooseImage(imagePicker.row, url)}
                    aria-label={`Choisir la photo ${i + 1}`}
                    className="group relative card overflow-hidden aspect-square flex items-center justify-center transition-colors duration-150 hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                  >
                    <img
                      src={url}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="max-w-full max-h-full object-contain p-4"
                      onError={(e) => { e.target.style.opacity = '0.25'; }}
                    />
                    {i === 0 && (
                      <div className="absolute top-2 left-2 badge badge-brand">
                        <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                        RECOMMANDÉ
                      </div>
                    )}
                    <div className="absolute bottom-2 right-2 badge-count">
                      {i + 1}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 bg-brand-600 text-white text-xs font-semibold py-2 px-3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-1.5">
                      <Check className="w-4 h-4" aria-hidden="true" /> Choisir cette photo
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <AjustementColonne
        open={fenetre === 'ajuster'}
        onClose={() => setFenetre(null)}
        sensible={sensible}
        cible={TABLE}
        titre="Ajuster les prix des iPhones"
        colonnes={COLONNES_PRIX}
        lignes={filteredRows.map((r) => ({ id: r.id, label: r.modele, valeurs: r }))}
        verrouilles={verrouilles}
        aEnregistrer={{ nombre: dirtyCount, enregistrer: saveAllDirty }}
        onApplique={() => load()}
      />
      <FenetreQuitter garde={garde} nombre={dirtyCount} envois={envois.nombre} enregistrer={saveAllDirty} />
      <HistoriquePrix
        open={fenetre === 'historique'}
        onClose={() => setFenetre(null)}
        sensible={sensible}
        filtre={{ table: TABLE }}
        titre="Historique des prix des iPhones"
        nommer={(l) => rows.find((r) => r.id === l.ligne_id)?.modele}
        onAnnule={() => load()}
      />
      {adminPrompt}
    </div>
  );
}

// ------- UI subcomponents -------

// Tuile KPI : une seule couleur de valeur ; l'icône ne se colore que pour une alerte (stock faible)
function StatCard({ icon: Icon, label, value, tone = 'brand' }) {
  const icone = tone === 'red' ? 'bg-red-50 text-red-700' : '';
  return (
    <div className="kpi-card-sm">
      <div className={`kpi-icon ${icone}`}>
        <Icon aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="kpi-value">{value}</div>
        <div className="kpi-label truncate">{label}</div>
      </div>
    </div>
  );
}

// Segment de filtre : neutre, la couleur « tone » n'est plus portée (le libellé suffit)
function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!active}
      className={`segmented-item ${active ? 'segmented-item-active' : ''}`}
    >
      {children}
    </button>
  );
}
