import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LogOut, LayoutDashboard, Plus, Users, Package, FileText,
  Settings, Menu, X, Smartphone, Search,
} from 'lucide-react';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!user) return null;

  const basePath = user.target === 'tech' ? '/tech' : '/accueil';

  const navItems = [
    { path: basePath, label: 'Dashboard', icon: LayoutDashboard },
    { path: '/client', label: 'Nouveau ticket', icon: Plus },
    { path: `${basePath}/clients`, label: 'Clients', icon: Users },
    { path: `${basePath}/commandes`, label: 'Commandes', icon: Package },
    { path: `${basePath}/attestation`, label: 'Attestation', icon: FileText },
    { path: `${basePath}/config`, label: 'Configuration', icon: Settings },
    { path: '/suivi', label: 'Suivi client', icon: Search },
  ];

  const isActive = (path) => location.pathname === path;

  const handleNav = (path) => {
    navigate(path);
    setMobileOpen(false);
  };

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-sidebar border-b border-white/10 flex items-center px-4 z-40">
        <button onClick={() => setMobileOpen(true)} className="p-2 -ml-2 text-slate-400 hover:text-white transition-colors">
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2.5 ml-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
            <Smartphone className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-display font-bold tracking-tight">KLIKPHONE</span>
        </div>
      </div>

      {/* Backdrop */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 bottom-0 w-64 bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col z-50
        transform transition-transform duration-300 ease-in-out
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
      `}>
        {/* Logo */}
        <div className="h-16 px-5 flex items-center gap-3 border-b border-white/[0.06] shrink-0">
          <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center shadow-lg shadow-brand-600/30">
            <Smartphone className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-white font-display font-bold text-[15px] tracking-tight leading-none">KLIKPHONE</h1>
            <p className="text-slate-500 text-[10px] uppercase tracking-[0.15em] mt-0.5">Service après-vente</p>
          </div>
          <button onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-none">
          <p className="px-3 mb-2 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Menu</p>
          {navItems.map(({ path, label, icon: Icon }) => (
            <button key={path} onClick={() => handleNav(path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200
                ${isActive(path)
                  ? 'bg-brand-600/20 text-brand-300 border-l-2 border-brand-400 pl-[10px]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
            >
              <Icon className={`w-[18px] h-[18px] ${isActive(path) ? 'text-brand-400' : ''}`} />
              {label}
            </button>
          ))}
        </nav>

        {/* User section */}
        <div className="px-3 py-3 border-t border-white/[0.06] shrink-0">
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
        </div>
      </aside>
    </>
  );
}
