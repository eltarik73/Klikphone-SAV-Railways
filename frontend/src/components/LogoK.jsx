// Logo KlikPhone : le « K » officiel (orange #FF6600, gris #9A9A9A, tournevis et diagonale en blanc),
// tracés repris du fichier vectoriel « K-logo-KlikPhone_Final_SQUARE.pdf » fourni par le gérant (nov. 2026).
// Carré à angles vifs : ne pas arrondir ni recolorer le logo. `label` donne un nom accessible (role img) ;
// sans label, le logo est décoratif (un texte voisin porte déjà le nom).
export default function LogoK({ className = 'w-10 h-10', label }) {
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} shrink-0`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      <path fill="#9A9A9A" d="M 100 0 L 51.9 48.09 C 51.65 48.35 51.46 48.65 51.34 48.97 C 51.21 49.3 51.15 49.65 51.15 50 C 51.15 50.35 51.21 50.7 51.33 51.02 C 51.46 51.35 51.65 51.65 51.9 51.9 L 100 100 L 100 0 Z M 100 0" />
      <path fill="#FF6600" d="M 34.59 0 L 36.4 9.69 C 36.46 9.96 36.48 10.09 36.47 10.18 C 36.46 10.27 36.41 10.32 36.31 10.42 L 35.6 11.06 C 35.45 11.2 35.31 11.34 35.18 11.5 C 35.06 11.65 34.95 11.82 34.86 11.99 C 34.66 12.33 34.52 12.7 34.42 13.12 C 34.32 13.53 34.26 13.99 34.22 14.5 C 34.18 15.01 34.17 15.57 34.17 16.19 L 34.17 44.6 C 34.17 44.85 34.19 45.08 34.24 45.32 C 34.28 45.55 34.35 45.78 34.44 46.01 C 34.6 46.46 34.84 46.89 35.12 47.3 C 35.4 47.71 35.72 48.1 36.05 48.45 C 36.38 48.81 36.73 49.14 37.05 49.44 L 37.05 51.25 C 37.12 51.44 37.18 51.64 37.21 51.84 C 37.25 52.05 37.27 52.26 37.27 52.47 L 37.27 100 L 84.78 100 L 44.29 59.51 C 43.64 58.86 43.06 58.15 42.57 57.41 C 42.08 56.66 41.67 55.88 41.35 55.07 C 41.02 54.26 40.77 53.42 40.61 52.57 C 40.45 51.72 40.37 50.86 40.37 50 C 40.37 49.13 40.45 48.27 40.61 47.42 C 40.77 46.57 41.02 45.74 41.35 44.93 C 41.67 44.12 42.08 43.33 42.57 42.59 C 43.06 41.84 43.64 41.14 44.29 40.48 L 84.77 0 Z M 34.59 0" />
      <path fill="#FF6600" d="M 0 0 L 0 100 L 27.69 100 L 27.69 52.47 C 27.69 52.26 27.71 52.05 27.75 51.84 C 27.78 51.64 27.84 51.44 27.9 51.25 L 27.9 49.44 C 28.23 49.14 28.58 48.81 28.91 48.45 C 29.24 48.1 29.56 47.71 29.84 47.3 C 30.11 46.89 30.35 46.46 30.52 46.01 C 30.61 45.78 30.67 45.55 30.72 45.32 C 30.76 45.08 30.79 44.85 30.79 44.6 L 30.79 16.19 C 30.79 15.57 30.78 15.01 30.74 14.5 C 30.7 13.99 30.64 13.53 30.54 13.12 C 30.44 12.7 30.3 12.33 30.1 11.99 C 30.01 11.82 29.9 11.65 29.77 11.5 C 29.65 11.34 29.51 11.2 29.35 11.06 L 28.65 10.42 C 28.55 10.32 28.5 10.27 28.48 10.18 C 28.47 10.09 28.5 9.96 28.56 9.69 L 30.37 0 Z M 0 0" />
      <path fill="#FFFFFF" d="M 84.77 0 L 44.29 40.48 C 43.64 41.14 43.06 41.84 42.57 42.59 C 42.08 43.33 41.67 44.12 41.35 44.93 C 41.02 45.74 40.77 46.57 40.61 47.42 C 40.45 48.27 40.37 49.13 40.37 50 C 40.37 50.86 40.45 51.72 40.61 52.57 C 40.77 53.42 41.02 54.26 41.35 55.07 C 41.67 55.88 42.08 56.66 42.57 57.41 C 43.06 58.15 43.64 58.86 44.29 59.51 L 84.78 100 L 100 100 L 100 100 L 51.9 51.9 C 51.65 51.65 51.46 51.35 51.33 51.02 C 51.21 50.7 51.15 50.35 51.15 50 C 51.15 49.65 51.21 49.3 51.34 48.97 C 51.46 48.65 51.65 48.35 51.9 48.1 L 100 0 Z M 84.77 0" />
      <path fill="#FFFFFF" d="M 34.59 0 L 36.4 9.69 C 36.46 9.96 36.48 10.09 36.47 10.18 C 36.46 10.27 36.41 10.32 36.31 10.42 L 35.6 11.06 C 35.45 11.2 35.31 11.34 35.18 11.5 C 35.06 11.65 34.95 11.82 34.86 11.99 C 34.66 12.33 34.52 12.7 34.42 13.12 C 34.32 13.53 34.26 13.99 34.22 14.5 C 34.18 15.01 34.17 15.57 34.17 16.19 L 34.17 44.6 C 34.17 44.85 34.19 45.08 34.24 45.32 C 34.28 45.55 34.35 45.78 34.44 46.01 C 34.6 46.46 34.84 46.89 35.12 47.3 C 35.4 47.71 35.72 48.1 36.05 48.45 C 36.38 48.81 36.73 49.14 37.05 49.44 L 37.05 51.25 C 37.12 51.44 37.18 51.64 37.21 51.84 C 37.25 52.05 37.27 52.26 37.27 52.47 L 37.27 94.91 L 32.48 94.91 L 32.48 0 Z M 32.48 100 L 32.48 94.91 L 37.27 94.91 L 37.27 100 Z M 30.37 0 L 28.56 9.69 C 28.5 9.96 28.47 10.09 28.48 10.18 C 28.5 10.27 28.55 10.32 28.65 10.42 L 29.35 11.06 C 29.51 11.2 29.65 11.34 29.77 11.5 C 29.9 11.65 30.01 11.82 30.1 11.99 C 30.3 12.33 30.44 12.7 30.54 13.12 C 30.64 13.53 30.7 13.99 30.74 14.5 C 30.78 15.01 30.79 15.57 30.79 16.19 L 30.79 44.6 C 30.79 44.85 30.76 45.08 30.72 45.32 C 30.67 45.55 30.61 45.78 30.52 46.01 C 30.35 46.46 30.11 46.89 29.84 47.3 C 29.56 47.71 29.24 48.1 28.91 48.45 C 28.58 48.81 28.23 49.14 27.9 49.44 L 27.9 51.25 C 27.84 51.44 27.78 51.64 27.75 51.84 C 27.71 52.05 27.69 52.26 27.69 52.47 L 27.69 94.91 L 32.48 94.91 L 32.48 0 Z M 32.48 100 L 32.48 94.91 L 27.69 94.91 L 27.69 100 Z M 32.48 100" />
    </svg>
  );
}

// Mot « KlikPhone » (avec ®) découpé du logo officiel, sur fond transparent : noir pour les fonds clairs,
// blanc pour la barre latérale. Rapport largeur / hauteur ≈ 5,29.
const MOT = { clair: '/brand/klikphone-wordmark-noir.png', sombre: '/brand/klikphone-wordmark-blanc.png' };
const TAILLES = {
  sm: { k: 'w-8 h-8', mot: 'h-5', hauteur: 20, ecart: 'gap-2.5' },
  md: { k: 'w-10 h-10', mot: 'h-6', hauteur: 24, ecart: 'gap-3' },
  lg: { k: 'w-[72px] h-[72px]', mot: 'h-10', hauteur: 40, ecart: 'gap-4' },
};

/**
 * Logo complet : le « K » + le mot « KlikPhone ». `theme` : 'clair' (fond blanc / slate-50) ou 'sombre'
 * (barre latérale) ; `vertical` : K au-dessus du mot (accueil) ; `sousTitre` : ligne sous le mot.
 * Le nom accessible est porté par l'image du mot (alt « KlikPhone ») ; le K est décoratif.
 */
export function LogoKlikPhone({ theme = 'clair', taille = 'md', vertical = false, sousTitre, className = '' }) {
  const t = TAILLES[taille] || TAILLES.md;
  const sous = sousTitre && (
    <span className={`block text-xs ${theme === 'sombre' ? 'text-slate-400' : 'text-slate-600'} ${vertical ? 'mt-2 text-sm' : 'mt-1'} whitespace-nowrap`}>
      {sousTitre}
    </span>
  );
  return (
    <span className={`inline-flex ${vertical ? 'flex-col items-center text-center' : 'items-center'} ${t.ecart} ${className}`}>
      <LogoK className={t.k} />
      <span className="min-w-0">
        <img src={MOT[theme] || MOT.clair} alt="KlikPhone" width={Math.round(t.hauteur * 5.29)} height={t.hauteur}
          className={`${t.mot} w-auto block ${vertical ? 'mx-auto' : ''}`} draggable="false" />
        {sous}
      </span>
    </span>
  );
}
