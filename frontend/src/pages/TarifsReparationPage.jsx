import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, Printer, FileJson, FileSpreadsheet, X, Plus, Trash2, ChevronUp, ChevronDown, Lock, Pencil, SlidersHorizontal, History, Loader2, Info, Smartphone } from 'lucide-react';
import { Link, useInRouterContext } from 'react-router-dom';
import api from '../lib/api';
import AdminLoginModal from '../components/AdminLoginModal';
import { PaperFrame, PAPERS, computeFitZoom, mmToPx } from '../components/PrintPreview';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useAvertirAvantDepart, useEnvoisOptimistes } from '../hooks/useEnvoisOptimistes';
import { useToast } from '../components/Toast';
import HistoriquePrix, { BadgeDatePrix, BoutonVerrou, FiltreAnciens, alertesPrix, messageErreurPrix, plusDeTroisMois } from '../components/HistoriquePrix';
import { AIDE_VERROU_BOUTIQUE, AjustementColonne, useVerrousBoutique } from '../components/ReglesPrixPanel';

const PRINT_MARGIN_MM = 1;
const TABLE = 'tarifs_reparation';

// Lien vers « Réparation smartphones » (même espace : /accueil ou /tech) ; simple <a> hors routeur (tests)
function LienReparationSmartphones() {
  const dansRouteur = useInRouterContext();
  const chemin = typeof window !== 'undefined' && String(window.location?.pathname || '').startsWith('/tech') ? '/tech/tarifs' : '/accueil/tarifs';
  // Cible tactile de 44 px dans la phrase : marges négatives pour ne pas écarter la ligne
  const classes = 'font-semibold underline underline-offset-2 inline-flex items-center gap-1 min-h-[44px] -my-[10px] rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';
  const contenu = <><Smartphone className="w-3.5 h-3.5" aria-hidden="true" /> Réparation smartphones</>;
  return dansRouteur ? <Link to={chemin} className={classes}>{contenu}</Link> : <a href={chemin} className={classes}>{contenu}</a>;
}

// Écran : en-têtes neutres, un simple filet coloré par famille de pièce (les couleurs pleines restent à l'impression)
const COLUMNS = [
  { key: 'ecran_generique', label: 'Écran Générique', shortLabel: 'Générique', accent: 'border-t-blue-400' },
  { key: 'ecran_confort', label: 'Écran Confort', shortLabel: 'Confort', accent: 'border-t-blue-500' },
  { key: 'ecran_apple', label: 'Écran Apple', shortLabel: 'Apple', accent: 'border-t-blue-700' },
  { key: 'batterie', label: 'Batterie', shortLabel: 'Batterie', accent: 'border-t-amber-400' },
  { key: 'desoxydation', label: 'Désoxydation', shortLabel: 'Désoxy.', accent: 'border-t-emerald-400' },
  { key: 'connecteur_charge', label: 'Connecteur', shortLabel: 'Connect.', accent: 'border-t-rose-400' },
  { key: 'reparation_divers', label: 'Réparation', shortLabel: 'Répar.', accent: 'border-t-indigo-400' },
  { key: 'ecouteur_apn', label: 'Écouteur/APN', shortLabel: 'Écout.', accent: 'border-t-violet-400' },
  { key: 'vitre_arriere', label: 'Vitre Arrière', shortLabel: 'Vitre Arr.', accent: 'border-t-orange-400' },
  { key: 'chassis', label: 'Châssis', shortLabel: 'Châssis', accent: 'border-t-slate-400' },
];

const ROW_PRINT_COLORS = [
  '#EFF6FF', '#fff', '#FEFCE8', '#fff', '#F0FDF4', '#fff',
  '#FFF1F2', '#fff', '#EEF2FF', '#fff', '#FAF5FF', '#fff',
  '#FFF7ED', '#fff', '#F8FAFC', '#fff',
];

const HEADER_COLORS = ['#2563eb','#1d4ed8','#1e40af','#ca8a04','#16a34a','#e11d48','#4f46e5','#9333ea','#ea580c','#475569'];

