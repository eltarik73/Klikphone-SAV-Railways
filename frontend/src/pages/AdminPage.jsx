import { useState, useMemo } from 'react';
import api from '../lib/api';
import { useApi } from '../hooks/useApi';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Lock, LogOut, TrendingUp, TrendingDown, Minus,
  BarChart3, Users, Clock, Receipt, UserPlus, Target, Wrench,
  Calendar, ChevronUp, ChevronDown, Award, Smartphone,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────
const VIOLET = '#7C3AED';
const BLUE = '#3B82F6';
const EMERALD = '#10B981';

const PERIOD_OPTIONS = [
  { label: "Aujourd'hui", value: 'today', gran: 'heure' },
  { label: 'Hier', value: 'yesterday', gran: 'heure' },
  { label: 'Ce mois', value: 'month', gran: 'jour' },
  { label: '12 mois', value: '12m', gran: 'mois' },
  { label: 'Personnalisé', value: 'custom', gran: 'jour' },
];

const KPI_ICONS = {
  tickets_ouverts: Wrench,
  tickets_periode: Receipt,
  clotures: BarChart3,
  ca_encaisse: TrendingUp,
  ca_moyen: Target,
  temps_moyen: Clock,
  taux_conversion: Award,
  nouveaux_clients: UserPlus,
};

const KPI_COLORS = {
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20' },
  pink: { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/20' },
  indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/20' },
};

const MEDALS = ['', '', ''];

const AUTH_KEY = 'kp_admin_auth';

// ─── Helpers ──────────────────────────────────────────────
function formatEuro(n) {
  if (n === null || n === undefined) return '0,00 €';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €';
}

function formatTemps(heures) {
  if (!heures && heures !== 0) return '—';
  const h = Math.floor(heures);
  const m = Math.round((heures - h) * 60);
  if (h === 0) return `${m}min`;
  return `${h}h${m > 0 ? ` ${m}min` : ''}`;
}

function formatKpiValue(value, format) {
  switch (format) {
    case 'euro': return formatEuro(value);
    case 'heures': return formatTemps(value);
    case 'pct': return `${value}%`;
    default: return String(value);
  }
}

function toISODate(date) {
  return date.toISOString().split('T')[0];
}

function computeDateRange(period, customStart, customEnd) {
  const today = new Date();
  const todayStr = toISODate(today);

  switch (period) {
    case 'today':
      return { debut: todayStr, fin: todayStr, granularite: 'heure' };
    case 'yesterday': {
      const y = toISODate(new Date(today - 86400000));
      return { debut: y, fin: y, granularite: 'heure' };
    }
    case 'month':
      return { debut: todayStr.slice(0, 8) + '01', fin: todayStr, granularite: 'jour' };
    case '12m':
      return { debut: toISODate(new Date(today - 365 * 86400000)), fin: todayStr, granularite: 'mois' };
    case 'custom':
      return { debut: customStart || todayStr, fin: customEnd || todayStr, granularite: 'jour' };
    default:
      return { debut: todayStr.slice(0, 8) + '01', fin: todayStr, granularite: 'jour' };
  }
}

// Custom dark tooltip
function DarkTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-slate-400 mb-1 font-medium">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="font-semibold" style={{ color: entry.color || entry.fill || '#fff' }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-500">
      <BarChart3 className="w-8 h-8 text-slate-600 mb-2" />
      <p className="text-sm">{text || 'Aucune donnée disponible'}</p>
    </div>
  );
}

function ChartCard({ title, children, className = '' }) {
  return (
    <div className={`bg-slate-800 rounded-xl border border-slate-700/50 p-5 ${className}`}>
      <h3 className="text-sm font-semibold text-white mb-4">{title}</h3>
      {children}
    </div>
  );
}

