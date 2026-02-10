import { useAuth } from '../hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Wrench, LayoutDashboard, Users, Settings, Package } from 'lucide-react';

const NAV_ITEMS = {
  accueil: [
    { path: '/accueil', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/accueil/clients', label: 'Clients', icon: Users },
    { path: '/accueil/pieces', label: 'Pièces', icon: Package },
    { path: '/accueil/config', label: 'Config', icon: Settings },
  ],
  tech: [
    { path: '/tech', label: 'Mes tickets', icon: Wrench },
  ],
};

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (!user) return null;

  const items = NAV_ITEMS[user.target] || [];

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => navigate(user.target === 'tech' ? '/tech' : '/accueil')}
          >
            <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center">
              <Wrench className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-gray-900">Klikphone</h1>
              <p className="text-[10px] text-gray-400 -mt-0.5 font-medium uppercase tracking-widest">SAV</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="hidden sm:flex items-center gap-1">
            {items.map(({ path, label, icon: Icon }) => {
              const active = location.pathname === path;
              return (
                <button
                  key={path}
                  onClick={() => navigate(path)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all duration-200
                    ${active
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              );
            })}
          </nav>

          {/* User + Logout */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <p className="text-sm font-semibold text-gray-900">{user.utilisateur}</p>
              <p className="text-xs text-gray-400 capitalize">{user.target}</p>
            </div>
            <button
              onClick={() => { logout(); navigate('/'); }}
              className="p-2 rounded-xl text-gray-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
              title="Déconnexion"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Nav mobile */}
      <div className="sm:hidden border-t border-gray-100 px-2 py-1.5 flex gap-1 overflow-x-auto">
        {items.map(({ path, label, icon: Icon }) => {
          const active = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all
                ${active ? 'bg-brand-50 text-brand-700' : 'text-gray-500'}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>
    </header>
  );
}
