import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { invalidateCache } from '../hooks/useApi';
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

// Badge de qualité : classes du système (fond -50 / texte -700), jamais de blanc sur couleur vive
const QUALITE_BADGE = {
  'Original': 'badge-success',
  'Soft OLED': 'badge-info',
  'Incell': 'badge-brand',
  'Hard OLED': 'badge-brand',
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
      invalidateCache('telephones');
      setShowTelForm(false);
      setEditTelId(null);
      loadTelephones();
    } catch { /* ignore */ }
    setTelSaving(false);
  };

  const handleDeleteTel = async (id) => {
    if (!confirm('Supprimer ce téléphone ?')) return;
    try { await api.deleteTelephoneVente(id); invalidateCache('telephones'); loadTelephones(); } catch { /* ignore */ }
  };

  const handleToggleStock = async (id, currentStock) => {
    try { await api.updateTelephoneVente(id, { en_stock: !currentStock }); invalidateCache('telephones'); loadTelephones(); } catch { /* ignore */ }
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

  const kioskText = kioskMode ? 'text-white' : 'text-slate-900';
  const kioskSubtext = kioskMode ? 'text-slate-400' : 'text-slate-500';
  const kioskCard = kioskMode ? 'bg-slate-800/80 border border-slate-700 rounded-xl' : 'card';
  const kioskFontSize = kioskMode ? 'text-[115%]' : '';

  return (
    <div className={`page ${kioskMode ? 'fixed inset-0 z-[100] overflow-auto bg-[#0F172A] text-white max-w-none' : 'max-w-[1280px]'} ${kioskFontSize}`}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className={`page-header-title ${kioskText}`}>Devis Flash</h1>
          <p className={`page-header-subtitle ${kioskSubtext}`}>Consultation rapide des prix de réparation</p>
        </div>
        <div className="page-header-actions">
          <button type="button" onClick={toggleKiosk} className={kioskMode ? 'btn bg-slate-700 text-white hover:bg-slate-600' : 'btn-secondary'}>
            {kioskMode ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            {kioskMode ? 'Quitter kiosque' : 'Mode kiosque'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className={`segmented mb-6 ${kioskMode ? 'bg-slate-800' : ''}`} role="group" aria-label="Rubrique">
        <button type="button" onClick={() => setActiveTab('reparations')} aria-pressed={activeTab === 'reparations'}
          className={`segmented-item ${activeTab === 'reparations'
            ? (kioskMode ? 'bg-slate-700 text-white shadow-xs' : 'segmented-item-active')
            : (kioskMode ? 'text-slate-300 hover:text-white' : '')}`}>
          <Wrench className="w-4 h-4" aria-hidden="true" /> Réparations
        </button>
        <button type="button" onClick={() => setActiveTab('telephones')} aria-pressed={activeTab === 'telephones'}
          className={`segmented-item ${activeTab === 'telephones'
            ? (kioskMode ? 'bg-slate-700 text-white shadow-xs' : 'segmented-item-active')
            : (kioskMode ? 'text-slate-300 hover:text-white' : '')}`}>
          <Smartphone className="w-4 h-4" aria-hidden="true" /> Téléphones en vente
        </button>
      </div>

      {/* ═══ RÉPARATIONS TAB ═══ */}
      {activeTab === 'reparations' && (
        <div>
          {/* Search bar */}
          <div className="relative mb-6" ref={searchRef}>
            <Search className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none ${kioskMode ? 'text-slate-400' : 'text-slate-500'}`} aria-hidden="true" />
            <label htmlFor="devis-flash-recherche" className="sr-only">Rechercher un modèle</label>
            <input id="devis-flash-recherche" value={repQuery}
              onChange={e => { setRepQuery(e.target.value); setSelectedModel(null); setCheckedRepairs(new Set()); }}
              placeholder="Rechercher un modèle (ex: iPhone 15 Pro, Galaxy S24...)"
              className={`input input-lg min-h-14 pl-12 pr-14 text-base lg:text-base
                ${kioskMode ? 'bg-slate-800 border-slate-600 text-white placeholder:text-slate-400 hover:border-slate-500' : ''}`}
              autoFocus />
            {repLoading && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 motion-safe:animate-spin text-brand-600" aria-hidden="true" />}
            {selectedModel && !repLoading && (
              <button type="button" onClick={clearSelection} aria-label="Effacer la sélection"
                className={`btn-ghost btn-icon absolute right-2 top-1/2 -translate-y-1/2 ${kioskMode ? 'text-slate-300 hover:bg-slate-700 hover:text-white' : ''}`}>
                <X aria-hidden="true" />
              </button>
            )}

            {/* Dropdown suggestions */}
            {showDropdown && !selectedModel && repResults.length > 0 && (
              <div ref={dropdownRef}
                className={`absolute top-full left-0 right-0 mt-2 rounded-xl shadow-lg border z-50 max-h-80 overflow-y-auto
                  ${kioskMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-slate-200'}`}>
                {repResults.map((m, i) => {
                  const minPrice = Math.min(...m.reparations.map(r => r.prix_vente));
                  return (
                    <button key={i} type="button" onClick={() => selectModel(m)}
                      className={`w-full flex items-center gap-3 px-4 min-h-14 py-2 text-left transition-colors duration-150 focus:outline-none
                        ${kioskMode ? 'hover:bg-slate-700 focus-visible:bg-slate-700' : 'hover:bg-slate-50 focus-visible:bg-brand-50'}
                        ${i > 0 ? (kioskMode ? 'border-t border-slate-700' : 'border-t border-slate-100') : ''}`}>
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" aria-hidden="true"
                        style={{ background: (BRAND_COLORS[m.marque] || '#6d28d9') + '15' }}>
                        <Smartphone className="w-5 h-5" style={{ color: BRAND_COLORS[m.marque] || '#6d28d9' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-sm ${kioskText}`}>{m.marque} {m.modele}</p>
                        <p className={`text-xs ${kioskSubtext}`}>{m.reparations.length} réparation{m.reparations.length > 1 ? 's' : ''} disponible{m.reparations.length > 1 ? 's' : ''}</p>
                      </div>
                      <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${kioskText}`}>dès {minPrice}€</span>
                      <ChevronRight className={`w-4 h-4 ${kioskSubtext}`} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Empty state */}
          {!selectedModel && !showDropdown && (
            <div className="empty-state">
              <div className={`empty-state-icon ${kioskMode ? 'bg-slate-800 text-slate-400' : ''}`}>
                <Wrench aria-hidden="true" />
              </div>
              <p className={`t-h2 ${kioskText}`}>Tapez un modèle pour voir les prix de réparation</p>
              <p className={`t-body max-w-sm ${kioskSubtext}`}>
                Recherchez par modèle (iPhone 15 Pro) ou marque (Samsung)
              </p>
            </div>
          )}

          {/* No results */}
          {!selectedModel && showDropdown && repResults.length === 0 && !repLoading && (
            <div className="empty-state">
              <div className={`empty-state-icon ${kioskMode ? 'bg-slate-800 text-slate-400' : ''}`}>
                <Package aria-hidden="true" />
              </div>
              <p className={`t-h2 ${kioskText}`}>Aucun résultat pour "{repQuery}"</p>
            </div>
          )}

          {/* ═══ REPAIR CARD ═══ */}
          {selectedModel && (
            <div className={`overflow-hidden ${kioskCard}`}>
              {/* Card header */}
              <div className={`px-4 sm:px-5 py-4 flex items-center gap-4 ${kioskMode ? 'bg-slate-700/50' : 'bg-slate-50 border-b border-slate-100'}`}>
                <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0" aria-hidden="true"
                  style={{ background: (BRAND_COLORS[selectedModel.marque] || '#6d28d9') + '20' }}>
                  <Smartphone className="w-6 h-6" style={{ color: BRAND_COLORS[selectedModel.marque] || '#6d28d9' }} />
                </div>
                <div className="min-w-0">
                  <h2 className={`text-xl font-bold leading-tight ${kioskText}`}>
                    {selectedModel.marque} {selectedModel.modele}
                  </h2>
                  <p className={`text-sm ${kioskSubtext}`}>
                    {selectedModel.marque} — {selectedModel.reparations.length} réparation{selectedModel.reparations.length > 1 ? 's' : ''} disponible{selectedModel.reparations.length > 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              {/* Repairs list */}
              <div className={`divide-y ${kioskMode ? 'divide-slate-700' : 'divide-slate-100'}`}>
                {selectedModel.reparations.map((r, i) => {
                  const isChecked = checkedRepairs.has(i);
                  const color = getComposantColor(r.composant);
                  return (
                    <button key={i} type="button"
                      onClick={() => toggleRepair(i)}
                      aria-pressed={isChecked}
                      className={`w-full flex items-center gap-4 px-4 sm:px-5 min-h-14 py-3 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset
                        ${isChecked
                          ? (kioskMode ? 'bg-brand-600/20' : 'bg-brand-50/70')
                          : (kioskMode ? 'hover:bg-slate-700/50' : 'hover:bg-slate-50')}`}>
                      {/* Checkbox */}
                      <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors duration-150
                        ${isChecked ? 'bg-brand-600 border-brand-600' : (kioskMode ? 'border-slate-500' : 'border-slate-300')}`} aria-hidden="true">
                        {isChecked && <Check className="w-4 h-4 text-white" />}
                      </div>

                      {/* Color bar */}
                      <div className="w-1 h-8 rounded-full shrink-0" style={{ background: color }} aria-hidden="true" />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-medium ${kioskText}`}>{r.composant}</span>
                          {r.qualite && (
                            <span className={`badge badge-sm ${QUALITE_BADGE[r.qualite] || 'badge-neutral'}`}>
                              {r.qualite}
                            </span>
                          )}
                          {!r.en_stock && (
                            <span className="badge badge-sm badge-warning">Sur commande</span>
                          )}
                        </div>
                      </div>

                      {/* Price */}
                      <span className={`text-lg font-bold tabular-nums shrink-0 ${isChecked ? (kioskMode ? 'text-brand-300' : 'text-brand-700') : (kioskMode ? 'text-slate-200' : 'text-slate-900')}`}>
                        {r.prix_vente}€
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Summary + Actions */}
              {selectedRepairs.length > 0 && (
                <div className={`px-4 sm:px-5 py-5 ${kioskMode ? 'bg-slate-700/50 border-t border-slate-600' : 'bg-slate-50 border-t border-slate-200'}`}>
                  {/* Selected items */}
                  <div className="mb-4 space-y-1.5">
                    <p className={`t-h3 mb-2 ${kioskSubtext}`}>
                      Sélectionné ({selectedRepairs.length})
                    </p>
                    {selectedRepairs.map((r, i) => (
                      <div key={i} className={`flex items-center justify-between gap-3 text-sm ${kioskText}`}>
                        <span>{r.qualite ? `${r.composant} (${r.qualite})` : r.composant}</span>
                        <span className="font-medium tabular-nums whitespace-nowrap">{r.prix_vente}€</span>
                      </div>
                    ))}
                  </div>

                  {/* Total */}
                  <div className={`flex items-center justify-between py-3 px-4 rounded-lg mb-4 ${kioskMode ? 'bg-brand-600/20' : 'bg-white border border-slate-200'}`}>
                    <span className={`text-base font-bold ${kioskMode ? 'text-brand-200' : 'text-slate-900'}`}>TOTAL TTC</span>
                    <span className={`text-2xl font-bold tabular-nums ${kioskMode ? 'text-white' : 'text-brand-700'}`}>{totalSelected}€</span>
                  </div>

                  {/* Action buttons */}
                  {!kioskMode && (
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button type="button" onClick={handleCreateDevis} className="btn-primary btn-lg flex-1">
                        <FileText aria-hidden="true" /> Créer un devis
                      </button>
                      <button type="button" onClick={handleCreateTicket} className="btn-secondary btn-lg flex-1">
                        <Ticket aria-hidden="true" /> Créer un ticket
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Kiosk footer */}
          {kioskMode && (
            <div className="text-center mt-12 text-slate-400 text-sm">
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
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
              <div className={`kpi-card ${kioskCard}`}>
                <div className={`kpi-icon ${kioskMode ? 'bg-slate-700 text-slate-200' : ''}`} aria-hidden="true"><Smartphone /></div>
                <div className="min-w-0"><p className={`kpi-value ${kioskText}`}>{telStats.total || 0}</p><p className={`kpi-label ${kioskSubtext}`}>Total</p></div>
              </div>
              <div className={`kpi-card ${kioskCard}`}>
                <div className={`kpi-icon ${kioskMode ? 'bg-slate-700 text-slate-200' : 'bg-emerald-50 text-emerald-700'}`} aria-hidden="true"><Package /></div>
                <div className="min-w-0"><p className={`kpi-value ${kioskText}`}>{telStats.en_stock || 0}</p><p className={`kpi-label ${kioskSubtext}`}>En stock</p></div>
              </div>
              <div className={`kpi-card ${kioskCard}`}>
                <div className={`kpi-icon ${kioskMode ? 'bg-slate-700 text-slate-200' : ''}`} aria-hidden="true"><Tag /></div>
                <div className="min-w-0"><p className={`kpi-value ${kioskText}`}>{telStats.nb_marques || 0}</p><p className={`kpi-label ${kioskSubtext}`}>Marques</p></div>
              </div>
              <div className={`kpi-card ${kioskCard}`}>
                <div className={`kpi-icon ${kioskMode ? 'bg-slate-700 text-slate-200' : ''}`} aria-hidden="true"><Euro /></div>
                <div className="min-w-0"><p className={`kpi-value whitespace-nowrap ${kioskText}`}>{fp(telStats.valeur_stock)} €</p><p className={`kpi-label ${kioskSubtext}`}>Valeur stock</p></div>
              </div>
            </div>
          )}

          {/* Search + Filters + Add */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" aria-hidden="true" />
              <input value={telSearch} onChange={e => setTelSearch(e.target.value)} aria-label="Rechercher un téléphone"
                placeholder="Rechercher un téléphone..." className="input pl-9 min-h-11" />
            </div>
            <select value={telMarque} onChange={e => setTelMarque(e.target.value)} aria-label="Filtrer par marque" className="select sm:w-auto sm:min-w-[150px] min-h-11">
              <option value="">Toutes marques</option>
              {telMarques.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={telEtat} onChange={e => setTelEtat(e.target.value)} aria-label="Filtrer par état" className="select sm:w-auto sm:min-w-[130px] min-h-11">
              <option value="">Tous états</option>
              <option value="Neuf">Neuf</option>
              <option value="Occasion">Occasion</option>
              <option value="Reconditionné">Reconditionné</option>
            </select>
            {!kioskMode && (
              <button type="button" onClick={() => { setEditTelId(null); setTelForm(getEmptyTelForm()); setShowTelForm(true); }}
                className="btn-primary shrink-0">
                <Plus aria-hidden="true" /> Ajouter
              </button>
            )}
          </div>

          {/* Tel List */}
          {telLoading ? (
            <div className="space-y-2" role="status">
              {[1, 2, 3].map(i => <div key={i} className="skeleton h-[72px]" aria-hidden="true" />)}
              <p className="sr-only">Chargement…</p>
            </div>
          ) : telList.length === 0 ? (
            <div className="empty-state">
              <div className={`empty-state-icon ${kioskMode ? 'bg-slate-800 text-slate-400' : ''}`}>
                <Smartphone aria-hidden="true" />
              </div>
              <p className={`t-h2 ${kioskText}`}>Aucun téléphone en vente</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {telList.map(t => (
                <div key={t.id} className={`p-3 sm:p-4 ${kioskCard}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" aria-hidden="true"
                        style={{ background: (BRAND_COLORS[t.marque] || '#6d28d9') + '15' }}>
                        <Smartphone className="w-5 h-5" style={{ color: BRAND_COLORS[t.marque] || '#6d28d9' }} />
                      </div>
                      <div className="min-w-0">
                        <p className={`font-semibold text-sm ${kioskText}`}>{t.marque} {t.modele}</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {t.capacite && <span className="badge badge-sm badge-neutral">{t.capacite}</span>}
                          {t.couleur && <span className="badge badge-sm badge-neutral">{t.couleur}</span>}
                          <span className={`badge badge-sm ${t.etat === 'Neuf' ? 'badge-success' : 'badge-neutral'}`}>
                            {t.etat}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p className={`text-lg font-bold tabular-nums whitespace-nowrap ${kioskText}`}>{fp(t.prix_vente)} €</p>
                        {Number(t.prix_achat) > 0 && !kioskMode && <p className="t-caption tabular-nums whitespace-nowrap">Achat: {fp(t.prix_achat)} €</p>}
                      </div>
                      {!kioskMode && (
                        <div className="flex items-center gap-0.5 -mr-2">
                          <button type="button" onClick={() => handleToggleStock(t.id, t.en_stock)}
                            className={`btn-ghost btn-icon ${t.en_stock ? 'text-emerald-700 hover:bg-emerald-50' : 'text-red-700 hover:bg-red-50'}`}
                            title={t.en_stock ? 'En stock' : 'Vendu'} aria-pressed={Boolean(t.en_stock)}>
                            {t.en_stock ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                          </button>
                          <button type="button" onClick={() => openEditTel(t)} className="btn-ghost btn-icon" title="Modifier" aria-label={`Modifier ${t.marque} ${t.modele}`}>
                            <Edit3 aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => handleDeleteTel(t.id)} className="btn-danger-ghost btn-icon" title="Supprimer" aria-label={`Supprimer ${t.marque} ${t.modele}`}>
                            <Trash2 aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ═══ TEL ADD/EDIT MODAL ═══ */}
          {showTelForm && (
            <div className="modal-overlay">
              <div role="dialog" aria-modal="true" aria-labelledby="tel-form-titre" className="modal sm:max-w-md">
                <div className="modal-header">
                  <h2 id="tel-form-titre" className="t-h2">
                    {editTelId ? 'Modifier' : 'Ajouter un téléphone'}
                  </h2>
                  <button type="button" onClick={() => setShowTelForm(false)} className="btn-ghost btn-icon -mr-2" aria-label="Fermer">
                    <X aria-hidden="true" />
                  </button>
                </div>
                <div className="modal-body space-y-4">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                    <div>
                      <label htmlFor="tel-form-marque" className="input-label">Marque *</label>
                      <input id="tel-form-marque" value={telForm.marque} onChange={e => setTelForm(f => ({ ...f, marque: e.target.value }))}
                        className="input" placeholder="Apple" />
                    </div>
                    <div>
                      <label htmlFor="tel-form-modele" className="input-label">Modèle *</label>
                      <input id="tel-form-modele" value={telForm.modele} onChange={e => setTelForm(f => ({ ...f, modele: e.target.value }))}
                        className="input" placeholder="iPhone 15 Pro" />
                    </div>
                    <div>
                      <label htmlFor="tel-form-capacite" className="input-label">Capacité</label>
                      <input id="tel-form-capacite" value={telForm.capacite} onChange={e => setTelForm(f => ({ ...f, capacite: e.target.value }))}
                        className="input" placeholder="256 Go" />
                    </div>
                    <div>
                      <label htmlFor="tel-form-couleur" className="input-label">Couleur</label>
                      <input id="tel-form-couleur" value={telForm.couleur} onChange={e => setTelForm(f => ({ ...f, couleur: e.target.value }))}
                        className="input" placeholder="Noir" />
                    </div>
                    <div>
                      <label htmlFor="tel-form-etat" className="input-label">État</label>
                      <select id="tel-form-etat" value={telForm.etat} onChange={e => setTelForm(f => ({ ...f, etat: e.target.value }))} className="select">
                        <option>Neuf</option>
                        <option>Occasion</option>
                        <option>Reconditionné</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="tel-form-imei" className="input-label">IMEI</label>
                      <input id="tel-form-imei" value={telForm.imei} onChange={e => setTelForm(f => ({ ...f, imei: e.target.value }))}
                        className="input t-mono" placeholder="IMEI" />
                    </div>
                    <div>
                      <label htmlFor="tel-form-prix-achat" className="input-label">Prix achat (€)</label>
                      <input id="tel-form-prix-achat" type="number" value={telForm.prix_achat} onChange={e => setTelForm(f => ({ ...f, prix_achat: parseFloat(e.target.value) || 0 }))}
                        className="input tabular-nums" step="0.01" />
                    </div>
                    <div>
                      <label htmlFor="tel-form-prix-vente" className="input-label">Prix vente (€)</label>
                      <input id="tel-form-prix-vente" type="number" value={telForm.prix_vente} onChange={e => setTelForm(f => ({ ...f, prix_vente: parseFloat(e.target.value) || 0 }))}
                        className="input tabular-nums" step="0.01" />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="tel-form-notes" className="input-label">Notes</label>
                    <textarea id="tel-form-notes" value={telForm.notes} onChange={e => setTelForm(f => ({ ...f, notes: e.target.value }))}
                      className="textarea min-h-[80px]" placeholder="Notes..." />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" onClick={() => setShowTelForm(false)} className="btn-ghost">Annuler</button>
                  <button type="button" onClick={handleSaveTel} disabled={telSaving || !telForm.marque || !telForm.modele} className="btn-primary">
                    {telSaving ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Smartphone aria-hidden="true" />}
                    {editTelId ? 'Enregistrer' : 'Ajouter'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {kioskMode && (
            <div className="text-center mt-12 text-slate-400 text-sm">
              KLIKPHONE SAV — Chambéry
            </div>
          )}
        </div>
      )}
    </div>
  );
}
