import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Sparkles, Shield, Zap, Package, Check, Star,
  Smartphone, MapPin, Phone, Clock, Tv, Loader2, QrCode,
  Maximize, Minimize, Share2,
} from 'lucide-react';

// ─── Config ─────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL
  || (window.location.hostname === 'localhost'
    ? 'https://klikphone-sav-v2-production.up.railway.app'
    : '');

const FEATURED_ROTATE_MS = 7000;

// ─── Data mapping ──────────────────────────────────────────────
function mapAndroid(row) {
  const variants = buildVariants(row);
  const isNeuf = (row.condition || '').toLowerCase() === 'neuf';
  return {
    key: `s-${row.id}`,
    marque: row.marque,
    modele: row.modele,
    image: row.image_url,
    condition: row.condition,
    grade: isNeuf ? 'Neuf' : 'Premium',
    ordre: row.ordre ?? 999,
    variants,
    kind: 'android',
  };
}

function mapIphone(row) {
  const variants = buildVariants(row);
  const isNeuf = (row.condition || '').toLowerCase() === 'neuf';
  return {
    key: `i-${row.id}`,
    marque: 'Apple',
    modele: row.modele,
    image: row.image_filename
      ? `${API_BASE}/static/iphones/${row.image_filename}`
      : null,
    condition: row.condition,
    grade: isNeuf ? 'Neuf' : (row.grade || 'Premium'),
    ordre: row.ordre ?? 999,
    variants,
    kind: 'iphone',
  };
}

function buildVariants(row) {
  const out = [];
  for (let i = 1; i <= 3; i++) {
    const prix = row[`prix_${i}`];
    const stockage = row[`stockage_${i}`];
    const stock = row[`stock_${i}`] || 0;
    if (prix) out.push({ stockage: (stockage || '').trim() || '—', prix, stock });
  }
  return out;
}

// ─── Live clock ────────────────────────────────────────────────
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ─── Fullscreen hook (TV / iPad kiosk mode) ───────────────────
function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const sync = () => {
      const el = document.fullscreenElement || document.webkitFullscreenElement;
      setIsFullscreen(!!el);
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  const toggle = async () => {
    const el = document.documentElement;
    const isActive = !!(document.fullscreenElement || document.webkitFullscreenElement);
    try {
      if (isActive) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else {
        if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      }
    } catch {
      // iOS Safari : fullscreen API non supportée sur <html>, fallback silencieux
    }
  };

  return [isFullscreen, toggle];
}

