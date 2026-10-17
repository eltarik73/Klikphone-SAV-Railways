import { memo } from 'react';
import { getStatusConfig } from '../lib/utils';

// Badge de statut uniforme (design V2) : fond -50, texte -700, pastille -500, sans bordure.
// `lg` (bandeau sombre de la fiche ticket) : 32 px + ombre légère pour se détacher du fond.
export default memo(function StatusBadge({ statut, size = 'default' }) {
  const config = getStatusConfig(statut);
  const sizeClasses = size === 'lg'
    ? 'h-8 px-3 text-sm shadow-xs'
    : 'h-6 px-2.5 text-xs';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap leading-none ${sizeClasses} ${config.bg} ${config.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dot}`} aria-hidden="true" />
      {statut}
    </span>
  );
});
