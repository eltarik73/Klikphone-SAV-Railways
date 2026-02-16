import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import {
  Zap, Search, Wrench, Smartphone, Package, Plus, Edit3, Trash2,
  X, Loader2, Filter, ChevronDown, Eye, EyeOff, Maximize2, Minimize2,
  Tag, Euro, Battery, Monitor as MonitorIcon, FileText, Ticket,
  Check, ChevronRight,
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

const COMPOSANT_COLORS = {
  'Écran': '#3B82F6', 'Ecran': '#3B82F6',
  'Batterie': '#F59E0B',
  'Connecteur': '#6366F1', 'Connecteur de charge': '#6366F1',
  'Caméra': '#EC4899', 'Camera': '#EC4899', 'Caméra arrière': '#EC4899', 'Caméra avant': '#EC4899',
  'Vitre': '#14B8A6', 'Vitre arrière': '#14B8A6',
  'Face ID': '#EF4444',
  'Désoxydation': '#0EA5E9',
};

const QUALITE_COLORS = {
  'Original': '#10B981',
  'Soft OLED': '#3B82F6',
  'Incell': '#8B5CF6',
  'Hard OLED': '#6366F1',
};

function getComposantColor(composant) {
  for (const [key, color] of Object.entries(COMPOSANT_COLORS)) {
    if (composant?.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return '#64748b';
}

export default function DevisFlashPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';
  const [activeTab, setActiveTab] = useState('reparations');
  const [kioskMode, setKioskMode] = useState(searchParams.get('mode') === 'kiosk');

  // ─── Réparations tab ─────
  const [repQuery, setRepQuery] = useState('');
  const [repResults, setRepResults] = useState([]);
  const [repLoading, setRepLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState(null);
  const [checkedRepairs, setCheckedRepairs] = useState(new Set());
  const [showDropdown, setShowDropdown] = useState(false);
  const repTimer = useRef(null);
  const searchRef = useRef(null);
  const dropdownRef = useRef(null);

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
    if (!q || q.length < 1) { setRepResults([]); setShowDropdown(false); return; }
    setRepLoading(true);
    try {
      const res = await api.devisFlashSearch(q);
      setRepResults(res || []);
      setShowDropdown(true);
    } catch { setRepResults([]); }
    setRepLoading(false);
  };

  useEffect(() => {
    clearTimeout(repTimer.current);
    repTimer.current = setTimeout(() => searchReparations(repQuery), 200);
    return () => clearTimeout(repTimer.current);
  }, [repQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          searchRef.current && !searchRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectModel = (model) => {
    setSelectedModel(model);
    setCheckedRepairs(new Set());
    setShowDropdown(false);
    setRepQuery(model.modele);
  };

  const toggleRepair = (idx) => {
    setCheckedRepairs(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const selectedRepairs = selectedModel
    ? selectedModel.reparations.filter((_, i) => checkedRepairs.has(i))
    : [];
  const totalSelected = selectedRepairs.reduce((sum, r) => sum + (r.prix_vente || 0), 0);

  const handleCreateDevis = () => {
    if (!selectedRepairs.length) return;
    const lignes = selectedRepairs.map(r => ({
      description: r.qualite ? `${r.composant} (${r.qualite})` : r.composant,
      quantite: 1,
      prix_unitaire: r.prix_vente,
    }));
    // Store in sessionStorage and navigate to devis page
    sessionStorage.setItem('kp_devis_prefill', JSON.stringify({
      appareil: `${selectedModel.marque} ${selectedModel.modele}`,
      lignes,
    }));
    navigate(`${basePath}/devis?create=1`);
  };

  const handleCreateTicket = () => {
    if (!selectedRepairs.length) return;
    const panneList = selectedRepairs.map(r =>
      r.qualite ? `${r.composant} (${r.qualite})` : r.composant
    ).join(', ');
    sessionStorage.setItem('kp_ticket_prefill', JSON.stringify({
      marque: selectedModel.marque,
      modele: selectedModel.modele,
      panne: panneList,
      devis_estime: totalSelected,
    }));
    navigate(`${basePath}`);
  };

  const clearSelection = () => {
    setSelectedModel(null);
    setCheckedRepairs(new Set());
    setRepQuery('');
  };

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

  const kioskBg = kioskMode ? 'bg-[#0F172A] text-white' : '';
  const kioskText = kioskMode ? 'text-white' : 'text-slate-900';
  const kioskSubtext = kioskMode ? 'text-slate-400' : 'text-slate-500';
  const kioskCard = kioskMode ? 'bg-slate-800/80 border-slate-700' : 'bg-white border-slate-200';
  const kioskFontSize = kioskMode ? 'text-[115%]' : '';

  return (
    <div className={`${kioskMode ? 'fixed inset-0 z-[100] overflow-auto' : ''} ${kioskBg} ${kioskFontSize} p-4 sm:p-6 lg:p-8 max-w-7xl`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className={`text-2xl font-display font-bold ${kioskText} tracking-tight flex items-center gap-2`}>
            <Zap className="w-6 h-6 text-amber-500" /> Devis Flash
          </h1>
          <p className={`text-sm ${kioskSubtext} mt-0.5`}>Consultation rapide des prix de réparation</p>
        </div>
        <button onClick={toggleKiosk} className={`${kioskMode ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'btn-secondary'} text-xs px-3 py-2 rounded-lg flex items-center gap-1.5`}>
          {kioskMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          {kioskMode ? 'Quitter kiosque' : 'Mode kiosque'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6">
        <button onClick={() => setActiveTab('reparations')}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-all
            ${activeTab === 'reparations' ? 'bg-amber-500 text-white shadow-sm' : `${kioskMode ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'}`}`}>
          <Wrench className="w-4 h-4" /> Réparations
        </button>
        <button onClick={() => setActiveTab('telephones')}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-all
            ${activeTab === 'telephones' ? 'bg-amber-500 text-white shadow-sm' : `${kioskMode ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'}`}`}>
          <Smartphone className="w-4 h-4" /> Téléphones en vente
        </button>
      </div>

      {/* ═══ RÉPARATIONS TAB ═══ */}
      {activeTab === 'reparations' && (
        <div>
          {/* Search bar */}
          <div className="relative mb-6" ref={searchRef}>
            <Search className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 ${kioskMode ? 'text-slate-500' : 'text-slate-400'}`} />
            <input value={repQuery}
              onChange={e => { setRepQuery(e.target.value); setSelectedModel(null); setCheckedRepairs(new Set()); }}
              placeholder="Rechercher un modèle (ex: iPhone 15 Pro, Galaxy S24...)"
              className={`w-full h-14 pl-12 pr-12 rounded-2xl border-2 text-lg outline-none transition-all
                ${kioskMode
                  ? 'bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20'
                  : 'border-slate-200 focus:border-amber-400 focus:ring-4 focus:ring-amber-100'}`}
              autoFocus />
            {repLoading && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 animate-spin text-amber-500" />}
            {selectedModel && !repLoading && (
              <button onClick={clearSelection} className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-slate-200">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            )}

            {/* Dropdown suggestions */}
            {showDropdown && !selectedModel && repResults.length > 0 && (
              <div ref={dropdownRef}
                className={`absolute top-full left-0 right-0 mt-2 rounded-xl shadow-2xl border z-50 max-h-80 overflow-y-auto
                  ${kioskMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-slate-200'}`}>
                {repResults.map((m, i) => {
                  const minPrice = Math.min(...m.reparations.map(r => r.prix_vente));
                  return (
                    <button key={i} onClick={() => selectModel(m)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
                        ${kioskMode ? 'hover:bg-slate-700' : 'hover:bg-slate-50'}
                        ${i > 0 ? (kioskMode ? 'border-t border-slate-700' : 'border-t border-slate-100') : ''}`}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: (BRAND_COLORS[m.marque] || '#6d28d9') + '15' }}>
                        <Smartphone className="w-5 h-5" style={{ color: BRAND_COLORS[m.marque] || '#6d28d9' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-sm ${kioskText}`}>{m.marque} {m.modele}</p>
                        <p className={`text-xs ${kioskSubtext}`}>{m.reparations.length} réparation{m.reparations.length > 1 ? 's' : ''} disponible{m.reparations.length > 1 ? 's' : ''}</p>
                      </div>
                      <span className="text-sm font-bold text-amber-500">dès {minPrice}€</span>
                      <ChevronRight className={`w-4 h-4 ${kioskSubtext}`} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Empty state */}
          {!selectedModel && !showDropdown && (
            <div className="text-center py-16">
              <Wrench className={`w-16 h-16 mx-auto mb-4 ${kioskMode ? 'text-slate-700' : 'text-slate-200'}`} />
              <p className={`text-lg ${kioskSubtext}`}>Tapez un modèle pour voir les prix de réparation</p>
              <p className={`text-sm mt-1 ${kioskMode ? 'text-slate-600' : 'text-slate-300'}`}>
                Recherchez par modèle (iPhone 15 Pro) ou marque (Samsung)
              </p>
            </div>
          )}

          {/* No results */}
          {!selectedModel && showDropdown && repResults.length === 0 && !repLoading && (
            <div className="text-center py-16">
              <Package className={`w-12 h-12 mx-auto mb-3 ${kioskMode ? 'text-slate-600' : 'text-slate-300'}`} />
              <p className={kioskSubtext}>Aucun résultat pour "{repQuery}"</p>
            </div>
          )}

          {/* ═══ REPAIR CARD ═══ */}
          {selectedModel && (
            <div className={`rounded-2xl border-2 overflow-hidden ${kioskCard}`}>
              {/* Card header */}
              <div className={`px-6 py-4 flex items-center gap-4 ${kioskMode ? 'bg-slate-700/50' : 'bg-slate-50'}`}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{ background: (BRAND_COLORS[selectedModel.marque] || '#6d28d9') + '20' }}>
                  <Smartphone className="w-6 h-6" style={{ color: BRAND_COLORS[selectedModel.marque] || '#6d28d9' }} />
                </div>
                <div>
                  <h2 className={`text-xl font-display font-bold ${kioskText}`}>
                    {selectedModel.marque} {selectedModel.modele}
                  </h2>
                  <p className={`text-sm ${kioskSubtext}`}>
                    {selectedModel.marque} — {selectedModel.reparations.length} réparation{selectedModel.reparations.length > 1 ? 's' : ''} disponible{selectedModel.reparations.length > 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              {/* Repairs list */}
              <div className="divide-y divide-slate-100">
                {selectedModel.reparations.map((r, i) => {
                  const isChecked = checkedRepairs.has(i);
                  const color = getComposantColor(r.composant);
                  return (
                    <button key={i}
                      onClick={() => toggleRepair(i)}
                      className={`w-full flex items-center gap-4 px-6 py-4 text-left transition-all
                        ${isChecked
                          ? (kioskMode ? 'bg-amber-500/10' : 'bg-amber-50/80')
                          : (kioskMode ? 'hover:bg-slate-700/50' : 'hover:bg-slate-50')}`}>
                      {/* Checkbox */}
                      <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all
                        ${isChecked ? 'bg-amber-500 border-amber-500' : (kioskMode ? 'border-slate-600' : 'border-slate-300')}`}>
                        {isChecked && <Check className="w-4 h-4 text-white" />}
                      </div>

                      {/* Color bar */}
                      <div className="w-1 h-8 rounded-full shrink-0" style={{ background: color }} />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-medium ${kioskText}`}>{r.composant}</span>
                          {r.qualite && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold text-white"
                              style={{ background: QUALITE_COLORS[r.qualite] || '#64748b' }}>
                              {r.qualite}
                            </span>
                          )}
                          {!r.en_stock && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium">Sur commande</span>
                          )}
                        </div>
                      </div>

                      {/* Price */}
                      <span className={`text-lg font-bold shrink-0 ${isChecked ? 'text-amber-500' : (kioskMode ? 'text-slate-300' : 'text-slate-900')}`}>
                        {r.prix_vente}€
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Summary + Actions */}
              {selectedRepairs.length > 0 && (
                <div className={`px-6 py-5 ${kioskMode ? 'bg-slate-700/50 border-t border-slate-600' : 'bg-slate-50 border-t border-slate-200'}`}>
                  {/* Selected items */}
                  <div className="mb-4 space-y-1.5">
                    <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${kioskSubtext}`}>
                      Sélectionné ({selectedRepairs.length})
                    </p>
                    {selectedRepairs.map((r, i) => (
                      <div key={i} className={`flex items-center justify-between text-sm ${kioskText}`}>
                        <span>{r.qualite ? `${r.composant} (${r.qualite})` : r.composant}</span>
                        <span className="font-medium">{r.prix_vente}€</span>
                      </div>
                    ))}
                  </div>

                  {/* Total */}
                  <div className={`flex items-center justify-between py-3 px-4 rounded-xl mb-4 ${kioskMode ? 'bg-amber-500/20' : 'bg-amber-50 border border-amber-200'}`}>
                    <span className={`text-lg font-bold ${kioskMode ? 'text-amber-400' : 'text-amber-900'}`}>TOTAL TTC</span>
                    <span className="text-2xl font-black text-amber-500">{totalSelected}€</span>
                  </div>

                  {/* Action buttons */}
                  {!kioskMode && (
                    <div className="flex gap-3">
                      <button onClick={handleCreateDevis}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700 transition-colors">
                        <FileText className="w-5 h-5" /> Créer un devis
                      </button>
                      <button onClick={handleCreateTicket}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-800 text-white font-semibold hover:bg-slate-900 transition-colors">
                        <Ticket className="w-5 h-5" /> Créer un ticket
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Kiosk footer */}
          {kioskMode && (
            <div className="text-center mt-12 text-slate-600 text-sm">
              KLIKPHONE SAV — Chambéry
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
              <div className={`rounded-xl border p-3 ${kioskCard}`}>
                <div className="flex items-center gap-2 mb-1"><Smartphone className={`w-4 h-4 ${kioskSubtext}`} /><span className={`text-xs ${kioskSubtext}`}>Total</span></div>
                <p className={`text-xl font-bold ${kioskText}`}>{telStats.total || 0}</p>
              </div>
              <div className={`rounded-xl border p-3 ${kioskCard}`}>
                <div className="flex items-center gap-2 mb-1"><Package className="w-4 h-4 text-emerald-500" /><span className={`text-xs ${kioskSubtext}`}>En stock</span></div>
                <p className="text-xl font-bold text-emerald-600">{telStats.en_stock || 0}</p>
              </div>
              <div className={`rounded-xl border p-3 ${kioskCard}`}>
                <div className="flex items-center gap-2 mb-1"><Tag className="w-4 h-4 text-blue-500" /><span className={`text-xs ${kioskSubtext}`}>Marques</span></div>
                <p className="text-xl font-bold text-blue-600">{telStats.nb_marques || 0}</p>
              </div>
              <div className={`rounded-xl border p-3 ${kioskCard}`}>
                <div className="flex items-center gap-2 mb-1"><Euro className="w-4 h-4 text-brand-500" /><span className={`text-xs ${kioskSubtext}`}>Valeur stock</span></div>
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
            {!kioskMode && (
              <button onClick={() => { setEditTelId(null); setTelForm(getEmptyTelForm()); setShowTelForm(true); }}
                className="btn-primary shrink-0">
                <Plus className="w-4 h-4" /> Ajouter
              </button>
            )}
          </div>

          {/* Tel List */}
          {telLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-amber-500" /></div>
          ) : telList.length === 0 ? (
            <div className="text-center py-16">
              <Smartphone className={`w-12 h-12 mx-auto mb-3 ${kioskMode ? 'text-slate-600' : 'text-slate-300'}`} />
              <p className={kioskSubtext}>Aucun téléphone en vente</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {telList.map(t => (
                <div key={t.id} className={`rounded-xl border p-4 transition-shadow hover:shadow-md ${kioskCard}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: (BRAND_COLORS[t.marque] || '#6d28d9') + '15' }}>
                        <Smartphone className="w-5 h-5" style={{ color: BRAND_COLORS[t.marque] || '#6d28d9' }} />
                      </div>
                      <div className="min-w-0">
                        <p className={`font-semibold text-sm ${kioskText}`}>{t.marque} {t.modele}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {t.capacite && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{t.capacite}</span>}
                          {t.couleur && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{t.couleur}</span>}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${t.etat === 'Neuf' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {t.etat}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <div className="text-right">
                        <p className="text-lg font-bold text-brand-600">{fp(t.prix_vente)} €</p>
                        {Number(t.prix_achat) > 0 && !kioskMode && <p className="text-[10px] text-slate-400">Achat: {fp(t.prix_achat)} €</p>}
                      </div>
                      {!kioskMode && (
                        <>
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
                        </>
                      )}
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

          {kioskMode && (
            <div className="text-center mt-12 text-slate-600 text-sm">
              KLIKPHONE SAV — Chambéry
            </div>
          )}
        </div>
      )}
    </div>
  );
}