// ─── Hero Card (grand format, crossfade) ───────────────────────
function HeroShowcase({ phone }) {
  const minPrice = Math.min(...phone.variants.map(v => v.prix));

  return (
    <div
      key={phone.key}
      className="relative h-full flex items-center gap-12 px-16 animate-hero-in"
    >
      {/* Left : image */}
      <div className="relative flex-[1] h-full flex items-center justify-center">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-[36rem] h-[36rem] rounded-full bg-gradient-to-br from-violet-500/25 via-fuchsia-500/10 to-amber-500/20 blur-3xl animate-pulse-slow" />
        </div>
        {phone.image && (
          <img
            src={phone.image}
            alt={phone.modele}
            className="relative max-h-[70vh] w-auto object-contain drop-shadow-[0_30px_60px_rgba(124,58,237,0.35)] animate-float"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
      </div>

      {/* Right : infos */}
      <div className="relative flex-[1] max-w-xl">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-400/10 border border-amber-400/30 text-amber-300 text-xs font-bold uppercase tracking-[0.25em] mb-6">
          <Sparkles className="w-3 h-3" />
          Coup de cœur
        </div>
        <p className="font-display text-2xl uppercase tracking-[0.35em] text-violet-300/80 mb-3">
          {phone.marque}
        </p>
        <h2 className="font-display font-extrabold text-7xl leading-[0.95] text-white mb-6">
          {phone.modele}
        </h2>
        <div className="flex items-center gap-3 flex-wrap mb-8">
          <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold
            ${phone.grade === 'Neuf'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
              : 'bg-violet-500/20 text-violet-300 border border-violet-400/30'}`}>
            {phone.grade === 'Neuf' ? <Sparkles className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
            {phone.grade === 'Neuf' ? 'Neuf' : 'Reconditionné Premium'}
          </span>
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-black/30 border border-white/10 text-slate-200">
            <Shield className="w-4 h-4 text-violet-300" />
            Garantie 24 mois
          </span>
        </div>

        <div className="flex items-end gap-6 mb-10">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-slate-400 mb-2">À partir de</p>
            <p className="font-display font-extrabold text-[7rem] leading-none bg-gradient-to-br from-amber-200 via-amber-400 to-orange-500 bg-clip-text text-transparent">
              {minPrice}€
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {phone.variants.map(v => (
            <div
              key={v.stockage}
              className="px-5 py-3 rounded-2xl border border-white/15 bg-white/5 backdrop-blur-sm text-sm font-semibold text-white"
            >
              <div className="text-base font-bold">{v.stockage}</div>
              <div className="text-amber-300 text-lg mt-0.5">{v.prix}€</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Ticker (marquee continuous) ───────────────────────────────
function PriceTicker({ phones }) {
  // Duplicate for seamless loop
  const loop = [...phones, ...phones];
  return (
    <div className="relative overflow-hidden border-y border-white/10 bg-black/30 backdrop-blur-sm">
      <div className="flex animate-scroll-x whitespace-nowrap py-4">
        {loop.map((p, i) => {
          if (!p.variants.length) return null;
          const min = Math.min(...p.variants.map(v => v.prix));
          return (
            <div key={`${p.key}-${i}`} className="flex items-center gap-3 px-8 shrink-0">
              <span className="text-[11px] uppercase tracking-[0.3em] text-violet-300/70">{p.marque}</span>
              <span className="font-display font-bold text-white text-xl">{p.modele}</span>
              <span className="font-display font-bold text-2xl bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent">
                dès {min}€
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500/50 ml-4" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Mini card (grid secondaire) ───────────────────────────────
function MiniCard({ phone, highlight }) {
  const min = Math.min(...phone.variants.map(v => v.prix));

  return (
    <div className={`group relative overflow-hidden rounded-3xl backdrop-blur-xl border transition-all duration-700
      ${highlight
        ? 'bg-gradient-to-br from-violet-500/15 to-amber-500/10 border-violet-300/40 scale-[1.03]'
        : 'bg-white/[0.03] border-white/10'}`}
    >
      <div className="flex items-center gap-5 p-5">
        <div className="relative w-28 h-28 shrink-0 rounded-2xl bg-black/30 flex items-center justify-center overflow-hidden">
          {phone.image && (
            <img
              src={phone.image}
              alt={phone.modele}
              className="w-full h-full object-contain p-2"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-violet-300 mb-1">
            {phone.marque}
          </p>
          <h3 className="font-display font-extrabold text-xl text-white leading-tight truncate">
            {phone.modele}
          </h3>
          <p className="text-[10px] text-slate-400 mt-2">{phone.grade}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[9px] uppercase tracking-widest text-slate-500">dès</p>
          <p className="font-display font-extrabold text-3xl bg-gradient-to-br from-amber-300 to-orange-400 bg-clip-text text-transparent">
            {min}€
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────
export default function AdminSiteTarifsPage() {
  const [phones, setPhones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [heroIdx, setHeroIdx] = useState(0);
  const [orbitIdx, setOrbitIdx] = useState(0);
  const now = useClock();
  const [isFullscreen, toggleFullscreen] = useFullscreen();
  const [shareLabel, setShareLabel] = useState('Partager');

  // Keyboard shortcut : F = toggle fullscreen
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'f' || e.key === 'F') {
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleFullscreen]);

  const share = async () => {
    const url = window.location.origin + '/site-tarifs-iphone';
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Catalogue Klikphone', url });
        setShareLabel('Partagé ✓');
      } else {
        await navigator.clipboard.writeText(url);
        setShareLabel('Lien copié ✓');
      }
    } catch {
      setShareLabel('Lien : ' + url.replace(/^https?:\/\//, ''));
    }
    setTimeout(() => setShareLabel('Partager'), 2500);
  };

  // Fetch both catalogs in parallel
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [smart, ips] = await Promise.all([
          fetch(`${API_BASE}/api/smartphones-tarifs?active_only=true`).then(r => r.ok ? r.json() : []),
          fetch(`${API_BASE}/api/iphone-tarifs`).then(r => r.ok ? r.json() : []),
        ]);
        if (cancelled) return;
        const merged = [
          ...(Array.isArray(smart) ? smart.map(mapAndroid) : []),
          ...(Array.isArray(ips) ? ips.filter(p => p.actif !== false).map(mapIphone) : []),
        ]
          .filter(p => p.variants.length > 0)
          .sort((a, b) => {
            // iPhones en premier, puis par ordre
            if (a.kind !== b.kind) return a.kind === 'iphone' ? -1 : 1;
            return (a.ordre || 0) - (b.ordre || 0);
          });
        setPhones(merged);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Featured rotate
  useEffect(() => {
    if (phones.length < 2) return;
    const id = setInterval(() => {
      setHeroIdx(i => (i + 1) % phones.length);
    }, FEATURED_ROTATE_MS);
    return () => clearInterval(id);
  }, [phones.length]);

  // Orbit rotate (mini cards highlight)
  useEffect(() => {
    const id = setInterval(() => setOrbitIdx(i => i + 1), 2500);
    return () => clearInterval(id);
  }, []);

  const featured = phones[heroIdx];
  const orbit = useMemo(() => {
    if (phones.length <= 6) return phones.filter((_, i) => i !== heroIdx);
    // Prend une fenêtre glissante de 6 cards autour de orbitIdx, sans le featured
    const others = phones.filter((_, i) => i !== heroIdx);
    const start = orbitIdx % others.length;
    const out = [];
    for (let i = 0; i < 6; i++) out.push(others[(start + i) % others.length]);
    return out;
  }, [phones, heroIdx, orbitIdx]);

  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="relative min-h-screen bg-slate-950 text-white overflow-hidden"
         style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Keyframes + custom animations */}
      <style>{`
        @keyframes scroll-x { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        @keyframes float { 0%, 100% { transform: translateY(0) rotate(-1deg); } 50% { transform: translateY(-18px) rotate(1deg); } }
        @keyframes pulse-slow { 0%, 100% { opacity: 0.6; transform: scale(1); } 50% { opacity: 1; transform: scale(1.08); } }
        @keyframes hero-in { 0% { opacity: 0; transform: translateX(40px) scale(0.97); } 100% { opacity: 1; transform: translateX(0) scale(1); } }
        @keyframes drift-a { 0% { transform: translate(0, 0); } 50% { transform: translate(80px, -40px); } 100% { transform: translate(0, 0); } }
        @keyframes drift-b { 0% { transform: translate(0, 0); } 50% { transform: translate(-60px, 50px); } 100% { transform: translate(0, 0); } }
        @keyframes drift-c { 0% { transform: translate(0, 0); } 50% { transform: translate(40px, 60px); } 100% { transform: translate(0, 0); } }
        @keyframes shine { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .animate-scroll-x { animation: scroll-x 50s linear infinite; }
        .animate-float { animation: float 6s ease-in-out infinite; }
        .animate-pulse-slow { animation: pulse-slow 5s ease-in-out infinite; }
        .animate-hero-in { animation: hero-in 900ms cubic-bezier(.2,.8,.2,1) both; }
        .animate-drift-a { animation: drift-a 22s ease-in-out infinite; }
        .animate-drift-b { animation: drift-b 28s ease-in-out infinite; }
        .animate-drift-c { animation: drift-c 32s ease-in-out infinite; }
        .animate-shine {
          background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.12) 50%, transparent 70%);
          background-size: 200% 100%;
          animation: shine 8s linear infinite;
        }
      `}</style>

      {/* Aurora background (permanent motion) */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[55rem] h-[55rem] rounded-full bg-violet-600/25 blur-[140px] animate-drift-a" />
        <div className="absolute top-[30%] right-[-15%] w-[45rem] h-[45rem] rounded-full bg-fuchsia-600/20 blur-[120px] animate-drift-b" />
        <div className="absolute bottom-[-10%] left-[25%] w-[50rem] h-[50rem] rounded-full bg-amber-500/15 blur-[130px] animate-drift-c" />
        <div className="absolute inset-0 animate-shine pointer-events-none" />
      </div>

      {/* Grid overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.04]" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
        backgroundSize: '64px 64px',
      }} />

      {/* Top bar */}
      <header className="relative z-10 border-b border-white/10 backdrop-blur-xl bg-black/30">
        <div className="px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 bg-violet-500 blur-xl opacity-60" />
              <div className="relative w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center font-display font-extrabold text-xl">
                K
              </div>
            </div>
            <div>
              <p className="font-display font-extrabold text-xl leading-none">Klikphone</p>
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400 mt-1">Catalogue en temps réel</p>
            </div>
            <span className="ml-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-extrabold bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/30">
              <Sparkles className="w-3 h-3" /> BETA
            </span>
          </div>

          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-violet-400" />
              <span className="text-slate-300">79 Pl. Saint-Léger, Chambéry</span>
            </div>
            <div className="hidden md:flex items-center gap-2 text-sm">
              <Phone className="w-4 h-4 text-amber-400" />
              <span className="text-slate-300 font-semibold">06 95 71 51 96</span>
            </div>
            <div className="flex flex-col items-end border-l border-white/10 pl-6">
              <p className="font-display font-bold text-2xl tabular-nums leading-none">{timeStr}</p>
              <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400 mt-1 capitalize">{dateStr}</p>
            </div>

            {/* Share link */}
            <button
              onClick={share}
              className="group flex items-center gap-2 px-4 py-2.5 rounded-xl
                bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20
                transition-all duration-200 active:scale-95"
              title="Copier le lien pour iPad / TV"
              aria-label="Partager"
            >
              <Share2 className="w-4 h-4 text-slate-300" />
              <span className="hidden sm:inline text-xs font-bold uppercase tracking-wider text-slate-200">
                {shareLabel}
              </span>
            </button>

            {/* Fullscreen toggle (iPad / TV kiosk) */}
            <button
              onClick={toggleFullscreen}
              className="group relative flex items-center gap-2 px-4 py-2.5 rounded-xl
                bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20
                border border-violet-400/30 hover:border-violet-300/60
                hover:from-violet-500/30 hover:to-fuchsia-500/30
                transition-all duration-200 active:scale-95"
              title={isFullscreen ? 'Quitter plein écran (F ou Échap)' : 'Plein écran (F)'}
              aria-label={isFullscreen ? 'Quitter plein écran' : 'Plein écran'}
            >
              {isFullscreen
                ? <Minimize className="w-4 h-4 text-violet-200" />
                : <Maximize className="w-4 h-4 text-violet-200" />}
              <span className="hidden sm:inline text-xs font-bold uppercase tracking-wider text-violet-100">
                {isFullscreen ? 'Quitter' : 'Plein écran'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      {loading ? (
        <div className="relative z-10 flex flex-col items-center justify-center gap-4 py-40">
          <Loader2 className="w-12 h-12 text-violet-400 animate-spin" />
          <p className="text-slate-400 text-sm uppercase tracking-[0.3em]">Synchronisation du catalogue…</p>
        </div>
      ) : error ? (
        <div className="relative z-10 text-center py-40">
          <p className="text-rose-400 font-semibold">Erreur API : {error}</p>
        </div>
      ) : (
        <>
          {/* Hero auto-rotate */}
          <section className="relative z-10 h-[68vh] min-h-[540px] max-w-[1800px] mx-auto">
            {featured && <HeroShowcase phone={featured} />}

            {/* Progress dots */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
              {phones.slice(0, Math.min(phones.length, 12)).map((_, i) => (
                <span
                  key={i}
                  className={`h-1 rounded-full transition-all duration-500
                    ${i === (heroIdx % 12) ? 'w-10 bg-amber-400' : 'w-2 bg-white/20'}`}
                />
              ))}
            </div>
          </section>

          {/* Ticker marquee */}
          <PriceTicker phones={phones} />

          {/* Orbit mini-cards */}
          <section className="relative z-10 max-w-[1800px] mx-auto px-8 py-10">
            <div className="flex items-baseline justify-between mb-6">
              <div>
                <h3 className="font-display font-extrabold text-3xl text-white">
                  Le reste du catalogue
                </h3>
                <p className="text-sm text-slate-400 mt-1">
                  {phones.length - 1} modèles disponibles · mise à jour continue
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 uppercase tracking-[0.25em]">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-400" />
                </span>
                Mise à jour continue
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {orbit.map((phone, i) => (
                <MiniCard key={phone.key} phone={phone} highlight={i === 0} />
              ))}
            </div>
          </section>

          {/* Footer */}
          <footer className="relative z-10 border-t border-white/10 backdrop-blur-xl bg-black/30 mt-10">
            <div className="max-w-[1800px] mx-auto px-8 py-6 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-6 text-sm text-slate-400">
                <span className="inline-flex items-center gap-2">
                  <Shield className="w-4 h-4 text-violet-400" />
                  Garantie 24 mois
                </span>
                <span className="inline-flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  Livraison 24h
                </span>
                <span className="inline-flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400" />
                  Testé avant vente
                </span>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right text-xs text-slate-400">
                  <p className="font-semibold text-white text-sm">Scannez pour commander</p>
                  <p className="mt-0.5">klikphone.com</p>
                </div>
                <div className="w-16 h-16 rounded-xl bg-white p-2 flex items-center justify-center shadow-xl shadow-violet-500/30">
                  <QrCode className="w-full h-full text-slate-900" strokeWidth={1.2} />
                </div>
              </div>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
