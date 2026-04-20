import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Check, Download, Share2, X, Loader2, Plus, Pencil, Trash2, RefreshCw,
  Film, Sparkles, ShieldCheck, Package2, Battery, Award, Zap, Truck,
  Instagram, Music2, Wand2,
} from 'lucide-react';
import api from '../lib/api';
import { getIPhoneImage, PLACEHOLDER_SVG } from '../utils/appleCDN';

const CONDITIONS = [
  { id: '', label: 'Tous' },
  { id: 'Neuf', label: 'Neuf' },
  { id: 'Reconditionné Premium', label: 'Premium' },
  { id: 'Reconditionné', label: 'Reconditionné' },
];

const LOADER_STEPS = [
  'Préparation des scènes…',
  'Téléchargement des photos iPhone…',
  'Rendu des frames…',
  'Encodage MP4 via ffmpeg…',
  'Ajout de la musique…',
  'Upload de la vidéo…',
];

function AppleLogo({ className = 'w-3 h-3', fill = 'currentColor' }) {
  return (
    <svg className={className} viewBox="0 0 170 170" xmlns="http://www.w3.org/2000/svg" fill={fill}>
      <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.197-2.12-9.973-3.17-14.34-3.17-4.58 0-9.492 1.05-14.746 3.17-5.262 2.13-9.501 3.24-12.742 3.35-4.929.21-9.842-1.96-14.746-6.52-3.13-2.73-7.045-7.41-11.735-14.04-5.032-7.08-9.169-15.29-12.41-24.65-3.471-10.11-5.211-19.9-5.211-29.38 0-10.86 2.346-20.23 7.045-28.08 3.693-6.303 8.606-11.275 14.755-14.925s12.793-5.51 19.948-5.629c3.915 0 9.049 1.211 15.429 3.591 6.362 2.388 10.447 3.599 12.238 3.599 1.339 0 5.877-1.416 13.57-4.239 7.275-2.618 13.415-3.702 18.445-3.275 13.63 1.1 23.87 6.473 30.68 16.153-12.19 7.386-18.22 17.731-18.1 31.002.11 10.337 3.86 18.939 11.23 25.769 3.34 3.17 7.07 5.62 11.22 7.36-.9 2.61-1.85 5.11-2.86 7.51zM119.11 7.24c0 8.102-2.96 15.667-8.86 22.669-7.12 8.324-15.732 13.134-25.071 12.375a25.222 25.222 0 0 1-.188-3.07c0-7.778 3.386-16.102 9.399-22.908 3.002-3.446 6.82-6.311 11.45-8.597 4.62-2.252 8.99-3.497 13.1-3.71.12 1.083.17 2.166.17 3.24z" />
    </svg>
  );
}

const condColor = (c) =>
  c === 'Neuf' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
  : c === 'Reconditionné Premium' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
  : 'bg-amber-500/15 text-amber-300 border-amber-500/30';

const trustBadges = (c) =>
  c === 'Neuf' ? [{ icon: Package2, label: 'Scellé Apple' }, { icon: ShieldCheck, label: 'Garantie 2 ans' }, { icon: Truck, label: 'Dispo boutique' }]
  : c === 'Reconditionné Premium' ? [{ icon: Award, label: '100% pièces Apple' }, { icon: Battery, label: 'Batterie 90%+' }, { icon: ShieldCheck, label: 'Garantie 12 mois' }]
  : [{ icon: ShieldCheck, label: '100% satisfait' }, { icon: Battery, label: 'Batterie 85%+' }, { icon: Zap, label: 'Testé 40 points' }];

const tagline = (c) =>
  c === 'Neuf' ? 'Neuf scellé · livré avec accessoires'
  : c === 'Reconditionné Premium' ? 'Comme neuf · sans rayure visible'
  : 'Reconditionné vérifié chez Klikphone';

