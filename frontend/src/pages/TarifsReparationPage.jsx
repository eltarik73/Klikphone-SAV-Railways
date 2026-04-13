import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Download, Printer, FileJson, FileSpreadsheet, X } from 'lucide-react';
import api from '../lib/api';

const COLUMNS = [
  { key: 'ecran_generique', label: 'Écran Générique', color: 'bg-blue-50 text-blue-800', headerBg: 'bg-blue-600' },
  { key: 'ecran_confort', label: 'Écran Confort', color: 'bg-blue-50 text-blue-800', headerBg: 'bg-blue-700' },
  { key: 'ecran_apple', label: 'Écran Apple', color: 'bg-blue-50 text-blue-800', headerBg: 'bg-blue-800' },
  { key: 'batterie', label: 'Batterie', color: 'bg-yellow-50 text-yellow-800', headerBg: 'bg-yellow-600' },
  { key: 'desoxydation', label: 'Désoxydation', color: 'bg-green-50 text-green-800', headerBg: 'bg-green-600' },
  { key: 'connecteur_charge', label: 'Connecteur', color: 'bg-rose-50 text-rose-800', headerBg: 'bg-rose-600' },
  { key: 'reparation_divers', label: 'Réparation', color: 'bg-indigo-50 text-indigo-800', headerBg: 'bg-indigo-600' },
  { key: 'ecouteur_apn', label: 'Écouteur/APN', color: 'bg-purple-50 text-purple-800', headerBg: 'bg-purple-600' },
  { key: 'vitre_arriere', label: 'Vitre Arrière', color: 'bg-orange-50 text-orange-800', headerBg: 'bg-orange-600' },
  { key: 'chassis', label: 'Châssis', color: 'bg-slate-100 text-slate-800', headerBg: 'bg-slate-700' },
];

const ROW_COLORS = [
  'bg-blue-50/60', '', 'bg-yellow-50/60', '', 'bg-green-50/60', '',
  'bg-rose-50/60', '', 'bg-indigo-50/60', '', 'bg-purple-50/60', '',
  'bg-orange-50/50', '', 'bg-slate-50/60', '',
];

export default function TarifsReparationPage() {
  const [tarifs, setTarifs] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editCell, setEditCell] = useState(null); // { id, key }
  const [editValue, setEditValue] = useState('');
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

  useEffect(() => {
    if (editCell && inputRef.current) inputRef.current.focus();
  }, [editCell]);

  const filtered = tarifs.filter(t =>
    t.modele.toLowerCase().includes(search.toLowerCase())
  );

  const startEdit = (id, key, val) => {
    setEditCell({ id, key });
    setEditValue(val !== null && val !== undefined ? String(val) : '');
  };

  const cancelEdit = () => {
    setEditCell(null);
    setEditValue('');
  };

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
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tarifs_reparation_klikphone.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    const headers = ['Modèle', ...COLUMNS.map(c => c.label)];
    const rows = tarifs.map(t => [
      t.modele,
      ...COLUMNS.map(c => t[c.key] !== null && t[c.key] !== undefined ? t[c.key] : ''),
    ]);
    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tarifs_reparation_klikphone.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-96">
      <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
    </div>
  );

  // ── Print preview ──
  if (printMode) return (
    <div className="min-h-screen bg-white">
      {/* No-print toolbar */}
      <div className="no-print sticky top-0 z-50 bg-slate-900 text-white flex items-center gap-3 px-4 py-2">
        <button onClick={() => setPrintMode(false)} className="p-1.5 rounded-lg hover:bg-white/10">
          <X className="w-5 h-5" />
        </button>
        <span className="font-medium text-sm">Aperçu impression A4 paysage</span>
        <button onClick={() => window.print()} className="ml-auto flex items-center gap-2 px-4 py-1.5 bg-brand-600 hover:bg-brand-700 rounded-lg text-sm font-bold">
          <Printer className="w-4 h-4" /> Imprimer
        </button>
      </div>

      <div className="print-page p-4">
        {/* Header */}
        <div className="flex items-center gap-4 mb-3">
          <img src="/logo_k.png" alt="Klikphone" className="w-14 h-14 object-contain" />
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">
              KLIKPHONE — Grille Tarifs Réparation iPhone — 2025
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">Tarifs TTC — Main d'oeuvre incluse — Pièces garanties — Réparation express 30 min</p>
          </div>
        </div>

        {/* Table */}
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <th className="bg-slate-900 text-white px-2 py-1.5 text-left font-bold border border-slate-300 sticky left-0 z-10">Modèle</th>
              {COLUMNS.map(c => (
                <th key={c.key} className={`${c.headerBg} text-white px-1.5 py-1.5 text-center font-bold border border-slate-300 whitespace-nowrap`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tarifs.map((t, i) => (
              <tr key={t.id} className={ROW_COLORS[i % ROW_COLORS.length]}>
                <td className="px-2 py-1 font-bold text-slate-900 border border-slate-300 whitespace-nowrap bg-white sticky left-0 z-10">
                  {t.modele}
                </td>
                {COLUMNS.map(c => (
                  <td key={c.key} className="px-1.5 py-1 text-center font-black text-slate-900 border border-slate-300">
                    {t[c.key] != null ? `${t[c.key]}€` : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 text-center text-[9px] text-slate-400">
          Tarifs TTC — Main d'oeuvre incluse — Pièces garanties — Réparation express 30 min
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4 landscape; margin: 5mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-page { padding: 0 !important; }
        }
      `}</style>
    </div>
  );

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
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher un modèle..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm w-56 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
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
                    const isEditing = editCell?.id === t.id && editCell?.key === c.key;
                    const val = t[c.key];
                    return (
                      <td
                        key={c.key}
                        className={`px-2 py-2 text-center border-x border-slate-100 cursor-pointer transition-colors ${val == null ? 'text-slate-300' : 'font-black text-slate-900'}`}
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
                        ) : (
                          <span className="text-sm">
                            {val != null ? `${val}€` : '—'}
                          </span>
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
        Cliquez sur un prix pour le modifier. Entrée = sauvegarder, Escape = annuler.
      </p>
    </div>
  );
}
