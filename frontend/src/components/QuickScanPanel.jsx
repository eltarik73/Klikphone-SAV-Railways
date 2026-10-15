import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Volume2, VolumeX, ScanLine, Phone, MessageCircle, Smartphone, UserRound, Wallet,
  StickyNote, Printer, ExternalLink, PackageCheck, Play, CircleCheckBig, AlertTriangle,
  Loader2, Clock, ShieldCheck, HandCoins, Info, Receipt,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './Toast';
import { invalidateCache } from '../hooks/useApi';
import api from '../lib/api';
import { formatDateShort, formatPrix, getStatusConfig, waLink } from '../lib/utils';
import { SCAN_EVENT } from '../lib/scan';
import StatusBadge from './StatusBadge';
import ProgressTracker from './ProgressTracker';
import { isScanSoundOn, setScanSoundOn, playScanSound, takePendingScan } from './ScanListener';

const PrintDrawer = lazy(() => import('./PrintDrawer'));

const TERMINE = 'Réparation terminée';
const EN_COURS = 'En cours de réparation';
const RENDUS = ['Rendu au client', 'Clôturé'];
const DEMARRABLES = ['En attente de diagnostic', 'Pièce reçue', 'En attente de pièce', "En attente d'accord client"];
const UNDO_MS = 5000;
export const MODES_PAIEMENT = ['CB', 'Espèces', 'Chèque', 'Virement', 'Autre'];
export const TICKET_UPDATED_EVENT = 'kp:ticket-updated';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), '
  + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2';

// ─── Fonctions pures (testées dans tests/scan.test.js) ───────────────────────

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

/** Lignes de réparation du ticket (JSON de la fiche, sinon ancien format panne + supplément). */
export function lignesTicket(t) {
  const rs = String(t?.reparation_supp ?? '').trim();
  if (rs.startsWith('[')) {
    try {
      const arr = JSON.parse(rs);
      if (Array.isArray(arr)) {
        return arr
          .filter((l) => l && String(l.label ?? '').trim())
          .map((l) => ({ label: String(l.label).trim(), prix: num(l.prix) }));
      }
    } catch { /* ancien format */ }
  }
  const lignes = [];
  if (String(t?.panne ?? '').trim()) lignes.push({ label: String(t.panne).trim(), prix: num(t.devis_estime) });
  if (rs && !rs.startsWith('[')) lignes.push({ label: rs, prix: num(t.prix_supp) });
  return lignes;
}

/**
 * Montants du ticket. Le serveur (GET /api/tickets/{id}) les calcule et contrôle le montant
 * encaissé à la restitution : ils font foi. Repli sur les règles de la fiche (lignes ou devis
 * estimé, réduction %/€, TVA, acompte) si la réponse ne les contient pas.
 */
export function montantsTicket(t, tvaRate = 0) {
  const srv = t?.montants;
  if (srv && typeof srv === 'object' && Number.isFinite(Number(srv.reste))) {
    const paye = srv.paye === true || Number(t?.paye) === 1;
    const lignes = Array.isArray(srv.lignes)
      ? srv.lignes.filter((l) => String(l?.label ?? '').trim()).map((l) => ({ label: String(l.label).trim(), prix: num(l.prix) }))
      : lignesTicket(t);
    const somme = lignes.reduce((acc, l) => acc + l.prix, 0);
    return {
      lignes,
      total: num(srv.total),
      acompte: num(srv.acompte),
      reste: paye ? 0 : Math.max(0, num(srv.reste)),
      paye,
      estime: srv.source ? srv.source === 'devis_estime' : somme === 0 && num(t?.devis_estime) > 0,
      // Devis refusé appliqué par le serveur : seules les lignes de frais (diagnostic…) sont dues
      refusServeur: srv.refus_devis === true,
      serveur: true,
    };
  }
  const lignes = lignesTicket(t);
  const somme = lignes.reduce((s, l) => s + l.prix, 0);
  const devis = num(t?.devis_estime);
  const estime = somme === 0 && devis > 0;
  const base = estime ? devis : somme;
  const pct = num(t?.reduction_pourcentage);
  const reduction = pct > 0 ? base * (pct / 100) : num(t?.reduction_montant);
  const ht = base - reduction;
  const total = round2(tvaRate > 0 ? ht * (1 + tvaRate / 100) : ht);
  const acompte = num(t?.acompte);
  const paye = Number(t?.paye) === 1 || t?.paye === true;
  const reste = paye ? 0 : Math.max(0, round2(total - acompte));
  return { lignes, total, acompte, reste, paye, estime, refusServeur: false, serveur: false };
}

/** date_rendu / date_cloture sont du TEXTE (« 2026-10-15 14:32:00 ») : reformatées sans conversion. */
export function formatDateTexte(s) {
  const v = String(s ?? '').trim();
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return v;
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}

export function estRendu(t) {
  return RENDUS.includes(t?.statut);
}

export function pretEnCours(t) {
  const rendu = t?.telephone_pret_rendu === true || Number(t?.telephone_pret_rendu) === 1;
  return !!String(t?.telephone_pret ?? '').trim() && !rendu;
}

/** Devis refusé : issue posée par le serveur, ou dernière décision « ❌ Devis… » des notes (récentes d'abord). */
export function devisRefuse(t, notes = []) {
  if (estRendu(t)) return false;
  if (t?.issue === 'refus_devis') return true;
  const decision = (notes || []).find((n) => /^(✅|❌) Devis/.test(String(n?.contenu ?? '').trim()));
  return String(decision?.contenu ?? '').trim().startsWith('❌');
}

/**
 * Le reste dû vient d'un devis qui n'a pas été exécuté : 'refus' (devis refusé sans la règle « frais
 * seuls » du serveur) ou 'estime' (rendu en l'état au devis estimé). À facturer depuis la fiche.
 */
export function montantAVerifier(t, m, notes = []) {
  if (estRendu(t) || !(m?.reste > 0)) return null;
  if (devisRefuse(t, notes) && !m.refusServeur) return 'refus';
  if (m.estime && t?.statut !== TERMINE) return 'estime';
  return null;
}

export function imeiCourt(imei) {
  const d = String(imei ?? '').replace(/\D/g, '');
  return d.length >= 4 ? `…${d.slice(-4)}` : '';
}

export function modeleTicket(t) {
  const modele = t?.modele && t.modele !== 'Autre' ? t.modele : t?.modele_autre;
  return [t?.marque, modele].filter((v) => String(v ?? '').trim()).join(' ') || t?.categorie || 'Appareil';
}