function IphoneCard({ phone, selected, onToggle, adminMode, onEdit, onDelete }) {
  const [imgError, setImgError] = useState(false);
  const src = imgError ? PLACEHOLDER_SVG : getIPhoneImage(phone);
  const savings = (phone.old_price || 0) - phone.price;
  const badges = trustBadges(phone.condition);
  const label = phone.condition === 'Reconditionné Premium' ? 'Premium' : phone.condition;

  return (
    <div
      onClick={onToggle}
      className={`relative cursor-pointer rounded-2xl border overflow-hidden group flex flex-col transition-all duration-300 ease-out will-change-transform ${
        selected
          ? 'border-orange-500/80 ring-2 ring-orange-500/40 shadow-[0_8px_32px_-4px_rgba(232,100,26,0.35)] -translate-y-0.5'
          : 'border-white/10 hover:border-white/30 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)]'
      }`}
      style={{ backgroundColor: '#14141c' }}
    >
      <div className="pointer-events-none absolute inset-0 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-tr from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full [transition:transform_1s_ease,opacity_0.4s_ease]" />

      <div className={`absolute top-3 right-3 z-20 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all duration-200 ${
        selected ? 'bg-orange-500 border-orange-500 scale-110' : 'bg-black/50 backdrop-blur border-white/30 group-hover:border-white/60 group-hover:scale-105'
      }`}>
        {selected && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
      </div>

      <div className={`absolute top-3 left-3 z-20 text-[10px] font-bold px-2 py-1 rounded-md border uppercase tracking-wider backdrop-blur-sm ${condColor(phone.condition)}`}>
        {label}
      </div>

      {savings > 0 && (
        <div className="absolute top-12 left-3 z-20 text-[10px] font-black px-2 py-0.5 rounded-md bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/30">
          −{savings}€
        </div>
      )}

      <div className="relative h-48 sm:h-56 flex items-center justify-center p-4 sm:p-5 overflow-hidden"
        style={{ background: `radial-gradient(ellipse at center, ${phone.color_hex || '#333'}30 0%, transparent 65%)` }}>
        <img src={src} alt={phone.model} loading="lazy" onError={() => setImgError(true)}
          className="max-h-full max-w-full object-contain drop-shadow-2xl transition-transform duration-500 ease-out group-hover:scale-110 group-hover:-rotate-2" />
      </div>

      <div className="px-3 sm:px-4 pb-4 flex-1 flex flex-col">
        <div className="flex items-center gap-1.5 text-white font-bold text-[14px] sm:text-[15px] tracking-tight">
          <AppleLogo className="w-3 h-3 shrink-0" fill="white" />
          <span className="truncate">{phone.model}</span>
        </div>
        <div className="text-white/60 text-[11px] sm:text-xs mt-0.5 truncate">{phone.storage} · {phone.color_name}</div>
        <div className="text-orange-300/90 text-[10.5px] sm:text-[11px] mt-2 font-medium italic line-clamp-1">{tagline(phone.condition)}</div>

        <div className="mt-3 flex items-end gap-2">
          <div className="flex items-baseline">
            <span className="text-white font-black text-[24px] sm:text-[28px] tracking-tight leading-none">{phone.price}</span>
            <span className="text-white font-bold text-base ml-0.5">€</span>
          </div>
          {phone.old_price > phone.price && <span className="text-white/35 text-xs line-through mb-0.5">{phone.old_price}€</span>}
        </div>

        <div className="mt-3 space-y-1">
          {badges.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5 text-[10.5px] text-white/70 font-medium">
              <Icon className="w-3 h-3 text-emerald-400 shrink-0" strokeWidth={2.5} />
              <span className="truncate">{label}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
          <span className={`text-[10px] uppercase tracking-wider font-bold flex items-center gap-1 ${phone.stock > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${phone.stock > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            {phone.stock > 0 ? `Stock · ${phone.stock}` : 'Rupture'}
          </span>
          {adminMode && (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => onEdit(phone)} className="p-1.5 rounded-md bg-white/5 hover:bg-white/15 text-white/80 transition-all" title="Modifier"><Pencil className="w-3 h-3" /></button>
              <button onClick={() => onDelete(phone)} className="p-1.5 rounded-md bg-red-500/10 hover:bg-red-500/25 text-red-300 transition-all" title="Supprimer"><Trash2 className="w-3 h-3" /></button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <label className="block">
      <span className="text-[11px] text-white/60 font-semibold uppercase tracking-wider">{label}</span>
      <input type={type} value={value ?? ''} onChange={onChange} placeholder={placeholder}
        className="w-full mt-1 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-orange-500" />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-[11px] text-white/60 font-semibold uppercase tracking-wider">{label}</span>
      <select value={value} onChange={onChange} className="w-full mt-1 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-white focus:outline-none focus:border-orange-500">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function IphoneFormModal({ open, initial, onClose, onSave }) {
  const empty = { model: '', model_key: '', storage: '128GB', color_name: '', color_hex: '#333333', color_key: '', condition: 'Neuf', price: 0, old_price: null, stock: 1, image_url: '' };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm(initial ? { ...empty, ...initial } : empty); }, [open, initial]);
  if (!open) return null;

  const set = (k) => (e) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: ['price', 'old_price', 'stock'].includes(k) ? (v === '' ? null : Number(v)) : v }));
  };
  const submit = async () => {
    setSaving(true);
    try { await onSave(form); onClose(); }
    catch (err) { alert('Erreur : ' + (err.message || 'inconnue')); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 text-white rounded-2xl border border-white/10 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h3 className="font-bold text-lg">{initial ? 'Modifier' : 'Nouvel iPhone'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Modèle" value={form.model} onChange={set('model')} placeholder="iPhone 16 Pro" />
          <Field label="Model key (slug)" value={form.model_key} onChange={set('model_key')} placeholder="iphone-16-pro" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stockage" value={form.storage} onChange={set('storage')} />
            <Select label="Condition" value={form.condition} onChange={set('condition')} options={['Neuf', 'Reconditionné Premium', 'Reconditionné']} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Couleur (nom)" value={form.color_name} onChange={set('color_name')} />
            <Field label="Couleur (clé)" value={form.color_key} onChange={set('color_key')} placeholder="natural-titanium" />
          </div>
          <Field label="Couleur HEX" value={form.color_hex} onChange={set('color_hex')} placeholder="#b8a898" />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Prix (€)" type="number" value={form.price ?? ''} onChange={set('price')} />
            <Field label="Ancien prix" type="number" value={form.old_price ?? ''} onChange={set('old_price')} />
            <Field label="Stock" type="number" value={form.stock ?? 0} onChange={set('stock')} />
          </div>
          <Field label="Image URL (override)" value={form.image_url || ''} onChange={set('image_url')} placeholder="Laisse vide pour utiliser l'image locale" />
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-semibold">Annuler</button>
          <button onClick={submit} disabled={saving || !form.model || !form.model_key}
            className="px-5 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function VideoModal({ open, result, onClose, onRegenerate }) {
  const [downloading, setDownloading] = useState(false);
  if (!open || !result) return null;
  const filename = result.filename || 'klikphone-story.mp4';

  const downloadVideo = async () => {
    setDownloading(true);
    try {
      const response = await fetch(result.video_url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch { window.open(result.video_url, '_blank'); }
    finally { setDownloading(false); }
  };

  const shareLink = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Klikphone — Story iPhone', url: result.video_url }); } catch {} }
    else { await navigator.clipboard.writeText(result.video_url); alert('URL copiée dans le presse-papier'); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease]" onClick={onClose}>
      <div className="relative bg-gradient-to-b from-zinc-900 to-black text-white rounded-3xl border border-white/10 max-w-md w-full overflow-hidden shadow-2xl shadow-orange-500/10"
        onClick={(e) => e.stopPropagation()} style={{ maxHeight: '95vh' }}>
        <div className="pointer-events-none absolute -top-24 -left-24 w-64 h-64 rounded-full bg-orange-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 w-64 h-64 rounded-full bg-amber-500/10 blur-3xl" />

        <div className="relative flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/30">
              <Film className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="font-bold text-[15px] leading-tight">Ta Story est prête</div>
              <div className="text-[10.5px] text-white/50 uppercase tracking-wider font-semibold">1080 × 1920 · 9:16</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="p-2 rounded-full bg-white/5 hover:bg-white/20 active:scale-95 transition-all"><X className="w-5 h-5" /></button>
        </div>

        <div className="relative bg-black flex items-center justify-center" style={{ aspectRatio: '9/16', maxHeight: '60vh' }}>
          <video src={result.video_url} controls autoPlay loop playsInline className="w-full h-full object-contain" />
        </div>

        <div className="px-4 py-2.5 text-[11px] text-white/50 text-center flex items-center justify-center gap-3">
          <span>Durée {result.duration_seconds}s</span>
          <span className="w-1 h-1 rounded-full bg-white/30" />
          <span>Rendu en {result.render_time_s}s</span>
        </div>

        <div className="p-4 pt-1 space-y-2">
          <button onClick={downloadVideo} disabled={downloading}
            className="group relative w-full flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 disabled:opacity-60 text-white font-bold text-[15px] shadow-lg shadow-orange-500/30 hover:shadow-xl hover:shadow-orange-500/40 transition-all active:scale-[0.98]">
            {downloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            {downloading ? 'Téléchargement…' : 'Télécharger MP4'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={shareLink} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-semibold transition-all active:scale-[0.98]">
              <Share2 className="w-4 h-4" /> Partager
            </button>
            <button onClick={onRegenerate} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-semibold transition-all active:scale-[0.98]">
              <RefreshCw className="w-4 h-4" /> Rejouer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyStateSVG() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" className="mx-auto mb-4 opacity-80">
      <defs>
        <linearGradient id="phoneGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <rect x="38" y="18" width="44" height="84" rx="8" fill="url(#phoneGrad)" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
      <rect x="42" y="24" width="36" height="64" rx="3" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" strokeWidth="0.8" />
      <circle cx="60" cy="96" r="2.5" fill="rgba(255,255,255,0.3)" />
      <circle cx="60" cy="54" r="14" fill="none" stroke="rgba(249,115,22,0.5)" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M54 54 L58 58 L66 48" stroke="rgba(249,115,22,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export default function VentesIphoneStory() {
  const [phones, setPhones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [generating, setGenerating] = useState(false);
  const [videoResult, setVideoResult] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState(null);
  const [error, setError] = useState(null);
  const [loaderStep, setLoaderStep] = useState(0);
  const adminMode = false;

  useEffect(() => {
    if (!generating) { setLoaderStep(0); return; }
    const id = setInterval(() => setLoaderStep((s) => Math.min(s + 1, LOADER_STEPS.length - 1)), 1800);
    return () => clearInterval(id);
  }, [generating]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setPhones(await api.getIphones()); }
    catch (err) { setError(err.message || 'Erreur chargement'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => !filter ? phones : phones.filter((p) => p.condition === filter), [phones, filter]);
  const counts = useMemo(() => {
    const m = { '': phones.length };
    CONDITIONS.slice(1).forEach((c) => { m[c.id] = phones.filter((p) => p.condition === c.id).length; });
    return m;
  }, [phones]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (next.size >= 8) { alert('Maximum 8 iPhones par vidéo'); return prev; }
        next.add(id);
      }
      return next;
    });
  };

  const generateVideo = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setGenerating(true); setError(null);
    try { setVideoResult(await api.generateIphoneStoryVideo(ids)); }
    catch (err) { setError(err.message || 'Erreur génération vidéo'); }
    finally { setGenerating(false); }
  };

  const handleSave = async (form) => {
    if (form.id) await api.updateIphone(form.id, form);
    else await api.createIphone(form);
    await load();
  };

  const handleDelete = async (phone) => {
    if (!window.confirm(`Supprimer ${phone.model} ${phone.storage} ${phone.color_name} ?`)) return;
    try {
      await api.deleteIphone(phone.id);
      setSelected((prev) => { const next = new Set(prev); next.delete(phone.id); return next; });
      await load();
    } catch (err) { alert('Erreur : ' + err.message); }
  };

  const estimatedDuration = 1.8 + selected.size * 3.0 + 2.2;
  const progressPct = Math.round(((loaderStep + 1) / LOADER_STEPS.length) * 100);

  return (
    <div className="relative rounded-2xl overflow-hidden" style={{ backgroundColor: '#0a0a10' }}>
      <div className="pointer-events-none absolute top-0 left-0 w-full h-64 bg-gradient-to-b from-orange-500/[0.04] via-transparent to-transparent" />
      <div className="pointer-events-none absolute top-0 right-0 w-96 h-96 rounded-full bg-orange-500/[0.06] blur-3xl" />

      <div className="relative px-5 sm:px-7 py-6 sm:py-7 border-b border-white/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white flex items-center justify-center shadow-xl shrink-0">
              <AppleLogo className="w-6 h-6 sm:w-7 sm:h-7 text-black" fill="black" />
            </div>
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r from-orange-500/15 to-amber-500/15 border border-orange-500/25 mb-1.5">
                <Instagram className="w-3 h-3 text-orange-300" />
                <Music2 className="w-3 h-3 text-orange-300" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-orange-200">Stories Insta · TikTok</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-tight">Ventes iPhone</h2>
              <p className="text-[12.5px] sm:text-sm text-white/55 mt-0.5 leading-snug">Sélectionne jusqu'à 8 modèles, génère ta vidéo Story 9:16</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {adminMode && (
              <button onClick={() => { setFormInitial(null); setFormOpen(true); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/15 text-white text-xs font-bold transition-all">
                <Plus className="w-4 h-4" /> iPhone
              </button>
            )}
            <button onClick={load} className="p-2.5 rounded-xl bg-white/5 hover:bg-white/15 text-white/70 transition-all active:scale-95" title="Rafraîchir">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="relative px-5 sm:px-7 pt-5">
        <div className="inline-flex bg-white/5 rounded-2xl p-1 gap-0.5 text-xs border border-white/5 max-w-full overflow-x-auto">
          {CONDITIONS.map((c) => {
            const active = filter === c.id;
            const count = counts[c.id] ?? 0;
            return (
              <button key={c.id} onClick={() => setFilter(c.id)}
                className={`relative whitespace-nowrap px-3 sm:px-3.5 py-2 rounded-xl font-bold transition-all duration-300 flex items-center gap-1.5 ${active ? 'bg-white text-black shadow-lg' : 'text-white/60 hover:text-white'}`}>
                <span>{c.label}</span>
                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md transition-colors ${active ? 'bg-black/10 text-black/70' : 'bg-white/10 text-white/50'}`}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative px-5 sm:px-7 py-5 pb-32">
        {error && <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{error}</div>}
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-white/50" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-14 max-w-xs mx-auto">
            <EmptyStateSVG />
            <div className="text-white font-bold text-base mb-1">Aucun iPhone ici</div>
            <div className="text-white/50 text-[13px] leading-relaxed">Cette catégorie est vide. Essaie un autre filtre ou rafraîchis la liste.</div>
            <button onClick={() => setFilter('')} className="mt-4 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all">
              Voir tous les iPhones
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {filtered.map((p) => (
              <IphoneCard key={p.id} phone={p} selected={selected.has(p.id)} onToggle={() => toggleSelect(p.id)}
                adminMode={adminMode} onEdit={(ph) => { setFormInitial(ph); setFormOpen(true); }} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-30 w-[min(94vw,680px)] animate-[slideUp_0.3s_ease-out]">
          <div className="relative overflow-hidden bg-zinc-950/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl shadow-black/70 p-2.5 sm:p-3 flex items-center gap-2 sm:gap-3">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-orange-500 to-transparent" />
            <div className="shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/40 font-black text-white text-base sm:text-lg">
              {selected.size}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-[13px] sm:text-sm font-bold tracking-tight truncate">
                {selected.size}/8 iPhone{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
              </div>
              <div className="text-white/50 text-[11px] sm:text-xs flex items-center gap-1.5 mt-0.5">
                <Film className="w-3 h-3" /><span>≈ {estimatedDuration.toFixed(1)}s · 1080×1920</span>
              </div>
            </div>
            <button onClick={() => setSelected(new Set())}
              className="hidden sm:flex px-3 py-2 rounded-lg bg-white/5 hover:bg-white/15 text-white/70 text-xs font-semibold transition-all" title="Vider la sélection">
              Vider
            </button>
            <button onClick={() => setSelected(new Set())}
              className="sm:hidden p-2 rounded-lg bg-white/5 hover:bg-white/15 text-white/70 transition-all" aria-label="Vider">
              <X className="w-4 h-4" />
            </button>
            <button onClick={generateVideo} disabled={generating}
              className="relative overflow-hidden flex items-center gap-1.5 sm:gap-2 px-3.5 sm:px-5 py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 disabled:opacity-60 text-white text-[13px] sm:text-sm font-bold shadow-lg shadow-orange-500/40 transition-all active:scale-[0.97]">
              {generating
                ? <><Loader2 className="w-4 h-4 animate-spin" /><span className="hidden sm:inline">Génération…</span></>
                : <><Wand2 className="w-4 h-4" /><span>Générer</span></>}
            </button>
          </div>
        </div>
      )}

      <IphoneFormModal open={formOpen} initial={formInitial} onClose={() => setFormOpen(false)} onSave={handleSave} />
      <VideoModal open={!!videoResult} result={videoResult} onClose={() => setVideoResult(null)}
        onRegenerate={() => { setVideoResult(null); generateVideo(); }} />

      {generating && !videoResult && (
        <div className="fixed inset-0 z-40 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease]">
          <div className="relative bg-gradient-to-b from-zinc-900 to-black rounded-3xl border border-white/10 p-7 sm:p-8 max-w-sm w-full text-center shadow-2xl overflow-hidden">
            <div className="pointer-events-none absolute -top-20 -left-20 w-52 h-52 rounded-full bg-orange-500/20 blur-3xl animate-pulse" />
            <div className="pointer-events-none absolute -bottom-20 -right-20 w-52 h-52 rounded-full bg-amber-500/15 blur-3xl animate-pulse [animation-delay:1s]" />
            <div className="relative">
              <div className="relative w-20 h-20 mx-auto mb-5">
                <div className="absolute inset-0 rounded-full border-[3px] border-orange-500/15" />
                <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-orange-500 border-r-orange-500/60 animate-spin" />
                <div className="absolute inset-2 rounded-full bg-gradient-to-br from-orange-500/20 to-amber-500/10 flex items-center justify-center">
                  <Sparkles className="w-7 h-7 text-orange-400 animate-pulse" />
                </div>
              </div>
              <div className="text-white font-bold text-lg mb-1 tracking-tight">Génération en cours</div>
              <div className="text-orange-400 text-[13px] font-semibold min-h-[20px] transition-all duration-300">{LOADER_STEPS[loaderStep]}</div>
              <div className="mt-5 h-1.5 rounded-full bg-white/5 overflow-hidden relative">
                <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-orange-500 to-amber-400 rounded-full transition-all duration-500 ease-out" style={{ width: `${progressPct}%` }} />
                <div className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-[shimmer_1.8s_infinite]" style={{ left: `${Math.max(0, progressPct - 20)}%` }} />
              </div>
              <div className="mt-2.5 flex items-center justify-between text-[11px]">
                <span className="text-white/40 font-medium">Étape {loaderStep + 1}/{LOADER_STEPS.length}</span>
                <span className="text-orange-300/80 font-bold tabular-nums">{progressPct}%</span>
              </div>
              <div className="text-white/35 text-[11px] mt-3">≈ {Math.round(estimatedDuration * 1.5)}s pour {selected.size} iPhone{selected.size > 1 ? 's' : ''}</div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translate(-50%, 20px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }
      `}</style>
    </div>
  );
}
