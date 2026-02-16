import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../lib/api';
import AdminLoginModal from './AdminLoginModal';
import {
  LogOut, LayoutDashboard, Users, Package, FileText,
  Menu, X, Search, PanelLeftClose, PanelLeftOpen,
  RefreshCw, Tag, Star, Megaphone, ChevronDown, Wrench, Smartphone,
  Lock, Unlock, BarChart3, Settings, Zap,
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
  const [avisNonRepondus, setAvisNonRepondus] = useState(0);
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
    };
    fetchKpi();
    const interval = setInterval(fetchKpi, 30000);
    // Load module visibility
    api.getConfig().then(cfg => {
      const map = {};
      (Array.isArray(cfg) ? cfg : []).forEach(p => { map[p.cle] = p.valeur; });
      setModuleDevis(map.MODULE_DEVIS_VISIBLE === 'true');
      setModuleDevisFlash(map.MODULE_DEVIS_FLASH_VISIBLE === 'true');
    }).catch(() => {});
    return () => clearInterval(interval);
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
    { path: basePath, label: 'Dashboard', icon: LayoutDashboard, badge: pendingCount },
    { path: `${basePath}/clients`, label: 'Clients', icon: Users },
    { path: `${basePath}/commandes`, label: 'Commandes', icon: Package },
    { path: `${basePath}/attestation`, label: 'Attestation', icon: FileText },
    { path: '/suivi', label: 'Suivi client', icon: Search },
  ];

  const adminItems = [
    { path: `${basePath}/admin`, label: 'Reporting', icon: BarChart3 },
    { path: `${basePath}/avis-google`, label: 'Avis Google', icon: Star, badge: avisNonRepondus },
    { path: `${basePath}/community`, label: 'Community Manager', icon: Megaphone },
    { path: `${basePath}/config`, label: 'Configuration', icon: Settings },
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
        <div className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 bottom-0 bg-slate-900 flex flex-col z-50
        transition-all duration-300 ease-in-out
        ${collapsed ? 'w-[68px]' : 'w-64'}
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
      `}>
        {/* Logo */}
        <div className="h-16 px-4 flex items-center gap-3 border-b border-white/[0.06] shrink-0">
          <div className="w-10 h-10 rounded-xl bg-white p-1 overflow-hidden shrink-0">
            <img src="/logo_k.png" alt="Klikphone" className="w-full h-full object-contain" />
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <h1 className="text-white font-display font-bold text-[15px] tracking-tight leading-none">KLIKPHONE</h1>
              <p className="text-slate-500 text-[10px] uppercase tracking-[0.15em] mt-0.5">Service après-vente</p>
            </div>
          )}
          <button onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto scrollbar-none">
          {!collapsed && <p className="px-3 mb-2 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Menu</p>}
          {navItems.map(({ path, label, icon: Icon, badge }) => (
            <button key={path} onClick={() => handleNav(path)}
              title={collapsed ? label : undefined}
              className={`w-full flex items-center gap-3 rounded-lg text-[13px] font-medium transition-all duration-200
                ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}
                ${isActive(path)
                  ? `bg-brand-600/20 text-brand-300 ${collapsed ? '' : 'border-l-2 border-brand-400 pl-[10px]'}`
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
            >
              <Icon className={`w-[18px] h-[18px] shrink-0 ${isActive(path) ? 'text-brand-400' : ''}`} />
              {!collapsed && <span className="flex-1 text-left">{label}</span>}
              {!collapsed && badge > 0 && (
                <span className="bg-brand-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {badge}
                </span>
              )}
              {collapsed && badge > 0 && (
                <span className="absolute -top-1 -right-1 bg-brand-500 text-white text-[8px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </button>
          ))}

          {/* ─── Devis section (conditional) ─── */}
          {(moduleDevis || moduleDevisFlash) && (
            <div className={`pt-4 mt-4 border-t border-white/[0.06] ${collapsed ? 'px-0' : ''}`}>
              {!collapsed ? (
                <button
                  onClick={() => {
                    const next = !devisOpen;
                    setDevisOpen(next);
                    localStorage.setItem('kp_devis_open', next ? '1' : '0');
                  }}
                  className="w-full flex items-center justify-between px-3 mb-2 group"
                >
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] flex items-center gap-1.5" style={{ color: '#7C3AED' }}>
                    <FileText className="w-3 h-3" />
                    Devis
                  </span>
                  <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${devisOpen ? 'rotate-180' : ''}`} style={{ color: '#7C3AED' }} />
                </button>
              ) : (
                <div className="flex justify-center mb-1">
                  <FileText className="w-4 h-4" style={{ color: '#7C3AED' }} />
                </div>
              )}
              {(devisOpen || collapsed) && (
                <>
                  {moduleDevis && (
                    <button onClick={() => handleNav(`${basePath}/devis`)}
                      title={collapsed ? 'Devis' : undefined}
                      className={`w-full flex items-center gap-3 rounded-lg text-[13px] font-medium transition-all duration-200
                        ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}
                        ${isActive(`${basePath}/devis`)
                          ? `bg-brand-600/20 text-brand-300 ${collapsed ? '' : 'border-l-2 border-brand-400 pl-[10px]'}`
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                        }`}
                    >
                      <FileText className={`w-[18px] h-[18px] shrink-0 ${isActive(`${basePath}/devis`) ? 'text-brand-400' : ''}`} />
                      {!collapsed && <span className="flex-1 text-left">Devis</span>}
                    </button>
                  )}
                  {moduleDevisFlash && (
                    <button onClick={() => handleNav(`${basePath}/devis-flash`)}
                      title={collapsed ? 'Devis Flash' : undefined}
                      className={`w-full flex items-center gap-3 rounded-lg text-[13px] font-medium transition-all duration-200
                        ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}
                        ${isActive(`${basePath}/devis-flash`)
                          ? `bg-amber-500/20 text-amber-300 ${collapsed ? '' : 'border-l-2 border-amber-400 pl-[10px]'}`
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                        }`}
                    >
                      <Zap className={`w-[18px] h-[18px] shrink-0 ${isActive(`${basePath}/devis-flash`) ? 'text-amber-400' : ''}`} />
                      {!collapsed && <span className="flex-1 text-left">Devis Flash</span>}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ─── Tarifs section ─── */}
          <div className={`pt-4 mt-4 border-t border-white/[0.06] ${collapsed ? 'px-0' : ''}`}>
            {!collapsed ? (
              <button
                onClick={() => {
                  const next = !tarifsOpen;
                  setTarifsOpen(next);
                  localStorage.setItem('kp_tarifs_open', next ? '1' : '0');
                }}
                className="w-full flex items-center justify-between px-3 mb-2 group"
              >
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] flex items-center gap-1.5" style={{ color: '#F59E0B' }}>
                  <Tag className="w-3 h-3" />
                  Tarifs
                </span>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${tarifsOpen ? 'rotate-180' : ''}`} style={{ color: '#F59E0B' }} />
              </button>
            ) : (
              <div className="flex justify-center mb-1">
                <Tag className="w-4 h-4" style={{ color: '#F59E0B' }} />
              </div>
            )}
            {(tarifsOpen || collapsed) && (
              <>
                <button onClick={() => handleNav(`${basePath}/tarifs`)}
                  title={collapsed ? 'Réparations' : undefined}
                  className={`w-full flex items-center gap-3 rounded-lg text-[13px] font-medium transition-all duration-200
                    ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}
                    ${isActive(`${basePath}/tarifs`)
                      ? `bg-amber-500/20 text-amber-300 ${collapsed ? '' : 'border-l-2 border-amber-400 pl-[10px]'}`
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                    }`}
                >
                  <Wrench className={`w-[18px] h-[18px] shrink-0 ${isActive(`${basePath}/tarifs`) ? 'text-amber-400' : ''}`} />
                  {!collapsed && <span className="flex-1 text-left">Réparations</span>}
                </button>
                <button onClick={() => handleNav(`${basePath}/tarifs-telephones`)}
                  title={collapsed ? 'Téléphones' : undefined}
                  className={`w-full flex items-center gap-3 rounded-lg text-[13px] font-medium transition-all duration-200
                    ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}
                    ${isActive(`${basePath}/tarifs-telephones`)
                      ? `bg-amber-500/20 text-amber-300 ${collapsed ? '' : 'border-l-2 border-amber-400 pl-[10px]'}`
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                    }`}
                >
                  <Smartphone className={`w-[18px] h-[18px] shrink-0 ${isActive(`${basePath}/tarifs-telephones`) ? 'text-amber-400' : ''}`} />
                  {!collapsed && <span className="flex-1 text-left">Téléphones</span>}
                </button>
              </>
            )}
          </div>

          {/* ─── Administration section ─── */}
          <div className={`pt-4 mt-4 border-t border-white/[0.06] ${collapsed ? 'px-0' : ''}`}>
            {!collapsed ? (
              <button
                onClick={() => {
                  const next = !adminOpen;
                  setAdminOpen(next);
                  localStorage.setItem('kp_admin_open', next ? '1' : '0');
                }}
                className="w-full flex items-center justify-between px-3 mb-2 group"
              >
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] flex items-center gap-1.5" style={{ color: '#EF4444' }}>
                  <Lock className="w-3 h-3" />
                  Administration
                </span>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${adminOpen ? 'rotate-180' : ''}`} style={{ color: '#EF4444' }} />
              </button>
            ) : (
              <div className="flex justify-center mb-1">
                <Lock className="w-4 h-4" style={{ color: '#EF4444' }} />
              </div>
            )}
            {(adminOpen || collapsed) && (
              <>
                {adminItems.map(({ path, label, icon: Icon, badge }) => (
                  <button key={path} onClick={() => handleAdminNav(path)}
                    title={collapsed ? label : undefined}
                    className={`w-full flex items-center gap-3 rounded-lg text-[13px] font-medium transition-all duration-200
                      ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}
                      ${isActive(path)
                        ? `bg-red-500/20 text-red-300 ${collapsed ? '' : 'border-l-2 border-red-400 pl-[10px]'}`
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                      }`}
                  >
                    <Icon className={`w-[18px] h-[18px] shrink-0 ${isActive(path) ? 'text-red-400' : ''}`} />
                    {!collapsed && <span className="flex-1 text-left">{label}</span>}
                    {!collapsed && badge > 0 && (
                      <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                        {badge}
                      </span>
                    )}
                    {collapsed && badge > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                        {badge > 9 ? '9+' : badge}
                      </span>
                    )}
                  </button>
                ))}
              </>
            )}
          </div>
        </nav>

        {/* Collapse toggle (desktop only) */}
        <div className="hidden lg:block px-2 py-2 border-t border-white/[0.06]">
          <button onClick={toggleCollapse}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-colors text-xs"
            title={collapsed ? 'Ouvrir la barre' : 'Réduire la barre'}
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            {!collapsed && <span>Réduire</span>}
          </button>
        </div>

        {/* Admin mode badge */}
        {isAdminMode && !collapsed && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            margin: '0 8px 4px', padding: '6px 10px',
            background: '#EF444415', borderRadius: 8,
          }}>
            <Unlock style={{ width: 12, height: 12, color: '#EF4444' }} />
            <span style={{ color: '#EF4444', fontSize: 11, fontWeight: 600, flex: 1 }}>Mode Admin</span>
            <button onClick={lockAdmin} style={{
              background: 'none', border: 'none', color: '#64748B',
              fontSize: 10, cursor: 'pointer', textDecoration: 'underline',
              padding: 0,
            }}>Verrouiller</button>
          </div>
        )}
        {isAdminMode && collapsed && (
          <div className="flex justify-center px-2 pb-1">
            <button onClick={lockAdmin} title="Verrouiller admin"
              className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors">
              <Unlock style={{ width: 14, height: 14, color: '#EF4444' }} />
            </button>
          </div>
        )}

        {/* User section */}
        <div className="px-2 py-3 border-t border-white/[0.06] shrink-0">
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-brand-600/20 flex items-center justify-center">
                <span className="text-brand-300 font-bold text-sm">
                  {user.utilisateur?.charAt(0)?.toUpperCase()}
                </span>
              </div>
              <button onClick={handleSwitchUser}
                className="p-2 rounded-lg text-slate-500 hover:text-brand-400 hover:bg-white/5 transition-colors"
                title="Changer d'utilisateur">
                <RefreshCw className="w-4 h-4" />
              </button>
              <button onClick={() => { logout(); navigate('/'); }}
                className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/5 transition-colors"
                title="Déconnexion">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-2 px-3 py-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-brand-600/20 flex items-center justify-center shrink-0">
                  <span className="text-brand-300 font-bold text-sm">
                    {user.utilisateur?.charAt(0)?.toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{user.utilisateur}</p>
                  <p className="text-[11px] text-slate-500 capitalize">{user.target}{user.role ? ` · ${user.role}` : ''}</p>
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={handleSwitchUser}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] text-slate-400 hover:text-brand-300 hover:bg-white/5 transition-colors">
                  <RefreshCw className="w-3 h-3" /> Changer
                </button>
                <button onClick={() => { logout(); navigate('/'); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] text-slate-400 hover:text-rose-400 hover:bg-white/5 transition-colors">
                  <LogOut className="w-3 h-3" /> Déconnexion
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer branding */}
        {!collapsed && (
          <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 10, color: '#A1A1AA' }}>
            Propulsé par{' '}
            <span style={{ fontWeight: 800, fontSize: 11 }}>
              <span style={{ color: '#7C3AED' }}>Tk</span>
              <span style={{ color: '#FAFAFA' }}>S</span>
              <span style={{ color: '#EC4899' }}>∞</span>
              <span style={{ color: '#FAFAFA' }}>26</span>
            </span>
            {' '}— une solution{' '}
            <span style={{ fontWeight: 700, color: '#7C3AED' }}>Klik&Dev</span>
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
