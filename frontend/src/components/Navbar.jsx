import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../lib/api';
import {
  LogOut, LayoutDashboard, Plus, Users, Package, FileText,
  Settings, Menu, X, Search, Shield, PanelLeftClose, PanelLeftOpen,
  ArrowRightLeft,
} from 'lucide-react';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('kp_sidebar_collapsed') === '1');
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    const fetchKpi = () => {
      api.getKPI()
        .then(kpi => setPendingCount(kpi?.total_actifs || 0))
        .catch(() => {});
    };
    fetchKpi();
    const interval = setInterval(fetchKpi, 30000);
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
  const otherTarget = user.target === 'tech' ? 'accueil' : 'tech';
  const otherBasePath = user.target === 'tech' ? '/accueil' : '/tech';

  const navItems = [
    { path: basePath, label: 'Dashboard', icon: LayoutDashboard, badge: pendingCount },
    { path: '/client', label: '+ Nouveau', icon: Plus },
    { path: `${basePath}/clients`, label: 'Clients', icon: Users },
    { path: `${basePath}/commandes`, label: 'Commandes', icon: Package },
    { path: `${basePath}/attestation`, label: 'Attestation', icon: FileText },
    { path: `${basePath}/config`, label: 'Configuration', icon: Settings },
    { path: '/suivi', label: 'Suivi client', icon: Search },
  ];

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

  const handleNav = (path) => {
    navigate(path);
    setMobileOpen(false);
  };

  const handleSwitchTarget = async () => {
    try {
      // Re-login with same PIN for other target
      const pin = '2626'; // Will be prompted if needed
      const data = await api.login(pin, otherTarget, user.utilisateur);
      navigate(otherBasePath);
    } catch {
      // If auto-switch fails, redirect to login page for other target
      navigate(`/login/${otherTarget}`);
    }
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
        fixed top-0 left-0 bottom-0 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col z-50
        transition-all duration-300 ease-in-out
        ${collapsed ? 'w-[68px]' : 'w-64'}
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
      `}>
        {/* Logo */}
        <div className="h-16 px-4 flex items-center gap-3 border-b border-white/[0.06] shrink-0">
          <img src="/logo_k.png" alt="Klikphone" className="w-9 h-9 rounded-xl object-contain shadow-lg shrink-0" />
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

          {/* Admin separator */}
          <div className={`pt-4 mt-4 border-t border-white/[0.06] ${collapsed ? 'px-0' : ''}`}>
            {!collapsed && <p className="px-3 mb-2 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Administration</p>}
            <button onClick={() => handleNav(`${basePath}/admin`)}
              title={collapsed ? 'Admin' : undefined}
              className={`w-full flex items-center gap-3 rounded-lg text-[13px] font-medium transition-all duration-200
                ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'}
                ${location.pathname.includes('/admin')
                  ? `bg-amber-500/20 text-amber-300 ${collapsed ? '' : 'border-l-2 border-amber-400 pl-[10px]'}`
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
            >
              <Shield className={`w-[18px] h-[18px] shrink-0 ${location.pathname.includes('/admin') ? 'text-amber-400' : 'text-amber-500/60'}`} />
              {!collapsed && <span>Admin</span>}
            </button>
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

        {/* User section */}
        <div className="px-2 py-3 border-t border-white/[0.06] shrink-0">
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-brand-600/20 flex items-center justify-center">
                <span className="text-brand-300 font-bold text-sm">
                  {user.utilisateur?.charAt(0)?.toUpperCase()}
                </span>
              </div>
              <button onClick={() => { logout(); navigate('/'); }}
                className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/5 transition-colors"
                title="Déconnexion">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="w-9 h-9 rounded-full bg-brand-600/20 flex items-center justify-center shrink-0">
                <span className="text-brand-300 font-bold text-sm">
                  {user.utilisateur?.charAt(0)?.toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">{user.utilisateur}</p>
                <p className="text-[11px] text-slate-500 capitalize">{user.target}</p>
              </div>
              <button onClick={() => { logout(); navigate('/'); }}
                className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/5 transition-colors"
                title="Déconnexion">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
