import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Smartphone, Save, FileDown, Archive, ArrowLeft, Loader2, Check, X,
  Search, Filter, Rows, AlignJustify, Package, CheckCircle2, CircleOff,
  ChevronRight, AlertTriangle, Sparkles, Power, PowerOff,
  Image as ImageIcon, Star, RefreshCw, SlidersHorizontal, History,
} from 'lucide-react';
import api from '../lib/api';
import { useAdminElevation } from '../hooks/useAdminElevation';
import HistoriquePrix, { BadgeDatePrix, BoutonVerrou, FiltreAnciens, messageErreurPrix, plusDeTroisMois } from '../components/HistoriquePrix';
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
      ? 'border-red-500/40 bg-red-500/10 text-red-300 focus-within:border-red-400'
      : lvl === 'mid'
      ? 'border-orange-500/40 bg-orange-500/10 text-orange-300 focus-within:border-orange-400'
      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 focus-within:border-emerald-400';
  return (
    <div
      className={`inline-flex items-center justify-center rounded-full border px-2 py-0.5 transition ${tone}`}
      title={lvl === 'low' ? 'Stock faible' : lvl === 'mid' ? 'Stock moyen' : 'Stock OK'}
    >
      <input
        type="number"
        min="0"
        value={value ?? 0}
        onChange={onChange}
        aria-label={label}
        className="w-11 min-h-[44px] bg-transparent text-center font-bold text-[13px] outline-none"
      />
    </div>
  );
}

