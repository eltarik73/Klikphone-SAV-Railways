import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Shield, Package, Check, MapPin, Phone, Loader2,
  Maximize, Minimize, Share2, Settings, X, Mail, Send, ShoppingBag,
} from 'lucide-react';
import api from '../lib/api';
import LogoK from '../components/LogoK';
import { useFocusTrap } from '../hooks/useFocusTrap';

// ─── Design de la vitrine (épuré, sans effets) ─────────────────
// Fond slate-900 en aplat, surfaces slate-800 bordées white/10 ; texte blanc / slate-300 / slate-400
// (slate-400 ≥ 5,7:1 sur slate-800) ; action principale en blanc plein (texte slate-900 : l'action est noire
// sur fond clair, inversée sur ce fond sombre), blanc aussi pour l'élément choisi. Ni dégradé, ni flou, ni halo, ni ombre colorée ; rayons 6–12 px ;
// seul mouvement : fondu de 200 ms au changement de produit et bandeau de prix (désactivables).
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900';
const BTN = `inline-flex items-center justify-center gap-2 rounded-lg whitespace-nowrap transition-colors duration-150 ${FOCUS}`;
const BTN_SOMBRE = `${BTN} border border-white/10 bg-slate-800 font-medium text-slate-100 hover:bg-slate-700`;
const BTN_PRINCIPAL = `${BTN} bg-white font-semibold text-slate-900 hover:bg-slate-200 disabled:bg-slate-700 disabled:text-slate-300 disabled:cursor-not-allowed`;
const BTN_DISCRET = `${BTN} font-medium text-slate-300 hover:bg-white/10 hover:text-white`;
const BTN_ICONE = `${BTN} w-11 h-11 shrink-0 text-slate-300 hover:bg-white/10 hover:text-white`;
const TAILLE_M = 'min-h-11 px-4 text-sm';
const TAILLE_L = 'min-h-12 px-5 text-base';
const LIBELLE = 'block text-sm font-medium text-slate-200';
const CHAMP = 'mt-1.5 w-full min-h-11 px-3 py-2.5 rounded-md border border-white/15 bg-slate-900 text-base text-white placeholder:text-slate-500 hover:border-white/25 focus:outline-none focus:border-slate-300 focus:ring-2 focus:ring-white/20 transition-colors duration-150';
const PASTILLE = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-white/10 bg-slate-800 text-sm font-medium text-slate-200';

// Prix au format français (« 1 299 € », espaces insécables fournis par Intl)
const FORMAT_EUROS = new Intl.NumberFormat('fr-FR', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2,
});
function euros(valeur) {
  const n = Number(valeur);
  return Number.isFinite(n) ? FORMAT_EUROS.format(n) : `${valeur} €`;
}

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
// Défini hors du panneau : un composant recréé à chaque rendu remonterait la case cochée
// et lui ferait perdre le focus clavier.
function ReglageCase({ k, label, help, settings, update }) {
  return (
    <label className="flex items-start gap-3 p-3 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer transition-colors duration-150">
      <input
        type="checkbox"
        checked={settings[k]}
        onChange={e => update({ [k]: e.target.checked })}
        className={`mt-0.5 w-5 h-5 rounded accent-slate-200 shrink-0 ${FOCUS}`}
      />
      <span className="flex-1">
        <span className="block text-sm font-medium text-white">{label}</span>
        {help && <span className="block text-xs text-slate-400 mt-0.5">{help}</span>}
      </span>
    </label>
  );
}

