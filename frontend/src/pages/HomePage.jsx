import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Search, ArrowRight, Monitor, Wrench, MapPin, Phone } from 'lucide-react';

export default function HomePage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  // Auto-redirect si déjà connecté
  if (!loading && user) {
    const dest = user.target === 'tech' ? '/tech' : '/accueil';
    navigate(dest, { replace: true });
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-brand-900 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-2">
          <img src="/logo_k.png" alt="Klikphone"
            className="w-20 h-20 rounded-2xl object-contain shadow-xl shadow-brand-600/20"
          />
        </div>
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-white text-center tracking-tight mt-3">
          KLIKPHONE
        </h1>
        <p className="text-brand-300 text-sm font-medium uppercase tracking-[0.2em] mt-1">
          Spécialiste Apple & Multimarque
        </p>
        <p className="text-slate-400 text-sm mt-3 text-center max-w-md">
          Réparation smartphones, tablettes, PC portables et consoles.
          Déposez votre appareil ou suivez votre réparation.
        </p>

        {/* CTA buttons */}
        <div className="mt-10 w-full max-w-sm space-y-3">
          <button onClick={() => navigate('/client')}
            className="w-full flex items-center gap-4 p-4 rounded-2xl text-white shadow-lg shadow-brand-600/30 transition-all group hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)' }}>
            <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0 backdrop-blur-sm">
              <img src="/logo_k.png" alt="" className="w-6 h-6 object-contain" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold">Déposer un appareil</p>
              <p className="text-sm text-brand-200 mt-0.5">Créer un ticket de réparation</p>
            </div>
            <ArrowRight className="w-5 h-5 text-brand-200 group-hover:translate-x-1 transition-transform" />
          </button>

          <button onClick={() => navigate('/suivi')}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 text-white transition-all group backdrop-blur-sm hover:-translate-y-0.5">
            <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              <Search className="w-5 h-5" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold">Suivre ma réparation</p>
              <p className="text-sm text-slate-400 mt-0.5">Avec mon numéro de ticket</p>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-500 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        {/* Staff */}
        <div className="mt-12 w-full max-w-sm">
          <p className="text-center text-[11px] text-slate-500 uppercase tracking-widest font-medium mb-3">Accès staff</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => navigate('/login/accueil')}
              className="flex items-center justify-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 text-sm font-medium hover:bg-white/10 transition-all hover:-translate-y-0.5">
              <Monitor className="w-4 h-4 text-sky-400" /> Accueil
            </button>
            <button onClick={() => navigate('/login/tech')}
              className="flex items-center justify-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 text-sm font-medium hover:bg-white/10 transition-all hover:-translate-y-0.5">
              <Wrench className="w-4 h-4 text-violet-400" /> Technicien
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-slate-600 flex flex-wrap items-center justify-center gap-2 px-4">
        <span className="flex items-center gap-1.5"><MapPin className="w-3 h-3" /> 79 Place Saint Léger, Chambéry</span>
        <span className="hidden sm:block">·</span>
        <span className="flex items-center gap-1.5"><Phone className="w-3 h-3" /> 04 79 60 89 22</span>
      </footer>
    </div>
  );
}
