import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Wrench, Monitor, Smartphone, ArrowRight, Search } from 'lucide-react';

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-brand-50/30 flex flex-col">
      {/* Header */}
      <header className="p-6 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-brand-500 flex items-center justify-center shadow-lg shadow-brand-500/20">
            <Wrench className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Klikphone</h1>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-[0.2em]">Service après-vente</p>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-4">
          {/* Déposer un appareil */}
          <button
            onClick={() => navigate('/client')}
            className="w-full card-hover p-6 flex items-center gap-5 text-left group"
          >
            <div className="w-14 h-14 rounded-2xl bg-brand-50 flex items-center justify-center shrink-0 group-hover:bg-brand-100 transition-colors">
              <Smartphone className="w-7 h-7 text-brand-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-gray-900">Déposer un appareil</h2>
              <p className="text-sm text-gray-500 mt-0.5">Smartphone, tablette, PC portable, console</p>
            </div>
            <ArrowRight className="w-5 h-5 text-gray-300 group-hover:text-brand-500 transition-colors shrink-0" />
          </button>

          {/* Suivre ma réparation */}
          <button
            onClick={() => navigate('/suivi')}
            className="w-full card-hover p-6 flex items-center gap-5 text-left group"
          >
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0 group-hover:bg-emerald-100 transition-colors">
              <Search className="w-7 h-7 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-gray-900">Suivre ma réparation</h2>
              <p className="text-sm text-gray-500 mt-0.5">Entrez votre numéro de ticket</p>
            </div>
            <ArrowRight className="w-5 h-5 text-gray-300 group-hover:text-emerald-500 transition-colors shrink-0" />
          </button>

          {/* Séparateur */}
          <div className="relative py-4">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
            <div className="relative flex justify-center">
              <span className="bg-gradient-to-br from-gray-50 via-white to-brand-50/30 px-4 text-xs text-gray-400 font-medium uppercase tracking-wider">Accès staff</span>
            </div>
          </div>

          {/* Staff & Tech */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => navigate('/login/accueil')}
              className="card-hover p-5 text-center group"
            >
              <div className="w-12 h-12 rounded-xl bg-sky-50 flex items-center justify-center mx-auto mb-3 group-hover:bg-sky-100 transition-colors">
                <Monitor className="w-6 h-6 text-sky-600" />
              </div>
              <p className="text-sm font-semibold text-gray-900">Accueil</p>
              <p className="text-xs text-gray-400 mt-0.5">Gestion des demandes</p>
            </button>

            <button
              onClick={() => navigate('/login/tech')}
              className="card-hover p-5 text-center group"
            >
              <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center mx-auto mb-3 group-hover:bg-violet-100 transition-colors">
                <Wrench className="w-6 h-6 text-violet-600" />
              </div>
              <p className="text-sm font-semibold text-gray-900">Technicien</p>
              <p className="text-xs text-gray-400 mt-0.5">Atelier réparation</p>
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-6 text-center">
        <p className="text-xs text-gray-400">
          Klikphone — 79 Place Saint Léger, Chambéry · 04 79 60 89 22
        </p>
      </footer>
    </div>
  );
}
