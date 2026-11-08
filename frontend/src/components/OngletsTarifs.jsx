import { Link, useLocation } from 'react-router-dom';
import { Smartphone, Wrench, Tag, ShoppingBag, Store, Search } from 'lucide-react';

/**
 * Rubrique « Tarifs » : une seule entrée dans le menu, les cinq grilles et la recherche fournisseurs en onglets
 * ici (les adresses restent celles de chaque grille : /accueil/tarifs, /accueil/tarifs-reparation…, liens et
 * favoris intacts).
 */
export const ONGLETS_TARIFS = Object.freeze([
  { suffixe: 'tarifs', label: 'Réparation smartphones', icon: Smartphone },
  { suffixe: 'tarifs-reparation', label: 'Réparation iPhone', icon: Wrench },
  { suffixe: 'tarifs-iphone', label: 'Vente iPhones', icon: Tag },
  { suffixe: 'tarifs-smartphones', label: 'Vente smartphones', icon: ShoppingBag },
  { suffixe: 'tarifs-telephones', label: 'Catalogue téléphones', icon: Store },
  { suffixe: 'tarifs-fournisseurs', label: 'Recherche fournisseurs', icon: Search },
]);

export const basePathDe = (pathname) => (String(pathname || '').startsWith('/tech') ? '/tech' : '/accueil');
export const cheminsTarifs = (basePath) => ONGLETS_TARIFS.map((o) => `${basePath}/${o.suffixe}`);
const actifSur = (pathname, chemin) => pathname === chemin || pathname.startsWith(`${chemin}/`);
/** La page affichée est une grille de tarifs (entrée « Tarifs » du menu allumée). */
export const estPageTarifs = (pathname) => cheminsTarifs(basePathDe(pathname)).some((c) => actifSur(String(pathname || ''), c));

export default function OngletsTarifs({ children }) {
  const { pathname } = useLocation();
  const basePath = basePathDe(pathname);
  return (
    <div className="min-w-0">
      {/* Onglets à soulignement (page-tabs) : l'onglet courant est souligné, jamais un bloc violet plein */}
      <nav aria-label="Grilles de tarifs" className="px-4 sm:px-6 bg-white">
        <ul className="page-tabs">
          {ONGLETS_TARIFS.map(({ suffixe, label, icon: Icon }) => {
            const to = `${basePath}/${suffixe}`;
            const actif = actifSur(pathname, to);
            return (
              <li key={suffixe} className="shrink-0">
                <Link to={to} aria-current={actif ? 'page' : undefined}
                  className={`page-tab ${actif ? 'page-tab-active' : ''}`}>
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {children}
    </div>
  );
}
