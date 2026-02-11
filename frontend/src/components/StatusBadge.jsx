import { getStatusConfig } from '../lib/utils';

export default function StatusBadge({ statut, size = 'default' }) {
  const config = getStatusConfig(statut);
  const sizeClasses = size === 'lg'
    ? 'px-3.5 py-1.5 text-sm'
    : 'px-2.5 py-1 text-xs';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 transition-colors ${sizeClasses} ${config.bg} ${config.text} ${config.ring}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {statut}
    </span>
  );
}
