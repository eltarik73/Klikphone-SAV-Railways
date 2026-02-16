import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import {
  Zap, Search, Wrench, Smartphone, Package, Plus, Edit3, Trash2,
  X, Loader2, Filter, ChevronDown, Eye, EyeOff, Maximize2, Minimize2,
  Tag, Euro, Battery, Monitor as MonitorIcon,
} from 'lucide-react';

const fp = (v) => {
  if (v == null) return '0,00';
  return Number(v).toFixed(2).replace('.', ',');
};

const BRAND_COLORS = {
  Apple: '#18181b', Samsung: '#2563eb', Xiaomi: '#ea580c', Huawei: '#dc2626',
  Honor: '#6d28d9', Google: '#16a34a', Oppo: '#059669', OnePlus: '#dc2626',
  Motorola: '#0891b2', Nothing: '#18181b',
};

export default function DevisFlashPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('reparations');
  const [kioskMode, setKioskMode] = useState(false);

  // ─── Réparations tab ─────
  const [repQuery, setRepQuery] = useState('');
  const [repResults, setRepResults] = useState([]);
  const [repLoading, setRepLoading] = useState(false);
  const repTimer = useRef(null);

  // ─── Téléphones tab ──────
  const [telList, setTelList] = useState([]);
  const [telLoading, setTelLoading] = useState(false);
  const [telSearch, setTelSearch] = useState('');
  const [telMarque, setTelMarque] = useState('');
  const [telEtat, setTelEtat] = useState('');
  const [telMarques, setTelMarques] = useState([]);
  const [telStats, setTelStats] = useState(null);
  const [showTelForm, setShowTelForm] = useState(false);
  const [editTelId, setEditTelId] = useState(null);
  const [telForm, setTelForm] = useState(getEmptyTelForm());
  const [telSaving, setTelSaving] = useState(false);

  function getEmptyTelForm() {
    return { marque: '', modele: '', capacite: '', couleur: '', etat: 'Occasion', prix_achat: 0, prix_vente: 0, imei: '', notes: '' };
  }

  // Réparations search
  const searchReparations = async (q) => {
    if (!q || q.length < 2) { setRepResults([]); return; }
    setRepLoading(true);
    try {
      const res = await api.devisFlashSearch(q);
      setRepResults(res || []);
    } catch { setRepResults([]); }
    setRepLoading(false);
  };

  useEffect(() => {
    clearTimeout(repTimer.current);
    repTimer.current = setTimeout(() => searchReparations(repQuery), 300);
    return () => clearTimeout(repTimer.current);
  }, [repQuery]);

  // Téléphones load
  const loadTelephones = async () => {
    setTelLoading(true);
    try {
      const params = {};
      if (telSearch) params.search = telSearch;
      if (telMarque) params.marque = telMarque;
      if (telEtat) params.etat = telEtat;
      const [list, st, marques] = await Promise.all([
        api.getTelephonesVente(params),
        api.getTelephonesVenteStats(),
        api.getTelephonesVenteMarques(),
      ]);
      setTelList(list || []);
      setTelStats(st);
      setTelMarques(marques || []);
    } catch { /* ignore */ }
    setTelLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'telephones') loadTelephones();
  }, [activeTab, telSearch, telMarque, telEtat]);

  const handleSaveTel = async () => {
    if (!telForm.marque || !telForm.modele) return;
    setTelSaving(true);
    try {
      if (editTelId) {
        await api.updateTelephoneVente(editTelId, telForm);
      } else {
        await api.createTelephoneVente(telForm);
      }
      setShowTelForm(false);
      setEditTelId(null);
      loadTelephones();
    } catch { /* ignore */ }
    setTelSaving(false);
  };

  const handleDeleteTel = async (id) => {
    if (!confirm('Supprimer ce téléphone ?')) return;
    try { await api.deleteTelephoneVente(id); loadTelephones(); } catch { /* ignore */ }
  };

  const handleToggleStock = async (id, currentStock) => {
    try { await api.updateTelephoneVente(id, { en_stock: !currentStock }); loadTelephones(); } catch { /* ignore */ }
  };

  const openEditTel = (t) => {
    setEditTelId(t.id);
    setTelForm({
      marque: t.marque || '', modele: t.modele || '', capacite: t.capacite || '',
      couleur: t.couleur || '', etat: t.etat || 'Occasion',
      prix_achat: Number(t.prix_achat) || 0, prix_vente: Number(t.prix_vente) || 0,
      imei: t.imei || '', notes: t.notes || '',
    });
    setShowTelForm(true);
  };

  const toggleKiosk = () => {
    if (!kioskMode) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setKioskMode(!kioskMode);
  };

  return (
    <div className={`${kioskMode ? 'fixed inset-0 z-[100] bg-white overflow-auto' : ''} p-4 sm:p-6 lg:p-8 max-w-7xl`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-500" /> Devis Flash
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Consultation rapide des prix</p>
        </div>
        <button onClick={toggleKiosk} className="btn-secondary text-xs">
          {kioskMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          {kioskMode ? 'Quitter kiosque' : 'Mode kiosque'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6">
        <button onClick={() => setActiveTab('reparations')}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-all
            ${activeTab === 'reparations' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>
          <Wrench className="w-4 h-4" /> Réparations
        </button>
        <button onClick={() => setActiveTab('telephones')}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-all
            ${activeTab === 'telephones' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>
          <Smartphone className="w-4 h-4" /> Téléphones en vente
        </button>
      </div>

      {/* ═══ RÉPARATIONS TAB ═══ */}
      {activeTab === 'reparations' && (
        <div>
          <div className="relative mb-6">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input value={repQuery} onChange={e => setRepQuery(e.target.value)}
              placeholder="Rechercher un modèle, une marque, un type de pièce..."
              className="w-full h-14 pl-12 pr-4 rounded-2xl border-2 border-slate-200 focus:border-amber-400 focus:ring-4 focus:ring-amber-100 text-lg outline-none transition-all"
              autoFocus />
            {repLoading && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 animate-spin text-amber-500" />}
          </div>

          {repQuery.length < 2 ? (
            <div className="text-center py-16">
              <Wrench className="w-16 h-16 text-slate-200 mx-auto mb-4" />
              <p className="text-slate-400 text-lg">Tapez au moins 2 caractères pour rechercher</p>
              <p className="text-sm text-slate-300 mt-1">Recherchez par modèle (iPhone 15), marque (Samsung) ou pièce (écran, batterie...)</p>
            </div>
          ) : repResults.length === 0 && !repLoading ? (
            <div className="text-center py-16">
              <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">Aucun résultat pour "{repQuery}"</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {repResults.map(r => (
                <div key={r.id} className="card p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: (BRAND_COLORS[r.marque] || '#6d28d9') + '15' }}>
                        <Wrench className="w-5 h-5" style={{ color: BRAND_COLORS[r.marque] || '#6d28d9' }} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-slate-900">{r.marque} {r.modele}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-slate-500">{r.type_piece}</span>
                          {r.qualite && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{r.qualite}</span>}
                          {r.fournisseur && <span className="text-[10px] text-slate-400">{r.fournisseur}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className="text-lg font-bold text-brand-600">{fp(r.prix_client)} €</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${r.en_stock ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {r.en_stock ? 'En stock' : 'Sur commande'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ TELEPHONES TAB ═══ */}
      {activeTab === 'telephones' && (
        <div>
          {/* Stats */}
          {telStats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="card p-3">
                <div className="flex items-center gap-2 mb-1"><Smartphone className="w-4 h-4 text-slate-400" /><span className="text-xs text-slate-500">Total</span></div>
                <p className="text-xl font-bold">{telStats.total || 0}</p>
              </div>
              <div className="card p-3">
                <div className="flex items-center gap-2 mb-1"><Package className="w-4 h-4 text-emerald-500" /><span className="text-xs text-slate-500">En stock</span></div>
                <p className="text-xl font-bold text-emerald-600">{telStats.en_stock || 0}</p>
              </div>
              <div className="card p-3">
                <div className="flex items-center gap-2 mb-1"><Tag className="w-4 h-4 text-blue-500" /><span className="text-xs text-slate-500">Marques</span></div>
                <p className="text-xl font-bold text-blue-600">{telStats.nb_marques || 0}</p>
              </div>
              <div className="card p-3">
                <div className="flex items-center gap-2 mb-1"><Euro className="w-4 h-4 text-brand-500" /><span className="text-xs text-slate-500">Valeur stock</span></div>
                <p className="text-xl font-bold text-brand-600">{fp(telStats.valeur_stock)} €</p>
              </div>
            </div>
          )}

          {/* Search + Filters + Add */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={telSearch} onChange={e => setTelSearch(e.target.value)}
                placeholder="Rechercher un téléphone..." className="input pl-9" />
            </div>
            <select value={telMarque} onChange={e => setTelMarque(e.target.value)} className="input w-auto min-w-[120px]">
              <option value="">Toutes marques</option>
              {telMarques.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={telEtat} onChange={e => setTelEtat(e.target.value)} className="input w-auto min-w-[120px]">
              <option value="">Tous états</option>
              <option value="Neuf">Neuf</option>
              <option value="Occasion">Occasion</option>
              <option value="Reconditionné">Reconditionné</option>
            </select>
            <button onClick={() => { setEditTelId(null); setTelForm(getEmptyTelForm()); setShowTelForm(true); }}
              className="btn-primary shrink-0">
              <Plus className="w-4 h-4" /> Ajouter
            </button>
          </div>

          {/* Tel List */}
          {telLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-amber-500" /></div>
          ) : telList.length === 0 ? (
            <div className="text-center py-16">
              <Smartphone className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">Aucun téléphone en vente</p>
              <p className="text-sm text-slate-400 mt-1">Ajoutez des téléphones à votre catalogue</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {telList.map(t => (
                <div key={t.id} className="card p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: (BRAND_COLORS[t.marque] || '#6d28d9') + '15' }}>
                        <Smartphone className="w-5 h-5" style={{ color: BRAND_COLORS[t.marque] || '#6d28d9' }} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-slate-900">{t.marque} {t.modele}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {t.capacite && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{t.capacite}</span>}
                          {t.couleur && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{t.couleur}</span>}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${t.etat === 'Neuf' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {t.etat}
                          </span>
                          {t.imei && <span className="text-[10px] text-slate-400">IMEI: {t.imei}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <div className="text-right">
                        <p className="text-lg font-bold text-brand-600">{fp(t.prix_vente)} €</p>
                        {Number(t.prix_achat) > 0 && <p className="text-[10px] text-slate-400">Achat: {fp(t.prix_achat)} €</p>}
                      </div>
                      <button onClick={() => handleToggleStock(t.id, t.en_stock)}
                        className={`p-1.5 rounded-lg ${t.en_stock ? 'text-emerald-500 hover:bg-emerald-50' : 'text-red-400 hover:bg-red-50'}`}
                        title={t.en_stock ? 'En stock' : 'Vendu'}>
                        {t.en_stock ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                      <button onClick={() => openEditTel(t)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600">
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDeleteTel(t.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ═══ TEL ADD/EDIT MODAL ═══ */}
          {showTelForm && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                  <h2 className="text-lg font-display font-bold text-slate-900">
                    {editTelId ? 'Modifier' : 'Ajouter un téléphone'}
                  </h2>
                  <button onClick={() => setShowTelForm(false)} className="p-2 rounded-lg hover:bg-slate-100">
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>
                <div className="p-6 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="input-label">Marque *</label>
                      <input value={telForm.marque} onChange={e => setTelForm(f => ({ ...f, marque: e.target.value }))}
                        className="input" placeholder="Apple" />
                    </div>
                    <div>
                      <label className="input-label">Modèle *</label>
                      <input value={telForm.modele} onChange={e => setTelForm(f => ({ ...f, modele: e.target.value }))}
                        className="input" placeholder="iPhone 15 Pro" />
                    </div>
                    <div>
                      <label className="input-label">Capacité</label>
                      <input value={telForm.capacite} onChange={e => setTelForm(f => ({ ...f, capacite: e.target.value }))}
                        className="input" placeholder="256 Go" />
                    </div>
                    <div>
                      <label className="input-label">Couleur</label>
                      <input value={telForm.couleur} onChange={e => setTelForm(f => ({ ...f, couleur: e.target.value }))}
                        className="input" placeholder="Noir" />
                    </div>
                    <div>
                      <label className="input-label">État</label>
                      <select value={telForm.etat} onChange={e => setTelForm(f => ({ ...f, etat: e.target.value }))} className="input">
                        <option>Neuf</option>
                        <option>Occasion</option>
                        <option>Reconditionné</option>
                      </select>
                    </div>
                    <div>
                      <label className="input-label">IMEI</label>
                      <input value={telForm.imei} onChange={e => setTelForm(f => ({ ...f, imei: e.target.value }))}
                        className="input" placeholder="IMEI" />
                    </div>
                    <div>
                      <label className="input-label">Prix achat (€)</label>
                      <input type="number" value={telForm.prix_achat} onChange={e => setTelForm(f => ({ ...f, prix_achat: parseFloat(e.target.value) || 0 }))}
                        className="input" step="0.01" />
                    </div>
                    <div>
                      <label className="input-label">Prix vente (€)</label>
                      <input type="number" value={telForm.prix_vente} onChange={e => setTelForm(f => ({ ...f, prix_vente: parseFloat(e.target.value) || 0 }))}
                        className="input" step="0.01" />
                    </div>
                  </div>
                  <div>
                    <label className="input-label">Notes</label>
                    <textarea value={telForm.notes} onChange={e => setTelForm(f => ({ ...f, notes: e.target.value }))}
                      className="input min-h-[60px]" placeholder="Notes..." />
                  </div>
                </div>
                <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
                  <button onClick={() => setShowTelForm(false)} className="btn-secondary">Annuler</button>
                  <button onClick={handleSaveTel} disabled={telSaving || !telForm.marque || !telForm.modele} className="btn-primary">
                    {telSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
                    {editTelId ? 'Enregistrer' : 'Ajouter'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
