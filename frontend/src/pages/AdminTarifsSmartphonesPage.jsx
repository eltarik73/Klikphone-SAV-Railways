import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Smartphone, Save, Plus, ArrowLeft, Loader2, Check, X, Trash2,
  Sparkles, Image as ImageIcon,
} from 'lucide-react';
import api from '../lib/api';

function useBasePath() {
  const location = useLocation();
  return location.pathname.startsWith('/tech') ? '/tech' : '/accueil';
}

const EMPTY_ROW = {
  slug: '', marque: '', modele: '',
  stockage_1: '128 Go', prix_1: 0, stock_1: 0,
  stockage_2: '', prix_2: null, stock_2: 0,
  stockage_3: '', prix_3: null, stock_3: 0,
  condition: 'Reconditionné Premium',
  image_url: '',
};

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function AdminTarifsSmartphonesPage() {
  const basePath = useBasePath();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [dirty, setDirty] = useState({});
  const [toast, setToast] = useState(null);
  const [generatingId, setGeneratingId] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newRow, setNewRow] = useState({ ...EMPTY_ROW });
  const [imagePicker, setImagePicker] = useState(null); // { row, candidates: [urls] }

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await api.getSmartphonesTarifs(false);
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
      await api.updateSmartphoneTarif(row.id, {
        marque: row.marque,
        modele: row.modele,
        stockage_1: row.stockage_1,
        prix_1: row.prix_1 ? Number(row.prix_1) : null,
        stock_1: row.stock_1 != null ? Number(row.stock_1) : 0,
        stockage_2: row.stockage_2 || null,
        prix_2: row.prix_2 ? Number(row.prix_2) : null,
        stock_2: row.stock_2 != null ? Number(row.stock_2) : 0,
        stockage_3: row.stockage_3 || null,
        prix_3: row.prix_3 ? Number(row.prix_3) : null,
        stock_3: row.stock_3 != null ? Number(row.stock_3) : 0,
        condition: row.condition,
        image_url: row.image_url || null,
      });
      setDirty(d => { const c = { ...d }; delete c[row.id]; return c; });
      setToast({ type: 'success', msg: `${row.marque} ${row.modele} enregistré ✓` });
      setTimeout(() => setToast(null), 2500);
    } catch (e) {
      setToast({ type: 'error', msg: `Erreur : ${e.message}` });
    } finally {
      setSavingId(null);
    }
  }

  async function saveAll() {
    const rowsToSave = rows.filter(r => dirty[r.id]);
    for (const r of rowsToSave) await saveRow(r);
  }

  async function createNew() {
    if (!newRow.marque || !newRow.modele) {
      setToast({ type: 'error', msg: 'Marque et modèle obligatoires' });
      return;
    }
    const slug = newRow.slug || slugify(`${newRow.marque} ${newRow.modele}`);
    try {
      await api.createSmartphoneTarif({ ...newRow, slug });
      setToast({ type: 'success', msg: `${newRow.marque} ${newRow.modele} ajouté ✓` });
      setShowNewForm(false);
      setNewRow({ ...EMPTY_ROW });
      await load();
    } catch (e) {
      setToast({ type: 'error', msg: `Erreur : ${e.message}` });
    }
  }

  async function removeRow(row) {
    if (!confirm(`Supprimer ${row.marque} ${row.modele} ?`)) return;
    try {
      await api.deleteSmartphoneTarif(row.id);
      await load();
    } catch (e) {
      setToast({ type: 'error', msg: `Erreur : ${e.message}` });
    }
  }

  async function generateImage(row) {
    setGeneratingId(row.id);
    try {
      const res = await api.generateSmartphoneImage(row.marque, row.modele, row.stockage_1);
      // Propose les alternatives : l'admin choisit la meilleure
      setImagePicker({ row, candidates: [res.image_url, ...(res.alternatives || [])] });
    } catch (e) {
      setToast({ type: 'error', msg: `Erreur recherche image : ${e.message}` });
    } finally {
      setGeneratingId(null);
    }
  }

  async function chooseImage(row, url) {
    try {
      await api.updateSmartphoneTarif(row.id, { image_url: url });
      await load();
      setImagePicker(null);
      setToast({ type: 'success', msg: 'Image enregistrée ✓' });
      setTimeout(() => setToast(null), 2500);
    } catch (e) {
      setToast({ type: 'error', msg: `Erreur : ${e.message}` });
    }
  }

  const dirtyCount = Object.keys(dirty).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-zinc-900 to-slate-900 text-white">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link
              to={basePath}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-all"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-black flex items-center gap-2">
                <Smartphone className="w-6 h-6 text-brand-400" />
                Tarifs Smartphones
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Samsung, Xiaomi, Google Pixel, Honor — gérez tous vos smartphones non-Apple
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNewForm(s => !s)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm shadow-lg"
            >
              <Plus className="w-4 h-4" /> Ajouter
            </button>
            {dirtyCount > 0 && (
              <button
                onClick={saveAll}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm shadow-lg"
              >
                <Save className="w-4 h-4" />
                Enregistrer ({dirtyCount})
              </button>
            )}
          </div>
        </div>

        {/* Nouveau form inline */}
        {showNewForm && (
          <div className="mb-6 bg-slate-800/70 border border-brand-500/30 rounded-xl p-5">
            <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-brand-400" /> Nouveau smartphone
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Marque" value={newRow.marque}
                onChange={v => setNewRow({ ...newRow, marque: v })}
                placeholder="Samsung" />
              <Field label="Modèle" value={newRow.modele}
                onChange={v => setNewRow({ ...newRow, modele: v })}
                placeholder="Galaxy A17" />
              <SelectField label="Condition" value={newRow.condition}
                onChange={v => setNewRow({ ...newRow, condition: v })}
                options={['Neuf', 'Reconditionné Premium']} />
              <Field label="Slug (auto si vide)" value={newRow.slug}
                onChange={v => setNewRow({ ...newRow, slug: v })}
                placeholder="samsung-galaxy-a17" />
              <Field label="Stockage 1" value={newRow.stockage_1}
                onChange={v => setNewRow({ ...newRow, stockage_1: v })} />
              <Field label="Prix 1 (€)" type="number" value={newRow.prix_1}
                onChange={v => setNewRow({ ...newRow, prix_1: v })} />
              <Field label="Stockage 2" value={newRow.stockage_2}
                onChange={v => setNewRow({ ...newRow, stockage_2: v })} />
              <Field label="Prix 2 (€)" type="number" value={newRow.prix_2 ?? ''}
                onChange={v => setNewRow({ ...newRow, prix_2: v })} />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowNewForm(false)}
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/15 text-sm"
              >
                Annuler
              </button>
              <button
                onClick={createNew}
                className="px-5 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-sm font-bold"
              >
                Créer
              </button>
            </div>
          </div>
        )}

        {/* Tableau */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-20 text-slate-400 text-sm">
              Aucun smartphone. Cliquez sur "Ajouter" pour commencer.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-800/50 text-slate-300 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-3 text-left w-20">Photo</th>
                    <th className="px-3 py-3 text-left w-28">Marque</th>
                    <th className="px-3 py-3 text-left">Modèle</th>
                    <th className="px-3 py-3 text-left w-40">Condition</th>
                    <th className="px-3 py-3 text-left w-24">Stockage 1</th>
                    <th className="px-3 py-3 text-left w-20">Prix 1 (€)</th>
                    <th className="px-3 py-3 text-left w-16">Stock 1</th>
                    <th className="px-3 py-3 text-left w-24">Stockage 2</th>
                    <th className="px-3 py-3 text-left w-20">Prix 2 (€)</th>
                    <th className="px-3 py-3 text-left w-16">Stock 2</th>
                    <th className="px-3 py-3 text-right w-40">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr
                      key={r.id}
                      className={`border-t border-slate-800 ${
                        dirty[r.id] ? 'bg-brand-500/10' : idx % 2 === 0 ? '' : 'bg-slate-900/30'
                      }`}
                    >
                      <Cell>
                        {r.image_url ? (
                          <img src={r.image_url} alt=""
                            className="w-12 h-12 rounded-lg object-contain bg-slate-800/50" />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-slate-800/50 flex items-center justify-center text-slate-600">
                            <ImageIcon className="w-5 h-5" />
                          </div>
                        )}
                      </Cell>
                      <Cell>
                        <input type="text" value={r.marque || ''}
                          onChange={(e) => updateRow(r.id, 'marque', e.target.value)}
                          className="input-cell w-24 font-semibold" />
                      </Cell>
                      <Cell>
                        <input type="text" value={r.modele || ''}
                          onChange={(e) => updateRow(r.id, 'modele', e.target.value)}
                          className="input-cell w-full font-semibold text-white" />
                      </Cell>
                      <Cell>
                        <select value={r.condition || 'Reconditionné Premium'}
                          onChange={(e) => updateRow(r.id, 'condition', e.target.value)}
                          className={`input-cell w-36 font-semibold ${
                            r.condition === 'Neuf'
                              ? 'text-emerald-300 border-emerald-700/50'
                              : 'text-blue-300 border-blue-700/50'
                          }`}>
                          <option value="Neuf">Neuf</option>
                          <option value="Reconditionné Premium">Recond. Premium</option>
                        </select>
                      </Cell>
                      <Cell>
                        <input type="text" value={r.stockage_1 || ''}
                          onChange={(e) => updateRow(r.id, 'stockage_1', e.target.value)}
                          className="input-cell w-20" />
                      </Cell>
                      <Cell>
                        <input type="number" value={r.prix_1 || ''}
                          onChange={(e) => updateRow(r.id, 'prix_1', e.target.value)}
                          className="input-cell w-16 font-semibold text-brand-300" />
                      </Cell>
                      <Cell>
                        <input type="number" value={r.stock_1 ?? 0}
                          onChange={(e) => updateRow(r.id, 'stock_1', e.target.value)}
                          className="input-cell w-12 text-center font-semibold" />
                      </Cell>
                      <Cell>
                        <input type="text" value={r.stockage_2 || ''}
                          onChange={(e) => updateRow(r.id, 'stockage_2', e.target.value)}
                          className="input-cell w-20" />
                      </Cell>
                      <Cell>
                        <input type="number" value={r.prix_2 || ''}
                          onChange={(e) => updateRow(r.id, 'prix_2', e.target.value)}
                          className="input-cell w-16 font-semibold text-brand-300" />
                      </Cell>
                      <Cell>
                        <input type="number" value={r.stock_2 ?? 0}
                          onChange={(e) => updateRow(r.id, 'stock_2', e.target.value)}
                          className="input-cell w-12 text-center font-semibold" />
                      </Cell>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => generateImage(r)}
                            disabled={generatingId === r.id}
                            title="Générer image IA"
                            className="p-1.5 rounded-md bg-purple-500/20 hover:bg-purple-500/40 text-purple-300 transition-all disabled:opacity-50"
                          >
                            {generatingId === r.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Sparkles className="w-4 h-4" />
                            )}
                          </button>
                          {dirty[r.id] && (
                            <button
                              onClick={() => saveRow(r)}
                              disabled={savingId === r.id}
                              title="Enregistrer"
                              className="p-1.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-300 transition-all"
                            >
                              {savingId === r.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Save className="w-4 h-4" />
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => removeRow(r)}
                            title="Supprimer"
                            className="p-1.5 rounded-md bg-red-500/20 hover:bg-red-500/40 text-red-300 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Toast */}
        {/* Modal choix image */}
        {imagePicker && (
          <div
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setImagePicker(null)}
          >
            <div
              className="bg-slate-900 rounded-2xl border border-white/10 max-w-3xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-white/10">
                <h3 className="font-bold text-lg">
                  Choisir la photo — {imagePicker.row.marque} {imagePicker.row.modele}
                </h3>
                <button onClick={() => setImagePicker(null)}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/20">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="px-4 pt-3 text-sm text-slate-400">
                Clique sur l'image qui correspond le mieux au produit. Photos trouvées via DuckDuckGo Images.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-4">
                {imagePicker.candidates.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => chooseImage(imagePicker.row, url)}
                    className="group relative bg-white rounded-xl overflow-hidden p-3 aspect-square flex items-center justify-center hover:ring-2 hover:ring-brand-500 transition-all"
                  >
                    <img src={url} alt="" referrerPolicy="no-referrer"
                      className="max-w-full max-h-full object-contain"
                      onError={(e) => { e.target.style.opacity = '0.3'; }}
                    />
                    <div className="absolute bottom-1 right-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
                      {i + 1}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div
            className={`fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold flex items-center gap-2 ${
              toast.type === 'error'
                ? 'bg-red-500 text-white'
                : 'bg-emerald-500 text-white'
            }`}
          >
            {toast.type === 'error' ? (
              <X className="w-4 h-4" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {toast.msg}
          </div>
        )}
      </div>

      <style>{`
        .input-cell {
          background: rgb(30 41 59 / 0.5);
          border: 1px solid rgb(51 65 85);
          border-radius: 0.375rem;
          padding: 0.375rem 0.5rem;
          color: white;
        }
        .input-cell:focus {
          outline: none;
          border-color: rgb(248 116 28);
        }
      `}</style>
    </div>
  );
}

function Cell({ children }) {
  return <td className="px-3 py-2 align-top">{children}</td>;
}

function Field({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <label className="block">
      <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
        {label}
      </span>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-brand-500"
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
