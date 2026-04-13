import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Download, Printer, FileJson, FileSpreadsheet, X } from 'lucide-react';
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

function PriceCell({ val, barre, isEditing, editValue, setEditValue, onKeyDown, onBlur, inputRef, onClick }) {
  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        className="w-16 px-1.5 py-0.5 text-center text-sm font-bold border-2 border-brand-500 rounded-lg outline-none bg-brand-50"
      />
    );
  }
  if (val == null) return <span className="text-slate-300 text-sm">—</span>;
  return (
    <div className="cursor-pointer" onClick={onClick}>
      {barre != null && barre > val && (
        <div className="text-[10px] text-red-400 line-through leading-none mb-0.5">{barre}€</div>
      )}
      <div className="text-sm font-black text-slate-900">{val}€</div>
    </div>
  );
}

export default function TarifsReparationPage() {
  const [tarifs, setTarifs] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editCell, setEditCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editMode, setEditMode] = useState('prix'); // 'prix' or 'barre'
  const [saving, setSaving] = useState(false);
  const [printMode, setPrintMode] = useState(false);
  const inputRef = useRef(null);

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

  const filtered = tarifs.filter(t =>
    t.modele.toLowerCase().includes(search.toLowerCase())
  );

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

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(tarifs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'tarifs_reparation_klikphone.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    const headers = ['Modèle', ...COLUMNS.map(c => c.label), ...COLUMNS.map(c => c.label + ' (barré)')];
    const rows = tarifs.map(t => [
      t.modele,
      ...COLUMNS.map(c => t[c.key] ?? ''),
      ...COLUMNS.map(c => t[c.key + '_barre'] ?? ''),
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
    // Split into 2 pages if more than 18 rows
    const pageSize = 18;
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
          <span className="font-medium text-sm">Aperçu impression A4 paysage — {pages.length} page(s)</span>
          <button onClick={() => window.print()} className="ml-auto flex items-center gap-2 px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-sm font-bold">
            <Printer className="w-4 h-4" /> Imprimer
          </button>
        </div>

        {pages.map((pageRows, pageIdx) => (
          <div key={pageIdx} className="print-page" style={{ padding: '4mm 5mm', pageBreakAfter: pageIdx < pages.length - 1 ? 'always' : 'auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <img src="/logo_k.png" alt="Klikphone" style={{ width: 40, height: 40, objectFit: 'contain' }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 900, color: '#1e293b', letterSpacing: '-0.02em' }}>
                  KLIKPHONE — Grille Tarifs Réparation iPhone — 2025
                </div>
                <div style={{ fontSize: 7, color: '#94a3b8', marginTop: 1 }}>
                  Tarifs TTC — Main d'oeuvre incluse — Pièces garanties — Réparation express 30 min
                  {pages.length > 1 && ` — Page ${pageIdx + 1}/${pages.length}`}
                </div>
              </div>
            </div>

            {/* Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 8, lineHeight: 1.2 }}>
              <thead>
                <tr>
                  <th style={{ background: '#0f172a', color: '#fff', padding: '3px 5px', textAlign: 'left', fontWeight: 800, border: '1px solid #cbd5e1', fontSize: 7, whiteSpace: 'nowrap' }}>Modèle</th>
                  {COLUMNS.map((c, i) => {
                    const colors = ['#2563eb','#1d4ed8','#1e40af','#ca8a04','#16a34a','#e11d48','#4f46e5','#9333ea','#ea580c','#475569'];
                    return (
                      <th key={c.key} style={{ background: colors[i], color: '#fff', padding: '3px 2px', textAlign: 'center', fontWeight: 800, border: '1px solid #cbd5e1', fontSize: 6.5, whiteSpace: 'nowrap' }}>
                        {c.shortLabel}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((t, i) => (
                  <tr key={t.id} style={{ background: ROW_PRINT_COLORS[i % ROW_PRINT_COLORS.length] }}>
                    <td style={{ padding: '2px 5px', fontWeight: 800, fontSize: 7.5, color: '#0f172a', border: '1px solid #e2e8f0', whiteSpace: 'nowrap', background: '#fff' }}>
                      {t.modele}
                    </td>
                    {COLUMNS.map(c => {
                      const val = t[c.key];
                      const barre = t[c.key + '_barre'];
                      return (
                        <td key={c.key} style={{ padding: '1px 2px', textAlign: 'center', border: '1px solid #e2e8f0', verticalAlign: 'middle' }}>
                          {val != null ? (
                            <div>
                              {barre != null && barre > val && (
                                <div style={{ fontSize: 6, color: '#ef4444', textDecoration: 'line-through', lineHeight: 1 }}>{barre}€</div>
                              )}
                              <div style={{ fontSize: 9, fontWeight: 900, color: '#0f172a', lineHeight: 1.1 }}>{val}€</div>
                            </div>
                          ) : (
                            <span style={{ color: '#cbd5e1', fontSize: 8 }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 3, textAlign: 'center', fontSize: 6.5, color: '#94a3b8' }}>
              Tarifs TTC — Main d'oeuvre incluse — Pièces garanties — Réparation express 30 min — klikphone.com
            </div>
          </div>
        ))}

        <style>{`
          @media print {
            .no-print { display: none !important; }
            @page { size: A4 landscape; margin: 3mm; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .print-page { padding: 3mm 4mm !important; }
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
            <p className="text-xs text-slate-500">{tarifs.length} modèles</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
          {/* Toggle edit mode */}
          <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setEditMode('prix')}
              className={`px-3 py-2 text-xs font-medium transition-colors ${editMode === 'prix' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              Prix
            </button>
            <button
              onClick={() => setEditMode('barre')}
              className={`px-3 py-2 text-xs font-medium transition-colors ${editMode === 'barre' ? 'bg-red-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              Prix barrés
            </button>
          </div>
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
          <button onClick={exportJSON} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50" title="Export JSON">
            <FileJson className="w-4 h-4" /> JSON
          </button>
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50" title="Export CSV">
            <FileSpreadsheet className="w-4 h-4" /> CSV
          </button>
          <button onClick={() => setPrintMode(true)} className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white rounded-xl text-xs font-bold hover:bg-brand-700">
            <Printer className="w-4 h-4" /> Impression
          </button>
        </div>
      </div>

      {editMode === 'barre' && (
        <div className="mb-4 px-4 py-2 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          Mode édition <strong>prix barrés</strong> — Cliquez sur une cellule pour définir l'ancien prix (affiché barré au-dessus du prix actuel)
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[1100px]">
            <thead>
              <tr>
                <th className="bg-slate-900 text-white px-4 py-3 text-left text-xs font-bold sticky left-0 z-20 border-r border-slate-700 min-w-[180px]">
                  Modèle iPhone
                </th>
                {COLUMNS.map(c => (
                  <th key={c.key} className={`${c.headerBg} text-white px-3 py-3 text-center text-[11px] font-bold border-x border-white/20 whitespace-nowrap`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => (
                <tr key={t.id} className={`${ROW_COLORS[i % ROW_COLORS.length]} hover:bg-brand-50/40 transition-colors`}>
                  <td className="px-4 py-2.5 font-bold text-sm text-slate-900 border-r border-slate-200 bg-white sticky left-0 z-10 whitespace-nowrap">
                    {t.modele}
                  </td>
                  {COLUMNS.map(c => {
                    const editKey = editMode === 'barre' ? c.key + '_barre' : c.key;
                    const isEditing = editCell?.id === t.id && editCell?.key === editKey;
                    const val = t[c.key];
                    const barre = t[c.key + '_barre'];
                    const cellVal = editMode === 'barre' ? barre : val;

                    return (
                      <td
                        key={c.key}
                        className={`px-2 py-1.5 text-center border-x border-slate-100 transition-colors ${editMode === 'barre' ? 'cursor-pointer hover:bg-red-50' : 'cursor-pointer'}`}
                        onClick={() => !isEditing && startEdit(t.id, editKey, cellVal)}
                      >
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            type="text"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onBlur={saveEdit}
                            className={`w-16 px-1.5 py-0.5 text-center text-sm font-bold border-2 rounded-lg outline-none ${editMode === 'barre' ? 'border-red-500 bg-red-50' : 'border-brand-500 bg-brand-50'}`}
                          />
                        ) : (
                          <PriceCell
                            val={val}
                            barre={barre}
                            onClick={() => startEdit(t.id, editKey, cellVal)}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="text-center py-12 text-slate-400 text-sm">
                    Aucun modèle trouvé pour "{search}"
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 mt-3 text-center">
        {editMode === 'prix'
          ? 'Cliquez sur un prix pour le modifier. Entrée = sauvegarder, Escape = annuler.'
          : 'Mode prix barrés : cliquez sur une cellule pour définir l\'ancien prix affiché barré.'}
      </p>
    </div>
  );
}
