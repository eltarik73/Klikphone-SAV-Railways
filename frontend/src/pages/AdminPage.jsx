import { useState, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { annoncerModeAdmin } from '../components/AdminLoginModal';
import { useApi } from '../hooks/useApi';
import CarteChiffres from '../components/CarteChiffres';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Lock, LogOut, Minus, BarChart3,
  Calendar, ChevronUp, ChevronDown, Smartphone, Tag,
  Home, Search, User,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────
const VIOLET = '#7C3AED';
const SERIE_SECONDAIRE = '#64748B'; // slate-500 : 4,76:1 sur blanc (≥ 3:1 pour le trait et les barres)
const GRILLE = '#E2E8F0';
const TEXTE_AXES = '#64748B';

const PERIOD_OPTIONS = [
  { label: "Aujourd'hui", value: 'today', gran: 'heure' },
  { label: 'Hier', value: 'yesterday', gran: 'heure' },
  { label: 'Ce mois', value: 'month', gran: 'jour' },
  { label: '12 mois', value: '12m', gran: 'mois' },
  { label: 'Personnalisé', value: 'custom', gran: 'jour' },
];

// Texte de légende des graphiques en slate-600 (recharts le colore sinon avec la couleur de la série)
const legendeTexte = (value) => <span className="text-slate-600">{value}</span>;
const AUTH_KEY = 'kp_admin_auth';

// ─── Helpers ──────────────────────────────────────────────
// Formats français (Intl) : « 1 234,50 € », « 2 h 30 min », « 12 % »
function formatEuro(n) {
  return (Number(n) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function formatTemps(heures) {
  if (!heures && heures !== 0) return '—';
  const h = Math.floor(heures);
  const m = Math.round((heures - h) * 60);
  if (h === 0) return `${m} min`;
  return `${h} h${m > 0 ? ` ${m} min` : ''}`;
}

// L'API envoie 12 pour 12 %
const fmtPourcent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
const pourcent = (v) => fmtPourcent.format((Number(v) || 0) / 100);

function formatKpiValue(value, format) {
  switch (format) {
    case 'euro': return formatEuro(value);
    case 'heures': return formatTemps(value);
    case 'pct': return pourcent(value);
    default: return typeof value === 'number' ? value.toLocaleString('fr-FR') : String(value ?? '—');
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

// Info-bulle des graphiques (thème clair)
function DarkTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="card shadow-md px-3 py-2 text-xs">
      <p className="t-caption mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="font-semibold text-slate-900 tabular-nums">
          <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: entry.color || entry.fill || VIOLET }} aria-hidden="true" />
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

// Squelette aux dimensions finales de la carte des indicateurs (pas de décalage à l'arrivée des données, CLS) :
// mêmes cellules que la carte chargée, libellés et valeurs encore inconnus
const INDICATEURS_EN_CHARGEMENT = [0, 1, 2, 3, 4, 5, 6, 7].map((cle) => ({ cle }));

function Spinner() {
  return (
    <>
      <CarteChiffres label="Indicateurs du reporting" chargement colonnes={{ base: 2, sm: 4 }} chiffres={INDICATEURS_EN_CHARGEMENT} />
      <p className="sr-only" role="status">Chargement du reporting</p>
    </>
  );
}

function EmptyState({ text }) {
  return (
    <div className="empty-state min-h-[160px] py-6">
      <div className="empty-state-icon"><BarChart3 aria-hidden="true" /></div>
      <p className="t-body text-slate-500">{text || 'Aucune donnée disponible'}</p>
    </div>
  );
}

function ChartCard({ title, children, className = '' }) {
  return (
    <div className={`card card-body ${className}`}>
      <h3 className="t-h2 mb-4">{title}</h3>
      {children}
    </div>
  );
}

// ─── Trend Badge ──────────────────────────────────────────
function TrendBadge({ trend }) {
  if (trend === null || trend === undefined) return null;
  const isUp = trend > 0;
  const isFlat = trend === 0;
  const color = isFlat ? 'text-slate-600' : isUp ? 'text-emerald-700' : 'text-red-700';
  const Icon = isFlat ? Minus : isUp ? ChevronUp : ChevronDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${color}`}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      <span className="sr-only">{isFlat ? 'Stable' : isUp ? 'En hausse de' : 'En baisse de'} </span>
      {pourcent(Math.abs(trend))}
    </span>
  );
}

// ─── Progress Bar ─────────────────────────────────────────
function ProgressBar({ pct, color = 'bg-brand-600' }) {
  return (
    <div className="w-full bg-slate-100 rounded-full h-2">
      <div className={`h-2 rounded-full ${color}`}
        style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

// ─── Period Selector ──────────────────────────────────────
function PeriodSelector({ period, setPeriod, customStart, setCustomStart, customEnd, setCustomEnd }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="segmented" role="group" aria-label="Période">
        {PERIOD_OPTIONS.map(({ label, value }) => (
          <button key={value} type="button" onClick={() => setPeriod(value)} aria-pressed={period === value}
            className={`segmented-item ${period === value ? 'segmented-item-active' : ''}`}>
            {label}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="flex items-center gap-2">
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} aria-label="Date de début"
            className="input w-auto" />
          <span className="text-slate-500 text-sm" aria-hidden="true">→</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} aria-label="Date de fin"
            className="input w-auto" />
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
        // Mode admin du poste + événement : la barre latérale passe en « Mode Admin » sans rechargement
        annoncerModeAdmin(true);
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        <div className="card p-6 sm:p-8">
          <div className="flex justify-center mb-6">
            <Lock className="w-5 h-5 text-slate-500" aria-hidden="true" />
          </div>
          <h1 className="t-h1 text-center mb-1">Administration</h1>
          <p className="text-sm text-slate-500 text-center mb-8">Accès réservé aux administrateurs</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="admin-identifiant" className="input-label">Identifiant</label>
              <input id="admin-identifiant" type="text" value={identifiant} onChange={(e) => setIdentifiant(e.target.value)}
                className="input"
                placeholder="Votre identifiant" autoComplete="username" />
            </div>
            <div>
              <label htmlFor="admin-mot-de-passe" className="input-label">Mot de passe</label>
              <input id="admin-mot-de-passe" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••" autoComplete="current-password" />
            </div>
            {error && (
              <div role="alert" className="callout callout-danger justify-center font-medium">{error}</div>
            )}
            <button type="submit" disabled={loading || !identifiant || !password}
              className="btn-primary btn-lg btn-block">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full motion-safe:animate-spin" aria-hidden="true" /> Connexion…
                </span>
              ) : 'Se connecter'}
            </button>
          </form>
        </div>
        <p className="text-center t-caption mt-6">Klikphone SAV — Administration</p>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────
function AdminDashboard({ onLogout }) {
  const location = useLocation();
  const basePath = location.pathname.startsWith('/tech') ? '/tech' : '/accueil';
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

  // Tracking clics sur le lien public "Voir nos tarifs telephones"
  const trackingKey = `tracking:tarifs_click:30`;
  const { data: tracking, loading: trackingLoading } = useApi(
    trackingKey,
    () => api.getTrackingStats('tarifs_click', 30),
    { tags: ['tracking'], ttl: 120_000 }
  );

  const kpis = report?.kpis ?? [];
  const affluence = report?.affluence ?? [];
  const perfAccueil = report?.performance_accueil ?? [];
  const perfTech = report?.performance_techniciens ?? [];
  const topPannes = report?.top_pannes ?? [];
  const topModeles = report?.top_modeles ?? [];
  const granularite = dateRange.granularite;

  return (
    <div className="page max-w-[1280px]">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Reporting</h1>
          <p className="page-header-subtitle">Vue d'ensemble de la boutique</p>
        </div>
        <div className="page-header-actions max-w-full">
          {/* Libellé masqué sur mobile : le nom accessible vient de l'aria-label */}
          <button type="button" onClick={onLogout} aria-label="Déconnexion"
            className="btn-secondary">
            <LogOut aria-hidden="true" />
            <span className="hidden sm:inline" aria-hidden="true">Déconnexion</span>
          </button>
        </div>
      </div>
      {/* Period filter */}
      <div className="flex items-center gap-2 mb-6">
        <Calendar className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
        <PeriodSelector period={period} setPeriod={setPeriod}
          customStart={customStart} setCustomStart={setCustomStart}
          customEnd={customEnd} setCustomEnd={setCustomEnd} />
      </div>

      <div className="space-y-6 md:space-y-8">

        {/* ═══ Section 1: KPI Cards ═══ */}
        <section>
          {loading && kpis.length === 0 ? <Spinner /> : (
            <CarteChiffres label="Indicateurs du reporting" colonnes={{ base: 2, sm: 4 }} chiffres={kpis.map((kpi) => ({
              cle: kpi.id,
              label: kpi.label,
              valeur: formatKpiValue(kpi.value, kpi.format),
              variation: <TrendBadge trend={kpi.trend} />,
            }))} />
          )}
        </section>

        {/* ═══ Section 1b: Tracking clics vitrine tarifs (mêmes cellules en squelette pendant la lecture) ═══ */}
        {(tracking || trackingLoading) && (
          <section>
            <h2 className="t-h2 mb-4 flex items-center gap-2">
              <Tag className="w-4 h-4 text-slate-500" aria-hidden="true" /> Vitrine tarifs téléphones <span className="t-caption">— 30 derniers jours</span>
            </h2>
            <CarteChiffres label="Chiffres de la vitrine tarifs" chargement={!tracking} colonnes={{ base: 1, sm: 3 }} chiffres={[
              {
                cle: 'total',
                label: 'Clics sur 30 jours',
                valeur: tracking?.total || 0,
                detail: `${tracking?.unique_visitors || 0} visiteur${(tracking?.unique_visitors || 0) > 1 ? 's' : ''} unique${(tracking?.unique_visitors || 0) > 1 ? 's' : ''}`,
              },
              {
                cle: 'jour',
                label: "Aujourd'hui",
                valeur: tracking?.today || 0,
                detail: `clic${(tracking?.today || 0) > 1 ? 's' : ''} sur « Voir nos tarifs »`,
              },
              {
                cle: 'source',
                label: 'Par source',
                contenu: (tracking?.by_source || []).length === 0 ? (
                  <p className="text-sm text-slate-500">Aucun clic pour le moment</p>
                ) : (
                  <div className="space-y-1">
                    {tracking.by_source.slice(0, 4).map(s => (
                      <div key={s.source} className="flex items-center justify-between text-sm">
                        <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
                          {s.source === 'home' ? <><Home className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />Accueil</>
                            : s.source === 'suivi' ? <><Search className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />Page suivi</>
                            : s.source === 'autre' ? '— Autre' : s.source}
                        </span>
                        <span className="t-num tabular-nums">{s.n}</span>
                      </div>
                    ))}
                  </div>
                ),
              },
            ]} />
          </section>
        )}

        {/* ═══ Section 2: Affluence Chart ═══ */}
        <section>
          <h2 className="t-h2 mb-4">Affluence</h2>
          <ChartCard title={granularite === 'heure' ? 'Dépôts par heure' : granularite === 'mois' ? 'Dépôts par mois' : 'Dépôts par jour'}>
            {affluence.length ? (
              <ResponsiveContainer width="100%" height={320}>
                {granularite === 'mois' ? (
                  <LineChart data={affluence}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRILLE} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: TEXTE_AXES }} tickLine={false} axisLine={{ stroke: GRILLE }} />
                    <YAxis tick={{ fontSize: 12, fill: TEXTE_AXES }} tickLine={false} axisLine={{ stroke: GRILLE }} allowDecimals={false} />
                    <Tooltip content={<DarkTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendeTexte} />
                    <Line type="monotone" dataKey="tickets" name="Tickets" stroke={VIOLET} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="clients" name="Clients" stroke={SERIE_SECONDAIRE} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} strokeDasharray="5 5" />
                  </LineChart>
                ) : (
                  <BarChart data={affluence}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRILLE} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: TEXTE_AXES }} tickLine={false} axisLine={{ stroke: GRILLE }} />
                    <YAxis tick={{ fontSize: 12, fill: TEXTE_AXES }} tickLine={false} axisLine={{ stroke: GRILLE }} allowDecimals={false} />
                    <Tooltip content={<DarkTooltip />} cursor={{ fill: '#F1F5F9' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendeTexte} />
                    <Bar dataKey="tickets" name="Tickets" fill={VIOLET} radius={[4, 4, 0, 0]} maxBarSize={32} />
                    <Bar dataKey="clients" name="Clients" fill={SERIE_SECONDAIRE} radius={[4, 4, 0, 0]} maxBarSize={32} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            ) : <EmptyState text="Aucune donnée d'affluence" />}
          </ChartCard>
        </section>

        {/* ═══ Section 3: Performance Accueil ═══ */}
        {perfAccueil.length > 0 && (
          <section>
            <h2 className="t-h2 mb-4">Performance de l’accueil</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {perfAccueil.map((p) => {
                return (
                  <div key={p.utilisateur} className="card card-body">
                    <div className="flex items-center gap-3 mb-3">
                      <User className="w-5 h-5 text-slate-500 shrink-0" aria-hidden="true" />
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{p.utilisateur}</p>
                        <p className="t-caption">Accueil</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xl font-semibold text-slate-900 tabular-nums">{p.tickets_enregistres}</p>
                        <p className="t-caption">Tickets enregistrés</p>
                      </div>
                      <div>
                        <p className="text-xl font-semibold text-slate-900 tabular-nums">{p.clients_uniques}</p>
                        <p className="t-caption">Clients uniques</p>
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
          <h2 className="t-h2 mb-4">Performance des techniciens</h2>
          <ChartCard title="Classement des techniciens">
            {perfTech.length ? (
              <div className="overflow-x-auto -mx-4 sm:-mx-5">
                <table className="table">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="table-header w-10">#</th>
                      <th className="table-header">Technicien</th>
                      <th className="table-header text-right">Réparations</th>
                      <th className="table-header text-right">Temps moy.</th>
                      <th className="table-header text-right">CA généré</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perfTech.map((t) => (
                      <tr key={t.technicien} className="table-row">
                        <td>
                          <span className="badge badge-neutral tabular-nums">{t.rang}</span>
                        </td>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100" aria-hidden="true">
                              <span className="text-xs font-semibold text-slate-700">
                                {(t.technicien || '?')[0].toUpperCase()}
                              </span>
                            </div>
                            <span className="text-sm font-medium text-slate-900">{t.technicien}</span>
                          </div>
                        </td>
                        <td className="table-cell-num">{t.reparations}</td>
                        <td className="text-right text-sm text-slate-700 tabular-nums">{formatTemps(t.temps_moyen_h)}</td>
                        <td className="table-cell-num">{formatEuro(t.ca_genere)}</td>
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
          <h2 className="t-h2 mb-4">Analyses</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Pannes */}
            <ChartCard title="Top 10 des pannes">
              {topPannes.length ? (
                <div className="space-y-3">
                  {topPannes.map((p, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-slate-700 truncate max-w-[60%]">{p.label}</span>
                        <span className="text-sm font-semibold text-slate-900 ml-2 tabular-nums">{p.count} <span className="text-slate-500 font-normal">({pourcent(p.pct)})</span></span>
                      </div>
                      <ProgressBar pct={p.pct} />
                    </div>
                  ))}
                </div>
              ) : <EmptyState text="Aucune panne enregistrée" />}
            </ChartCard>

            {/* Top Modèles */}
            <ChartCard title="Top 10 des modèles réparés">
              {topModeles.length ? (
                <div className="space-y-3">
                  {topModeles.map((m, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 truncate max-w-[60%]">
                          <Smartphone className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                          <span className="text-sm text-slate-700 truncate">{m.label}</span>
                        </div>
                        <span className="text-sm font-semibold text-slate-900 ml-2 tabular-nums">{m.count} <span className="text-slate-500 font-normal">({pourcent(m.pct)})</span></span>
                      </div>
                      <ProgressBar pct={m.pct} />
                    </div>
                  ))}
                </div>
              ) : <EmptyState text="Aucun modèle enregistré" />}
            </ChartCard>
          </div>
        </section>

      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────
export default function AdminPage() {
  const navigate = useNavigate();
  const location = useLocation();
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

  // Déconnexion du reporting = verrouillage du mode admin (preuve du code retirée côté serveur),
  // retour au tableau de bord comme « Verrouiller » dans la barre latérale
  const deconnecter = () => {
    api.lockAdmin();
    setAuth(null);
    navigate(location.pathname.startsWith('/tech') ? '/tech' : '/accueil', { replace: true });
  };
  return <AdminDashboard onLogout={deconnecter} />;
}
