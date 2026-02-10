import { useNavigate } from 'react-router-dom';
import { Smartphone, Search, ArrowRight, Monitor, Wrench, MapPin, Phone } from 'lucide-react';

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col">
      {/* Header */}
      <header className="px-6 py-5 flex items-center justify-between max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center shadow-lg shadow-brand-500/30">
            <Smartphone className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">KLIKPHONE</h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-[0.2em]">Service apr\u00E8s-vente</p>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-6 pb-12">
        <div className="w-full max-w-md space-y-5">
          {/* Headline */}
          <div className="text-center mb-8 animate-in">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight">
              R\u00E9paration<br />
              <span className="text-brand-400">rapide & fiable</span>
            </h2>
            <p className="text-slate-400 text-sm mt-3 max-w-xs mx-auto">
              Smartphones, tablettes, PC portables et consoles. D\u00E9posez votre appareil ou suivez votre r\u00E9paration.
            </p>
          </div>

          {/* CTA Cards */}
          <button
            onClick={() => navigate('/client')}
            className="w-full bg-brand-500 hover:bg-brand-600 text-white rounded-xl p-5 flex items-center gap-4 text-left transition-all duration-200 hover:shadow-lg hover:shadow-brand-500/25 hover:-translate-y-0.5 group animate-in"
            style={{ animationDelay: '100ms' }}
          >
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              <Smartphone className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-[15px]">D\u00E9poser un appareil</p>
              <p className="text-sm text-brand-200 mt-0.5">Cr\u00E9er un ticket de r\u00E9paration</p>
            </div>
            <ArrowRight className="w-5 h-5 text-brand-200 group-hover:translate-x-1 transition-transform" />
          </button>

          <button
            onClick={() => navigate('/suivi')}
            className="w-full bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-white rounded-xl p-5 flex items-center gap-4 text-left transition-all duration-200 hover:-translate-y-0.5 group animate-in"
            style={{ animationDelay: '200ms' }}
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
              <Search className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-[15px]">Suivre ma r\u00E9paration</p>
              <p className="text-sm text-slate-400 mt-0.5">Avec mon num\u00E9ro de ticket</p>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-500 group-hover:translate-x-1 transition-transform" />
          </button>

          {/* Staff access */}
          <div className="pt-4 animate-in" style={{ animationDelay: '300ms' }}>
            <p className="text-center text-[11px] text-slate-500 uppercase tracking-widest font-medium mb-3">Acc\u00E8s staff</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => navigate('/login/accueil')}
                className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-xl p-4 text-center group transition-all duration-200"
              >
                <div className="w-10 h-10 rounded-lg bg-sky-500/10 flex items-center justify-center mx-auto mb-2">
                  <Monitor className="w-5 h-5 text-sky-400" />
                </div>
                <p className="text-sm font-semibold text-slate-200">Accueil</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Gestion SAV</p>
              </button>

              <button
                onClick={() => navigate('/login/tech')}
                className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-xl p-4 text-center group transition-all duration-200"
              >
                <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center mx-auto mb-2">
                  <Wrench className="w-5 h-5 text-violet-400" />
                </div>
                <p className="text-sm font-semibold text-slate-200">Technicien</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Atelier</p>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-5 border-t border-white/[0.04]">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><MapPin className="w-3 h-3" /> 79 Place Saint L\u00E9ger, Chamb\u00E9ry</span>
          <span className="hidden sm:block">\u00B7</span>
          <span className="flex items-center gap-1.5"><Phone className="w-3 h-3" /> 04 79 60 89 22</span>
        </div>
      </footer>
    </div>
  );
}