function ConditionPill({ value, onChange, label = 'Condition' }) {
  const isNeuf = value === 'Neuf';
  const tone = isNeuf
    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 focus-within:border-emerald-400'
    : 'bg-blue-500/15 border-blue-500/40 text-blue-300 focus-within:border-blue-400';
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border pl-2.5 pr-1 py-0.5 transition ${tone}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${isNeuf ? 'bg-emerald-400' : 'bg-blue-400'}`} />
      <select
        value={value || 'Reconditionné Premium'}
        onChange={onChange}
        aria-label={label}
        className="bg-transparent min-h-[44px] text-[12px] font-semibold outline-none cursor-pointer pr-1 appearance-none"
      >
        <option value="Neuf" className="bg-slate-900 text-emerald-300">Neuf</option>
        <option value="Reconditionné Premium" className="bg-slate-900 text-blue-300">Recond. Premium</option>
      </select>
    </div>
  );
}

export default function AdminTarifsIphonePage() {
  const basePath = useBasePath();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
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

  async function saveRow(row) {
    setSavingId(row.id);
    try {
      await sensible(() => api.patch(`/api/iphone-tarifs/${row.id}`, buildPayload(row)));
      setDirty(d => { const n = { ...d }; delete n[row.id]; return n; });
      showToast('success', `${row.modele} sauvegardé`);
      return true;
    } catch (e) {
      toastErreur(e, `${row.modele} non enregistré`);
      return false;
    } finally {
      setSavingId(null);
    }
  }

  // Toutes les lignes modifiées (avant un ajustement en %) ; un échec arrête la série
  async function saveAllDirty() {
    for (const r of rows.filter((x) => dirty[x.id])) {
      if (!(await saveRow(r))) return false;
    }
    return true;
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
  const rowPadY = compact ? 'py-1' : 'py-2.5';

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-slate-900/90 backdrop-blur border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <Link to={basePath} aria-label="Retour" className="w-11 h-11 inline-flex items-center justify-center rounded-lg hover:bg-slate-800 transition shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
              </Link>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5 text-brand-400" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-xl font-bold truncate">Tarifs iPhones reconditionnés</h1>
                  <p className="text-xs text-slate-400 truncate">Gestion catalogue & affiches boutique</p>
                </div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handlePdfFull}
                aria-label="PDF complet"
                className="min-h-[44px] px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center gap-2 text-sm transition"
              >
                <FileDown className="w-4 h-4" />
                <span className="hidden sm:inline">PDF complet</span>
              </button>
              <button
                onClick={handlePdfAll}
                className="min-h-[44px] px-3 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white flex items-center gap-2 text-sm font-semibold transition shadow-lg shadow-brand-500/20"
              >
                <Archive className="w-4 h-4" />
                <span className="hidden sm:inline">Tout télécharger (ZIP)</span>
                <span className="sm:hidden">ZIP</span>
              </button>
            </div>
          </div>

          {/* Stats rapides */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
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
        </div>
      </header>

      {/* Toast animé top-right */}
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl border backdrop-blur flex items-center gap-2.5 kp-toast-in ${
            toast.type === 'success'
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
              : 'bg-red-500/15 border-red-500/40 text-red-200'
          }`}
          style={{ minWidth: 240 }}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 shrink-0 text-red-400" />
          )}
          <span className="text-sm font-medium">{toast.msg}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-1 w-11 h-11 -my-2 -mr-2 inline-flex items-center justify-center rounded hover:bg-white/10 transition"
            aria-label="Fermer le message"
          >
            <X className="w-3.5 h-3.5 opacity-70" />
          </button>
        </div>
      )}

      {/* Barre flottante de sélection */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white rounded-xl shadow-2xl px-3 py-2.5 flex items-center gap-2 border border-brand-500/50 kp-slide-up">
          <span className="text-sm font-semibold px-2">
            {selected.size} sélection{selected.size > 1 ? 's' : ''}
          </span>
          <div className="w-px h-6 bg-slate-700" />
          <button
            onClick={handlePdfSelection}
            disabled={selected.size > 2}
            title={selected.size > 2 ? 'Maximum 2 modèles pour le PDF' : 'Générer le PDF'}
            className="min-h-[44px] px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <FileDown className="w-4 h-4" />
            PDF
          </button>
          <button
            onClick={() => bulkToggleActive(true)}
            disabled={savingId === 'bulk'}
            className="min-h-[44px] px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 font-semibold text-sm flex items-center gap-2 disabled:opacity-50 transition"
          >
            <Power className="w-4 h-4" />
            Activer
          </button>
          <button
            onClick={() => bulkToggleActive(false)}
            disabled={savingId === 'bulk'}
            className="min-h-[44px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-semibold text-sm flex items-center gap-2 disabled:opacity-50 transition"
          >
            <PowerOff className="w-4 h-4" />
            Désactiver
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="w-11 h-11 inline-flex items-center justify-center rounded-lg hover:bg-slate-800 transition"
            title="Annuler la sélection"
            aria-label="Annuler la sélection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Contenu */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 className="w-6 h-6 motion-safe:animate-spin mr-3" />
            Chargement des tarifs…
          </div>
        ) : (
          <>
            {/* Barre d'outils : recherche, filtres, mode compact */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher un modèle, stockage…"
                  aria-label="Rechercher un modèle"
                  className="w-full min-h-[44px] bg-slate-900 border border-slate-800 focus:border-brand-500 rounded-lg pl-9 pr-12 py-2 text-sm text-white placeholder-slate-400 outline-none transition"
                />
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 inline-flex items-center justify-center rounded-lg hover:bg-slate-800 text-slate-400"
                    aria-label="Effacer la recherche"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
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

              <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
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

              <FiltreAnciens actif={anciensSeuls} onChange={setAnciensSeuls} nombre={nombreAnciens} theme="sombre" />

              <button
                type="button"
                onClick={() => setFenetre('ajuster')}
                className="min-h-[44px] px-3 rounded-lg border border-brand-500/50 bg-brand-500/15 text-brand-200 hover:bg-brand-500/25 text-sm font-semibold flex items-center gap-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
                Ajuster en %
              </button>
              <button
                type="button"
                onClick={() => setFenetre('historique')}
                className="min-h-[44px] px-3 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:text-white text-sm font-semibold flex items-center gap-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <History className="w-4 h-4" aria-hidden="true" />
                Historique
              </button>

              <button
                onClick={() => setCompact(c => !c)}
                aria-pressed={compact}
                className={`min-h-[44px] px-3 rounded-lg border text-sm flex items-center gap-2 transition ${
                  compact
                    ? 'bg-brand-500/15 border-brand-500/40 text-brand-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
                title="Mode compact"
              >
                {compact ? <AlignJustify className="w-4 h-4" /> : <Rows className="w-4 h-4" />}
                <span className="hidden sm:inline">{compact ? 'Compact' : 'Confort'}</span>
              </button>

              {dirtyCount > 0 && (
                <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-500/15 border border-orange-500/30 text-orange-300 text-xs font-semibold kp-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                  {dirtyCount} modification{dirtyCount > 1 ? 's' : ''} non sauvegardée{dirtyCount > 1 ? 's' : ''}
                </div>
              )}
            </div>

            {/* Hint scroll mobile */}
            {scrollHint && (
              <div className="md:hidden mb-2 flex items-center justify-end gap-1 text-xs text-slate-500 pr-1">
                <span>Glisser pour voir plus</span>
                <ChevronRight className="w-3.5 h-3.5 motion-safe:animate-pulse" />
              </div>
            )}

            <p className="text-xs text-slate-500 mb-3">
              {filteredRows.length} résultat{filteredRows.length > 1 ? 's' : ''}
              {filteredRows.length !== rows.length && ` sur ${rows.length}`}
              {' · '}
              Modifiez les valeurs puis cliquez sur{' '}
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300">
                <Save className="w-3 h-3" aria-hidden="true" />
                Enregistrer
              </span>. {AIDE_VERROU_BOUTIQUE.note}
            </p>

            <div
              ref={scrollerRef}
              className="relative overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 max-h-[calc(100vh-340px)] overflow-y-auto"
            >
              {/* Fade gauche/droite sur mobile pour indiquer le scroll */}
              {scrollHint && (
                <div className="md:hidden pointer-events-none absolute top-0 right-0 bottom-0 w-10 bg-gradient-to-l from-slate-900 to-transparent z-10" />
              )}

              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur text-slate-300 text-xs uppercase shadow-[0_1px_0_0_rgba(51,65,85,1)]">
                  <tr>
                    <th className="px-3 py-3 text-center w-12">
                      <label className="inline-flex items-center justify-center w-11 h-11 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={toggleSelectAllVisible}
                          aria-label="Tout sélectionner (lignes affichées)"
                          className="w-5 h-5 rounded border-slate-600 bg-slate-800 accent-brand-500 cursor-pointer"
                          title="Tout sélectionner (visible)"
                        />
                      </label>
                    </th>
                    <th className="px-3 py-3 text-left">Modèle</th>
                    <th className="px-3 py-3 text-left w-28">Prix du</th>
                    <th className="px-3 py-3 text-left w-40">Condition</th>
                    <th className="px-3 py-3 text-left w-24">Stockage 1</th>
                    <th className="px-3 py-3 text-left w-20">Prix 1 (€)</th>
                    <th className="px-3 py-3 text-center w-20">Stock 1</th>
                    <th className="px-3 py-3 text-left w-24">Stockage 2</th>
                    <th className="px-3 py-3 text-left w-20">Prix 2 (€)</th>
                    <th className="px-3 py-3 text-center w-20">Stock 2</th>
                    <th className="px-3 py-3 text-left w-20">DAS Tête</th>
                    <th className="px-3 py-3 text-left w-20">DAS Corps</th>
                    <th className="px-3 py-3 text-left w-20">DAS Membre</th>
                    <th className="px-3 py-3 text-right w-48 sticky right-0 bg-slate-900/95 backdrop-blur">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={14} className="px-6 py-16 text-center text-slate-400">
                        <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
                        <div className="text-sm">Aucun résultat pour ces filtres</div>
                        {(query || conditionFilter !== 'all' || activeFilter !== 'all' || anciensSeuls) && (
                          <button
                            onClick={() => { setQuery(''); setConditionFilter('all'); setActiveFilter('all'); setAnciensSeuls(false); }}
                            className="mt-3 text-xs text-brand-400 hover:text-brand-300 underline"
                          >
                            Réinitialiser les filtres
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                  {filteredRows.map((r) => {
                    const isDirty = !!dirty[r.id];
                    const isSaving = savingId === r.id;
                    const isSelected = selected.has(r.slug);
                    const isInactive = r.actif === false;
                    const verrou = verrouilles.has(r.id);
                    const aideVerrou = verrou ? 'Prix protégés par le cadenas : ouvrez-le pour les modifier' : undefined;
                    return (
                      <tr
                        key={r.id}
                        className={`border-t border-slate-800 transition group ${
                          isDirty
                            ? 'bg-orange-500/5 kp-dirty'
                            : isSelected
                            ? 'bg-brand-500/10'
                            : 'hover:bg-slate-800/30'
                        } ${isInactive ? 'opacity-50' : ''}`}
                      >
                        <td className={`px-3 ${rowPadY} text-center relative`}>
                          {isDirty && (
                            <span
                              className="absolute left-0 top-0 bottom-0 w-1 bg-orange-400 kp-pulse-bar"
                              aria-hidden
                            />
                          )}
                          <label className="inline-flex items-center justify-center w-11 h-11 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(r.slug)}
                              aria-label={`Sélectionner ${r.modele}`}
                              className="w-5 h-5 rounded border-slate-600 bg-slate-800 accent-brand-500 cursor-pointer"
                            />
                          </label>
                        </td>
                        <td className={`px-3 ${rowPadY}`}>
                          <input
                            type="text"
                            value={r.modele || ''}
                            onChange={(e) => updateRow(r.id, 'modele', e.target.value)}
                            aria-label={`Modèle (ligne ${r.id})`}
                            className="bg-slate-800 border border-slate-700 hover:border-slate-600 focus:border-brand-500 rounded px-2 py-1 min-h-[44px] w-44 text-white font-semibold outline-none transition"
                          />
                        </td>
                        <td className={`px-3 ${rowPadY} whitespace-nowrap`}>
                          <BadgeDatePrix row={r} theme="sombre" court />
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
                            className="input-cell w-20"
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
                            className={`input-cell w-16 font-semibold text-brand-300 ${verrou ? 'opacity-70 cursor-not-allowed' : ''}`}
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
                            className="input-cell w-20"
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
                            className={`input-cell w-16 font-semibold text-brand-300 ${verrou ? 'opacity-70 cursor-not-allowed' : ''}`}
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
                            className="input-cell w-14"
                          />
                        </td>
                        <td className={`px-3 ${rowPadY}`}>
                          <input
                            type="text"
                            value={r.das_corps || ''}
                            onChange={(e) => updateRow(r.id, 'das_corps', e.target.value)}
                            aria-label={`DAS corps de ${r.modele}`}
                            className="input-cell w-14"
                          />
                        </td>
                        <td className={`px-3 ${rowPadY}`}>
                          <input
                            type="text"
                            value={r.das_membre || ''}
                            onChange={(e) => updateRow(r.id, 'das_membre', e.target.value)}
                            aria-label={`DAS membre de ${r.modele}`}
                            className="input-cell w-14"
                          />
                        </td>
                        <td className={`px-3 ${rowPadY} sticky right-0 bg-slate-900/95 backdrop-blur group-hover:bg-slate-800/60 transition`}>
                          <div className="flex justify-end items-center gap-2">
                            <BoutonVerrou
                              verrouille={verrou}
                              onClick={() => basculerVerrou(r.id, r.modele)}
                              disabled={verrouEnCours === r.id}
                              theme="sombre"
                              nom={`les prix de ${r.modele}`}
                              aide={verrou ? AIDE_VERROU_BOUTIQUE.oui : AIDE_VERROU_BOUTIQUE.non}
                            />
                            {isDirty && (
                              <button
                                onClick={() => saveRow(r)}
                                disabled={isSaving}
                                aria-label={`Enregistrer ${r.modele}`}
                                className="min-h-[44px] px-3 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-semibold flex items-center gap-1 disabled:opacity-50 shadow-lg shadow-orange-500/20 transition"
                              >
                                {isSaving ? <Loader2 className="w-3 h-3 motion-safe:animate-spin" /> : <Save className="w-3 h-3" />}
                                Enregistrer
                              </button>
                            )}
                            <button
                              onClick={() => generateImage(r)}
                              disabled={generatingId === r.id}
                              title={r.image_url ? 'Remplacer la photo (rechercher DuckDuckGo)' : 'Rechercher une photo sur DuckDuckGo'}
                              aria-label={`${r.image_url ? 'Remplacer la photo' : 'Chercher une photo'} de ${r.modele}`}
                              className="min-h-[44px] px-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs flex items-center gap-1 disabled:opacity-50 transition relative"
                            >
                              {generatingId === r.id ? (
                                <Loader2 className="w-3 h-3 motion-safe:animate-spin" />
                              ) : (
                                <ImageIcon className="w-3 h-3" />
                              )}
                              Photo
                              {r.image_url && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-900" title="Photo personnalisée définie" />
                              )}
                            </button>
                            <button
                              onClick={() => handlePdfOne(r)}
                              disabled={isDirty}
                              title={isDirty ? 'Enregistrez d\'abord' : 'Voir le PDF'}
                              aria-label={`PDF de ${r.modele}`}
                              className="min-h-[44px] px-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed transition"
                            >
                              <FileDown className="w-3 h-3" />
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
              <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-brand-400" />
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
                      className="min-h-[44px] px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-brand-500/40 text-xs flex items-center gap-2 transition"
                    >
                      <FileDown className="w-3 h-3 text-brand-400" />
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
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setImagePicker(null)}
        >
          <div
            className="bg-gradient-to-br from-slate-900 to-slate-950 rounded-3xl border border-white/10 max-w-5xl w-full max-h-[92vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between p-5 border-b border-white/10 bg-slate-900/95 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-violet-500/20">
                  <ImageIcon className="w-5 h-5 text-violet-400" />
                </div>
                <div>
                  <h3 className="font-black text-lg leading-tight">Choisir la photo</h3>
                  <p className="text-sm text-slate-400">
                    Apple {imagePicker.row.modele}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setImagePicker(null)}
                aria-label="Fermer le choix de photo"
                className="w-11 h-11 inline-flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/15 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 pt-4 pb-2 space-y-3">
              {/* Barre de recherche custom */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const q = e.target.query.value.trim();
                  if (q) researchWithQuery(q);
                }}
                className="flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    name="query"
                    defaultValue={imagePicker.query}
                    placeholder="Ex: iPhone 15 Pro back view cutout, iPhone 16 Pro Max PNG mockup..."
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-violet-500 text-white text-sm outline-none transition"
                  />
                </div>
                <button
                  type="submit"
                  disabled={imagePicker.searching}
                  className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-50 transition"
                >
                  {imagePicker.searching ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Rechercher
                </button>
                <button
                  type="button"
                  onClick={generateAiVariants}
                  disabled={imagePicker.searching}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 text-sm font-bold flex items-center gap-2 disabled:opacity-50 transition shadow-lg shadow-amber-500/30"
                  title="Génère 4 photos IA fond blanc (Pollinations.ai)"
                >
                  <Sparkles className="w-4 h-4" />
                  Générer IA
                </button>
              </form>

              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Search className="w-3 h-3" />
                <span>
                  {imagePicker.candidates.length} photos — cliquez sur la meilleure. Besoin d'autre chose ?
                  Modifie la recherche ci-dessus ou <strong className="text-amber-400">génère IA</strong> (fond blanc garanti).
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-5">
              {imagePicker.candidates.map((url, i) => (
                <button
                  key={i}
                  onClick={() => chooseImage(imagePicker.row, url)}
                  className="group relative bg-white rounded-2xl overflow-hidden aspect-square flex items-center justify-center hover:ring-4 hover:ring-violet-500 transition-all shadow-lg hover:shadow-2xl motion-safe:hover:scale-[1.03]"
                >
                  <img
                    src={url}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="max-w-full max-h-full object-contain p-4 motion-safe:group-hover:scale-110 transition-transform duration-300"
                    onError={(e) => { e.target.style.opacity = '0.25'; }}
                  />
                  {i === 0 && (
                    <div className="absolute top-2 left-2 flex items-center gap-1 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-[10px] font-black px-2 py-1 rounded-full shadow-lg">
                      <Star className="w-3 h-3 fill-current" />
                      RECOMMANDÉ
                    </div>
                  )}
                  <div className="absolute bottom-2 right-2 w-6 h-6 flex items-center justify-center bg-slate-900 text-white text-[11px] font-bold rounded-full shadow-lg">
                    {i + 1}
                  </div>
                  <div className="absolute inset-0 bg-violet-500/0 group-hover:bg-violet-500/10 transition-colors" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-violet-600 to-transparent text-white text-xs font-bold py-2 px-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                    <Check className="w-3.5 h-3.5" /> Choisir cette photo
                  </div>
                </button>
              ))}
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

      <style>{`
        .input-cell {
          background: rgb(30 41 59);
          border: 1px solid rgb(51 65 85);
          border-radius: 4px;
          padding: 4px 8px;
          min-height: 44px;
          color: white;
          font-size: 13px;
          transition: border-color 0.15s, background-color 0.15s;
        }
        .input-cell:hover {
          border-color: rgb(71 85 105);
        }
        .input-cell:focus {
          outline: none;
          border-color: rgb(139 92 246);
          background: rgb(15 23 42);
        }

        @keyframes kpToastIn {
          0%   { opacity: 0; transform: translateX(24px) scale(0.96); }
          60%  { opacity: 1; transform: translateX(-4px) scale(1.01); }
          100% { opacity: 1; transform: translateX(0) scale(1); }
        }
        .kp-toast-in { animation: kpToastIn 360ms cubic-bezier(.2,.9,.3,1.2) both; }

        @keyframes kpSlideUp {
          from { opacity: 0; transform: translate(-50%, 20px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
        .kp-slide-up { animation: kpSlideUp 260ms ease-out both; }

        @keyframes kpPulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.55; }
        }
        .kp-pulse { animation: kpPulse 1.8s ease-in-out infinite; }

        @keyframes kpPulseBar {
          0%, 100% { box-shadow: 0 0 0 0 rgba(251, 146, 60, 0); }
          50%      { box-shadow: 0 0 10px 2px rgba(251, 146, 60, 0.55); }
        }
        .kp-pulse-bar { animation: kpPulseBar 1.6s ease-in-out infinite; }

        @keyframes kpDirtyIn {
          from { box-shadow: inset 3px 0 0 0 rgba(251, 146, 60, 0); }
          to   { box-shadow: inset 3px 0 0 0 rgba(251, 146, 60, 0.9); }
        }
        .kp-dirty { animation: kpDirtyIn 220ms ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .kp-toast-in, .kp-slide-up, .kp-pulse, .kp-pulse-bar, .kp-dirty { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

// ------- UI subcomponents -------

function StatCard({ icon: Icon, label, value, tone = 'brand' }) {
  const tones = {
    brand: 'bg-brand-500/10 border-brand-500/20 text-brand-300',
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-300',
    red: 'bg-red-500/10 border-red-500/25 text-red-300',
    slate: 'bg-slate-800/60 border-slate-700 text-slate-300',
  };
  return (
    <div className={`rounded-xl border px-3 py-2.5 flex items-center gap-3 ${tones[tone]}`}>
      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide opacity-70 truncate">{label}</div>
        <div className="text-lg font-bold leading-tight">{value}</div>
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children, tone = 'brand' }) {
  const activeTones = {
    brand: 'bg-brand-500 text-white',
    emerald: 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40',
    blue: 'bg-blue-500/20 text-blue-200 border border-blue-500/40',
    slate: 'bg-slate-700 text-slate-100',
  };
  return (
    <button
      onClick={onClick}
      aria-pressed={!!active}
      className={`min-h-[44px] px-3 rounded-md text-xs font-semibold transition ${
        active ? activeTones[tone] : 'text-slate-400 hover:text-white hover:bg-slate-800'
      }`}
    >
      {children}
    </button>
  );
}
