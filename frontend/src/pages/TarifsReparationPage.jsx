import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, Printer, FileJson, FileSpreadsheet, X, Plus, Trash2, ChevronUp, ChevronDown, Lock, Pencil, SlidersHorizontal, History } from 'lucide-react';
import api from '../lib/api';
import AdminLoginModal from '../components/AdminLoginModal';
import { PaperFrame, PAPERS, computeFitZoom, mmToPx } from '../components/PrintPreview';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useToast } from '../components/Toast';
import HistoriquePrix, { BadgeDatePrix, BoutonVerrou, FiltreAnciens, messageErreurPrix, plusDeTroisMois } from '../components/HistoriquePrix';
import { AIDE_VERROU_BOUTIQUE, AjustementColonne, useVerrousBoutique } from '../components/ReglesPrixPanel';

const PRINT_MARGIN_MM = 1;
const TABLE = 'tarifs_reparation';

const COLUMNS = [
  { key: 'ecran_generique', label: 'Écran Générique', shortLabel: 'Générique', headerBg: 'bg-blue-600' },
  { key: 'ecran_confort', label: 'Écran Confort', shortLabel: 'Confort', headerBg: 'bg-blue-700' },
  { key: 'ecran_apple', label: 'Écran Apple', shortLabel: 'Apple', headerBg: 'bg-blue-800' },
  { key: 'batterie', label: 'Batterie', shortLabel: 'Batterie', headerBg: 'bg-yellow-700' },
  { key: 'desoxydation', label: 'Désoxydation', shortLabel: 'Désoxy.', headerBg: 'bg-green-700' },
  { key: 'connecteur_charge', label: 'Connecteur', shortLabel: 'Connect.', headerBg: 'bg-rose-600' },
  { key: 'reparation_divers', label: 'Réparation', shortLabel: 'Répar.', headerBg: 'bg-indigo-600' },
  { key: 'ecouteur_apn', label: 'Écouteur/APN', shortLabel: 'Écout.', headerBg: 'bg-purple-600' },
  { key: 'vitre_arriere', label: 'Vitre Arrière', shortLabel: 'Vitre Arr.', headerBg: 'bg-orange-700' },
  { key: 'chassis', label: 'Châssis', shortLabel: 'Châssis', headerBg: 'bg-slate-700' },
];

