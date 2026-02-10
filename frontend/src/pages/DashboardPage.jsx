import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import { formatDate, formatPrix, STATUTS, getStatusIcon } from '../lib/utils';
import {
  Search, Plus, Filter, RefreshCw, Clock, AlertTriangle,
  Wrench as WrenchIcon, CheckCircle2, Package, Users, ChevronRight,
  Phone, Mail, MessageCircle,
} from 'lucide-react';

export default function DashboardPage() {
  const navigate = useNavigate();
  const [kpi, setKpi] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (filterStatut) params.statut = filterStatut;

      const [kpiData, ticketsData] = await Promise.all([
        api.getKPI(),
        api.getTickets(params),
      ]);
      setKpi(kpiData);
      setTickets(ticketsData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, filterStatut, refreshKey]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh toutes les 30s
  useEffect(() => {
    const interval = setInterval(() => setRefreshKey(k => k + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const kpiCards = kpi ? [
    { label: 'En attente diagnostic', value: kpi.en_attente_diagnostic, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50' },
    { label: 'En cours', value: kpi.en_cours, icon: WrenchIcon, color: 'text-sky-500', bg: 'bg-sky-50' },
    { label: 'Attente pièce', value: kpi.en_attente_piece, icon: Package, color: 'text-violet-500', bg: 'bg-violet-50' },
    { label: 'Terminées', value: kpi.reparation_terminee, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50' },
    { label: 'Nouveaux aujourd\'hui', value: kpi.nouveaux_aujourdhui, icon: Plus, color: 'text-brand-500', bg: 'bg-brand-50' },
    { label: 'Attente accord', value: kpi.en_attente_accord, icon: AlertTriangle, color: 'text-rose-500', bg: 'bg-rose-50' },
  ] : [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Vue d'ensemble des réparations</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="btn-ghost p-2"
            title="Rafraîchir"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => navigate('/client')} className="btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Nouveau ticket</span>
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpiCards.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="kpi-card">
            <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <div className="min-w-0">
              <p className="kpi-value">{value}</p>
              <p className="kpi-label truncate">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Recherche & Filtres */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher par nom, téléphone, code ticket, marque..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>
        <select
          value={filterStatut}
          onChange={(e) => setFilterStatut(e.target.value)}
          className="input w-full sm:w-64"
        >
          <option value="">Tous les statuts</option>
          {STATUTS.map(s => (
            <option key={s} value={s}>{getStatusIcon(s)} {s}</option>
          ))}
        </select>
      </div>

      {/* Liste des tickets */}
      <div className="card overflow-hidden">
        {loading && tickets.length === 0 ? (
          <div className="p-12 text-center">
            <RefreshCw className="w-8 h-8 text-gray-300 animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-400">Chargement...</p>
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400">Aucun ticket trouvé</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {tickets.map((t, i) => (
              <div
                key={t.id}
                onClick={() => navigate(`/accueil/ticket/${t.id}`)}
                className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50/50 cursor-pointer transition-colors animate-in"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                {/* Code ticket */}
                <div className="w-24 shrink-0">
                  <p className="text-sm font-bold text-brand-600 font-mono">{t.ticket_code}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDate(t.date_depot)?.split(' ')[0]}</p>
                </div>

                {/* Appareil */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {t.client_prenom || ''} {t.client_nom || ''}
                  </p>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {t.marque} {t.modele || t.modele_autre} — {t.panne}
                  </p>
                </div>

                {/* Contact rapide */}
                <div className="hidden md:flex items-center gap-1.5">
                  {t.client_tel && (
                    <a
                      href={`tel:${t.client_tel}`}
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 rounded-lg hover:bg-sky-50 text-gray-400 hover:text-sky-500 transition-colors"
                      title={t.client_tel}
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </a>
                  )}
                  {t.client_email && (
                    <a
                      href={`mailto:${t.client_email}`}
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 rounded-lg hover:bg-violet-50 text-gray-400 hover:text-violet-500 transition-colors"
                    >
                      <Mail className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>

                {/* Prix */}
                <div className="hidden sm:block w-20 text-right">
                  {(t.devis_estime || t.tarif_final) && (
                    <p className="text-sm font-semibold">{formatPrix(t.tarif_final || t.devis_estime)}</p>
                  )}
                </div>

                {/* Statut */}
                <div className="shrink-0">
                  <StatusBadge statut={t.statut} />
                </div>

                <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