/** Actions proposées selon le rôle et le statut (la première « primary » est mise en avant). */
export function actionsTicket(t, role, notes = []) {
  const statut = t?.statut || '';
  const out = [];
  if (role === 'tech') {
    if (statut === EN_COURS) {
      out.push({ id: 'terminer', statut: TERMINE, label: 'Réparation terminée', primary: true });
    } else if (DEMARRABLES.includes(statut)) {
      let warn = null;
      if (statut === 'En attente de pièce') {
        warn = { text: 'La pièce n’est pas encore marquée reçue. Démarrer la réparation quand même ?', ok: 'Oui, démarrer' };
      } else if (statut === "En attente d'accord client") {
        // Le serveur enregistre alors le devis comme accepté au comptoir
        warn = { text: 'Le client a-t-il accepté le devis ? Démarrer l’enregistre comme validé au comptoir.', ok: 'Oui, devis accepté' };
      }
      out.push({ id: 'demarrer', statut: EN_COURS, label: 'Démarrer la réparation', primary: true, warn });
    }
  }
  if (!estRendu(t) && statut !== 'Pré-enregistré') {
    const termine = statut === TERMINE;
    const aFacturer = !!montantAVerifier(t, montantsTicket(t), notes);
    if (aFacturer) {
      out.push({ id: 'facturer', label: 'Ouvrir la fiche pour facturer', primary: !out.some((a) => a.primary) });
    }
    out.push({
      id: 'rendre',
      label: termine ? 'Rendre au client' : 'Rendre en l’état…',
      primary: termine && !aFacturer && !out.some((a) => a.primary),
    });
  }
  if (statut === 'Rendu au client' && !montantsTicket(t).paye && typeof api.setPaye === 'function') {
    out.push({ id: 'encaisser', label: 'Encaisser le solde', primary: true });
  }
  return out;
}

export const CONSEILS_FACTURATION = {
  refus: 'Devis refusé : le reste à payer vient du devis. Si rien n’est facturé, passez les prix à 0 € (ou au seul diagnostic) sur la fiche avant la remise.',
  estime: 'Montant du devis estimé alors que la réparation n’est pas terminée : vérifiez sur la fiche ce qui est facturé avant la remise.',
};

export function alertesTicket(t, m, notes = []) {
  const out = [];
  const attention = String(t?.attention ?? '').trim();
  if (attention) out.push({ id: 'attention', level: 'danger', text: attention });
  const verifier = montantAVerifier(t, m, notes);
  if (verifier) {
    out.push({ id: 'facturation', level: 'warning', text: CONSEILS_FACTURATION[verifier] });
  } else if (devisRefuse(t, notes)) {
    out.push({
      id: 'facturation',
      level: 'warning',
      text: m.reste > 0 ? 'Devis refusé : seuls les frais (diagnostic…) restent dus.' : 'Devis refusé : rien à facturer, appareil rendu en l’état.',
    });
  }
  if (pretEnCours(t)) {
    const imei = imeiCourt(t.telephone_pret_imei);
    out.push({
      id: 'pret',
      level: 'warning',
      text: `Téléphone de prêt à récupérer : ${String(t.telephone_pret).trim()}${imei ? ` (IMEI\u00a0${imei.replace('…', '…\u2060')})` : ''}`,
    });
  }
  if (m.reste > 0) {
    out.push({
      id: 'reste',
      level: 'danger',
      text: estRendu(t) ? `Impayé : ${formatPrix(m.reste)} restent dus` : `Reste à payer : ${formatPrix(m.reste)}`,
    });
  }
  if (estRendu(t)) {
    const quand = t.date_rendu ? ` le ${formatDateTexte(t.date_rendu)}` : '';
    const qui = t.rendu_par ? ` par ${t.rendu_par}` : '';
    out.push({
      id: 'rendu',
      level: 'info',
      text: quand || qui ? `Appareil déjà rendu${quand}${qui}.` : `Ticket « ${t.statut} ».`,
    });
  }
  return out;
}

export function etatRestitutionInitial(m) {
  return {
    paiement: m.reste > 0 ? 'encaisser' : 'deja_paye',
    mode: '',
    motif: '',
    pretOk: false,
    forceOk: false,
    reste: null,
    error: null,
    submitting: false,
  };
}

function resteEffectif(m, s) {
  return s?.reste != null ? s.reste : m.reste;
}

/** Garde-fous de la remise, identiques à ceux du serveur : null si la remise peut partir. */
export function verifierRestitution(t, m, s) {
  if (t?.statut !== TERMINE && !s.forceOk) {
    return { field: 'force', message: 'Confirmez la remise d’un appareil dont la réparation n’est pas terminée.' };
  }
  if (pretEnCours(t) && !s.pretOk) {
    return { field: 'pret', message: 'Récupérez d’abord le téléphone de prêt.' };
  }
  if (resteEffectif(m, s) > 0) {
    if (s.paiement === 'encaisser' && !s.mode) return { field: 'mode', message: 'Choisissez le mode de paiement.' };
    if (s.paiement === 'non_paye' && !String(s.motif ?? '').trim()) {
      return { field: 'motif', message: 'Indiquez pourquoi le client ne règle pas maintenant.' };
    }
  }
  return null;
}

/** Corps de POST /api/tickets/{id}/restitution. */
export function corpsRestitution(t, m, s) {
  const reste = resteEffectif(m, s);
  const paiement = reste > 0 ? s.paiement : 'deja_paye';
  return {
    paiement,
    mode_paiement: paiement === 'encaisser' ? s.mode || null : null,
    montant: paiement === 'encaisser' ? reste : null,
    motif_non_paye: paiement === 'non_paye' ? String(s.motif).trim() : null,
    pret_restitue: pretEnCours(t) ? !!s.pretOk : null,
    confirmer_non_termine: t?.statut !== TERMINE && !!s.forceOk,
  };
}

export function scanErrorMessage(err, scan) {
  const label = scan?.label || scan?.query || '';
  const msg = String(err?.message ?? '');
  if (err?.status === 404 || /aucun|introuvable|non trouv/i.test(msg)) {
    return scan?.kind === 'ticket' ? `Code inconnu : ${label}` : `Aucun ticket avec ${label}`;
  }
  if (err?.status === 429) return 'Trop de requêtes : réessayez dans quelques secondes.';
  if (err?.name === 'TypeError' || /failed to fetch|load failed|network|injoignable/i.test(msg)) {
    return 'Serveur injoignable : vérifiez la connexion.';
  }
  if (/timeout|expir/i.test(msg)) return 'Le serveur ne répond pas (délai dépassé).';
  return msg || 'Erreur lors de la lecture du code.';
}

/**
 * Jours calendaires (heure locale) depuis le dépôt. date_depot est un horodatage UTC sans fuseau,
 * lu comme « déposé le … » (parseUTC de lib/utils) pour que les deux affichages concordent.
 */