function SettingsPanel({ open, onClose, settings, update, reset }) {
  const panneauRef = useRef(null);
  useFocusTrap(panneauRef, open, { onEscape: onClose });
  if (!open) return null;
  const caseProps = { settings, update };
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-black/60 vitrine-voile" aria-hidden="true" />
      <div
        ref={panneauRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vitrine-reglages-titre"
        className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-slate-900 border-l border-white/10 shadow-lg flex flex-col vitrine-tiroir"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-white/10">
          <h2 id="vitrine-reglages-titre" className="text-base font-semibold text-white">Paramètres de la vitrine</h2>
          <button type="button" onClick={onClose} className={BTN_ICONE} aria-label="Fermer">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          <div>
            <label htmlFor="vitrine-garantie" className={LIBELLE}>Garantie</label>
            <input
              id="vitrine-garantie"
              type="text"
              value={settings.garantieText}
              onChange={e => update({ garantieText: e.target.value })}
              className={CHAMP}
              placeholder="Par exemple 12 mois"
            />
          </div>

          <fieldset>
            <legend className="text-sm font-semibold text-slate-200 mb-2">Ce qui est affiché</legend>
            <div className="space-y-2">
              <ReglageCase k="showGarantie" label="Badge garantie" help="Sous le nom du produit en vitrine." {...caseProps} />
              <ReglageCase k="showTicker" label="Bandeau de prix" help="Bandeau qui défile sous le produit en vitrine." {...caseProps} />
              <ReglageCase k="showOrbit" label="Grille « Le reste du catalogue »" help="Cartes des autres modèles, sous le bandeau." {...caseProps} />
              <ReglageCase k="showFooterStats" label="Mentions du pied de page" help="Garantie, testé avant vente." {...caseProps} />
              <ReglageCase k="showQrCode" label="Bouton « Passer commande » du pied de page" {...caseProps} />
              <ReglageCase k="showAddress" label="Adresse de la boutique" help="Dans la barre du haut." {...caseProps} />
              <ReglageCase k="showPhone" label="Numéro de téléphone" help="Dans la barre du haut." {...caseProps} />
            </div>
          </fieldset>

          <div>
            <label htmlFor="vitrine-rotation" className="text-sm font-semibold text-slate-200">Rotation du produit en vitrine</label>
            <div className="mt-2 flex items-center gap-2 p-3 rounded-lg bg-slate-800 text-sm text-slate-300">
              <span>Change de produit toutes les</span>
              <input
                id="vitrine-rotation"
                type="number"
                min={3}
                max={60}
                value={settings.rotateSpeed}
                onChange={e => update({ rotateSpeed: Math.max(3, Math.min(60, +e.target.value || 7)) })}
                className={`w-20 min-h-11 px-2 rounded-md border border-white/15 bg-slate-900 text-base text-white text-center tabular-nums ${FOCUS}`}
              />
              <span>secondes</span>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between gap-3">
          <button type="button" onClick={reset} className={`${BTN_DISCRET} ${TAILLE_M}`}>
            Réinitialiser
          </button>
          <button type="button" onClick={onClose} className={`${BTN_PRINCIPAL} ${TAILLE_M}`}>
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
  const boiteRef = useRef(null);
  useFocusTrap(boiteRef, open, { onEscape: onClose });

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
      <div onClick={onClose} className="fixed inset-0 z-[90] bg-black/70 vitrine-voile" aria-hidden="true" />
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-none">
        <div
          ref={boiteRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="vitrine-devis-titre"
          className="pointer-events-auto w-full max-w-md max-h-[92vh] overflow-y-auto rounded-xl border border-white/10 bg-slate-800 shadow-lg animate-scale-in"
        >
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-white/10">
            <div>
              <h3 id="vitrine-devis-titre" className="text-lg font-semibold leading-tight text-white">Demander un devis</h3>
              <p className="text-sm text-slate-400 mt-1">On vous recontacte rapidement</p>
            </div>
            <button type="button" onClick={onClose} className={`${BTN_ICONE} -mr-2 -mt-1`} aria-label="Fermer">
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {done ? (
            <div className="px-6 py-10 text-center" role="status">
              <Check className="w-6 h-6 text-emerald-400 mx-auto mb-3" aria-hidden="true" />
              <p className="text-xl font-semibold text-white mb-2">Demande bien reçue</p>
              <p className="text-sm text-slate-300">
                Nous vous recontactons rapidement au <strong className="font-semibold text-white">{telephone}</strong>.
              </p>
              {email && email.includes('@') && (
                <p className="text-sm text-slate-400 mt-2">
                  Un email de confirmation vient d'être envoyé à <strong className="font-medium text-slate-200">{email}</strong>.
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="px-5 py-5 space-y-4">
              <div>
                <label htmlFor="vitrine-devis-nom" className={LIBELLE}>Nom</label>
                <input
                  id="vitrine-devis-nom"
                  type="text"
                  required
                  autoComplete="name"
                  value={nom}
                  onChange={e => setNom(e.target.value)}
                  placeholder="Votre nom"
                  className={CHAMP}
                />
              </div>
              <div>
                <label htmlFor="vitrine-devis-tel" className={LIBELLE}>Téléphone</label>
                <input
                  id="vitrine-devis-tel"
                  type="tel"
                  required
                  autoComplete="tel"
                  value={telephone}
                  onChange={e => setTelephone(e.target.value)}
                  placeholder="06 12 34 56 78"
                  className={CHAMP}
                />
              </div>
              <div>
                <label htmlFor="vitrine-devis-email" className={LIBELLE}>Email (optionnel)</label>
                <input
                  id="vitrine-devis-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="vous@exemple.com"
                  className={CHAMP}
                />
              </div>
              <div>
                <label htmlFor="vitrine-devis-modele" className={LIBELLE}>Modèle souhaité (optionnel)</label>
                <input
                  id="vitrine-devis-modele"
                  type="text"
                  value={modele}
                  onChange={e => setModele(e.target.value)}
                  placeholder="iPhone 15 Pro Max 256 Go…"
                  className={CHAMP}
                />
              </div>
              <div>
                <label htmlFor="vitrine-devis-message" className={LIBELLE}>Message (optionnel)</label>
                <textarea
                  id="vitrine-devis-message"
                  rows={3}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Couleur, stockage, question…"
                  className={`${CHAMP} resize-none`}
                />
              </div>

              {err && <p role="alert" className="text-sm text-red-300">{err}</p>}

              <button
                type="submit"
                disabled={sending}
                aria-busy={sending || undefined}
                className={`${BTN_PRINCIPAL} ${TAILLE_L} w-full`}
              >
                {sending
                  ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
                  : <Send className="w-4 h-4" aria-hidden="true" />}
                {sending ? 'Envoi…' : 'Envoyer ma demande'}
              </button>
              <p className="text-xs text-slate-400 text-center">
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
  const boiteRef = useRef(null);
  useFocusTrap(boiteRef, open, { onEscape: onClose });

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
      <div onClick={onClose} className="fixed inset-0 z-[90] bg-black/70 vitrine-voile" aria-hidden="true" />
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 pointer-events-none">
        <div
          ref={boiteRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="vitrine-commande-titre"
          className="pointer-events-auto w-full max-w-md max-h-[92vh] rounded-xl border border-white/10 bg-slate-800 shadow-lg animate-scale-in flex flex-col"
        >
          <div className="flex items-start justify-between gap-3 px-5 sm:px-6 py-4 border-b border-white/10 shrink-0">
            <div>
              <h3 id="vitrine-commande-titre" className="text-lg font-semibold leading-tight text-white">Passer commande</h3>
              <p className="text-sm text-slate-400 mt-1">Choisissez un modèle du catalogue</p>
            </div>
            <button type="button" onClick={onClose} className={`${BTN_ICONE} -mr-2 -mt-1`} aria-label="Fermer">
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {done ? (
            <div className="px-6 py-10 text-center" role="status">
              <Check className="w-6 h-6 text-emerald-400 mx-auto mb-3" aria-hidden="true" />
              <p className="text-xl font-semibold text-white mb-2">Commande bien reçue</p>
              <p className="text-sm text-slate-300">
                Nous vous recontactons rapidement au <strong className="font-semibold text-white">{telephone}</strong> pour confirmer la disponibilité.
              </p>
              {email && email.includes('@') && (
                <p className="text-sm text-slate-400 mt-2">
                  Un email de confirmation vient d'être envoyé à <strong className="font-medium text-slate-200">{email}</strong>.
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="flex-1 flex flex-col min-h-0">
              {/* Corps scrollable */}
              <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
                <div>
                  <label htmlFor="vitrine-commande-modele" className={LIBELLE}>Modèle</label>
                  <select
                    id="vitrine-commande-modele"
                    required
                    value={phoneKey}
                    onChange={e => setPhoneKey(e.target.value)}
                    className={CHAMP}
                  >
                    <option value="" className="bg-slate-900">Choisissez votre modèle</option>
                    {phones.map(p => (
                      <option key={p.key} value={p.key} className="bg-slate-900">
                        {p.marque} {p.modele}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedPhone && selectedPhone.variants.length > 0 && (
                  <fieldset>
                    <legend className={LIBELLE}>Stockage</legend>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      {selectedPhone.variants.map((v, i) => {
                        const actif = i === variantIdx;
                        return (
                          <button
                            type="button"
                            key={v.stockage}
                            onClick={() => setVariantIdx(i)}
                            aria-pressed={actif}
                            className={`min-h-11 px-3 py-2 rounded-md border text-left transition-colors duration-150 ${FOCUS}
                              ${actif
                                ? 'bg-white border-white text-slate-900'
                                : 'bg-slate-900 border-white/15 text-slate-200 hover:bg-slate-700'}`}
                          >
                            <span className="block text-sm">{v.stockage}</span>
                            <span className="block text-base font-semibold tabular-nums">{euros(v.prix)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                )}

                {/* Nom + Tel sur une ligne pour gagner de la place */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-2">
                  <div>
                    <label htmlFor="vitrine-commande-nom" className={LIBELLE}>Nom</label>
                    <input id="vitrine-commande-nom" type="text" required maxLength={100} autoComplete="name"
                      value={nom} onChange={e => setNom(e.target.value)}
                      placeholder="Votre nom"
                      className={CHAMP} />
                  </div>
                  <div>
                    <label htmlFor="vitrine-commande-tel" className={LIBELLE}>Téléphone</label>
                    <input id="vitrine-commande-tel" type="tel" required maxLength={30} autoComplete="tel"
                      value={telephone} onChange={e => setTelephone(e.target.value)}
                      placeholder="06 12 34 56 78"
                      className={CHAMP} />
                  </div>
                </div>

                <div>
                  <label htmlFor="vitrine-commande-email" className={LIBELLE}>Email (optionnel)</label>
                  <input id="vitrine-commande-email" type="email" autoComplete="email"
                    value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="vous@exemple.com"
                    className={CHAMP} />
                </div>
                <div>
                  <label htmlFor="vitrine-commande-message" className={LIBELLE}>Message (optionnel)</label>
                  <textarea id="vitrine-commande-message" rows={2} value={message} onChange={e => setMessage(e.target.value)}
                    placeholder="Couleur souhaitée, délai…"
                    className={`${CHAMP} resize-none`} />
                </div>

                {err && <p role="alert" className="text-sm text-red-300">{err}</p>}
              </div>

              {/* Footer sticky avec recap + submit (toujours visible) */}
              <div className="shrink-0 border-t border-white/10 px-5 sm:px-6 py-3 space-y-2">
                {selectedPhone && selectedVariant ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-400 truncate">{selectedPhone.marque} {selectedPhone.modele} · {selectedVariant.stockage}</p>
                      <p className="text-xl font-semibold tabular-nums text-white">{euros(selectedVariant.prix)}</p>
                    </div>
                    <button type="submit" disabled={sending} aria-busy={sending || undefined}
                      className={`${BTN_PRINCIPAL} ${TAILLE_L} shrink-0`}>
                      {sending
                        ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
                        : <Send className="w-4 h-4" aria-hidden="true" />}
                      {sending ? 'Envoi…' : 'Valider la commande'}
                    </button>
                  </div>
                ) : (
                  <button type="submit" disabled className={`${BTN_PRINCIPAL} ${TAILLE_L} w-full`}>
                    Sélectionnez d'abord un modèle
                  </button>
                )}
                <p className="text-xs text-slate-400 text-center">
                  Non engageant : Klikphone vous recontacte pour confirmer.
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Produit en vitrine (grand format, fondu au changement) ────
function HeroShowcase({ phone, settings }) {
  const minPrice = Math.min(...phone.variants.map(v => v.prix));
  const neuf = phone.grade === 'Neuf';

  return (
    <div
      key={phone.key}
      className="vitrine-fondu relative h-full flex flex-col md:flex-row items-center gap-6 md:gap-16 px-4 md:px-16 py-4 md:py-0"
    >
      {/* Photo seule, sans halo ni flottement */}
      <div className="relative w-full md:flex-1 h-[32vh] md:h-full flex items-center justify-center shrink-0">
        {phone.image && (
          <img
            src={phone.image}
            alt={phone.modele}
            className="max-h-[28vh] md:max-h-[60vh] w-auto object-contain"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
      </div>

      {/* Infos — empilées sur mobile, côte à côte sur grand écran */}
      <div className="relative w-full md:flex-1 md:max-w-xl text-center md:text-left">
        <p className="text-base md:text-xl text-slate-400 mb-2 md:mb-3">
          {phone.marque} {neuf ? 'neuf' : 'reconditionné'}
        </p>
        <h2 className="text-4xl md:text-5xl font-semibold leading-[1.05] tracking-tight text-white mb-4 md:mb-5">
          {phone.modele}
        </h2>
        <div className="flex items-center gap-2 flex-wrap justify-center md:justify-start mb-6 md:mb-10">
          <span className={PASTILLE}>
            {neuf
              ? <Package className="w-4 h-4 text-slate-400" aria-hidden="true" />
              : <Shield className="w-4 h-4 text-slate-400" aria-hidden="true" />}
            {neuf ? 'Neuf' : 'Reconditionné Premium'}
          </span>
          {settings.showGarantie && (
            <span className={PASTILLE}>
              <Shield className="w-4 h-4 text-slate-400" aria-hidden="true" />
              Garantie {settings.garantieText}
            </span>
          )}
        </div>

        <div className="mb-6 md:mb-10">
          <p className="text-sm md:text-base text-slate-400 mb-1 md:mb-2">À partir de</p>
          <p className="text-5xl md:text-7xl font-semibold leading-none tracking-tight tabular-nums text-white">
            {euros(minPrice)}
          </p>
        </div>

        <ul className="flex flex-wrap justify-center md:justify-start gap-2 md:gap-3" aria-label="Prix selon le stockage">
          {phone.variants.map(v => (
            <li key={v.stockage} className="rounded-lg border border-white/10 bg-slate-800 px-4 py-2.5 md:px-5 md:py-3 text-left">
              <span className="block text-sm text-slate-300">{v.stockage}</span>
              <span className="block text-lg md:text-xl font-semibold tabular-nums text-white">{euros(v.prix)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── Ticker (marquee continuous) ───────────────────────────────
// Seule animation continue de la page (désactivable dans les paramètres) ; arrêtée et
// défilable à la main quand le système demande de réduire les animations.
function PriceTicker({ phones }) {
  // Duplicate for seamless loop
  const loop = [...phones, ...phones];
  return (
    <div className="relative overflow-hidden motion-reduce:overflow-x-auto border-y border-white/10 bg-slate-950">
      <div className="flex vitrine-defile whitespace-nowrap py-4">
        {loop.map((p, i) => {
          if (!p.variants.length) return null;
          const min = Math.min(...p.variants.map(v => v.prix));
          return (
            <div
              key={`${p.key}-${i}`}
              aria-hidden={i >= phones.length || undefined}
              className="flex items-center gap-3 px-8 shrink-0"
            >
              <span className="text-sm text-slate-400">{p.marque}</span>
              <span className="text-xl font-semibold text-white">{p.modele}</span>
              <span className="text-xl font-semibold tabular-nums text-slate-300">dès {euros(min)}</span>
              <span className="w-1 h-1 rounded-full bg-white/25 ml-4" aria-hidden="true" />
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
    <div className={`rounded-xl border bg-slate-800 transition-colors duration-150
      ${highlight ? 'border-white/30' : 'border-white/10'}`}
    >
      <div className="flex items-center gap-3 md:gap-5 p-3 md:p-4">
        <div className="w-20 h-20 md:w-28 md:h-28 shrink-0 flex items-center justify-center">
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
          <p className="text-sm text-slate-400">{phone.marque}</p>
          <h3 className="text-base md:text-lg font-semibold leading-tight text-white">
            {phone.modele}
          </h3>
          <p className="text-sm text-slate-400 mt-1">{phone.grade}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm text-slate-400">dès</p>
          <p className="text-2xl md:text-3xl font-semibold tracking-tight tabular-nums text-white">
            {euros(min)}
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
        setShareLabel('Lien partagé');
      } else {
        await navigator.clipboard.writeText(url);
        setShareLabel('Lien copié');
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
  const btnBarre = `${BTN_SOMBRE} min-h-11 min-w-11 px-3 sm:px-4 text-sm`;

  return (
    <div className="relative min-h-screen bg-slate-900 text-white overflow-hidden [color-scheme:dark]">
      {/* Mouvements de la vitrine : fondus courts (voile, produit), tiroir, bandeau de prix.
          Tous coupés quand le système demande de réduire les animations. */}
      <style>{`
        @keyframes vitrine-defile { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        @keyframes vitrine-fondu { 0% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes vitrine-tiroir { 0% { transform: translateX(100%); } 100% { transform: translateX(0); } }
        .vitrine-voile, .vitrine-fondu { animation: vitrine-fondu 200ms ease-out; }
        .vitrine-tiroir { animation: vitrine-tiroir 250ms cubic-bezier(.2,.8,.2,1); }
        /* Perf : will-change uniquement sur ce qui bouge en continu */
        .vitrine-defile { animation: vitrine-defile 50s linear infinite; will-change: transform; }
        @media (prefers-reduced-motion: reduce) {
          .vitrine-defile, .vitrine-voile, .vitrine-fondu, .vitrine-tiroir { animation: none; }
        }
      `}</style>

      {/* Top bar */}
      <header className="relative z-10 border-b border-white/10 bg-slate-900">
        <div className="px-4 md:px-8 py-3 md:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <LogoK className="w-9 h-9 md:w-11 md:h-11" />
            <div className="min-w-0">
              <p className="text-base md:text-xl font-semibold leading-none truncate">Klikphone</p>
              <p className="hidden sm:block text-sm text-slate-400 mt-1 truncate">Catalogue en temps réel</p>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-6 shrink-0">
            {settings.showAddress && (
              <div className="hidden md:flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-slate-400" aria-hidden="true" />
                <span className="text-slate-300">79 Pl. Saint-Léger, Chambéry</span>
              </div>
            )}
            {settings.showPhone && (
              <div className="hidden md:flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-slate-400" aria-hidden="true" />
                <span className="text-slate-300 font-medium tabular-nums">06 95 71 51 96</span>
              </div>
            )}
            <div className="hidden sm:flex flex-col items-end border-l border-white/10 pl-3 md:pl-6">
              <p className="text-lg md:text-2xl font-semibold tabular-nums leading-none">{timeStr}</p>
              <p className="hidden md:block text-sm text-slate-400 mt-1 first-letter:uppercase">{dateStr}</p>
            </div>

            <div className="flex items-center gap-2">
              {/* Settings (parametres vitrine) */}
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className={btnBarre}
                title="Paramètres de la vitrine"
                aria-label="Paramètres"
              >
                <Settings className="w-4 h-4 text-slate-300" aria-hidden="true" />
                <span className="hidden sm:inline">Paramètres</span>
              </button>

              {/* Share link */}
              <button
                type="button"
                onClick={share}
                className={btnBarre}
                title="Copier le lien pour iPad / TV"
                aria-label="Partager"
              >
                <Share2 className="w-4 h-4 text-slate-300" aria-hidden="true" />
                <span className="hidden sm:inline">{shareLabel}</span>
              </button>
              <span className="sr-only" aria-live="polite">{shareLabel !== 'Partager' ? shareLabel : ''}</span>

              {/* Fullscreen toggle (iPad / TV kiosk) */}
              <button
                type="button"
                onClick={toggleFullscreen}
                className={btnBarre}
                title={isFullscreen ? 'Quitter plein écran (F ou Échap)' : 'Plein écran (F)'}
                aria-label={isFullscreen ? 'Quitter plein écran' : 'Plein écran'}
              >
                {isFullscreen
                  ? <Minimize className="w-4 h-4 text-slate-300" aria-hidden="true" />
                  : <Maximize className="w-4 h-4 text-slate-300" aria-hidden="true" />}
                <span className="hidden sm:inline">{isFullscreen ? 'Quitter' : 'Plein écran'}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      {loading ? (
        <div className="relative z-10 flex flex-col items-center justify-center gap-3 py-40" role="status">
          <Loader2 className="w-6 h-6 text-slate-400 motion-safe:animate-spin" aria-hidden="true" />
          <p className="text-sm text-slate-400">Synchronisation du catalogue…</p>
        </div>
      ) : error ? (
        <div className="relative z-10 text-center py-40 px-4">
          <p role="alert" className="text-red-300 font-medium">Le catalogue n'a pas pu être chargé : {error}</p>
        </div>
      ) : (
        <>
          {/* Intro — titre de la vitrine */}
          <section className="relative z-10 max-w-[1800px] mx-auto px-4 md:px-16 pt-8 md:pt-12 pb-2 md:pb-4 text-center">
            <p className="text-sm md:text-base text-slate-400 mb-2 md:mb-3">
              Klikphone vous présente
            </p>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-semibold leading-[1.1] tracking-tight text-white">
              Des téléphones <span className="whitespace-nowrap">100 % satisfait</span>
            </h1>
            <p className="text-base md:text-lg text-slate-300 mt-3 md:mt-4 max-w-2xl mx-auto">
              Reconditionnés premium et neufs, testés et garantis {settings.garantieText}, depuis Chambéry.
            </p>
          </section>

          {/* Hero auto-rotate */}
          <section className="relative z-10 min-h-[72vh] md:h-[60vh] md:min-h-[480px] max-w-[1800px] mx-auto">
            {featured && <HeroShowcase phone={featured} settings={settings} />}

            {/* Progress dots */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2" aria-hidden="true">
              {phones.slice(0, Math.min(phones.length, 12)).map((_, i) => (
                <span
                  key={i}
                  className={`h-1 rounded-full transition-colors duration-150
                    ${i === (heroIdx % 12) ? 'w-8 bg-white' : 'w-2 bg-white/25'}`}
                />
              ))}
            </div>
          </section>

          {/* Ticker marquee */}
          {settings.showTicker && <PriceTicker phones={phones} />}

          {/* Orbit mini-cards */}
          {settings.showOrbit && (
          <section className="relative z-10 max-w-[1800px] mx-auto px-4 md:px-8 py-8 md:py-12">
            <div className="flex items-start sm:items-baseline justify-between gap-3 mb-4 md:mb-6">
              <div className="min-w-0">
                <h2 className="text-2xl md:text-3xl font-semibold leading-tight tracking-tight text-white">
                  Le reste du catalogue
                </h2>
                <p className="text-sm md:text-base text-slate-400 mt-1">
                  Tous les {phones.length - 1} modèles disponibles
                </p>
              </div>
              <p className="text-sm text-slate-400 shrink-0">Mise à jour continue</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              {orbit.map((phone, i) => (
                <MiniCard key={phone.key} phone={phone} highlight={!showAllModels && i === 0} />
              ))}
            </div>

            {/* Bouton "Voir tous les modeles" (le devis est sous la grille) */}
            <div className="mt-8 flex items-center justify-center">
              <button
                type="button"
                onClick={() => setShowAllModels(v => !v)}
                className={`${BTN_SOMBRE} ${TAILLE_M}`}
              >
                {showAllModels ? 'Mode vitrine rotatif' : `Voir tous les modèles (${phones.length})`}
              </button>
            </div>

            {/* Phrase d'invitation au devis — quand le modele cherché n'est pas dans le catalogue visible */}
            <div className="mt-12 md:mt-16 max-w-2xl mx-auto text-center px-4">
              <h2 className="text-2xl md:text-3xl font-semibold leading-tight tracking-tight text-white mb-3">
                Vous ne trouvez pas votre modèle ?
              </h2>
              <p className="text-base text-slate-300 leading-relaxed mb-5">
                Pas de panique : notre stock bouge chaque semaine et on a souvent ce qu'il vous faut en coulisses.
                Précisez-nous votre besoin, on revient vers vous avec le meilleur tarif.
              </p>
              <button
                type="button"
                onClick={() => setDevisModalOpen(true)}
                className={`${BTN_SOMBRE} ${TAILLE_L}`}
              >
                <Mail className="w-4 h-4 text-slate-300" aria-hidden="true" />
                Demander un devis
              </button>
            </div>
          </section>
          )}

          {/* Footer */}
          {(settings.showFooterStats || settings.showQrCode) && (
            <footer className="relative z-10 border-t border-white/10 mt-10">
              <div className="max-w-[1800px] mx-auto px-4 md:px-8 py-6 flex flex-col md:flex-row items-center justify-between gap-6">
                {settings.showFooterStats ? (
                  <ul className="flex items-center gap-6 text-sm text-slate-300 flex-wrap justify-center">
                    <li className="inline-flex items-center gap-2">
                      <Shield className="w-4 h-4 text-slate-400" aria-hidden="true" />
                      Garantie {settings.garantieText}
                    </li>
                    <li className="inline-flex items-center gap-2">
                      <Check className="w-4 h-4 text-slate-400" aria-hidden="true" />
                      Testé avant vente
                    </li>
                  </ul>
                ) : <div />}

                {settings.showQrCode && (
                  <button
                    type="button"
                    onClick={() => setCommandeModalOpen(true)}
                    className={`${BTN_PRINCIPAL} ${TAILLE_L}`}
                  >
                    <ShoppingBag className="w-5 h-5" aria-hidden="true" />
                    Passer commande
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