const ROW_COLORS = [
  'bg-blue-50/60', '', 'bg-yellow-50/60', '', 'bg-green-50/60', '',
  'bg-rose-50/60', '', 'bg-indigo-50/60', '', 'bg-purple-50/60', '',
  'bg-orange-50/50', '', 'bg-slate-50/60', '',
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
  const [saving, setSaving] = useState(false);
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
  useEffect(() => { if (editCell && inputRef.current) inputRef.current.focus(); }, [editCell]);
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
    setEditCell({ id: t.id, key });
    setEditValue(val !== null && val !== undefined ? String(val) : '');
  };

  const cancelEdit = () => { setEditCell(null); setEditValue(''); };

  const saveEdit = async () => {
    if (!editCell || saving) return;
    const val = editValue.trim() === '' ? null : parseInt(editValue, 10);
    if (val !== null && (isNaN(val) || val < 0)) {
      toast.error('Prix invalide : saisissez un nombre entier en euros (ou laissez vide).');
      cancelEdit();
      return;
    }
    const courant = tarifs.find((t) => t.id === editCell.id);
    if (courant && (courant[editCell.key] ?? null) === val) { cancelEdit(); return; }
    setSaving(true);
    try {
      const cell = editCell;
      const updated = await sensible(() => api.updateTarifReparation(cell.id, { [cell.key]: val }));
      // La réponse (SELECT *) n'a pas d'âge calculé : l'ancien age_jours ferait passer un prix du jour
      // pour « périmé ». Sans lui, la fraîcheur se recalcule depuis prix_maj_le.
      setTarifs(prev => prev.map((t) => {
        if (t.id !== cell.id) return t;
        const { age_jours: _age, fraicheur: _fraicheur, ...reste } = t;
        return { ...reste, ...updated };
      }));
      cancelEdit();
    } catch (e) {
      const msg = messageErreurPrix(e, 'Prix non enregistré');
      if (msg) toast.error(msg);
      cancelEdit();
    } finally {
      setSaving(false);
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
    <div className="flex items-center justify-center h-96">
      <div role="status" aria-label="Chargement des tarifs" className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full motion-safe:animate-spin" />
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
            className="inline-flex items-center justify-center w-11 h-11 rounded-lg hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <X className="w-5 h-5" aria-hidden="true" />
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
          <button onClick={() => window.print()} className="ml-auto flex items-center gap-2 h-11 px-4 bg-brand-600 hover:bg-brand-700 rounded-lg text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <Printer className="w-4 h-4" aria-hidden="true" /> Imprimer
          </button>
        </div>

        {overflowList.length > 0 && (
          <p role="status" className="no-print mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
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
  const boutonBase = 'flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1';
  const bouton = `${boutonBase} font-bold`;
  const colSpan = COLUMNS.length + (isAdmin ? 4 : 2);
  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex items-center gap-3 shrink-0">
          <img src="/logo_k.png" alt="" className="w-10 h-10 rounded-xl object-contain" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">Tarifs Réparation iPhone</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-slate-600">{tarifs.length} modèles</p>
              {isAdmin ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-800">
                  <Pencil className="w-3 h-3" aria-hidden="true" /> Mode édition
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
                  <Lock className="w-3 h-3" aria-hidden="true" /> Lecture seule
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
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
              className={`${bouton} bg-slate-100 text-slate-700 hover:bg-slate-200`}
              title="Repasser en lecture seule"
            >
              <Lock className="w-4 h-4" aria-hidden="true" /> Fermer l’édition
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowAdminModal(true)}
              className={`${bouton} bg-amber-600 text-white hover:bg-amber-700`}
              title="Activer le mode édition (admin)"
            >
              <Pencil className="w-4 h-4" aria-hidden="true" /> Modifier
            </button>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
            <input
              type="search"
              aria-label="Rechercher un modèle"
              placeholder="Rechercher..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="min-h-[44px] pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm w-44 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
            />
          </div>
          <FiltreAnciens actif={anciensSeuls} onChange={setAnciensSeuls} nombre={nombreAnciens} />
          {isAdmin && (
            <>
              <button type="button" onClick={() => setShowAdd(true)} className={`${bouton} bg-emerald-700 text-white hover:bg-emerald-800`}>
                <Plus className="w-4 h-4" aria-hidden="true" /> Ajouter
              </button>
              <button type="button" onClick={() => setFenetre('ajuster')} className={`${bouton} bg-violet-700 text-white hover:bg-violet-800`}>
                <SlidersHorizontal className="w-4 h-4" aria-hidden="true" /> Ajuster en %
              </button>
              <button type="button" onClick={() => setFenetre('historique')} className={`${bouton} bg-white border border-slate-200 text-slate-700 hover:bg-slate-50`}>
                <History className="w-4 h-4" aria-hidden="true" /> Historique
              </button>
            </>
          )}
          <button type="button" onClick={exportJSON} className={`${boutonBase} font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50`}>
            <FileJson className="w-4 h-4" aria-hidden="true" /> JSON
          </button>
          <button type="button" onClick={exportCSV} className={`${boutonBase} font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50`}>
            <FileSpreadsheet className="w-4 h-4" aria-hidden="true" /> CSV
          </button>
          <button type="button" onClick={() => setPrintMode(true)} className={`${bouton} bg-brand-600 text-white hover:bg-brand-700`}>
            <Printer className="w-4 h-4" aria-hidden="true" /> Impression
          </button>
        </div>
      </div>

      {erreurChargement && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span>{erreurChargement}</span>
          <button type="button" onClick={() => { setLoading(true); load(); }} className="min-h-[44px] px-3 rounded-lg font-semibold hover:bg-red-100">Réessayer</button>
        </div>
      )}

      {/* Add model bar */}
      {showAdd && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
          <input
            ref={addRef}
            type="text"
            aria-label="Nom du nouveau modèle"
            value={newModele}
            onChange={e => setNewModele(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setShowAdd(false); setNewModele(''); } }}
            placeholder="Nom du modèle (ex: iPhone 17 Pro Max)"
            className="flex-1 min-h-[44px] px-3 py-2 border border-emerald-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
          <button type="button" onClick={handleAdd} disabled={!newModele.trim()} className="min-h-[44px] px-4 py-2 bg-emerald-700 text-white rounded-lg text-sm font-bold hover:bg-emerald-800 disabled:opacity-40">
            Ajouter
          </button>
          <button type="button" onClick={() => { setShowAdd(false); setNewModele(''); }} aria-label="Annuler l’ajout"
            className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 hover:bg-emerald-100">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[1300px]">
            <caption className="sr-only">Tarifs de réparation iPhone, prix TTC</caption>
            <thead>
              <tr>
                {isAdmin && (
                  <th scope="col" className="bg-slate-900 text-white px-2 py-3 text-center text-[11px] font-bold sticky left-0 z-20 border-r border-slate-700 w-[100px]">
                    Ordre
                  </th>
                )}
                <th scope="col" className="bg-slate-900 text-white px-4 py-3 text-left text-xs font-bold border-r border-slate-700 min-w-[170px]">
                  Modèle iPhone
                </th>
                <th scope="col" className="bg-slate-900 text-white px-3 py-3 text-left text-[11px] font-bold border-r border-slate-700 whitespace-nowrap">
                  Prix du
                </th>
                {COLUMNS.map(c => (
                  <th scope="col" key={c.key} className={`${c.headerBg} text-white px-3 py-3 text-center text-[11px] font-bold border-x border-white/20 whitespace-nowrap`}>
                    {c.label}
                  </th>
                ))}
                {isAdmin && <th scope="col" className="bg-slate-900 text-white px-2 py-3 text-center text-[11px] font-bold w-[100px]">Verrou / suppr.</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => {
                const realIndex = tarifs.findIndex(x => x.id === t.id);
                const verrou = verrouilles.has(t.id);
                return (
                  <tr key={t.id} className={`${ROW_COLORS[i % ROW_COLORS.length]} hover:bg-brand-50/40 transition-colors group`}>
                    {/* Move buttons */}
                    {isAdmin && (
                      <td className="px-1 py-1 text-center border-r border-slate-200 bg-white sticky left-0 z-10">
                        <div className="flex items-center justify-center gap-0.5">
                          <button type="button" onClick={() => handleMove(realIndex, -1)} disabled={realIndex === 0 || !!search || anciensSeuls}
                            className="w-11 h-11 inline-flex items-center justify-center rounded-lg hover:bg-slate-200 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                            aria-label={`Monter ${t.modele}`}>
                            <ChevronUp className="w-4 h-4 text-slate-700" aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => handleMove(realIndex, 1)} disabled={realIndex === tarifs.length - 1 || !!search || anciensSeuls}
                            className="w-11 h-11 inline-flex items-center justify-center rounded-lg hover:bg-slate-200 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                            aria-label={`Descendre ${t.modele}`}>
                            <ChevronDown className="w-4 h-4 text-slate-700" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    )}
                    {/* Model name */}
                    <th scope="row" className="px-4 py-2.5 text-left font-bold text-sm text-slate-900 border-r border-slate-200 bg-white whitespace-nowrap">
                      {t.modele}
                      {verrou && <Lock className="inline w-3.5 h-3.5 ml-1.5 text-amber-700" aria-label="verrouillé" />}
                    </th>
                    <td className="px-3 py-1.5 border-r border-slate-100 bg-white whitespace-nowrap">
                      <BadgeDatePrix row={t} court />
                    </td>
                    {/* Price cells */}
                    {COLUMNS.map(c => {
                      const isEditing = editCell?.id === t.id && editCell?.key === c.key;
                      const val = t[c.key];
                      const barre = getBarrePrice(val, t[c.key + '_barre']);
                      const contenu = val != null ? (
                        <span className="block">
                          {barre != null && barre > val && (
                            <span className="block text-[11px] text-red-700 line-through leading-none mb-0.5">{barre}€</span>
                          )}
                          <span className="block text-sm font-black text-slate-900">{val}€</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 text-sm" aria-hidden="true">—</span>
                      );
                      return (
                        <td key={c.key} className="px-1 py-1 text-center border-x border-slate-100">
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
                              className="w-16 min-h-[44px] px-1.5 text-center text-sm font-bold border-2 border-brand-500 rounded-lg outline-none bg-brand-50"
                            />
                          ) : isAdmin ? (
                            <button
                              type="button"
                              onClick={() => startEdit(t, c.key, val)}
                              aria-label={`${c.label} de ${t.modele} : ${val != null ? `${val} euros` : 'pas de prix'}. ${verrou ? 'Verrouillé' : 'Modifier'}`}
                              className={`w-full min-h-[44px] rounded-lg px-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${verrou ? 'cursor-not-allowed' : 'hover:bg-amber-50'}`}
                            >
                              {contenu}
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
                            className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                            aria-label={`Supprimer ${t.modele}`}
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="text-center py-12 text-slate-600 text-sm">
                    {anciensSeuls && !search ? 'Aucun prix de plus de 3 mois.' : `Aucun modèle trouvé pour "${search}"`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-600 mt-3 text-center">
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
