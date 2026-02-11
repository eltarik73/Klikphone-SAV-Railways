import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import {
  Lock, LogOut, TrendingUp, DollarSign, Users, Clock,
  BarChart3, Activity,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────
const COLORS = ['#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4', '#8B5CF6', '#F97316', '#6366F1'];
const VIOLET = '#7C3AED';
const BLUE = '#3B82F6';
const EMERALD = '#10B981';

const PERIODS = [
  { label: '7j', value: '7d' },
  { label: '30j', value: '30d' },
  { label: '90j', value: '90d' },
  { label: '12m', value: '12m' },
];

const JOURS_SEMAINE = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const HEURES = Array.from({ length: 13 }, (_, i) => i + 8); // 8h - 20h

const AUTH_KEY = 'kp_admin_auth';

// ─── Helpers ──────────────────────────────────────────────
function formatEuro(n) {
  if (n === null || n === undefined) return '0,00 \u20AC';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' \u20AC';
}

function formatTemps(minutes) {
  if (!minutes && minutes !== 0) return '\u2014';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}min`;
  return `${h}h ${m}min`;
}

// Custom dark tooltip for recharts
function DarkTooltip({ active, payload, label, formatter }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-sm font-semibold" style={{ color: entry.color || entry.fill || '#fff' }}>
          {formatter ? formatter(entry.value) : entry.value}
        </p>
      ))}
    </div>
  );
}

// Spinner component
function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// Empty state
function EmptyState({ text }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-500">
      <BarChart3 className="w-8 h-8 text-slate-600 mb-2" />
      <p className="text-sm">{text || 'Aucune donn\u00E9e disponible'}</p>
    </div>
  );
}

// ─── Login Component ──────────────────────────────────────
function AdminLogin({ onLogin }) {
  const [identifiant, setIdentifiant] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!identifiant || !password) return;
    setError('');
    setLoading(true);
    try {
      const res = await api.adminLogin(identifiant, password);
      if (res.success || res.token) {
        const authData = { token: res.token, ts: Date.now() };
        localStorage.setItem(AUTH_KEY, JSON.stringify(authData));
        onLogin(authData);
      } else {
        setError('Identifiants incorrects');
      }
    } catch (err) {
      setError(err.message || 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-slate-800 rounded-2xl border border-slate-700/50 shadow-2xl p-8">
          <div className="flex justify-center mb-6">
            <div className="w-14 h-14 rounded-xl bg-violet-600/20 flex items-center justify-center">
              <Lock className="w-7 h-7 text-violet-400" />
            </div>
          </div>

          <h1 className="text-xl font-display font-bold text-white text-center mb-1">
            Administration
          </h1>
          <p className="text-sm text-slate-400 text-center mb-8">
            Acc\u00E8s r\u00E9serv\u00E9 aux administrateurs
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Identifiant</label>
              <input
                type="text"
                value={identifiant}
                onChange={(e) => setIdentifiant(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 transition-all"
                placeholder="Votre identifiant"
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 transition-all"
                placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400 text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !identifiant || !password}
              className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-lg shadow-violet-600/25 transition-all"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Connexion...
                </span>
              ) : (
                'Se connecter'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          Klikphone SAV — Administration
        </p>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────
function AdminDashboard({ onLogout }) {
  const [period, setPeriod] = useState('30d');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [reparations, setReparations] = useState(null);
  const [flux, setFlux] = useState(null);
  const [techPerf, setTechPerf] = useState([]);
  const [evolution, setEvolution] = useState([]);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { period };
      const [statsData, reparationsData, fluxData, techPerfData, evolutionData] = await Promise.all([
        api.getAdminStats(params).catch(() => null),
        api.getAdminReparations(params).catch(() => null),
        api.getAdminFluxClients(params).catch(() => null),
        api.getAdminPerformanceTech(params).catch(() => []),
        api.getAdminEvolution(params).catch(() => ({ data: [] })),
      ]);
      setStats(statsData);
      setReparations(reparationsData);
      setFlux(fluxData);
      setTechPerf(Array.isArray(techPerfData) ? techPerfData : []);
      setEvolution(evolutionData?.data || []);
    } catch (err) {
      setError('Erreur lors du chargement des donn\u00E9es');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── KPI Cards ──
  const kpiCards = stats ? [
    {
      label: 'CA du jour',
      value: formatEuro(stats.ca_jour),
      icon: DollarSign,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'CA du mois',
      value: formatEuro(stats.ca_mois),
      icon: TrendingUp,
      color: 'text-violet-400',
      bg: 'bg-violet-500/10',
    },
    {
      label: 'R\u00E9parations ce mois',
      value: stats.reparations_mois ?? 0,
      icon: Activity,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
    },
    {
      label: 'Ticket moyen',
      value: formatEuro(stats.ticket_moyen),
      icon: Users,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
    },
  ] : [];

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-display font-bold text-white tracking-tight">
                Administration
              </h1>
              <p className="text-sm text-slate-400 mt-0.5">Tableau de bord analytique</p>
            </div>

            <div className="flex items-center gap-3">
              {/* Period selector */}
              <div className="flex bg-slate-800 rounded-lg p-0.5 border border-slate-700/50">
                {PERIODS.map(({ label, value }) => (
                  <button
                    key={value}
                    onClick={() => setPeriod(value)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      period === value
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                onClick={onLogout}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-700/50 transition-all"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">D\u00E9connexion</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* ─── Section 1: Vue d'ensemble ─── */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            Vue d&apos;ensemble
          </h2>
          {loading && !stats ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {kpiCards.map(({ label, value, icon: Icon, color, bg }) => (
                <div
                  key={label}
                  className="bg-slate-800 rounded-xl border border-slate-700/50 p-5 hover:border-slate-600 transition-colors"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-slate-400">{label}</span>
                    <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
                      <Icon className={`w-4.5 h-4.5 ${color}`} />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-white tracking-tight">{value}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─── Section 2: R\u00E9parations ─── */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            R\u00E9parations
          </h2>
          {loading && !reparations ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Par jour */}
              <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-5">
                <h3 className="text-sm font-semibold text-white mb-4">R\u00E9parations par jour (30 derniers jours)</h3>
                {reparations?.par_jour?.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={reparations.par_jour}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} allowDecimals={false} />
                      <Tooltip content={<DarkTooltip />} />
                      <Bar dataKey="count" fill={VIOLET} radius={[4, 4, 0, 0]} maxBarSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState />
                )}
              </div>

              {/* Par mois */}
              <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-5">
                <h3 className="text-sm font-semibold text-white mb-4">R\u00E9parations par mois (12 derniers mois)</h3>
                {reparations?.par_mois?.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={reparations.par_mois}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="mois" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} allowDecimals={false} />
                      <Tooltip content={<DarkTooltip />} />
                      <Bar dataKey="count" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState />
                )}
              </div>
            </div>
          )}
        </section>

        {/* ─── Section 3: Analyses ─── */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            Analyses
          </h2>
          {loading && !reparations ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* PieChart par marque */}
              <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-5">
                <h3 className="text-sm font-semibold text-white mb-4">R\u00E9partition par marque</h3>
                {reparations?.par_marque?.length ? (
                  <div>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={reparations.par_marque}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={3}
                          dataKey="count"
                          nameKey="marque"
                        >
                          {reparations.par_marque.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<DarkTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 justify-center">
                      {reparations.par_marque.slice(0, 6).map((item, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="text-xs text-slate-400">{item.marque}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyState />
                )}
              </div>

              {/* Top 10 pannes */}
              <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-5">
                <h3 className="text-sm font-semibold text-white mb-4">Top 10 pannes</h3>
                {reparations?.par_panne?.length ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={reparations.par_panne.slice(0, 10)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} allowDecimals={false} />
                      <YAxis type="category" dataKey="panne" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} width={120} />
                      <Tooltip content={<DarkTooltip />} />
                      <Bar dataKey="count" fill={EMERALD} radius={[0, 4, 4, 0]} maxBarSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState />
                )}
              </div>

              {/* Par technicien */}
              <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-5">
                <h3 className="text-sm font-semibold text-white mb-4">R\u00E9parations par technicien</h3>
                {reparations?.par_technicien?.length ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={reparations.par_technicien}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="technicien" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} allowDecimals={false} />
                      <Tooltip content={<DarkTooltip />} />
                      <Bar dataKey="count" fill={VIOLET} radius={[4, 4, 0, 0]} maxBarSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState />
                )}
              </div>
            </div>
          )}
        </section>

        {/* ─── Section 4: Flux clients ─── */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            Flux clients
          </h2>
          {loading && !flux ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Par heure */}
              <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-5">
                <h3 className="text-sm font-semibold text-white mb-4">Affluence par heure (8h\u201320h)</h3>
                {flux?.par_heure?.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={flux.par_heure}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="heure" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} allowDecimals={false} />
                      <Tooltip content={<DarkTooltip />} />
                      <Bar dataKey="count" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState text="Aucune donn\u00E9e de flux" />
                )}
              </div>

              {/* Par jour semaine */}
              <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-5">
                <h3 className="text-sm font-semibold text-white mb-4">Affluence par jour de la semaine</h3>
                {flux?.par_jour_semaine?.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={flux.par_jour_semaine}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="jour" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} allowDecimals={false} />
                      <Tooltip content={<DarkTooltip />} />
                      <Bar dataKey="count" fill={EMERALD} radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState text="Aucune donn\u00E9e de flux" />
                )}
              </div>
            </div>
          )}
        </section>

        {/* ─── Section 5: Heatmap ─── */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            Heatmap des d\u00E9p\u00F4ts
          </h2>
          <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-5">
            {flux?.heatmap ? (
              <HeatmapGrid heatmap={flux.heatmap} />
            ) : loading ? (
              <Spinner />
            ) : (
              <EmptyState text="Aucune donn\u00E9e de heatmap" />
            )}
          </div>
        </section>

        {/* ─── Section 6: Performance techniciens ─── */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            Performance techniciens
          </h2>
          <div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-hidden">
            {loading && !techPerf.length ? (
              <Spinner />
            ) : techPerf.length ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider px-5 py-3.5">
                        Technicien
                      </th>
                      <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider px-5 py-3.5">
                        R\u00E9parations
                      </th>
                      <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider px-5 py-3.5">
                        Temps moyen
                      </th>
                      <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wider px-5 py-3.5">
                        CA g\u00E9n\u00E9r\u00E9
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {techPerf.map((tech, i) => (
                      <tr
                        key={i}
                        className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${
                          i % 2 === 0 ? 'bg-slate-800' : 'bg-slate-800/50'
                        }`}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center">
                              <span className="text-xs font-bold text-violet-400">
                                {(tech.technicien || tech.nom || '?')[0].toUpperCase()}
                              </span>
                            </div>
                            <span className="text-sm font-medium text-white">
                              {tech.technicien || tech.nom || 'Inconnu'}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-sm text-slate-300">{tech.reparations ?? tech.count ?? 0}</span>
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-sm text-slate-300">{formatTemps(tech.temps_moyen_minutes ?? tech.temps_moyen)}</span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className="text-sm font-semibold text-emerald-400">
                            {formatEuro(tech.ca_genere ?? tech.ca)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState text="Aucune donn\u00E9e de performance" />
            )}
          </div>
        </section>

        {/* ─── Section 7: Courbes d'\u00E9volution ─── */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            \u00C9volution du chiffre d&apos;affaires
          </h2>
          <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-5">
            {loading && !evolution.length ? (
              <Spinner />
            ) : evolution.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={evolution}>
                  <defs>
                    <linearGradient id="gradientViolet" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={VIOLET} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={VIOLET} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#94A3B8' }}
                    tickLine={false}
                    axisLine={{ stroke: '#334155' }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#94A3B8' }}
                    tickLine={false}
                    axisLine={{ stroke: '#334155' }}
                    tickFormatter={(v) => `${v}\u20AC`}
                  />
                  <Tooltip content={<DarkTooltip formatter={(v) => formatEuro(v)} />} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={VIOLET}
                    strokeWidth={2.5}
                    fill="url(#gradientViolet)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState text="Aucune donn\u00E9e d'\u00E9volution" />
            )}
          </div>
        </section>

        {/* Footer */}
        <div className="pt-4 pb-8 text-center">
          <p className="text-xs text-slate-600">Klikphone SAV — Panneau d&apos;administration</p>
        </div>
      </div>
    </div>
  );
}

