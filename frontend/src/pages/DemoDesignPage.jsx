import { useState, useMemo, useEffect } from 'react';
import {
  Smartphone, Sparkles, Search, Check, ShoppingBag,
  Shield, Zap, Package, ArrowRight, Star, Loader2,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL
  || (window.location.hostname === 'localhost' ? 'https://klikphone-sav-v2-production.up.railway.app' : '');

// Map raw API row → card model
function mapPhone(row, idx) {
  const variants = [];
  for (let i = 1; i <= 3; i++) {
    const prix = row[`prix_${i}`];
    const stockage = row[`stockage_${i}`];
    const stock = row[`stock_${i}`] || 0;
    if (prix) variants.push({ stockage: (stockage || '').trim() || '—', prix, stock });
  }
  const isNeuf = (row.condition || '').toLowerCase() === 'neuf';
  return {
    id: row.id,
    marque: row.marque,
    modele: row.modele,
    image: row.image_url,
    condition: row.condition,
    grade: isNeuf ? 'Neuf' : 'Premium',
    ordre: row.ordre ?? idx,
    variants,
    // Cosmetic fake data (rating / highlights) — just for demo polish
    rating: (4.5 + ((row.id * 7) % 5) / 10).toFixed(1),
    reviews: 20 + ((row.id * 13) % 200),
    featured: false,
  };
}

const CONDITIONS = ['Tous', 'Neuf', 'Reconditionné Premium'];

// Highlight factices basés sur marque/modèle pour enrichir la featured card
function inferHighlights(p) {
  const m = (p.modele || '').toLowerCase();
  const out = [];
  if (m.includes('ultra')) out.push('Titane aéronautique', 'S Pen inclus', 'Zoom 100x');
  else if (m.includes('pro')) out.push('Écran 120 Hz', 'Triple caméra pro', 'Batterie longue durée');
  else if (m.includes('pixel')) out.push('Tensor G3', 'IA Google intégrée', 'Magic Eraser');
  else if (p.marque?.toLowerCase() === 'samsung') out.push('Galaxy AI', 'AMOLED 2X', 'Résistant IP68');
  else if (p.marque?.toLowerCase() === 'xiaomi') out.push('Leica optics', 'Charge ultra rapide');
  else out.push('Garantie 24 mois', 'Livraison 24h');
  return out.slice(0, 3);
}

// ─── Hero stat ──────────────────────────────────────────────────
function StatChip({ icon: Icon, label, value, accent = 'violet' }) {
  const colors = {
    violet: 'from-violet-500/20 to-fuchsia-500/10 text-violet-300 border-violet-500/30',
    amber: 'from-amber-500/20 to-orange-500/10 text-amber-300 border-amber-500/30',
    emerald: 'from-emerald-500/20 to-teal-500/10 text-emerald-300 border-emerald-500/30',
  }[accent];
  return (
    <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl bg-gradient-to-br ${colors} border backdrop-blur-xl`}>
      <Icon className="w-5 h-5" />
      <div>
        <p className="text-xl font-bold leading-none font-display">{value}</p>
        <p className="text-[11px] uppercase tracking-widest opacity-70 mt-1">{label}</p>
      </div>
    </div>
  );
}

// ─── Product Card ───────────────────────────────────────────────
function PhoneCard({ phone, selected, onSelect }) {
  const minPrice = Math.min(...phone.variants.map(v => v.prix));
  const maxStock = phone.variants.reduce((a, v) => a + v.stock, 0);
  const inStock = maxStock > 0;
  const isSelected = selected === phone.id;

  return (
    <article
      onClick={() => onSelect(phone.id)}
      className={`group relative overflow-hidden rounded-3xl bg-white/[0.03] backdrop-blur-xl border transition-all duration-500 cursor-pointer
        ${isSelected ? 'border-violet-400/60 shadow-2xl shadow-violet-500/20 scale-[1.02]' : 'border-white/10 hover:border-white/20'}
        ${phone.featured ? 'md:col-span-2 md:row-span-2' : ''}`}
    >
      {/* Aurora glow layer */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-violet-500/20 via-transparent to-transparent blur-3xl" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-amber-500/10 via-transparent to-transparent blur-3xl" />
      </div>

      {/* Image */}
      <div className={`relative overflow-hidden ${phone.featured ? 'h-80 md:h-[28rem]' : 'h-56'} bg-gradient-to-b from-white/[0.02] to-black/40`}>
        <img
          src={phone.image}
          alt={phone.modele}
          className="absolute inset-0 w-full h-full object-contain p-8 group-hover:scale-110 transition-transform duration-700"
          loading="lazy"
          onError={(e) => { e.target.style.opacity = 0; }}
        />
        {/* Condition badge */}
        <div className="absolute top-4 left-4 flex gap-2">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider backdrop-blur-md
            ${phone.grade === 'Neuf'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
              : 'bg-violet-500/20 text-violet-300 border border-violet-400/30'}`}>
            {phone.grade === 'Neuf' ? <Sparkles className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
            {phone.grade}
          </span>
          {phone.featured && (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-amber-500 to-orange-500 text-black">
              <Zap className="w-3 h-3" />
              Bestseller
            </span>
          )}
        </div>

        {/* Stock */}
        <div className="absolute top-4 right-4">
          {inStock ? (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-semibold bg-black/40 backdrop-blur-md border border-white/10 text-emerald-300">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              {maxStock} en stock
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-semibold bg-rose-500/20 backdrop-blur-md border border-rose-400/30 text-rose-300">
              Rupture
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="relative p-6">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-violet-300 mb-1.5">
              {phone.marque}
            </p>
            <h3 className={`font-display font-extrabold text-white leading-tight ${phone.featured ? 'text-3xl' : 'text-xl'}`}>
              {phone.modele}
            </h3>
          </div>
          <div className="flex items-center gap-1 text-amber-400 shrink-0">
            <Star className="w-3.5 h-3.5 fill-current" />
            <span className="text-sm font-bold">{phone.rating}</span>
            <span className="text-xs text-slate-500">({phone.reviews})</span>
          </div>
        </div>

        {/* Highlights (featured only) */}
        {phone.featured && (
          <div className="flex flex-wrap gap-2 my-4">
            {phone.highlights.map(h => (
              <span key={h} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-white/5 border border-white/10 text-slate-300">
                <Check className="w-3 h-3 text-violet-400" />
                {h}
              </span>
            ))}
          </div>
        )}

        {/* Variants */}
        <div className="flex flex-wrap gap-2 mt-4">
          {phone.variants.map(v => (
            <div
              key={v.stockage}
              className={`px-3 py-2 rounded-xl border text-xs font-medium transition-all
                ${v.stock === 0
                  ? 'bg-white/[0.02] border-white/5 text-slate-600 line-through'
                  : 'bg-white/[0.04] border-white/10 text-slate-300 hover:border-violet-400/40 hover:bg-violet-500/10'}`}
            >
              <div className="font-semibold text-white">{v.stockage}</div>
              <div className="text-[10px] uppercase tracking-wider opacity-70 mt-0.5">
                {v.prix}€
              </div>
            </div>
          ))}
        </div>

        {/* Price + CTA */}
        <div className="flex items-end justify-between mt-6 pt-6 border-t border-white/5">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">À partir de</p>
            <p className={`font-display font-extrabold bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent ${phone.featured ? 'text-5xl' : 'text-3xl'}`}>
              {minPrice}€
            </p>
          </div>
          <button className="group/btn inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-white text-slate-900 font-bold text-sm shadow-lg shadow-violet-500/20 hover:shadow-violet-500/40 hover:scale-105 transition-all">
            <ShoppingBag className="w-4 h-4" />
            Réserver
            <ArrowRight className="w-4 h-4 opacity-0 -ml-4 group-hover/btn:opacity-100 group-hover/btn:ml-0 transition-all" />
          </button>
        </div>
      </div>
    </article>
  );
}

// ─── Main Page ──────────────────────────────────────────────────
export default function DemoDesignPage() {
  const [marque, setMarque] = useState('Tous');
  const [condition, setCondition] = useState('Tous');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [phones, setPhones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/smartphones-tarifs?active_only=true`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const mapped = data
          .map(mapPhone)
          .filter(p => p.variants.length > 0)
          .sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
        // Featured = meilleur produit (plus haut prix moyen) pour la mise en avant
        if (mapped.length) {
          const star = [...mapped].sort((a, b) => {
            const avg = arr => arr.variants.reduce((s, v) => s + v.prix, 0) / arr.variants.length;
            return avg(b) - avg(a);
          })[0];
          const others = mapped.filter(p => p.id !== star.id);
          setPhones([{ ...star, featured: true, highlights: inferHighlights(star) }, ...others]);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const MARQUES = useMemo(() => {
    const uniq = [...new Set(phones.map(p => p.marque))].sort();
    return ['Tous', ...uniq];
  }, [phones]);

  const filtered = useMemo(() => {
    return phones.filter(p => {
      if (marque !== 'Tous' && p.marque !== marque) return false;
      if (condition !== 'Tous' && p.condition !== condition) return false;
      if (search && !`${p.marque} ${p.modele}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [phones, marque, condition, search]);

  const totalStock = phones.reduce((a, p) => a + p.variants.reduce((b, v) => b + v.stock, 0), 0);

  return (
    <div className="relative min-h-screen bg-slate-950 text-white overflow-hidden" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Aurora background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[50rem] h-[50rem] rounded-full bg-violet-600/20 blur-[120px] animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute top-[30%] right-[-15%] w-[40rem] h-[40rem] rounded-full bg-fuchsia-600/15 blur-[100px] animate-pulse" style={{ animationDuration: '12s', animationDelay: '2s' }} />
        <div className="absolute bottom-[-10%] left-[20%] w-[45rem] h-[45rem] rounded-full bg-amber-500/10 blur-[120px] animate-pulse" style={{ animationDuration: '10s', animationDelay: '4s' }} />
      </div>

      {/* Grid overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
        backgroundSize: '64px 64px',
      }} />

      {/* Top nav */}
      <header className="relative z-10 border-b border-white/5 backdrop-blur-xl bg-black/20">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-violet-500 blur-xl opacity-50" />
              <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center font-display font-extrabold">
                K
              </div>
            </div>
            <div>
              <p className="font-display font-extrabold text-lg leading-none">Klikphone</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mt-0.5">Premium Store</p>
            </div>
          </div>
          <span className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-white/5 border border-white/10 text-slate-400">
            <Sparkles className="w-3 h-3 text-amber-400" />
            Démo design — /demo-design
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 pt-16 pb-12">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-400/20 text-violet-300 text-xs font-semibold mb-6">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-400" />
            </span>
            Collection smartphones 2025
          </div>
          <h1 className="font-display font-extrabold text-5xl md:text-7xl leading-[0.95] tracking-tight mb-6">
            Des smartphones <br />
            <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-amber-400 bg-clip-text text-transparent">
              premium reconditionnés
            </span>
          </h1>
          <p className="text-lg text-slate-400 leading-relaxed max-w-2xl">
            Chaque appareil testé, garanti et livré en 24h depuis Chambéry. Des prix imbattables sur les dernières générations Samsung, Google et Xiaomi.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 mt-10">
          <StatChip icon={Package} label="Modèles" value={phones.length} accent="violet" />
          <StatChip icon={Check} label="En stock" value={totalStock} accent="emerald" />
          <StatChip icon={Shield} label="Garantie" value="24 mois" accent="amber" />
        </div>
      </section>

      {/* Filters */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 mb-10">
        <div className="rounded-3xl bg-white/[0.03] backdrop-blur-xl border border-white/10 p-5 flex flex-col lg:flex-row gap-4 items-stretch lg:items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher un modèle, une marque..."
              className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400/50 focus:bg-white/10 transition-all text-sm"
            />
          </div>

          {/* Brand chips */}
          <div className="flex flex-wrap gap-2">
            {MARQUES.map(m => (
              <button
                key={m}
                onClick={() => setMarque(m)}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all
                  ${marque === m
                    ? 'bg-violet-500 text-white shadow-lg shadow-violet-500/30'
                    : 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10'}`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Condition pills */}
          <div className="flex gap-2 border-l border-white/10 pl-4">
            {CONDITIONS.map(c => (
              <button
                key={c}
                onClick={() => setCondition(c)}
                className={`px-3 py-2.5 rounded-xl text-xs font-semibold transition-all
                  ${condition === c
                    ? 'bg-amber-400 text-slate-950'
                    : 'bg-white/5 border border-white/10 text-slate-400 hover:text-white'}`}
              >
                {c === 'Reconditionné Premium' ? 'Recond.' : c}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Grid */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 pb-24">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="w-10 h-10 text-violet-400 animate-spin" />
            <p className="text-slate-400 text-sm">Chargement du catalogue…</p>
          </div>
        ) : error ? (
          <div className="text-center py-24">
            <p className="text-rose-400 font-medium">Erreur API : {error}</p>
            <p className="text-slate-500 text-xs mt-2">Vérifie que le backend tourne ou que VITE_API_URL pointe vers prod.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24">
            <Smartphone className="w-16 h-16 mx-auto text-slate-700 mb-4" />
            <p className="text-slate-500 font-medium">Aucun modèle ne correspond à votre recherche</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 auto-rows-fr">
            {filtered.map(phone => (
              <PhoneCard key={phone.id} phone={phone} selected={selected} onSelect={setSelected} />
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 backdrop-blur-xl bg-black/20 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>© Klikphone — 79 Place Saint-Léger, Chambéry</p>
          <p className="flex items-center gap-2">
            Designé avec <Sparkles className="w-3 h-3 text-amber-400" /> par un designer senior
          </p>
        </div>
      </footer>
    </div>
  );
}
