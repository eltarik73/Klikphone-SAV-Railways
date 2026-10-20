import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useSearchParams } from 'react-router-dom';
import { invalidateCache } from '../hooks/useApi';
import { useFocusTrap } from '../hooks/useFocusTrap';
import api from '../lib/api';
import { useToast } from '../components/Toast';
import PrintPreview from '../components/PrintPreview';
import {
  FileText, Plus, Search, Filter, Eye, Edit3, Trash2, Copy,
  Send, CheckCircle, XCircle, ArrowRightCircle, Printer,
  Loader2, X, ChevronDown, Package, Euro, AlertTriangle,
  BarChart3, Clock, TrendingUp, User, Phone,
} from 'lucide-react';

const STATUTS = ['Brouillon', 'Envoyé', 'Accepté', 'Refusé', 'Converti'];
// Badges du système : la couleur ne porte que le statut (bleu = envoyé, vert = accepté, rouge = refusé, violet = converti)
const STATUT_BADGE = {
  Brouillon: 'badge-neutral',
  Envoyé: 'badge-info',
  Accepté: 'badge-success',
  Refusé: 'badge-danger',
  Converti: 'badge-brand',
};
const badgeStatut = (statut) => STATUT_BADGE[statut] || STATUT_BADGE.Brouillon;

const fp = (v) => {
  if (v == null) return '0,00';
  return Number(v).toFixed(2).replace('.', ',');
};

