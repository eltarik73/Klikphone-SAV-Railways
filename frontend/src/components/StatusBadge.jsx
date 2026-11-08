import { memo } from 'react';
import {
  Globe, CircleDashed, Package, PackageCheck, MessageSquareMore, Wrench,
  CircleCheck, CheckCheck, Archive, Circle,
} from 'lucide-react';
import { getStatusConfig } from '../lib/utils';

// Icônes des statuts (clé `icon` de lib/utils.js) : import nommé pour garder le tree-shaking de lucide.
const ICONES = { Globe, CircleDashed, Package, PackageCheck, MessageSquareMore, Wrench, CircleCheck, CheckCheck, Archive, Circle };

// Badge de statut (design épuré, décision 6) : toujours le libellé en texte, jamais la couleur seule.
// - `variant="dot"` (défaut, listes) : pastille de la teinte (600) + texte slate-700, sans fond.
// - `variant="solid"` (en-tête de fiche) : fond -50, texte -700, anneau -200, icône lucide 14 px.
// - `size="lg"` ⇒ variante solid de 32 px (compatibilité des appels existants).
export default memo(function StatusBadge({ statut, variant = 'dot', size = 'default' }) {
  const config = getStatusConfig(statut);
  const solid = variant === 'solid' || size === 'lg';

  if (!solid) {
    const texte = config.groupe === 'clos' ? 'text-slate-500' : 'text-slate-700';
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${texte}`}>
        <span className={`w-2 h-2 rounded-full shrink-0 ${config.dot}`} aria-hidden="true" />
        {statut}
      </span>
    );
  }

  const Icone = ICONES[config.icon] || Circle;
  const taille = size === 'lg' ? 'h-8 px-3' : 'h-7 px-2.5';
  return (
    <span className={`inline-flex items-center gap-1.5 ${taille} rounded-md text-sm font-medium whitespace-nowrap leading-none ${config.bg} ${config.text} ring-1 ${config.ring}`}>
      <Icone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      {statut}
    </span>
  );
});
