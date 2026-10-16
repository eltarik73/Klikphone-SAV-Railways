import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useApi, invalidateCache } from '../hooks/useApi';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useFocusTrap } from '../hooks/useFocusTrap';
import api from '../lib/api';
import { useToast } from '../components/Toast';
import { formatDateShort } from '../lib/utils';
import StatusBadge from '../components/StatusBadge';
import { ARCHIVE_STATUTS, formatPhone, openSearchPalette } from '../components/SearchPalette';
import {
  Search, Users, Phone, Mail, ChevronRight, Plus,
  Smartphone, Trash2, Edit3, X, Save, ChevronLeft,
  ArrowUpDown, ArrowUp, ArrowDown, ArrowLeft, AlertCircle,
  Download, UserX, ShieldCheck, Loader2,
} from 'lucide-react';

const SORT_LABELS = { nom: 'nom', telephone: 'téléphone', email: 'email', date_creation: 'date de création' };

export const MOT_CONFIRMATION_ANONYMISER = 'ANONYMISER';

/** Fichier JSON des données d'un client (droit d'accès / portabilité), téléchargé par le navigateur. */
export function telechargerJson(data, nomFichier) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomFichier;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Badge du consentement aux offres (rien si le serveur ne renvoie pas le champ). */
function BadgeConsentement({ client }) {
  if (!client || client.anonymise_le || !('consentement_marketing' in client)) return null;
  const oui = Boolean(client.consentement_marketing);
  const date = oui && client.consentement_marketing_le ? ` le ${formatDateShort(client.consentement_marketing_le)}` : '';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${oui ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
      {oui ? `Offres acceptées${date}` : 'Pas d’offres commerciales'}
    </span>
  );
}

function AnonymiserDialog({ client, busy, onCancel, onConfirm }) {
  const boxRef = useRef(null);
  const [saisie, setSaisie] = useState('');
  const ok = saisie.trim().toUpperCase() === MOT_CONFIRMATION_ANONYMISER;
  useFocusTrap(boxRef, Boolean(client), { initialFocus: '#anonymiser-saisie', onEscape: () => { if (!busy) onCancel(); } });
  if (!client) return null;
  const nom = `${client.prenom || ''} ${client.nom || ''}`.trim() || `client n° ${client.id}`;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4" onClick={() => { if (!busy) onCancel(); }}>
      <form ref={boxRef} role="alertdialog" aria-modal="true" aria-labelledby="anonymiser-titre" aria-describedby="anonymiser-texte"
        onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); if (ok && !busy) onConfirm(); }}
        className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0" aria-hidden="true">
            <UserX className="w-5 h-5 text-red-700" />
          </div>
          <h2 id="anonymiser-titre" className="text-base font-bold text-slate-900">Anonymiser {nom} ?</h2>
        </div>
        <div id="anonymiser-texte" className="space-y-2 text-sm text-slate-700">
          <p><strong>Effacés définitivement :</strong> nom, prénom, téléphone, e-mail, société et codes de déverrouillage de ses appareils.</p>
          <p><strong>Conservés :</strong> ses réparations et leurs montants (obligation comptable), sans lien possible avec la personne.</p>
          <p className="font-semibold text-red-800">Action irréversible.</p>
        </div>
        <label htmlFor="anonymiser-saisie" className="input-label mt-4">
          Tapez {MOT_CONFIRMATION_ANONYMISER} pour confirmer
        </label>
        <input id="anonymiser-saisie" value={saisie} onChange={e => setSaisie(e.target.value)}
          autoComplete="off" autoCapitalize="characters" spellCheck={false}
          className="input min-h-[44px] font-mono uppercase" />
        <div className="flex flex-wrap justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary min-h-[44px]">Annuler</button>
          <button type="submit" disabled={!ok || busy} aria-busy={busy} className="btn-danger min-h-[44px]">
            {busy ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <UserX className="w-4 h-4" aria-hidden="true" />}
            Anonymiser définitivement
          </button>
        </div>
      </form>
    </div>
  );
}

