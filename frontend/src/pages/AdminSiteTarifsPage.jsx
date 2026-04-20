import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import {
  Sparkles, Shield, Zap, Package, Check, Star,
  Smartphone, MapPin, Phone, Clock, Tv, Loader2, QrCode,
  Maximize, Minimize, Share2, Settings, X,
} from 'lucide-react';

// ─── Motion helpers (pattern Viktor Oddy / Claude Design) ──────
const fadeUp = (delay = 0, y = 24) => ({
  initial: { opacity: 0, y },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] },
});
const heroContainer = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};
const heroItem = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

// ─── Settings (localStorage) ────────────────────────────────────
const DEFAULT_SETTINGS = {
  garantieText: '12 mois',
  showGarantie: true,
  showTicker: true,
  showOrbit: true,
  showQrCode: true,
  showFooterStats: true,
  showAddress: true,
  showPhone: true,
  rotateSpeed: 7, // seconds
};
const SETTINGS_KEY = 'kp_vitrine_settings_v1';

function useSiteSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
    } catch { return DEFAULT_SETTINGS; }
  });
  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  }, [settings]);
  const update = (patch) => setSettings(s => ({ ...s, ...patch }));
  const reset = () => setSettings(DEFAULT_SETTINGS);
  return [settings, update, reset];
}

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
    // Priorite : image_url (URL externe trouvee via DDG) > image_filename (asset local)
    image: row.image_url
      ? row.image_url
      : row.image_filename
        ? `${API_BASE}/api/iphone-tarifs/image/${encodeURIComponent(row.image_filename)}`
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

// ─── Settings Panel (drawer droite) ────────────────────────────
function SettingsPanel({ open, onClose, settings, update, reset }) {
  if (!open) return null;
  const Toggle = ({ k, label, help }) => (
    <label className="flex items-start gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={settings[k]}
        onChange={e => update({ [k]: e.target.checked })}
        className="mt-0.5 w-4 h-4 rounded accent-violet-500 shrink-0"
      />
      <div className="flex-1">
        <div className="text-sm font-semibold text-white">{label}</div>
        {help && <div className="text-[11px] text-slate-400 mt-0.5">{help}</div>}
      </div>
    </label>
  );
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-fade-in" />
      <div className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-slate-950 border-l border-white/10 shadow-2xl flex flex-col animate-slide-in-right">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 bg-gradient-to-r from-violet-500/10 to-transparent">
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-violet-400" />
            <h2 className="font-display font-extrabold text-lg text-white">Paramètres vitrine</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="Fermer">
            <X className="w-5 h-5 text-slate-300" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <section>
            <h3 className="text-[10px] uppercase tracking-[0.3em] text-violet-300 font-bold mb-2">Garantie</h3>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={settings.garantieText}
                onChange={e => update({ garantieText: e.target.value })}
                className="flex-1 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-400"
                placeholder="ex: 12 mois"
              />
            </div>
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-[0.3em] text-violet-300 font-bold mb-2">Ce qui est affiché</h3>
            <div className="space-y-2">
              <Toggle k="showGarantie" label="Badge garantie" help="Dans le hero du produit." />
              <Toggle k="showTicker" label="Ticker de prix" help="Bandeau qui defile sous le hero." />
              <Toggle k="showOrbit" label="Grille 'Le reste du catalogue'" help="Mini cards sous le ticker." />
              <Toggle k="showFooterStats" label="Badges du footer" help="Garantie / Livraison 24h / Teste." />
              <Toggle k="showQrCode" label="QR code footer" />
              <Toggle k="showAddress" label="Adresse boutique" help="Dans la top bar." />
              <Toggle k="showPhone" label="Numero de telephone" help="Dans la top bar." />
            </div>
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-[0.3em] text-violet-300 font-bold mb-2">Rotation hero</h3>
            <div className="flex items-center gap-2 p-3 rounded-xl bg-white/5">
              <span className="text-sm text-slate-300">Change de produit toutes les</span>
              <input
                type="number"
                min={3}
                max={60}
                value={settings.rotateSpeed}
                onChange={e => update({ rotateSpeed: Math.max(3, Math.min(60, +e.target.value || 7)) })}
                className="w-16 px-2 py-1.5 rounded-lg bg-white/10 border border-white/15 text-white text-sm text-center"
              />
              <span className="text-sm text-slate-300">secondes</span>
            </div>
          </section>
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between">
          <button onClick={reset} className="text-xs text-slate-400 hover:text-white transition-colors">
            Reinitialiser
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-sm font-bold transition-colors">
            Fermer
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Scroll-driven word reveal (pattern Viktor Oddy) ─────────
function ScrollRevealHeading({ text, className }) {
  const ref = useRef(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.9", "start 0.3"],
  });
  const words = text.split(' ');
  if (reduceMotion) {
    return <h3 ref={ref} className={className}>{text}</h3>;
  }
  return (
    <h3 ref={ref} className={className}>
      {words.map((word, i) => (
        <Word key={i} progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]}>
          {word}
        </Word>
      ))}
    </h3>
  );
}
function Word({ progress, range, children }) {
  const opacity = useTransform(progress, range, [0.18, 1]);
  return (
    <motion.span style={{ opacity }} className="inline-block mr-[0.25em]">
      {children}
    </motion.span>
  );
}