function getBarrePrice(val, barreDb) {
  if (barreDb != null) return barreDb;
  if (val != null) return val + 20;
  return null;
}

export default function TarifsReparationPage() {
  const toast = useToast();
  const { sensible, adminPrompt } = useAdminElevation();
  const [tarifs, setTarifs] = useState([]);
  const [search, setSearch] = useState('');
  const [anciensSeuls, setAnciensSeuls] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erreurChargement, setErreurChargement] = useState('');
  const [editCell, setEditCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [printMode, setPrintMode] = useState(false);
  const [printPages, setPrintPages] = useState(2);
  const [printZoom, setPrintZoom] = useState('fit');
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [overflowPages, setOverflowPages] = useState({});
  const printCanvasRef = useRef(null);
  const [newModele, setNewModele] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem('klikphone_admin') === 'true');
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [fenetre, setFenetre] = useState(null); // 'ajuster' | 'historique'
  const inputRef = useRef(null);
  // Vrai dès que la cellule ouverte est validée ou abandonnée : Entrée puis blur n'enregistrent qu'une fois
  const enregistrementRef = useRef(false);
  const envois = useEnvoisOptimistes();
  // Prix encore en route vers le serveur : fermer ou recharger l'onglet demande confirmation
  useAvertirAvantDepart(envois.nombre > 0);
  const addRef = useRef(null);
  const { verrouilles, basculer: basculerVerrou, enCours: verrouEnCours } = useVerrousBoutique(TABLE, sensible);

  const load = useCallback(async () => {
    try {
      const data = await api.getTarifsReparation();
      setTarifs(data);
      setErreurChargement('');
    } catch (e) {
      setErreurChargement(messageErreurPrix(e, 'Chargement des tarifs impossible') || '');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const el = printCanvasRef.current;
    if (!printMode || !el) return undefined;
    setCanvasWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setCanvasWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [printMode, loading]);
  // Cellule ouverte : prix sélectionné, la frappe le remplace (« 74 » et non « 6974 »)
  useEffect(() => {
    if (editCell && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [editCell]);
  useEffect(() => { if (showAdd && addRef.current) addRef.current.focus(); }, [showAdd]);

  const nombreAnciens = useMemo(() => tarifs.filter((t) => plusDeTroisMois(t)).length, [tarifs]);
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tarifs.filter((t) => (!q || t.modele.toLowerCase().includes(q)) && (!anciensSeuls || plusDeTroisMois(t)));
  }, [tarifs, search, anciensSeuls]);

  const startEdit = (t, key, val) => {
    if (!isAdmin) return;
    if (verrouilles.has(t.id)) {
      toast.info(`${t.modele} est verrouillé : ouvrez le cadenas de la ligne pour modifier ses prix.`);
      return;
    }
    enregistrementRef.current = false;
    setEditCell({ id: t.id, key });
    setEditValue(val !== null && val !== undefined ? String(val) : '');
  };

  const cancelEdit = () => { setEditCell(null); setEditValue(''); };

  // Optimiste : le nouveau prix s'affiche et la cellule se ferme tout de suite ; l'envoi part derrière
  // (un à la fois par ligne). Échec : toast et retour à la dernière valeur enregistrée.
  const saveEdit = async () => {
    // Garde synchrone : Entrée puis blur (ou le blur de la boîte de confirmation) n'enregistrent qu'une fois
    if (!editCell || enregistrementRef.current) return;
    enregistrementRef.current = true;
    const cell = editCell;
    // Entier en euros uniquement : « 79,90 » est refusé au lieu d'être tronqué en 79
    const saisie = editValue.replace(/\s|€/g, '');
    if (saisie !== '' && !/^\d+$/.test(saisie)) {
      toast.error('Prix invalide : saisissez un nombre entier en euros (ou laissez vide).');
      cancelEdit();
      return;
    }
    const val = saisie === '' ? null : Number(saisie);
    const courant = tarifs.find((t) => t.id === cell.id);
    const ancien = courant ? (courant[cell.key] ?? null) : null;
    if (courant && ancien === val) { cancelEdit(); return; }
    // Grosse variation (règles de prix : plus de 25 % ou de 30 €) : le prix part aussitôt sur la vitrine
    const variation = ancien != null && val != null && alertesPrix({ ancienHt: ancien, nouveauHt: val }).includes('variation');
    if (variation && !window.confirm(`${courant.modele} : passer de ${ancien} € à ${val} € ? Le prix est publié aussitôt.`)) {
      cancelEdit();
      return;
    }
    setTarifs(prev => prev.map((t) => (t.id === cell.id ? { ...t, [cell.key]: val } : t)));
    cancelEdit();
    const res = await envois.envoyer(cell.id, () => sensible(() => api.updateTarifReparation(cell.id, { [cell.key]: val })),
      { avant: { [cell.key]: ancien }, apres: { [cell.key]: val } });
    if (res.ok) {
      // La réponse (SELECT *) n'a pas d'âge calculé : l'ancien age_jours ferait passer un prix du jour
      // pour « périmé ». Sans lui, la fraîcheur se recalcule depuis prix_maj_le. Les prix encore en
      // file pour cette ligne gardent leur valeur affichée.
      const updated = res.reponse && typeof res.reponse === 'object' ? res.reponse : {};
      setTarifs(prev => prev.map((t) => {
        if (t.id !== cell.id) return t;
        const { age_jours: _age, fraicheur: _fraicheur, ...reste } = t;
        const next = { ...reste };
        for (const [k, v] of Object.entries(updated)) if (!res.proteges.has(k)) next[k] = v;
        return next;
      }));
    } else {
      setTarifs(prev => prev.map((t) => (t.id === cell.id ? { ...t, ...res.retablir } : t)));
      const msg = messageErreurPrix(res.erreur, 'Prix non enregistré');
      if (msg) toast.error(msg);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') cancelEdit();
  };

  // ─── Add model ───
  const handleAdd = async () => {
    if (!isAdmin) return;
    const name = newModele.trim();
    if (!name) return;
    try {
      const created = await sensible(() => api.addTarifReparation(name));
      setTarifs(prev => [...prev, created]);
      setNewModele('');
      setShowAdd(false);
      toast.success(`${name} ajouté à la grille.`);
    } catch (e) {
      const msg = messageErreurPrix(e, 'Modèle non ajouté');
      if (msg) toast.error(msg);
    }
  };

  // ─── Delete model ───
  const handleDelete = async (id, modele) => {
    if (!isAdmin) return;
    if (verrouilles.has(id)) {
      toast.info(`${modele} est verrouillé : ouvrez le cadenas avant de le supprimer.`);
      return;
    }
    if (!confirm(`Supprimer "${modele}" ?`)) return;
    try {
      await sensible(() => api.deleteTarifReparation(id));
      setTarifs(prev => prev.filter(t => t.id !== id));
      toast.success(`${modele} supprimé.`);
    } catch (e) {
      const msg = messageErreurPrix(e, 'Suppression impossible');
      if (msg) toast.error(msg);
    }
  };

  // ─── Move model ───
  const handleMove = async (index, direction) => {
    if (!isAdmin) return;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= tarifs.length) return;
    const newTarifs = [...tarifs];
    [newTarifs[index], newTarifs[newIndex]] = [newTarifs[newIndex], newTarifs[index]];
    const reordered = newTarifs.map((t, i) => ({ ...t, ordre: i }));
    setTarifs(reordered);
    try {
      await sensible(() => api.reorderTarifsReparation(reordered.map((t, i) => ({ id: t.id, ordre: i }))));
    } catch (e) {
      const msg = messageErreurPrix(e, 'Ordre non enregistré');
      if (msg) toast.error(msg);
      load(); // reload on failure
    }
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(tarifs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'tarifs_reparation_klikphone.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    const headers = ['Modèle', ...COLUMNS.map(c => c.label)];
    const rows = tarifs.map(t => [
      t.modele, ...COLUMNS.map(c => t[c.key] ?? ''),
    ]);
    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'tarifs_reparation_klikphone.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return (
    <div className="page max-w-[1600px]">
      <div role="status" aria-label="Chargement des tarifs" className="loading-inline py-20 justify-center w-full">
        <Loader2 aria-hidden="true" /><span className="sr-only">Chargement des tarifs…</span>
      </div>
    </div>
  );

  // ── Print preview ──
  if (printMode) {
    const onePage = printPages === 1;
    const S = onePage
      ? { font: 7, price: 8, barre: 5.5, model: 7, header: 6, padY: '0px', padX: '1px', title: 11, logo: 26, pagePad: '1mm 2mm', gap: 4 }
      : { font: 13, price: 17, barre: 10, model: 13, header: 12, padY: '5px', padX: '4px', title: 18, logo: 44, pagePad: '1mm 2mm', gap: 8 };
    const year = new Date().getFullYear();
    const zoom = printZoom === 'fit' ? computeFitZoom(canvasWidth - 32, mmToPx(PAPERS.a4l.w), 1.5) : printZoom;

    // Split en N pages equilibrees (2 pages = moitie/moitie ~17 modeles chacune)
    const pages = [];
    if (onePage) {
      pages.push(tarifs);
    } else {
      const perPage = Math.ceil(tarifs.length / 2);
      pages.push(tarifs.slice(0, perPage));
      pages.push(tarifs.slice(perPage));
    }
    const overflowList = Object.keys(overflowPages).map(Number).filter((i) => overflowPages[i] && i < pages.length).map((i) => i + 1);

    return (
      <div className="kp-print-root min-h-screen bg-slate-200">
        <div className="no-print sticky top-0 z-50 bg-slate-900 text-white flex flex-wrap items-center gap-2 px-3 py-2">
          <button onClick={() => setPrintMode(false)} aria-label="Fermer l'aperçu"
            className="btn-ghost btn-icon text-white hover:bg-white/10 hover:text-white focus-visible:ring-white">
            <X aria-hidden="true" />
          </button>
          <span className="font-medium text-sm">Aperçu A4 paysage — {pages.length} page(s)</span>
          <div role="group" aria-label="Nombre de pages" className="flex items-center gap-1 sm:ml-2 bg-white/10 rounded-lg overflow-hidden">
            {[1, 2].map((n) => (
              <button key={n} onClick={() => setPrintPages(n)} aria-pressed={printPages === n}
                className={`h-11 px-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white ${printPages === n ? 'bg-brand-600' : 'hover:bg-white/10'}`}>
                {n === 1 ? '1 page' : '2 pages'}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Zoom" className="flex items-center gap-1 bg-white/10 rounded-lg overflow-hidden">
            {[['fit', 'Ajuster'], [1, '100 %']].map(([value, label]) => (
              <button key={label} onClick={() => setPrintZoom(value)} aria-pressed={printZoom === value}
                className={`h-11 px-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white ${printZoom === value ? 'bg-white text-slate-900' : 'hover:bg-white/10'}`}>
                {label}
              </button>
            ))}
            <span className="px-2 text-xs tabular-nums text-slate-200" aria-hidden="true">{Math.round(zoom * 100)} %</span>
          </div>
          <button onClick={() => window.print()} className="btn-primary ml-auto focus-visible:ring-white">
            <Printer aria-hidden="true" /> Imprimer
          </button>
        </div>

        {overflowList.length > 0 && (
          <p role="status" className="no-print callout callout-warning mx-4 mt-3">
            {overflowList.length > 1 ? 'Pages' : 'Page'} {overflowList.join(', ')} : le contenu dépasse la feuille A4 et sera coupé.
            {printPages === 1 && ' Passez en 2 pages.'}
          </p>
        )}

        <div ref={printCanvasRef} className="kp-print-canvas flex flex-col gap-6 overflow-x-auto px-4 py-6">
        {pages.map((pageRows, pageIdx) => (
          <PaperFrame key={pageIdx} paper={PAPERS.a4l} zoom={zoom} marginMm={PRINT_MARGIN_MM}
            className="mx-auto shrink-0"
            style={{ breakAfter: pageIdx < pages.length - 1 ? 'page' : 'auto' }}
            onOverflowChange={(over) => setOverflowPages((p) => ({ ...p, [pageIdx]: over }))}>
          <div className="print-page" style={{ padding: S.pagePad }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: S.gap, marginBottom: onePage ? 1 : 3 }}>
              <img src="/logo_k.png" alt="K" style={{ width: S.logo, height: S.logo, objectFit: 'contain' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: S.title, fontWeight: 900, color: '#1e293b' }}>
                  KLIKPHONE — Grille Tarifs Réparation iPhone — {year}
                </div>
                <div style={{ fontSize: onePage ? 5.5 : 7, color: '#64748b' }}>
                  Tarifs TTC — Main d'oeuvre incluse — Pièces garanties — Réparation express 30 min
                  {pages.length > 1 && ` — Page ${pageIdx + 1}/${pages.length}`}
                </div>
              </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ background: '#0f172a', color: '#fff', padding: `${S.padY} 3px`, textAlign: 'left', fontWeight: 900, border: '0.5px solid #94a3b8', fontSize: S.header, width: onePage ? '13%' : '15%' }}>Modèle</th>
                  {COLUMNS.map((c, i) => (
                    <th key={c.key} style={{ background: HEADER_COLORS[i], color: '#fff', padding: `${S.padY} ${S.padX}`, textAlign: 'center', fontWeight: 900, border: '0.5px solid #94a3b8', fontSize: S.header }}>
                      {c.shortLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((t, i) => {
                  const rowBg = ROW_PRINT_COLORS[i % ROW_PRINT_COLORS.length];
                  return (
                    <tr key={t.id}>
                      <td style={{ padding: `${S.padY} 3px`, fontWeight: 900, fontSize: S.model, color: '#0f172a', border: '0.5px solid #d1d5db', whiteSpace: 'nowrap', background: rowBg }}>{t.modele}</td>
                      {COLUMNS.map(c => {
                        const val = t[c.key];
                        const barre = getBarrePrice(val, t[c.key + '_barre']);
                        return (
                          <td key={c.key} style={{ padding: `${S.padY} ${S.padX}`, textAlign: 'center', border: '0.5px solid #d1d5db', verticalAlign: 'middle', background: rowBg }}>
                            {val != null ? (
                              <div style={{ lineHeight: 1 }}>
                                {barre != null && barre > val && (
                                  <div style={{ fontSize: S.barre, color: '#dc2626', textDecoration: 'line-through', lineHeight: 1 }}>{barre}€</div>
                                )}
                                <div style={{ fontSize: S.price, fontWeight: 900, color: '#0f172a', lineHeight: 1.1 }}>{val}€</div>
                              </div>
                            ) : (
                              <span style={{ color: '#d1d5db', fontSize: S.font }}>—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 1, textAlign: 'center', fontSize: onePage ? 5 : 6, color: '#94a3b8' }}>
              Tarifs TTC — Main d'oeuvre incluse — Pièces garanties — Réparation express 30 min — klikphone.com
            </div>
          </div>
          </PaperFrame>
        ))}
        </div>

        <style>{`
          @media print {
            @page { size: A4 landscape; margin: ${PRINT_MARGIN_MM}mm; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; background: #fff !important; }
            .no-print, aside { display: none !important; }
            main { padding-left: 0 !important; padding-top: 0 !important; }
            .kp-print-root { background: #fff !important; min-height: 0 !important; }
            .kp-print-canvas { display: block !important; padding: 0 !important; overflow: visible !important; background: #fff !important; }
            .kp-paper { width: auto !important; height: auto !important; box-shadow: none !important; margin: 0 !important; }
            .kp-paper-inner { transform: none !important; width: auto !important; height: auto !important; padding: 0 !important; overflow: visible !important; }
          }
        `}</style>
      </div>
    );
  }

  // ── Main view ──
  const colSpan = COLUMNS.length + (isAdmin ? 4 : 2);
  // Prix : fond blanc pour les cellules fixes (colonne collante), fond slate-50 pour les lignes paires
  const celluleFixe = 'bg-white group-even:bg-slate-50';
  return (
    <div className="page max-w-[1600px]">
      {/* Header */}
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-header-title">Tarifs Réparation iPhone</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <p className="text-sm text-slate-500">{tarifs.length} modèles</p>
            {isAdmin ? (
              <span className="badge badge-success">
                <Pencil className="w-3 h-3" aria-hidden="true" /> Mode édition
              </span>
            ) : (
              <span className="badge badge-neutral">
                <Lock className="w-3 h-3" aria-hidden="true" /> Lecture seule
              </span>
            )}
          </div>
        </div>
        <div className="page-header-actions max-w-full">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
            <input
              type="search"
              aria-label="Rechercher un modèle"
              placeholder="Rechercher..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-9 w-44"
            />
          </div>
          <FiltreAnciens actif={anciensSeuls} onChange={setAnciensSeuls} nombre={nombreAnciens} />
          <button type="button" onClick={exportJSON} className="btn-secondary">
            <FileJson aria-hidden="true" /> JSON
          </button>
          <button type="button" onClick={exportCSV} className="btn-secondary">
            <FileSpreadsheet aria-hidden="true" /> CSV
          </button>
          <button type="button" onClick={() => setPrintMode(true)} className="btn-secondary">
            <Printer aria-hidden="true" /> Impression
          </button>
          {isAdmin && (
            <>
              <button type="button" onClick={() => setFenetre('historique')} className="btn-secondary">
                <History aria-hidden="true" /> Historique
              </button>
              <button type="button" onClick={() => setFenetre('ajuster')} className="btn-secondary">
                <SlidersHorizontal aria-hidden="true" /> Ajuster en %
              </button>
              <button type="button" onClick={() => setShowAdd(true)} className="btn-primary">
                <Plus aria-hidden="true" /> Ajouter
              </button>
            </>
          )}
          {isAdmin ? (
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem('klikphone_admin');
                api.clearAdminToken();
                setIsAdmin(false);
                setEditCell(null);
                setShowAdd(false);
              }}
              className="btn-secondary"
              title="Repasser en lecture seule"
            >
              <Lock aria-hidden="true" /> Fermer l’édition
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowAdminModal(true)}
              className="btn-primary"
              title="Activer le mode édition (admin)"
            >
              <Pencil aria-hidden="true" /> Modifier
            </button>
          )}
        </div>
      </div>

      {/* Où sont les prix ? iPhone ici (grille boutique) ; les autres marques et iPad / Mac dans « Réparation smartphones » */}
      <div className="callout callout-info items-center flex-wrap mb-4">
        <Info aria-hidden="true" />
        <p className="flex-1 min-w-[240px]">
          <strong>Où sont les prix ?</strong> iPhone → cette grille boutique ; autres marques et iPad / Mac →{' '}
          <LienReparationSmartphones />
          {' '}(prix fournisseur Mobilax / Utopya + méthode de calcul).
        </p>
      </div>

      {erreurChargement && (
        <div role="alert" className="callout callout-danger items-center mb-4">
          <span className="flex-1">{erreurChargement}</span>
          <button type="button" onClick={() => { setLoading(true); load(); }} className="btn-secondary btn-sm">Réessayer</button>
        </div>
      )}

      {/* Add model bar */}
      {showAdd && (
        <div className="card-section mb-4 flex items-center gap-2">
          <input
            ref={addRef}
            type="text"
            aria-label="Nom du nouveau modèle"
            value={newModele}
            onChange={e => setNewModele(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setShowAdd(false); setNewModele(''); } }}
            placeholder="Nom du modèle (ex: iPhone 17 Pro Max)"
            className="input flex-1"
          />
          <button type="button" onClick={handleAdd} disabled={!newModele.trim()} className="btn-primary">
            Ajouter
          </button>
          <button type="button" onClick={() => { setShowAdd(false); setNewModele(''); }} aria-label="Annuler l’ajout"
            className="btn-ghost btn-icon">
            <X aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="table-wrap scroll-fade-x">
          <table className="w-full border-collapse min-w-[960px] text-sm text-slate-700">
            <caption className="sr-only">Tarifs de réparation iPhone, prix TTC</caption>
            <thead>
              <tr className="bg-slate-50">
                {isAdmin && (
                  <th scope="col" className="table-header table-sticky-col !bg-slate-50 px-2 py-3 text-center w-[100px]">
                    Ordre
                  </th>
                )}
                <th scope="col" className={`table-header px-4 py-3 text-left min-w-[170px] ${isAdmin ? '' : 'table-sticky-col !bg-slate-50'}`}>
                  Modèle iPhone
                </th>
                <th scope="col" className="table-header px-3 py-3 text-left whitespace-nowrap hidden md:table-cell">
                  Prix du
                </th>
                {COLUMNS.map(c => (
                  <th scope="col" key={c.key} className={`table-header px-3 py-3 text-center whitespace-nowrap border-t-2 ${c.accent}`}>
                    {c.label}
                  </th>
                ))}
                {isAdmin && <th scope="col" className="table-header px-2 py-3 text-center w-[100px]">Verrou / suppr.</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const realIndex = tarifs.findIndex(x => x.id === t.id);
                const verrou = verrouilles.has(t.id);
                return (
                  <tr key={t.id} className="group border-t border-slate-100 even:bg-slate-50 hover:bg-brand-50/40 transition-colors">
                    {/* Move buttons */}
                    {isAdmin && (
                      <td className={`px-1 py-1 text-center table-sticky-col ${celluleFixe}`}>
                        <div className="flex items-center justify-center gap-0.5">
                          <button type="button" onClick={() => handleMove(realIndex, -1)} disabled={realIndex === 0 || !!search || anciensSeuls}
                            className="btn-ghost btn-icon"
                            aria-label={`Monter ${t.modele}`}>
                            <ChevronUp aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => handleMove(realIndex, 1)} disabled={realIndex === tarifs.length - 1 || !!search || anciensSeuls}
                            className="btn-ghost btn-icon"
                            aria-label={`Descendre ${t.modele}`}>
                            <ChevronDown aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    )}
                    {/* Model name */}
                    <th scope="row" className={`px-4 py-2.5 text-left font-semibold text-sm text-slate-900 whitespace-nowrap ${isAdmin ? '' : `table-sticky-col ${celluleFixe}`}`}>
                      {t.modele}
                      {verrou && <Lock className="inline w-3.5 h-3.5 ml-1.5 text-amber-700" aria-label="verrouillé" />}
                    </th>
                    <td className="px-3 py-1.5 whitespace-nowrap hidden md:table-cell">
                      <BadgeDatePrix row={t} court />
                    </td>
                    {/* Price cells */}
                    {COLUMNS.map(c => {
                      const isEditing = editCell?.id === t.id && editCell?.key === c.key;
                      const envoiCellule = envois.enCours(t.id, c.key);
                      const val = t[c.key];
                      const barre = getBarrePrice(val, t[c.key + '_barre']);
                      const contenu = val != null ? (
                        <span className="block tabular-nums">
                          {barre != null && barre > val && (
                            <span className="block text-xs text-slate-500 line-through leading-none mb-0.5">{barre}€</span>
                          )}
                          <span className="block text-sm font-semibold text-slate-900">{val}€</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 text-sm" aria-hidden="true">—</span>
                      );
                      // Prix affiché aussitôt, petit indicateur tant que le serveur n'a pas confirmé
                      const contenuCellule = envoiCellule ? (
                        <span className="relative block">
                          {contenu}
                          <Loader2 className="absolute -top-1 -right-1 w-3 h-3 text-slate-500 motion-safe:animate-spin" aria-hidden="true" />
                          <span className="sr-only">Enregistrement…</span>
                        </span>
                      ) : contenu;
                      return (
                        <td key={c.key} className="px-1 py-1 text-center">
                          {isEditing ? (
                            <input
                              ref={inputRef}
                              type="text"
                              inputMode="numeric"
                              aria-label={`${c.label} de ${t.modele}, en euros`}
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onKeyDown={handleKeyDown}
                              onBlur={saveEdit}
                              className="input w-16 px-1.5 text-center font-semibold border-brand-500 ring-2 ring-brand-500/40"
                            />
                          ) : isAdmin ? (
                            <button
                              type="button"
                              onClick={() => startEdit(t, c.key, val)}
                              aria-label={`${c.label} de ${t.modele} : ${val != null ? `${val} euros` : 'pas de prix'}. ${verrou ? 'Verrouillé' : 'Modifier'}`}
                              aria-busy={envoiCellule || undefined}
                              className={`w-full min-h-[44px] rounded-lg px-1 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${verrou ? 'cursor-not-allowed' : 'hover:bg-brand-50 hover:ring-1 hover:ring-brand-200'}`}
                            >
                              {contenuCellule}
                            </button>
                          ) : (
                            <span className="block py-1.5">{contenu}{val == null && <span className="sr-only">pas de prix</span>}</span>
                          )}
                        </td>
                      );
                    })}
                    {/* Verrou + suppression */}
                    {isAdmin && (
                      <td className="px-1 py-1 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <BoutonVerrou
                            verrouille={verrou}
                            onClick={() => basculerVerrou(t.id, t.modele)}
                            disabled={verrouEnCours === t.id}
                            nom={`les prix de ${t.modele}`}
                            aide={verrou ? AIDE_VERROU_BOUTIQUE.oui : AIDE_VERROU_BOUTIQUE.non}
                          />
                          <button
                            type="button"
                            onClick={() => handleDelete(t.id, t.modele)}
                            className="btn-danger-ghost btn-icon"
                            aria-label={`Supprimer ${t.modele}`}
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="text-center py-12 text-slate-500 text-sm">
                    {anciensSeuls && !search ? 'Aucun prix de plus de 3 mois.' : `Aucun modèle trouvé pour "${search}"`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
      </div>

      <p className="t-caption mt-3 text-center">
        {isAdmin
          ? `Touchez un prix pour le modifier (Entrée = enregistrer, Échap = annuler). Flèches = déplacer. ${AIDE_VERROU_BOUTIQUE.note}`
          : 'Mode lecture seule. Touchez « Modifier » en haut à droite pour activer l\'édition (admin requis).'}
      </p>

      <AjustementColonne
        open={fenetre === 'ajuster'}
        onClose={() => setFenetre(null)}
        sensible={sensible}
        cible={TABLE}
        titre="Ajuster une colonne de la grille iPhone"
        colonnes={COLUMNS.map(({ key, label }) => ({ key, label }))}
        lignes={filtered.map((t) => ({ id: t.id, label: t.modele, valeurs: t }))}
        verrouilles={verrouilles}
        onApplique={() => load()}
      />
      <HistoriquePrix
        open={fenetre === 'historique'}
        onClose={() => setFenetre(null)}
        sensible={sensible}
        filtre={{ table: TABLE }}
        titre="Historique de la grille iPhone"
        nommer={(l) => tarifs.find((t) => t.id === l.ligne_id)?.modele}
        onAnnule={() => load()}
      />

      <AdminLoginModal
        open={showAdminModal}
        onClose={() => setShowAdminModal(false)}
        onSuccess={() => {
          setIsAdmin(true);
          setShowAdminModal(false);
        }}
      />
      {adminPrompt}
    </div>
  );
}
