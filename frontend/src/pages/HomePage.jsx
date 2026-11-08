import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Search, ArrowRight, Monitor, Wrench, MapPin, Phone, Globe, Smartphone, Tag } from 'lucide-react';
import { useRechargementAuRepos } from '../lib/miseAJour';
import LogoK from '../components/LogoK';

// Page de connexion chargée à la demande : on l'anticipe dès que la souris ou le doigt
// s'approche d'un bouton « Accès staff » (le clic n'attend alors plus le réseau).
const preloadLogin = () => { import('./LoginPage').catch(() => {}); };
const staffProps = { onMouseEnter: preloadLogin, onFocus: preloadLogin, onTouchStart: preloadLogin };

// Design épuré : page claire comme les autres écrans publics (suivi, dépôt), logo en aplat brand-600,
// une seule action pleine (« Déposer un appareil »), les autres en secondaire ; aucune animation,
// aucune ombre. Les boutons de choix gardent deux lignes (titre + précision) : cibles de 64 px au doigt.
const ctaBase = 'btn-lg btn-block justify-start text-left min-h-16 px-4 whitespace-normal';

export default function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Borne : la flèche retour de /client mène ici. Page sans saisie : dès que personne ne touche
  // l'écran depuis 2 min, vérification toutes les 10 min et rechargement si nouvelle version.
  useRechargementAuRepos({ auRepos: !user });

  // Auto-redirect si déjà connecté
  if (user) return <Navigate to={user.target === 'tech' ? '/tech' : '/accueil'} replace />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-10 sm:py-12">
        {/* Logo : « K » en aplat (le PNG public est un dégradé) */}
        <LogoK className="w-16 h-16" />
        <h1 className="t-display text-center mt-4">KLIKPHONE</h1>
        <p className="text-sm text-slate-600 mt-1 text-center">Spécialiste Apple et multimarque</p>
        <p className="text-sm text-slate-600 leading-relaxed mt-3 text-center max-w-md">
          Réparation smartphones, tablettes, PC portables et consoles.
          Déposez votre appareil ou suivez votre réparation.
        </p>

        {/* Actions client : une primaire, trois secondaires */}
        <div className="mt-10 w-full max-w-sm space-y-3">
          <button type="button" onClick={() => navigate('/client')} className={`btn-primary ${ctaBase}`}>
            <Smartphone aria-hidden="true" />
            <span className="flex-1 min-w-0">
              <span className="block">Déposer un appareil</span>
              <span className="block text-sm font-normal text-brand-100 mt-0.5">Créer un ticket de réparation</span>
            </span>
            <ArrowRight aria-hidden="true" />
          </button>

          <button type="button" onClick={() => navigate('/deposer')} className={`btn-secondary ${ctaBase}`}>
            <Globe className="text-slate-500" aria-hidden="true" />
            <span className="flex-1 min-w-0">
              <span className="block">Dépôt à distance</span>
              <span className="block text-sm font-normal text-slate-500 mt-0.5">Pré-enregistrez votre appareil en ligne</span>
            </span>
            <ArrowRight className="text-slate-400" aria-hidden="true" />
          </button>

          <button type="button" onClick={() => navigate('/suivi')} className={`btn-secondary ${ctaBase}`}>
            <Search className="text-slate-500" aria-hidden="true" />
            <span className="flex-1 min-w-0">
              <span className="block">Suivre ma réparation</span>
              <span className="block text-sm font-normal text-slate-500 mt-0.5">Avec mon numéro de ticket</span>
            </span>
            <ArrowRight className="text-slate-400" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => {
              import('../lib/api').then(({ default: api }) =>
                api.trackEvent('tarifs_click', 'home', '/site-tarifs-iphone')
              );
              navigate('/site-tarifs-iphone');
            }}
            className={`btn-secondary ${ctaBase}`}>
            <Tag className="text-slate-500" aria-hidden="true" />
            <span className="flex-1 min-w-0">
              <span className="block">Voir nos tarifs téléphones</span>
              <span className="block text-sm font-normal text-slate-500 mt-0.5">iPhone, Samsung, Google, Xiaomi, reconditionnés et neufs</span>
            </span>
            <ArrowRight className="text-slate-400" aria-hidden="true" />
          </button>
        </div>

        {/* Staff */}
        <div className="mt-12 w-full max-w-sm">
          <p className="text-center text-sm text-slate-500 mb-3">Accès staff</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => navigate('/login/accueil')} {...staffProps} className="btn-ghost min-h-11 text-slate-600">
              <Monitor aria-hidden="true" /> Accueil
            </button>
            <button type="button" onClick={() => navigate('/login/tech')} {...staffProps} className="btn-ghost min-h-11 text-slate-600">
              <Wrench aria-hidden="true" /> Technicien
            </button>
          </div>
        </div>
      </div>

      {/* Pied de page */}
      <footer className="py-4 text-center text-xs text-slate-500 flex flex-wrap items-center justify-center gap-2 px-4">
        <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" aria-hidden="true" /> 79 Place Saint Léger, Chambéry</span>
        <span className="hidden sm:block" aria-hidden="true">·</span>
        <span className="flex items-center gap-1.5"><Phone className="w-4 h-4" aria-hidden="true" /> 04 79 60 89 22</span>
      </footer>
    </div>
  );
}