// ─── Trend Badge ──────────────────────────────────────────
function TrendBadge({ trend }) {
  if (trend === null || trend === undefined) return null;
  const isUp = trend > 0;
  const isFlat = trend === 0;
  const color = isFlat ? 'text-slate-400 bg-slate-500/10' :
    isUp ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10';
  const Icon = isFlat ? Minus : isUp ? ChevronUp : ChevronDown;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${color}`}>
      <Icon className="w-3 h-3" />
      {Math.abs(trend)}%
    </span>
  );
}

// ─── Progress Bar ─────────────────────────────────────────
function ProgressBar({ pct, color = 'bg-violet-500' }) {
  return (
    <div className="w-full bg-slate-700/50 rounded-full h-2">
      <div className={`h-2 rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

// ─── Period Selector ──────────────────────────────────────
function PeriodSelector({ period, setPeriod, customStart, setCustomStart, customEnd, setCustomEnd }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex bg-slate-800 rounded-lg p-0.5 border border-slate-700/50 flex-wrap">
        {PERIOD_OPTIONS.map(({ label, value }) => (
          <button key={value} onClick={() => setPeriod(value)}
            className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all whitespace-nowrap ${
              period === value ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}>
            {label}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="flex items-center gap-2">
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/40" />
          <span className="text-slate-500 text-xs">&rarr;</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/40" />
        </div>
      )}
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
      const res = await api.verifyAdmin(identifiant, password);
      if (res.success) {
        const authData = { ts: Date.now() };
        localStorage.setItem(AUTH_KEY, JSON.stringify(authData));
        localStorage.setItem('klikphone_admin', 'true');
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
          <h1 className="text-xl font-display font-bold text-white text-center mb-1">Administration</h1>
          <p className="text-sm text-slate-400 text-center mb-8">Accès réservé aux administrateurs</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Identifiant</label>
              <input type="text" value={identifiant} onChange={(e) => setIdentifiant(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 transition-all"
                placeholder="Votre identifiant" autoComplete="username" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Mot de passe</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 transition-all"
                placeholder="••••••••" autoComplete="current-password" />
            </div>
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400 text-center">{error}</div>
            )}
            <button type="submit" disabled={loading || !identifiant || !password}
              className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-lg shadow-violet-600/25 transition-all">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Connexion...
                </span>
              ) : 'Se connecter'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-slate-600 mt-6">Klikphone SAV — Administration</p>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────
function AdminDashboard({ onLogout }) {
  const [period, setPeriod] = useState('month');
  const [customStart, setCustomStart] = useState(toISODate(new Date(Date.now() - 30 * 86400000)));
  const [customEnd, setCustomEnd] = useState(toISODate(new Date()));

  const dateRange = useMemo(() => computeDateRange(period, customStart, customEnd), [period, customStart, customEnd]);
  const reportKey = useMemo(() => `reporting:${dateRange.debut}:${dateRange.fin}:${dateRange.granularite}`, [dateRange]);

  const { data: report, loading } = useApi(
    reportKey,
    () => api.getReporting(dateRange),
    { tags: ['reporting'], ttl: 120_000 }
  );

  const kpis = report?.kpis ?? [];
  const affluence = report?.affluence ?? [];
  const perfAccueil = report?.performance_accueil ?? [];
  const perfTech = report?.performance_techniciens ?? [];
  const topPannes = report?.top_pannes ?? [];
  const topModeles = report?.top_modeles ?? [];
  const granularite = dateRange.granularite;

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-display font-bold text-white tracking-tight">Reporting</h1>
                <p className="text-sm text-slate-400 mt-0.5">Vue d'ensemble de la boutique</p>
              </div>
              <button onClick={onLogout}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-700/50 transition-all">
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Déconnexion</span>
              </button>
            </div>
            {/* Period filter */}
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
              <PeriodSelector period={period} setPeriod={setPeriod}
                customStart={customStart} setCustomStart={setCustomStart}
                customEnd={customEnd} setCustomEnd={setCustomEnd} />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {/* ═══ Section 1: KPI Cards ═══ */}
        <section>
          {loading && kpis.length === 0 ? <Spinner /> : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
              {kpis.map((kpi) => {
                const Icon = KPI_ICONS[kpi.id] || BarChart3;
                const colors = KPI_COLORS[kpi.color] || KPI_COLORS.violet;
                return (
                  <div key={kpi.id}
                    className={`bg-slate-800 rounded-xl border border-slate-700/50 p-4 hover:border-slate-600 transition-colors`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className={`w-9 h-9 rounded-lg ${colors.bg} flex items-center justify-center`}>
                        <Icon className={`w-4.5 h-4.5 ${colors.text}`} />
                      </div>
                      <TrendBadge trend={kpi.trend} />
                    </div>
                    <p className="text-2xl font-bold text-white tracking-tight">
                      {formatKpiValue(kpi.value, kpi.format)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1 font-medium">{kpi.label}</p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ═══ Section 2: Affluence Chart ═══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Affluence</h2>
          <ChartCard title={granularite === 'heure' ? 'Dépôts par heure' : granularite === 'mois' ? 'Dépôts par mois' : 'Dépôts par jour'}>
            {affluence.length ? (
              <ResponsiveContainer width="100%" height={320}>
                {granularite === 'mois' ? (
                  <LineChart data={affluence}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} allowDecimals={false} />
                    <Tooltip content={<DarkTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} />
                    <Line type="monotone" dataKey="tickets" name="Tickets" stroke={VIOLET} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="clients" name="Clients" stroke={EMERALD} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} strokeDasharray="5 5" />
                  </LineChart>
                ) : (
                  <BarChart data={affluence}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} allowDecimals={false} />
                    <Tooltip content={<DarkTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} />
                    <Bar dataKey="tickets" name="Tickets" fill={VIOLET} radius={[4, 4, 0, 0]} maxBarSize={32} />
                    <Bar dataKey="clients" name="Clients" fill={EMERALD} radius={[4, 4, 0, 0]} maxBarSize={32} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            ) : <EmptyState text="Aucune donnée d'affluence" />}
          </ChartCard>
        </section>

        {/* ═══ Section 3: Performance Accueil ═══ */}
        {perfAccueil.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Performance Accueil</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {perfAccueil.map((p) => {
                const initials = p.utilisateur.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
                return (
                  <div key={p.utilisateur} className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                        <span className="text-sm font-bold text-blue-400">{initials}</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{p.utilisateur}</p>
                        <p className="text-[10px] text-slate-500">Accueil</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xl font-bold text-white">{p.tickets_enregistres}</p>
                        <p className="text-[10px] text-slate-500">Tickets enregistrés</p>
                      </div>
                      <div>
                        <p className="text-xl font-bold text-blue-400">{p.clients_uniques}</p>
                        <p className="text-[10px] text-slate-500">Clients uniques</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ═══ Section 4: Performance Techniciens ═══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Performance Techniciens</h2>
          <ChartCard title="Classement des techniciens">
            {perfTech.length ? (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2 w-8">#</th>
                      <th className="text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2">Technicien</th>
                      <th className="text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2">Réparations</th>
                      <th className="text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2">Temps moy.</th>
                      <th className="text-right text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2">CA généré</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perfTech.map((t) => (
                      <tr key={t.technicien} className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors">
                        <td className="py-2.5">
                          <span className="text-base">{t.rang <= 3 ? MEDALS[t.rang - 1] : t.rang}</span>
                        </td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                              style={{ backgroundColor: (t.couleur || '#7C3AED') + '20' }}>
                              <span className="text-xs font-bold" style={{ color: t.couleur || '#7C3AED' }}>
                                {(t.technicien || '?')[0].toUpperCase()}
                              </span>
                            </div>
                            <span className="text-sm font-medium text-white">{t.technicien}</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-center">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-violet-500/20 text-violet-300">
                            {t.reparations}
                          </span>
                        </td>
                        <td className="py-2.5 text-center text-sm text-slate-300">{formatTemps(t.temps_moyen_h)}</td>
                        <td className="py-2.5 text-right text-sm font-semibold text-emerald-400">{formatEuro(t.ca_genere)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState text="Aucune réparation sur la période" />}
          </ChartCard>
        </section>

        {/* ═══ Section 5: Top Pannes & Top Modèles ═══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Analyses</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Pannes */}
            <ChartCard title="Top 10 Pannes">
              {topPannes.length ? (
                <div className="space-y-3">
                  {topPannes.map((p, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-300 truncate max-w-[60%]">{p.label}</span>
                        <span className="text-xs font-semibold text-white ml-2">{p.count} <span className="text-slate-500 font-normal">({p.pct}%)</span></span>
                      </div>
                      <ProgressBar pct={p.pct} color="bg-violet-500" />
                    </div>
                  ))}
                </div>
              ) : <EmptyState text="Aucune panne enregistrée" />}
            </ChartCard>

            {/* Top Modèles */}
            <ChartCard title="Top 10 Modèles réparés">
              {topModeles.length ? (
                <div className="space-y-3">
                  {topModeles.map((m, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 truncate max-w-[60%]">
                          <Smartphone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="text-xs text-slate-300 truncate">{m.label}</span>
                        </div>
                        <span className="text-xs font-semibold text-white ml-2">{m.count} <span className="text-slate-500 font-normal">({m.pct}%)</span></span>
                      </div>
                      <ProgressBar pct={m.pct} color="bg-blue-500" />
                    </div>
                  ))}
                </div>
              ) : <EmptyState text="Aucun modèle enregistré" />}
            </ChartCard>
          </div>
        </section>

        {/* Footer */}
        <div className="pt-4 pb-8 text-center">
          <p className="text-xs text-slate-600">Klikphone SAV — Reporting</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────
export default function AdminPage() {
  const [auth, setAuth] = useState(() => {
    if (localStorage.getItem('klikphone_admin') === 'true') return { ts: Date.now() };
    try {
      const stored = localStorage.getItem(AUTH_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  if (!auth) {
    return <AdminLogin onLogin={(data) => setAuth(data)} />;
  }

  return <AdminDashboard onLogout={() => { localStorage.removeItem(AUTH_KEY); localStorage.removeItem('klikphone_admin'); setAuth(null); }} />;
}
