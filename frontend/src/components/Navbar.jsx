import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../lib/api';
import { usePolling } from '../hooks/usePolling';
import AdminLoginModal, { ADMIN_MODE_EVENT } from './AdminLoginModal';
import NotificationCenter from './NotificationCenter';
import { openSearchPalette, shortcutLabel } from './SearchPalette';
import {
  LogOut, LayoutDashboard, Users, Package, FileText,
  Menu, X, Search, PanelLeftClose, QrCode,
  RefreshCw, Tag, Star, Megaphone, ChevronDown, Wrench, Smartphone,
  Lock, Unlock, BarChart3, Settings, Zap, ShoppingBag, FlaskConical, Tv, Inbox, CalendarClock,
} from 'lucide-react';

// Badges : un tour par minute onglet visible (aucun onglet masqué), sans relance automatique.
// Demandes de commande, commandes de pièces en cours et avis Google, moins urgents, toutes les 2,
// 2 et 5 minutes. Les avis (rôle admin ET code admin saisi sur ce poste) ne sont interrogés qu'en
// mode admin, et plus du tout après un refus (403) jusqu'à la prochaine saisie du code.
const BADGES_POLL_MS = 60_000;
const DEMANDES_EVERY_MS = 2 * 60_000;
const COMMANDES_EVERY_MS = 2 * 60_000;
const AVIS_EVERY_MS = 5 * 60_000;
// Propositions de prix en attente (santé des prix) : une fois par minute au plus, rôle admin seulement
const SANTE_PRIX_EVERY_MS = 60_000;

// Design V2 : une seule couleur d'accent (brand) dans la barre latérale ; les rubriques ne sont plus
// colorées, la hiérarchie vient du poids et de l'espace. Texte slate-300, secondaire slate-400 (AA).
const FOCUS_DARK = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-inset';

