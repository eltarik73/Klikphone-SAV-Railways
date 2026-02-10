import { getStatusStyle, getStatusIcon } from '../lib/utils';

export default function StatusBadge({ statut }) {
  return (
    <span className={`badge ${getStatusStyle(statut)}`}>
      <span>{getStatusIcon(statut)}</span>
      {statut}
    </span>
  );
}
