import { useState, useEffect, useMemo, useCallback, useRef, useId } from 'react';
import {
  Check, Download, Share2, X, Loader2, Plus, Pencil, Trash2, RefreshCw,
  Film, ShieldCheck, Package2, Battery, Award, Zap, Truck,
} from 'lucide-react';
import api from '../lib/api';
import { getIPhoneImage, PLACEHOLDER_SVG } from '../utils/appleCDN';
import { useConfirmDialog } from './ConfirmDialog';
import { useToast } from './Toast';
import { useFocusTrap } from '../hooks/useFocusTrap';

// Outil du personnel (onglet « Ventes iPhone » du Community Manager) : il suit le back-office
// (fond clair, card, btn-*, input, segmented, modal). La vidéo elle-même est rendue côté serveur
// (backend/app/video/story_template.py) : rien ici ne fixe son apparence.

const CONDITIONS = [
  { id: '', label: 'Tous' },
  { id: 'Neuf', label: 'Neuf' },
  { id: 'Reconditionné Premium', label: 'Premium' },
  { id: 'Reconditionné', label: 'Reconditionné' },
];

const LOADER_STEPS = [
  'Préparation des scènes…',
  'Téléchargement des photos iPhone…',
  'Rendu des images…',
  'Encodage MP4 via ffmpeg…',
  'Ajout de la musique…',
  'Envoi de la vidéo…',
];

const MAX_IPHONES = 8;

// Prix au format français (« 1 299 € », espaces insécables fournis par Intl)
const FORMAT_EUROS = new Intl.NumberFormat('fr-FR', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2,
});
function euros(valeur) {
  const n = Number(valeur);
  return Number.isFinite(n) ? FORMAT_EUROS.format(n) : `${valeur} €`;
}
const secondes = (n) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

function AppleLogo({ className = 'w-3 h-3', fill = 'currentColor' }) {
  return (
    <svg className={className} viewBox="0 0 170 170" xmlns="http://www.w3.org/2000/svg" fill={fill} aria-hidden="true">
      <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.197-2.12-9.973-3.17-14.34-3.17-4.58 0-9.492 1.05-14.746 3.17-5.262 2.13-9.501 3.24-12.742 3.35-4.929.21-9.842-1.96-14.746-6.52-3.13-2.73-7.045-7.41-11.735-14.04-5.032-7.08-9.169-15.29-12.41-24.65-3.471-10.11-5.211-19.9-5.211-29.38 0-10.86 2.346-20.23 7.045-28.08 3.693-6.303 8.606-11.275 14.755-14.925s12.793-5.51 19.948-5.629c3.915 0 9.049 1.211 15.429 3.591 6.362 2.388 10.447 3.599 12.238 3.599 1.339 0 5.877-1.416 13.57-4.239 7.275-2.618 13.415-3.702 18.445-3.275 13.63 1.1 23.87 6.473 30.68 16.153-12.19 7.386-18.22 17.731-18.1 31.002.11 10.337 3.86 18.939 11.23 25.769 3.34 3.17 7.07 5.62 11.22 7.36-.9 2.61-1.85 5.11-2.86 7.51zM119.11 7.24c0 8.102-2.96 15.667-8.86 22.669-7.12 8.324-15.732 13.134-25.071 12.375a25.222 25.222 0 0 1-.188-3.07c0-7.778 3.386-16.102 9.399-22.908 3.002-3.446 6.82-6.311 11.45-8.597 4.62-2.252 8.99-3.497 13.1-3.71.12 1.083.17 2.166.17 3.24z" />
    </svg>
  );
}

const trustBadges = (c) =>
  c === 'Neuf' ? [{ icon: Package2, label: 'Scellé Apple' }, { icon: ShieldCheck, label: 'Garantie 2 ans' }, { icon: Truck, label: 'Dispo boutique' }]
  : c === 'Reconditionné Premium' ? [{ icon: Award, label: '100 % pièces Apple' }, { icon: Battery, label: 'Batterie ≥ 90 %' }, { icon: ShieldCheck, label: 'Garantie 12 mois' }]
  : [{ icon: ShieldCheck, label: '100 % satisfait' }, { icon: Battery, label: 'Batterie ≥ 85 %' }, { icon: Zap, label: 'Testé sur 40 points' }];