// La préférence « barre repliée » (kp_sidebar_collapsed) n'a de sens qu'au bureau (≥ lg, barre fixe) :
// sous lg la barre est un tiroir qui s'ouvre toujours complet (icônes + libellés), sinon la croix
// « Fermer le menu » se superposait au logo dans un tiroir de 72 px.
const DESKTOP_QUERY = '(min-width: 1024px)';
const matchDesktop = () =>
  (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
    ? window.matchMedia(DESKTOP_QUERY).matches
    : true;

// ─── Infobulle du mode replié (visuelle ; le nom accessible vient de l'aria-label du bouton) ───
// Composants définis hors du rendu : le menu n'est plus remonté à chaque mise à jour de compteur.
function Tooltip({ label, children, badge, collapsed }) {
  return (
    <div className="group/tip relative">
      {children}
      {collapsed && (
        <span
          className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 z-[60]
            whitespace-nowrap rounded-lg bg-slate-800 border border-white/10 px-2.5 py-1.5
            text-xs font-medium text-slate-100 shadow-lg
            opacity-0 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100
            transition-opacity duration-150 ease-out"
        >
          {label}
          {badge > 0 && (
            <span className="badge-count badge-count-brand ml-2">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

// Compteur rond 18 px : slate (total), rouge (urgence), brand (total mis en avant)
function Badge({ value, tone = 'neutral' }) {
  if (!value || value <= 0) return null;
  const toneCls = { neutral: '', brand: 'badge-count-brand', red: 'badge-count-danger' }[tone] || '';
  const label = value > 99 ? '99+' : value;
  return <span className={`badge-count ${toneCls}`}>{label}</span>;
}

// Point d'urgence 8 px quand un compteur est déjà affiché à côté (le total)
function AlertDot({ value }) {
  if (!value || value <= 0) return null;
  return <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" aria-hidden="true" />;
}

function DotBadge({ value, tone = 'neutral' }) {
  if (!value || value <= 0) return null;
  const bg = tone === 'red' ? 'badge-count-danger' : 'badge-count-brand';
  return (
    <span className={`badge-count ${bg} absolute top-0.5 right-0.5 ring-2 ring-slate-900`}>
      {value > 9 ? '9+' : value}
    </span>
  );
}

// ─── Rubrique (overline discret + chevron) : plus de couleur par rubrique ───
function SectionHeader({ label, icon: Icon, open, onToggle, collapsed }) {
  if (collapsed) {
    return (
      <div className="relative my-2 flex justify-center" aria-hidden="true">
        <span className="block w-8 h-px bg-white/10" />
        <Icon className="w-4 h-4 absolute -top-2 bg-slate-900 px-0.5 text-slate-400" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!!open}
      className={`w-full min-h-11 flex items-center justify-between px-3 py-2 mb-1 short:mb-0 rounded-lg group/sec
        text-slate-400 hover:text-slate-200 transition-colors duration-150 ${FOCUS_DARK}`}
    >
      <span className="flex items-center gap-2 t-overline text-slate-400 group-hover/sec:text-slate-200">
        <Icon className="w-4 h-4" aria-hidden="true" />
        {label}
      </span>
      <ChevronDown
        className={`w-4 h-4 transition-transform duration-150 ease-out ${open ? 'rotate-0' : '-rotate-90'}`}
        aria-hidden="true"
      />
    </button>
  );
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsedPref, setCollapsedPref] = useState(() => localStorage.getItem('kp_sidebar_collapsed') === '1');
  const [desktop, setDesktop] = useState(matchDesktop);
  const collapsed = collapsedPref && desktop;
  const [pendingCount, setPendingCount] = useState(0);
  const [commandesEnCours, setCommandesEnCours] = useState(0);
  const [tarifsOpen, setTarifsOpen] = useState(() => localStorage.getItem('kp_tarifs_open') !== '0');
  const [adminOpen, setAdminOpen] = useState(() => localStorage.getItem('kp_admin_open') !== '0');
  const [betaOpen, setBetaOpen] = useState(() => localStorage.getItem('kp_beta_open') === '1');
  const [avisNonRepondus, setAvisNonRepondus] = useState(0);
  const [interactionCount, setInteractionCount] = useState(0);
  const [demandesCmdNew, setDemandesCmdNew] = useState(0);
  const [propositionsPrix, setPropositionsPrix] = useState(0);
  const [moduleDevis, setModuleDevis] = useState(false);
  const [moduleDevisFlash, setModuleDevisFlash] = useState(false);
  const [devisOpen, setDevisOpen] = useState(() => localStorage.getItem('kp_devis_open') !== '0');

  // Admin mode state (suivi de api.setAdminMode : code saisi ailleurs, verrouillage depuis le reporting…)
  const [isAdminMode, setIsAdminMode] = useState(() => localStorage.getItem('klikphone_admin') === 'true');
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [pendingAdminPath, setPendingAdminPath] = useState(null);
  // Avis Google refusés (403 : code admin non prouvé sur ce poste) : plus d'appel jusqu'à la prochaine élévation
  const avisRefusRef = useRef(false);
  useEffect(() => {
    const onMode = (e) => {
      const admin = Boolean(e?.detail?.admin);
      if (admin) avisRefusRef.current = false;
      setIsAdminMode(admin);
    };
    window.addEventListener(ADMIN_MODE_EVENT, onMode);
    return () => window.removeEventListener(ADMIN_MODE_EVENT, onMode);
  }, []);

  // Pause onglet masqué, rafraîchissement immédiat au retour (usePolling)
  const lastSlowRef = useRef({ demandes: 0, commandes: 0, avis: 0, santePrix: 0 });
  const isRoleAdmin = user?.role === 'admin';
  usePolling(() => {
    const now = Date.now();
    const last = lastSlowRef.current;
    const demandes = now - last.demandes >= DEMANDES_EVERY_MS;
    const commandes = now - last.commandes >= COMMANDES_EVERY_MS;
    const avis = isRoleAdmin && isAdminMode && !avisRefusRef.current
      && now - last.avis >= AVIS_EVERY_MS;
    // Retour sur l'onglet (appel immédiat) : pas de relecture si la dernière a moins d'une minute
    const santePrix = isRoleAdmin && typeof api.getSantePrix === 'function' && now - last.santePrix >= SANTE_PRIX_EVERY_MS;
    if (demandes) last.demandes = now;
    if (commandes) last.commandes = now;
    if (avis) last.avis = now;
    if (santePrix) last.santePrix = now;
    return api.background(() => Promise.all([
      api.getKPI().then(kpi => setPendingCount(kpi?.total_actifs || 0)).catch(() => {}),
      api.getInteractions().then(d => setInteractionCount(d?.total_actions ?? 0)).catch(() => {}),
      demandes && api.countDemandesCommandesNouvelles().then(d => setDemandesCmdNew(d?.count ?? 0)).catch(() => {}),
      // Même compteur que la pastille « commandes pièces » du tableau de bord
      commandes && api.getParts({ statut: 'en_cours' })
        .then(p => setCommandesEnCours(Array.isArray(p) ? p.length : 0)).catch(() => {}),
      avis && api.getAvisGoogleStats().then(s => setAvisNonRepondus(s?.non_repondus || 0)).catch((err) => {
        if (err?.status === 403) { avisRefusRef.current = true; setAvisNonRepondus(0); }
      }),
      // Appel synchrone (en-tête « de fond » posé par api.background) ; une exception devient un rejet
      santePrix && new Promise((resolve) => resolve(api.getSantePrix()))
        .then(s => setPropositionsPrix(Math.max(0, Math.round(Number(s?.propositions_en_attente)) || 0)))
        .catch(() => {}),
    ]));
  }, BADGES_POLL_MS, { enabled: Boolean(user?.utilisateur) });

  // Visibilité des modules : une fois par session (liste [{cle, valeur}] ou objet {cle: valeur}).
  // Partagée avec la lecture de la page (fiche ticket : getCached) : un seul GET /api/config (api.get)
  useEffect(() => {
    if (!user?.utilisateur) return;
    api.getConfig().then(cfg => {
      const map = {};
      if (Array.isArray(cfg)) cfg.forEach(p => { map[p.cle] = p.valeur; });
      else Object.assign(map, cfg || {});
      setModuleDevis(map.MODULE_DEVIS_VISIBLE === 'true');
      setModuleDevisFlash(map.MODULE_DEVIS_FLASH_VISIBLE === 'true');
    }).catch(() => {});
  }, [user?.utilisateur]);

  // Bureau ↔ mobile (rotation d'une tablette, redimensionnement) : suit la media query
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e) => setDesktop(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange); else mq.addListener(onChange);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', onChange); else mq.removeListener(onChange); };
  }, []);

  // Fondu bas de la navigation tant qu'il reste des entrées sous le pli (écran bas : iPad paysage 768 px)
  const navRef = useRef(null);
  const [navScrollable, setNavScrollable] = useState(false);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return undefined;
    const update = () => setNavScrollable(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [user?.utilisateur, collapsed, mobileOpen, tarifsOpen, adminOpen, betaOpen, devisOpen, moduleDevis, moduleDevisFlash, isAdminMode]);

  const toggleCollapse = () => {
    const next = !collapsedPref;
    setCollapsedPref(next);
    localStorage.setItem('kp_sidebar_collapsed', next ? '1' : '0');
    window.dispatchEvent(new CustomEvent('sidebar-toggle', { detail: { collapsed: next } }));
  };

  if (!user) return null;

  const basePath = user.target === 'tech' ? '/tech' : '/accueil';
  const searchShortcut = shortcutLabel();

  const navItems = [
    { path: basePath, label: 'Dashboard', icon: LayoutDashboard, badge: pendingCount, alertBadge: interactionCount },
    { path: `${basePath}/clients`, label: 'Clients', icon: Users },
    { path: `${basePath}/commandes`, label: 'Commandes', icon: Package, badge: commandesEnCours },
    { path: `${basePath}/demandes-commandes`, label: 'Demandes de commande', icon: ShoppingBag, badge: demandesCmdNew },
    { path: `${basePath}/attestation`, label: 'Attestation', icon: FileText },
    { path: '/suivi', label: 'Suivi (vue client)', icon: QrCode },
  ];

  // Badge des propositions de prix : jamais pour un membre qui n'a pas le rôle admin
  const nbPropositionsPrix = isRoleAdmin ? propositionsPrix : 0;
  const adminItems = [
    { path: `${basePath}/admin`, label: 'Reporting', icon: BarChart3 },
    // Réservée au rôle admin : aucun autre membre ne voit l'entrée dans le menu
    ...(isRoleAdmin ? [{ path: `${basePath}/activite`, label: 'Activité de l’équipe', icon: CalendarClock }] : []),
    {
      // Même page que les tuiles « Santé des prix » (PropositionsPrix.cheminPrixARevoir), onglet propositions
      path: `${basePath}/prix-a-revoir`, to: `${basePath}/prix-a-revoir?onglet=propositions`,
      label: 'Prix à revoir', icon: Inbox, badge: nbPropositionsPrix,
      aria: nbPropositionsPrix > 0
        ? `Prix à revoir : ${nbPropositionsPrix} proposition${nbPropositionsPrix > 1 ? 's' : ''} de prix en attente`
        : 'Prix à revoir',
    },
    { path: `${basePath}/avis-google`, label: 'Avis Google', icon: Star, badge: avisNonRepondus },
    { path: `${basePath}/community`, label: 'Community Manager', icon: Megaphone },
    { path: `${basePath}/config`, label: 'Configuration', icon: Settings },
    { path: '/site-tarifs-iphone', label: 'Site Tarifs iPhone', icon: Tv, pill: 'BETA' },
  ];

  // « Réparation smartphones » (/tarifs) est désormais dans la rubrique Tarifs
  const betaItems = [
    { path: `${basePath}/tarifs-telephones`, label: 'Téléphones', icon: Smartphone },
    { path: `${basePath}/telephones-vente`, label: 'Mes téléphones', icon: ShoppingBag },
  ];

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

  const adminPages = ['/admin', '/avis-google', '/community', '/config', '/prix-a-revoir', '/activite'];
  const isOnAdminPage = adminPages.some(p => location.pathname.includes(p));

  const handleNav = (path) => {
    navigate(path);
    setMobileOpen(false);
  };

  const handleAdminNav = (path) => {
    if (isAdminMode) {
      handleNav(path);
    } else {
      setPendingAdminPath(path);
      setShowAdminModal(true);
    }
  };

  const handleAdminSuccess = () => {
    avisRefusRef.current = false;
    setIsAdminMode(true);
    setShowAdminModal(false);
    if (pendingAdminPath) {
      navigate(pendingAdminPath);
      setMobileOpen(false);
      setPendingAdminPath(null);
    }
  };

  const lockAdmin = () => {
    // Verrouiller retire la preuve du code côté serveur (POST /api/admin/lock), l'élévation (10 min)
    // et le mode admin : plus aucune action ni lecture réservée sans ressaisir le code.
    // Local d'abord (immédiat, même sans réseau), puis le serveur
    localStorage.removeItem('klikphone_admin');
    api.clearAdminToken();
    api.lockAdmin();
    setIsAdminMode(false);
    if (isOnAdminPage) {
      navigate(basePath, { replace: true });
    }
  };

  const handleSwitchUser = () => {
    navigate(`/login/${user.target}?switch=1`);
  };

  // ─── Entrée de menu : une seule teinte (brand), actif = fond brand/20 + barre gauche 3 px ───
  const navBtnClass = (active) => {
    const base = `group/nav w-full min-h-11 flex items-center gap-3 rounded-lg text-[13px] font-medium
      transition-colors duration-150 ease-out relative ${FOCUS_DARK}
      ${collapsed ? 'justify-center px-0 py-2.5 short:py-1.5' : 'px-3 py-2.5 short:py-1.5'}`;
    const activeCls = `bg-brand-600/20 text-white
      ${collapsed ? '' : 'before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-brand-500'}`;
    const idle = 'text-slate-300 hover:text-white hover:bg-white/[0.06]';
    return `${base} ${active ? activeCls : idle}`;
  };

  const iconCls = (active) =>
    `w-5 h-5 shrink-0 ${active ? 'text-brand-300' : 'text-slate-400 group-hover/nav:text-slate-200'}`;

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-slate-900 border-b border-white/10 flex items-center px-4 z-40">
        <button type="button" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu"
          className={`w-11 h-11 -ml-2.5 flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors ${FOCUS_DARK}`}>
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
        <div className="flex items-center gap-2.5 ml-1 min-w-0">
          <img src="/logo_k.png" alt="Klikphone" className="w-7 h-7 rounded-lg object-contain" />
          <span className="text-white font-display font-bold tracking-tight">KLIKPHONE</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => openSearchPalette()} aria-label="Rechercher un ticket, un client…"
            className={`w-11 h-11 flex items-center justify-center rounded-lg text-slate-200 hover:text-white hover:bg-white/10 transition-colors ${FOCUS_DARK}`}>
            <Search className="w-5 h-5" aria-hidden="true" />
          </button>
          {pendingCount > 0 && (
            <span className="badge-count badge-count-brand"
              aria-label={`${pendingCount} tickets actifs`}>
              {pendingCount}
            </span>
          )}
        </div>
      </div>

      {/* Backdrop */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 bg-slate-900/60 z-40 animate-in" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 bottom-0 bg-slate-900 flex flex-col z-50
        border-r border-white/[0.06]
        transition-[width,transform] duration-200 ease-in-out motion-reduce:transition-none
        ${collapsed ? 'w-[72px]' : 'w-64'}
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
      `}>
        {/* Logo header */}
        <div className={`h-16 flex items-center border-b border-white/[0.06] shrink-0 overflow-hidden
          ${collapsed ? 'px-3 justify-center' : 'px-4 gap-3'}`}>
          <div className="w-10 h-10 rounded-xl bg-white p-1 overflow-hidden shrink-0 shadow-xs">
            <img src="/logo_k.png" alt="Klikphone" className="w-full h-full object-contain" />
          </div>
          <div className={`flex-1 min-w-0 transition-opacity duration-200 ease-out
            ${collapsed ? 'opacity-0 w-0 pointer-events-none' : 'opacity-100'}`}>
            <h1 className="text-white font-display font-bold text-base tracking-tight leading-none whitespace-nowrap">KLIKPHONE</h1>
            <p className="text-slate-400 text-xs uppercase tracking-[0.06em] mt-1 whitespace-nowrap">Service après-vente</p>
          </div>
          <button type="button" onClick={() => setMobileOpen(false)} aria-label="Fermer le menu"
            className={`lg:hidden w-11 h-11 -mr-2 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors ${FOCUS_DARK}`}>
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Navigation — zone défilante (barre discrète) ; le wrapper porte le fondu bas tant qu'il
            reste des entrées sous le pli. Écran bas (short:) : espacements resserrés, entrées à 44 px. */}
        <div className={`relative flex-1 min-h-0 flex flex-col ${navScrollable ? 'scroll-fade-y' : ''}`}>
        <nav
          ref={navRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-4 short:py-2 px-2 space-y-0.5"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.08) transparent',
          }}
        >
          {/* Recherche globale (palette Ctrl/Cmd+K) */}
          <div className={`mb-3 ${collapsed ? 'flex justify-center' : ''}`}>
            <Tooltip collapsed={collapsed} label={`Rechercher (${searchShortcut})`}>
              <button type="button"
                onClick={() => { setMobileOpen(false); openSearchPalette(); }}
                aria-label={`Rechercher un ticket, un client, un devis ou une commande (${searchShortcut})`}
                aria-keyshortcuts="Control+K Meta+K /"
                className={`flex items-center rounded-lg bg-white/[0.07] border border-white/10 text-slate-200
                  hover:text-white hover:bg-white/[0.12] hover:border-white/20 transition-colors duration-150
                  ${FOCUS_DARK}
                  ${collapsed ? 'w-11 h-11 justify-center' : 'w-full min-h-11 gap-2.5 px-3'}`}
              >
                <Search className="w-5 h-5 shrink-0 text-slate-400" aria-hidden="true" />
                {!collapsed && <span className="flex-1 text-left text-[13px] font-medium">Rechercher…</span>}
                {!collapsed && (
                  <kbd className="font-sans text-xs font-semibold text-slate-300 bg-white/10 rounded px-1.5 py-0.5" aria-hidden="true">
                    {searchShortcut}
                  </kbd>
                )}
              </button>
            </Tooltip>
          </div>

          {!collapsed && (
            <p className="px-3 mb-1 min-h-8 short:min-h-6 flex items-center t-overline text-slate-400">
              Menu principal
            </p>
          )}

          {/* Notification center — toujours en haut, hyper-visible */}
          <div className={`mb-1 ${collapsed ? 'flex justify-center' : 'px-0'}`}>
            <NotificationCenter collapsed={collapsed} />
          </div>

          {navItems.map(({ path, label, icon: Icon, badge, alertBadge }) => {
            const active = isActive(path);
            return (
              <Tooltip collapsed={collapsed} key={path} label={label} badge={badge}>
                <button onClick={() => handleNav(path)}
                  className={navBtnClass(active)}
                  aria-label={collapsed ? label : undefined}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className={iconCls(active)} aria-hidden="true" />
                  {!collapsed && <span className="flex-1 text-left truncate">{label}</span>}
                  {!collapsed && <Badge value={badge} tone="neutral" />}
                  {!collapsed && (badge > 0 ? <AlertDot value={alertBadge} /> : <Badge value={alertBadge} tone="red" />)}
                  {collapsed && <DotBadge value={badge || alertBadge} tone={alertBadge && !badge ? 'red' : 'brand'} />}
                </button>
              </Tooltip>
            );
          })}

          {/* ─── Devis section (conditional) ─── */}
          {(moduleDevis || moduleDevisFlash) && (
            <div className="pt-3 mt-3 short:pt-1.5 short:mt-1.5 border-t border-white/[0.06]">
              <SectionHeader
                collapsed={collapsed}
                label="Devis"
                icon={FileText}
                open={devisOpen}
                onToggle={() => {
                  const next = !devisOpen;
                  setDevisOpen(next);
                  localStorage.setItem('kp_devis_open', next ? '1' : '0');
                }}
              />
              {(devisOpen || collapsed) && (
                <div className="space-y-0.5">
                  {moduleDevis && (() => {
                    const p = `${basePath}/devis`; const a = isActive(p);
                    return (
                      <Tooltip collapsed={collapsed} label="Devis">
                        <button onClick={() => handleNav(p)} className={navBtnClass(a)}
                          aria-label={collapsed ? 'Devis' : undefined} aria-current={a ? 'page' : undefined}>
                          <FileText className={iconCls(a)} aria-hidden="true" />
                          {!collapsed && <span className="flex-1 text-left truncate">Devis</span>}
                        </button>
                      </Tooltip>
                    );
                  })()}
                  {moduleDevisFlash && (() => {
                    const p = `${basePath}/devis-flash`; const a = isActive(p);
                    return (
                      <Tooltip collapsed={collapsed} label="Devis Flash">
                        <button onClick={() => handleNav(p)} className={navBtnClass(a)}
                          aria-label={collapsed ? 'Devis Flash' : undefined} aria-current={a ? 'page' : undefined}>
                          <Zap className={iconCls(a)} aria-hidden="true" />
                          {!collapsed && <span className="flex-1 text-left truncate">Devis Flash</span>}
                        </button>
                      </Tooltip>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* ─── Tarifs section ─── */}
          <div className="pt-3 mt-3 short:pt-1.5 short:mt-1.5 border-t border-white/[0.06]">
            <SectionHeader
                collapsed={collapsed}
              label="Tarifs"
              icon={Tag}
              open={tarifsOpen}
              onToggle={() => {
                const next = !tarifsOpen;
                setTarifsOpen(next);
                localStorage.setItem('kp_tarifs_open', next ? '1' : '0');
              }}
            />
            {(tarifsOpen || collapsed) && (
              <div className="space-y-0.5">
                {[
                  // Réparations : grille boutique iPhone, puis prix fournisseur (Mobilax / Utopya) des autres marques
                  { path: `${basePath}/tarifs-reparation`, label: 'Réparation iPhone', icon: Wrench },
                  { path: `${basePath}/tarifs`, label: 'Réparation smartphones', icon: Smartphone },
                  // Téléphones à la vente
                  { path: `${basePath}/tarifs-iphone`, label: 'Vente iPhones', icon: Tag },
                  { path: `${basePath}/tarifs-smartphones`, label: 'Vente smartphones', icon: ShoppingBag },
                ].map(({ path, label, icon: Icon }) => {
                  const active = isActive(path);
                  return (
                    <Tooltip collapsed={collapsed} key={path} label={label}>
                      <button onClick={() => handleNav(path)} className={navBtnClass(active)}
                        aria-label={collapsed ? label : undefined} aria-current={active ? 'page' : undefined}>
                        <Icon className={iconCls(active)} aria-hidden="true" />
                        {!collapsed && <span className="flex-1 text-left truncate">{label}</span>}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </div>

          {/* ─── Administration section ─── */}
          <div className="pt-3 mt-3 short:pt-1.5 short:mt-1.5 border-t border-white/[0.06]">
            <SectionHeader
                collapsed={collapsed}
              label="Administration"
              icon={Lock}
              open={adminOpen}
              onToggle={() => {
                const next = !adminOpen;
                setAdminOpen(next);
                localStorage.setItem('kp_admin_open', next ? '1' : '0');
              }}
            />
            {(adminOpen || collapsed) && (
              <div className="space-y-0.5">
                {adminItems.map(({ path, to, label, icon: Icon, badge, pill, aria }) => {
                  const active = isActive(path);
                  return (
                    <Tooltip collapsed={collapsed} key={path} label={label} badge={badge}>
                      <button type="button" onClick={() => handleAdminNav(to || path)} className={navBtnClass(active)}
                        aria-label={aria || (collapsed ? label : undefined)} aria-current={active ? 'page' : undefined}>
                        <Icon className={iconCls(active)} aria-hidden="true" />
                        {!collapsed && <span className="flex-1 text-left truncate">{label}</span>}
                        {!collapsed && pill && (
                          <span className="bg-white/10 text-slate-300 text-xs font-bold rounded px-1.5 py-0.5 tracking-wide leading-none">
                            {pill}
                          </span>
                        )}
                        {!collapsed && <Badge value={badge} tone="red" />}
                        {collapsed && <DotBadge value={badge} tone="red" />}
                      </button>
                    </Tooltip>
                  );
                })}

                {/* ── Beta sub-group ── */}
                {!collapsed ? (
                  <button
                    type="button"
                    aria-expanded={!!betaOpen}
                    onClick={() => {
                      const next = !betaOpen;
                      setBetaOpen(next);
                      localStorage.setItem('kp_beta_open', next ? '1' : '0');
                    }}
                    className={`w-full min-h-11 flex items-center gap-3 px-3 py-2 mt-1 rounded-lg
                      text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]
                      transition-colors duration-150 ease-out group/beta ${FOCUS_DARK}`}
                  >
                    <FlaskConical className="w-5 h-5 shrink-0" aria-hidden="true" />
                    <span className="text-[13px] font-medium flex-1 text-left">Beta</span>
                    <span className="bg-white/10 text-slate-300 text-xs font-bold rounded px-1.5 py-0.5 tracking-wide leading-none">
                      DEV
                    </span>
                    <ChevronDown className={`w-4 h-4 transition-transform duration-150 ease-out ${betaOpen ? 'rotate-0' : '-rotate-90'}`} aria-hidden="true" />
                  </button>
                ) : (
                  <div className="relative my-2 flex justify-center" aria-hidden="true">
                    <span className="block w-6 h-px bg-white/10" />
                    <FlaskConical className="w-4 h-4 absolute -top-2 bg-slate-900 px-0.5 text-slate-400" />
                  </div>
                )}
                {(betaOpen || collapsed) && betaItems.map(({ path, label, icon: Icon }) => {
                  const active = isActive(path);
                  return (
                    <Tooltip collapsed={collapsed} key={path} label={label}>
                      <button onClick={() => handleAdminNav(path)}
                        className={`${navBtnClass(active)} ${collapsed ? '' : 'pl-6'}`}
                        aria-label={collapsed ? label : undefined} aria-current={active ? 'page' : undefined}
                      >
                        <Icon className={iconCls(active)} aria-hidden="true" />
                        {!collapsed && <span className="flex-1 text-left truncate">{label}</span>}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </div>
        </nav>
        </div>

        {/* Collapse toggle (44 px ; nom accessible en mode replié, où le libellé disparaît) */}
        <div className="hidden lg:block px-2 py-2 short:py-1 border-t border-white/[0.06]">
          <button onClick={toggleCollapse}
            type="button"
            className={`group/col w-full min-h-11 flex items-center gap-3 px-3 py-2 rounded-lg
              text-slate-400 hover:text-white hover:bg-white/[0.06]
              transition-colors duration-150 ease-out text-xs font-medium ${FOCUS_DARK}
              ${collapsed ? 'justify-center' : ''}`}
            title={collapsed ? 'Ouvrir la barre' : 'Réduire la barre'}
            aria-label={collapsed ? 'Ouvrir la barre' : undefined}
            aria-expanded={!collapsed}
          >
            <PanelLeftClose
              className={`w-5 h-5 shrink-0 transition-transform duration-200 ease-out
                ${collapsed ? 'rotate-180' : 'rotate-0'}`}
              aria-hidden="true"
            />
            {!collapsed && <span>Réduire</span>}
          </button>
        </div>

        {/* Admin mode badge */}
        {isAdminMode && !collapsed && (
          <div className="flex items-center gap-2 mx-2 mb-1 pl-3 pr-1 py-1 rounded-lg
            bg-red-500/10 border border-red-500/20">
            <Unlock className="w-4 h-4 text-red-300 shrink-0" aria-hidden="true" />
            <span className="text-red-200 text-xs font-semibold flex-1">Mode Admin</span>
            <button onClick={lockAdmin} type="button"
              className={`min-h-11 px-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 text-xs font-medium underline underline-offset-2 transition-colors ${FOCUS_DARK}`}>
              Verrouiller
            </button>
          </div>
        )}
        {isAdminMode && collapsed && (
          <div className="flex justify-center px-2 pb-1">
            <Tooltip collapsed={collapsed} label="Verrouiller admin">
              <button onClick={lockAdmin} type="button" aria-label="Verrouiller le mode admin"
                className={`w-10 h-10 flex items-center justify-center rounded-lg text-red-300 hover:bg-red-500/10 transition-colors ${FOCUS_DARK}`}>
                <Unlock className="w-5 h-5" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        )}

        {/* User section — avatar + name truncated, polished actions.
            Écran bas (short:) : une seule ligne, avatar + nom + deux boutons icône 44 px (libellés en sr-only). */}
        <div className="px-2 py-3 short:py-2 border-t border-white/[0.06] shrink-0 bg-slate-900">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1">
              <Tooltip collapsed={collapsed} label={user.utilisateur || 'Utilisateur'}>
                <div className="relative w-9 h-9 rounded-full
                  bg-gradient-to-br from-brand-500 to-brand-700
                  flex items-center justify-center shadow-xs">
                  <span className="text-white font-bold text-sm">
                    {user.utilisateur?.charAt(0)?.toUpperCase()}
                  </span>
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 rounded-full ring-2 ring-slate-900" aria-hidden="true" />
                </div>
              </Tooltip>
              <Tooltip collapsed={collapsed} label="Changer d'utilisateur">
                <button onClick={handleSwitchUser} type="button" aria-label="Changer d'utilisateur"
                  className={`group/sw w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors duration-150 ${FOCUS_DARK}`}>
                  <RefreshCw className="w-5 h-5 transition-transform duration-300 motion-safe:group-hover/sw:rotate-180" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip collapsed={collapsed} label="Déconnexion">
                <button onClick={() => { logout(); navigate('/'); }} type="button" aria-label="Déconnexion"
                  className={`w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-500/10 transition-colors duration-150 ${FOCUS_DARK}`}>
                  <LogOut className="w-5 h-5" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          ) : (
            <div className="space-y-2 short:space-y-0 short:flex short:items-center short:gap-1">
              <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-white/[0.03] short:flex-1 short:min-w-0 short:gap-2 short:px-1.5 short:py-1">
                <div className="relative w-9 h-9 rounded-full shrink-0
                  bg-gradient-to-br from-brand-500 to-brand-700
                  flex items-center justify-center shadow-xs">
                  <span className="text-white font-bold text-sm">
                    {user.utilisateur?.charAt(0)?.toUpperCase()}
                  </span>
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 rounded-full ring-2 ring-slate-900" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-white truncate leading-tight">
                    {user.utilisateur}
                  </p>
                  <p className="text-xs text-slate-400 capitalize truncate leading-tight mt-0.5">
                    {user.target}{user.role ? ` · ${user.role}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex gap-1 short:shrink-0">
                <button onClick={handleSwitchUser} type="button"
                  className={`group/sw flex-1 min-h-11 flex items-center justify-center gap-1.5 px-2 rounded-lg
                    short:flex-none short:w-11 short:px-0
                    text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.06]
                    transition-colors duration-150 ${FOCUS_DARK}`}>
                  <RefreshCw className="w-4 h-4 shrink-0 transition-transform duration-300 motion-safe:group-hover/sw:rotate-180" aria-hidden="true" />
                  <span className="short:sr-only">Changer</span>
                </button>
                <button onClick={() => { logout(); navigate('/'); }} type="button"
                  className={`flex-1 min-h-11 flex items-center justify-center gap-1.5 px-2 rounded-lg
                    short:flex-none short:w-11 short:px-0
                    text-xs font-medium text-slate-400 hover:text-red-300 hover:bg-red-500/10
                    transition-colors duration-150 ${FOCUS_DARK}`}>
                  <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="short:sr-only">Déconnexion</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer branding (masqué sur écran bas : la place va aux entrées de menu) */}
        {!collapsed && (
          <div className="short:hidden text-center py-3 px-2 text-xs text-slate-400 border-t border-white/[0.03]">
            Propulsé par{' '}
            <span className="font-extrabold">
              <span className="text-brand-400">Tk</span>
              <span className="text-slate-100">S</span>
              <span className="text-pink-400">∞</span>
              <span className="text-slate-100">26</span>
            </span>
            {' '}— une solution{' '}
            <span className="font-bold text-brand-300">Klik&Dev</span>
          </div>
        )}
      </aside>

      {/* Admin login modal */}
      <AdminLoginModal
        open={showAdminModal}
        onClose={() => { setShowAdminModal(false); setPendingAdminPath(null); }}
        onSuccess={handleAdminSuccess}
      />
    </>
  );
}