export function joursDepuis(d, now = new Date()) {
  if (!d) return null;
  const s = String(d).trim();
  const jourSeul = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = jourSeul
    ? new Date(Number(jourSeul[1]), Number(jourSeul[2]) - 1, Number(jourSeul[3]))
    : new Date(/(?:z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return null;
  const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.max(0, Math.round((jour(now) - jour(date)) / 86_400_000));
}

function onlyDigits(v) {
  return String(v ?? '').replace(/\D/g, '');
}

const VERIFIED_LABELS = {
  ticket: '2e scan identique',
  imei: 'IMEI de l’appareil vérifié',
  pret: 'Téléphone de prêt scanné',
};

// « 79,00 » comme les lignes d'historique écrites par le serveur
function euros(n) {
  return num(n).toFixed(2).replace('.', ',');
}

function formatTel(tel) {
  const d = String(tel ?? '').replace(/\D/g, '');
  return d.length === 10 ? d.replace(/(\d{2})(?=\d)/g, '$1 ') : String(tel ?? '');
}

function notifyTicketUpdated(id, ticket) {
  window.dispatchEvent(new CustomEvent(TICKET_UPDATED_EVENT, { detail: { id, ticket: ticket || null } }));
}

function errorData(err) {
  return err?.data && typeof err.data === 'object' && !Array.isArray(err.data) ? err.data : null;
}

// ─── Panneau ─────────────────────────────────────────────────────────────────

export default function QuickScanPanel() {
  const { user } = useAuth();
  if (user?.target !== 'accueil' && user?.target !== 'tech') return null;
  return <QuickScanHost key={`${user.target}:${user.utilisateur}`} user={user} />;
}

function QuickScanHost({ user }) {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const navigate = useNavigate();
  const role = user.target === 'tech' ? 'tech' : 'accueil';
  const basePath = `/${role}`;

  const [lookup, setLookup] = useState(null);
  const [view, setView] = useState(null);
  const [deferred, setDeferred] = useState(null);
  const [printing, setPrinting] = useState(null);
  const [tva, setTva] = useState(0);

  const seqRef = useRef(0);
  const viewRef = useRef(null);
  viewRef.current = view;
  const busyRef = useRef(false);
  const wizardRef = useRef(false);
  const deferredRef = useRef(null);
  const tvaRef = useRef(false);

  const loadTva = useCallback(() => {
    if (tvaRef.current) return;
    tvaRef.current = true;
    api.getCached('/api/config', 300_000)
      .then((params) => {
        const p = Array.isArray(params) ? params.find((x) => x.cle === 'tva') : null;
        setTva(parseFloat(p?.valeur) || 0);
      })
      .catch(() => { tvaRef.current = false; });
  }, []);

  const fetchTicket = useCallback(async (id) => {
    const [ticket, notes] = await Promise.all([
      api.getTicket(id),
      api.getNotes(id).catch(() => []),
    ]);
    return { ticket, notes: Array.isArray(notes) ? notes : [] };
  }, []);

  const reload = useCallback(async (id) => {
    try {
      const data = await fetchTicket(id);
      setView((v) => (v && v.id === id ? { ...v, ...data } : v));
    } catch { /* on garde l'affichage courant */ }
  }, [fetchTicket]);

  const runStatus = useCallback(async ({ id, code, statut, assign }) => {
    try {
      await api.changeStatus(id, statut);
      if (assign) await api.updateTicket(id, { technicien_assigne: assign }).catch(() => {});
      invalidateCache('tickets', 'dashboard');
      notifyTicketUpdated(id);
      toast.success(`${code} : ${statut}`);
    } catch (err) {
      playScanSound('error');
      toast.error(`${code} : ${err?.message || 'changement de statut impossible'}`);
    }
    if (viewRef.current?.id === id) reload(id);
  }, [toast, reload]);

  const commitDeferred = useCallback(() => {
    const d = deferredRef.current;
    if (!d) return;
    clearTimeout(d.timer);
    deferredRef.current = null;
    setDeferred(null);
    runStatus(d);
  }, [runStatus]);

  const cancelDeferred = useCallback(() => {
    const d = deferredRef.current;
    if (!d) return;
    clearTimeout(d.timer);
    deferredRef.current = null;
    setDeferred(null);
    toast.info(`${d.code} : action annulée.`);
  }, [toast]);

  const scheduleStatus = useCallback((t, action) => {
    commitDeferred();
    const assign = action.id === 'demarrer' && !String(t.technicien_assigne ?? '').trim() ? user.utilisateur : null;
    const d = {
      id: t.id,
      code: t.ticket_code,
      statut: action.statut,
      assign,
      label: `Passage en « ${action.statut} »`,
      until: Date.now() + UNDO_MS,
    };
    d.timer = setTimeout(() => {
      if (deferredRef.current === d) commitDeferred();
    }, UNDO_MS);
    deferredRef.current = d;
    setDeferred(d);
  }, [commitDeferred, user.utilisateur]);

  // Page quittée : l'action différée part en keepalive (un fetch normal serait coupé au déchargement)
  useEffect(() => {
    const flush = () => {
      const d = deferredRef.current;
      if (!d) return;
      clearTimeout(d.timer);
      deferredRef.current = null;
      api.patchKeepalive(`/api/tickets/${d.id}/statut`, { statut: d.statut });
      if (d.assign) api.updateTicket(d.id, { technicien_assigne: d.assign }, { keepalive: true });
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // Déconnexion ou changement d'utilisateur : le jeton n'est plus celui de l'auteur, rien n'est envoyé
  useEffect(() => () => {
    const d = deferredRef.current;
    if (!d) return;
    clearTimeout(d.timer);
    deferredRef.current = null;
    toastRef.current.warning(`${d.code} : « ${d.statut} » non enregistré (session fermée).`);
  }, []);

  const closeView = useCallback(() => {
    commitDeferred();
    wizardRef.current = false;
    setView(null);
  }, [commitDeferred]);

  const showTicket = useCallback(async (id, { seq = ++seqRef.current, label = '' } = {}) => {
    setLookup((l) => l || { label: label || `#${id}` });
    try {
      const data = await fetchTicket(id);
      if (seq !== seqRef.current) return;
      if (!data.ticket?.montants) loadTva();
      wizardRef.current = false;
      playScanSound('ok');
      setView({ n: seq, id, ...data, verified: false, mismatch: null });
    } catch (err) {
      if (seq !== seqRef.current) return;
      playScanSound('error');
      toast.error(scanErrorMessage(err, { kind: 'ticket', label: `#${id}` }));
    } finally {
      if (seq === seqRef.current) setLookup(null);
    }
  }, [fetchTicket, toast, loadTva]);

  const handleScan = useCallback(async (scan) => {
    const label = scan.label || scan.query;
    if (busyRef.current) {
      playScanSound('error');
      toast.warning('Remise en cours d’enregistrement : patientez avant de scanner.');
      return;
    }
    commitDeferred();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      playScanSound('error');
      toast.error(`Hors connexion : impossible de vérifier ${label}.`);
      return;
    }
    const seq = ++seqRef.current;
    setLookup({ label });
    try {
      const r = await api.resolveCode(scan.query);
      if (seq !== seqRef.current) return;
      if (r?.type === 'client' && r.id) {
        playScanSound('ok');
        wizardRef.current = false;
        setView(null);
        navigate(`${basePath}/clients?client=${r.id}`);
        return;
      }
      if (r?.type !== 'ticket' || !r.id) throw Object.assign(new Error('Aucun ticket'), { status: 404 });
      const cur = viewRef.current;
      if (cur && cur.id === r.id) {
        // Même ticket : reçu + étiquette du sachet, IMEI de l'appareil ou du téléphone de prêt
        const digits = scan.kind === 'imei' ? scan.imei : '';
        const ct = cur.ticket || {};
        const verified = !digits ? 'ticket'
          : digits === onlyDigits(ct.telephone_pret_imei) ? 'pret'
            : digits === onlyDigits(ct.imei) ? 'imei' : 'ticket';
        playScanSound('ok');
        setView((v) => (v && v.id === r.id ? { ...v, verified, verifiedAt: seq, mismatch: null } : v));
        reload(r.id);
        return;
      }
      if (cur && wizardRef.current) {
        playScanSound('warn');
        setView((v) => (v ? { ...v, mismatch: { id: r.id, code: r.ticket_code || label } } : v));
        return;
      }
      await showTicket(r.id, { seq });
    } catch (err) {
      if (seq !== seqRef.current) return;
      playScanSound('error');
      toast.error(scanErrorMessage(err, scan));
    } finally {
      if (seq === seqRef.current) setLookup(null);
    }
  }, [toast, commitDeferred, navigate, basePath, reload, showTicket]);

  const handleScanRef = useRef(handleScan);
  handleScanRef.current = handleScan;

  useEffect(() => {
    const onScan = (e) => {
      if (!e.detail?.query) return;
      e.detail.accepted = true;
      handleScanRef.current(e.detail);
    };
    window.addEventListener(SCAN_EVENT, onScan);
    const pending = takePendingScan();
    if (pending) handleScanRef.current(pending);
    return () => window.removeEventListener(SCAN_EVENT, onScan);
  }, []);

  useEffect(() => {
    if (!view) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [!view]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitRestitution = useCallback(async (t, body) => {
    busyRef.current = true;
    try {
      const res = await api.restitution(t.id, body);
      invalidateCache('tickets', 'dashboard', 'clients');
      notifyTicketUpdated(t.id, res?.ticket);
      if (res?.ticket) setView((v) => (v && v.id === t.id ? { ...v, ticket: res.ticket } : v));
      else reload(t.id);
      playScanSound('ok');
      return res;
    } finally {
      busyRef.current = false;
    }
  }, [reload]);

  const encaisserSolde = useCallback(async (t, { mode, montant }) => {
    busyRef.current = true;
    try {
      const res = await api.setPaye(t.id, true);
      // Même trace que la remise (« Encaissé 79,00 € (CB) — par … ») : PATCH /paye ne note que « Marqué payé »
      if (montant > 0) {
        await api.addHistory(t.id, `Encaissé ${euros(montant)} € (${mode}) — par ${user.utilisateur}`)
          .catch(() => toast.warning(`${t.ticket_code} : mode de paiement non noté dans l’historique.`));
      }
      invalidateCache('tickets', 'dashboard', 'clients');
      notifyTicketUpdated(t.id);
      playScanSound('ok');
      const pts = res?.points_fidelite ?? res?.fidelite?.points_gagnes;
      toast.success(`${t.ticket_code} : solde encaissé (${mode})${pts ? ` · +${pts} points fidélité` : ''}`);
      reload(t.id);
      return res;
    } finally {
      busyRef.current = false;
    }
  }, [toast, reload, user.utilisateur]);

  const goTicket = useCallback((id) => {
    closeView();
    navigate(`${basePath}/ticket/${id}`);
  }, [closeView, navigate, basePath]);

  const goClient = useCallback((clientId) => {
    closeView();
    navigate(`${basePath}/clients?client=${clientId}`);
  }, [closeView, navigate, basePath]);

  const openPrint = useCallback((t) => {
    closeView();
    setPrinting({
      id: t.id,
      code: t.ticket_code,
      tel: t.client_tel || '',
      email: t.client_email || '',
      docId: estRendu(t) ? 'recu' : 'client',
    });
  }, [closeView]);

  return (
    <>
      {lookup && <LookupChip label={lookup.label} />}
      {view && (
        <ScanDialog
          key={view.n}
          view={view}
          role={role}
          tva={tva}
          userName={user.utilisateur}
          deferred={deferred && deferred.id === view.id ? deferred : null}
          onClose={closeView}
          onReload={reload}
          onOpenTicket={goTicket}
          onOpenClient={goClient}
          onPrint={openPrint}
          onSchedule={scheduleStatus}
          onCancelDeferred={cancelDeferred}
          onCommitDeferred={commitDeferred}
          onRestitution={submitRestitution}
          onEncaisser={encaisserSolde}
          onShowTicket={(id, label) => showTicket(id, { label })}
          onDismissMismatch={() => setView((v) => (v ? { ...v, mismatch: null } : v))}
          onWizardChange={(open) => { wizardRef.current = open; }}
        />
      )}
      {printing && (
        <Suspense fallback={null}>
          <PrintDrawer
            open
            onClose={() => setPrinting(null)}
            ticketId={printing.id}
            ticketCode={printing.code}
            clientTel={printing.tel}
            clientEmail={printing.email}
            initialDocId={printing.docId}
          />
        </Suspense>
      )}
    </>
  );
}

function LookupChip({ label }) {
  return (
    <div role="status" aria-live="polite"
      className="fixed left-1/2 top-3 z-[100] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span className="truncate font-mono">{label}</span>
      <span className="shrink-0">· recherche…</span>
    </div>
  );
}

function trapTab(e, root, title) {
  const items = [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[hidden]'));
  if (!items.length) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === title || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

const ALERT_STYLES = {
  danger: 'bg-red-50 text-red-800 ring-red-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  info: 'bg-slate-100 text-slate-700 ring-slate-200',
};

function ScanDialog({
  view, role, tva, userName, deferred, onClose, onReload, onOpenTicket, onOpenClient, onPrint,
  onSchedule, onCancelDeferred, onCommitDeferred, onRestitution, onEncaisser, onShowTicket,
  onDismissMismatch, onWizardChange,
}) {
  const toast = useToast();
  const t = view.ticket || {};
  const m = useMemo(() => montantsTicket(t, tva), [t, tva]);
  const alertes = useMemo(() => alertesTicket(t, m, view.notes), [t, m, view.notes]);
  const actions = useMemo(() => actionsTicket(t, role, view.notes), [t, role, view.notes]);
  const verifier = montantAVerifier(t, m, view.notes);
  const notes = useMemo(() => (view.notes || []).filter((n) => n.important).slice(0, 3), [view.notes]);
  const cfg = getStatusConfig(t.statut);
  const jours = joursDepuis(t.date_depot);

  const titleId = useId();
  const descId = useId();
  const confirmIds = useId();
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const wizardTitleRef = useRef(null);
  const scrollRef = useRef(null);
  const [wizard, setWizard] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [done, setDone] = useState(null);
  const alertesVisibles = done ? alertes.filter((a) => a.id !== 'rendu') : alertes;
  const [soundOn, setSoundOn] = useState(isScanSoundOn);

  useEffect(() => {
    const previous = document.activeElement;
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous && previous.isConnected && typeof previous.focus === 'function' && previous !== document.body) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    onWizardChange(!!wizard);
  }, [!wizard]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => onWizardChange(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  // scrollIntoView ferait aussi défiler le cadre du dialogue (overflow-hidden) : on ne fait défiler que le contenu
  useEffect(() => {
    const el = wizardTitleRef.current;
    const scroller = scrollRef.current;
    if (!wizard || !el) return;
    el.focus({ preventScroll: true });
    if (scroller) {
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
      scroller.scrollTop = Math.max(0, top);
    }
  }, [!!wizard]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = !!(wizard?.submitting || confirm?.submitting);

  useEffect(() => {
    if (view.verified === 'pret' && pretEnCours(t)) setWizard((w) => (w ? { ...w, pretOk: true, error: null } : w));
  }, [view.verifiedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Un bouton qui disparaît (annulation, retour) ne doit pas laisser le focus sur la page derrière
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) titleRef.current?.focus({ preventScroll: true });
  });

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (busy) return;
      // Échap pendant une action annulable = l'annuler (fermer le panneau la validerait)
      if (deferred) onCancelDeferred();
      else if (wizard) setWizard(null);
      else if (confirm) setConfirm(null);
      else onClose();
      return;
    }
    if (e.key === 'Tab') trapTab(e, dialogRef.current, titleRef.current);
  };

  const toggleSound = () => {
    const next = !soundOn;
    setScanSoundOn(next);
    setSoundOn(next);
    if (next) playScanSound('ok');
  };

  const focusField = (field) => {
    requestAnimationFrame(() => {
      dialogRef.current?.querySelector(`[data-field="${field}"]`)?.focus();
    });
  };

  const startAction = (action) => {
    if (action.id === 'rendre') {
      setConfirm(null);
      setWizard(etatRestitutionInitial(m));
    } else if (action.id === 'facturer') {
      onOpenTicket(view.id);
    } else if (action.id === 'encaisser') {
      setConfirm({ action, submitting: false, mode: '', error: null });
    } else if (action.warn) {
      setConfirm({ action, submitting: false });
    } else {
      setConfirm(null);
      onSchedule(t, action);
    }
  };

  const confirmAction = async () => {
    const action = confirm?.action;
    if (!action) return;
    if (action.id !== 'encaisser') {
      setConfirm(null);
      onSchedule(t, action);
      return;
    }
    if (!confirm.mode) {
      playScanSound('error');
      setConfirm((c) => ({ ...c, error: { field: 'mode', message: 'Choisissez le mode de paiement.' } }));
      focusField('mode');
      return;
    }
    setConfirm((c) => ({ ...c, submitting: true, error: null }));
    try {
      await onEncaisser(t, { mode: confirm.mode, montant: m.reste });
      setConfirm(null);
    } catch (err) {
      playScanSound('error');
      toast.error(`${t.ticket_code} : ${err?.message || 'encaissement impossible'}`);
      setConfirm((c) => (c ? { ...c, submitting: false } : c));
    }
  };

  const submitRendre = async () => {
    if (!wizard || wizard.submitting) return;
    const invalid = verifierRestitution(t, m, wizard);
    if (invalid) {
      playScanSound('error');
      setWizard((w) => ({ ...w, error: invalid }));
      focusField(invalid.field);
      return;
    }
    const body = corpsRestitution(t, m, wizard);
    setWizard((w) => ({ ...w, submitting: true, error: null }));
    try {
      const res = await onRestitution(t, body);
      setWizard(null);
      const pts = res?.points_fidelite;
      setDone({
        deja: !!res?.deja_rendu,
        par: res?.ticket?.rendu_par || userName,
        at: res?.ticket?.date_rendu ? formatDateTexte(res.ticket.date_rendu) : null,
        paiement: body.paiement,
        mode: body.mode_paiement,
        montant: body.montant,
        points: Number.isFinite(pts) && pts > 0 ? pts : null,
      });
      if (res?.deja_rendu) toast.info(`${t.ticket_code} était déjà rendu : rien n’a été modifié.`);
      else toast.success(`${t.ticket_code} rendu au client${pts > 0 ? ` · +${pts} points fidélité` : ''}`);
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
        titleRef.current?.focus({ preventScroll: true });
      });
    } catch (err) {
      const d = errorData(err);
      const code = d?.code;
      let field = null;
      let patch = {};
      if (code === 'reste_a_payer') {
        field = 'paiement';
        patch = { reste: d.reste != null ? num(d.reste) : null, paiement: 'encaisser' };
      } else if (code === 'pret_non_restitue') {
        field = 'pret';
        patch = { pretOk: false };
      } else if (code === 'non_termine') {
        field = 'force';
        patch = { forceOk: false };
      } else if (code === 'motif_requis') {
        field = 'motif';
        patch = { paiement: 'non_paye' };
      }
      playScanSound(code ? 'warn' : 'error');
      setWizard((w) => (w ? {
        ...w, ...patch, submitting: false,
        error: { field, message: d?.message || err?.message || 'Remise impossible.' },
      } : w));
      if (field) focusField(field);
      onReload(t.id);
    }
  };

  const primary = actions.filter((a) => a.primary);
  const secondary = actions.filter((a) => !a.primary);

  return (
    // z-[100] comme la bulle de chat (rendue avant) et les toasts (rendus après) : l'ordre du DOM
    // place le panneau au-dessus de la bulle et sous les toasts
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4" data-scan-panel="">
      <div className="absolute inset-0 bg-slate-900/60" aria-hidden="true" onClick={() => { if (!busy) onClose(); }} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        className="relative flex max-h-[94vh] w-full flex-col overflow-hidden supports-[overflow:clip]:overflow-clip rounded-t-3xl bg-white shadow-2xl sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="h-1.5 shrink-0" style={{ backgroundColor: cfg.color }} aria-hidden="true" />

        <header className="flex shrink-0 items-start gap-3 border-b border-slate-100 px-4 pb-3 pt-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">
              <ScanLine className="h-4 w-4" aria-hidden="true" /> Scan comptoir
            </p>
            <h2 id={titleId} ref={titleRef} tabIndex={-1}
              className="mt-0.5 rounded font-mono text-3xl font-extrabold tracking-tight text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              {t.ticket_code || `#${view.id}`}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge statut={t.statut} size="lg" />
              {t.est_retour_sav && (
                <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-800">Retour SAV</span>
              )}
              {view.verified && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> {VERIFIED_LABELS[view.verified] || VERIFIED_LABELS.ticket}
                </span>
              )}
            </div>
            <p id={descId} className="mt-2 text-sm text-slate-600">
              {modeleTicket(t)}
              {t.date_depot ? ` · déposé le ${formatDateShort(t.date_depot)}` : ''}
              {jours != null && (
                <span className={jours > 30 ? 'font-bold text-red-700' : ''}>
                  {jours === 0 ? ' (aujourd’hui)' : jours === 1 ? ' (hier)' : ` (il y a ${jours} j)`}
                </span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={toggleSound} aria-pressed={soundOn}
              aria-label="Son de la douchette" title={soundOn ? 'Son activé' : 'Son coupé'}
              className={`flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 ${FOCUS_RING}`}>
              {soundOn ? <Volume2 className="h-5 w-5" aria-hidden="true" /> : <VolumeX className="h-5 w-5" aria-hidden="true" />}
            </button>
            <button type="button" onClick={onClose} disabled={busy} aria-label="Fermer le panneau"
              className={`flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 disabled:opacity-50 ${FOCUS_RING}`}>
              <X className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {view.mismatch && (
            <div role="alert" className="rounded-2xl bg-red-50 p-4 ring-2 ring-red-300">
              <p className="flex items-start gap-2 font-bold text-red-800">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                {view.mismatch.code} scanné pendant la remise de {t.ticket_code} : vérifiez que c’est le bon appareil.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => onShowTicket(view.mismatch.id, view.mismatch.code)}
                  className={`min-h-[44px] rounded-xl bg-red-700 px-4 text-sm font-bold text-white hover:bg-red-800 ${FOCUS_RING}`}>
                  Afficher {view.mismatch.code}
                </button>
                <button type="button" onClick={onDismissMismatch}
                  className={`min-h-[44px] rounded-xl bg-white px-4 text-sm font-bold text-red-800 ring-1 ring-red-300 hover:bg-red-100 ${FOCUS_RING}`}>
                  Continuer la remise de {t.ticket_code}
                </button>
              </div>
            </div>
          )}

          {done && (
            <div role="status" className="rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
              <p className="flex items-center gap-2 text-lg font-bold text-emerald-800">
                <CircleCheckBig className="h-6 w-6 shrink-0" aria-hidden="true" />
                {done.deja ? 'Déjà rendu au client' : 'Rendu au client'}
              </p>
              <p className="mt-1 text-sm text-emerald-900">
                {[
                  done.at ? `le ${done.at}` : null,
                  done.par ? `par ${done.par}` : null,
                  done.paiement === 'encaisser' && done.montant ? `encaissé ${formatPrix(done.montant)}${done.mode ? ` (${done.mode})` : ''}` : null,
                  done.paiement === 'non_paye' ? 'non payé (suivi des impayés)' : null,
                  done.points ? `+${done.points} points fidélité` : null,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
          )}

          {alertesVisibles.length > 0 && (
            <ul className="space-y-2" aria-label="Points d’attention">
              {alertesVisibles.map((a) => (
                <li key={a.id} className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold ring-1 ${ALERT_STYLES[a.level]}`}>
                  {a.level === 'info'
                    ? <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                  <span className="min-w-0 break-words">{a.text}</span>
                </li>
              ))}
            </ul>
          )}

          {wizard && (
            <RestitutionForm t={t} m={m} verifier={verifier} state={wizard} setState={setWizard} titleRef={wizardTitleRef} />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <section aria-label="Client" className="rounded-2xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">
                <UserRound className="h-4 w-4" aria-hidden="true" /> Client
              </h3>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {[t.client_prenom, String(t.client_nom ?? '').toUpperCase()].filter(Boolean).join(' ') || '—'}
              </p>
              {t.client_societe && <p className="text-sm text-slate-600">{t.client_societe}</p>}
              {t.client_tel && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <a href={`tel:${String(t.client_tel).replace(/[^\d+]/g, '')}`}
                    className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-slate-100 px-3 text-base font-bold text-slate-900 hover:bg-slate-200 ${FOCUS_RING}`}>
                    <Phone className="h-4 w-4" aria-hidden="true" /> {formatTel(t.client_tel)}
                  </a>
                  <a href={waLink(String(t.client_tel), '')} target="_blank" rel="noopener noreferrer"
                    aria-label={`WhatsApp ${formatTel(t.client_tel)}`}
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800 hover:bg-emerald-100 ${FOCUS_RING}`}>
                    <MessageCircle className="h-5 w-5" aria-hidden="true" />
                  </a>
                </div>
              )}
            </section>

            <section aria-label="Appareil" className="rounded-2xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">
                <Smartphone className="h-4 w-4" aria-hidden="true" /> Appareil
              </h3>
              <p className="mt-1 text-lg font-bold text-slate-900">{modeleTicket(t)}</p>
              <dl className="mt-2 space-y-1.5 text-sm">
                {(t.panne || t.panne_detail) && (
                  <div>
                    <dt className="font-semibold text-slate-600">Panne</dt>
                    <dd className="text-slate-900">{[t.panne, t.panne_detail].filter(Boolean).join(' — ')}</dd>
                  </div>
                )}
                {m.lignes.length > 0 && (
                  <div>
                    <dt className="font-semibold text-slate-600">Prestations</dt>
                    <dd>
                      <ul className="space-y-0.5">
                        {m.lignes.map((l, i) => (
                          <li key={i} className="flex justify-between gap-3 text-slate-900">
                            <span className="min-w-0 break-words">{l.label}</span>
                            <span className="shrink-0 tabular-nums">{formatPrix(l.prix)}</span>
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
                {imeiCourt(t.imei) && (
                  <div className="flex justify-between gap-3">
                    <dt className="font-semibold text-slate-600">IMEI</dt>
                    <dd className="font-mono text-slate-900">{imeiCourt(t.imei)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="font-semibold text-slate-600">Technicien</dt>
                  <dd className="text-right text-slate-900">{t.technicien_assigne || 'Non assigné'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-semibold text-slate-600">Récupération prévue</dt>
                  <dd className="text-right text-slate-900">{t.date_recuperation || '—'}</dd>
                </div>
              </dl>
            </section>
          </div>

          <section aria-label="Progression" className="overflow-x-auto rounded-2xl border border-slate-200 px-3 py-4">
            <div className="min-w-[300px]">
              <ProgressTracker statut={t.statut} hasPiece={!!Number(t.commande_piece)} />
            </div>
          </section>

          <section aria-label="Paiement" className="rounded-2xl bg-slate-50 p-4">
            <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">
              <Wallet className="h-4 w-4" aria-hidden="true" /> Paiement
            </h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-600">
                {m.refusServeur ? 'Frais dus (devis refusé)' : m.estime ? 'Total (devis estimé)' : 'Total TTC'}
              </dt>
              <dd className="text-right font-semibold tabular-nums text-slate-900">{formatPrix(m.total)}</dd>
              <dt className="text-slate-600">Acompte</dt>
              <dd className="text-right font-semibold tabular-nums text-slate-900">{formatPrix(m.acompte)}</dd>
            </dl>
            <div className={`mt-3 flex items-center justify-between gap-3 rounded-xl px-4 py-3 ring-1 ${
              m.reste > 0 ? 'bg-red-50 ring-red-200' : 'bg-emerald-50 ring-emerald-200'}`}>
              <span className={`text-sm font-extrabold uppercase tracking-wide ${m.reste > 0 ? 'text-red-800' : 'text-emerald-800'}`}>
                {m.paye ? 'Payé' : m.reste > 0 ? 'Reste à payer' : 'Rien à payer'}
              </span>
              <span className={`text-3xl font-extrabold tabular-nums ${m.reste > 0 ? 'text-red-700' : 'text-emerald-800'}`}>
                {formatPrix(m.reste)}
              </span>
            </div>
          </section>

          {notes.length > 0 && (
            <section aria-label="Notes importantes" className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-900">
                <StickyNote className="h-4 w-4" aria-hidden="true" /> Notes importantes
              </h3>
              <ul className="mt-2 space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="text-sm text-amber-950">
                    <p className="whitespace-pre-line break-words">{n.contenu}</p>
                    <p className="mt-0.5 text-xs text-amber-900">
                      {n.auteur}{n.date_creation ? ` · ${formatDateShort(n.date_creation)}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <footer className="shrink-0 space-y-2 border-t border-slate-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
          {deferred ? (
            <UndoBar deferred={deferred} onCancel={onCancelDeferred} onCommit={onCommitDeferred} />
          ) : wizard ? (
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <button type="button" onClick={() => setWizard(null)} disabled={wizard.submitting}
                className={`min-h-[52px] rounded-xl bg-slate-100 px-4 text-base font-bold text-slate-800 hover:bg-slate-200 disabled:opacity-50 ${FOCUS_RING}`}>
                Retour
              </button>
              <button type="button" onClick={submitRendre} disabled={wizard.submitting}
                className={`inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-base font-bold text-white hover:bg-emerald-800 disabled:opacity-60 ${FOCUS_RING}`}>
                {wizard.submitting
                  ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  : <PackageCheck className="h-5 w-5" aria-hidden="true" />}
                {wizard.submitting ? 'Enregistrement…' : 'Confirmer la remise'}
              </button>
            </div>
          ) : confirm ? (
            <div role="group" aria-label="Confirmation" className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
              <p className="text-sm font-semibold text-amber-900">
                {confirm.action.id === 'encaisser'
                  ? `Encaisser ${formatPrix(m.reste)} et marquer ${t.ticket_code} comme payé ?`
                  : confirm.action.warn?.text}
              </p>
              {confirm.action.id === 'encaisser' && (
                <div className="mt-2">
                  <ModesPaiement name={`${confirmIds}-mode`} value={confirm.mode}
                    onChange={(mode) => setConfirm((c) => ({ ...c, mode, error: null }))}
                    errorId={`${confirmIds}-err`} invalid={confirm.error?.field === 'mode'} />
                </div>
              )}
              {confirm.error && (
                <p id={`${confirmIds}-err`} role="alert" className="mt-2 flex items-start gap-2 text-sm font-bold text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {confirm.error.message}
                </p>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirm(null)} disabled={confirm.submitting}
                  className={`min-h-[48px] rounded-xl bg-white px-3 text-sm font-bold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50 ${FOCUS_RING}`}>
                  Annuler
                </button>
                <button type="button" onClick={confirmAction} disabled={confirm.submitting}
                  className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-amber-700 px-3 text-sm font-bold text-white hover:bg-amber-800 disabled:opacity-60 ${FOCUS_RING}`}>
                  {confirm.submitting && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  {confirm.action.id === 'encaisser' ? 'Confirmer l’encaissement' : confirm.action.warn?.ok || 'Oui, continuer'}
                </button>
              </div>
            </div>
          ) : (
            (primary.length > 0 || secondary.length > 0) && (
              <div className="grid gap-2 sm:grid-flow-col sm:auto-cols-fr">
                {primary.map((a) => (
                  <ActionButton key={a.id} action={a} onClick={() => startAction(a)} primary />
                ))}
                {secondary.map((a) => (
                  <ActionButton key={a.id} action={a} onClick={() => startAction(a)} />
                ))}
              </div>
            )
          )}

          {!wizard && (
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => onOpenTicket(view.id)} disabled={busy}
                className={`inline-flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl bg-slate-100 px-2 text-xs font-bold text-slate-800 hover:bg-slate-200 disabled:opacity-50 sm:flex-row sm:gap-2 sm:text-sm ${FOCUS_RING}`}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" /> Ouvrir la fiche
              </button>
              <button type="button" onClick={() => onOpenClient(t.client_id)} disabled={busy || !t.client_id}
                className={`inline-flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl bg-slate-100 px-2 text-xs font-bold text-slate-800 hover:bg-slate-200 disabled:opacity-50 sm:flex-row sm:gap-2 sm:text-sm ${FOCUS_RING}`}>
                <UserRound className="h-4 w-4" aria-hidden="true" /> Fiche client
              </button>
              <button type="button" onClick={() => onPrint(t)} disabled={busy}
                className={`inline-flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl bg-slate-100 px-2 text-xs font-bold text-slate-800 hover:bg-slate-200 disabled:opacity-50 sm:flex-row sm:gap-2 sm:text-sm ${FOCUS_RING}`}>
                <Printer className="h-4 w-4" aria-hidden="true" /> {done || estRendu(t) ? 'Imprimer le reçu' : 'Imprimer'}
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

const ACTION_ICONS = { rendre: PackageCheck, demarrer: Play, terminer: CircleCheckBig, encaisser: HandCoins, facturer: Receipt };
const ACTION_COLORS = {
  rendre: 'bg-emerald-700 hover:bg-emerald-800 text-white',
  facturer: 'bg-amber-700 hover:bg-amber-800 text-white',
  terminer: 'bg-emerald-700 hover:bg-emerald-800 text-white',
  demarrer: 'bg-blue-700 hover:bg-blue-800 text-white',
  encaisser: 'bg-brand-600 hover:bg-brand-700 text-white',
};

function ActionButton({ action, onClick, primary = false }) {
  const Icon = ACTION_ICONS[action.id] || Play;
  const cls = primary
    ? `${ACTION_COLORS[action.id] || ACTION_COLORS.rendre} min-h-[56px] text-lg`
    : 'bg-white text-slate-800 ring-2 ring-slate-300 hover:bg-slate-50 min-h-[52px] text-base';
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 font-bold ${cls} ${FOCUS_RING}`}>
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" /> {action.label}
    </button>
  );
}

function UndoBar({ deferred, onCancel, onCommit }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((deferred.until - Date.now()) / 1000)));
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const id = setInterval(() => {
      setLeft(Math.max(0, Math.ceil((deferred.until - Date.now()) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [deferred.until]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-white">
      <Clock className="h-5 w-5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm font-semibold" role="status">
        {deferred.label} <span aria-hidden="true">dans {left} s</span>
        <span className="sr-only">programmé, annulable quelques secondes</span>
      </p>
      <button ref={cancelRef} type="button" onClick={onCancel}
        className="min-h-[44px] rounded-lg bg-white px-4 text-sm font-bold text-slate-900 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900">
        Annuler
      </button>
      <button type="button" onClick={onCommit}
        className="min-h-[44px] rounded-lg px-3 text-sm font-semibold text-white underline underline-offset-2 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
        Valider maintenant
      </button>
    </div>
  );
}

const CHOICE = 'flex min-h-[48px] cursor-pointer items-start gap-3 rounded-xl border-2 p-3 text-sm';

function ModesPaiement({ name, value, onChange, errorId, invalid }) {
  return (
    <fieldset aria-describedby={invalid ? errorId : undefined}>
      <legend className="mb-1 text-sm font-bold text-slate-800">Mode de paiement</legend>
      <div className="flex flex-wrap gap-2">
        {MODES_PAIEMENT.map((mode, i) => (
          <label key={mode}
            className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl bg-white px-4 text-sm font-bold text-slate-800 ring-2 ring-slate-300 has-[:checked]:bg-brand-600 has-[:checked]:text-white has-[:checked]:ring-brand-600 has-[:focus-visible]:ring-brand-800">
            <input type="radio" name={name} value={mode} checked={value === mode}
              data-field={i === 0 ? 'mode' : undefined}
              onChange={() => onChange(mode)} className="sr-only" />
            {mode}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RestitutionForm({ t, m, verifier, state, setState, titleRef }) {
  const ids = useId();
  const termine = t.statut === TERMINE;
  const pret = pretEnCours(t);
  const reste = resteEffectif(m, state);
  const err = state.error;
  const set = (patch) => setState((s) => ({ ...s, ...patch, error: null }));
  const errId = `${ids}-err`;
  const fieldError = (field) => (err?.field === field ? { 'aria-invalid': true, 'aria-describedby': errId } : {});

  return (
    <section aria-labelledby={`${ids}-title`} className="space-y-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50/50 p-4">
      <h3 id={`${ids}-title`} ref={titleRef} tabIndex={-1}
        className="flex items-center gap-2 rounded text-lg font-extrabold text-emerald-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
        <PackageCheck className="h-5 w-5" aria-hidden="true" /> Remise au client
      </h3>

      {!termine && (
        <label className={`${CHOICE} border-amber-300 bg-amber-50 text-amber-950`}>
          <input type="checkbox" data-field="force" checked={state.forceOk} {...fieldError('force')}
            onChange={(e) => set({ forceOk: e.target.checked })}
            className="mt-0.5 h-6 w-6 shrink-0 accent-amber-700" />
          <span>
            <span className="font-bold">Réparation non terminée</span> (statut « {t.statut} »).
            {' '}Je confirme rendre l’appareil en l’état.
          </span>
        </label>
      )}

      {pret && (
        <label className={`${CHOICE} border-amber-300 bg-white text-slate-900`}>
          <input type="checkbox" data-field="pret" checked={state.pretOk} {...fieldError('pret')}
            onChange={(e) => set({ pretOk: e.target.checked })}
            className="mt-0.5 h-6 w-6 shrink-0 accent-emerald-700" />
          <span>
            <span className="font-bold">Téléphone de prêt récupéré</span> : {String(t.telephone_pret).trim()}
            {imeiCourt(t.telephone_pret_imei) ? ` (IMEI ${imeiCourt(t.telephone_pret_imei)})` : ''}, vérifié.
          </span>
        </label>
      )}

      {verifier && reste > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-950 ring-1 ring-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {CONSEILS_FACTURATION[verifier]}
        </p>
      )}

      {reste > 0 ? (
        <fieldset className="space-y-2" data-field="paiement" tabIndex={-1}>
          <legend className="mb-1 text-sm font-bold text-slate-800">
            Paiement : <span className="tabular-nums text-red-700">{formatPrix(reste)}</span> restent dus
          </legend>
          {[
            { v: 'encaisser', label: `Encaisser maintenant ${formatPrix(reste)}` },
            { v: 'non_paye', label: 'Non payé : le client réglera plus tard' },
          ].map((o) => (
            <label key={o.v} className={`${CHOICE} ${state.paiement === o.v ? 'border-emerald-600 bg-white' : 'border-slate-200 bg-white'}`}>
              <input type="radio" name={`${ids}-paiement`} value={o.v} checked={state.paiement === o.v}
                onChange={() => set({ paiement: o.v })} className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-700" />
              <span className="font-semibold text-slate-900">{o.label}</span>
            </label>
          ))}

          {state.paiement === 'encaisser' && (
            <ModesPaiement name={`${ids}-mode`} value={state.mode} onChange={(mode) => set({ mode })}
              errorId={errId} invalid={err?.field === 'mode'} />
          )}

          {state.paiement === 'non_paye' && (
            <div>
              <label htmlFor={`${ids}-motif`} className="mb-1 block text-sm font-bold text-slate-800">
                Motif (obligatoire)
              </label>
              <input id={`${ids}-motif`} type="text" data-field="motif" maxLength={200} value={state.motif}
                {...fieldError('motif')}
                onChange={(e) => set({ motif: e.target.value })}
                placeholder="Ex. : règlera au prochain passage"
                className="min-h-[48px] w-full rounded-xl border-2 border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30" />
            </div>
          )}
        </fieldset>
      ) : (
        <p className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200">
          <CircleCheckBig className="h-4 w-4 shrink-0" aria-hidden="true" />
          {m.paye ? 'Déjà payé : rien à encaisser.' : 'Rien à encaisser.'}
        </p>
      )}

      {err && (
        <p id={errId} role="alert" className="flex items-start gap-2 text-sm font-bold text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {err.message}
        </p>
      )}
    </section>
  );
}
