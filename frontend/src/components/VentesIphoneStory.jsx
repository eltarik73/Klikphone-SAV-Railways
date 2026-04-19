import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Smartphone, Check, Download, Share2, X, Loader2, Plus,
  Pencil, Trash2, RefreshCw, Film, Sparkles, Video,
} from 'lucide-react';
import api from '../lib/api';
import { getIPhoneImage, PLACEHOLDER_SVG } from '../utils/appleCDN';

const CONDITIONS = [
  { id: '', label: 'Tous' },
  { id: 'Neuf', label: 'Neuf' },
  { id: 'Reconditionné Premium', label: 'Recond. Premium' },
  { id: 'Reconditionné', label: 'Reconditionné' },
];

function conditionBadgeColor(condition) {
  if (condition === 'Neuf') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (condition === 'Reconditionné Premium') return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
  return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
}

function IphoneCard({ phone, selected, onToggle, adminMode, onEdit, onDelete }) {
  const [imgError, setImgError] = useState(false);
  const src = imgError ? PLACEHOLDER_SVG : getIPhoneImage(phone);

  return (
    <div
      onClick={onToggle}
      className={`relative cursor-pointer rounded-2xl border transition-all overflow-hidden group ${
        selected
          ? 'border-orange-500 ring-2 ring-orange-500/40 shadow-[0_0_0_4px_rgba(232,100,26,0.08)]'
          : 'border-white/10 hover:border-white/25'
      }`}
      style={{ backgroundColor: '#14141c' }}
    >
      {/* Checkbox orange */}
      <div
        className={`absolute top-3 right-3 z-10 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
          selected
            ? 'bg-orange-500 border-orange-500'
            : 'bg-black/40 border-white/30 group-hover:border-white/50'
        }`}
      >
        {selected && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
      </div>

      {/* Condition badge */}
      <div
        className={`absolute top-3 left-3 z-10 text-[10px] font-bold px-2 py-1 rounded-md border ${conditionBadgeColor(phone.condition)}`}
      >
        {phone.condition}
      </div>

      {/* Photo iPhone */}
      <div className="relative h-52 flex items-center justify-center p-4"
        style={{
          background: `radial-gradient(circle at center, ${phone.color_hex || '#333'}20 0%, transparent 70%)`,
        }}
      >
        <img
          src={src}
          alt={phone.model}
          className="max-h-full max-w-full object-contain drop-shadow-2xl"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      </div>

      {/* Info */}
      <div className="px-4 pb-4 pt-2">
        <div className="text-white font-bold text-sm tracking-tight">{phone.model}</div>
        <div className="text-white/60 text-xs mt-0.5">
          {phone.storage} · {phone.color_name}
        </div>
        <div className="flex items-baseline gap-2 mt-2">
          <span className="text-white font-black text-2xl tracking-tight">{phone.price}€</span>
          {phone.old_price > phone.price && (
            <span className="text-white/40 text-xs line-through">{phone.old_price}€</span>
          )}
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-white/50 uppercase tracking-wider font-semibold">
            Stock: {phone.stock}
          </span>
          {adminMode && (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => onEdit(phone)}
                className="p-1.5 rounded-md bg-white/5 hover:bg-white/15 text-white/80 transition-all"
                title="Modifier"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={() => onDelete(phone)}
                className="p-1.5 rounded-md bg-red-500/10 hover:bg-red-500/25 text-red-300 transition-all"
                title="Supprimer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function IphoneFormModal({ open, initial, onClose, onSave }) {
  const empty = {
    model: '',
    model_key: '',
    storage: '128GB',
    color_name: '',
    color_hex: '#333333',
    color_key: '',
    condition: 'Neuf',
    price: 0,
    old_price: null,
    stock: 1,
    image_url: '',
  };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(initial ? { ...empty, ...initial } : empty);
  }, [open, initial]);

  if (!open) return null;

  const set = (k) => (e) => {
    const v = e.target.value;
    setForm((f) => ({
      ...f,
      [k]: ['price', 'old_price', 'stock'].includes(k) ? (v === '' ? null : Number(v)) : v,
    }));
  };

  const submit = async () => {
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      alert('Erreur : ' + (err.message || 'inconnue'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 text-white rounded-2xl border border-white/10 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h3 className="font-bold text-lg">{initial ? 'Modifier' : 'Nouvel iPhone'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <Field label="Modèle" value={form.model} onChange={set('model')} placeholder="iPhone 16 Pro" />
          <Field label="Model key (slug)" value={form.model_key} onChange={set('model_key')} placeholder="iphone-16-pro" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stockage" value={form.storage} onChange={set('storage')} />
            <Select label="Condition" value={form.condition} onChange={set('condition')}
              options={['Neuf', 'Reconditionné Premium', 'Reconditionné']} />
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
          <Field label="Image URL (override)" value={form.image_url || ''} onChange={set('image_url')}
            placeholder="Laisse vide pour utiliser l'image locale" />
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-semibold">
            Annuler
          </button>
          <button
            onClick={submit}
            disabled={saving || !form.model || !form.model_key}
            className="px-5 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <label className="block">
      <span className="text-[11px] text-white/60 font-semibold uppercase tracking-wider">{label}</span>
      <input
        type={type}
        value={value ?? ''}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full mt-1 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-orange-500"
      />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-[11px] text-white/60 font-semibold uppercase tracking-wider">{label}</span>
      <select
        value={value}
        onChange={onChange}
        className="w-full mt-1 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-white focus:outline-none focus:border-orange-500"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

function VideoModal({ open, result, onClose, onRegenerate }) {
  if (!open || !result) return null;
  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Klikphone — Story iPhone', url: result.video_url });
      } catch {}
    } else {
      await navigator.clipboard.writeText(result.video_url);
      alert('URL copiée dans le presse-papier');
    }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 text-white rounded-2xl border border-white/10 max-w-md w-full overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Film className="w-5 h-5 text-orange-500" />
            <h3 className="font-bold">Ta vidéo Story est prête</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative bg-black flex items-center justify-center" style={{ aspectRatio: '9/16' }}>
          <video
            src={result.video_url}
            controls
            autoPlay
            loop
            playsInline
            className="w-full h-full object-contain"
          />
        </div>

        <div className="p-4 text-xs text-white/60 text-center">
          Durée {result.duration_seconds}s — généré en {result.render_time_s}s
        </div>

        <div className="grid grid-cols-3 gap-2 p-4 pt-0">
          <a
            href={result.video_url}
            download={result.filename || 'klikphone-story.mp4'}
            className="flex items-center justify-center gap-2 px-3 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold"
          >
            <Download className="w-4 h-4" /> MP4
          </a>
          <button
            onClick={shareLink}
            className="flex items-center justify-center gap-2 px-3 py-3 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold"
          >
            <Share2 className="w-4 h-4" /> Partager
          </button>
          <button
            onClick={onRegenerate}
            className="flex items-center justify-center gap-2 px-3 py-3 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold"
          >
            <RefreshCw className="w-4 h-4" /> Rejouer
          </button>
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

  const adminMode = typeof window !== 'undefined' && localStorage.getItem('klikphone_admin') === 'true';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getIphones();
      setPhones(data);
    } catch (err) {
      setError(err.message || 'Erreur chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!filter) return phones;
    return phones.filter((p) => p.condition === filter);
  }, [phones, filter]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (next.size >= 8) {
          alert('Maximum 8 iPhones par vidéo');
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  };

  const generateVideo = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await api.generateIphoneStoryVideo(ids);
      setVideoResult(result);
    } catch (err) {
      setError(err.message || 'Erreur génération vidéo');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async (form) => {
    if (form.id) {
      await api.updateIphone(form.id, form);
    } else {
      await api.createIphone(form);
    }
    await load();
  };

  const handleDelete = async (phone) => {
    if (!window.confirm(`Supprimer ${phone.model} ${phone.storage} ${phone.color_name} ?`)) return;
    try {
      await api.deleteIphone(phone.id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(phone.id);
        return next;
      });
      await load();
    } catch (err) {
      alert('Erreur : ' + err.message);
    }
  };

  const estimatedDuration = 1.8 + selected.size * 3.0 + 2.2;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#0a0a10' }}>
      {/* Header dark */}
      <div className="px-6 py-5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-lg shadow-orange-500/30">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Ventes iPhone · Stories</h2>
            <p className="text-xs text-white/50">
              Sélectionne jusqu'à 8 iPhones, génère ta Story 9:16 pour Insta/TikTok
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {adminMode && (
            <button
              onClick={() => { setFormInitial(null); setFormOpen(true); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/15 text-white text-xs font-bold"
            >
              <Plus className="w-4 h-4" /> iPhone
            </button>
          )}
          <button
            onClick={load}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/15 text-white/70"
            title="Rafraîchir"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter segmented */}
      <div className="px-6 pt-4">
        <div className="inline-flex bg-white/5 rounded-xl p-1 gap-1 text-xs">
          {CONDITIONS.map((c) => (
            <button
              key={c.id}
              onClick={() => setFilter(c.id)}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                filter === c.id ? 'bg-white text-black' : 'text-white/70 hover:text-white'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="p-6 pt-4 pb-28">
        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-white/50" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-white/50 text-sm">
            Aucun iPhone dans cette catégorie.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map((p) => (
              <IphoneCard
                key={p.id}
                phone={p}
                selected={selected.has(p.id)}
                onToggle={() => toggleSelect(p.id)}
                adminMode={adminMode}
                onEdit={(ph) => { setFormInitial(ph); setFormOpen(true); }}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Floating bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 w-[min(94vw,640px)]">
          <div className="bg-zinc-900/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl shadow-black/60 p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0 pl-2">
              <div className="text-white text-sm font-bold">
                {selected.size} iPhone{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
              </div>
              <div className="text-white/50 text-xs">
                Vidéo ≈ {estimatedDuration.toFixed(1)}s · 1080×1920
              </div>
            </div>
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/15 text-white/70 text-xs font-semibold"
            >
              Vider
            </button>
            <button
              onClick={generateVideo}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-60 text-white text-sm font-bold shadow-lg shadow-orange-500/40"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Génération…
                </>
              ) : (
                <>
                  <Video className="w-4 h-4" /> Générer la vidéo
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Form modal */}
      <IphoneFormModal
        open={formOpen}
        initial={formInitial}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
      />

      {/* Video modal */}
      <VideoModal
        open={!!videoResult}
        result={videoResult}
        onClose={() => setVideoResult(null)}
        onRegenerate={() => { setVideoResult(null); generateVideo(); }}
      />

      {/* Generation loader overlay */}
      {generating && !videoResult && (
        <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-zinc-900 rounded-2xl border border-white/10 p-8 max-w-sm text-center">
            <Loader2 className="w-10 h-10 animate-spin text-orange-500 mx-auto mb-4" />
            <div className="text-white font-bold">Génération en cours…</div>
            <div className="text-white/50 text-sm mt-1">
              ~{Math.round(estimatedDuration * 2)}s de rendu Pillow + ffmpeg
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