export default function DevisPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  // Lien de la recherche globale : ?id= ouvre le devis ; ?q= (numéro) filtre la liste, aussi en
  // repli si le devis est introuvable. Un ?q= seul initialise le filtre (une seule requête).
  const urlId = searchParams.get('id');
  const urlQ = searchParams.get('q');
  const [devisList, setDevisList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(() => (!urlId && urlQ) || '');
  const [search, setSearch] = useState(() => ((!urlId && urlQ) || '').trim());
  const [filterStatut, setFilterStatut] = useState('');
  const [stats, setStats] = useState(null);
  const loadSeq = useRef(0);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(getEmptyForm());
  const [lignes, setLignes] = useState([{ description: '', quantite: 1, prix_unitaire: 0 }]);

  // Client autocomplete
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [showNewClientFields, setShowNewClientFields] = useState(false);
  const clientTimer = useRef(null);
  const clientDropdownRef = useRef(null);

  // Detail view
  const [viewDevis, setViewDevis] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [printDevis, setPrintDevis] = useState(null);

  // Fenêtres modales : focus piégé, Échap, focus rendu à la fermeture. Le piège du détail se lève
  // pendant l'aperçu d'impression (PrintPreview a le sien, hors de #root, et gère Échap lui-même).
  const formModalRef = useRef(null);
  const detailModalRef = useRef(null);
  useFocusTrap(formModalRef, showModal, {
    initialFocus: '.modal-body input, .modal-body button, .modal-body select, .modal-body textarea',
    onEscape: () => {
      if (showClientDropdown) setShowClientDropdown(false);
      else if (!saving) setShowModal(false);
    },
  });
  useFocusTrap(detailModalRef, Boolean(showDetail && viewDevis && !printDevis), { onEscape: () => setShowDetail(false) });

  const printDocuments = useMemo(() => (printDevis ? [{
    id: 'devis',
    label: 'Devis',
    desc: 'Devis A4',
    icon: FileText,
    formats: {
      a4: {
        paper: 'a4',
        label: 'A4',
        load: (signal) => api.getDevisPrintHtml(printDevis.id, { signal }).then((html) => ({ kind: 'html', html })),
      },
    },
  }] : []), [printDevis]);

  function getEmptyForm() {
    return {
      client_id: null, client_nom: '', client_prenom: '', client_tel: '', client_email: '',
      appareil: '', description: '', tva: 20, remise: 0, notes: '', validite_jours: 30,
    };
  }

  // Handle prefill from Devis Flash
  useEffect(() => {
    if (searchParams.get('create') === '1') {
      const raw = sessionStorage.getItem('kp_devis_prefill');
      if (raw) {
        try {
          const prefill = JSON.parse(raw);
          sessionStorage.removeItem('kp_devis_prefill');
          setEditId(null);
          // Devis Flash transmet des prix unitaires HT et le taux de TVA de la boutique
          setForm(f => ({ ...getEmptyForm(), appareil: prefill.appareil || '', tva: prefill.tva ?? 20 }));
          if (prefill.lignes?.length) {
            setLignes(prefill.lignes.map(l => ({
              description: l.description || '', quantite: l.quantite || 1, prix_unitaire: l.prix_unitaire || 0,
            })));
          }
          setSelectedClient(null);
          setShowNewClientFields(false);
          setClientQuery('');
          setShowModal(true);
        } catch { /* ignore */ }
      } else {
        openCreate();
      }
    }
  }, []);

  // Client search
  useEffect(() => {
    clearTimeout(clientTimer.current);
    if (!clientQuery || clientQuery.length < 2) {
      setClientResults([]);
      setShowClientDropdown(false);
      return;
    }
    clientTimer.current = setTimeout(async () => {
      setClientSearching(true);
      try {
        const res = await api.getClients({ search: clientQuery, limit: 8 });
        setClientResults(res || []);
        setShowClientDropdown(true);
      } catch { setClientResults([]); }
      setClientSearching(false);
    }, 200);
    return () => clearTimeout(clientTimer.current);
  }, [clientQuery]);

  // Close client dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target)) {
        setShowClientDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectClient = (client) => {
    setSelectedClient(client);
    setForm(f => ({
      ...f,
      client_id: client.id,
      client_nom: client.nom || '',
      client_prenom: client.prenom || '',
      client_tel: client.telephone || '',
      client_email: client.email || '',
    }));
    setClientQuery(`${client.prenom || ''} ${client.nom || ''}`.trim());
    setShowClientDropdown(false);
    setShowNewClientFields(false);
  };

  const clearClient = () => {
    setSelectedClient(null);
    setClientQuery('');
    setForm(f => ({ ...f, client_id: null, client_nom: '', client_prenom: '', client_tel: '', client_email: '' }));
    setShowNewClientFields(false);
  };

  const loadData = async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (filterStatut) params.statut = filterStatut;
      const [list, st] = await Promise.all([api.getDevis(params), api.getDevisStats()]);
      if (seq !== loadSeq.current) return;
      setDevisList(list || []);
      setStats(st);
    } catch (e) {
      console.error(e);
    }
    if (seq === loadSeq.current) setLoading(false);
  };

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { loadData(); }, [search, filterStatut]);

  useEffect(() => {
    if (!urlId && !urlQ) return undefined;
    let annule = false;
    const filtrer = () => {
      if (urlQ == null) return;
      setSearchInput(urlQ);
      setSearch(urlQ.trim());
    };
    if (urlId) {
      api.getDevisById(urlId)
        .then((d) => {
          if (annule || !d) return;
          setViewDevis(d);
          setShowDetail(true);
        })
        .catch(() => { if (!annule) filtrer(); });
    } else {
      filtrer();
    }
    return () => { annule = true; };
  }, [urlId, urlQ]);

  const openCreate = () => {
    setEditId(null);
    setForm(getEmptyForm());
    setLignes([{ description: '', quantite: 1, prix_unitaire: 0 }]);
    setSelectedClient(null);
    setClientQuery('');
    setShowNewClientFields(false);
    setShowModal(true);
  };

  const openEdit = async (id) => {
    try {
      const d = await api.getDevisById(id);
      setEditId(id);
      setForm({
        client_id: d.client_id || null,
        client_nom: d.client_nom || '', client_prenom: d.client_prenom || '',
        client_tel: d.client_tel || '', client_email: d.client_email || '',
        appareil: d.appareil || '', description: d.description || '',
        // ?? et non || : une TVA de 0 % (franchise) ou une remise nulle sont des valeurs
        tva: Number(d.tva ?? 20), remise: Number(d.remise ?? 0), notes: d.notes || '',
        validite_jours: d.validite_jours ?? 30,
      });
      if (d.client_id && d.client) {
        setSelectedClient(d.client);
        setClientQuery(`${d.client.prenom || ''} ${d.client.nom || ''}`.trim());
        setShowNewClientFields(false);
      } else if (d.client_nom) {
        setSelectedClient(null);
        setClientQuery('');
        setShowNewClientFields(true);
      } else {
        setSelectedClient(null);
        setClientQuery('');
        setShowNewClientFields(false);
      }
      setLignes(d.lignes?.length > 0 ? d.lignes.map(l => ({
        description: l.description, quantite: l.quantite, prix_unitaire: Number(l.prix_unitaire),
      })) : [{ description: '', quantite: 1, prix_unitaire: 0 }]);
      setShowModal(true);
    } catch { /* ignore */ }
  };

  const openView = async (id) => {
    try {
      const d = await api.getDevisById(id);
      setViewDevis(d);
      setShowDetail(true);
    } catch { /* ignore */ }
  };

  const totalHT = useMemo(() => {
    const sum = lignes.reduce((a, l) => a + (l.quantite || 0) * (l.prix_unitaire || 0), 0);
    return Math.max(0, sum - (form.remise || 0));
  }, [lignes, form.remise]);

  const totalTTC = useMemo(() => totalHT * (1 + (form.tva || 0) / 100), [totalHT, form.tva]);

  const handleSave = async () => {
    if (!form.client_nom && !form.client_tel && !form.client_id) return;
    setSaving(true);
    try {
      const validLignes = lignes.filter(l => l.description.trim());
      const payload = { ...form, lignes: validLignes };
      if (editId) {
        await api.updateDevis(editId, payload);
      } else {
        await api.createDevis(payload);
      }
      invalidateCache('devis');
      setShowModal(false);
      loadData();
    } catch (e) {
      toast.error(`Devis non enregistré : ${e?.message || 'erreur inconnue'}`);
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer ce devis ?')) return;
    try {
      await api.deleteDevis(id);
      invalidateCache('devis');
      loadData();
    } catch { /* ignore */ }
  };

  const handleStatusChange = async (id, statut) => {
    try {
      await api.updateDevis(id, { statut });
      invalidateCache('devis');
      loadData();
      if (showDetail && viewDevis?.id === id) {
        setViewDevis(v => ({ ...v, statut }));
      }
    } catch { /* ignore */ }
  };

  const handleConvert = async (id) => {
    if (!confirm('Convertir ce devis en ticket SAV ?')) return;
    try {
      const res = await api.convertDevisToTicket(id);
      alert(`Ticket créé: ${res.ticket_code}`);
      // 'clients' : la conversion peut créer un nouveau client en base
      invalidateCache('devis', 'tickets', 'clients', 'interactions');
      loadData();
      setShowDetail(false);
    } catch (e) {
      alert('Erreur: ' + e.message);
    }
  };

  const handleDuplicate = async (id) => {
    try {
      await api.duplicateDevis(id);
      invalidateCache('devis');
      loadData();
    } catch { /* ignore */ }
  };

  const addLigne = () => setLignes(l => [...l, { description: '', quantite: 1, prix_unitaire: 0 }]);
  const removeLigne = (i) => setLignes(l => l.filter((_, idx) => idx !== i));
  const updateLigne = (i, field, val) => setLignes(l => l.map((item, idx) => idx === i ? { ...item, [field]: val } : item));

  return (
    <div className="page max-w-[1280px]">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Devis</h1>
          <p className="page-header-subtitle">Gestion des devis clients</p>
        </div>
        <div className="page-header-actions">
          <button type="button" onClick={openCreate} className="btn-primary">
            <Plus aria-hidden="true" /> Nouveau devis
          </button>
        </div>
      </div>

      {/* Stats cards : grille rendue dès le premier affichage (valeurs en squelette), la liste ne saute pas */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6" aria-busy={!stats}>
        {[
          { cle: 'total', label: 'Total', icon: FileText, valeur: stats?.total || 0 },
          { cle: 'acceptes', label: 'Acceptés', icon: CheckCircle, valeur: stats?.acceptes || 0, iconClass: 'bg-emerald-50 text-emerald-700' },
          { cle: 'envoyes', label: 'En attente', icon: Clock, valeur: stats?.envoyes || 0 },
          { cle: 'ca', label: 'CA Accepté', icon: TrendingUp, valeur: `${fp(stats?.ca_accepte)} €`, montant: true },
        ].map(({ cle, label, icon: Icone, valeur, iconClass = '', montant }) => (
          <div key={cle} className="kpi-card">
            {/* Montant : sans icône sous sm, pour que « 12345,67 € » tienne dans la demi-largeur */}
            <div className={`kpi-icon ${iconClass} ${montant ? 'hidden sm:flex' : ''}`} aria-hidden="true"><Icone /></div>
            <div className="min-w-0">
              {stats
                ? <p className={`kpi-value ${montant ? 'whitespace-nowrap text-xl sm:text-2xl' : ''}`}>{valeur}</p>
                : <p className="kpi-value" aria-hidden="true"><span className="skeleton-line block w-14 h-6" /></p>}
              <p className="kpi-label">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" aria-hidden="true" />
          <input type="search" value={searchInput} onChange={e => setSearchInput(e.target.value)}
            placeholder="Rechercher par nom, téléphone, numéro..."
            aria-label="Rechercher un devis"
            className="input pl-9 min-h-11" />
        </div>
        <select value={filterStatut} onChange={e => setFilterStatut(e.target.value)}
          aria-label="Filtrer par statut"
          className="select sm:w-auto sm:min-w-[160px] min-h-11">
          <option value="">Tous statuts</option>
          {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2" role="status">
          {[1, 2, 3].map(i => <div key={i} className="skeleton h-[72px]" aria-hidden="true" />)}
          <p className="sr-only">Chargement…</p>
        </div>
      ) : devisList.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon">
            <FileText aria-hidden="true" />
          </div>
          <p className="t-h2">Aucun devis</p>
          <p className="t-body text-slate-500 max-w-sm">Créez votre premier devis</p>
        </div>
      ) : (
        <div className="space-y-2">
          {devisList.map(d => (
            <div key={d.id} className="list-card p-3 sm:p-4" onClick={() => openView(d.id)}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0" aria-hidden="true">
                    <FileText className="w-5 h-5 text-slate-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button type="button" onClick={(e) => { e.stopPropagation(); openView(d.id); }}
                        aria-label={`Ouvrir le devis ${d.numero}`}
                        className="t-mono font-semibold text-slate-900 whitespace-nowrap min-h-8 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:-my-1.5 inline-flex items-center rounded hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                        {d.numero}
                      </button>
                      <span className={`badge ${badgeStatut(d.statut)}`}>
                        {d.statut}
                      </span>
                    </div>
                    <p className="t-small mt-0.5 truncate">
                      {d.client_prenom} {d.client_nom}
                      {d.appareil ? ` — ${d.appareil}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="t-num whitespace-nowrap">{fp(d.total_ttc)} €</p>
                    <p className="t-caption tabular-nums">
                      {d.date_creation ? new Date(d.date_creation).toLocaleDateString('fr-FR') : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-0.5 shrink-0 -mr-2 sm:-my-2" onClick={e => e.stopPropagation()}>
                  <button type="button" onClick={() => openEdit(d.id)} className="btn-ghost btn-icon" title="Modifier" aria-label={`Modifier le devis ${d.numero}`}>
                    <Edit3 aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => handleDuplicate(d.id)} className="btn-ghost btn-icon" title="Dupliquer" aria-label={`Dupliquer le devis ${d.numero}`}>
                    <Copy aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => handleDelete(d.id)} className="btn-danger-ghost btn-icon" title="Supprimer" aria-label={`Supprimer le devis ${d.numero}`}>
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ CREATE/EDIT MODAL ═══ */}
      {showModal && (
        <div className="modal-overlay">
          <div ref={formModalRef} role="dialog" aria-modal="true" aria-labelledby="devis-form-titre" className="modal sm:max-w-2xl">
            <div className="modal-header">
              <h2 id="devis-form-titre" className="t-h2">
                {editId ? 'Modifier le devis' : 'Nouveau devis'}
              </h2>
              <button type="button" onClick={() => setShowModal(false)} className="btn-ghost btn-icon -mr-2" aria-label="Fermer">
                <X aria-hidden="true" />
              </button>
            </div>

            <div className="modal-body space-y-6">
              {/* Client */}
              <div>
                <h3 className="t-h3 mb-2">Client</h3>

                {/* Client selected → show info */}
                {selectedClient ? (
                  <div className="card-section flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center shrink-0" aria-hidden="true">
                      <span className="text-sm font-bold text-brand-700">
                        {(selectedClient.prenom?.[0] || '').toUpperCase()}{(selectedClient.nom?.[0] || '').toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-slate-900">{selectedClient.prenom} {selectedClient.nom}</p>
                      <div className="flex items-center gap-3 t-small mt-0.5 min-w-0">
                        {selectedClient.telephone && <span className="flex items-center gap-1 tabular-nums whitespace-nowrap"><Phone className="w-3.5 h-3.5" aria-hidden="true" /> {selectedClient.telephone}</span>}
                        {selectedClient.email && <span className="truncate">{selectedClient.email}</span>}
                      </div>
                    </div>
                    <button type="button" onClick={clearClient} className="btn-ghost btn-icon shrink-0" aria-label="Retirer le client">
                      <X aria-hidden="true" />
                    </button>
                  </div>
                ) : !showNewClientFields ? (
                  /* Client search */
                  <div className="space-y-2">
                    <div className="relative" ref={clientDropdownRef}>
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" aria-hidden="true" />
                      <input value={clientQuery}
                        onChange={e => setClientQuery(e.target.value)}
                        placeholder="Nom, prénom ou téléphone..."
                        aria-label="Rechercher un client"
                        className="input pl-9 pr-9" />
                      {clientSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 motion-safe:animate-spin text-brand-600" aria-hidden="true" />}

                      {showClientDropdown && clientResults.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-slate-200 z-50 max-h-52 overflow-y-auto">
                          {clientResults.map(c => (
                            <button key={c.id} type="button" onClick={() => selectClient(c)}
                              className="w-full flex items-center gap-3 px-3 min-h-11 py-1.5 hover:bg-slate-50 text-left border-b border-slate-100 last:border-0 transition-colors duration-150 focus:outline-none focus-visible:bg-brand-50">
                              <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center shrink-0" aria-hidden="true">
                                <span className="text-xs font-bold text-brand-700">
                                  {(c.prenom?.[0] || '').toUpperCase()}{(c.nom?.[0] || '').toUpperCase()}
                                </span>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-800 truncate">{c.prenom} {c.nom}</p>
                                <p className="t-caption tabular-nums">{c.telephone || ''}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => setShowNewClientFields(true)}
                      className="btn-ghost btn-sm text-brand-700 -ml-3">
                      <Plus aria-hidden="true" /> Nouveau client
                    </button>
                  </div>
                ) : (
                  /* New client fields */
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="t-caption">Nouveau client</span>
                      <button type="button" onClick={() => { setShowNewClientFields(false); clearClient(); }}
                        className="btn-ghost btn-sm text-brand-700 -mr-3">
                        <Search aria-hidden="true" /> Rechercher
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                      <div>
                        <label htmlFor="devis-client-nom" className="input-label">Nom *</label>
                        <input id="devis-client-nom" value={form.client_nom} onChange={e => setForm(f => ({ ...f, client_nom: e.target.value }))}
                          className="input" placeholder="Dupont" />
                      </div>
                      <div>
                        <label htmlFor="devis-client-prenom" className="input-label">Prénom</label>
                        <input id="devis-client-prenom" value={form.client_prenom} onChange={e => setForm(f => ({ ...f, client_prenom: e.target.value }))}
                          className="input" placeholder="Jean" />
                      </div>
                      <div>
                        <label htmlFor="devis-client-tel" className="input-label">Téléphone</label>
                        <input id="devis-client-tel" type="tel" value={form.client_tel} onChange={e => setForm(f => ({ ...f, client_tel: e.target.value }))}
                          className="input tabular-nums" placeholder="06 XX XX XX XX" />
                      </div>
                      <div>
                        <label htmlFor="devis-client-email" className="input-label">Email</label>
                        <input id="devis-client-email" type="email" value={form.client_email} onChange={e => setForm(f => ({ ...f, client_email: e.target.value }))}
                          className="input" placeholder="email@exemple.com" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Appareil */}
              <div>
                <h3 className="t-h3 mb-2">Appareil & Description</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                  <div>
                    <label htmlFor="devis-appareil" className="input-label">Appareil</label>
                    <input id="devis-appareil" value={form.appareil} onChange={e => setForm(f => ({ ...f, appareil: e.target.value }))}
                      className="input" placeholder="iPhone 15 Pro Max" />
                  </div>
                  <div>
                    <label htmlFor="devis-description" className="input-label">Description</label>
                    <input id="devis-description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      className="input" placeholder="Remplacement écran OLED" />
                  </div>
                </div>
              </div>

              {/* Lignes */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="t-h3">Lignes du devis</h3>
                    <p className="t-caption">Prix unitaire HT : la TVA s'ajoute au total</p>
                  </div>
                  <button type="button" onClick={addLigne} className="btn-ghost btn-sm text-brand-700 -mr-3">
                    <Plus aria-hidden="true" /> Ajouter
                  </button>
                </div>
                <div className="space-y-2">
                  {lignes.map((l, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={l.description} onChange={e => updateLigne(i, 'description', e.target.value)}
                        placeholder="Description" aria-label={`Description de la ligne ${i + 1}`} className="input flex-1 min-w-0" />
                      <input type="number" value={l.quantite} onChange={e => updateLigne(i, 'quantite', parseInt(e.target.value) || 1)}
                        aria-label={`Quantité de la ligne ${i + 1}`} className="input w-16 text-center tabular-nums" min="1" max="100" />
                      <div className="relative">
                        <input type="number" value={l.prix_unitaire} onChange={e => updateLigne(i, 'prix_unitaire', parseFloat(e.target.value) || 0)}
                          aria-label={`Prix unitaire HT de la ligne ${i + 1}`} className="input w-24 pr-7 text-right tabular-nums" step="0.01" min="0" />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500" aria-hidden="true">€</span>
                      </div>
                      <span className="t-num text-sm w-20 text-right whitespace-nowrap hidden sm:inline">{fp((l.quantite || 0) * (l.prix_unitaire || 0))} €</span>
                      {lignes.length > 1 && (
                        <button type="button" onClick={() => removeLigne(i)} className="btn-danger-ghost btn-icon shrink-0" aria-label={`Supprimer la ligne ${i + 1}`}>
                          <X aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="card-section">
                <div className="grid grid-cols-3 gap-x-3 gap-y-3 mb-4">
                  <div>
                    <label htmlFor="devis-tva" className="input-label">TVA (%)</label>
                    <input id="devis-tva" type="number" value={form.tva} onChange={e => setForm(f => ({ ...f, tva: parseFloat(e.target.value) || 0 }))}
                      className="input tabular-nums" step="0.1" min="0" max="30" />
                  </div>
                  <div>
                    <label htmlFor="devis-remise" className="input-label">Remise (€)</label>
                    <input id="devis-remise" type="number" value={form.remise} onChange={e => setForm(f => ({ ...f, remise: parseFloat(e.target.value) || 0 }))}
                      className="input tabular-nums" step="0.01" min="0" />
                  </div>
                  <div>
                    <label htmlFor="devis-validite" className="input-label">Validité (jours)</label>
                    <input id="devis-validite" type="number" value={form.validite_jours} onChange={e => setForm(f => ({ ...f, validite_jours: parseInt(e.target.value) || 30 }))}
                      className="input tabular-nums" min="1" max="365" />
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Total HT</span>
                  <span className="t-num">{fp(totalHT)} €</span>
                </div>
                <div className="flex items-center justify-between text-lg font-bold mt-2 pt-2 border-t border-slate-200">
                  <span className="text-slate-900">Total TTC</span>
                  <span className="text-brand-700 tabular-nums">{fp(totalTTC)} €</span>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label htmlFor="devis-notes" className="input-label">Notes</label>
                <textarea id="devis-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="textarea min-h-[80px]" placeholder="Notes internes ou conditions..." />
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" onClick={() => setShowModal(false)} className="btn-ghost">Annuler</button>
              <button type="button" onClick={handleSave} disabled={saving || (!form.client_nom && !form.client_tel && !form.client_id)}
                className="btn-primary">
                {saving ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <FileText aria-hidden="true" />}
                {editId ? 'Enregistrer' : 'Créer le devis'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ DETAIL MODAL ═══ */}
      {showDetail && viewDevis && (
        <div className="modal-overlay">
          <div ref={detailModalRef} role="dialog" aria-modal="true" aria-labelledby="devis-detail-titre" className="modal sm:max-w-2xl">
            <div className="modal-header">
              <div className="flex items-center gap-3 min-w-0 flex-wrap">
                <h2 id="devis-detail-titre" className="t-h2 t-mono text-base">{viewDevis.numero}</h2>
                <span className={`badge ${badgeStatut(viewDevis.statut)}`}>
                  {viewDevis.statut}
                </span>
              </div>
              <button type="button" onClick={() => setShowDetail(false)} aria-label="Fermer le détail du devis"
                className="btn-ghost btn-icon -mr-2">
                <X aria-hidden="true" />
              </button>
            </div>

            <div className="modal-body space-y-5">
              {/* Client info */}
              <div className="card-section">
                <p className="t-h3 mb-2">Client</p>
                {viewDevis.client ? (
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center shrink-0" aria-hidden="true">
                      <span className="text-sm font-bold text-brand-700">
                        {(viewDevis.client.prenom?.[0] || '').toUpperCase()}{(viewDevis.client.nom?.[0] || '').toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{viewDevis.client.prenom} {viewDevis.client.nom}</p>
                      <div className="flex items-center gap-3 text-sm text-slate-600 min-w-0">
                        {viewDevis.client.telephone && <span className="flex items-center gap-1 tabular-nums whitespace-nowrap"><Phone className="w-3.5 h-3.5" aria-hidden="true" /> {viewDevis.client.telephone}</span>}
                        {viewDevis.client.email && <span className="truncate">{viewDevis.client.email}</span>}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="font-semibold text-slate-900">{viewDevis.client_prenom} {viewDevis.client_nom}</p>
                    <p className="text-sm text-slate-600">{viewDevis.client_tel} {viewDevis.client_email ? `— ${viewDevis.client_email}` : ''}</p>
                  </>
                )}
                {viewDevis.appareil && <p className="text-sm text-slate-700 mt-2"><b>Appareil:</b> {viewDevis.appareil}</p>}
                {viewDevis.description && <p className="text-sm text-slate-600 mt-1">{viewDevis.description}</p>}
              </div>

              {/* Lines */}
              {viewDevis.lignes?.length > 0 && (
                <div>
                  <p className="t-h3 mb-1">Détail</p>
                  <div className="divide-y divide-slate-100">
                    {viewDevis.lignes.map((l, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 py-2.5 min-h-12">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800">{l.description}</p>
                          <p className="t-caption tabular-nums">{l.quantite} x {fp(l.prix_unitaire)} € HT</p>
                        </div>
                        <span className="t-num text-sm whitespace-nowrap">{fp(l.total)} €</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Totals */}
              <div className="card-section tabular-nums">
                {/* total_ht est net de la remise : avant elle, la somme des lignes */}
                {Number(viewDevis.remise) > 0 && (
                  <>
                    <div className="flex justify-between text-sm text-slate-700"><span>Sous-total HT</span><span>{fp((viewDevis.lignes || []).reduce((a, l) => a + Number(l.total || 0), 0))} €</span></div>
                    <div className="flex justify-between text-sm text-red-700"><span>Remise</span><span>-{fp(viewDevis.remise)} €</span></div>
                  </>
                )}
                <div className="flex justify-between text-sm text-slate-700"><span>Total HT</span><span>{fp(viewDevis.total_ht)} €</span></div>
                <div className="flex justify-between text-sm text-slate-700"><span>TVA ({fp(viewDevis.tva)}%)</span><span>{fp(Number(viewDevis.total_ttc) - Number(viewDevis.total_ht))} €</span></div>
                <div className="flex justify-between text-lg font-bold mt-2 pt-2 border-t border-slate-200">
                  <span className="text-slate-900">Total TTC</span><span className="text-brand-700">{fp(viewDevis.total_ttc)} €</span>
                </div>
              </div>

              {viewDevis.notes && (
                <div className="card-section t-body">
                  <b className="text-slate-900">Notes:</b> {viewDevis.notes}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="modal-footer justify-start flex-wrap">
              {viewDevis.statut === 'Brouillon' && (
                <button type="button" onClick={() => handleStatusChange(viewDevis.id, 'Envoyé')}
                  className="btn-primary">
                  <Send aria-hidden="true" /> Marquer envoyé
                </button>
              )}
              {viewDevis.statut === 'Envoyé' && (
                <>
                  <button type="button" onClick={() => handleStatusChange(viewDevis.id, 'Accepté')}
                    className="btn-primary">
                    <CheckCircle aria-hidden="true" /> Accepter
                  </button>
                  <button type="button" onClick={() => handleStatusChange(viewDevis.id, 'Refusé')}
                    className="btn-secondary text-red-700 hover:bg-red-50 hover:border-red-200">
                    <XCircle aria-hidden="true" /> Refuser
                  </button>
                </>
              )}
              {viewDevis.statut === 'Accepté' && (
                <button type="button" onClick={() => handleConvert(viewDevis.id)}
                  className="btn-primary">
                  <ArrowRightCircle aria-hidden="true" /> Convertir en ticket
                </button>
              )}
              <button type="button" onClick={() => setPrintDevis({ id: viewDevis.id, numero: viewDevis.numero })}
                className="btn-secondary">
                <Printer aria-hidden="true" /> Imprimer
              </button>
              <button type="button" onClick={() => { openEdit(viewDevis.id); setShowDetail(false); }}
                className="btn-secondary">
                <Edit3 aria-hidden="true" /> Modifier
              </button>
              <button type="button" onClick={() => { handleDuplicate(viewDevis.id); setShowDetail(false); }}
                className="btn-secondary">
                <Copy aria-hidden="true" /> Dupliquer
              </button>
            </div>
          </div>
        </div>
      )}

      <PrintPreview
        open={!!printDevis}
        onClose={() => setPrintDevis(null)}
        title="Impression du devis"
        subtitle={printDevis?.numero ? `Devis ${printDevis.numero}` : undefined}
        documents={printDocuments}
      />
    </div>
  );
}
