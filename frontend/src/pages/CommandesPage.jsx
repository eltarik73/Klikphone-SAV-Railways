import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useApi, invalidateCache } from '../hooks/useApi';
import api from '../lib/api';
import { formatDateShort, formatPrix, waLink } from '../lib/utils';
import { envoyerSms, messageSmsEnvoye } from '../lib/sms';
import { useSmsServeur } from '../hooks/useSmsServeur';
import { matchesQuery } from '../components/SearchPalette';
import {
  Search, Package, Plus, Edit3, Trash2, Save, X,
  Check, Clock, AlertTriangle, ChevronDown, ExternalLink, Calendar,
  Truck, Wrench, Archive, ShoppingCart, UserCheck,
  MessageSquare, Send,
} from 'lucide-react';

const PART_STATUTS = ['Panier', 'En attente', 'Commandée', 'Reçu', 'En réparation', 'Donné au client', 'Clôturé'];
const STATUTS_TERMINAUX = ['Donné au client', 'Clôturé'];

const COMMANDE_STATUS_CONFIG = {
  'Panier': { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-300', color: '#6b7280', icon: ShoppingCart },
  'En attente': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300', color: '#d97706', icon: Clock },
  'Commandée': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300', color: '#2563eb', icon: Package },
  'Reçu': { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-300', color: '#059669', icon: Check },
  'En réparation': { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-300', color: '#7c3aed', icon: Wrench },
  'Donné au client': { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-300', color: '#0d9488', icon: UserCheck },
  'Clôturé': { bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-300', color: '#64748b', icon: Archive },
};

const FILTER_TABS = [
  { label: 'Tous', value: 'all' },
  ...PART_STATUTS.map(s => ({ label: s, value: s })),
];

export default function CommandesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';
  const [searchParams] = useSearchParams();
  const urlQ = searchParams.get('q');
  const [search, setSearch] = useState(() => urlQ || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => (urlQ || '').trim());
  const [filterTab, setFilterTab] = useState('all');
  const searchTimer = useRef(null);
  const [showForm, setShowForm] = useState(false);
  const [editingPart, setEditingPart] = useState(null);
  const [toast, setToast] = useState(null);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [notifPart, setNotifPart] = useState(null);
  const [notifEnvoi, setNotifEnvoi] = useState(false);
  const { actif: smsServeur } = useSmsServeur();
  const [form, setForm] = useState({
    description: '', fournisseur: '', reference: '',
    prix: '', ticket_code: '', statut: 'En attente', notes: '',
  });

  // Debounced search (300ms)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  // Lien depuis la palette de recherche (?q=référence) alors que la page est déjà ouverte
  useEffect(() => {
    if (urlQ !== null) setSearch(urlQ);
  }, [urlQ]);

  // Toast auto-hide
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Une seule liste complète, filtrée localement : la recherche couvre aussi le client,
  // son téléphone, le modèle et la panne du ticket lié (champs joints par l'API).
  const { data: allPartsData, loading } = useApi(
    'commandes:all:counts',
    () => api.getParts({}),
    { tags: ['commandes'], ttl: 60_000 }
  );
  const allParts = allPartsData ?? [];

  const searchedParts = useMemo(() => {
    if (!debouncedSearch) return allParts;
    return allParts.filter(p => matchesQuery([
      p.description, p.fournisseur, p.reference, p.ticket_code, p.notes,
      p.client_prenom, p.client_nom, p.client_tel,
      p.marque, p.modele, p.modele_autre, p.panne,
    ], debouncedSearch));
  }, [allParts, debouncedSearch]);

  const parts = useMemo(
    () => (filterTab === 'all' ? searchedParts : searchedParts.filter(p => p.statut === filterTab)),
    [searchedParts, filterTab]
  );

  const statusCounts = useMemo(() => {
    const counts = { all: searchedParts.length };
    PART_STATUTS.forEach(s => { counts[s] = 0; });
    searchedParts.forEach(p => {
      if (counts[p.statut] !== undefined) counts[p.statut]++;
    });
    return counts;
  }, [searchedParts]);

  const resetForm = () => {
    setForm({ description: '', fournisseur: '', reference: '', prix: '', ticket_code: '', statut: 'En attente', notes: '' });
    setEditingPart(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    try {
      const data = {
        ...form,
        prix: form.prix ? parseFloat(form.prix) : null,
      };
      if (editingPart) {
        await api.updatePart(editingPart.id, data);
        setToast({ type: 'success', msg: 'Commande mise à jour' });
      } else {
        await api.createPart(data);
        setToast({ type: 'success', msg: 'Commande créée' });
      }
      resetForm();
      // Une commande pièce peut auto-changer le statut du ticket lié
      // (parts.py: "Reçu" → ticket "Pièce reçue"). Invalide donc aussi tickets + dashboard.
      invalidateCache('commandes', 'tickets', 'dashboard', 'interactions');
    } catch (err) {
      console.error(err);
      setToast({ type: 'error', msg: 'Erreur lors de la sauvegarde' });
    }
  };

  const handleEdit = (part) => {
    setEditingPart(part);
    setForm({
      description: part.description || '',
      fournisseur: part.fournisseur || '',
      reference: part.reference || '',
      prix: part.prix || '',
      ticket_code: part.ticket_code || '',
      statut: part.statut || 'En attente',
      notes: part.notes || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer cette commande ?')) return;
    try {
      await api.deletePart(id);
      // Une commande pièce peut auto-changer le statut du ticket lié
      // (parts.py: "Reçu" → ticket "Pièce reçue"). Invalide donc aussi tickets + dashboard.
      invalidateCache('commandes', 'tickets', 'dashboard', 'interactions');
      setToast({ type: 'success', msg: 'Commande supprimée' });
    } catch (err) {
      console.error(err);
    }
  };

  const handleStatusChange = async (part, newStatut) => {
    try {
      await api.updatePart(part.id, { statut: newStatut });
      // Une commande pièce peut auto-changer le statut du ticket lié
      // (parts.py: "Reçu" → ticket "Pièce reçue"). Invalide donc aussi tickets + dashboard.
      invalidateCache('commandes', 'tickets', 'dashboard', 'interactions');
      setToast({ type: 'success', msg: `Statut → ${newStatut}` });

      // If changed to "Reçu", show notification modal
      if (newStatut === 'Reçu' && part.client_tel) {
        setNotifPart(part);
        setShowNotifModal(true);
      }
    } catch (err) {
      console.error(err);
      setToast({ type: 'error', msg: 'Erreur changement statut' });
    }
  };

  // Navigation directe par id ; le code saisi à la main passe par la résolution staff authentifiée
  const handleGoToTicket = async (part) => {
    if (part.ticket_id) {
      navigate(`${basePath}/ticket/${part.ticket_id}`);
      return;
    }
    try {
      const r = await api.resolveCode(part.ticket_code);
      if (r?.type === 'ticket' && r.id) navigate(`${basePath}/ticket/${r.id}`);
      else setToast({ type: 'error', msg: `Ticket ${part.ticket_code} introuvable` });
    } catch {
      setToast({ type: 'error', msg: `Ticket ${part.ticket_code} introuvable` });
    }
  };

  const getNotifMessage = (part) => {
    const clientName = [part.client_prenom, part.client_nom].filter(Boolean).join(' ') || 'client';
    const model = [part.marque, part.modele || part.modele_autre].filter(Boolean).join(' ') || 'appareil';
    return `Bonjour ${clientName}, la pièce pour votre ${model} est arrivée ! Merci de prendre rendez-vous pour la réparation. KLIKPHONE - 04 79 60 89 22`;
  };

  const handleNotifSMS = async () => {
    if (!notifPart || notifEnvoi) return;
    const msg = getNotifMessage(notifPart);
    // Envoi par le serveur (Brevo) s'il est activé et la commande liée à un ticket, sinon app Messages
    setNotifEnvoi(true);
    let res;
    try {
      res = await envoyerSms({
        serveur: smsServeur, ticketId: notifPart.ticket_id, tel: notifPart.client_tel, message: msg, libelle: 'Pièce reçue',
      });
    } catch (err) {
      // Refus lisible : la fenêtre reste ouverte (WhatsApp reste possible)
      setToast({ type: 'error', msg: err?.message || 'SMS non envoyé' });
      return;
    } finally {
      setNotifEnvoi(false);
    }

    if (res.mode === 'serveur') {
      // Le serveur a déjà noté le SMS sur le ticket
      setToast({ type: 'success', msg: messageSmsEnvoye(res) });
    } else if (notifPart.ticket_id) {
      try {
        await api.addNote(notifPart.ticket_id, '[PIÈCE] Pièce reçue — Client notifié par SMS');
      } catch (err) {
        console.error('Erreur ajout note:', err);
      }
    }
    setShowNotifModal(false);
    setNotifPart(null);
  };

  const handleNotifWhatsApp = async () => {
    if (!notifPart) return;
    const msg = getNotifMessage(notifPart);
    const link = waLink(notifPart.client_tel, msg);
    window.open(link, '_blank');

    // Add note to ticket
    if (notifPart.ticket_id) {
      try {
        await api.addNote(notifPart.ticket_id, '[PIÈCE] Pièce reçue — Client notifié par WhatsApp');
      } catch (err) {
        console.error('Erreur ajout note:', err);
      }
    }
    setShowNotifModal(false);
    setNotifPart(null);
  };

  const handleNotifDismiss = () => {
    setShowNotifModal(false);
    setNotifPart(null);
  };

  const getStatusConf = (statut) => {
    return COMMANDE_STATUS_CONFIG[statut] || { bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-300', color: '#64748b', icon: Package };
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[100] px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium animate-in
          ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* Notification modal on "Reçu" */}
      {showNotifModal && notifPart && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="notif-piece-titre" className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 animate-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                <Check className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h3 id="notif-piece-titre" className="text-lg font-bold text-slate-900">Pi&egrave;ce re&ccedil;ue !</h3>
                <p className="text-sm text-slate-600">Voulez-vous pr&eacute;venir le client ?</p>
              </div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 mb-5 text-sm text-slate-600 leading-relaxed">
              {getNotifMessage(notifPart)}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button type="button" onClick={handleNotifSMS} disabled={notifEnvoi} aria-busy={notifEnvoi}
                title={smsServeur && notifPart.ticket_id ? 'Envoyer le SMS depuis le serveur (Brevo)' : "Ouvrir l'app Messages de l'appareil"}
                className="flex-1 min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1">
                <MessageSquare className="w-4 h-4" aria-hidden="true" /> {notifEnvoi ? 'Envoi…' : 'SMS'}
              </button>
              <button type="button" onClick={handleNotifWhatsApp} disabled={notifEnvoi}
                className="flex-1 min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1">
                <Send className="w-4 h-4" aria-hidden="true" /> WhatsApp
              </button>
              <button type="button" onClick={handleNotifDismiss} disabled={notifEnvoi}
                className="flex-1 min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1">
                Non merci
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Package className="w-6 h-6 text-brand-600" /> Commandes de pi&egrave;ces
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {allParts.filter(p => !STATUTS_TERMINAUX.includes(p.statut)).length} en cours &mdash; {allParts.filter(p => STATUTS_TERMINAUX.includes(p.statut)).length} cl&ocirc;tur&eacute;e(s)
          </p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary">
          <Plus className="w-4 h-4" /> Nouvelle commande
        </button>
      </div>

      {/* Search & Filter Tabs */}
      <div className="card overflow-hidden mb-6">
        <div className="p-3 sm:p-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
            <label htmlFor="commandes-search" className="sr-only">Rechercher une commande de pièce</label>
            <input id="commandes-search" type="text" placeholder="Pièce, référence, fournisseur, client, modèle, ticket..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
              className="w-full min-h-[44px] pl-10 pr-11 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 text-base sm:text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 focus:bg-white transition-colors"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Effacer la recherche"
                className="absolute right-0.5 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <div className="px-3 sm:px-4 py-2 flex gap-1 overflow-x-auto scrollbar-none bg-slate-50/50">
          {FILTER_TABS.map(tab => {
            const count = statusCounts[tab.value] ?? 0;
            const isActive = filterTab === tab.value;
            const conf = tab.value !== 'all' ? getStatusConf(tab.value) : null;
            const IconComp = conf?.icon;
            return (
              <button key={tab.value} type="button" onClick={() => setFilterTab(tab.value)}
                aria-pressed={isActive}
                className={`px-3 py-1.5 min-h-[44px] rounded-md text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5
                  ${isActive ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:shadow-sm'}`}>
                {IconComp && <IconComp className="w-3.5 h-3.5" aria-hidden="true" />}
                {tab.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="card p-5 mb-6 border-brand-200 animate-in">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-800">
              {editingPart ? 'Modifier la commande' : 'Nouvelle commande'}
            </h2>
            <button onClick={resetForm} className="btn-ghost p-1.5">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="input-label">D&eacute;signation *</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input" placeholder="&Eacute;cran iPhone 15..." />
            </div>
            <div>
              <label className="input-label">Fournisseur</label>
              <input value={form.fournisseur} onChange={e => setForm(f => ({ ...f, fournisseur: e.target.value }))} className="input" placeholder="Nom fournisseur" />
            </div>
            <div>
              <label className="input-label">R&eacute;f&eacute;rence</label>
              <input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} className="input font-mono" placeholder="REF-001" />
            </div>
            <div>
              <label className="input-label">Prix (&euro;)</label>
              <input type="number" step="0.01" value={form.prix} onChange={e => setForm(f => ({ ...f, prix: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="input-label">Ticket associ&eacute;</label>
              <input value={form.ticket_code} onChange={e => setForm(f => ({ ...f, ticket_code: e.target.value }))} className="input font-mono" placeholder="KP-000001" />
            </div>
            <div>
              <label className="input-label">Statut</label>
              <select value={form.statut} onChange={e => setForm(f => ({ ...f, statut: e.target.value }))} className="input">
                {PART_STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <label className="input-label">Notes</label>
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input" placeholder="Notes..." />
            </div>
          </div>
          <div className="flex justify-end mt-4 pt-3 border-t border-slate-100">
            <button onClick={handleSubmit} disabled={!form.description} className="btn-primary">
              <Save className="w-4 h-4" /> {editingPart ? 'Mettre à jour' : 'Créer'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="hidden lg:grid grid-cols-[1fr_140px_130px_130px_100px_80px_100px_140px_70px] gap-3 items-center px-5 py-3 bg-slate-50/80 border-b border-slate-100">
          <span className="table-header">D&eacute;signation</span>
          <span className="table-header">Mod&egrave;le</span>
          <span className="table-header">Client</span>
          <span className="table-header">Fournisseur</span>
          <span className="table-header">Panne</span>
          <span className="table-header text-right">Prix</span>
          <span className="table-header">Dates</span>
          <span className="table-header">Statut</span>
          <span className="table-header text-right">Actions</span>
        </div>

        {loading ? (
          <div className="py-16 text-center" role="status">
            <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full motion-safe:animate-spin mx-auto mb-3" aria-hidden="true" />
            <p className="text-sm text-slate-500">Chargement...</p>
          </div>
        ) : parts.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Package className="w-7 h-7 text-slate-300" />
            </div>
            <p className="text-slate-600 font-medium">
              {debouncedSearch ? `Aucune commande ne correspond à « ${debouncedSearch} »` : 'Aucune commande'}
            </p>
            <p className="text-sm text-slate-500 mt-1">
              {debouncedSearch
                ? (filterTab !== 'all' && searchedParts.length > 0
                  ? `${searchedParts.length} résultat(s) avec un autre statut : choisissez l’onglet « Tous ».`
                  : 'Essayez le nom du client, le modèle, la référence ou le code du ticket.')
                : filterTab === 'all' ? 'Créez votre première commande de pièce' : `Aucune commande avec le statut "${filterTab}"`}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100/80">
            {parts.map((p) => {
              const conf = getStatusConf(p.statut);
              const StatusIcon = conf.icon;
              const clientFullName = [p.client_prenom, p.client_nom].filter(Boolean).join(' ');
              const modelText = [p.marque, p.modele || p.modele_autre].filter(Boolean).join(' ');
              const panneText = p.panne || '—';

              return (
                <div key={p.id}
                  className="lg:grid lg:grid-cols-[1fr_140px_130px_130px_100px_80px_100px_140px_70px] gap-3 items-center px-4 sm:px-5 py-3.5 hover:bg-slate-50 transition-colors"
                >
                  {/* Désignation */}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate" title={p.description}>{p.description}</p>
                    {p.ticket_code && (
                      <button type="button" onClick={() => handleGoToTicket(p)}
                        aria-label={`Ouvrir la fiche du ticket ${p.ticket_code}`}
                        className="min-h-[32px] text-xs text-brand-700 font-mono hover:text-brand-800 hover:underline flex items-center gap-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                        {p.ticket_code} <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                      </button>
                    )}
                    {(modelText || clientFullName) && (
                      <p className="lg:hidden text-xs text-slate-600 truncate">{[modelText, clientFullName].filter(Boolean).join(' · ')}</p>
                    )}
                    {p.notes && <p className="text-xs text-slate-400 mt-0.5 truncate" title={p.notes}>{p.notes}</p>}
                  </div>

                  {/* Modèle */}
                  <div className="hidden lg:block min-w-0">
                    <p className="text-sm text-slate-600 truncate" title={modelText}>{modelText || '—'}</p>
                  </div>

                  {/* Client */}
                  <div className="hidden lg:block min-w-0">
                    <p className="text-sm text-slate-700 truncate" title={clientFullName}>{clientFullName || '—'}</p>
                    {p.client_tel && <p className="text-[11px] text-slate-400 font-mono">{p.client_tel}</p>}
                  </div>

                  {/* Fournisseur */}
                  <div className="hidden lg:block min-w-0">
                    <p className="text-sm text-slate-600 truncate" title={p.fournisseur || '—'}>{p.fournisseur || '—'}</p>
                  </div>

                  {/* Panne */}
                  <div className="hidden lg:block min-w-0">
                    <p className="text-xs text-slate-500 truncate" title={panneText}>{panneText}</p>
                  </div>

                  {/* Prix */}
                  <div className="hidden lg:block text-right">
                    <p className="text-sm font-medium text-slate-800">{p.prix ? formatPrix(p.prix) : '—'}</p>
                  </div>

                  {/* Dates */}
                  <div className="hidden lg:block">
                    <p className="text-[11px] text-slate-500">
                      <Calendar className="w-3 h-3 inline mr-0.5" />
                      {p.date_creation ? formatDateShort(p.date_creation) : '—'}
                    </p>
                    {p.date_commande && (
                      <p className="text-[10px] text-blue-500">Cmd: {formatDateShort(p.date_commande)}</p>
                    )}
                    {p.date_reception && (
                      <p className="text-[10px] text-emerald-500">Re&ccedil;ue: {formatDateShort(p.date_reception)}</p>
                    )}
                  </div>

                  {/* Status dropdown */}
                  <div className="mt-2 lg:mt-0" onClick={e => e.stopPropagation()}>
                    <select
                      value={p.statut}
                      onChange={e => handleStatusChange(p, e.target.value)}
                      className="w-full min-w-[130px] py-1.5 px-2 text-[11px] font-semibold rounded-lg border-2 cursor-pointer appearance-none bg-no-repeat truncate"
                      style={{
                        borderColor: conf.color,
                        color: conf.color,
                        backgroundColor: conf.color + '10',
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(conf.color)}' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                        backgroundPosition: 'right 4px center',
                        backgroundSize: '14px',
                        paddingRight: '22px',
                      }}
                    >
                      {PART_STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  {/* Actions */}
                  <div className="hidden lg:flex justify-end gap-1">
                    <button onClick={() => handleEdit(p)} className="btn-ghost p-1.5" title="Modifier">
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="btn-ghost p-1.5" title="Supprimer">
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
