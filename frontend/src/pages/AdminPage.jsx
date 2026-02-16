import { useState, useMemo } from 'react';
import api from '../lib/api';
import { useApi } from '../hooks/useApi';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Lock, LogOut, TrendingUp, DollarSign, Users,
  BarChart3, Activity, Target, UserCheck, Phone, Calendar,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────
const COLORS = ['#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4', '#8B5CF6', '#F97316', '#6366F1'];
const VIOLET = '#7C3AED';
const BLUE = '#3B82F6';
const EMERALD = '#10B981';
const AMBER = '#F59E0B';

const TECH_DAYS_OPTIONS = [
  { label: '7j', value: 7 },
  { label: '14j', value: 14 },
  { label: '30j', value: 30 },
];

const PERIOD_OPTIONS = [
  { label: "Aujourd'hui", value: 'today' },
  { label: '7 jours', value: '7d' },
  { label: '14 jours', value: '14d' },
  { label: '1 mois', value: '30d' },
  { label: '3 mois', value: '90d' },
  { label: '12 mois', value: '365d' },
  { label: 'Personnalisé', value: 'custom' },
];

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
  return `${h}h ${m}min`;
}

function toISODate(date) {
  return date.toISOString().split('T')[0];
}

function computeDateRange(period, customStart, customEnd) {
  const today = new Date();
  const end = toISODate(today);
  switch (period) {
    case 'today': return { date_start: end, date_end: end };
    case '7d': return { date_start: toISODate(new Date(today - 7 * 86400000)), date_end: end };
    case '14d': return { date_start: toISODate(new Date(today - 14 * 86400000)), date_end: end };
    case '30d': return { date_start: toISODate(new Date(today - 30 * 86400000)), date_end: end };
    case '90d': return { date_start: toISODate(new Date(today - 90 * 86400000)), date_end: end };
    case '365d': return { date_start: toISODate(new Date(today - 365 * 86400000)), date_end: end };
    case 'custom': return { date_start: customStart || end, date_end: customEnd || end };
    default: return { date_start: toISODate(new Date(today - 30 * 86400000)), date_end: end };
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
          {entry.name}: {typeof entry.value === 'number' && entry.value % 1 !== 0 ? entry.value.toFixed(1) : entry.value}
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

// ─── Conversion Gauge ─────────────────────────────────────
function ConversionGauge({ taux, envoyes, acceptes }) {
  const radius = 70;
  const circumference = Math.PI * radius;
  const progress = (taux / 100) * circumference;
  const color = taux >= 70 ? EMERALD : taux >= 40 ? AMBER : '#EF4444';

  return (
    <div className="flex flex-col items-center">
      <svg width="160" height="100" viewBox="0 0 160 100">
        <path d="M 10 90 A 70 70 0 0 1 150 90" fill="none" stroke="#334155" strokeWidth="10" strokeLinecap="round" />
        <path d="M 10 90 A 70 70 0 0 1 150 90" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${progress} ${circumference}`} />
        <text x="80" y="75" textAnchor="middle" fill="white" fontSize="28" fontWeight="bold">{taux}%</text>
      </svg>
      <div className="flex gap-6 mt-3 text-xs text-slate-400">
        <span>Envoyés : <strong className="text-white">{envoyes}</strong></span>
        <span>Acceptés : <strong className="text-emerald-400">{acceptes}</strong></span>
      </div>
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
          <span className="text-slate-500 text-xs">→</span>
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
  const [techDays, setTechDays] = useState(7);
  const [period, setPeriod] = useState('30d');
  const [customStart, setCustomStart] = useState(toISODate(new Date(Date.now() - 30 * 86400000)));
  const [customEnd, setCustomEnd] = useState(toISODate(new Date()));

  const adminKey = useMemo(() => `admin:${period}:${customStart}:${customEnd}:${techDays}`, [period, customStart, customEnd, techDays]);

  const { data: adminData, loading, isRevalidating, mutate: mutateAdmin } = useApi(
    adminKey,
    async () => {
      const dr = computeDateRange(period, customStart, customEnd);
      const [ov, rpt, ah, aj, mq, pn, eca, tr, tc, tcl, tp] = await Promise.all([
        api.getAdminOverview(dr).catch(() => null),
        api.getAdminReparationsParTech(techDays, dr).catch(() => null),
        api.getAdminAffluenceHeure(dr).catch(() => []),
        api.getAdminAffluenceJour(dr).catch(() => []),
        api.getAdminRepartitionMarques(dr).catch(() => []),
        api.getAdminRepartitionPannes(dr).catch(() => []),
        api.getAdminEvolutionCA(dr).catch(() => []),
        api.getAdminTempsReparation(dr).catch(() => []),
        api.getAdminTauxConversion(dr).catch(() => null),
        api.getAdminTopClients(dr).catch(() => []),
        api.getAdminPerformanceTech().catch(() => []),
      ]);
      return {
        overview: ov, repParTech: rpt,
        affluenceHeure: Array.isArray(ah) ? ah : [],
        affluenceJour: Array.isArray(aj) ? aj : [],
        marques: Array.isArray(mq) ? mq : [],
        pannes: Array.isArray(pn) ? pn : [],
        evolutionCA: Array.isArray(eca) ? eca : [],
        tempsRep: Array.isArray(tr) ? tr : [],
        conversion: tc,
        topClients: Array.isArray(tcl) ? tcl : [],
        techPerf: Array.isArray(tp) ? tp : [],
      };
    },
    { tags: ['admin'], ttl: 120_000 }
  );

  const overview = adminData?.overview ?? null;
  const repParTech = adminData?.repParTech ?? null;
  const affluenceHeure = adminData?.affluenceHeure ?? [];
  const affluenceJour = adminData?.affluenceJour ?? [];
  const marques = adminData?.marques ?? [];
  const pannes = adminData?.pannes ?? [];
  const evolutionCA = adminData?.evolutionCA ?? [];
  const tempsRep = adminData?.tempsRep ?? [];
  const conversion = adminData?.conversion ?? null;
  const topClients = adminData?.topClients ?? [];
  const techPerf = adminData?.techPerf ?? [];
  const errorMsg = (!loading && !adminData && !isRevalidating) ? 'Erreur lors du chargement des données' : '';

  const handleTechDays = (days) => { setTechDays(days); };

  // ── KPI Cards ──
  const kpiCards = overview ? [
    { label: 'CA du jour', value: formatEuro(overview.ca_jour), sub: 'payés', icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'CA du mois', value: formatEuro(overview.ca_mois), sub: 'payés', icon: TrendingUp, color: 'text-violet-400', bg: 'bg-violet-500/10' },
    { label: 'CA potentiel', value: formatEuro(overview.ca_potentiel), sub: 'devis en cours', icon: Target, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    { label: 'Répar. du jour', value: overview.reparations_jour, sub: 'terminées', icon: Activity, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Répar. du mois', value: overview.reparations_mois, sub: 'clôturées', icon: BarChart3, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
    { label: 'Ticket moyen', value: formatEuro(overview.ticket_moyen), sub: 'CA/réparation', icon: Users, color: 'text-pink-400', bg: 'bg-pink-500/10' },
  ] : [];

  // Find peak hour
  const peakHour = affluenceHeure.reduce((max, h) => h.moyenne > (max?.moyenne || 0) ? h : max, null);

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-display font-bold text-white tracking-tight">Administration</h1>
                <p className="text-sm text-slate-400 mt-0.5">Tableau de bord analytique</p>
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
        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">{errorMsg}</div>
        )}

        {/* ═══ Section 1: KPI Cards ═══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Vue d'ensemble</h2>
          {loading && !overview ? <Spinner /> : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {kpiCards.map(({ label, value, sub, icon: Icon, color, bg }) => (
                <div key={label} className="bg-slate-800 rounded-xl border border-slate-700/50 p-4 hover:border-slate-600 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{label}</span>
                    <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
                      <Icon className={`w-4 h-4 ${color}`} />
                    </div>
                  </div>
                  <p className="text-xl font-bold text-white tracking-tight">{value}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ═══ Section 2: Réparations par technicien par jour ═══ */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Réparations par technicien</h2>
            <div className="flex bg-slate-800 rounded-lg p-0.5 border border-slate-700/50">
              {TECH_DAYS_OPTIONS.map(({ label, value }) => (
                <button key={value} onClick={() => handleTechDays(value)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    techDays === value ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ChartCard title={`Réparations par technicien (${techDays} derniers jours)`}>
            {repParTech?.data?.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={repParTech.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="jour" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }}
                    label={{ value: 'Jour', position: 'insideBottom', offset: -5, style: { fill: '#64748B', fontSize: 11 } }} />
                  <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} allowDecimals={false}
                    label={{ value: 'Réparations', angle: -90, position: 'insideLeft', style: { fill: '#64748B', fontSize: 11 } }} />
                  <Tooltip content={<DarkTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} />
                  {repParTech.techniciens.map((t, i) => (
                    <Bar key={t.nom} dataKey={t.nom} stackId="a" fill={t.couleur || COLORS[i % COLORS.length]}
                      radius={i === repParTech.techniciens.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState text="Aucune réparation sur la période" />}
          </ChartCard>
        </section>

        {/* ═══ Section 3 & 4: Affluence ═══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Affluence</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Par heure */}
            <ChartCard title="Affluence par heure">
              {affluenceHeure.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={affluenceHeure}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="heure" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }}
                      label={{ value: 'Heure', position: 'insideBottom', offset: -5, style: { fill: '#64748B', fontSize: 11 } }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }}
                      label={{ value: 'Dépôts moyens', angle: -90, position: 'insideLeft', style: { fill: '#64748B', fontSize: 11 } }} />
                    <Tooltip content={<DarkTooltip />} />
                    <Bar dataKey="moyenne" name="Moyenne/jour" radius={[4, 4, 0, 0]} maxBarSize={28}>
                      {affluenceHeure.map((entry, i) => (
                        <Cell key={i} fill={entry === peakHour ? '#A78BFA' : VIOLET} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyState text="Aucune donnée d'affluence" />}
            </ChartCard>

            {/* Par jour de semaine (horizontal bars) */}
            <ChartCard title="Affluence par jour de la semaine">
              {affluenceJour.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={affluenceJour} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }}
                      label={{ value: 'Dépôts moyens', position: 'insideBottom', offset: -5, style: { fill: '#64748B', fontSize: 11 } }} />
                    <YAxis type="category" dataKey="jour" tick={{ fontSize: 11, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} width={80} />
                    <Tooltip content={<DarkTooltip />} />
                    <Bar dataKey="moyenne" name="Moyenne/semaine" fill={EMERALD} radius={[0, 4, 4, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyState text="Aucune donnée d'affluence" />}
            </ChartCard>
          </div>
        </section>

        {/* ═══ Section 5 & 6: Marques & Pannes ═══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Analyses</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Donut marques */}
            <ChartCard title="Répartition par marque">
              {marques.length ? (
                <div className="flex flex-col lg:flex-row items-center gap-4">
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={marques} cx="50%" cy="50%" innerRadius={55} outerRadius={90}
                        paddingAngle={3} dataKey="count" nameKey="marque">
                        {marques.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<DarkTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 justify-center lg:flex-col lg:gap-y-1.5">
                    {marques.map((item, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="text-xs text-slate-300">{item.marque}</span>
                        <span className="text-[10px] text-slate-500">{item.pct}% ({item.count})</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <EmptyState />}
            </ChartCard>

            {/* Top pannes horizontal bar */}
            <ChartCard title="Top 10 types de panne">
              {pannes.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={pannes} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} allowDecimals={false}
                      label={{ value: 'Nombre de tickets', position: 'insideBottom', offset: -5, style: { fill: '#64748B', fontSize: 11 } }} />
                    <YAxis type="category" dataKey="panne" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} width={130} />
                    <Tooltip content={<DarkTooltip />} />
                    <Bar dataKey="count" name="Tickets" fill={BLUE} radius={[0, 4, 4, 0]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyState />}
            </ChartCard>
          </div>
        </section>

        {/* ═══ Section 7: Évolution CA ═══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Évolution du chiffre d'affaires</h2>
          <ChartCard title="CA encaissé vs CA potentiel (12 derniers mois)">
            {evolutionCA.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={evolutionCA}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="mois" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }}
                    label={{ value: 'Mois', position: 'insideBottom', offset: -5, style: { fill: '#64748B', fontSize: 11 } }} />
                  <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }}
                    tickFormatter={(v) => `${v}€`}
                    label={{ value: "Chiffre d'affaires (€)", angle: -90, position: 'insideLeft', offset: 10, style: { fill: '#64748B', fontSize: 11 } }} />
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload) return null;
                    return (
                      <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 shadow-xl text-xs">
                        <p className="text-slate-400 mb-1 font-medium">{label}</p>
                        {payload.map((e, i) => (
                          <p key={i} style={{ color: e.color }} className="font-semibold">
                            {e.name} : {formatEuro(e.value)}
                          </p>
                        ))}
                      </div>
                    );
                  }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="ca_encaisse" name="CA encaissé" stroke={EMERALD} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="ca_potentiel" name="CA potentiel" stroke={AMBER} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} strokeDasharray="5 5" />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyState text="Aucune donnée d'évolution" />}
          </ChartCard>
        </section>

        {/* ═══ Section 8: Temps moyen réparation ═══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Temps moyen de réparation</h2>
          <ChartCard title="Durée moyenne par type de panne">
            {tempsRep.length ? (
              <ResponsiveContainer width="100%" height={Math.max(250, tempsRep.length * 35)}>
                <BarChart data={tempsRep} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }}
                    label={{ value: 'Heures', position: 'insideBottom', offset: -5, style: { fill: '#64748B', fontSize: 11 } }} />
                  <YAxis type="category" dataKey="panne" tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={{ stroke: '#334155' }} width={130} />
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 shadow-xl text-xs">
                        <p className="text-slate-400 mb-1 font-medium">{label}</p>
                        <p className="text-violet-400 font-semibold">{formatTemps(payload[0].value)}</p>
                        <p className="text-slate-500">{payload[0].payload.nb} réparations</p>
                      </div>
                    );
                  }} />
                  <Bar dataKey="temps_moyen_heures" name="Temps moyen" fill={VIOLET} radius={[0, 4, 4, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState text="Pas assez de données" />}
          </ChartCard>
        </section>

        {/* ═══ Section 9: Conversion + Performance ═══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Performance</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Taux conversion */}
            <ChartCard title="Taux de conversion devis">
              {conversion ? (
                <ConversionGauge taux={conversion.taux} envoyes={conversion.devis_envoyes} acceptes={conversion.devis_acceptes} />
              ) : <EmptyState text="Aucune donnée" />}
            </ChartCard>

            {/* Performance tech table */}
            <ChartCard title="Performance techniciens" className="lg:col-span-2">
              {techPerf.length ? (
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2">Technicien</th>
                        <th className="text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2">Répar.</th>
                        <th className="text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2">Temps moy.</th>
                        <th className="text-right text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2">CA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {techPerf.map((t, i) => (
                        <tr key={i} className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors">
                          <td className="py-2.5">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-lg bg-violet-500/20 flex items-center justify-center">
                                <span className="text-[10px] font-bold text-violet-400">{(t.technicien || '?')[0].toUpperCase()}</span>
                              </div>
                              <span className="text-sm font-medium text-white">{t.technicien}</span>
                            </div>
                          </td>
                          <td className="py-2.5 text-center text-sm text-slate-300">{t.reparations}</td>
                          <td className="py-2.5 text-center text-sm text-slate-300">{formatTemps((t.temps_moyen_minutes || 0) / 60)}</td>
                          <td className="py-2.5 text-right text-sm font-semibold text-emerald-400">{formatEuro(t.ca_genere)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState text="Aucune donnée" />}
            </ChartCard>
          </div>
        </section>

        {/* ═══ Section 10: Top clients ═══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Top clients fidèles</h2>
          <ChartCard title="Top 10 clients par nombre de réparations">
            {topClients.length ? (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2">#</th>
                      <th className="text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2">Client</th>
                      <th className="text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2">Téléphone</th>
                      <th className="text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2">Réparations</th>
                      <th className="text-right text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2">CA total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topClients.map((c, i) => (
                      <tr key={i} className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors">
                        <td className="py-2.5 text-sm text-slate-500 font-medium">{i + 1}</td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center">
                              <UserCheck className="w-3.5 h-3.5 text-blue-400" />
                            </div>
                            <span className="text-sm font-medium text-white">{c.nom}</span>
                          </div>
                        </td>
                        <td className="py-2.5">
                          <span className="flex items-center gap-1.5 text-sm text-slate-400">
                            <Phone className="w-3 h-3" /> {c.tel || '—'}
                          </span>
                        </td>
                        <td className="py-2.5 text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-500/20 text-violet-300">
                            {c.nb_reparations}
                          </span>
                        </td>
                        <td className="py-2.5 text-right text-sm font-semibold text-emerald-400">{formatEuro(c.ca_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState text="Aucun client récurrent" />}
          </ChartCard>
        </section>

        {/* Footer */}
        <div className="pt-4 pb-8 text-center">
          <p className="text-xs text-slate-600">Klikphone SAV — Panneau d'administration</p>
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
    } catch { return null; }
  });

  if (!auth) {
    return <AdminLogin onLogin={(data) => setAuth(data)} />;
  }

  return <AdminDashboard onLogout={() => { localStorage.removeItem(AUTH_KEY); setAuth(null); }} />;
}
