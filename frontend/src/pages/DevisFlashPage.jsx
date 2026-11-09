import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { invalidateCache } from '../hooks/useApi';
import api from '../lib/api';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import CarteChiffres from '../components/CarteChiffres';
import { euros } from '../components/HistoriquePrix';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  Search, Wrench, Smartphone, Package, Plus, Edit3, Trash2,
  X, Loader2, Eye, EyeOff, Maximize2, Minimize2, FileText, Ticket,
  Check, ChevronRight,
} from 'lucide-react';

const fp = (v) => {
  if (v == null) return '0,00';
  return Number(v).toFixed(2).replace('.', ',');
};

// Badge de qualité : « Original » en information (bleu), les autres qualités neutres — le noir reste à l'action
const QUALITE_BADGE = {
  'Original': 'badge-info',
};

const arrondi = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Réparations choisies (prix client TTC de la grille) → lignes du devis, dont le prix unitaire est
 * HORS TAXE (le devis ajoute la TVA). La dernière ligne absorbe l'arrondi : le total TTC du devis
 * (total HT × (1 + TVA), arrondi au centime comme le serveur) retombe exactement sur le TTC affiché
 * (au centime près dans le rare cas où aucun HT à deux décimales n'y mène, ex. 200,79 € à 20 %).
 */
export function lignesDevisHT(reparations, tva = 20) {
  const t = Number(tva);
  const taux = 1 + (Number.isFinite(t) && t >= 0 ? t : 20) / 100;
  const lignes = reparations.map((r) => ({
    description: r.qualite ? `${r.composant} (${r.qualite})` : r.composant,
    quantite: 1,
    prix_unitaire: arrondi((Number(r.prix_vente) || 0) / taux),
  }));
  if (!lignes.length) return lignes;
  const ttc = arrondi(reparations.reduce((s, r) => s + (Number(r.prix_vente) || 0), 0));
  let totalHT = arrondi(ttc / taux);
  for (const ecart of [0, 0.01, -0.01, 0.02, -0.02]) {
    const essai = arrondi(totalHT + ecart);
    if (arrondi(essai * taux) === ttc) { totalHT = essai; break; }
  }
  const autres = arrondi(lignes.slice(0, -1).reduce((s, l) => s + l.prix_unitaire, 0));
  lignes[lignes.length - 1].prix_unitaire = Math.max(0, arrondi(totalHT - autres));
  return lignes;
}

export default function DevisFlashPage() {
  const { user } = useAuth();
  const toast = useToast();
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
  const confirmation = useConfirmDialog();
  const telFormRef = useRef(null);
  useFocusTrap(telFormRef, showTelForm && !confirmation.ouvert, {
    initialFocus: '#tel-form-marque',
    onEscape: () => { if (!telSaving) setShowTelForm(false); },
  });

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
    // Prix de la grille = TTC ; le devis attend des prix unitaires HT (taux de la boutique)
    const tva = selectedModel.tva ?? 20;
    const lignes = lignesDevisHT(selectedRepairs, tva);
    // Store in sessionStorage and navigate to devis page
    sessionStorage.setItem('kp_devis_prefill', JSON.stringify({
      appareil: `${selectedModel.marque} ${selectedModel.modele}`,
      tva,
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
    } catch (e) {
      toast.error(`Téléphone non enregistré : ${e?.message || 'erreur inconnue'}`);
    }
    setTelSaving(false);
  };

  const handleDeleteTel = (t) => {
    const nom = [t.marque, t.modele].filter(Boolean).join(' ') || 'ce téléphone';
    confirmation.demander({
      title: `Supprimer le téléphone ${nom} ?`,
      description: 'Il disparaît de la liste des téléphones en vente. La suppression est définitive.',
      confirmLabel: 'Supprimer le téléphone',
      destructive: true,
      onConfirm: async () => {
        try { await api.deleteTelephoneVente(t.id); invalidateCache('telephones'); loadTelephones(); } catch (e) {
          toast.error(`Suppression impossible : ${e?.message || 'erreur inconnue'}`);
        }
      },
    });
  };

  const handleToggleStock = async (id, currentStock) => {
    try { await api.updateTelephoneVente(id, { en_stock: !currentStock }); invalidateCache('telephones'); loadTelephones(); } catch (e) {
      toast.error(`Stock non modifié : ${e?.message || 'erreur inconnue'}`);
    }
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
  const kioskSubtext = kioskMode ? 'text-slate-300' : 'text-slate-500';
  const kioskCard = kioskMode ? 'bg-slate-800 border border-slate-700 rounded-lg' : 'card';

  return (
    <div className={`page ${kioskMode ? 'fixed inset-0 z-[100] overflow-auto bg-slate-900 text-white text-lg max-w-none' : 'max-w-[1280px]'}`}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className={`page-header-title ${kioskText}`}>Devis Flash</h1>
          <p className={`page-header-subtitle ${kioskSubtext}`}>Consultation rapide des prix de réparation</p>
        </div>
        <div className="page-header-actions">
          <button type="button" onClick={toggleKiosk} className={kioskMode ? 'btn border border-slate-600 bg-slate-800 text-white hover:bg-slate-700' : 'btn-secondary'}>
            {kioskMode ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            {kioskMode ? 'Quitter le mode kiosque' : 'Mode kiosque'}
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
              placeholder="Rechercher un modèle (ex. : iPhone 15 Pro, Galaxy S24…)"
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
                className={`absolute top-full left-0 right-0 mt-2 rounded-lg shadow-md border z-50 max-h-80 overflow-y-auto
                  ${kioskMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-slate-200'}`}>
                {repResults.map((m, i) => {
                  const minPrice = Math.min(...m.reparations.map(r => r.prix_vente));
                  return (
                    <button key={i} type="button" onClick={() => selectModel(m)}
                      className={`w-full flex items-center gap-3 px-4 min-h-14 py-2 text-left transition-colors duration-150 focus:outline-none
                        ${kioskMode ? 'hover:bg-slate-700 focus-visible:bg-slate-700' : 'hover:bg-slate-50 focus-visible:bg-brand-50'}
                        ${i > 0 ? (kioskMode ? 'border-t border-slate-700' : 'border-t border-slate-100') : ''}`}>
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-sm ${kioskText}`}>{m.marque} {m.modele}</p>
                        <p className={`text-xs ${kioskSubtext}`}>{m.reparations.length} réparation{m.reparations.length > 1 ? 's' : ''} disponible{m.reparations.length > 1 ? 's' : ''}</p>
                      </div>
                      <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${kioskText}`}>dès {euros(minPrice)}</span>
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
              <p className={`t-h2 ${kioskText}`}>Aucun résultat pour « {repQuery} »</p>
            </div>
          )}

          {/* ═══ REPAIR CARD ═══ */}
          {selectedModel && (
            <div className={`overflow-hidden ${kioskCard}`}>
              {/* Card header */}
              <div className={`px-4 sm:px-5 py-4 border-b ${kioskMode ? 'border-slate-700' : 'border-slate-100'}`}>
                <div className="min-w-0">
                  <h2 className={`text-xl font-semibold leading-tight tracking-tight ${kioskText}`}>
                    {selectedModel.marque} {selectedModel.modele}
                  </h2>
                  <p className={`text-sm mt-0.5 ${kioskSubtext}`}>
                    {selectedModel.reparations.length} réparation{selectedModel.reparations.length > 1 ? 's' : ''} disponible{selectedModel.reparations.length > 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              {/* Repairs list */}
              <div className={`divide-y ${kioskMode ? 'divide-slate-700' : 'divide-slate-100'}`}>
                {selectedModel.reparations.map((r, i) => {
                  const isChecked = checkedRepairs.has(i);
                  return (
                    <button key={i} type="button"
                      onClick={() => toggleRepair(i)}
                      aria-pressed={isChecked}
                      className={`w-full flex items-center gap-4 px-4 sm:px-5 min-h-14 py-3 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset
                        ${isChecked
                          ? (kioskMode ? 'bg-white/10' : 'bg-brand-50/70')
                          : (kioskMode ? 'hover:bg-slate-700/50' : 'hover:bg-slate-50')}`}>
                      {/* Checkbox */}
                      <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors duration-150
                        ${isChecked ? (kioskMode ? 'bg-white border-white' : 'bg-brand-600 border-brand-600') : (kioskMode ? 'border-slate-500' : 'border-slate-300')}`} aria-hidden="true">
                        {isChecked && <Check className={`w-4 h-4 ${kioskMode ? 'text-slate-900' : 'text-white'}`} />}
                      </div>

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
                      <span className={`text-lg font-semibold tabular-nums whitespace-nowrap shrink-0 ${kioskMode ? 'text-white' : 'text-slate-900'}`}>
                        {euros(r.prix_vente)}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Summary + Actions */}
              {selectedRepairs.length > 0 && (
                <div className={`px-4 sm:px-5 py-5 border-t ${kioskMode ? 'border-slate-600' : 'bg-slate-50 border-slate-200'}`}>
                  {/* Selected items */}
                  <div className="mb-4 space-y-1.5">
                    <p className={`t-h3 mb-2 ${kioskSubtext}`}>
                      Sélectionné ({selectedRepairs.length})
                    </p>
                    {selectedRepairs.map((r, i) => (
                      <div key={i} className={`flex items-center justify-between gap-3 text-sm ${kioskText}`}>
                        <span>{r.qualite ? `${r.composant} (${r.qualite})` : r.composant}</span>
                        <span className="font-medium tabular-nums whitespace-nowrap">{euros(r.prix_vente)}</span>
                      </div>
                    ))}
                  </div>

                  {/* Total */}
                  <div className={`flex items-baseline justify-between gap-3 pt-3 mb-4 border-t ${kioskMode ? 'border-slate-600' : 'border-slate-200'}`}>
                    <span className={`text-base font-semibold ${kioskText}`}>Total TTC</span>
                    <span className={`text-2xl font-semibold tabular-nums whitespace-nowrap ${kioskText}`}>{euros(totalSelected)}</span>
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
            <div className="text-center mt-12 text-slate-300 text-sm">
              Klikphone SAV — Chambéry
            </div>
          )}
        </div>
      )}

      {/* ═══ TELEPHONES TAB ═══ */}
      {activeTab === 'telephones' && (
        <div>
          {/* Stats */}
          {telStats && (
            <CarteChiffres label="Chiffres des téléphones en vente" sombre={kioskMode} colonnes={{ base: 2, xl: 4 }} className="mb-6" chiffres={[
              { label: 'Total', valeur: telStats.total || 0 },
              { label: 'En stock', valeur: telStats.en_stock || 0 },
              { label: 'Marques', valeur: telStats.nb_marques || 0 },
              { label: 'Valeur du stock', valeur: `${fp(telStats.valeur_stock)} €`, montant: true },
            ]} />
          )}

          {/* Search + Filters + Add */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" aria-hidden="true" />
              <input value={telSearch} onChange={e => setTelSearch(e.target.value)} aria-label="Rechercher un téléphone"
                placeholder="Rechercher un téléphone…" className="input pl-9 min-h-11" />
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
                    <div className="flex-1 min-w-0">
                      <p className={`font-semibold text-sm ${kioskText}`}>{t.marque} {t.modele}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`badge badge-sm ${t.etat === 'Neuf' ? 'badge-info' : 'badge-neutral'}`}>
                          {t.etat}
                        </span>
                        {(t.capacite || t.couleur) && (
                          <span className={`text-xs ${kioskSubtext}`}>{[t.capacite, t.couleur].filter(Boolean).join(' · ')}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p className={`text-lg font-semibold tabular-nums whitespace-nowrap ${kioskText}`}>{fp(t.prix_vente)} €</p>
                        {Number(t.prix_achat) > 0 && !kioskMode && <p className="t-caption tabular-nums whitespace-nowrap">Achat : {fp(t.prix_achat)} €</p>}
                      </div>
                      {!kioskMode && (
                        <div className="flex items-center gap-0.5 -mr-2">
                          <button type="button" onClick={() => handleToggleStock(t.id, t.en_stock)}
                            className="btn-ghost btn-icon"
                            title={t.en_stock ? 'En stock' : 'Vendu'} aria-pressed={Boolean(t.en_stock)}
                            aria-label={`En stock : ${t.marque} ${t.modele}`}>
                            {t.en_stock ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                          </button>
                          <button type="button" onClick={() => openEditTel(t)} className="btn-ghost btn-icon" title="Modifier" aria-label={`Modifier ${t.marque} ${t.modele}`}>
                            <Edit3 aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => handleDeleteTel(t)} className="btn-danger-ghost btn-icon" title="Supprimer" aria-label={`Supprimer ${t.marque} ${t.modele}`}>
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
              <div ref={telFormRef} role="dialog" aria-modal="true" aria-labelledby="tel-form-titre" className="modal sm:max-w-md">
                <div className="modal-header">
                  <h2 id="tel-form-titre" className="t-h2">
                    {editTelId ? 'Modifier le téléphone' : 'Ajouter un téléphone'}
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
                        className="input t-mono" placeholder="IMEI" maxLength={20} inputMode="numeric" />
                    </div>
                    <div>
                      <label htmlFor="tel-form-prix-achat" className="input-label">Prix d’achat (€)</label>
                      <input id="tel-form-prix-achat" type="number" value={telForm.prix_achat} onChange={e => setTelForm(f => ({ ...f, prix_achat: parseFloat(e.target.value) || 0 }))}
                        className="input tabular-nums" step="0.01" min="0" />
                    </div>
                    <div>
                      <label htmlFor="tel-form-prix-vente" className="input-label">Prix de vente (€)</label>
                      <input id="tel-form-prix-vente" type="number" value={telForm.prix_vente} onChange={e => setTelForm(f => ({ ...f, prix_vente: parseFloat(e.target.value) || 0 }))}
                        className="input tabular-nums" step="0.01" min="0" />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="tel-form-notes" className="input-label">Notes</label>
                    <textarea id="tel-form-notes" value={telForm.notes} onChange={e => setTelForm(f => ({ ...f, notes: e.target.value }))}
                      className="textarea min-h-20" placeholder="Notes…" />
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
            <div className="text-center mt-12 text-slate-300 text-sm">
              Klikphone SAV — Chambéry
            </div>
          )}
        </div>
      )}

      {confirmation.dialog}
    </div>
  );
}
