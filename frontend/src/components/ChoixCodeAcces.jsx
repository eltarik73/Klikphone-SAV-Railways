import { useId, useRef, useState } from 'react';
import { KeyRound, Grip, LockOpen, Eye, EyeOff, Check } from 'lucide-react';
import PatternGrid from './PatternGrid';

/**
 * Code d'accès de l'appareil, en trois tuiles exclusives : « Code à chiffres », « Schéma »,
 * « Pas de code ». Une seule saisie visible à la fois ; changer de tuile vide l'autre valeur,
 * « Pas de code » vide tout. Utilisé par la borne (/client), le dépôt comptoir (/depot) et le
 * dépôt à distance (/deposer).
 *
 * Props : pin, pattern (valeurs), mode ('code' | 'schema' | 'aucun' | null, facultatif : déduit
 * de pin/pattern sinon), onChange({ pin, pattern, mode }), taille 'borne' | 'compact',
 * purgeJours (durée de conservation affichée), error (message sous les tuiles), idPrefix.
 */
export const MODES_ACCES = ['code', 'schema', 'aucun'];

const TUILES = [
  { id: 'code', Icone: KeyRound, titre: 'Code à chiffres', sousTitre: 'les chiffres que vous tapez pour déverrouiller, ex. 1234' },
  { id: 'schema', Icone: Grip, titre: 'Schéma', sousTitre: 'le dessin que vous tracez avec le doigt' },
  { id: 'aucun', Icone: LockOpen, titre: 'Pas de code', sousTitre: "l'appareil s'ouvre sans code" },
];

/**
 * Mode effectif : celui donné (`mode`, ou `acces_mode` d'un formulaire de borne), sinon déduit
 * des valeurs (schéma avant code), sinon null.
 */
export function modeAcces({ pin, pattern, mode, acces_mode } = {}) {
  const m = mode ?? acces_mode;
  if (m && MODES_ACCES.includes(m)) return m;
  if (String(pattern ?? '').trim()) return 'schema';
  if (String(pin ?? '').trim()) return 'code';
  return null;
}

/** Résumé lisible pour l'écran de vérification (le code n'est jamais affiché en clair). */
export function resumeAcces(valeurs = {}) {
  const { pin, pattern } = valeurs;
  const m = modeAcces(valeurs);
  if (m === 'aucun') return 'Pas de code : l’appareil s’ouvre sans code';
  if (m === 'schema') {
    const n = String(pattern ?? '').split('-').filter(Boolean).length;
    return n ? `Schéma de ${n} point${n > 1 ? 's' : ''}` : 'Schéma non tracé';
  }
  if (m === 'code') {
    const n = String(pin ?? '').trim().length;
    return n ? `Code de ${n} caractère${n > 1 ? 's' : ''} (masqué)` : 'Code non saisi';
  }
  return 'Non renseigné';
}

/** Erreur de saisie à afficher avant de passer à l'étape suivante, ou null. */
export function erreurAcces(valeurs = {}) {
  const { pin, pattern } = valeurs;
  const m = modeAcces(valeurs);
  if (!m) return 'Dites-nous comment s’ouvre votre appareil : code, schéma ou pas de code.';
  if (m === 'code' && !String(pin ?? '').trim()) return 'Saisissez votre code, ou choisissez « Pas de code ».';
  if (m === 'schema' && !String(pattern ?? '').trim()) return 'Tracez votre schéma, ou choisissez « Pas de code ».';
  return null;
}

