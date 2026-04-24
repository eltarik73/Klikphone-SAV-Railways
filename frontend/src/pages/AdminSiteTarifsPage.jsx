import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import {
  Sparkles, Shield, Zap, Package, Check, Star,
  Smartphone, MapPin, Phone, Clock, Tv, Loader2, QrCode,
  Maximize, Minimize, Share2, Settings, X, Mail, ArrowRight,
  User, MessageSquare, Send, ShoppingBag,
} from 'lucide-react';
import api from '../lib/api';

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

// ─── Modal "Demander un devis" (formulaire public) ──────────────
function DevisModal({ open, onClose, defaultModele }) {
  const [nom, setNom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [email, setEmail] = useState('');
  const [modele, setModele] = useState(defaultModele || '');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);

  // Pre-remplit le modele UNE SEULE FOIS a l'ouverture — ne suit plus les
  // changements de defaultModele (sinon la rotation du hero ecrase ce que
  // l'utilisateur est en train de taper toutes les 7 secondes).
  useEffect(() => {
    if (open) {
      setModele(defaultModele || '');
      setDone(false);
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    setErr(null);
    try {
      await api.demandeDevisIphone({ nom, telephone, email, modele, message });
      setDone(true);
      setTimeout(() => { onClose(); }, 5000);
    } catch (e2) {
      setErr(e2.message || 'Erreur envoi');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm animate-fade-in" />
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-none">
        <div className="liquid-glass pointer-events-auto bg-slate-950/95 rounded-3xl border border-white/10 w-full max-w-md shadow-2xl animate-slide-in-right">
          <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                <Mail className="w-5 h-5 text-slate-950" />
              </div>
              <div>
                <h3 className="font-display font-extrabold text-lg text-white leading-tight">
                  Demander un <span className="font-editorial font-normal text-amber-300">devis</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">On vous recontacte rapidement</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="Fermer">
              <X className="w-5 h-5 text-slate-300" />
            </button>
          </div>

          {done ? (
            <div className="px-6 py-10 text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-emerald-300" />
              </div>
              <p className="font-display font-extrabold text-white text-xl mb-2">
                Demande <span className="font-editorial font-normal text-amber-300">bien reçue</span>
              </p>
              <p className="text-sm text-slate-300 mb-2">
                Nous vous recontactons rapidement au <strong className="text-white">{telephone}</strong>.
              </p>
              {email && email.includes('@') && (
                <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-400/30 rounded-lg px-3 py-2 inline-block">
                  📩 Un email de confirmation vient d'être envoyé à <strong>{email}</strong>
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="px-6 py-5 space-y-3">
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-bold">Nom *</span>
                <div className="relative mt-1">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={nom}
                    onChange={e => setNom(e.target.value)}
                    placeholder="Votre nom"
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-400 text-white text-sm outline-none transition"
                  />
                </div>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-bold">Téléphone *</span>
                <div className="relative mt-1">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="tel"
                    required
                    value={telephone}
                    onChange={e => setTelephone(e.target.value)}
                    placeholder="06 12 34 56 78"
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-400 text-white text-sm outline-none transition"
                  />
                </div>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-bold">Email (optionnel)</span>
                <div className="relative mt-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="vous@exemple.com"
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-400 text-white text-sm outline-none transition"
                  />
                </div>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-bold">Modèle souhaité</span>
                <div className="relative mt-1">
                  <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={modele}
                    onChange={e => setModele(e.target.value)}
                    placeholder="iPhone 15 Pro Max 256 Go..."
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-400 text-white text-sm outline-none transition"
                  />
                </div>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-bold">Message</span>
                <div className="relative mt-1">
                  <MessageSquare className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                  <textarea
                    rows={3}
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Couleur, stockage, question..."
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-400 text-white text-sm outline-none transition resize-none"
                  />
                </div>
              </label>

              {err && (
                <div className="text-xs text-rose-400 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-400/30">
                  {err}
                </div>
              )}

              <button
                type="submit"
                disabled={sending}
                className="w-full py-3 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/30 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sending ? 'Envoi...' : 'Envoyer ma demande'}
              </button>
              <p className="text-[10px] text-slate-500 text-center">
                Vos infos sont envoyées directement à Klikphone. Pas de spam.
              </p>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Modal "Passer commande" (selection d'un modele du catalogue) ─
function CommandeModal({ open, onClose, phones }) {
  const [phoneKey, setPhoneKey] = useState('');
  const [variantIdx, setVariantIdx] = useState(0);
  const [nom, setNom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);

  const selectedPhone = phones.find(p => p.key === phoneKey);
  const selectedVariant = selectedPhone?.variants?.[variantIdx];

  useEffect(() => {
    if (open) {
      setPhoneKey('');
      setVariantIdx(0);
      setDone(false);
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => { setVariantIdx(0); }, [phoneKey]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!selectedPhone || !selectedVariant) {
      setErr('Sélectionnez un modèle et un stockage');
      return;
    }
    setSending(true); setErr(null);
    try {
      // Nouvel endpoint dedie : enregistre en DB (dashboard admin) +
      // envoie email admin + email de confirmation au client
      await api.passerCommandeIphone({
        nom, telephone, email,
        marque: selectedPhone.marque,
        modele: selectedPhone.modele,
        stockage: selectedVariant.stockage,
        prix: selectedVariant.prix,
        message,
      });
      setDone(true);
      // Laisse 5s pour que le client voie bien le message de succes
      setTimeout(() => onClose(), 5000);
    } catch (e2) {
      setErr(e2.message || 'Erreur envoi');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm animate-fade-in" />
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 pointer-events-none">
        <div className="liquid-glass pointer-events-auto bg-slate-950/95 rounded-3xl border border-white/10 w-full max-w-md max-h-[92vh] shadow-2xl animate-slide-in-right flex flex-col">
          <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-white/10 bg-slate-950/95 backdrop-blur shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0">
                <ShoppingBag className="w-5 h-5 text-slate-950" />
              </div>
              <div>
                <h3 className="font-display font-extrabold text-lg text-white leading-tight">
                  Passer <span className="font-editorial font-normal text-amber-300">commande</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Choisissez un modèle du catalogue</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 transition-colors shrink-0" aria-label="Fermer">
              <X className="w-5 h-5 text-slate-300" />
            </button>
          </div>

          {done ? (
            <div className="px-6 py-10 text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center mx-auto mb-4 animate-pulse-slow">
                <Check className="w-8 h-8 text-emerald-300" />
              </div>
              <p className="font-display font-extrabold text-white text-xl mb-2">
                Commande <span className="font-editorial font-normal text-amber-300">bien reçue</span>
              </p>
              <p className="text-sm text-slate-300 mb-2">
                Nous vous recontactons rapidement au <strong className="text-white">{telephone}</strong> pour confirmer la disponibilité.
              </p>
              {email && email.includes('@') && (
                <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-400/30 rounded-lg px-3 py-2 inline-block">
                  📩 Un email de confirmation vient d'être envoyé à <strong>{email}</strong>
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="flex-1 flex flex-col min-h-0">
              {/* Corps scrollable */}
              <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-3">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-bold">Modèle *</span>
                  <select
                    required
                    value={phoneKey}
                    onChange={e => setPhoneKey(e.target.value)}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-400 text-white text-sm outline-none transition"
                  >
                    <option value="" className="bg-slate-900">— Choisissez votre modèle —</option>
                    {phones.map(p => (
                      <option key={p.key} value={p.key} className="bg-slate-900">
                        {p.marque} {p.modele}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedPhone && selectedPhone.variants.length > 0 && (
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-bold">Stockage *</span>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      {selectedPhone.variants.map((v, i) => (
                        <button
                          type="button"
                          key={v.stockage}
                          onClick={() => setVariantIdx(i)}
                          className={`px-3 py-2 rounded-xl border text-sm font-semibold text-left transition-all
                            ${i === variantIdx
                              ? 'bg-amber-400/20 border-amber-400 text-white'
                              : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}
                        >
                          <div className="text-xs">{v.stockage}</div>
                          <div className="text-amber-300 text-base mt-0.5">{v.prix}€</div>
                        </button>
                      ))}
                    </div>
                  </label>
                )}

                {/* Nom + Tel sur une ligne pour gagner de la place */}
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-bold">Nom *</span>
                    <input type="text" required value={nom} onChange={e => setNom(e.target.value)}
                      placeholder="Votre nom"
                      className="mt-1 w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-400 text-white text-sm outline-none transition" />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-bold">Téléphone *</span>
                    <input type="tel" required value={telephone} onChange={e => setTelephone(e.target.value)}
                      placeholder="06 12 34 56 78"
                      className="mt-1 w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-400 text-white text-sm outline-none transition" />
                  </label>
                </div>

                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-bold">Email (optionnel)</span>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="vous@exemple.com"
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-400 text-white text-sm outline-none transition" />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-bold">Message (optionnel)</span>
                  <textarea rows={2} value={message} onChange={e => setMessage(e.target.value)}
                    placeholder="Couleur souhaitée, délai..."
                    className="mt-1 w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-400 text-white text-sm outline-none transition resize-none" />
                </label>

                {err && (
                  <div className="text-xs text-rose-400 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-400/30">
                    {err}
                  </div>
                )}
              </div>

              {/* Footer sticky avec recap + submit (toujours visible) */}
              <div className="shrink-0 border-t border-white/10 bg-slate-950/95 backdrop-blur px-5 sm:px-6 py-3 space-y-2">
                {selectedPhone && selectedVariant ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-400 truncate">{selectedPhone.marque} {selectedPhone.modele} · {selectedVariant.stockage}</p>
                      <p className="text-xl font-display font-extrabold text-amber-300">{selectedVariant.prix}€</p>
                    </div>
                    <button type="submit" disabled={sending}
                      className="px-5 py-3 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/30 disabled:opacity-50 transition-all flex items-center gap-2 shrink-0">
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {sending ? 'Envoi…' : 'Valider'}
                    </button>
                  </div>
                ) : (
                  <button type="submit" disabled
                    className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-slate-500 font-bold text-sm cursor-not-allowed">
                    Sélectionnez d'abord un modèle
                  </button>
                )}
                <p className="text-[9px] text-slate-500 text-center">
                  Non engageant — Klikphone vous recontacte pour confirmer.
                </p>
              </div>
            </form>
          )}
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
      className="relative h-full flex flex-col md:flex-row items-center gap-4 md:gap-12 px-4 md:px-16 py-4 md:py-0"
    >
      {/* Left : image — float simple sans effet 3D */}
      <motion.div
        variants={reduceMotion ? undefined : heroItem}
        className="relative w-full md:flex-[1] h-[32vh] md:h-full flex items-center justify-center shrink-0">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[22rem] md:w-[42rem] h-[22rem] md:h-[42rem] rounded-full bg-gradient-to-br from-violet-500/25 via-fuchsia-500/12 to-amber-500/20 blur-3xl animate-pulse-slow" />
        </div>
        {phone.image && (
          <img
            src={phone.image}
            alt={phone.modele}
            className="relative max-h-[28vh] md:max-h-[65vh] w-auto object-contain animate-float"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
      </motion.div>

      {/* Right : infos — stacked mobile, side-by-side desktop */}
      <div className="relative w-full md:flex-[1] md:max-w-xl text-center md:text-left">
        <motion.p variants={reduceMotion ? undefined : heroItem} className="font-display text-sm md:text-2xl uppercase tracking-[0.25em] md:tracking-[0.35em] text-violet-300/80 mb-2 md:mb-3">
          {phone.marque}{' '}
          <span className="font-editorial normal-case tracking-normal text-amber-200/90 ml-1">
            {phone.grade === 'Neuf' ? 'neuf' : 'reconditionné'}
          </span>
        </motion.p>
        <motion.h2 variants={reduceMotion ? undefined : heroItem} className="font-display font-extrabold text-4xl md:text-7xl leading-[0.95] text-white mb-4 md:mb-6 tracking-[-0.02em]">
          {phone.modele}
        </motion.h2>
        <motion.div variants={reduceMotion ? undefined : heroItem} className="flex items-center gap-2 flex-wrap justify-center md:justify-start mb-4 md:mb-8">
          <span className={`liquid-glass inline-flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-bold
            ${phone.grade === 'Neuf' ? 'text-emerald-300' : 'text-violet-200'}`}>
            {phone.grade === 'Neuf' ? <Sparkles className="w-3.5 h-3.5 md:w-4 md:h-4" /> : <Shield className="w-3.5 h-3.5 md:w-4 md:h-4" />}
            {phone.grade === 'Neuf' ? 'Neuf' : 'Reconditionné Premium'}
          </span>
          {settings.showGarantie && (
            <span className="liquid-glass inline-flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-semibold text-slate-200">
              <Shield className="w-3.5 h-3.5 md:w-4 md:h-4 text-violet-300" />
              Garantie {settings.garantieText}
            </span>
          )}
        </motion.div>

        <motion.div variants={reduceMotion ? undefined : heroItem} className="flex items-end justify-center md:justify-start gap-6 mb-6 md:mb-10">
          <div>
            <p className="text-[11px] md:text-sm uppercase tracking-[0.3em] text-slate-400 mb-1 md:mb-2">À partir de</p>
            <p className="font-display font-extrabold text-6xl md:text-[7rem] leading-none bg-gradient-to-br from-amber-200 via-amber-400 to-orange-500 bg-clip-text text-transparent">
              {minPrice}€
            </p>
          </div>
        </motion.div>

        <motion.div variants={reduceMotion ? undefined : heroItem} className="flex flex-wrap justify-center md:justify-start gap-2 md:gap-3">
          {phone.variants.map(v => (
            <div
              key={v.stockage}
              className="liquid-glass px-3 md:px-5 py-2 md:py-3 rounded-xl md:rounded-2xl text-xs md:text-sm font-semibold text-white"
            >
              <div className="text-sm md:text-base font-bold">{v.stockage}</div>
              <div className="text-amber-300 text-base md:text-lg mt-0.5">{v.prix}€</div>
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
      <div className="flex items-center gap-3 md:gap-5 p-3 md:p-5">
        <div className="relative w-20 h-20 md:w-28 md:h-28 shrink-0 flex items-center justify-center">
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
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] md:tracking-[0.3em] text-violet-300 mb-0.5 md:mb-1">
            {phone.marque}
          </p>
          <h3 className="font-display font-extrabold text-base md:text-xl text-white leading-tight">
            {phone.modele}
          </h3>
          <p className="text-[10px] text-slate-400 mt-1 md:mt-2">{phone.grade}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[9px] uppercase tracking-widest text-slate-500">dès</p>
          <p className="font-display font-extrabold text-2xl md:text-3xl bg-gradient-to-br from-amber-300 to-orange-400 bg-clip-text text-transparent">
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
  const [showAllModels, setShowAllModels] = useState(false);
  const [devisModalOpen, setDevisModalOpen] = useState(false);
  const [commandeModalOpen, setCommandeModalOpen] = useState(false);

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
    const others = phones.filter((_, i) => i !== heroIdx);
    // Mode "tous les modeles" : on affiche l'integralite en grille statique
    if (showAllModels) return others;
    // Sinon, fenetre glissante de 6 cards
    if (others.length <= 6) return others;
    const start = orbitIdx % others.length;
    const out = [];
    for (let i = 0; i < 6; i++) out.push(others[(start + i) % others.length]);
    return out;
  }, [phones, heroIdx, orbitIdx, showAllModels]);

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
        <div className="px-4 md:px-8 py-3 md:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            <div className="relative shrink-0">
              <div className="absolute inset-0 bg-violet-500 blur-xl opacity-60" />
              <div className="relative w-9 h-9 md:w-11 md:h-11 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center font-display font-extrabold text-lg md:text-xl">
                K
              </div>
            </div>
            <div className="min-w-0">
              <p className="font-display font-extrabold text-base md:text-xl leading-none truncate">Klikphone</p>
              <p className="hidden sm:block text-[10px] md:text-[11px] uppercase tracking-[0.3em] text-slate-400 mt-1 truncate">Catalogue en temps réel</p>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-6 shrink-0">
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
            <div className="hidden sm:flex flex-col items-end border-l border-white/10 pl-3 md:pl-6">
              <p className="font-display font-bold text-lg md:text-2xl tabular-nums leading-none">{timeStr}</p>
              <p className="hidden md:block text-[10px] uppercase tracking-[0.25em] text-slate-400 mt-1 capitalize">{dateStr}</p>
            </div>

            {/* Settings (parametres vitrine) */}
            <button
              onClick={() => setSettingsOpen(true)}
              className="group flex items-center gap-2 p-2 sm:px-4 sm:py-2.5 rounded-lg sm:rounded-xl
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
              className="group flex items-center gap-2 p-2 sm:px-4 sm:py-2.5 rounded-lg sm:rounded-xl
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
              className="group relative flex items-center gap-2 p-2 sm:px-4 sm:py-2.5 rounded-lg sm:rounded-xl
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
          {/* Intro — titre marketing de la vitrine */}
          <section className="relative z-10 max-w-[1800px] mx-auto px-4 md:px-16 pt-6 md:pt-10 pb-2 md:pb-4 text-center">
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="text-[10px] md:text-xs uppercase tracking-[0.3em] text-violet-300/80 font-bold mb-2 md:mb-3"
            >
              Klikphone vous présente
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
              className="font-display font-extrabold text-2xl sm:text-3xl md:text-5xl lg:text-6xl text-white leading-[1.05] tracking-tight"
            >
              Des téléphones{' '}
              <span className="font-editorial font-normal bg-gradient-to-r from-amber-200 via-amber-400 to-orange-400 bg-clip-text text-transparent">
                100% satisfait
              </span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="text-xs md:text-base text-slate-400 mt-3 md:mt-4 max-w-2xl mx-auto"
            >
              Reconditionnés premium & neufs · testés, garantis {settings.garantieText} · depuis Chambéry
            </motion.p>
          </section>

          {/* Hero auto-rotate */}
          <section className="relative z-10 min-h-[72vh] md:h-[60vh] md:min-h-[480px] max-w-[1800px] mx-auto">
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
          <section className="relative z-10 max-w-[1800px] mx-auto px-4 md:px-8 py-6 md:py-10">
            <div className="flex items-start sm:items-baseline justify-between gap-3 mb-4 md:mb-6">
              <div className="min-w-0">
                <ScrollRevealHeading
                  text="Le reste du catalogue"
                  className="font-display font-extrabold text-2xl md:text-3xl text-white leading-tight"
                />
                <p className="text-xs md:text-sm text-slate-400 mt-1">
                  <span className="font-editorial text-sm md:text-base text-amber-200/90 mr-1">tous</span>
                  les {phones.length - 1} modèles disponibles
                </p>
              </div>
              <div className="flex items-center gap-2 text-[10px] md:text-xs text-slate-400 uppercase tracking-[0.2em] md:tracking-[0.25em] shrink-0">
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
                  viewport={{ once: true, margin: "0px" }}
                  transition={{ duration: 0.5, delay: (showAllModels ? 0 : i * 0.08), ease: [0.22, 1, 0.36, 1] }}
                >
                  <MiniCard phone={phone} highlight={!showAllModels && i === 0} />
                </motion.div>
              ))}
            </div>

            {/* CTA : bouton "Voir tous les modeles" (le devis est dans le FAB permanent) */}
            <div className="mt-10 flex items-center justify-center">
              <button
                onClick={() => setShowAllModels(v => !v)}
                className="group inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white font-semibold transition-all"
              >
                {showAllModels
                  ? <>Mode vitrine <span className="font-editorial font-normal ml-1 text-violet-300">rotatif</span></>
                  : <>Voir <span className="font-editorial font-normal mx-1 text-amber-300">tous</span> les modèles ({phones.length})</>
                }
                <ArrowRight className={`w-4 h-4 transition-transform ${showAllModels ? 'rotate-180' : 'group-hover:translate-x-0.5'}`} />
              </button>
            </div>

            {/* Phrase d'invitation au devis — quand le modele cherché n'est pas dans le catalogue visible */}
            <div className="mt-12 md:mt-16 max-w-2xl mx-auto text-center px-4">
              <p className="font-display font-extrabold text-2xl md:text-3xl text-white leading-tight mb-3">
                Vous ne trouvez pas votre{' '}
                <span className="font-editorial font-normal text-amber-300">modèle</span> ?
              </p>
              <p className="text-sm md:text-base text-slate-400 leading-relaxed mb-5">
                Pas de panique — notre stock bouge chaque semaine et on a souvent{' '}
                <span className="text-slate-200">ce qu'il vous faut en coulisses</span>.
                Précisez-nous votre besoin, on revient vers vous avec le meilleur{' '}
                <span className="font-editorial text-violet-300">tarif</span>.
              </p>
              <button
                onClick={() => setDevisModalOpen(true)}
                className="group inline-flex items-center gap-2 px-6 md:px-8 py-3 md:py-3.5 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-bold shadow-xl shadow-amber-500/30 transition-all"
              >
                <Mail className="w-4 h-4" />
                Demander un <span className="font-editorial font-normal">devis</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </button>
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
                      <Check className="w-4 h-4 text-emerald-400" />
                      Testé avant vente
                    </span>
                  </div>
                ) : <div />}

                {settings.showQrCode && (
                  <button
                    onClick={() => setCommandeModalOpen(true)}
                    className="group inline-flex items-center gap-3 px-5 py-3 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-bold shadow-xl shadow-amber-500/30 transition-all hover:scale-[1.02] active:scale-95"
                  >
                    <ShoppingBag className="w-5 h-5" />
                    <span className="text-sm">
                      Passer <span className="font-editorial font-normal">commande</span>
                    </span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </button>
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

      {/* Modal "Demander un devis" : champ modele libre (pour modele non trouve) */}
      <DevisModal
        open={devisModalOpen}
        onClose={() => setDevisModalOpen(false)}
        defaultModele=""
      />

      {/* Modal "Passer commande" : selection depuis le catalogue affiche */}
      <CommandeModal
        open={commandeModalOpen}
        onClose={() => setCommandeModalOpen(false)}
        phones={phones}
      />

      {/* FAB floating supprime (faisait doublon avec le CTA sous la grille
           et cachait le QR code 'Scannez pour commander' du footer). Le
           bouton 'Demander un devis' reste accessible dans le contenu. */}
    </div>
  );
}
