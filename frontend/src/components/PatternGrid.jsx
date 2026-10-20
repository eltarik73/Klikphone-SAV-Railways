import { useState, useRef, useCallback, useEffect, useId } from 'react';

/**
 * Schéma de déverrouillage Android (grille 3 × 3). Valeur : points dans l'ordre du tracé, séparés
 * par des tirets (« 1-5-9-6-3 »), inchangée. Se trace au doigt ou à la souris (événements pointer),
 * ou point par point au clavier (Entrée / Espace). Comme sur un téléphone, passer en ligne droite
 * sur un point non encore pris le prend (1 → 3 passe par 2, 1 → 9 par 5).
 */
const GRID_SIZE = 3;
const POINT_POSITIONS = [];
for (let row = 0; row < GRID_SIZE; row++) {
  for (let col = 0; col < GRID_SIZE; col++) {
    POINT_POSITIONS.push({ id: row * GRID_SIZE + col + 1, row, col });
  }
}

// Design V2 : tracé brand-600, point pris brand-700 (blanc dessus : 5,9:1), anneau libre slate-500 (3:1 sur slate-50)
const BRAND_500 = '#8B5CF6';
const BRAND_600 = '#7C3AED';
const BRAND_700 = '#6D28D9';
const SLATE_500 = '#64748B';

// Saisi au clavier sans tirets (« 15963 », « 1 5 9 6 3 ») : chiffres 1 à 9, chacun une seule fois
function chiffresSansSeparateur(value) {
  const chiffres = String(value ?? '').trim().replace(/[\s,;.>→-]+/g, '');
  if (!/^[1-9]+$/.test(chiffres) || new Set(chiffres).size !== chiffres.length) return null;
  return [...chiffres].map(Number);
}

export function parsePattern(value) {
  const chiffres = chiffresSansSeparateur(value);
  if (chiffres) return chiffres;
  return String(value ?? '')
    .split('-')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= GRID_SIZE * GRID_SIZE);
}

/** Valeur enregistrée au format attendu (« 1-5-9-6-3 ») si elle est lisible sans ambiguïté, sinon inchangée. */
export function normaliserPattern(value) {
  const chiffres = chiffresSansSeparateur(value);
  return chiffres ? chiffres.join('-') : value;
}

// Point du milieu entre deux points alignés (même ligne, colonne ou diagonale), sinon null
export function pointIntermediaire(a, b) {
  const A = POINT_POSITIONS[a - 1];
  const B = POINT_POSITIONS[b - 1];
  if (!A || !B || a === b) return null;
  const dr = B.row - A.row;
  const dc = B.col - A.col;
  if (dr % 2 !== 0 || dc % 2 !== 0) return null;
  return (A.row + dr / 2) * GRID_SIZE + (A.col + dc / 2) + 1;
}

/** Tracé complété des points traversés (comme Android), sans doublon. */
export function ajouterPoint(sequence, id) {
  if (sequence.includes(id)) return sequence;
  const next = [...sequence];
  if (next.length) {
    const milieu = pointIntermediaire(next[next.length - 1], id);
    if (milieu && !next.includes(milieu)) next.push(milieu);
  }
  next.push(id);
  return next;
}

