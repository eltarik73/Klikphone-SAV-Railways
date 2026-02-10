import { useState } from 'react';

const GRID_SIZE = 3;
const POINT_POSITIONS = [];
for (let row = 0; row < GRID_SIZE; row++) {
  for (let col = 0; col < GRID_SIZE; col++) {
    POINT_POSITIONS.push({ id: row * GRID_SIZE + col + 1, row, col });
  }
}

export default function PatternGrid({ value, onChange, readOnly = false, size = 160 }) {
  const [sequence, setSequence] = useState(
    value ? value.split('-').map(Number).filter(Boolean) : []
  );

  const padding = 24;
  const gap = (size - padding * 2) / (GRID_SIZE - 1);

  const getPos = (point) => ({
    cx: padding + point.col * gap,
    cy: padding + point.row * gap,
  });

  const handleClick = (pointId) => {
    if (readOnly) return;
    if (sequence.includes(pointId)) return;
    const next = [...sequence, pointId];
    setSequence(next);
    onChange?.(next.join('-'));
  };

  const handleClear = () => {
    setSequence([]);
    onChange?.('');
  };

  const lines = [];
  for (let i = 1; i < sequence.length; i++) {
    const from = POINT_POSITIONS.find(p => p.id === sequence[i - 1]);
    const to = POINT_POSITIONS.find(p => p.id === sequence[i]);
    if (from && to) {
      const p1 = getPos(from);
      const p2 = getPos(to);
      lines.push({ x1: p1.cx, y1: p1.cy, x2: p2.cx, y2: p2.cy, key: `${i}` });
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} className="select-none">
        {lines.map(l => (
          <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke="#7C3AED" strokeWidth="3" strokeLinecap="round" />
        ))}
        {POINT_POSITIONS.map(point => {
          const pos = getPos(point);
          const idx = sequence.indexOf(point.id);
          const isSelected = idx !== -1;
          return (
            <g key={point.id} onClick={() => handleClick(point.id)}
               className={readOnly ? '' : 'cursor-pointer'}>
              <circle cx={pos.cx} cy={pos.cy} r={isSelected ? 14 : 10}
                fill={isSelected ? '#7C3AED' : '#E2E8F0'}
                stroke={isSelected ? '#6D28D9' : '#CBD5E1'} strokeWidth="2" />
              {isSelected && (
                <text x={pos.cx} y={pos.cy + 1} textAnchor="middle" dominantBaseline="central"
                  fill="white" fontSize="11" fontWeight="bold">
                  {idx + 1}
                </text>
              )}
              {!isSelected && !readOnly && (
                <text x={pos.cx} y={pos.cy + 1} textAnchor="middle" dominantBaseline="central"
                  fill="#94A3B8" fontSize="10">
                  {point.id}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {sequence.length > 0 && (
        <p className="text-xs text-slate-500 font-mono">
          {sequence.join(' → ')}
        </p>
      )}
      {!readOnly && sequence.length > 0 && (
        <button type="button" onClick={handleClear}
          className="text-xs text-red-500 hover:text-red-700 font-medium">
          Effacer
        </button>
      )}
    </div>
  );
}