// ─── Hero Card (grand format, crossfade) ───────────────────────
function HeroShowcase({ phone, settings }) {
  const minPrice = Math.min(...phone.variants.map(v => v.prix));
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      key={phone.key}
      variants={reduceMotion ? undefined : heroContainer}
      initial={reduceMotion ? undefined : "hidden"}
      animate={reduceMotion ? undefined : "show"}
      className="relative h-full flex items-center gap-12 px-16"
    >
      {/* Left : image — brute, pas d'effet */}
      <motion.div
        variants={reduceMotion ? undefined : heroItem}
        className="relative flex-[1] h-full flex items-center justify-center">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[42rem] h-[42rem] rounded-full bg-gradient-to-br from-violet-500/25 via-fuchsia-500/12 to-amber-500/20 blur-3xl animate-pulse-slow" />
        </div>
        {phone.image && (
          <img
            src={phone.image}
            alt={phone.modele}
            className="relative max-h-[68vh] w-auto object-contain animate-float"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
      </motion.div>

      {/* Right : infos */}
      <div className="relative flex-[1] max-w-xl">
        <motion.div variants={reduceMotion ? undefined : heroItem} className="liquid-glass inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-amber-300 text-xs font-bold uppercase tracking-[0.25em] mb-6">
          <Sparkles className="w-3 h-3" />
          Coup de cœur
        </motion.div>
        <motion.p variants={reduceMotion ? undefined : heroItem} className="font-display text-2xl uppercase tracking-[0.35em] text-violet-300/80 mb-3">
          {phone.marque}{' '}
          <span className="font-editorial normal-case tracking-normal text-amber-200/90 ml-1">
            {phone.grade === 'Neuf' ? 'neuf' : 'reconditionné'}
          </span>
        </motion.p>
        <motion.h2 variants={reduceMotion ? undefined : heroItem} className="font-display font-extrabold text-7xl leading-[0.95] text-white mb-6 tracking-[-0.02em]">
          {phone.modele}
        </motion.h2>
        <motion.div variants={reduceMotion ? undefined : heroItem} className="flex items-center gap-3 flex-wrap mb-8">
          <span className={`liquid-glass inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold
            ${phone.grade === 'Neuf' ? 'text-emerald-300' : 'text-violet-200'}`}>
            {phone.grade === 'Neuf' ? <Sparkles className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
            {phone.grade === 'Neuf' ? 'Neuf' : 'Reconditionné Premium'}
          </span>
          {settings.showGarantie && (
            <span className="liquid-glass inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold text-slate-200">
              <Shield className="w-4 h-4 text-violet-300" />
              Garantie {settings.garantieText}
            </span>
          )}
        </motion.div>

        <motion.div variants={reduceMotion ? undefined : heroItem} className="flex items-end gap-6 mb-10">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-slate-400 mb-2">À partir de</p>
            <p className="font-display font-extrabold text-[7rem] leading-none bg-gradient-to-br from-amber-200 via-amber-400 to-orange-500 bg-clip-text text-transparent">
              {minPrice}€
            </p>
          </div>
        </motion.div>

        <motion.div variants={reduceMotion ? undefined : heroItem} className="flex flex-wrap gap-3">
          {phone.variants.map(v => (
            <div
              key={v.stockage}
              className="liquid-glass px-5 py-3 rounded-2xl text-sm font-semibold text-white"
            >
              <div className="text-base font-bold">{v.stockage}</div>
              <div className="text-amber-300 text-lg mt-0.5">{v.prix}€</div>
            </div>
          ))}
        </motion.div>
      </div>
    </motion.div>
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
        <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
          {phone.image && (
            <img
              src={phone.image}
              alt={phone.modele}
              className="w-full h-full object-contain"
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, updateSettings, resetSettings] = useSiteSettings();

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

  // Featured rotate (configurable) — pause quand l'onglet est cache (iPad lock, TV veille)
  useEffect(() => {
    if (phones.length < 2) return;
    const ms = Math.max(3, settings.rotateSpeed || 7) * 1000;
    let id = null;
    const start = () => {
      if (id) return;
      id = setInterval(() => setHeroIdx(i => (i + 1) % phones.length), ms);
    };
    const stop = () => { if (id) { clearInterval(id); id = null; } };
    const sync = () => (document.visibilityState === 'visible' ? start() : stop());
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { stop(); document.removeEventListener('visibilitychange', sync); };
  }, [phones.length, settings.rotateSpeed]);

  // Orbit rotate (mini cards highlight) — pause aussi quand cache
  useEffect(() => {
    let id = null;
    const start = () => { if (!id) id = setInterval(() => setOrbitIdx(i => i + 1), 2500); };
    const stop = () => { if (id) { clearInterval(id); id = null; } };
    const sync = () => (document.visibilityState === 'visible' ? start() : stop());
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { stop(); document.removeEventListener('visibilitychange', sync); };
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
        @keyframes fade-in { 0% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes slide-in-right { 0% { transform: translateX(100%); opacity: 0; } 100% { transform: translateX(0); opacity: 1; } }
        .animate-fade-in { animation: fade-in 200ms ease-out; }
        .animate-slide-in-right { animation: slide-in-right 300ms cubic-bezier(.2,.8,.2,1); }
        /* Perf : will-change promeut les layers une fois (pas a chaque frame).
           Uniquement sur ce qui bouge en continu — pas sur hero-in (one-shot) */
        .animate-scroll-x { animation: scroll-x 50s linear infinite; will-change: transform; }
        .animate-float { animation: float 6s ease-in-out infinite; will-change: transform; }
        .animate-pulse-slow { animation: pulse-slow 5s ease-in-out infinite; will-change: transform, opacity; }
        .animate-hero-in { animation: hero-in 900ms cubic-bezier(.2,.8,.2,1) both; }
        .animate-drift-a { animation: drift-a 22s ease-in-out infinite; }
        .animate-drift-b { animation: drift-b 28s ease-in-out infinite; }
        .animate-drift-c { animation: drift-c 32s ease-in-out infinite; }
        /* A11y : respecte le systeme prefers-reduced-motion */
        @media (prefers-reduced-motion: reduce) {
          .animate-scroll-x, .animate-float, .animate-pulse-slow,
          .animate-drift-a, .animate-drift-b, .animate-drift-c { animation: none; }
        }
      `}</style>

      {/* Aurora background (permanent motion) */}
      {/* Perf : blur fixe (jamais anime), taille reduite pour limiter la surface GPU,
          will-change: transform pour promouvoir les layers une fois, contain pour
          isoler les repaints. Le layer "shine" fullscreen (background-position) a ete
          retire : il causait un repaint de tout l'ecran chaque frame. */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ contain: 'layout paint' }}>
        <div className="absolute top-[-15%] left-[-8%] w-[40rem] h-[40rem] rounded-full bg-violet-600/25 blur-[100px] animate-drift-a" style={{ willChange: 'transform' }} />
        <div className="absolute top-[30%] right-[-12%] w-[34rem] h-[34rem] rounded-full bg-fuchsia-600/20 blur-[90px] animate-drift-b" style={{ willChange: 'transform' }} />
        <div className="absolute bottom-[-8%] left-[25%] w-[36rem] h-[36rem] rounded-full bg-amber-500/15 blur-[95px] animate-drift-c" style={{ willChange: 'transform' }} />
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
            {settings.showAddress && (
              <div className="hidden md:flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-violet-400" />
                <span className="text-slate-300">79 Pl. Saint-Léger, Chambéry</span>
              </div>
            )}
            {settings.showPhone && (
              <div className="hidden md:flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-amber-400" />
                <span className="text-slate-300 font-semibold">06 95 71 51 96</span>
              </div>
            )}
            <div className="flex flex-col items-end border-l border-white/10 pl-6">
              <p className="font-display font-bold text-2xl tabular-nums leading-none">{timeStr}</p>
              <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400 mt-1 capitalize">{dateStr}</p>
            </div>

            {/* Settings (parametres vitrine) */}
            <button
              onClick={() => setSettingsOpen(true)}
              className="group flex items-center gap-2 px-4 py-2.5 rounded-xl
                bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20
                transition-all duration-200 active:scale-95"
              title="Paramètres de la vitrine"
              aria-label="Paramètres"
            >
              <Settings className="w-4 h-4 text-slate-300 group-hover:rotate-90 transition-transform duration-500" />
              <span className="hidden sm:inline text-xs font-bold uppercase tracking-wider text-slate-200">
                Paramètres
              </span>
            </button>

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
            {featured && <HeroShowcase phone={featured} settings={settings} />}

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
          {settings.showTicker && <PriceTicker phones={phones} />}

          {/* Orbit mini-cards */}
          {settings.showOrbit && (
          <section className="relative z-10 max-w-[1800px] mx-auto px-8 py-10">
            <div className="flex items-baseline justify-between mb-6">
              <div>
                <ScrollRevealHeading
                  text="Le reste du catalogue"
                  className="font-display font-extrabold text-3xl text-white leading-tight"
                />
                <p className="text-sm text-slate-400 mt-1">
                  <span className="font-editorial text-base text-amber-200/90 mr-1">tous</span>
                  les {phones.length - 1} modèles disponibles · mise à jour continue
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
                <motion.div
                  key={phone.key}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.5, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                >
                  <MiniCard phone={phone} highlight={i === 0} />
                </motion.div>
              ))}
            </div>
          </section>
          )}

          {/* Footer */}
          {(settings.showFooterStats || settings.showQrCode) && (
            <footer className="relative z-10 border-t border-white/10 backdrop-blur-xl bg-black/30 mt-10">
              <div className="max-w-[1800px] mx-auto px-8 py-6 flex flex-col md:flex-row items-center justify-between gap-6">
                {settings.showFooterStats ? (
                  <div className="flex items-center gap-6 text-sm text-slate-400 flex-wrap justify-center">
                    <span className="inline-flex items-center gap-2">
                      <Shield className="w-4 h-4 text-violet-400" />
                      Garantie {settings.garantieText}
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
                ) : <div />}

                {settings.showQrCode && (
                  <div className="flex items-center gap-4">
                    <div className="text-right text-xs text-slate-400">
                      <p className="font-semibold text-white text-sm">Scannez pour commander</p>
                      <p className="mt-0.5">klikphone.com</p>
                    </div>
                    <div className="w-16 h-16 rounded-xl bg-white p-2 flex items-center justify-center shadow-xl shadow-violet-500/30">
                      <QrCode className="w-full h-full text-slate-900" strokeWidth={1.2} />
                    </div>
                  </div>
                )}
              </div>
            </footer>
          )}
        </>
      )}

      {/* Settings drawer */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        update={updateSettings}
        reset={resetSettings}
      />
    </div>
  );
}
