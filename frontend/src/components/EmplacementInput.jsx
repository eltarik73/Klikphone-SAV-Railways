import { useCallback, useEffect, useId, useRef, useState } from 'react';
import api from '../lib/api';
import { EMPLACEMENT_MAX, listeEmplacements, normaliserEmplacement } from '../lib/etagere';
import { Check, Loader2, MapPin, X } from 'lucide-react';

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

/**
 * Paramètres de l'étagère (GET /api/etagere/config, en cache 5 min dans l'ApiClient).
 * null tant qu'ils ne sont pas connus ou s'ils sont illisibles : pas de boutons rapides.
 */
export function useEtagereConfig({ skip = false } = {}) {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    if (skip) return undefined;
    let vivant = true;
    // Erreur synchrone comprise (client d'API simulé, ancien serveur) : aucun bouton rapide
    Promise.resolve()
      .then(() => api.getEtagereConfig())
      .then((c) => { if (vivant) setConfig(c || null); })
      .catch(() => { if (vivant) setConfig(null); });
    return () => { vivant = false; };
  }, [skip]);
  return config;
}

/**
 * Emplacement physique de l'appareil (« B3 », « ÉTAGÈRE 2 ») : champ court et boutons des
 * emplacements configurés (ETAGERE_EMPLACEMENTS), enregistrés tout de suite
 * (PUT /api/etagere/{id}/emplacement). `compact` : grosse étiquette qui s'ouvre au clic.
 * `emplacements` : liste déjà chargée par le parent (sinon lue dans /api/etagere/config).
 */
