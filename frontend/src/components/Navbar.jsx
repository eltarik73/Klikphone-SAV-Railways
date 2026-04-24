import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../lib/api';
import AdminLoginModal from './AdminLoginModal';
import {
  LogOut, LayoutDashboard, Users, Package, FileText,
  Menu, X, Search, PanelLeftClose,
  RefreshCw, Tag, Star, Megaphone, ChevronDown, Wrench, Smartphone,
  Lock, Unlock, BarChart3, Settings, Zap, ShoppingBag, FlaskConical, Tv,
} from 'lucide-react';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('kp_sidebar_collapsed') === '1');
  const [pendingCount, setPendingCount] = useState(0);
  const [tarifsOpen, setTarifsOpen] = useState(() => localStorage.getItem('kp_tarifs_open') !== '0');
  const [adminOpen, setAdminOpen] = useState(() => localStorage.getItem('kp_admin_open') !== '0');
  const [betaOpen, setBetaOpen] = useState(() => localStorage.getItem('kp_beta_open') === '1');
  const [avisNonRepondus, setAvisNonRepondus] = useState(0);
  const [interactionCount, setInteractionCount] = useState(0);
  const [moduleDevis, setModuleDevis] = useState(false);
  const [moduleDevisFlash, setModuleDevisFlash] = useState(false);
  const [devisOpen, setDevisOpen] = useState(() => localStorage.getItem('kp_devis_open') !== '0');

  // Admin mode state
  const [isAdminMode, setIsAdminMode] = useState(() => localStorage.getItem('klikphone_admin') === 'true');
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [pendingAdminPath, setPendingAdminPath] = useState(null);

  useEffect(() => {
    if (!user) return;
    const fetchKpi = () => {
      api.getKPI()
        .then(kpi => setPendingCount(kpi?.total_actifs || 0))
        .catch(() => {});
      api.getAvisGoogleStats()
        .then(s => setAvisNonRepondus(s?.non_repondus || 0))
        .catch(() => {});
      api.getInteractions()
        .then(d => setInteractionCount(d?.total_actions ?? 0))
        .catch(() => {});
    };
    fetchKpi();
    let interval;
    const start = () => { clearInterval(interval); interval = setInterval(fetchKpi, 30000); };
    const stop = () => clearInterval(interval);
    const onVisibility = () => document.hidden ? stop() : start();
    document.addEventListener('visibilitychange', onVisibility);
    start();
    // Load module visibility
    api.getConfig().then(cfg => {
      const map = {};
      (Array.isArray(cfg) ? cfg : []).forEach(p => { map[p.cle] = p.valeur; });
      setModuleDevis(map.MODULE_DEVIS_VISIBLE === 'true');
      setModuleDevisFlash(map.MODULE_DEVIS_FLASH_VISIBLE === 'true');
    }).catch(() => {});
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [user]);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('kp_sidebar_collapsed', next ? '1' : '0');
    window.dispatchEvent(new CustomEvent('sidebar-toggle', { detail: { collapsed: next } }));
  };

  if (!user) return null;

  const basePath = user.target === 'tech' ? '/tech' : '/accueil';

  const navItems = [
    { path: basePath, label: 'Dashboard', icon: LayoutDashboard, badge: pendingCount, alertBadge: interactionCount },
    { path: `${basePath}/clients`, label: 'Clients', icon: Users },
    { path: `${basePath}/commandes`, label: 'Commandes', icon: Package, badge: pendingCount },
    { path: `${basePath}/demandes-commandes`, label: 'Demandes de commande', icon: ShoppingBag },
    { path: `${basePath}/attestation`, label: 'Attestation', icon: FileText },
    { path: '/suivi', label: 'Suivi client', icon: Search },
  ];

  const adminItems = [
    { path: `${basePath}/admin`, label: 'Reporting', icon: BarChart3 },
    { path: `${basePath}/avis-google`, label: 'Avis Google', icon: Star, badge: avisNonRepondus },
    { path: `${basePath}/community`, label: 'Community Manager', icon: Megaphone },
    { path: `${basePath}/config`, label: 'Configuration', icon: Settings },
    { path: '/site-tarifs-iphone', label: 'Site Tarifs iPhone', icon: Tv, pill: 'BETA' },
  ];

  const betaItems = [
    { path: `${basePath}/tarifs`, label: 'Réparations (Mobilax)', icon: Wrench },
    { path: `${basePath}/tarifs-telephones`, label: 'Téléphones', icon: Smartphone },
    { path: `${basePath}/telephones-vente`, label: 'Mes téléphones', icon: ShoppingBag },
  ];

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

  const adminPages = ['/admin', '/avis-google', '/community', '/config'];
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
    setIsAdminMode(true);
    setShowAdminModal(false);
    if (pendingAdminPath) {
      navigate(pendingAdminPath);
      setMobileOpen(false);
      setPendingAdminPath(null);
    }
  };

  const lockAdmin = () => {
    localStorage.removeItem('klikphone_admin');
    setIsAdminMode(false);
    if (isOnAdminPage) {
      navigate(basePath, { replace: true });
    }
  };

  const handleSwitchUser = () => {
    navigate(`/login/${user.target}?switch=1`);
  };

  // ─── Reusable tooltip wrapper for collapsed mode ───
  const Tooltip = ({ label, children, badge }) => (
    <div className="group/tip relative">
      {children}
      {collapsed && (
        <span
          className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 z-[60]
            whitespace-nowrap rounded-md bg-slate-800 border border-white/10 px-2.5 py-1.5
            text-[12px] font-medium text-slate-100 shadow-xl
            opacity-0 translate-x-[-4px] group-hover/tip:opacity-100 group-hover/tip:translate-x-0
            transition-all duration-150 ease-out"
        >
          {label}
          {badge > 0 && (
            <span className="ml-2 bg-brand-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </span>
      )}
    </div>
  );

  // ─── Item button (unified styling + hover scale + tooltip) ───
  const navBtnClass = (active, variant = 'brand') => {
    const base = `group/nav w-full flex items-center gap-3 rounded-lg text-[13px] font-medium
      transition-all duration-150 ease-out relative
      ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}`;
    const activeCls = {
      brand: `bg-gradient-to-r from-brand-600/25 to-brand-500/10 text-white
              shadow-[inset_0_0_0_1px_rgba(124,58,237,0.35)]
              ${collapsed ? '' : 'border-l-[3px] border-brand-400 pl-[9px]'}`,
      amber: `bg-gradient-to-r from-amber-500/25 to-amber-400/10 text-white
              shadow-[inset_0_0_0_1px_rgba(245,158,11,0.35)]
              ${collapsed ? '' : 'border-l-[3px] border-amber-400 pl-[9px]'}`,
      red:   `bg-gradient-to-r from-red-500/25 to-red-400/10 text-white
              shadow-[inset_0_0_0_1px_rgba(239,68,68,0.35)]
              ${collapsed ? '' : 'border-l-[3px] border-red-400 pl-[9px]'}`,
      yellow:`bg-gradient-to-r from-yellow-500/25 to-yellow-400/10 text-white
              shadow-[inset_0_0_0_1px_rgba(234,179,8,0.35)]
              ${collapsed ? '' : 'border-l-[3px] border-yellow-400 pl-[9px]'}`,
    }[variant];
    const idle = 'text-slate-400 hover:text-white hover:bg-white/[0.05]';
    return `${base} ${active ? activeCls : idle}`;
  };

  const iconCls = (active, variant = 'brand') => {
    const color = { brand: 'text-brand-300', amber: 'text-amber-300', red: 'text-red-300', yellow: 'text-yellow-300' }[variant];
    return `w-[18px] h-[18px] shrink-0 transition-transform duration-150 ease-out
      group-hover/nav:scale-110 ${active ? color : ''}`;
  };

  const Badge = ({ value, tone = 'brand' }) => {
    if (!value || value <= 0) return null;
    const toneCls = {
      brand: 'bg-brand-500 shadow-[0_0_0_2px_rgba(124,58,237,0.25)]',
      red:   'bg-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.25)]',
    }[tone];
    const label = value > 99 ? '99+' : value;
    return (
      <span className={`${toneCls} text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full
        min-w-[20px] text-center leading-tight`}>
        {label}
      </span>
    );
  };

  const DotBadge = ({ value, tone = 'brand' }) => {
    if (!value || value <= 0) return null;
    const bg = tone === 'red' ? 'bg-red-500' : 'bg-brand-500';
    return (
      <span className={`${bg} absolute top-0.5 right-0.5 text-white text-[9px] font-bold
        min-w-[16px] h-[16px] px-1 rounded-full flex items-center justify-center
        ring-2 ring-slate-900 animate-in`}>
        {value > 9 ? '9+' : value}
      </span>
    );
  };

  // ─── Section header (label uppercase discret + chevron) ───
  const SectionHeader = ({ label, color, icon: Icon, open, onToggle }) => {
    if (collapsed) {
      return (
        <div className="relative my-2 flex justify-center">
          <span className="block w-8 h-px" style={{ background: `${color}40` }} />
          <Icon className="w-[14px] h-[14px] absolute -top-[7px] bg-slate-900 px-0.5" style={{ color }} />
        </div>
      );
    }
    return (
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 mb-2 group/sec"
      >
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{ color }}>
          <Icon className="w-3 h-3" />
          {label}
        </span>
        <ChevronDown
          className={`w-3 h-3 transition-transform duration-200 ease-out ${open ? 'rotate-0' : '-rotate-90'}`}
          style={{ color }}
        />
      </button>
    );
  };

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-slate-900 border-b border-white/10 flex items-center px-4 z-40">
        <button onClick={() => setMobileOpen(true)} className="p-2 -ml-2 text-slate-400 hover:text-white transition-colors">
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2.5 ml-2">
          <img src="/logo_k.png" alt="Klikphone" className="w-7 h-7 rounded-lg object-contain" />
          <span className="text-white font-display font-bold tracking-tight">KLIKPHONE</span>
        </div>
        {pendingCount > 0 && (
          <span className="ml-auto bg-brand-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
            {pendingCount}
          </span>
        )}
      </div>

      {/* Backdrop */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-in" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 bottom-0 bg-slate-900 flex flex-col z-50
        border-r border-white/[0.06]
        transition-[width,transform] duration-300 ease-in-out will-change-[width,transform]
        ${collapsed ? 'w-[72px]' : 'w-64'}
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
      `}>
        {/* Logo header with smooth collapse animation */}
        <div className={`h-16 flex items-center border-b border-white/[0.06] shrink-0 overflow-hidden
          ${collapsed ? 'px-3 justify-center' : 'px-4 gap-3'}`}>
          <div className="w-10 h-10 rounded-xl bg-white p-1 overflow-hidden shrink-0
            shadow-[0_2px_10px_rgba(124,58,237,0.25)]
            transition-transform duration-300 ease-out hover:scale-105">
            <img src="/logo_k.png" alt="Klikphone" className="w-full h-full object-contain" />
          </div>
          <div className={`flex-1 min-w-0 transition-all duration-300 ease-out
            ${collapsed ? 'opacity-0 -translate-x-2 w-0 pointer-events-none' : 'opacity-100 translate-x-0'}`}>
            <h1 className="text-white font-display font-bold text-[15px] tracking-tight leading-none whitespace-nowrap">KLIKPHONE</h1>
            <p className="text-slate-500 text-[10px] uppercase tracking-[0.15em] mt-1 whitespace-nowrap">Service après-vente</p>
          </div>
          <button onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation — scrollable zone with visible but discrete scrollbar */}
        <nav
          className={`flex-1 overflow-y-auto overflow-x-hidden py-4 space-y-0.5
            ${collapsed ? 'px-2' : 'px-2'}`}
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.08) transparent',
          }}
        >
          {!collapsed && (
            <p className="px-3 mb-2 text-[10px] font-semibold text-slate-500 uppercase tracking-[0.14em]">
              Menu principal
            </p>
          )}
          {navItems.map(({ path, label, icon: Icon, badge, alertBadge }) => {
            const active = isActive(path);
            return (
              <Tooltip key={path} label={label} badge={badge}>
                <button onClick={() => handleNav(path)}
                  className={navBtnClass(active, 'brand')}
                >
                  <Icon className={iconCls(active, 'brand')} />
                  {!collapsed && <span className="flex-1 text-left truncate">{label}</span>}
                  {!collapsed && <Badge value={badge} tone="brand" />}
                  {!collapsed && <Badge value={alertBadge} tone="red" />}
                  {collapsed && <DotBadge value={badge || alertBadge} tone={alertBadge && !badge ? 'red' : 'brand'} />}
                </button>
              </Tooltip>
            );
          })}

          {/* ─── Devis section (conditional) ─── */}
          {(moduleDevis || moduleDevisFlash) && (
            <div className={`pt-4 mt-4 border-t border-white/[0.06] ${collapsed ? 'px-0' : ''}`}>
              <SectionHeader
                label="Devis"
                color="#7C3AED"
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
                      <Tooltip label="Devis">
                        <button onClick={() => handleNav(p)} className={navBtnClass(a, 'brand')}>
                          <FileText className={iconCls(a, 'brand')} />
                          {!collapsed && <span className="flex-1 text-left truncate">Devis</span>}
                        </button>
                      </Tooltip>
                    );
                  })()}
                  {moduleDevisFlash && (() => {
                    const p = `${basePath}/devis-flash`; const a = isActive(p);
                    return (
                      <Tooltip label="Devis Flash">
                        <button onClick={() => handleNav(p)} className={navBtnClass(a, 'amber')}>
                          <Zap className={iconCls(a, 'amber')} />
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
          <div className={`pt-4 mt-4 border-t border-white/[0.06] ${collapsed ? 'px-0' : ''}`}>
            <SectionHeader
              label="Tarifs"
              color="#F59E0B"
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
                  { path: `${basePath}/tarifs-reparation`, label: 'Réparation iPhone', icon: Wrench },
                  { path: `${basePath}/tarifs-iphone`, label: 'Tarifs iPhones', icon: Tag },
                  { path: `${basePath}/tarifs-smartphones`, label: 'Tarifs Smartphones', icon: Smartphone },
                ].map(({ path, label, icon: Icon }) => {
                  const active = isActive(path);
                  return (
                    <Tooltip key={path} label={label}>
                      <button onClick={() => handleNav(path)} className={navBtnClass(active, 'amber')}>
                        <Icon className={iconCls(active, 'amber')} />
                        {!collapsed && <span className="flex-1 text-left truncate">{label}</span>}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </div>

          {/* ─── Administration section ─── */}
          <div className={`pt-4 mt-4 border-t border-white/[0.06] ${collapsed ? 'px-0' : ''}`}>
            <SectionHeader
              label="Administration"
              color="#EF4444"
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
                {adminItems.map(({ path, label, icon: Icon, badge, pill }) => {
                  const active = isActive(path);
                  return (
                    <Tooltip key={path} label={label} badge={badge}>
                      <button onClick={() => handleAdminNav(path)} className={navBtnClass(active, 'red')}>
                        <Icon className={iconCls(active, 'red')} />
                        {!collapsed && <span className="flex-1 text-left truncate">{label}</span>}
                        {!collapsed && pill && (
                          <span className="bg-amber-400 text-slate-950 text-[9px] font-extrabold rounded px-1.5 py-0.5 tracking-wider">
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
                    onClick={() => {
                      const next = !betaOpen;
                      setBetaOpen(next);
                      localStorage.setItem('kp_beta_open', next ? '1' : '0');
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 mt-1 rounded-lg
                      text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]
                      transition-colors duration-150 ease-out group/beta"
                  >
                    <FlaskConical className="w-[16px] h-[16px] shrink-0 transition-transform duration-150 group-hover/beta:scale-110" style={{ color: '#EAB308' }} />
                    <span className="text-[13px] font-medium flex-1 text-left">Beta</span>
                    <span className="bg-yellow-500/12 text-yellow-500 text-[9px] font-bold rounded px-1.5 py-0.5 tracking-wider">
                      DEV
                    </span>
                    <ChevronDown className={`w-3 h-3 transition-transform duration-200 ease-out ${betaOpen ? 'rotate-0' : '-rotate-90'}`} />
                  </button>
                ) : (
                  <div className="relative my-2 flex justify-center">
                    <span className="block w-6 h-px bg-yellow-500/25" />
                    <FlaskConical className="w-[12px] h-[12px] absolute -top-[6px] bg-slate-900 px-0.5" style={{ color: '#EAB308' }} />
                  </div>
                )}
                {(betaOpen || collapsed) && betaItems.map(({ path, label, icon: Icon }) => {
                  const active = isActive(path);
                  return (
                    <Tooltip key={path} label={label}>
                      <button onClick={() => handleAdminNav(path)}
                        className={`${navBtnClass(active, 'yellow')} ${collapsed ? '' : 'pl-6'} opacity-75 hover:opacity-100`}
                      >
                        <Icon className={iconCls(active, 'yellow')} />
                        {!collapsed && <span className="flex-1 text-left truncate text-[12px]">{label}</span>}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </div>
        </nav>

        {/* Collapse toggle — more visible with rotation animation */}
        <div className="hidden lg:block px-2 py-2 border-t border-white/[0.06]">
          <button onClick={toggleCollapse}
            className={`group/col w-full flex items-center gap-2 px-3 py-2 rounded-lg
              text-slate-400 hover:text-white hover:bg-brand-500/10
              ring-1 ring-transparent hover:ring-brand-500/30
              transition-all duration-200 ease-out text-xs
              ${collapsed ? 'justify-center' : ''}`}
            title={collapsed ? 'Ouvrir la barre' : 'Réduire la barre'}
          >
            <PanelLeftClose
              className={`w-4 h-4 transition-transform duration-300 ease-out
                group-hover/col:text-brand-300
                ${collapsed ? 'rotate-180' : 'rotate-0'}`}
            />
            {!collapsed && <span className="font-medium">Réduire</span>}
          </button>
        </div>

        {/* Admin mode badge */}
        {isAdminMode && !collapsed && (
          <div className="flex items-center gap-2 mx-2 mb-1 px-2.5 py-1.5 rounded-lg
            bg-red-500/10 border border-red-500/20">
            <Unlock className="w-3 h-3 text-red-400 shrink-0" />
            <span className="text-red-300 text-[11px] font-semibold flex-1">Mode Admin</span>
            <button onClick={lockAdmin}
              className="text-slate-500 hover:text-red-300 text-[10px] underline underline-offset-2 transition-colors">
              Verrouiller
            </button>
          </div>
        )}
        {isAdminMode && collapsed && (
          <div className="flex justify-center px-2 pb-1">
            <Tooltip label="Verrouiller admin">
              <button onClick={lockAdmin}
                className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors">
                <Unlock className="w-3.5 h-3.5 text-red-400" />
              </button>
            </Tooltip>
          </div>
        )}

        {/* User section — avatar + name truncated, polished actions */}
        <div className="px-2 py-3 border-t border-white/[0.06] shrink-0 bg-slate-900">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1.5">
              <Tooltip label={user.utilisateur || 'Utilisateur'}>
                <div className="relative w-9 h-9 rounded-full
                  bg-gradient-to-br from-brand-500 to-brand-700
                  flex items-center justify-center
                  ring-2 ring-brand-500/20
                  shadow-[0_2px_10px_rgba(124,58,237,0.3)]">
                  <span className="text-white font-bold text-sm">
                    {user.utilisateur?.charAt(0)?.toUpperCase()}
                  </span>
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 rounded-full ring-2 ring-slate-900" />
                </div>
              </Tooltip>
              <Tooltip label="Changer d'utilisateur">
                <button onClick={handleSwitchUser}
                  className="p-2 rounded-lg text-slate-500 hover:text-brand-300 hover:bg-white/5 transition-all duration-150">
                  <RefreshCw className="w-4 h-4 transition-transform hover:rotate-180 duration-500" />
                </button>
              </Tooltip>
              <Tooltip label="Déconnexion">
                <button onClick={() => { logout(); navigate('/'); }}
                  className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all duration-150">
                  <LogOut className="w-4 h-4" />
                </button>
              </Tooltip>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-3 px-2 py-2 rounded-lg
                bg-white/[0.02] hover:bg-white/[0.04] transition-colors duration-150">
                <div className="relative w-9 h-9 rounded-full shrink-0
                  bg-gradient-to-br from-brand-500 to-brand-700
                  flex items-center justify-center
                  ring-2 ring-brand-500/20
                  shadow-[0_2px_10px_rgba(124,58,237,0.3)]">
                  <span className="text-white font-bold text-sm">
                    {user.utilisateur?.charAt(0)?.toUpperCase()}
                  </span>
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 rounded-full ring-2 ring-slate-900" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-white truncate leading-tight">
                    {user.utilisateur}
                  </p>
                  <p className="text-[11px] text-slate-400 capitalize truncate leading-tight mt-0.5">
                    {user.target}{user.role ? ` · ${user.role}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={handleSwitchUser}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg
                    text-[11px] font-medium text-slate-400 hover:text-brand-300 hover:bg-brand-500/10
                    transition-all duration-150">
                  <RefreshCw className="w-3 h-3" /> Changer
                </button>
                <button onClick={() => { logout(); navigate('/'); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg
                    text-[11px] font-medium text-slate-400 hover:text-rose-400 hover:bg-rose-500/10
                    transition-all duration-150">
                  <LogOut className="w-3 h-3" /> Déconnexion
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer branding */}
        {!collapsed && (
          <div className="text-center py-3 text-[10px] text-slate-500 border-t border-white/[0.03]">
            Propulsé par{' '}
            <span className="font-extrabold text-[11px]">
              <span className="text-brand-500">Tk</span>
              <span className="text-slate-100">S</span>
              <span className="text-pink-500">∞</span>
              <span className="text-slate-100">26</span>
            </span>
            {' '}— une solution{' '}
            <span className="font-bold text-brand-400">Klik&Dev</span>
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
