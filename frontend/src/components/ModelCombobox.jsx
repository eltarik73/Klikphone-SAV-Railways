import { useState, useRef, useEffect, useLayoutEffect, useId, useMemo } from 'react';
import { Search, X, Check, PencilLine, List, Loader2 } from 'lucide-react';
import { searchModeles, groupByAnnee, estDansCatalogue, normKey, trouverExact } from '../lib/catalog';

const SEARCH_LIMIT = 60;
// En dessous de cette hauteur visible sous le champ (clavier iPad ouvert), on remonte le champ
const LIST_MIN_VISIBLE = 240;
// Plancher : un résultat + l'option « pas dans la liste »
const LIST_FLOOR = 88;

/**
 * Sélecteur de modèle avec recherche locale (combobox ARIA 1.2 + listbox).
 * - `modeles` : [{ m, a }] tel que renvoyé par useCatalog().modelesDe(marque)
 * - `onChange(texte, { libre })` : libre = true pour une saisie hors catalogue
 * - liste vide → simple champ texte (saisie libre)
 * - `commitOnClose` : une recherche non choisie est gardée telle quelle en saisie libre à la fermeture
 *   (back-office) ; sinon elle reste en attente de sélection (bornes : données propres)
 */
export default function ModelCombobox({
  marque = '',
  modeles = [],
  value = '',
  onChange,
  allowFree = true,
  commitOnClose = false,
  required = false,
  label,
  id,
  placeholder,
  disabled = false,
  loading = false,
  error,
  className = '',
}) {
  const autoId = useId();
  const inputId = id || `modele-${autoId}`;
  const listboxId = `${inputId}-listbox`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const optId = (i) => `${inputId}-opt-${i}`;

  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const focusAfterRender = useRef(false);
  const scrolledRef = useRef(false);
  const [listMax, setListMax] = useState(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState(-1);
  // null = automatique (libre si la valeur est hors catalogue), true/false = choix explicite
  const [modeLibre, setModeLibre] = useState(null);

  const list = Array.isArray(modeles) ? modeles : [];
  const hasCatalog = list.length > 0;
  const texte = value || '';
  const libre = !hasCatalog || (modeLibre ?? (!!texte.trim() && !estDansCatalogue(list, texte)));

  // Nouvelle marque → on repart en mode liste
  const prevMarque = useRef(marque);
  useEffect(() => {
    if (prevMarque.current === marque) return;
    prevMarque.current = marque;
    setModeLibre(null);
    setOpen(false);
    setEditing(false);
    setQuery('');
    setActive(-1);
  }, [marque]);

  useEffect(() => {
    if (focusAfterRender.current) {
      focusAfterRender.current = false;
      inputRef.current?.focus();
    }
  });

  const q = editing ? query : '';
  const hasQuery = !!normKey(q);
  const flat = useMemo(
    () => (hasQuery ? searchModeles(list, marque, q, SEARCH_LIMIT) : list),
    [list, marque, q, hasQuery],
  );
  const groups = useMemo(() => {
    if (hasQuery) return null;
    const g = groupByAnnee(flat);
    return g.length > 1 || (g.length === 1 && g[0].annee !== null) ? g : null;
  }, [flat, hasQuery]);
  const freeIndex = allowFree ? flat.length : -1;
  const optionCount = flat.length + (allowFree ? 1 : 0);

  // Option active par défaut : 1er résultat pendant la recherche, valeur courante sinon
  useEffect(() => {
    if (!open) return;
    if (hasQuery) setActive(flat.length ? 0 : freeIndex);
    else setActive(texte ? flat.findIndex((x) => x.m === texte) : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q]);

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optId(active))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const resetSearch = () => {
    setEditing(false);
    setQuery('');
    setActive(-1);
  };

  // Fermeture : une saisie identique à un modèle du catalogue est validée d'office
  const close = () => {
    setOpen(false);
    if (!editing) return;
    const saisie = query.trim();
    if (!normKey(saisie)) { resetSearch(); return; }
    const exact = trouverExact(list, marque, saisie);
    if (exact) {
      onChange?.(exact.m, { libre: false });
      resetSearch();
    } else if (commitOnClose && allowFree) {
      setModeLibre(true);
      if (saisie !== texte) onChange?.(saisie, { libre: true });
      resetSearch();
    }
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) closeRef.current();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [open]);

  // Liste bornée à la zone visible sous le champ : sur iPad, le clavier virtuel ne réduit pas
  // le layout viewport (seul visualViewport le reflète) et cacherait « pas dans la liste ».
  useLayoutEffect(() => {
    if (!open) { scrolledRef.current = false; return undefined; }
    const vv = window.visualViewport;
    let frame = 0;
    const mesurer = () => {
      frame = 0;
      const el = inputRef.current;
      if (!el) return;
      const bas = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const espace = Math.floor(bas - el.getBoundingClientRect().bottom - 12);
      if (espace < LIST_MIN_VISIBLE && !scrolledRef.current) {
        // Une seule fois par ouverture, pour ne pas lutter contre le défilement de l'utilisateur
        scrolledRef.current = true;
        wrapperRef.current?.scrollIntoView?.({ block: 'start' });
        planifier();
        return;
      }
      setListMax(Math.max(espace, LIST_FLOOR));
    };
    const planifier = () => { if (!frame) frame = requestAnimationFrame(mesurer); };
    mesurer();
    vv?.addEventListener('resize', planifier);
    vv?.addEventListener('scroll', planifier);
    window.addEventListener('resize', planifier);
    document.addEventListener('scroll', planifier, { capture: true, passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv?.removeEventListener('resize', planifier);
      vv?.removeEventListener('scroll', planifier);
      window.removeEventListener('resize', planifier);
      document.removeEventListener('scroll', planifier, { capture: true });
    };
  }, [open]);

  const passerEnLibre = () => {
    const saisie = editing && query.trim() ? query.trim() : texte;
    setModeLibre(true);
    setOpen(false);
    resetSearch();
    onChange?.(saisie, { libre: true });
    focusAfterRender.current = true;
  };

  const revenirALaListe = () => {
    setModeLibre(false);
    setQuery(texte);
    setEditing(!!texte.trim());
    setOpen(true);
    focusAfterRender.current = true;
  };

  const choose = (index) => {
    if (allowFree && index === freeIndex) { passerEnLibre(); return; }
    const item = flat[index];
    if (!item) return;
    onChange?.(item.m, { libre: false });
    setOpen(false);
    resetSearch();
  };

  const clear = () => {
    onChange?.('', { libre: false });
    resetSearch();
    setOpen(true);
    focusAfterRender.current = true;
  };

  const handleInput = (e) => {
    const v = e.target.value;
    setQuery(v);
    setEditing(true);
    setOpen(true);
    if (!v.trim() && texte) onChange?.('', { libre: false });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (!optionCount) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i < 0 ? (step > 0 ? 0 : optionCount - 1) : (i + step + optionCount) % optionCount));
    } else if (e.key === 'Enter') {
      if (open && active >= 0) {
        e.preventDefault();
        choose(active);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        resetSearch();
      }
    }
  };

  const errorClass = error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' : '';
  const describedBy = [error ? errorId : null, hintId].filter(Boolean).join(' ');
  const labelEl = label ? (
    <label htmlFor={inputId} className="input-label">
      {label}{required ? ' *' : ''}
    </label>
  ) : null;

  // ─── Chargement : champ lecture seule, la valeur reste visible ───
  if (loading && !hasCatalog) {
    return (
      <div className={className}>
        {labelEl}
        <div className="relative">
          <input
            id={inputId}
            value={texte}
            readOnly
            aria-busy="true"
            placeholder="Chargement des modèles…"
            className="input text-base !pr-12 bg-slate-50 motion-reduce:transition-none"
          />
          <span className="absolute right-0 inset-y-0 w-11 flex items-center justify-center" aria-hidden="true">
            <Loader2 className="w-4 h-4 text-brand-600 motion-safe:animate-spin" />
          </span>
        </div>
        <p id={hintId} className="sr-only" aria-live="polite">Chargement des modèles</p>
      </div>
    );
  }

  // ─── Saisie libre ───
  if (libre) {
    return (
      <div className={className}>
        {labelEl}
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          value={texte}
          onChange={(e) => {
            // Mode figé dès la 1re frappe : sinon un texte qui (re)devient un modèle du catalogue
            // recrée le champ en combobox (focus et clavier perdus)
            if (hasCatalog && modeLibre === null) setModeLibre(true);
            onChange?.(e.target.value, { libre: true });
          }}
          disabled={disabled}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          placeholder={placeholder || 'Saisissez le modèle exact'}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className={`input text-base motion-reduce:transition-none disabled:bg-slate-50 disabled:cursor-not-allowed ${errorClass}`}
        />
        {error && <p id={errorId} className="input-error" role="alert">{error}</p>}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
          <p id={hintId} className="text-xs text-slate-500">
            {hasCatalog ? 'Saisie libre : indiquez le modèle tel qu\'écrit sur l\'appareil.' : 'Indiquez le modèle tel qu\'écrit sur l\'appareil.'}
          </p>
          {hasCatalog && !disabled && (
            <button
              type="button"
              onClick={revenirALaListe}
              className="btn-ghost btn-sm -mr-3 text-brand-700 hover:bg-brand-50 hover:text-brand-800"
            >
              <List className="w-4 h-4" aria-hidden="true" /> Choisir dans la liste
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Recherche dans le catalogue ───
  const renderOption = (item, index) => {
    const isActive = index === active;
    const isCurrent = item.m === texte;
    return (
      <div
        key={`${item.m}-${index}`}
        id={optId(index)}
        role="option"
        aria-selected={isActive}
        onClick={() => choose(index)}
        onMouseMove={() => { if (active !== index) setActive(index); }}
        className={`flex items-center gap-3 min-h-11 px-3 py-2 cursor-pointer text-base lg:text-sm motion-safe:transition-colors
          ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-800'}`}
      >
        <span className={`flex-1 min-w-0 truncate ${isCurrent ? 'font-semibold' : ''}`}>{item.m}</span>
        {hasQuery && item.a && <span className="text-xs text-slate-500 tabular-nums shrink-0">{item.a}</span>}
        {isCurrent && <Check className="w-4 h-4 text-brand-600 shrink-0" aria-hidden="true" />}
      </div>
    );
  };

  let offset = 0;
  const inputValue = editing ? query : texte;
  const exemple = list[0]?.m;
  const pending = !open && editing && !!query.trim();

  return (
    <div ref={wrapperRef} className={`relative scroll-mt-16 ${className}`}>
      {labelEl}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" aria-hidden="true" />
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          value={inputValue}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={(e) => { setOpen(true); if (texte && !editing) e.target.select(); }}
          onClick={() => { if (!open) setOpen(true); }}
          disabled={disabled}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
          aria-required={required || undefined}
          aria-invalid={error || pending ? true : undefined}
          aria-describedby={describedBy}
          placeholder={placeholder || (exemple ? `Ex : ${exemple}` : 'Rechercher un modèle')}
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className={`input text-base !pl-10 !pr-12 motion-reduce:transition-none disabled:bg-slate-50 disabled:cursor-not-allowed ${errorClass}`}
        />
        {(inputValue || texte) && !disabled && (
          <button
            type="button"
            onClick={clear}
            aria-label="Effacer le modèle"
            className="absolute right-0 inset-y-0 w-11 flex items-center justify-center rounded-r-lg text-slate-500 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div
        id={listboxId}
        role="listbox"
        aria-label={marque ? `Modèles ${marque}` : 'Modèles'}
        hidden={!open}
        onMouseDown={(e) => e.preventDefault()}
        style={listMax ? { '--kp-list-max': `${listMax}px` } : undefined}
        className="absolute z-50 left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-slate-200 max-h-[min(50vh,var(--kp-list-max,50vh))] sm:max-h-[min(20rem,var(--kp-list-max,20rem))] overflow-y-auto overscroll-contain scroll-pt-9 scroll-pb-12"
      >
        {open && (
          <>
            {groups
              ? groups.map((g, gi) => {
                const start = offset;
                offset += g.items.length;
                const headerId = `${listboxId}-g-${gi}`;
                return (
                  <div key={g.annee ?? 'sans-annee'} role="group" aria-labelledby={headerId}>
                    <div
                      id={headerId}
                      role="presentation"
                      className="sticky top-0 z-10 px-3 py-1.5 t-overline bg-slate-50 border-b border-slate-100"
                    >
                      {g.annee ?? 'Autres modèles'}
                    </div>
                    {g.items.map((item, i) => renderOption(item, start + i))}
                  </div>
                );
              })
              : flat.map((item, i) => renderOption(item, i))}

            {hasQuery && flat.length === 0 && (
              <div role="presentation" className="px-4 py-3 text-sm text-slate-600">
                Aucun modèle ne correspond à « {query.trim()} ».
              </div>
            )}

            {allowFree && (
              <div
                id={optId(freeIndex)}
                role="option"
                aria-selected={active === freeIndex}
                onClick={() => choose(freeIndex)}
                onMouseMove={() => { if (active !== freeIndex) setActive(freeIndex); }}
                className={`sticky bottom-0 z-10 flex items-center gap-3 min-h-11 px-3 py-2 border-t border-slate-200 cursor-pointer text-base lg:text-sm font-semibold motion-safe:transition-colors
                  ${active === freeIndex ? 'bg-brand-50 text-brand-800' : 'bg-white text-brand-700'}`}
              >
                <PencilLine className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0">Mon modèle n'est pas dans la liste</span>
              </div>
            )}
          </>
        )}
      </div>

      {error && <p id={errorId} className="input-error" role="alert">{error}</p>}
      <p id={hintId} className={`text-xs mt-1 ${pending ? 'text-amber-700' : 'text-slate-500'}`} aria-live="polite">
        {pending
          ? 'Sélectionnez votre modèle dans la liste pour le valider.'
          : open && hasQuery
            ? `${flat.length} modèle${flat.length > 1 ? 's' : ''} trouvé${flat.length > 1 ? 's' : ''}`
            : texte ? '' : 'Tapez quelques caractères, par ex. « 15 pro » ou « s24 ».'}
      </p>
    </div>
  );
}