export default function PatternGrid({
  value, onChange, readOnly = false, size = 160, label = 'Schéma de déverrouillage',
}) {
  const [sequence, setSequence] = useState(() => parsePattern(value));
  const seqRef = useRef(sequence);
  const drawingRef = useRef(false);
  const svgRef = useRef(null);
  const uid = useId();
  const descId = `${uid}-desc`;

  // Valeur pilotée par le parent (vidée quand on change de tuile dans ChoixCodeAcces)
  useEffect(() => {
    const externe = parsePattern(value);
    if (externe.join('-') !== seqRef.current.join('-')) {
      seqRef.current = externe;
      setSequence(externe);
    }
  }, [value]);

  const padding = Math.round(size * 0.16);
  const gap = (size - padding * 2) / (GRID_SIZE - 1);
  // Zone de contact : 44 px minimum, jamais au-delà de la moitié de l'écart entre deux points
  const hitRadius = Math.min(Math.max(22, gap * 0.45), 60);
  const rayonLibre = Math.max(8, Math.round(size * 0.045));
  const rayonPris = Math.max(12, Math.round(size * 0.065));
  const epaisseur = Math.max(3, Math.round(size / 60));
  const policeNumero = Math.max(12, Math.round(size * 0.055));

  const getPos = (point) => ({ cx: padding + point.col * gap, cy: padding + point.row * gap });

  const commit = useCallback((next) => {
    seqRef.current = next;
    setSequence(next);
    onChange?.(next.join('-'));
  }, [onChange]);

  const prendre = useCallback((pointId) => {
    if (readOnly) return;
    const next = ajouterPoint(seqRef.current, pointId);
    if (next !== seqRef.current) commit(next);
  }, [readOnly, commit]);

  const handleClear = () => commit([]);

  // Point sous le doigt / la souris
  const getPointAtPosition = useCallback((clientX, clientY) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (const point of POINT_POSITIONS) {
      const pos = getPos(point);
      const dx = x - pos.cx;
      const dy = y - pos.cy;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) return point.id;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gap, padding, hitRadius]);

  const handlePointerDown = useCallback((e) => {
    if (readOnly) return;
    e.preventDefault();
    drawingRef.current = true;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* pointeur déjà parti */ }
    const id = getPointAtPosition(e.clientX, e.clientY);
    if (id) prendre(id);
  }, [readOnly, getPointAtPosition, prendre]);

  const handlePointerMove = useCallback((e) => {
    if (readOnly || !drawingRef.current) return;
    e.preventDefault();
    const id = getPointAtPosition(e.clientX, e.clientY);
    if (id) prendre(id);
  }, [readOnly, getPointAtPosition, prendre]);

  const handlePointerUp = useCallback((e) => {
    drawingRef.current = false;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* déjà relâché */ }
  }, []);

  const handleKey = (e, pointId) => {
    if (readOnly) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      prendre(pointId);
    }
  };

  const lines = [];
  for (let i = 1; i < sequence.length; i++) {
    const from = POINT_POSITIONS[sequence[i - 1] - 1];
    const to = POINT_POSITIONS[sequence[i] - 1];
    if (from && to) {
      const p1 = getPos(from);
      const p2 = getPos(to);
      lines.push({ x1: p1.cx, y1: p1.cy, x2: p2.cx, y2: p2.cy, key: `${i}` });
    }
  }

  const trace = sequence.join(' → ');
  // Lecture d'une valeur qui ne se lit pas comme un tracé (« Z inversé ») : le texte saisi reste visible
  const brut = readOnly && sequence.length === 0 ? String(value ?? '').trim() : '';

  return (
    <div className="inline-flex flex-col items-center gap-2 rounded-lg bg-slate-50 p-2">
      <svg
        ref={svgRef}
        width={size}
        height={size}
        role={readOnly ? 'img' : 'group'}
        aria-label={readOnly ? `${label} : ${trace || brut || 'aucun'}` : label}
        aria-describedby={readOnly ? undefined : descId}
        className="select-none"
        style={{ touchAction: readOnly ? 'auto' : 'none' }}
        onPointerDown={readOnly ? undefined : handlePointerDown}
        onPointerMove={readOnly ? undefined : handlePointerMove}
        onPointerUp={readOnly ? undefined : handlePointerUp}
        onPointerCancel={readOnly ? undefined : handlePointerUp}
      >
        {!readOnly && (
          <desc id={descId}>
            Neuf points en grille. Glissez le doigt d'un point à l'autre, ou validez les points un par un avec Entrée.
          </desc>
        )}
        {lines.map((l) => (
          <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke={BRAND_600} strokeWidth={epaisseur} strokeLinecap="round" />
        ))}
        {POINT_POSITIONS.map((point) => {
          const pos = getPos(point);
          const idx = sequence.indexOf(point.id);
          const isSelected = idx !== -1;
          const interactif = !readOnly;
          return (
            <g
              key={point.id}
              data-point={point.id}
              role={interactif ? 'button' : undefined}
              tabIndex={interactif ? 0 : undefined}
              aria-pressed={interactif ? isSelected : undefined}
              aria-label={interactif ? `Point ${point.id}${isSelected ? `, ${idx + 1}ᵉ du tracé` : ''}` : undefined}
              onClick={interactif ? () => prendre(point.id) : undefined}
              onKeyDown={interactif ? (e) => handleKey(e, point.id) : undefined}
              className={interactif ? 'group cursor-pointer focus:outline-none' : ''}
            >
              {/* Zone de contact invisible — 44 px minimum */}
              {interactif && (
                <circle cx={pos.cx} cy={pos.cy} r={hitRadius} fill="transparent" stroke="none" />
              )}
              {/* Anneau de focus clavier */}
              {interactif && (
                <circle cx={pos.cx} cy={pos.cy} r={rayonPris + 5} fill="none" stroke={BRAND_500} strokeWidth="2"
                  className="opacity-0 group-focus-visible:opacity-100" />
              )}
              <circle cx={pos.cx} cy={pos.cy} r={isSelected ? rayonPris : rayonLibre}
                fill={isSelected ? BRAND_700 : '#FFFFFF'}
                stroke={isSelected ? BRAND_700 : SLATE_500} strokeWidth="2" />
              {isSelected && (
                <text x={pos.cx} y={pos.cy + 1} textAnchor="middle" dominantBaseline="central"
                  fill="white" fontSize={policeNumero} fontWeight="bold" style={{ pointerEvents: 'none' }}>
                  {idx + 1}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {readOnly ? (
        sequence.length > 0 ? <p className="t-caption t-mono">{trace}</p>
          : brut && <p className="text-sm font-mono font-semibold text-slate-900 break-words max-w-full" aria-hidden="true">{brut}</p>
      ) : (
        <>
          <p className="t-caption t-mono min-h-4" role="status" aria-live="polite">
            {sequence.length > 0 ? `Tracé : ${trace}` : 'Aucun point tracé'}
          </p>
          {/* 44 px même quand l'écran se déclare pointer: fine (borne tactile avec souris) */}
          <button type="button" onClick={handleClear} disabled={sequence.length === 0}
            className="btn-secondary min-h-11">
            Effacer
          </button>
        </>
      )}
    </div>
  );
}