function sortClientTickets(list) {
  return [...list].sort((a, b) => {
    const aa = ARCHIVE_STATUTS.includes(a.statut) ? 1 : 0;
    const ba = ARCHIVE_STATUTS.includes(b.statut) ? 1 : 0;
    if (aa !== ba) return aa - ba;
    return String(b.date_depot || '').localeCompare(String(a.date_depot || ''));
  });
}

export default function ClientsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';
  const [searchParams, setSearchParams] = useSearchParams();
  const clientParam = searchParams.get('client');
  const selectedId = clientParam && /^\d+$/.test(clientParam) ? Number(clientParam) : null;

  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => (searchParams.get('q') || '').trim());
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientError, setClientError] = useState('');
  const [clientTickets, setClientTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(() => parseInt(localStorage.getItem('kp_clients_page_size') || '50'));
  const [sortField, setSortField] = useState('date_creation');
  const [sortDir, setSortDir] = useState('desc');
  const searchTimer = useRef(null);
  const panelHeadingRef = useRef(null);
  const toast = useToast();
  // Suppression d'un client : élévation admin (10 min), redemandée si besoin puis action rejouée
  const { sensible, adminPrompt } = useAdminElevation();
  const [exportBusy, setExportBusy] = useState(false);
  const [anonymiserCible, setAnonymiserCible] = useState(null);
  const [anonymiserBusy, setAnonymiserBusy] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);

  // Debounced search (300ms)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setDebouncedSearch(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  // La recherche reste dans l'URL (retour depuis une fiche, lien « Tous les clients » de la palette).
  // lastUrlQRef distingue nos écritures d'un changement d'URL venu d'ailleurs.
  const urlQ = searchParams.get('q') || '';
  const lastUrlQRef = useRef(urlQ);
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;
  useEffect(() => {
    if (lastUrlQRef.current === debouncedSearch) return;
    lastUrlQRef.current = debouncedSearch;
    setSearchParamsRef.current((prev) => {
      const next = new URLSearchParams(prev);
      if (debouncedSearch) next.set('q', debouncedSearch);
      else next.delete('q');
      return next;
    }, { replace: true });
  }, [debouncedSearch]);
  useEffect(() => {
    if (urlQ === lastUrlQRef.current) return;
    lastUrlQRef.current = urlQ;
    setSearch(urlQ);
    setDebouncedSearch(urlQ);
    setPage(0);
  }, [urlQ]);

  const clientsKey = useMemo(() => {
    const parts = ['clients'];
    if (debouncedSearch) parts.push(`s:${debouncedSearch}`);
    parts.push(`p:${page}:${pageSize}`);
    return parts.join(':');
  }, [debouncedSearch, page, pageSize]);

  const { data: clientsData, loading } = useApi(
    clientsKey,
    async () => {
      const params = { limit: pageSize, offset: page * pageSize };
      if (debouncedSearch) params.search = debouncedSearch;
      return api.getClients(params);
    },
    { tags: ['clients'], ttl: 60_000 }
  );
  const clients = clientsData ?? [];
  const hasMore = clients.length === pageSize;

  // Tri local : l'API renvoie les clients par date de création décroissante, page par page
  const sorted = useMemo(() => [...clients].sort((a, b) => {
    let va = a[sortField], vb = b[sortField];
    if (sortField === 'nom') {
      va = `${a.nom || ''} ${a.prenom || ''}`.toLowerCase();
      vb = `${b.nom || ''} ${b.prenom || ''}`.toLowerCase();
    }
    if (va == null) va = '';
    if (vb == null) vb = '';
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  }), [clients, sortField, sortDir]);

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-slate-400" aria-hidden="true" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 text-brand-600" aria-hidden="true" />
      : <ArrowDown className="w-3 h-3 text-brand-600" aria-hidden="true" />;
  };

  const sortLabel = (field) => {
    const dir = sortField === field ? (sortDir === 'asc' ? ', croissant' : ', décroissant') : '';
    return `Trier la page par ${SORT_LABELS[field]}${dir}`;
  };

  // Client sélectionné = paramètre ?client=<id> (lien direct, retour arrière ferme le panneau)
  const clientsRef = useRef(clients);
  clientsRef.current = clients;
  useEffect(() => {
    if (!selectedId) {
      setSelectedClient(null);
      setClientTickets([]);
      setClientError('');
      return undefined;
    }
    let cancelled = false;
    setEditMode(false);
    setClientError('');
    setTicketsLoading(true);
    const known = clientsRef.current.find(c => c.id === selectedId);
    setSelectedClient(prev => (prev?.id === selectedId ? prev : known || null));
    const loadClient = known ? Promise.resolve(known) : api.getClient(selectedId);
    loadClient
      .then((client) => {
        if (cancelled) return;
        setSelectedClient(client);
        setEditForm({
          nom: client.nom || '',
          prenom: client.prenom || '',
          telephone: client.telephone || '',
          email: client.email || '',
          societe: client.societe || '',
        });
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedClient(null);
          setClientError('Ce client est introuvable (supprimé ou lien invalide).');
        }
      });
    api.getClientTickets(selectedId)
      .then((tickets) => { if (!cancelled) setClientTickets(Array.isArray(tickets) ? tickets : []); })
      .catch(() => { if (!cancelled) setClientTickets([]); })
      .finally(() => { if (!cancelled) setTicketsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  // Sur mobile/tablette le panneau recouvre la liste : on y place le focus
  useEffect(() => {
    if (!selectedClient || typeof window === 'undefined') return;
    if (window.matchMedia && !window.matchMedia('(min-width: 1024px)').matches) {
      panelHeadingRef.current?.focus();
    }
  }, [selectedClient?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setClientParam = (id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('client', String(id));
      else next.delete('client');
      return next;
    }, { replace: Boolean(selectedId) || !id });
  };

  const handleSelectClient = (client) => {
    if (client.id === selectedId) return;
    setSelectedClient(client);
    setClientTickets([]);
    setClientParam(client.id);
  };

  const closePanel = () => setClientParam(null);

  const handleSaveClient = async () => {
    try {
      await api.updateClient(selectedClient.id, editForm);
      setEditMode(false);
      invalidateCache('clients', 'tickets', 'dashboard');
      setSelectedClient(prev => ({ ...prev, ...editForm }));
    } catch (err) {
      toast.error(err?.message || 'Enregistrement impossible');
    }
  };

  const handleDeleteClient = async (id) => {
    if (!confirm('Supprimer ce client ?')) return;
    try {
      await sensible(() => api.deleteClient(id));
      closePanel();
      invalidateCache('clients', 'tickets', 'dashboard');
      toast.success('Client supprimé');
    } catch (err) {
      if (err?.code === 'admin_cancelled') return;
      toast.error(err?.message || 'Suppression impossible');
    }
  };

  const handleExportRgpd = async (client) => {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const data = await sensible(() => api.rgpdExport(client.id));
      telechargerJson(data, `donnees_client_${client.id}_${new Date().toISOString().slice(0, 10)}.json`);
      toast.success('Données du client exportées');
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(err?.message || 'Export impossible');
    } finally {
      setExportBusy(false);
    }
  };

  // Accord recueilli au comptoir ou retrait (art. 7.3 : aussi simple que l'accord) ; date posée par le serveur
  const handleConsentement = async () => {
    const client = selectedClient;
    if (!client || consentBusy || client.anonymise_le) return;
    const accord = !client.consentement_marketing;
    setConsentBusy(true);
    try {
      await api.updateClient(client.id, { consentement_marketing: accord });
      invalidateCache('clients');
      const frais = await api.getClient(client.id).catch(() => null);
      setSelectedClient(prev => (prev?.id === client.id
        ? (frais || { ...prev, consentement_marketing: accord, consentement_marketing_le: accord ? new Date().toISOString() : null })
        : prev));
      toast.success(accord ? 'Accord aux offres enregistré' : 'Accord aux offres retiré');
    } catch (err) {
      toast.error(err?.message || 'Enregistrement impossible');
    } finally {
      setConsentBusy(false);
    }
  };

  const handleAnonymiser = async () => {
    const client = anonymiserCible;
    if (!client || anonymiserBusy) return;
    setAnonymiserBusy(true);
    try {
      await sensible(() => api.rgpdAnonymiser(client.id));
      setAnonymiserCible(null);
      invalidateCache('clients', 'tickets', 'dashboard');
      const frais = await api.getClient(client.id).catch(() => null);
      setSelectedClient(prev => (prev?.id === client.id
        ? (frais || { ...prev, nom: '', prenom: '', telephone: '', email: '', societe: '', anonymise_le: new Date().toISOString() })
        : prev));
      setEditMode(false);
      toast.success('Client anonymisé');
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(err?.message || 'Anonymisation impossible');
    } finally {
      setAnonymiserBusy(false);
    }
  };

  const orderedTickets = useMemo(() => sortClientTickets(clientTickets), [clientTickets]);
  const ticketStats = useMemo(() => {
    let actifs = 0;
    let prets = 0;
    for (const t of clientTickets) {
      if (!ARCHIVE_STATUTS.includes(t.statut)) actifs++;
      if (t.statut === 'Réparation terminée') prets++;
    }
    return { actifs, prets };
  }, [clientTickets]);

  const panelOpen = Boolean(selectedId);

  const [narrow, setNarrow] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia ? !window.matchMedia('(min-width: 1024px)').matches : false
  ));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setNarrow(!mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Sous lg le panneau recouvre l'en-tête et la liste : on les sort du parcours clavier et de
  // l'arbre d'accessibilité (inert posé sur le DOM : attribut booléen, quelle que soit la version de React).
  const headerRef = useRef(null);
  const searchCardRef = useRef(null);
  const listColRef = useRef(null);
  const listHidden = panelOpen && narrow;
  useEffect(() => {
    for (const el of [headerRef.current, searchCardRef.current, listColRef.current]) {
      if (el) el.toggleAttribute('inert', listHidden);
    }
  }, [listHidden]);

  // Fermeture du panneau : le focus revient sur la ligne du client consulté
  const lastOpenedIdRef = useRef(selectedId);
  useEffect(() => {
    if (selectedId) {
      lastOpenedIdRef.current = selectedId;
      return;
    }
    const id = lastOpenedIdRef.current;
    lastOpenedIdRef.current = null;
    if (!id) return;
    const row = listColRef.current?.querySelector(`[data-client-row="${id}"]`);
    if (row && !listColRef.current.contains(document.activeElement)) row.focus();
  }, [selectedId]);

  // Panneau plein écran (mobile / tablette) : Échap revient à la liste
  useEffect(() => {
    if (!panelOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (window.matchMedia?.('(min-width: 1024px)').matches) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      setClientParam(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {adminPrompt}
      <AnonymiserDialog key={anonymiserCible?.id ?? 'aucun'} client={anonymiserCible} busy={anonymiserBusy}
        onCancel={() => setAnonymiserCible(null)} onConfirm={handleAnonymiser} />
      {/* Header */}
      <div ref={headerRef} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight">Clients</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Page {page + 1} · {clients.length} client{clients.length > 1 ? 's' : ''} affiché{clients.length > 1 ? 's' : ''}
            {debouncedSearch ? ` pour « ${debouncedSearch} »` : ''}
          </p>
        </div>
      </div>

      {/* Search */}
      <div ref={searchCardRef} className="card overflow-hidden mb-6">
        <div className="p-3 sm:p-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
            <label htmlFor="clients-search" className="sr-only">Rechercher un client</label>
            <input id="clients-search" type="text" placeholder="Rechercher par nom, téléphone, email, société..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
              className="w-full min-h-[44px] pl-10 pr-11 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 text-base sm:text-sm placeholder:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 focus:bg-white transition-colors"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Effacer la recherche"
                className="absolute right-0.5 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Client list */}
        <div ref={listColRef} className="lg:col-span-2">
          <div className="card overflow-hidden">
            <div className="hidden lg:grid grid-cols-[1fr_150px_180px_32px] gap-3 items-center px-5 py-2 bg-slate-50/80 border-b border-slate-100">
              <button type="button" onClick={() => toggleSort('nom')} aria-label={sortLabel('nom')}
                className="table-header min-h-[36px] flex items-center gap-1 hover:text-brand-600 transition-colors">
                Client <SortIcon field="nom" />
              </button>
              <button type="button" onClick={() => toggleSort('telephone')} aria-label={sortLabel('telephone')}
                className="table-header min-h-[36px] flex items-center gap-1 hover:text-brand-600 transition-colors">
                Téléphone <SortIcon field="telephone" />
              </button>
              <button type="button" onClick={() => toggleSort('email')} aria-label={sortLabel('email')}
                className="table-header min-h-[36px] flex items-center gap-1 hover:text-brand-600 transition-colors">
                Email <SortIcon field="email" />
              </button>
              <span></span>
            </div>

            {loading ? (
              <div className="py-16 text-center" role="status">
                <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full motion-safe:animate-spin mx-auto mb-3" aria-hidden="true" />
                <p className="text-sm text-slate-500">Chargement...</p>
              </div>
            ) : sorted.length === 0 ? (
              <div className="py-16 px-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                  <Users className="w-7 h-7 text-slate-400" aria-hidden="true" />
                </div>
                <p className="text-slate-700 font-medium">
                  {debouncedSearch ? `Aucun client ne correspond à « ${debouncedSearch} »` : 'Aucun client trouvé'}
                </p>
                {debouncedSearch && (
                  <button type="button" onClick={() => openSearchPalette(debouncedSearch)}
                    className="btn-secondary mt-4 text-sm min-h-[44px]">
                    <Search className="w-4 h-4" aria-hidden="true" /> Chercher aussi dans les tickets
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-100/80">
                {sorted.map((c) => (
                  <div key={c.id}
                    data-client-row={c.id}
                    role="button"
                    tabIndex={0}
                    aria-current={selectedId === c.id ? 'true' : undefined}
                    aria-label={`Ouvrir la fiche de ${c.prenom || ''} ${c.nom || ''}`.replace(/\s+/g, ' ').trim()}
                    onClick={() => handleSelectClient(c)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectClient(c); } }}
                    className={`lg:grid lg:grid-cols-[1fr_150px_180px_32px] gap-3 items-center px-4 sm:px-5 py-3.5 min-h-[56px] cursor-pointer transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-inset
                      ${selectedId === c.id ? 'bg-brand-50/60' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center shrink-0" aria-hidden="true">
                        <span className="text-brand-700 font-bold text-xs">
                          {(c.prenom?.[0] || '').toUpperCase()}{(c.nom?.[0] || '').toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {c.prenom || ''} {c.nom || ''}
                          {c.carte_camby ? <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold">🎫 Camby</span> : null}
                        </p>
                        {c.societe && <p className="text-xs text-slate-500 truncate">{c.societe}</p>}
                        {c.telephone && <p className="lg:hidden text-xs text-slate-600 font-mono">{formatPhone(c.telephone)}</p>}
                      </div>
                      <ChevronRight className="lg:hidden w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                    </div>
                    <div className="hidden lg:block">
                      <p className="text-slate-600 font-mono text-xs">{c.telephone ? formatPhone(c.telephone) : '—'}</p>
                    </div>
                    <div className="hidden lg:block">
                      <p className="text-slate-500 truncate text-xs">{c.email || '—'}</p>
                    </div>
                    <div className="hidden lg:flex justify-end">
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-brand-500 transition-colors" aria-hidden="true" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination */}
            {!loading && (page > 0 || hasMore) && (
              <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-2 border-t border-slate-100 bg-slate-50/50">
                <button type="button"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="btn-ghost text-xs min-h-[44px] disabled:opacity-30"
                >
                  <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" /> Précédent
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Page {page + 1}</span>
                  <label htmlFor="clients-page-size" className="sr-only">Clients par page</label>
                  <select id="clients-page-size" value={pageSize}
                    onChange={e => { const s = Number(e.target.value); setPageSize(s); setPage(0); localStorage.setItem('kp_clients_page_size', s.toString()); }}
                    className="text-xs min-h-[36px] border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-600">
                    {[10, 20, 50, 100].map(n => (
                      <option key={n} value={n}>{n} / page</option>
                    ))}
                  </select>
                </div>
                <button type="button"
                  onClick={() => setPage(p => p + 1)}
                  disabled={!hasMore}
                  className="btn-ghost text-xs min-h-[44px] disabled:opacity-30"
                >
                  Suivant <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Client detail panel : plein écran sous lg, colonne à droite au-delà */}
        <section aria-label="Fiche client"
          className={`${panelOpen ? 'fixed inset-x-0 top-14 bottom-0 z-30 overflow-y-auto overscroll-contain bg-slate-50 p-4 pb-20 sm:p-6' : 'hidden'}
            lg:static lg:block lg:z-auto lg:overflow-visible lg:bg-transparent lg:p-0 lg:pb-0`}>
          <div className="space-y-5">
          {panelOpen && (
            <button type="button" onClick={closePanel}
              className="lg:hidden btn-secondary w-full justify-start min-h-[44px] text-sm">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Retour à la liste des clients
            </button>
          )}
          {clientError ? (
            <div role="alert" className="card p-5 flex items-start gap-3 text-sm text-slate-700">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />
              <div className="flex-1">
                <p>{clientError}</p>
                <button type="button" onClick={closePanel} className="btn-secondary mt-3 text-xs min-h-[44px]">Fermer</button>
              </div>
            </div>
          ) : selectedClient ? (
            <>
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center shrink-0" aria-hidden="true">
                      <span className="text-brand-700 font-bold text-sm">
                        {(selectedClient.prenom?.[0] || '').toUpperCase()}{(selectedClient.nom?.[0] || '').toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <h2 ref={panelHeadingRef} tabIndex={-1} className="font-bold text-slate-900 truncate focus:outline-none">
                        {selectedClient.prenom} {selectedClient.nom}
                      </h2>
                      {selectedClient.societe && <p className="text-xs text-slate-500">{selectedClient.societe}</p>}
                      {selectedClient.carte_camby ? <span className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">🎫 Camby</span> : null}
                      <div className="flex flex-wrap gap-1 mt-1">
                        <BadgeConsentement client={selectedClient} />
                        {selectedClient.anonymise_le && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-800 text-white text-[11px] font-semibold">
                            Anonymisé le {formatDateShort(selectedClient.anonymise_le)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button type="button" onClick={() => setEditMode(!editMode)}
                      className="btn-ghost w-11 h-11 p-0" title="Modifier" aria-label="Modifier le client" aria-pressed={editMode}>
                      <Edit3 className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={closePanel}
                      className="btn-ghost w-11 h-11 p-0 hidden lg:inline-flex" title="Fermer" aria-label="Fermer le panneau client">
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {editMode ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="client-edit-nom" className="input-label">Nom</label>
                        <input id="client-edit-nom" value={editForm.nom} onChange={e => setEditForm(f => ({ ...f, nom: e.target.value }))} className="input" />
                      </div>
                      <div>
                        <label htmlFor="client-edit-prenom" className="input-label">Prénom</label>
                        <input id="client-edit-prenom" value={editForm.prenom} onChange={e => setEditForm(f => ({ ...f, prenom: e.target.value }))} className="input" />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="client-edit-tel" className="input-label">Téléphone</label>
                      <input id="client-edit-tel" type="tel" value={editForm.telephone} onChange={e => setEditForm(f => ({ ...f, telephone: e.target.value }))} className="input" />
                    </div>
                    <div>
                      <label htmlFor="client-edit-email" className="input-label">Email</label>
                      <input id="client-edit-email" type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className="input" />
                    </div>
                    <div>
                      <label htmlFor="client-edit-societe" className="input-label">Société</label>
                      <input id="client-edit-societe" value={editForm.societe} onChange={e => setEditForm(f => ({ ...f, societe: e.target.value }))} className="input" />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button type="button" onClick={() => setEditMode(false)} className="btn-secondary text-xs min-h-[44px]">Annuler</button>
                      <button type="button" onClick={handleSaveClient} className="btn-primary text-xs min-h-[44px]">
                        <Save className="w-3.5 h-3.5" aria-hidden="true" /> Enregistrer
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {selectedClient.telephone && (
                      <a href={`tel:${selectedClient.telephone}`} className="flex items-center gap-2.5 min-h-[44px] text-sm text-slate-600 hover:text-brand-600 transition-colors rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0" aria-hidden="true">
                          <Phone className="w-4 h-4 text-slate-500" />
                        </div>
                        <span className="font-mono text-xs">{formatPhone(selectedClient.telephone)}</span>
                      </a>
                    )}
                    {selectedClient.email && (
                      <a href={`mailto:${selectedClient.email}`} className="flex items-center gap-2.5 min-h-[44px] text-sm text-slate-600 hover:text-brand-600 transition-colors rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0" aria-hidden="true">
                          <Mail className="w-4 h-4 text-slate-500" />
                        </div>
                        <span className="text-xs truncate">{selectedClient.email}</span>
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* New repair for this client */}
              <button type="button"
                onClick={() => navigate(`/client?client_id=${selectedClient.id}&tel=${encodeURIComponent(selectedClient.telephone || '')}`)}
                className="btn-primary w-full justify-center text-xs min-h-[44px]"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Nouvelle réparation pour ce client
              </button>

              {/* Client tickets : en cours d'abord, avec leur statut */}
              <div className="card p-5">
                <div className="flex items-baseline justify-between gap-2 mb-3">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Réparations ({clientTickets.length})
                  </h3>
                  {clientTickets.length > 0 && (
                    <p className="text-xs text-slate-600">
                      {ticketStats.actifs} en cours{ticketStats.prets > 0 ? ` · ${ticketStats.prets} prête${ticketStats.prets > 1 ? 's' : ''} à rendre` : ''}
                    </p>
                  )}
                </div>
                {ticketsLoading && clientTickets.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-4" role="status">Chargement des réparations…</p>
                ) : clientTickets.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-4">Aucun ticket</p>
                ) : (
                  <ul className="space-y-1.5">
                    {orderedTickets.map(t => {
                      const archived = ARCHIVE_STATUTS.includes(t.statut);
                      const device = [t.marque, t.modele || t.modele_autre].filter(Boolean).join(' ');
                      return (
                        <li key={t.id}>
                          <button type="button"
                            onClick={() => navigate(`${basePath}/ticket/${t.id}`)}
                            aria-label={`Ouvrir ${t.ticket_code}, ${device || 'appareil'}, ${t.statut}`}
                            className={`w-full flex items-start gap-3 p-2.5 min-h-[44px] rounded-lg transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
                              ${archived ? 'hover:bg-slate-50' : 'bg-white ring-1 ring-slate-100 hover:bg-brand-50/40'}`}
                          >
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${archived ? 'bg-slate-100' : 'bg-brand-50'}`} aria-hidden="true">
                              <Smartphone className={`w-4 h-4 ${archived ? 'text-slate-500' : 'text-brand-600'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-xs font-bold text-brand-700 font-mono">{t.ticket_code}</span>
                                <StatusBadge statut={t.statut} />
                                {t.statut === 'Réparation terminée' && (
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.paye ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
                                    {t.paye ? 'Payé' : 'À encaisser'}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-600 truncate mt-0.5">{[device, t.panne].filter(Boolean).join(' — ') || '—'}</p>
                              <p className="text-[11px] text-slate-500">Déposé le {formatDateShort(t.date_depot)}</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-2" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* RGPD : droit d'accès (export) et d'effacement (anonymisation) — élévation admin */}
              <div className="card p-5">
                <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                  <ShieldCheck className="w-4 h-4 text-brand-700" aria-hidden="true" /> Données personnelles
                </h3>
                <button type="button" onClick={handleConsentement}
                  disabled={consentBusy || Boolean(selectedClient.anonymise_le)}
                  aria-pressed={Boolean(selectedClient.consentement_marketing)}
                  aria-describedby="client-consentement-aide" aria-busy={consentBusy}
                  className="w-full flex items-center justify-between gap-3 min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60 disabled:cursor-not-allowed">
                  <span className="text-sm font-medium text-slate-800">Accepte les offres (SMS, e-mail)</span>
                  <span className="flex items-center gap-2 shrink-0" aria-hidden="true">
                    {consentBusy && <Loader2 className="w-4 h-4 text-slate-500 motion-safe:animate-spin" />}
                    <span className="text-xs font-semibold text-slate-700">{selectedClient.consentement_marketing ? 'Oui' : 'Non'}</span>
                    <span className={`relative inline-flex h-6 w-11 rounded-full transition-colors motion-reduce:transition-none ${selectedClient.consentement_marketing ? 'bg-emerald-600' : 'bg-slate-500'}`}>
                      <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${selectedClient.consentement_marketing ? 'translate-x-5' : ''}`} />
                    </span>
                  </span>
                </button>
                <p id="client-consentement-aide" className="text-xs text-slate-600 mt-1.5 mb-4">
                  À activer seulement avec l'accord exprès du client. Le retrait s'applique tout de suite.
                </p>
                <p className="text-xs text-slate-600 mb-3">
                  Demande du client : export de ses données (fichier JSON) ou anonymisation. Code administrateur requis.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-2">
                  <button type="button" onClick={() => handleExportRgpd(selectedClient)} disabled={exportBusy}
                    aria-busy={exportBusy} className="btn-secondary text-xs min-h-[44px]">
                    {exportBusy ? <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" /> : <Download className="w-3.5 h-3.5" aria-hidden="true" />}
                    Exporter ses données
                  </button>
                  <button type="button" onClick={() => setAnonymiserCible(selectedClient)}
                    disabled={Boolean(selectedClient.anonymise_le)}
                    className="btn-secondary text-xs min-h-[44px] text-red-700 border-red-200 hover:bg-red-50 hover:border-red-300">
                    <UserX className="w-3.5 h-3.5" aria-hidden="true" />
                    {selectedClient.anonymise_le ? 'Déjà anonymisé' : 'Anonymiser'}
                  </button>
                </div>
              </div>

              {/* Delete */}
              <button type="button"
                onClick={() => handleDeleteClient(selectedClient.id)}
                className="btn-danger w-full text-xs min-h-[44px]"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Supprimer le client
              </button>
            </>
          ) : panelOpen ? (
            <div className="card p-8 text-center" role="status">
              <p className="text-sm text-slate-500">Chargement du client…</p>
            </div>
          ) : (
            <div className="card p-8 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                <Users className="w-7 h-7 text-slate-400" aria-hidden="true" />
              </div>
              <p className="text-slate-600 font-medium">Sélectionnez un client</p>
              <p className="text-sm text-slate-500 mt-1">Cliquez sur un client pour voir ses réparations</p>
            </div>
          )}
          </div>
        </section>
      </div>
    </div>
  );
}
