import { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import api from '../lib/api';

function HighlightText({ text, query }) {
  if (!query || !text) return text || '';
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} className="bg-amber-100 font-bold rounded-sm px-0.5">{part}</mark>
      : part
  );
}

function DefaultSuggestion({ suggestion, query, categorie }) {
  if (categorie === 'client') {
    return (
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center text-xs font-bold shrink-0">
          {suggestion.prenom?.[0]}{suggestion.nom?.[0]}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800 truncate">
            <HighlightText text={`${suggestion.prenom} ${suggestion.nom}`} query={query} />
          </div>
          <div className="text-[11px] text-slate-400">{suggestion.telephone}</div>
        </div>
      </div>
    );
  }

  if (categorie === 'modele') {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-slate-800 truncate">
          <HighlightText text={suggestion.value} query={query} />
        </span>
        {suggestion.marque && (
          <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
            {suggestion.marque}
          </span>
        )}
      </div>
    );
  }

  // panne / detail_panne
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-slate-800 truncate">
        <HighlightText text={suggestion.value} query={query} />
      </span>
      {suggestion.count > 1 && (
        <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
          ×{suggestion.count}
        </span>
      )}
    </div>
  );
}

export default function AutocompleteField({
  label,
  placeholder,
  categorie,
  value,
  onChange,
  onSelect,
  icon,
  renderSuggestion,
  enabled = true,
  className = '',
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Search with debounce
  const handleInputChange = useCallback((text) => {
    onChange(text);
    setHighlightIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!enabled || text.length < 1) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.searchAutocomplete(categorie, text, 8);
        setSuggestions(data);
        setIsOpen(data.length > 0);
      } catch {
        setSuggestions([]);
      }
      setLoading(false);
    }, 200);
  }, [categorie, enabled, onChange]);

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (!isOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault();
      handleSelect(suggestions[highlightIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleSelect = (suggestion) => {
    const val = suggestion.value || `${suggestion.prenom} ${suggestion.nom}`;
    onChange(val);
    onSelect?.(suggestion);
    setIsOpen(false);
    setSuggestions([]);
  };

  // If disabled, render a plain input
  if (!enabled) {
    return (
      <div>
        {label && (
          <label className="input-label">
            {icon && <span className="mr-1">{icon}</span>}
            {label}
          </label>
        )}
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`input ${className}`}
        />
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      {label && (
        <label className="input-label">
          {icon && <span className="mr-1">{icon}</span>}
          {label}
        </label>
      )}

      <div className="relative">
        <input
          type="text"
          value={value || ''}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setIsOpen(true)}
          placeholder={placeholder}
          className={`input ${isOpen ? 'ring-2 ring-blue-500 border-blue-500' : ''} ${className}`}
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
          </div>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-slate-200 shadow-lg max-h-[320px] overflow-y-auto z-20">
          {suggestions.map((s, i) => (
            <div
              key={i}
              onClick={() => handleSelect(s)}
              onMouseEnter={() => setHighlightIndex(i)}
              className={`px-3 py-2.5 cursor-pointer transition-colors ${
                i === highlightIndex ? 'bg-blue-50' : 'hover:bg-slate-50'
              } ${i < suggestions.length - 1 ? 'border-b border-slate-50' : ''}`}
            >
              {renderSuggestion
                ? renderSuggestion(s, i, value)
                : <DefaultSuggestion suggestion={s} query={value} categorie={categorie} />
              }
            </div>
          ))}
        </div>
      )}

      {/* No results */}
      {isOpen && suggestions.length === 0 && !loading && (value || '').length >= 1 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-slate-200 shadow-md px-3 py-2.5 z-20">
          <span className="text-sm text-slate-400">Aucun résultat pour "{value}"</span>
        </div>
      )}
    </div>
  );
}