// ─── Heatmap Grid Component ──────────────────────────────
function HeatmapGrid({ heatmap }) {
  // heatmap can be an object { "Lundi": { "8": 3, "9": 5, ... }, ... }
  // or an array. Normalize to grid.
  let maxVal = 1;
  const grid = {};

  if (heatmap && typeof heatmap === 'object' && !Array.isArray(heatmap)) {
    // Object format: { jour: { heure: count } }
    JOURS_SEMAINE.forEach((jour) => {
      grid[jour] = {};
      HEURES.forEach((h) => {
        const val = Number(heatmap[jour]?.[h] ?? heatmap[jour]?.[String(h)] ?? 0);
        grid[jour][h] = val;
        if (val > maxVal) maxVal = val;
      });
    });
  } else if (Array.isArray(heatmap)) {
    // Array format: [{ jour, heure, count }] — jour can be 0-6 numeric or day name
    JOURS_SEMAINE.forEach((jour) => { grid[jour] = {}; HEURES.forEach((h) => { grid[jour][h] = 0; }); });
    heatmap.forEach((item) => {
      const jourRaw = item.jour;
      const jour = typeof jourRaw === 'number' ? (JOURS_SEMAINE[jourRaw] || null) : jourRaw;
      const h = Number(item.heure);
      if (jour && grid[jour] && HEURES.includes(h)) {
        grid[jour][h] = Number(item.count || 0);
        if (grid[jour][h] > maxVal) maxVal = grid[jour][h];
      }
    });
  } else {
    return <EmptyState text="Format heatmap non reconnu" />;
  }

  function getOpacity(val) {
    if (val === 0) return 0.05;
    return 0.15 + (val / maxVal) * 0.85;
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Header row */}
        <div className="grid gap-1" style={{ gridTemplateColumns: `100px repeat(${HEURES.length}, 1fr)` }}>
          <div />
          {HEURES.map((h) => (
            <div key={h} className="text-center text-xs text-slate-500 py-1">
              {h}h
            </div>
          ))}
        </div>

        {/* Data rows */}
        {JOURS_SEMAINE.map((jour) => (
          <div
            key={jour}
            className="grid gap-1 mb-1"
            style={{ gridTemplateColumns: `100px repeat(${HEURES.length}, 1fr)` }}
          >
            <div className="flex items-center text-xs text-slate-400 font-medium pr-2">
              {jour}
            </div>
            {HEURES.map((h) => {
              const val = grid[jour]?.[h] || 0;
              return (
                <div
                  key={h}
                  className="aspect-square rounded-sm flex items-center justify-center cursor-default"
                  style={{ backgroundColor: `rgba(124, 58, 237, ${getOpacity(val)})` }}
                  title={`${jour} ${h}h : ${val} d\u00E9p\u00F4t(s)`}
                >
                  {val > 0 && (
                    <span className="text-[9px] font-medium text-violet-300">{val}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* Legend */}
        <div className="flex items-center gap-2 mt-4 justify-end">
          <span className="text-xs text-slate-500">Moins</span>
          {[0.05, 0.25, 0.5, 0.75, 1].map((op, i) => (
            <div
              key={i}
              className="w-4 h-4 rounded-sm"
              style={{ backgroundColor: `rgba(124, 58, 237, ${op})` }}
            />
          ))}
          <span className="text-xs text-slate-500">Plus</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────
export default function AdminPage() {
  const [auth, setAuth] = useState(() => {
    try {
      const stored = localStorage.getItem(AUTH_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const handleLogin = (authData) => {
    setAuth(authData);
  };

  const handleLogout = () => {
    localStorage.removeItem(AUTH_KEY);
    setAuth(null);
  };

  if (!auth) {
    return <AdminLogin onLogin={handleLogin} />;
  }

  return <AdminDashboard onLogout={handleLogout} />;
}