const tagline = (c) =>
  c === 'Neuf' ? 'Neuf scellé · livré avec accessoires'
  : c === 'Reconditionné Premium' ? 'Comme neuf · sans rayure visible'
  : 'Reconditionné vérifié chez Klikphone';

// Carte d'un iPhone : la carte entière (sauf les actions d'administration) est un bouton à bascule.
function IphoneCard({ phone, selected, onToggle, adminMode, onEdit, onDelete }) {
  const [imgError, setImgError] = useState(false);
  const src = imgError ? PLACEHOLDER_SVG : getIPhoneImage(phone);
  const savings = (phone.old_price || 0) - phone.price;
  const badges = trustBadges(phone.condition);
  const label = phone.condition === 'Reconditionné Premium' ? 'Premium' : phone.condition;
  const enStock = phone.stock > 0;

  return (
    <div
      className={`relative flex flex-col rounded-lg border bg-white transition-colors duration-150 ${
        selected ? 'border-brand-600 ring-1 ring-brand-600' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        className="flex-1 flex flex-col text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        <span className="relative flex items-center justify-center h-40 sm:h-48 p-4">
          <img src={src} alt="" loading="lazy" onError={() => setImgError(true)}
            className="max-h-full max-w-full object-contain" />
          <span className="badge badge-neutral absolute top-2 left-2">{label}</span>
          <span
            aria-hidden="true"
            className={`absolute top-2 right-2 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors duration-150 ${
              selected ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-300'
            }`}
          >
            {selected && <Check className="w-4 h-4" strokeWidth={3} />}
          </span>
        </span>

        <span className="flex-1 flex flex-col px-3 sm:px-4 pb-3">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <AppleLogo className="w-3 h-3 shrink-0" />
            <span className="truncate">{phone.model}</span>
          </span>
          <span className="flex items-center gap-1.5 t-small mt-0.5 min-w-0">
            {phone.color_hex && (
              <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full border border-slate-300 shrink-0"
                style={{ backgroundColor: phone.color_hex }} />
            )}
            <span className="truncate">{phone.storage} · {phone.color_name}</span>
          </span>
          <span className="text-xs text-slate-600 mt-2 line-clamp-1">{tagline(phone.condition)}</span>

          <span className="mt-3 flex flex-wrap items-baseline gap-x-2">
            <span className="text-2xl font-semibold tracking-tight tabular-nums text-slate-900">{euros(phone.price)}</span>
            {phone.old_price > phone.price && (
              <span className="text-xs text-slate-500 line-through tabular-nums">{euros(phone.old_price)}</span>
            )}
            {savings > 0 && (
              <span className="text-xs font-medium text-emerald-700 tabular-nums">−{euros(savings)}</span>
            )}
          </span>

          <span className="mt-3 space-y-1">
            {badges.map(({ icon: Icon, label: texte }) => (
              <span key={texte} className="flex items-center gap-1.5 text-xs text-slate-600">
                <Icon className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                <span className="truncate">{texte}</span>
              </span>
            ))}
          </span>

          <span className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-xs font-medium text-slate-700">
            <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${enStock ? 'bg-emerald-600' : 'bg-slate-300'}`} />
            {enStock ? `En stock · ${phone.stock}` : 'Rupture'}
          </span>
        </span>
      </button>

      {adminMode && (
        <div className="flex items-center justify-end gap-1 px-2 pb-2">
          <button type="button" onClick={() => onEdit(phone)} className="btn-ghost btn-icon btn-sm"
            title="Modifier" aria-label={`Modifier ${phone.model}`}>
            <Pencil aria-hidden="true" />
          </button>
          <button type="button" onClick={() => onDelete(phone)} className="btn-danger-ghost btn-icon btn-sm"
            title="Supprimer" aria-label={`Supprimer ${phone.model}`}>
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, help }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="input-label">{label}</label>
      <input id={id} type={type} value={value ?? ''} onChange={onChange} placeholder={placeholder}
        aria-describedby={help ? `${id}-aide` : undefined} className="input" />
      {help && <p id={`${id}-aide`} className="input-help">{help}</p>}
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="input-label">{label}</label>
      <select id={id} value={value} onChange={onChange} className="select">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function IphoneFormModal({ open, initial, onClose, onSave }) {
  const empty = { model: '', model_key: '', storage: '128GB', color_name: '', color_hex: '#333333', color_key: '', condition: 'Neuf', price: 0, old_price: null, stock: 1, image_url: '' };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState(null);
  const boiteRef = useRef(null);
  const titreId = useId();
  useFocusTrap(boiteRef, open && !saving, { onEscape: onClose });
  useEffect(() => {
    if (open) { setForm(initial ? { ...empty, ...initial } : empty); setErreur(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);
  if (!open) return null;

  const set = (k) => (e) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: ['price', 'old_price', 'stock'].includes(k) ? (v === '' ? null : Number(v)) : v }));
  };
  const submit = async () => {
    setSaving(true);
    setErreur(null);
    try { await onSave(form); onClose(); }
    catch (err) { setErreur(`L'enregistrement a échoué : ${err.message || 'erreur inconnue'}.`); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div ref={boiteRef} role="dialog" aria-modal="true" aria-labelledby={titreId} className="modal">
        <div className="modal-header">
          <h2 id={titreId} className="t-h2">{initial ? 'Modifier l’iPhone' : 'Nouvel iPhone'}</h2>
          <button type="button" onClick={onClose} className="btn-ghost btn-icon" aria-label="Fermer">
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body space-y-4">
          <Field label="Modèle" value={form.model} onChange={set('model')} placeholder="iPhone 16 Pro" />
          <Field label="Clé du modèle (slug)" value={form.model_key} onChange={set('model_key')} placeholder="iphone-16-pro" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stockage" value={form.storage} onChange={set('storage')} />
            <Select label="État" value={form.condition} onChange={set('condition')} options={['Neuf', 'Reconditionné Premium', 'Reconditionné']} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Couleur (nom)" value={form.color_name} onChange={set('color_name')} />
            <Field label="Couleur (clé)" value={form.color_key} onChange={set('color_key')} placeholder="natural-titanium" />
          </div>
          <Field label="Couleur (hex)" value={form.color_hex} onChange={set('color_hex')} placeholder="#b8a898" />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Prix (€)" type="number" value={form.price ?? ''} onChange={set('price')} />
            <Field label="Ancien prix" type="number" value={form.old_price ?? ''} onChange={set('old_price')} />
            <Field label="Stock" type="number" value={form.stock ?? 0} onChange={set('stock')} />
          </div>
          <Field label="Image (URL, optionnel)" value={form.image_url || ''} onChange={set('image_url')}
            help="Laissez vide pour utiliser l’image locale" />
          {erreur && <p role="alert" className="input-error">{erreur}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" onClick={onClose} className="btn-ghost">Annuler</button>
          <button type="button" onClick={submit} disabled={saving || !form.model || !form.model_key}
            aria-busy={saving || undefined} className="btn-primary">
            {saving && <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />}
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function VideoModal({ open, result, onClose, onRegenerate }) {
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();
  const boiteRef = useRef(null);
  const titreId = useId();
  useFocusTrap(boiteRef, open && Boolean(result), { onEscape: onClose });
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
    else {
      try {
        await navigator.clipboard.writeText(result.video_url);
        toast.success('Lien de la vidéo copié dans le presse-papier');
      } catch {
        toast.error(`Le lien n’a pas pu être copié : ${result.video_url}`);
      }
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div ref={boiteRef} role="dialog" aria-modal="true" aria-labelledby={titreId}
        onMouseDown={(e) => e.stopPropagation()} className="modal sm:max-w-md">
        <div className="modal-header">
          <div>
            <h2 id={titreId} className="t-h2">La story est prête</h2>
            <p className="t-small mt-0.5">1080 × 1920 · 9:16</p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost btn-icon" aria-label="Fermer">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto min-h-0">
          <div className="bg-slate-900 flex items-center justify-center" style={{ aspectRatio: '9/16', maxHeight: '60vh' }}>
            <video src={result.video_url} controls autoPlay loop playsInline className="w-full h-full object-contain" />
          </div>
          <p className="t-small text-center px-5 py-2 tabular-nums">
            Durée {result.duration_seconds} s · rendu en {result.render_time_s} s
          </p>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 space-y-2 shrink-0">
          <button type="button" onClick={downloadVideo} disabled={downloading} aria-busy={downloading || undefined}
            className="btn-primary btn-lg btn-block">
            {downloading
              ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
              : <Download aria-hidden="true" />}
            {downloading ? 'Téléchargement…' : 'Télécharger le MP4'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={shareLink} className="btn-secondary">
              <Share2 aria-hidden="true" /> Partager
            </button>
            <button type="button" onClick={onRegenerate} className="btn-secondary">
              <RefreshCw aria-hidden="true" /> Générer à nouveau
            </button>
          </div>
        </div>
      </div>
    </div>
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
  const toast = useToast();
  const confirmation = useConfirmDialog();
  const titreId = useId();
  const attenteRef = useRef(null);
  useFocusTrap(attenteRef, generating && !videoResult);

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
    if (!selected.has(id) && selected.size >= MAX_IPHONES) {
      toast.warning(`${MAX_IPHONES} iPhones au maximum par vidéo`);
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_IPHONES) next.add(id);
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

  const handleDelete = (phone) => {
    confirmation.demander({
      title: `Supprimer ${phone.model} ${phone.storage} ${phone.color_name} ?`,
      description: 'L’iPhone disparaît du catalogue des ventes et de la sélection en cours.',
      confirmLabel: 'Supprimer l’iPhone',
      destructive: true,
      onConfirm: async () => {
        try {
          await api.deleteIphone(phone.id);
          setSelected((prev) => { const next = new Set(prev); next.delete(phone.id); return next; });
          await load();
        } catch (err) {
          toast.error(`La suppression a échoué : ${err.message || 'erreur inconnue'}`);
        }
      },
    });
  };

  const estimatedDuration = 1.8 + selected.size * 3.0 + 2.2;
  const progressPct = Math.round(((loaderStep + 1) / LOADER_STEPS.length) * 100);
  const pluriel = selected.size > 1 ? 's' : '';

  return (
    <section aria-labelledby={titreId} className="space-y-4 pb-28">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titreId} className="t-h2">Ventes iPhone</h2>
          <p className="t-small mt-1">
            Sélectionnez jusqu’à {MAX_IPHONES} modèles pour générer une story vidéo 9:16 (Instagram, TikTok).
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {adminMode && (
            <button type="button" onClick={() => { setFormInitial(null); setFormOpen(true); }} className="btn-secondary btn-sm">
              <Plus aria-hidden="true" /> Ajouter un iPhone
            </button>
          )}
          <button type="button" onClick={load} className="btn-secondary btn-sm" title="Rafraîchir">
            <RefreshCw aria-hidden="true" /> Actualiser
          </button>
        </div>
      </div>

      <div className="segmented" role="group" aria-label="Filtrer par état">
        {CONDITIONS.map((c) => {
          const active = filter === c.id;
          const count = counts[c.id] ?? 0;
          return (
            <button key={c.id} type="button" onClick={() => setFilter(c.id)} aria-pressed={active}
              className={`segmented-item ${active ? 'segmented-item-active' : ''}`}>
              {c.label}
              <span className="text-slate-500 tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {error && <div role="alert" className="error-state">{error}</div>}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4" aria-busy="true">
          <span className="sr-only" role="status">Chargement des iPhones…</span>
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-80 sm:h-96" aria-hidden="true" />)}
        </div>
      ) : filtered.length === 0 ? (
        !error && (
          <div className="empty-state">
            <p className="t-h2">{filter ? 'Aucun iPhone dans cette catégorie' : 'Aucun iPhone en vente'}</p>
            <p className="t-small max-w-xs">
              {filter
                ? 'Essayez un autre filtre ou actualisez la liste.'
                : 'Les iPhones du catalogue des ventes apparaîtront ici.'}
            </p>
            {filter ? (
              <button type="button" onClick={() => setFilter('')} className="btn-secondary btn-sm">
                Voir tous les iPhones
              </button>
            ) : (
              <button type="button" onClick={load} className="btn-secondary btn-sm">
                <RefreshCw aria-hidden="true" /> Actualiser la liste
              </button>
            )}
          </div>
        )
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {filtered.map((p) => (
            <IphoneCard key={p.id} phone={p} selected={selected.has(p.id)} onToggle={() => toggleSelect(p.id)}
              adminMode={adminMode} onEdit={(ph) => { setFormInitial(ph); setFormOpen(true); }} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-30 w-[min(94vw,680px)]">
          <div className="flex items-center gap-2 sm:gap-3 rounded-xl border border-slate-200 bg-white shadow-lg p-2.5 sm:p-3">
            <div className="flex-1 min-w-0 pl-1">
              <p className="text-sm font-semibold text-slate-900 truncate tabular-nums">
                {selected.size}/{MAX_IPHONES} iPhone{pluriel} sélectionné{pluriel}
              </p>
              <p className="t-small flex items-center gap-1.5 mt-0.5 tabular-nums">
                <Film className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>≈ {secondes(estimatedDuration)} s · 1080 × 1920</span>
              </p>
            </div>
            <button type="button" onClick={() => setSelected(new Set())} className="btn-ghost btn-sm hidden sm:inline-flex">
              Vider la sélection
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="btn-ghost btn-icon btn-sm sm:hidden"
              aria-label="Vider la sélection">
              <X aria-hidden="true" />
            </button>
            <button type="button" onClick={generateVideo} disabled={generating} aria-busy={generating || undefined}
              className="btn-primary">
              {generating
                ? <><Loader2 className="motion-safe:animate-spin" aria-hidden="true" /><span className="hidden sm:inline">Génération…</span></>
                : <><Film aria-hidden="true" /><span>Générer la vidéo</span></>}
            </button>
          </div>
        </div>
      )}

      <IphoneFormModal open={formOpen} initial={formInitial} onClose={() => setFormOpen(false)} onSave={handleSave} />
      <VideoModal open={!!videoResult} result={videoResult} onClose={() => setVideoResult(null)}
        onRegenerate={() => { setVideoResult(null); generateVideo(); }} />

      {generating && !videoResult && (
        <div className="modal-overlay">
          <div ref={attenteRef} role="dialog" aria-modal="true" aria-labelledby={`${titreId}-attente`}
            className="modal sm:max-w-sm">
            <div className="px-5 py-5">
              <div className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 text-brand-600 motion-safe:animate-spin shrink-0" aria-hidden="true" />
                <h2 id={`${titreId}-attente`} className="t-h2">Génération de la vidéo</h2>
              </div>
              <p className="t-body mt-2" aria-live="polite">{LOADER_STEPS[loaderStep]}</p>
              <div className="mt-4 h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar"
                aria-label="Avancement estimé" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct}>
                <div className="h-full rounded-full bg-brand-600 transition-[width] duration-200 ease-out"
                  style={{ width: `${progressPct}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500 tabular-nums">
                <span>Étape {loaderStep + 1} sur {LOADER_STEPS.length}</span>
                <span>{progressPct} %</span>
              </div>
              <p className="t-small mt-3 tabular-nums">
                Environ {Math.round(estimatedDuration * 1.5)} s pour {selected.size} iPhone{pluriel}
              </p>
            </div>
          </div>
        </div>
      )}

      {confirmation.dialog}
    </section>
  );
}
