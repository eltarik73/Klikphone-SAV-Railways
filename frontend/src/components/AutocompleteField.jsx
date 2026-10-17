import { useState, useRef, useEffect, useCallback, useId } from 'react';
import api from '../lib/api';

export default function AutocompleteField({
  label,
  placeholder,
  categorie,
  value,
  onChange,
  onSelect,
  enabled = true,
  className = '',
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapperRef = useRef(null);
  const timerRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const reactId = useId();
  const listboxId = `acfield-list-${reactId}`;
  const inputId = `acfield-input-${reactId}`;

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Cleanup pending timer + in-flight request on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.aborted = true;
    };
  }, []);

  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 1) { setSuggestions([]); setOpen(false); return; }
    // Mark any previous in-flight request as stale
    if (abortRef.current) abortRef.current.aborted = true;
    const token = { aborted: false };
    abortRef.current = token;

    setLoading(true);
    try {
      const results = await api.searchAutocomplete(categorie, q, 8);
      if (token.aborted) return;
      setSuggestions(results || []);
      setOpen((results || []).length > 0);
      setActiveIdx(-1);
    } catch (err) {
      if (token.aborted) return;
      console.warn('[AutocompleteField] search failed', err);
      setSuggestions([]);
      setOpen(false);
    } finally {
      if (!token.aborted) setLoading(false);
    }
  }, [categorie]);

  const handleChange = (e) => {
    const v = e.target.value;
    onChange(v);
    if (!enabled) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v), 200);
  };

  const handleSelect = (item) => {
    setOpen(false);
    setSuggestions([]);
    if (onSelect) onSelect(item);
  };

  const handleKeyDown = (e) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      handleSelect(suggestions[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Highlight matching text
  const highlight = (text, query) => {
    if (!query || query.length < 1) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="bg-brand-100 font-bold">{text.slice(idx, idx + query.length)}</span>
        {text.slice(idx + query.length)}
      </>
    );
  };

  const renderSuggestion = (item, idx) => {
    const isActive = idx === activeIdx;
    // Options 44 px, active en brand-50 (design V2)
    const base = `min-h-11 px-3 py-2 cursor-pointer text-sm transition-colors duration-150 ${isActive ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50 text-slate-700'}`;
    const optionId = `${listboxId}-opt-${idx}`;

    if (categorie === 'client') {
      const initials = `${(item.prenom || '')[0] || ''}${(item.nom || '')[0] || ''}`.toUpperCase();
      return (
        <div
          key={item.id || idx}
          id={optionId}
          role="option"
          aria-selected={isActive}
          className={`${base} flex items-center gap-2.5`}
          onMouseDown={() => handleSelect(item)}
        >
          <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{highlight(`${item.prenom || ''} ${item.nom || ''}`.trim(), value)}</div>
            <div className="text-xs text-slate-500 tabular-nums">{item.telephone}</div>
          </div>
        </div>
      );
    }

    // panne / detail_panne / modele
    return (
      <div
        key={(item.value || '') + idx}
        id={optionId}
        role="option"
        aria-selected={isActive}
        className={`${base} flex items-center justify-between gap-2`}
        onMouseDown={() => handleSelect(item)}
      >
        <span className="truncate">{highlight(item.value || '', value)}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {item.marque && <span className="badge badge-sm badge-neutral">{item.marque}</span>}
          {item.count > 1 && <span className="badge badge-sm badge-warning tabular-nums">{item.count}x</span>}
        </div>
      </div>
    );
  };

  const activeDescendant = open && activeIdx >= 0 ? `${listboxId}-opt-${activeIdx}` : undefined;

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {label && <label htmlFor={inputId} className="input-label">{label}</label>}
      <div className="relative">
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          value={value || ''}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (enabled && suggestions.length > 0) setOpen(true); }}
          placeholder={placeholder}
          className="input w-full"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendant}
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2" aria-hidden="true">
            <div className="w-4 h-4 border-2 border-brand-600 border-t-transparent rounded-full motion-safe:animate-spin" />
          </div>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden max-h-64 overflow-y-auto"
        >
          {suggestions.map((item, idx) => renderSuggestion(item, idx))}
        </div>
      )}
    </div>
  );
}