export default function EmplacementInput({
  ticketId, value, onSaved, compact = false, emplacements, label = 'Emplacement', className = '',
}) {
  const uid = useId();
  const inputId = `${uid}-input`;
  const statutId = `${uid}-statut`;
  const editeurId = `${uid}-editeur`;
  const config = useEtagereConfig({ skip: Array.isArray(emplacements) });
  const propositions = Array.isArray(emplacements) ? listeEmplacements({ emplacements }) : listeEmplacements(config);

  const actuel = normaliserEmplacement(value);
  const [ouvert, setOuvert] = useState(false);
  const [brouillon, setBrouillon] = useState(actuel || '');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [annonce, setAnnonce] = useState('');

  // Dernière valeur demandée (enregistrée ou en cours) : la sortie du bloc ne la renvoie pas
  const voulueRef = useRef(actuel);

  // Valeur venue du parent (autre poste, rechargement) : le champ suit tant qu'on n'y écrit pas
  const [valeurVue, setValeurVue] = useState(actuel);
  if (actuel !== valeurVue) {
    setValeurVue(actuel);
    voulueRef.current = actuel;
    if (!ouvert) setBrouillon(actuel || '');
  }

  const racineRef = useRef(null);
  const champRef = useRef(null);
  const etiquetteRef = useRef(null);
  const fileRef = useRef(Promise.resolve());
  const dernierRef = useRef(actuel);
  dernierRef.current = actuel;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const fermer = useCallback((rendreFocus = true) => {
    setOuvert(false);
    if (rendreFocus) requestAnimationFrame(() => etiquetteRef.current?.focus());
  }, []);

  // Enregistrements en file : un clic sur un bouton juste après la saisie part après elle
  const enregistrer = useCallback((brut, { fermerApres = true } = {}) => {
    const cible = normaliserEmplacement(brut);
    voulueRef.current = cible;
    setBrouillon(cible || '');
    fileRef.current = fileRef.current.then(async () => {
      if (cible === dernierRef.current) {
        setBrouillon(cible || '');
        if (fermerApres && compact) fermer();
        return;
      }
      setEnCours(true);
      setErreur(null);
      try {
        const res = await api.setEmplacement(ticketId, cible);
        const garde = res && Object.prototype.hasOwnProperty.call(res, 'emplacement')
          ? normaliserEmplacement(res.emplacement) : cible;
        dernierRef.current = garde;
        setBrouillon(garde || '');
        setAnnonce(garde ? `Rangé en ${garde}` : 'Emplacement retiré');
        onSavedRef.current?.(garde);
        if (fermerApres && compact) fermer();
      } catch (err) {
        voulueRef.current = dernierRef.current;
        setErreur(err?.message || 'Enregistrement impossible');
      } finally {
        setEnCours(false);
      }
    });
    return fileRef.current;
  }, [ticketId, compact, fermer]);

  useEffect(() => {
    if (!annonce) return undefined;
    const t = setTimeout(() => setAnnonce(''), 4000);
    return () => clearTimeout(t);
  }, [annonce]);

  // Étiquette compacte : focus dans le champ à l'ouverture, clic à l'extérieur = enregistrer et fermer
  useEffect(() => {
    if (!compact || !ouvert) return undefined;
    champRef.current?.focus();
    champRef.current?.select();
    const dehors = (e) => {
      if (racineRef.current && !racineRef.current.contains(e.target)) {
        enregistrer(champRef.current?.value ?? '', { fermerApres: false });
        fermer(false);
      }
    };
    document.addEventListener('pointerdown', dehors);
    return () => document.removeEventListener('pointerdown', dehors);
  }, [compact, ouvert, enregistrer, fermer]);

  const surTouche = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      enregistrer(brouillon);
    } else if (e.key === 'Escape' && !compact && brouillon !== (actuel || '')) {
      e.preventDefault();
      e.stopPropagation();
      setBrouillon(actuel || '');
      setErreur(null);
    }
  };

  // Sortie du bloc entier (pas du champ vers un bouton rapide) : la saisie en attente est enregistrée
  const surSortie = (e) => {
    if (racineRef.current?.contains(e.relatedTarget)) return;
    const saisie = champRef.current ? champRef.current.value : brouillon;
    if (normaliserEmplacement(saisie) !== voulueRef.current) enregistrer(saisie);
  };

  // Safari et Firefox (Mac) ne donnent pas le focus au bouton cliqué : sans cela, le champ
  // perdrait le focus sans relatedTarget et enregistrerait la saisie avant la valeur du bouton
  const garderFocus = (e) => {
    if (racineRef.current?.contains(document.activeElement)) e.preventDefault();
  };

  // Région annoncée toujours montée (l'éditeur compact se ferme dès l'enregistrement)
  const statut = (
    <p id={statutId} role="status" aria-live="polite"
      className={compact ? 'sr-only' : `min-h-[1rem] text-xs ${erreur ? 'font-semibold text-red-700' : 'text-emerald-800'}`}>
      {erreur ? `Non enregistré : ${erreur}` : annonce}
    </p>
  );

  const editeur = (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label htmlFor={inputId} className={compact ? 'sr-only' : 'shrink-0 text-sm font-semibold text-slate-800'}>
          {label}
        </label>
        <div className="relative min-w-0 flex-1">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            ref={champRef}
            id={inputId}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={EMPLACEMENT_MAX}
            value={brouillon}
            placeholder="ex. B3"
            aria-describedby={statutId}
            aria-invalid={erreur ? true : undefined}
            onChange={(e) => { setBrouillon(e.target.value.toUpperCase()); setErreur(null); }}
            onKeyDown={surTouche}
            className={`h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 font-mono text-base font-bold uppercase tracking-wide text-slate-900 placeholder:font-sans placeholder:font-normal placeholder:normal-case placeholder:text-slate-500 ${FOCUS_RING}`}
          />
        </div>
        {compact && (
          <button type="button" onClick={() => enregistrer(brouillon)} disabled={enCours}
            aria-label="Enregistrer l’emplacement"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60 ${FOCUS_RING} focus-visible:ring-offset-2`}>
            {enCours
              ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
              : <Check className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
      </div>
      {(propositions.length > 0 || actuel) && (
        <div role="group" aria-label="Emplacements proposés" className="flex flex-wrap gap-1.5">
          {propositions.map((e) => (
            <button key={e} type="button" aria-pressed={actuel === e} disabled={enCours}
              onMouseDown={garderFocus} onClick={() => enregistrer(e)}
              className={`min-h-[44px] min-w-[44px] rounded-lg border px-3 font-mono text-sm font-bold disabled:opacity-60 ${FOCUS_RING} ${
                actuel === e
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-slate-300 bg-white text-slate-800 hover:border-brand-400 hover:bg-brand-50'
              }`}>
              {e}
            </button>
          ))}
          {actuel && (
            <button type="button" disabled={enCours} onMouseDown={garderFocus} onClick={() => enregistrer(null)}
              aria-label={`Retirer l’emplacement ${actuel}`}
              className={`inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 ${FOCUS_RING}`}>
              <X className="h-4 w-4" aria-hidden="true" /> Retirer
            </button>
          )}
        </div>
      )}
      {compact
        ? erreur && <p className="text-xs font-semibold text-red-700">Non enregistré : {erreur}</p>
        : statut}
    </div>
  );

  // Étiquette lisible de loin : plus le nom est long, plus la police est petite
  const taille = !actuel || actuel.length <= 4 ? 'text-xl' : actuel.length <= 7 ? 'text-base' : 'text-xs';

  if (!compact) {
    return (
      <div ref={racineRef} role="group" aria-label={label} aria-busy={enCours} onBlur={surSortie} className={className}>
        {editeur}
      </div>
    );
  }

  return (
    <div ref={racineRef} className={`relative shrink-0 ${className}`}>
      <button
        ref={etiquetteRef}
        type="button"
        onClick={() => {
          if (ouvert) { enregistrer(brouillon); return; }
          setBrouillon(actuel || '');
          setErreur(null);
          setOuvert(true);
        }}
        aria-expanded={ouvert}
        aria-controls={ouvert ? editeurId : undefined}
        aria-label={actuel ? `Emplacement ${actuel}, modifier` : 'Emplacement non renseigné, ranger l’appareil'}
        title={actuel && actuel.length > 8 ? actuel : undefined}
        className={`flex h-12 w-full min-w-[4.5rem] items-center justify-center gap-1 rounded-xl px-2 ${FOCUS_RING} focus-visible:ring-offset-2 ${
          actuel
            ? `bg-slate-900 font-mono font-black tracking-wide text-white hover:bg-slate-800 ${taille}`
            : 'border-2 border-dashed border-slate-400 bg-white text-xs font-semibold text-slate-700 hover:border-brand-500 hover:text-brand-800'
        }`}>
        {enCours && !ouvert
          ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          : !actuel && <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        <span className="truncate" aria-hidden="true">{actuel || 'Ranger'}</span>
      </button>
      {ouvert && (
        <div id={editeurId} role="dialog" aria-label={`${label} de l’appareil`}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            setBrouillon(actuel || '');
            setErreur(null);
            fermer();
          }}
          className="absolute left-0 top-full z-20 mt-1.5 w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          {editeur}
        </div>
      )}
      {statut}
    </div>
  );
}
