import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Search, ArrowRight, Monitor, Wrench, MapPin, Phone, Globe, Smartphone, Tag } from 'lucide-react';

// Page de connexion chargée à la demande : on l'anticipe dès que la souris ou le doigt
// s'approche d'un bouton « Accès staff » (le clic n'attend alors plus le réseau).
const preloadLogin = () => { import('./LoginPage').catch(() => {}); };
const staffProps = { onMouseEnter: preloadLogin, onFocus: preloadLogin, onTouchStart: preloadLogin };

// Design V2 : hero sombre conservé (identité publique) ; une seule action pleine (« Déposer un
// appareil »), les autres en « secondaire sur fond sombre » ; aucune translation au survol.
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900';
const ctaBase = `w-full min-h-[72px] flex items-center gap-4 p-4 rounded-xl text-left transition-colors duration-150 group ${FOCUS}`;
const ctaPrimary = `${ctaBase} bg-brand-600 hover:bg-brand-700 text-white shadow-lg`;
const ctaSecondary = `${ctaBase} bg-white/[0.07] border border-white/15 hover:bg-white/[0.12] hover:border-white/25 text-white`;
// Vitrine vente (levier commercial) : même carte secondaire, liseré brand pour la distinguer des deux
// autres sans réintroduire de dégradé ni de seconde action pleine.
const ctaHighlight = `${ctaBase} bg-white/[0.07] border border-brand-400/50 hover:bg-white/[0.12] hover:border-brand-400/80 text-white`;
const arrowCls = 'w-5 h-5 shrink-0 transition-transform duration-150 motion-safe:group-hover:translate-x-1';

export default function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Auto-redirect si déjà connecté
  if (user) return <Navigate to={user.target === 'tech' ? '/tech' : '/accueil'} replace />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-brand-900 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-10 sm:py-12">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-2">
          <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg"
            className="w-20 h-20 drop-shadow-[0_8px_24px_rgba(124,58,237,0.35)]" aria-hidden="true"
          >
            <defs>
              <linearGradient id="logo-bg" x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
                <stop stopColor="#8B5CF6"/>
                <stop offset="1" stopColor="#4F46E5"/>
              </linearGradient>
            </defs>
            <rect width="200" height="200" rx="44" fill="url(#logo-bg)"/>
            <path d="M62 42 L84 42 L84 89 L130 42 L156 42 L106 98 L158 158 L130 158 L84 111 L84 158 L62 158 Z" fill="white" fillOpacity="0.95"/>
          </svg>
        </div>
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-white text-center tracking-tight mt-3">
          KLIKPHONE
        </h1>
        <p className="text-brand-300 text-sm font-semibold uppercase tracking-[0.2em] mt-1 text-center">
          Spécialiste Apple & Multimarque
        </p>
        <p className="text-slate-300 text-sm leading-relaxed mt-3 text-center max-w-md">
          Réparation smartphones, tablettes, PC portables et consoles.
          Déposez votre appareil ou suivez votre réparation.
        </p>

        {/* CTA buttons */}
        <div className="mt-10 w-full max-w-sm space-y-3">
          <button type="button" onClick={() => navigate('/client')} className={ctaPrimary}>
            <div className="w-11 h-11 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">Déposer un appareil</p>
              <p className="text-sm text-brand-100 mt-0.5">Créer un ticket de réparation</p>
            </div>
            <ArrowRight className={`${arrowCls} text-brand-100`} aria-hidden="true" />
          </button>

          <button type="button" onClick={() => navigate('/deposer')} className={ctaSecondary}>
            <div className="w-11 h-11 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
              <Globe className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">Dépôt à distance</p>
              <p className="text-sm text-slate-300 mt-0.5">Pré-enregistrez votre appareil en ligne</p>
            </div>
            <ArrowRight className={`${arrowCls} text-slate-400`} aria-hidden="true" />
          </button>

          <button type="button" onClick={() => navigate('/suivi')} className={ctaSecondary}>
            <div className="w-11 h-11 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
              <Search className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">Suivre ma réparation</p>
              <p className="text-sm text-slate-300 mt-0.5">Avec mon numéro de ticket</p>
            </div>
            <ArrowRight className={`${arrowCls} text-slate-400`} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => {
              import('../lib/api').then(({ default: api }) =>
                api.trackEvent('tarifs_click', 'home', '/site-tarifs-iphone')
              );
              navigate('/site-tarifs-iphone');
            }}
            className={ctaHighlight}>
            <div className="w-11 h-11 rounded-lg bg-brand-500/25 text-brand-200 flex items-center justify-center shrink-0">
              <Tag className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">Voir nos <span className="font-editorial font-normal text-brand-200">tarifs</span> téléphones</p>
              <p className="text-sm text-slate-300 mt-0.5">iPhone, Samsung, Google, Xiaomi — reconditionnés & neufs</p>
            </div>
            <ArrowRight className={`${arrowCls} text-slate-400`} aria-hidden="true" />
          </button>
        </div>

        {/* Staff */}
        <div className="mt-12 w-full max-w-sm">
          <p className="text-center text-xs text-slate-400 uppercase tracking-[0.06em] font-semibold mb-3">Accès staff</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => navigate('/login/accueil')} {...staffProps}
              className={`min-h-11 flex items-center justify-center gap-2 p-3 rounded-lg bg-white/[0.07] border border-white/15 text-slate-200 text-sm font-medium hover:bg-white/[0.12] hover:text-white transition-colors duration-150 ${FOCUS}`}>
              <Monitor className="w-4 h-4 text-brand-300" aria-hidden="true" /> Accueil
            </button>
            <button type="button" onClick={() => navigate('/login/tech')} {...staffProps}
              className={`min-h-11 flex items-center justify-center gap-2 p-3 rounded-lg bg-white/[0.07] border border-white/15 text-slate-200 text-sm font-medium hover:bg-white/[0.12] hover:text-white transition-colors duration-150 ${FOCUS}`}>
              <Wrench className="w-4 h-4 text-brand-300" aria-hidden="true" /> Technicien
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-slate-400 flex flex-wrap items-center justify-center gap-2 px-4">
        <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" aria-hidden="true" /> 79 Place Saint Léger, Chambéry</span>
        <span className="hidden sm:block" aria-hidden="true">·</span>
        <span className="flex items-center gap-1.5"><Phone className="w-4 h-4" aria-hidden="true" /> 04 79 60 89 22</span>
      </footer>
    </div>
  );
}
