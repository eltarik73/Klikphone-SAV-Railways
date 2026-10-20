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
  Download, UserX, ShieldCheck, Loader2, Ticket,
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
    <span className={`badge ${oui ? 'badge-success' : 'badge-neutral'}`}>
      {oui ? `Offres acceptées${date}` : 'Pas d’offres commerciales'}
    </span>
  );
}

/** Pastille « Camby » (carte partenaire) : marque, jamais une alerte. */
function BadgeCamby({ className = '' }) {
  return (
    <span className={`badge badge-brand badge-sm ${className}`}>
      <Ticket className="w-3 h-3" aria-hidden="true" /> Camby
    </span>
  );
}

function AnonymiserDialog({ client, busy, onCancel, onConfirm }) {
  const boxRef = useRef(null);
  const [saisie, setSaisie] = useState('');
  const ok = saisie.trim().toUpperCase() === MOT_CONFIRMATION_ANONYMISER;
  // Piège suspendu pendant l'envoi : la demande de code admin (élévation expirée) s'ouvre par-dessus
  // et doit garder le focus ; il revient dans la confirmation si l'anonymisation échoue ou est annulée
  useFocusTrap(boxRef, Boolean(client) && !busy, { initialFocus: '#anonymiser-saisie', onEscape: () => { if (!busy) onCancel(); } });
  if (!client) return null;
  const nom = `${client.prenom || ''} ${client.nom || ''}`.trim() || `client n° ${client.id}`;
  return (
    <div className="modal-overlay z-[60]" onClick={() => { if (!busy) onCancel(); }}>
      <form ref={boxRef} role="alertdialog" aria-modal="true" aria-labelledby="anonymiser-titre" aria-describedby="anonymiser-texte"
        onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); if (ok && !busy) onConfirm(); }}
        className="modal sm:max-w-md">
        <div className="modal-header">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center shrink-0" aria-hidden="true">
              <UserX className="w-5 h-5 text-red-700" />
            </div>
            <h2 id="anonymiser-titre" className="t-h2 truncate">Anonymiser {nom} ?</h2>
          </div>
        </div>
        <div className="modal-body">
          <div id="anonymiser-texte" className="space-y-2 t-body">
            <p><strong className="text-slate-900">Effacés définitivement :</strong> nom, prénom, téléphone, e-mail, société et codes de déverrouillage de ses appareils.</p>
            <p><strong className="text-slate-900">Conservés :</strong> ses réparations et leurs montants (obligation comptable), sans lien possible avec la personne.</p>
            <p className="font-semibold text-red-800">Action irréversible.</p>
          </div>
          <label htmlFor="anonymiser-saisie" className="input-label mt-4">
            Tapez {MOT_CONFIRMATION_ANONYMISER} pour confirmer
          </label>
          <input id="anonymiser-saisie" value={saisie} onChange={e => setSaisie(e.target.value)}
            autoComplete="off" autoCapitalize="characters" spellCheck={false}
            className="input min-h-[44px] font-mono uppercase tabular-nums" />
        </div>
        <div className="modal-footer flex-wrap">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost">Annuler</button>
          <button type="submit" disabled={!ok || busy} aria-busy={busy} className="btn-danger">
            {busy ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <UserX aria-hidden="true" />}
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
    if (sortField !== field) return <ArrowUpDown className="w-4 h-4 text-slate-400" aria-hidden="true" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-4 h-4 text-brand-600" aria-hidden="true" />
      : <ArrowDown className="w-4 h-4 text-brand-600" aria-hidden="true" />;
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
    <div className="page max-w-[1280px]">
      {adminPrompt}
      <AnonymiserDialog key={anonymiserCible?.id ?? 'aucun'} client={anonymiserCible} busy={anonymiserBusy}
        onCancel={() => setAnonymiserCible(null)} onConfirm={handleAnonymiser} />
      {/* Header */}
      <div ref={headerRef} className="page-header">
        <div>
          <h1 className="page-header-title">Clients</h1>
          <p className="page-header-subtitle">
            Page {page + 1} · {clients.length} client{clients.length > 1 ? 's' : ''} affiché{clients.length > 1 ? 's' : ''}
            {debouncedSearch ? ` pour « ${debouncedSearch} »` : ''}
          </p>
        </div>
      </div>

      {/* Search */}
      <div ref={searchCardRef} className="card mb-6">
        <div className="p-3 sm:p-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" aria-hidden="true" />
            <label htmlFor="clients-search" className="sr-only">Rechercher un client</label>
            <input id="clients-search" type="text" placeholder="Rechercher par nom, téléphone, email, société..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
              className="input min-h-[44px] pl-10 pr-12"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Effacer la recherche"
                className="btn-ghost btn-icon absolute right-0.5 top-1/2 -translate-y-1/2 text-slate-500">
                <X aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Client list */}
        <div ref={listColRef} className="lg:col-span-2 min-w-0">
          <div className="card overflow-hidden">
            {/* En-têtes : iPad (lg) = client seul, téléphone sous le nom ; ≥ xl = 3 colonnes triables.
                minmax(0,1fr) : la colonne Client ne s'élargit jamais selon son contenu (pastille Camby),
                téléphone et e-mail restent alignés d'une ligne à l'autre */}
            <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_40px] xl:grid-cols-[minmax(0,1fr)_150px_200px_40px] gap-3 items-center px-5 bg-slate-50 border-b border-slate-100">
              <button type="button" onClick={() => toggleSort('nom')} aria-label={sortLabel('nom')}
                className="table-header table-header-sortable">
                Client <SortIcon field="nom" />
              </button>
              <button type="button" onClick={() => toggleSort('telephone')} aria-label={sortLabel('telephone')}
                className="table-header table-header-sortable hidden xl:inline-flex">
                Téléphone <SortIcon field="telephone" />
              </button>
              <button type="button" onClick={() => toggleSort('email')} aria-label={sortLabel('email')}
                className="table-header table-header-sortable hidden xl:inline-flex">
                Email <SortIcon field="email" />
              </button>
              <span></span>
            </div>

            {loading ? (
              <div className="p-4 space-y-3" role="status">
                {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="skeleton-row" aria-hidden="true" />)}
                <p className="sr-only">Chargement...</p>
              </div>
            ) : sorted.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <Users aria-hidden="true" />
                </div>
                <p className="t-h2">
                  {debouncedSearch ? `Aucun client ne correspond à « ${debouncedSearch} »` : 'Aucun client trouvé'}
                </p>
                {debouncedSearch && (
                  <button type="button" onClick={() => openSearchPalette(debouncedSearch)}
                    className="btn-secondary">
                    <Search aria-hidden="true" /> Chercher aussi dans les tickets
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {sorted.map((c) => (
                  <div key={c.id}
                    data-client-row={c.id}
                    role="button"
                    tabIndex={0}
                    aria-current={selectedId === c.id ? 'true' : undefined}
                    aria-label={`Ouvrir la fiche de ${c.prenom || ''} ${c.nom || ''}`.replace(/\s+/g, ' ').trim()}
                    onClick={() => handleSelectClient(c)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectClient(c); } }}
                    className={`lg:grid lg:grid-cols-[minmax(0,1fr)_40px] xl:grid-cols-[minmax(0,1fr)_150px_200px_40px] gap-3 items-center px-4 sm:px-5 py-2.5 min-h-14 cursor-pointer transition-colors duration-150 group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset
                      ${selectedId === c.id ? 'bg-brand-50/60' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-3 min-h-9">
                      <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center shrink-0" aria-hidden="true">
                        <span className="text-brand-700 font-bold text-xs">
                          {(c.prenom?.[0] || '').toUpperCase()}{(c.nom?.[0] || '').toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {c.prenom || ''} {c.nom || ''}
                        </p>
                        {/* Pastille Camby sous le nom (avec la société) : le nom reste entier */}
                        {(c.carte_camby || c.societe) ? (
                          <div className="flex items-center gap-1.5 min-w-0">
                            {c.carte_camby ? <BadgeCamby className="shrink-0" /> : null}
                            {c.societe && <p className="t-caption truncate">{c.societe}</p>}
                          </div>
                        ) : null}
                        {c.telephone && <p className="xl:hidden t-small tabular-nums">{formatPhone(c.telephone)}</p>}
                      </div>
                      <ChevronRight className="lg:hidden w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                    </div>
                    <div className="hidden xl:block">
                      <p className="t-small tabular-nums text-slate-700">{c.telephone ? formatPhone(c.telephone) : '—'}</p>
                    </div>
                    <div className="hidden xl:block min-w-0">
                      <p className="t-small truncate">{c.email || '—'}</p>
                    </div>
                    <div className="hidden lg:flex justify-end">
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-brand-600 transition-colors duration-150" aria-hidden="true" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination */}
            {!loading && (page > 0 || hasMore) && (
              <div className="card-footer justify-between gap-2 px-3">
                <button type="button"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="btn-ghost btn-sm"
                >
                  <ChevronLeft aria-hidden="true" /> Précédent
                </button>
                <div className="flex items-center gap-2">
                  <span className="t-caption whitespace-nowrap">Page {page + 1}</span>
                  <label htmlFor="clients-page-size" className="sr-only">Clients par page</label>
                  <select id="clients-page-size" value={pageSize}
                    onChange={e => { const s = Number(e.target.value); setPageSize(s); setPage(0); localStorage.setItem('kp_clients_page_size', s.toString()); }}
                    className="select w-auto min-h-9 py-1">
                    {[10, 20, 50, 100].map(n => (
                      <option key={n} value={n}>{n} / page</option>
                    ))}
                  </select>
                </div>
                <button type="button"
                  onClick={() => setPage(p => p + 1)}
                  disabled={!hasMore}
                  className="btn-ghost btn-sm"
                >
                  Suivant <ChevronRight aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Client detail panel : plein écran sous lg, colonne à droite au-delà */}
        <section aria-label="Fiche client"
          className={`${panelOpen ? 'fixed inset-x-0 top-14 bottom-0 z-30 overflow-y-auto overscroll-contain bg-slate-50 p-4 pb-24 sm:p-6' : 'hidden'}
            lg:static lg:block lg:z-auto lg:overflow-visible lg:bg-transparent lg:p-0 lg:pb-0 min-w-0`}>
          <div className="space-y-4">
          {panelOpen && (
            <button type="button" onClick={closePanel}
              className="lg:hidden btn-secondary btn-block justify-start">
              <ArrowLeft aria-hidden="true" /> Retour à la liste des clients
            </button>
          )}
          {clientError ? (
            <div role="alert" className="callout callout-warning">
              <AlertCircle aria-hidden="true" />
              <div className="flex-1">
                <p>{clientError}</p>
                <button type="button" onClick={closePanel} className="btn-secondary btn-sm mt-3">Fermer</button>
              </div>
            </div>
          ) : selectedClient ? (
            <>
              <div className="card card-body">
                <div className="flex items-start justify-between gap-2 mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center shrink-0" aria-hidden="true">
                      <span className="text-brand-700 font-bold text-sm">
                        {(selectedClient.prenom?.[0] || '').toUpperCase()}{(selectedClient.nom?.[0] || '').toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <h2 ref={panelHeadingRef} tabIndex={-1} className="t-h2 truncate focus:outline-none">
                        {selectedClient.prenom} {selectedClient.nom}
                      </h2>
                      {selectedClient.societe && <p className="t-caption">{selectedClient.societe}</p>}
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {selectedClient.carte_camby ? <BadgeCamby /> : null}
                        <BadgeConsentement client={selectedClient} />
                        {selectedClient.anonymise_le && (
                          <span className="badge badge-neutral">
                            Anonymisé le {formatDateShort(selectedClient.anonymise_le)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0 -mr-2 -mt-1">
                    <button type="button" onClick={() => setEditMode(!editMode)}
                      className="btn-ghost btn-icon" title="Modifier" aria-label="Modifier le client" aria-pressed={editMode}>
                      <Edit3 aria-hidden="true" />
                    </button>
                    <button type="button" onClick={closePanel}
                      className="btn-ghost btn-icon hidden lg:inline-flex" title="Fermer" aria-label="Fermer le panneau client">
                      <X aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {editMode ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
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
                      <input id="client-edit-tel" type="tel" value={editForm.telephone} onChange={e => setEditForm(f => ({ ...f, telephone: e.target.value }))} className="input tabular-nums" />
                    </div>
                    <div>
                      <label htmlFor="client-edit-email" className="input-label">Email</label>
                      <input id="client-edit-email" type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className="input" />
                    </div>
                    <div>
                      <label htmlFor="client-edit-societe" className="input-label">Société</label>
                      <input id="client-edit-societe" value={editForm.societe} onChange={e => setEditForm(f => ({ ...f, societe: e.target.value }))} className="input" />
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button type="button" onClick={() => setEditMode(false)} className="btn-ghost">Annuler</button>
                      <button type="button" onClick={handleSaveClient} className="btn-primary">
                        <Save aria-hidden="true" /> Enregistrer
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {selectedClient.telephone && (
                      <a href={`tel:${selectedClient.telephone}`} className="flex items-center gap-3 min-h-11 text-sm font-medium text-slate-700 hover:text-brand-700 transition-colors duration-150 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0" aria-hidden="true">
                          <Phone className="w-4 h-4 text-slate-500" />
                        </div>
                        <span className="tabular-nums">{formatPhone(selectedClient.telephone)}</span>
                      </a>
                    )}
                    {selectedClient.email && (
                      <a href={`mailto:${selectedClient.email}`} className="flex items-center gap-3 min-h-11 text-sm text-slate-600 hover:text-brand-700 transition-colors duration-150 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0" aria-hidden="true">
                          <Mail className="w-4 h-4 text-slate-500" />
                        </div>
                        <span className="truncate">{selectedClient.email}</span>
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Nouvelle réparation pour ce client : création par le personnel (staff=1 → délai obligatoire) */}
              <button type="button"
                onClick={() => navigate(`/client?client_id=${selectedClient.id}&tel=${encodeURIComponent(selectedClient.telephone || '')}&staff=1`)}
                className="btn-primary btn-block"
              >
                <Plus aria-hidden="true" /> Nouvelle réparation pour ce client
              </button>

              {/* Client tickets : en cours d'abord, avec leur statut */}
              <div className="card card-body">
                <div className="flex items-baseline justify-between gap-2 mb-3">
                  <h3 className="t-h2">
                    Réparations ({clientTickets.length})
                  </h3>
                  {clientTickets.length > 0 && (
                    <p className="t-caption text-right">
                      {ticketStats.actifs} en cours{ticketStats.prets > 0 ? ` · ${ticketStats.prets} prête${ticketStats.prets > 1 ? 's' : ''} à rendre` : ''}
                    </p>
                  )}
                </div>
                {ticketsLoading && clientTickets.length === 0 ? (
                  <p className="loading-inline justify-center w-full py-4" role="status"><Loader2 aria-hidden="true" /> Chargement des réparations…</p>
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
                            className={`w-full flex items-start gap-3 p-2.5 min-h-11 rounded-lg transition-colors duration-150 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
                              ${archived ? 'hover:bg-slate-50' : 'bg-white border border-slate-200 hover:bg-brand-50/40 hover:border-brand-200'}`}
                          >
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${archived ? 'bg-slate-100' : 'bg-brand-50'}`} aria-hidden="true">
                              <Smartphone className={`w-4 h-4 ${archived ? 'text-slate-500' : 'text-brand-600'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="t-mono font-bold text-brand-700">{t.ticket_code}</span>
                                <StatusBadge statut={t.statut} />
                                {t.statut === 'Réparation terminée' && (
                                  <span className={`badge badge-sm ${t.paye ? 'badge-success' : 'badge-warning'}`}>
                                    {t.paye ? 'Payé' : 'À encaisser'}
                                  </span>
                                )}
                              </div>
                              <p className="t-small text-slate-600 truncate mt-1">{[device, t.panne].filter(Boolean).join(' — ') || '—'}</p>
                              <p className="t-caption">Déposé le {formatDateShort(t.date_depot)}</p>
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
              <div className="card card-body">
                <h3 className="t-h2 flex items-center gap-2 mb-3">
                  <ShieldCheck className="w-4 h-4 text-brand-600" aria-hidden="true" /> Données personnelles
                </h3>
                <button type="button" onClick={handleConsentement}
                  disabled={consentBusy || Boolean(selectedClient.anonymise_le)}
                  aria-pressed={Boolean(selectedClient.consentement_marketing)}
                  aria-describedby="client-consentement-aide" aria-busy={consentBusy}
                  className="w-full flex items-center justify-between gap-3 min-h-11 px-3 py-2 rounded-lg border border-slate-200 bg-white text-left transition-colors duration-150 hover:bg-slate-50 hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed">
                  <span className="text-sm font-medium text-slate-800">Accepte les offres (SMS, e-mail)</span>
                  <span className="flex items-center gap-2 shrink-0" aria-hidden="true">
                    {consentBusy && <Loader2 className="w-4 h-4 text-slate-500 motion-safe:animate-spin" />}
                    <span className="text-xs font-semibold text-slate-700">{selectedClient.consentement_marketing ? 'Oui' : 'Non'}</span>
                    <span className={`relative inline-flex h-6 w-11 rounded-full transition-colors duration-150 motion-reduce:transition-none ${selectedClient.consentement_marketing ? 'bg-emerald-700' : 'bg-slate-500'}`}>
                      <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-xs transition-transform duration-150 motion-reduce:transition-none ${selectedClient.consentement_marketing ? 'translate-x-5' : ''}`} />
                    </span>
                  </span>
                </button>
                <p id="client-consentement-aide" className="input-help mb-4">
                  À activer seulement avec l'accord exprès du client. Le retrait s'applique tout de suite.
                </p>
                <p className="text-xs text-slate-500 mb-3">
                  Demande du client : export de ses données (fichier JSON) ou anonymisation. Code administrateur requis.
                </p>
                {/* Retour à la ligne quand le panneau est étroit : libellés jamais rognés */}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => handleExportRgpd(selectedClient)} disabled={exportBusy}
                    aria-busy={exportBusy} className="btn-secondary flex-auto">
                    {exportBusy ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                    Exporter ses données
                  </button>
                  <button type="button" onClick={() => setAnonymiserCible(selectedClient)}
                    disabled={Boolean(selectedClient.anonymise_le)}
                    className="btn-secondary flex-auto text-red-700 hover:bg-red-50 hover:border-red-200">
                    <UserX aria-hidden="true" />
                    {selectedClient.anonymise_le ? 'Déjà anonymisé' : 'Anonymiser'}
                  </button>
                </div>
              </div>

              {/* Delete */}
              <button type="button"
                onClick={() => handleDeleteClient(selectedClient.id)}
                className="btn-danger-ghost btn-block"
              >
                <Trash2 aria-hidden="true" /> Supprimer le client
              </button>
            </>
          ) : panelOpen ? (
            <div className="card card-body text-center" role="status">
              <p className="loading-inline justify-center"><Loader2 aria-hidden="true" /> Chargement du client…</p>
            </div>
          ) : (
            <div className="card empty-state hidden lg:flex">
              <div className="empty-state-icon">
                <Users aria-hidden="true" />
              </div>
              <p className="t-h2">Sélectionnez un client</p>
              <p className="t-body text-slate-500 max-w-sm">Cliquez sur un client pour voir ses réparations</p>
            </div>
          )}
          </div>
        </section>
      </div>
    </div>
  );
}
