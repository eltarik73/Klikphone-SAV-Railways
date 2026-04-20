import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Smartphone, Save, FileDown, Archive, ArrowLeft, Loader2, Check, X,
} from 'lucide-react';
import api from '../lib/api';

const API_URL = import.meta.env.VITE_API_URL || '';

// Construit une URL de téléchargement PDF avec le token JWT en query
// (utilisé en _blank pour laisser le navigateur ouvrir l'onglet)
function pdfUrl(path) {
  const token = localStorage.getItem('kp_token');
  const url = `${API_URL}${path}`;
  // On passe le token dans un header via fetch blob pour sécurité
  return { url, token };
}

async function downloadPdf(path, filename) {
  const token = localStorage.getItem('kp_token');
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  const blob = await res.blob();
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
  const token = localStorage.getItem('kp_token');
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function useBasePath() {
  const location = useLocation();
  return location.pathname.startsWith('/tech') ? '/tech' : '/accueil';
}

export default function AdminTarifsIphonePage() {
  const basePath = useBasePath();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [dirty, setDirty] = useState({}); // { id: true }
  const [toast, setToast] = useState(null);
  const [selected, setSelected] = useState(new Set()); // Set<slug>

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get('/api/iphone-tarifs');
      setRows(data || []);
    } catch (e) {
      setToast({ type: 'error', msg: `Erreur chargement : ${e.message}` });
    } finally {
      setLoading(false);
    }
  }

  function updateRow(id, field, value) {
    setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
    setDirty(d => ({ ...d, [id]: true }));
  }

  async function saveRow(row) {
    setSavingId(row.id);
    try {
      const payload = {
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
      };
      await api.patch(`/api/iphone-tarifs/${row.id}`, payload);
      setDirty(d => { const n = { ...d }; delete n[row.id]; return n; });
      setToast({ type: 'success', msg: `${row.modele} sauvegardé` });
      setTimeout(() => setToast(null), 2500);
    } catch (e) {
      setToast({ type: 'error', msg: `Erreur : ${e.message}` });
    } finally {
      setSavingId(null);
    }
  }

  async function handlePdfOne(row) {
    try {
      await openPdfInNewTab(`/api/iphone-tarifs/pdf?slugs=${row.slug}`);
    } catch (e) {
      setToast({ type: 'error', msg: `PDF : ${e.message}` });
    }
  }

  function toggleSelect(slug) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else {
        if (next.size >= 2) {
          setToast({ type: 'error', msg: 'Maximum 2 modèles par PDF (1 page A4)' });
          setTimeout(() => setToast(null), 2500);
          return prev;
        }
        next.add(slug);
      }
      return next;
    });
  }

  async function handlePdfSelection() {
    if (selected.size === 0) return;
    // Ordre par ordre de la table (pas ordre de sélection)
    const slugs = rows.filter(r => selected.has(r.slug)).map(r => r.slug).join(',');
    try {
      await openPdfInNewTab(`/api/iphone-tarifs/pdf?slugs=${slugs}`);
      setToast({ type: 'success', msg: 'PDF ouvert' });
      setTimeout(() => setToast(null), 2000);
    } catch (e) {
      setToast({ type: 'error', msg: `PDF : ${e.message}` });
    }
  }

  async function handlePdfAll() {
    try {
      await downloadPdf('/api/iphone-tarifs/pdf/all-zip', 'klikphone_tarifs_iphones.zip');
      setToast({ type: 'success', msg: 'ZIP téléchargé' });
      setTimeout(() => setToast(null), 2500);
    } catch (e) {
      setToast({ type: 'error', msg: `ZIP : ${e.message}` });
    }
  }

  async function handlePdfFull() {
    try {
      await openPdfInNewTab('/api/iphone-tarifs/pdf');
    } catch (e) {
      setToast({ type: 'error', msg: `PDF : ${e.message}` });
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

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-slate-900/90 backdrop-blur border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to={basePath} className="p-2 rounded-lg hover:bg-slate-800 transition">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-500/20 border border-brand-500/30 flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-brand-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Tarifs iPhones reconditionnés</h1>
                <p className="text-xs text-slate-400">Affiches imprimables pour la boutique</p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handlePdfFull}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center gap-2 text-sm"
            >
              <FileDown className="w-4 h-4" />
              PDF complet
            </button>
            <button
              onClick={handlePdfAll}
              className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white flex items-center gap-2 text-sm font-semibold"
            >
              <Archive className="w-4 h-4" />
              Tout télécharger (ZIP)
            </button>
          </div>
        </div>
      </header>

      {toast && (
        <div className={`fixed top-20 right-6 z-50 px-4 py-3 rounded-lg shadow-xl border ${
          toast.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-red-500/10 border-red-500/30 text-red-300'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Barre flottante de sélection */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-brand-500 text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 border border-brand-400">
          <span className="text-sm font-semibold">
            {selected.size} modèle{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
          </span>
          <button
            onClick={handlePdfSelection}
            className="px-4 py-1.5 rounded-lg bg-white text-brand-600 font-semibold text-sm flex items-center gap-2 hover:bg-brand-50"
          >
            <FileDown className="w-4 h-4" />
            Générer PDF
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="p-1.5 rounded-lg hover:bg-brand-600"
            title="Annuler la sélection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Contenu */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mr-3" />
            Chargement des tarifs…
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-400 mb-6">
              Modifiez les prix et valeurs DAS directement dans le tableau, cliquez sur{' '}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-brand-500/20 text-brand-300">
                <Save className="w-3 h-3" />
                Enregistrer
              </span>{' '}
              pour sauvegarder, puis générez le PDF pour impression.
            </p>

            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
              <table className="w-full text-sm">
                <thead className="bg-slate-800/50 text-slate-300 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-3 text-center w-10">Sél.</th>
                    <th className="px-3 py-3 text-left">Modèle</th>
                    <th className="px-3 py-3 text-left w-40">Condition</th>
                    <th className="px-3 py-3 text-left w-24">Stockage 1</th>
                    <th className="px-3 py-3 text-left w-20">Prix 1 (€)</th>
                    <th className="px-3 py-3 text-left w-16">Stock 1</th>
                    <th className="px-3 py-3 text-left w-24">Stockage 2</th>
                    <th className="px-3 py-3 text-left w-20">Prix 2 (€)</th>
                    <th className="px-3 py-3 text-left w-16">Stock 2</th>
                    <th className="px-3 py-3 text-left w-20">DAS Tête</th>
                    <th className="px-3 py-3 text-left w-20">DAS Corps</th>
                    <th className="px-3 py-3 text-left w-20">DAS Membre</th>
                    <th className="px-3 py-3 text-right w-48">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isDirty = !!dirty[r.id];
                    const isSaving = savingId === r.id;
                    return (
                      <tr
                        key={r.id}
                        className={`border-t border-slate-800 hover:bg-slate-800/30 transition ${
                          isDirty ? 'bg-brand-500/5' : selected.has(r.slug) ? 'bg-brand-500/10' : ''
                        }`}
                      >
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={selected.has(r.slug)}
                            onChange={() => toggleSelect(r.slug)}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-800 accent-brand-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={r.modele || ''}
                              onChange={(e) => updateRow(r.id, 'modele', e.target.value)}
                              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-44 text-white font-semibold"
                            />
                          </div>
                        </td>
                        <Cell>
                          <select
                            value={r.condition || 'Reconditionné Premium'}
                            onChange={(e) => updateRow(r.id, 'condition', e.target.value)}
                            className={`input-cell w-36 font-semibold ${
                              r.condition === 'Neuf'
                                ? 'text-emerald-300 border-emerald-700/50'
                                : 'text-blue-300 border-blue-700/50'
                            }`}
                          >
                            <option value="Neuf">Neuf</option>
                            <option value="Reconditionné Premium">Recond. Premium</option>
                          </select>
                        </Cell>
                        <Cell>
                          <input
                            type="text"
                            value={r.stockage_1 || ''}
                            onChange={(e) => updateRow(r.id, 'stockage_1', e.target.value)}
                            className="input-cell w-20"
                          />
                        </Cell>
                        <Cell>
                          <input
                            type="number"
                            value={r.prix_1 || ''}
                            onChange={(e) => updateRow(r.id, 'prix_1', e.target.value)}
                            className="input-cell w-16 font-semibold text-brand-300"
                          />
                        </Cell>
                        <Cell>
                          <input
                            type="number"
                            value={r.stock_1 ?? 0}
                            onChange={(e) => updateRow(r.id, 'stock_1', e.target.value)}
                            className="input-cell w-12 text-center font-semibold"
                          />
                        </Cell>
                        <Cell>
                          <input
                            type="text"
                            value={r.stockage_2 || ''}
                            onChange={(e) => updateRow(r.id, 'stockage_2', e.target.value)}
                            className="input-cell w-20"
                          />
                        </Cell>
                        <Cell>
                          <input
                            type="number"
                            value={r.prix_2 || ''}
                            onChange={(e) => updateRow(r.id, 'prix_2', e.target.value)}
                            className="input-cell w-16 font-semibold text-brand-300"
                          />
                        </Cell>
                        <Cell>
                          <input
                            type="number"
                            value={r.stock_2 ?? 0}
                            onChange={(e) => updateRow(r.id, 'stock_2', e.target.value)}
                            className="input-cell w-12 text-center font-semibold"
                          />
                        </Cell>
                        <Cell>
                          <input
                            type="text"
                            value={r.das_tete || ''}
                            onChange={(e) => updateRow(r.id, 'das_tete', e.target.value)}
                            className="input-cell w-14"
                          />
                        </Cell>
                        <Cell>
                          <input
                            type="text"
                            value={r.das_corps || ''}
                            onChange={(e) => updateRow(r.id, 'das_corps', e.target.value)}
                            className="input-cell w-14"
                          />
                        </Cell>
                        <Cell>
                          <input
                            type="text"
                            value={r.das_membre || ''}
                            onChange={(e) => updateRow(r.id, 'das_membre', e.target.value)}
                            className="input-cell w-14"
                          />
                        </Cell>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            {isDirty && (
                              <button
                                onClick={() => saveRow(r)}
                                disabled={isSaving}
                                className="px-3 py-1.5 rounded bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold flex items-center gap-1 disabled:opacity-50"
                              >
                                {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                Enregistrer
                              </button>
                            )}
                            <button
                              onClick={() => handlePdfOne(r)}
                              disabled={isDirty}
                              title={isDirty ? 'Enregistrez d\'abord' : 'Voir le PDF'}
                              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-xs flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
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
              <h2 className="text-sm font-semibold text-slate-300 mb-3">
                PDFs groupés (2 modèles par page, format original boutique)
              </h2>
              <div className="flex flex-wrap gap-2">
                {Object.entries(groups)
                  .filter(([, items]) => items.length > 0)
                  .map(([key, items]) => (
                    <button
                      key={key}
                      onClick={() => openPdfInNewTab(`/api/iphone-tarifs/pdf?group=${encodeURIComponent(key)}`)}
                      className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs flex items-center gap-2"
                    >
                      <FileDown className="w-3 h-3" />
                      {items.map(i => i.modele).join(' + ')}
                    </button>
                  ))}
              </div>
            </div>
          </>
        )}
      </main>

      <style>{`
        .input-cell {
          background: rgb(30 41 59);
          border: 1px solid rgb(51 65 85);
          border-radius: 4px;
          padding: 4px 8px;
          color: white;
          font-size: 13px;
          transition: border-color 0.15s;
        }
        .input-cell:focus {
          outline: none;
          border-color: rgb(139 92 246);
        }
      `}</style>
    </div>
  );
}

function Cell({ children }) {
  return <td className="px-3 py-2">{children}</td>;
}