export default function ChoixCodeAcces({
  pin = '', pattern = '', mode, onChange, taille = 'borne', purgeJours = 30, error, idPrefix,
}) {
  const uid = useId();
  const prefix = idPrefix || `acces-${uid}`;
  const [modeLocal, setModeLocal] = useState(() => modeAcces({ pin, pattern }));
  const [visible, setVisible] = useState(false);
  const tuilesRef = useRef([]);
  const borne = taille === 'borne';
  // Piloté par le parent si `mode` est fourni (même null), sinon état interne
  const courant = mode !== undefined ? modeAcces({ pin, pattern, mode }) : modeLocal;

  const emettre = (m, valeurs = {}) => {
    setModeLocal(m);
    onChange?.({
      mode: m,
      pin: m === 'code' ? (valeurs.pin ?? pin) : '',
      pattern: m === 'schema' ? (valeurs.pattern ?? pattern) : '',
    });
  };

  const choisir = (m) => {
    if (m === courant) return;
    setVisible(false);
    // Changer de tuile vide l'autre valeur ; « Pas de code » vide tout
    emettre(m, { pin: '', pattern: '' });
  };

  // Groupe radio : flèches pour passer d'une tuile à l'autre
  const surTouche = (e, index) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const suivant = (index + delta + TUILES.length) % TUILES.length;
    tuilesRef.current[suivant]?.focus();
    choisir(TUILES[suivant].id);
  };

  const indexFocusable = Math.max(0, TUILES.findIndex((t) => t.id === courant));
  const labelId = `${prefix}-label`;
  const aideId = `${prefix}-aide`;
  const erreurId = `${prefix}-erreur`;
  const pinId = `${prefix}-pin`;
  const pinAideId = `${prefix}-pin-aide`;

  return (
    <div className="space-y-4">
      <div>
        <p id={labelId} className={`font-semibold text-slate-900 ${borne ? 'text-base' : 'text-sm'}`}>
          Pour déverrouiller votre appareil, vous utilisez :
        </p>
        <span id={aideId} className={`block mt-1 text-slate-600 ${borne ? 'text-base' : 'text-sm'}`}>
          Nous en avons besoin pour tester votre appareil après la réparation.
          Il est effacé {purgeJours} jours après la remise.
        </span>
      </div>

      <div role="radiogroup" aria-labelledby={labelId} aria-describedby={error ? `${aideId} ${erreurId}` : aideId}
        className={`grid gap-3 ${borne ? 'sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'}`}>
        {TUILES.map(({ id, Icone, titre, sousTitre }, index) => {
          const actif = courant === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={actif}
              tabIndex={index === indexFocusable ? 0 : -1}
              ref={(el) => { tuilesRef.current[index] = el; }}
              onClick={() => choisir(id)}
              onKeyDown={(e) => surTouche(e, index)}
              className={`relative flex items-center gap-3 text-left rounded-xl border-2 transition-colors duration-150
                focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
                ${borne ? 'min-h-[88px] px-4 py-3 sm:flex-col sm:items-start sm:gap-2 sm:px-4 sm:py-4' : 'min-h-14 px-3 py-2.5'}
                ${actif
                  ? 'border-brand-600 bg-brand-50 text-brand-800'
                  : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'}`}
            >
              <span className={`flex items-center justify-center rounded-lg shrink-0 ${
                actif ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
              } ${borne ? 'w-11 h-11' : 'w-9 h-9'}`} aria-hidden="true">
                <Icone className={borne ? 'w-6 h-6' : 'w-5 h-5'} />
              </span>
              <span className="min-w-0">
                <span className={`block font-semibold leading-snug ${borne ? 'text-base' : 'text-sm'}`}>{titre}</span>
                <span className={`block mt-0.5 leading-snug ${actif ? 'text-brand-700' : 'text-slate-600'} ${borne ? 'text-sm' : 'text-xs'}`}>
                  {sousTitre}
                </span>
              </span>
              {actif && (
                <Check className={`absolute top-2 right-2 text-brand-600 ${borne ? 'w-5 h-5' : 'w-4 h-4'}`} aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <div id={erreurId} role="alert" className="input-error text-sm">{error}</div>
      )}

      {courant === 'code' && (
        <div className="animate-in">
          <label htmlFor={pinId} className="input-label">Votre code</label>
          <div className="flex items-stretch gap-2">
            <input
              id={pinId}
              type={visible ? 'text' : 'password'}
              inputMode="numeric"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={pin}
              onChange={(e) => emettre('code', { pin: e.target.value })}
              aria-describedby={pinAideId}
              placeholder="1234"
              className="input flex-1 min-w-0 text-center font-mono"
              style={{ fontSize: borne ? '24px' : '18px', letterSpacing: '0.25em' }}
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              aria-pressed={visible}
              aria-label={visible ? 'Masquer le code' : 'Afficher le code'}
              className={`btn-secondary btn-icon shrink-0 ${borne ? 'w-14 h-14 min-w-14' : 'btn-lg'}`}
            >
              {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </div>
          <span id={pinAideId} className={`input-help block ${borne ? 'text-sm' : ''}`}>
            Tapez-le comme sur votre appareil. Les lettres sont acceptées si votre code en contient.
          </span>
        </div>
      )}

      {courant === 'schema' && (
        <div className="animate-in text-center">
          <p className={`font-medium text-slate-800 mb-2 ${borne ? 'text-base' : 'text-sm'}`}>
            Tracez votre schéma comme sur votre téléphone
          </p>
          <div className="flex justify-center">
            <PatternGrid
              value={pattern}
              onChange={(val) => emettre('schema', { pattern: val })}
              size={borne ? 264 : 200}
            />
          </div>
        </div>
      )}

      {courant === 'aucun' && (
        <div className="callout callout-success animate-in">
          <LockOpen aria-hidden="true" />
          <span>Rien à saisir : votre appareil s'ouvre sans code.</span>
        </div>
      )}
    </div>
  );
}
