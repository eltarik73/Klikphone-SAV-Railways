import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Printer, FileJson, FileSpreadsheet, X, Plus, Trash2, ChevronUp, ChevronDown, GripVertical } from 'lucide-react';
import api from '../lib/api';

const COLUMNS = [
  { key: 'ecran_generique', label: 'Écran Générique', shortLabel: 'Générique', headerBg: 'bg-blue-600' },
  { key: 'ecran_confort', label: 'Écran Confort', shortLabel: 'Confort', headerBg: 'bg-blue-700' },
  { key: 'ecran_apple', label: 'Écran Apple', shortLabel: 'Apple', headerBg: 'bg-blue-800' },
  { key: 'batterie', label: 'Batterie', shortLabel: 'Batterie', headerBg: 'bg-yellow-600' },
  { key: 'desoxydation', label: 'Désoxydation', shortLabel: 'Désoxy.', headerBg: 'bg-green-600' },
  { key: 'connecteur_charge', label: 'Connecteur', shortLabel: 'Connect.', headerBg: 'bg-rose-600' },
  { key: 'reparation_divers', label: 'Réparation', shortLabel: 'Répar.', headerBg: 'bg-indigo-600' },
  { key: 'ecouteur_apn', label: 'Écouteur/APN', shortLabel: 'Écout.', headerBg: 'bg-purple-600' },
  { key: 'vitre_arriere', label: 'Vitre Arrière', shortLabel: 'Vitre Arr.', headerBg: 'bg-orange-600' },
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
  const [tarifs, setTarifs] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editCell, setEditCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [printMode, setPrintMode] = useState(false);
  const [printPages, setPrintPages] = useState(2);
  const [newModele, setNewModele] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const inputRef = useRef(null);
  const addRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getTarifsReparation();
      setTarifs(data);
    } catch (e) {
      console.error('Erreur chargement tarifs:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (editCell && inputRef.current) inputRef.current.focus(); }, [editCell]);
  useEffect(() => { if (showAdd && addRef.current) addRef.current.focus(); }, [showAdd]);

  const filtered = search
    ? tarifs.filter(t => t.modele.toLowerCase().includes(search.toLowerCase()))
    : tarifs;

  const startEdit = (id, key, val) => {
    setEditCell({ id, key });
    setEditValue(val !== null && val !== undefined ? String(val) : '');
  };

  const cancelEdit = () => { setEditCell(null); setEditValue(''); };

  const saveEdit = async () => {
    if (!editCell || saving) return;
    setSaving(true);
    try {
      const val = editValue.trim() === '' ? null : parseInt(editValue, 10);
      if (val !== null && isNaN(val)) { cancelEdit(); setSaving(false); return; }
      const updated = await api.updateTarifReparation(editCell.id, { [editCell.key]: val });
      setTarifs(prev => prev.map(t => t.id === editCell.id ? updated : t));
      cancelEdit();
    } catch (e) {
      console.error('Erreur sauvegarde:', e);
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
    const name = newModele.trim();
    if (!name) return;
    try {
      const created = await api.addTarifReparation(name);
      setTarifs(prev => [...prev, created]);
      setNewModele('');
      setShowAdd(false);
    } catch (e) {
      console.error('Erreur ajout:', e);
    }
  };

  // ─── Delete model ───
  const handleDelete = async (id, modele) => {
    if (!confirm(`Supprimer "${modele}" ?`)) return;
    try {
      await api.deleteTarifReparation(id);
      setTarifs(prev => prev.filter(t => t.id !== id));
    } catch (e) {
      console.error('Erreur suppression:', e);
    }
  };

  // ─── Move model ───
  const handleMove = async (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= tarifs.length) return;
    const newTarifs = [...tarifs];
    [newTarifs[index], newTarifs[newIndex]] = [newTarifs[newIndex], newTarifs[index]];
    // Update ordre
    const reordered = newTarifs.map((t, i) => ({ ...t, ordre: i }));
    setTarifs(reordered);
    try {
      await api.reorderTarifsReparation(reordered.map((t, i) => ({ id: t.id, ordre: i })));
    } catch (e) {
      console.error('Erreur reorder:', e);
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
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'tarifs_reparation_klikphone.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-96">
      <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
    </div>
  );

  // ── Print preview ──
  if (printMode) {
    const onePage = printPages === 1;
    const pageSize = onePage ? 999 : 18;
    const S = onePage
      ? { font: 7, price: 8, barre: 5.5, model: 7, header: 6, padY: '0px', padX: '1px', title: 11, logo: 26, pagePad: '1mm 2mm', gap: 4 }
      : { font: 9, price: 11, barre: 7, model: 9, header: 8, padY: '2px', padX: '3px', title: 14, logo: 36, pagePad: '3mm 4mm', gap: 6 };

    const pages = [];
    for (let i = 0; i < tarifs.length; i += pageSize) {
      pages.push(tarifs.slice(i, i + pageSize));
    }

    return (
      <div className="min-h-screen bg-white">
        <div className="no-print sticky top-0 z-50 bg-slate-900 text-white flex items-center gap-3 px-4 py-2">
          <button onClick={() => setPrintMode(false)} className="p-1.5 rounded-lg hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
          <span className="font-medium text-sm">Aperçu A4 paysage — {pages.length} page(s)</span>
          <div className="flex items-center gap-1 ml-4 bg-white/10 rounded-lg overflow-hidden">
            <button onClick={() => setPrintPages(1)} className={`px-3 py-1 text-xs font-bold ${printPages === 1 ? 'bg-brand-600' : 'hover:bg-white/10'}`}>1 page</button>
            <button onClick={() => setPrintPages(2)} className={`px-3 py-1 text-xs font-bold ${printPages === 2 ? 'bg-brand-600' : 'hover:bg-white/10'}`}>2 pages</button>
          </div>
          <button onClick={() => window.print()} className="ml-auto flex items-center gap-2 px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-sm font-bold">
            <Printer className="w-4 h-4" /> Imprimer
          </button>
        </div>

        {pages.map((pageRows, pageIdx) => (
          <div key={pageIdx} className="print-page" style={{ padding: S.pagePad, pageBreakAfter: pageIdx < pages.length - 1 ? 'always' : 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: S.gap, marginBottom: onePage ? 1 : 3 }}>
              <img src="/logo_k.png" alt="K" style={{ width: S.logo, height: S.logo, objectFit: 'contain' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: S.title, fontWeight: 900, color: '#1e293b' }}>
                  KLIKPHONE — Grille Tarifs Réparation iPhone — 2025
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
        ))}

        <style>{`
          @media print {
            @page { size: A4 landscape; margin: 1mm; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
            .no-print, aside { display: none !important; }
            main { padding-left: 0 !important; padding-top: 0 !important; }
            .print-page { padding: 1mm 2mm !important; }
          }
        `}</style>
      </div>
    );
  }

  // ── Main view ──
  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <div className="flex items-center gap-3">
          <img src="/logo_k.png" alt="Klikphone" className="w-10 h-10 rounded-xl object-contain" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">Tarifs Réparation iPhone</h1>
            <p className="text-xs text-slate-500">{tarifs.length} modèles — Sauvegarde automatique</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm w-44 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
            />
          </div>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700">
            <Plus className="w-4 h-4" /> Ajouter
          </button>
          <button onClick={exportJSON} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">
            <FileJson className="w-4 h-4" /> JSON
          </button>
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">
            <FileSpreadsheet className="w-4 h-4" /> CSV
          </button>
          <button onClick={() => setPrintMode(true)} className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white rounded-xl text-xs font-bold hover:bg-brand-700">
            <Printer className="w-4 h-4" /> Impression
          </button>
        </div>
      </div>

      {/* Add model bar */}
      {showAdd && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
          <input
            ref={addRef}
            type="text"
            value={newModele}
            onChange={e => setNewModele(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setShowAdd(false); setNewModele(''); } }}
            placeholder="Nom du modèle (ex: iPhone 17 Pro Max)"
            className="flex-1 px-3 py-2 border border-emerald-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
          <button onClick={handleAdd} disabled={!newModele.trim()} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 disabled:opacity-40">
            Ajouter
          </button>
          <button onClick={() => { setShowAdd(false); setNewModele(''); }} className="p-2 text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[1200px]">
            <thead>
              <tr>
                <th className="bg-slate-900 text-white px-2 py-3 text-center text-[10px] font-bold sticky left-0 z-20 border-r border-slate-700 w-[50px]">
                  Ordre
                </th>
                <th className="bg-slate-900 text-white px-4 py-3 text-left text-xs font-bold border-r border-slate-700 min-w-[170px]">
                  Modèle iPhone
                </th>
                {COLUMNS.map(c => (
                  <th key={c.key} className={`${c.headerBg} text-white px-3 py-3 text-center text-[11px] font-bold border-x border-white/20 whitespace-nowrap`}>
                    {c.label}
                  </th>
                ))}
                <th className="bg-slate-900 text-white px-2 py-3 text-center text-[10px] font-bold w-[40px]" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => {
                const realIndex = tarifs.findIndex(x => x.id === t.id);
                return (
                  <tr key={t.id} className={`${ROW_COLORS[i % ROW_COLORS.length]} hover:bg-brand-50/40 transition-colors group`}>
                    {/* Move buttons */}
                    <td className="px-1 py-1 text-center border-r border-slate-200 bg-white sticky left-0 z-10">
                      <div className="flex flex-col items-center gap-0.5 opacity-40 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleMove(realIndex, -1)} disabled={realIndex === 0}
                          className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-20" title="Monter">
                          <ChevronUp className="w-3.5 h-3.5 text-slate-600" />
                        </button>
                        <span className="text-[9px] text-slate-400 font-mono">{i + 1}</span>
                        <button onClick={() => handleMove(realIndex, 1)} disabled={realIndex === tarifs.length - 1}
                          className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-20" title="Descendre">
                          <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
                        </button>
                      </div>
                    </td>
                    {/* Model name */}
                    <td className="px-4 py-2.5 font-bold text-sm text-slate-900 border-r border-slate-200 bg-white whitespace-nowrap">
                      {t.modele}
                    </td>
                    {/* Price cells */}
                    {COLUMNS.map(c => {
                      const isEditing = editCell?.id === t.id && editCell?.key === c.key;
                      const val = t[c.key];
                      const barre = getBarrePrice(val, t[c.key + '_barre']);
                      return (
                        <td
                          key={c.key}
                          className="px-2 py-1.5 text-center border-x border-slate-100 cursor-pointer transition-colors"
                          onClick={() => !isEditing && startEdit(t.id, c.key, val)}
                        >
                          {isEditing ? (
                            <input
                              ref={inputRef}
                              type="text"
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onKeyDown={handleKeyDown}
                              onBlur={saveEdit}
                              className="w-16 px-1.5 py-0.5 text-center text-sm font-bold border-2 border-brand-500 rounded-lg outline-none bg-brand-50"
                            />
                          ) : val != null ? (
                            <div>
                              {barre != null && barre > val && (
                                <div className="text-[10px] text-red-400 line-through leading-none mb-0.5">{barre}€</div>
                              )}
                              <div className="text-sm font-black text-slate-900">{val}€</div>
                            </div>
                          ) : (
                            <span className="text-slate-300 text-sm">—</span>
                          )}
                        </td>
                      );
                    })}
                    {/* Delete button */}
                    <td className="px-1 py-1 text-center">
                      <button
                        onClick={() => handleDelete(t.id, t.modele)}
                        className="p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                        title="Supprimer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 3} className="text-center py-12 text-slate-400 text-sm">
                    Aucun modèle trouvé pour "{search}"
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 mt-3 text-center">
        Cliquez sur un prix pour le modifier (Entrée = sauvegarder). Flèches = déplacer. Corbeille = supprimer.
      </p>
    </div>
  );
}
