import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Volume2, VolumeX, ScanLine, Phone, MessageCircle, Smartphone, UserRound, Wallet,
  StickyNote, Printer, ExternalLink, PackageCheck, Play, CircleCheckBig, AlertTriangle,
  Loader2, Clock, ShieldCheck, HandCoins, Info, Receipt, Send, MapPin,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useSmsServeur } from '../hooks/useSmsServeur';
import { useToast } from './Toast';
import { invalidateCache } from '../hooks/useApi';
import api from '../lib/api';
import { formatDateShort, formatPrix, getStatusConfig, waLink } from '../lib/utils';
import { SCAN_EVENT } from '../lib/scan';
import { messageSmsEnvoye } from '../lib/sms';
import {
  canalPrevenir, raisonSansCanal, messagePret, ligneJournal, emailValide, erreurEnvoi, SMS_IMPOSSIBLE,
  MENTION_MONTANT_RETIRE,
} from '../lib/messages';
// Second numéro du ticket (« pour vous joindre si différent ») avant celui de la fiche
import { telJoignable, libelleJoignable, avecTelJoignable, estAutreNumero } from '../lib/contact';
// Prestation sans prix automatique (reprise) : « à chiffrer par la boutique » plutôt que 0.00 €
import { aChiffrer, cataloguePrestations, chargerPrestations, clePanne, MENTION_A_CHIFFRER } from '../lib/prestations';
import StatusBadge from './StatusBadge';
import { PrioriteBadge } from './PrioriteBadge';
import PrevenirClient, { chargerContexteMessage } from './PrevenirClient';
// « Client contacté » (tickets.contact, calculé par le serveur) : icônes des canaux et « Contacté par tél. »
import ContactClient from './ContactClient';
import EmplacementInput from './EmplacementInput';
import { listeEmplacements, normaliserEmplacement } from '../lib/etagere';
import { isScanSoundOn, setScanSoundOn, playScanSound, takePendingScan } from './ScanListener';

const PrintDrawer = lazy(() => import('./PrintDrawer'));
// Chargé à la première proposition de message (après « Réparation terminée » par défaut)
const MessageComposer = lazy(() => import('./MessageComposer'));

const TERMINE = 'Réparation terminée';
const EN_COURS = 'En cours de réparation';
const ACCORD = "En attente d'accord client";
const RENDUS = ['Rendu au client', 'Clôturé'];
const DEMARRABLES = ['En attente de diagnostic', 'Pièce reçue', 'En attente de pièce', ACCORD];
// Statuts d'où le scan passe directement en « Réparation terminée » (réparation express, sans « Démarrer »),
// accueil comme technicien. Jamais depuis l'accord client : le serveur le lirait comme un devis refusé.
const TERMINABLES_DIRECT = ['Pré-enregistré', 'En attente de diagnostic', 'En attente de pièce', 'Pièce reçue'];
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
    // La clé de prestation du serveur (« reprise »…) est gardée quand il la donne : elle dit si la ligne est à chiffrer
    const lignes = Array.isArray(srv.lignes)
      ? srv.lignes.filter((l) => String(l?.label ?? '').trim())
        .map((l) => ({ label: String(l.label).trim(), prix: num(l.prix), ...(l.cle ? { cle: String(l.cle) } : {}) }))
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

/**
 * Ligne sans prix automatique (reprise) encore à 0 : le scan affiche la mention « à chiffrer par la
 * boutique » à la place de 0.00 €. Clé du serveur, sinon celle du libellé si le catalogue est chargé.
 */
export function ligneAChiffrer(l, cat = cataloguePrestations()) {
  return num(l?.prix) <= 0 && aChiffrer(l?.cle ?? clePanne(l?.label, cat), cat);
}

export function mentionAChiffrer(cat = cataloguePrestations()) {
  return cat?.mentionAChiffrer || MENTION_A_CHIFFRER;
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

/**
 * Fin de réparation depuis le scan : le client est prévenu dans la foulée (SMS, sinon e-mail).
 * Sans portable ni e-mail, un simple « Réparation terminée » (la carte dira pourquoi).
 */
function actionTerminer(t, extra = {}) {
  const joignable = !!canalPrevenir(avecTelJoignable(t));
  return {
    id: 'terminer',
    statut: TERMINE,
    label: joignable ? 'Terminé + prévenir le client' : 'Réparation terminée',
    icon: joignable ? 'terminer' : 'terminer_seul',
    prevenir: true,
    ...extra,
  };
}

/** « Terminé sans prévenir », à côté de « Terminé + prévenir » quand le client est joignable. */
function actionTerminerSeul(extra = {}) {
  return { id: 'terminer_seul', statut: TERMINE, label: 'Terminé sans prévenir', sansPrevenir: true, ...extra };
}

/**
 * Actions proposées selon le rôle et le statut (la première « primary » est mise en avant).
 * Une entrée `note: true` n'est pas un bouton : une ligne d'explication (accord client attendu).
 */
export function actionsTicket(t, role, notes = []) {
  const statut = t?.statut || '';
  const out = [];
  const joignable = !!canalPrevenir(avecTelJoignable(t));
  if (statut === EN_COURS) {
    // Accueil comme technicien : celui qui scanne l'appareil réparé prévient le client
    out.push(actionTerminer(t, { primary: true }));
    if (joignable) out.push(actionTerminerSeul());
  } else {
    if (role === 'tech' && DEMARRABLES.includes(statut)) {
      let warn = null;
      if (statut === 'En attente de pièce') {
        warn = { text: 'La pièce n’est pas encore marquée reçue. Démarrer la réparation quand même ?', ok: 'Oui, démarrer' };
      } else if (statut === ACCORD) {
        // Le serveur enregistre alors le devis comme accepté au comptoir
        warn = { text: 'Le client a-t-il accepté le devis ? Démarrer l’enregistre comme validé au comptoir.', ok: 'Oui, devis accepté' };
      }
      out.push({ id: 'demarrer', statut: EN_COURS, label: 'Démarrer la réparation', primary: true, warn });
    }
    if (TERMINABLES_DIRECT.includes(statut)) {
      // Réparation express faite sans « Démarrer » : confirmation légère, puis les 5 s d'annulation
      const warn = {
        text: statut === 'En attente de pièce'
          ? 'La pièce n’est pas encore marquée reçue. Passer directement en « Réparation terminée » ?'
          : 'Passer directement en « Réparation terminée » ?',
        ok: 'Oui, terminer',
      };
      out.push(actionTerminer(t, { warn }));
      if (joignable) out.push(actionTerminerSeul({ warn }));
    } else if (statut === ACCORD) {
      // « Terminé » depuis l'accord client = devis refusé pour le serveur : la fiche enregistre l'accord
      out.push({ id: 'accord_fiche', label: 'Attente d’accord : passez par la fiche', note: true });
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
  // Ticket déjà rendu, prêt encore dehors : la restitution ne s'applique plus et le serveur refuse
  // « Clôturé » tant que le prêt n'est pas noté récupéré (409 utiliser_restitution)
  if (estRendu(t) && pretEnCours(t) && typeof api.updateTicket === 'function') {
    out.push({
      id: 'pret',
      label: 'Prêt récupéré…',
      primary: !out.some((a) => a.primary),
      warn: {
        text: `Le téléphone de prêt (${String(t.telephone_pret).trim()}) est-il bien récupéré et vérifié ?`,
        ok: 'Oui, prêt récupéré',
      },
    });
  }
  return out;
}

/**
 * Sous-titre de « Terminé + prévenir le client » : par où le client sera prévenu, ou pourquoi
 * il ne le sera pas (avant le clic, pas une fois le ticket terminé). templates : modèles de la
 * boutique — si le modèle « prêt » cite {montant} et que le montant est à 0 € (tarif oublié ?),
 * le message part sans la phrase du montant : la mention le dit avant le clic.
 */
export function indicationPrevenir(t, smsServeur = false, templates = null) {
  const tj = avecTelJoignable(t);
  const canal = canalPrevenir(tj);
  if (!canal) return `Client non joignable : ${raisonSansCanal(tj)}`;
  const par = canal === 'sms'
    ? `SMS au ${libelleJoignable(t)}${smsServeur ? '' : ' · à valider dans Messages'}`
    : `E-mail à ${String(t.client_email).trim()}`;
  return messagePret(templates, t).montantRetire ? `${par} · ${MENTION_MONTANT_RETIRE}` : par;
}

/** Libellé de la barre « annulable » pendant les quelques secondes avant l'enregistrement. */
export function libelleDiffere(t, action) {
  if (!action?.prevenir) return `Passage en « ${action?.statut} »`;
  const canal = canalPrevenir(avecTelJoignable(t));
  if (canal === 'sms' && action.manuel) return `« ${action.statut} » puis SMS à envoyer depuis Messages`;
  const suite = canal === 'sms' ? '+ SMS au client' : canal === 'email' ? '+ e-mail au client' : '(client non prévenu)';
  return `« ${action.statut} » ${suite}`;
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

// Écran tactile (tablette du comptoir) : un focus donné par le code ouvrirait le clavier virtuel
// par-dessus le panneau ; on y touche directement les boutons d'emplacement
function ecranTactile() {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * Emplacement à afficher : celui enregistré depuis ce panneau (une relecture de la fiche partie
 * avant l'enregistrement ne doit pas le masquer), sinon celui de la fiche.
 */
export function emplacementAffiche(t, saisi) {
  return normaliserEmplacement(saisi !== undefined ? saisi : t?.emplacement);
}

/** Bloc « Rangé en B3 » / « Pas d'emplacement noté » en tête du panneau (jamais une fois l'appareil rendu). */
export function rangementVisible(t, { emplacement = null, rendu = false, edition = false } = {}) {
  if (rendu || estRendu(t)) return false;
  return !!emplacement || t?.statut === TERMINE || edition;
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
  // Emplacements proposés en boutons (GET /api/etagere/config) : lus une fois pour la session
  // du panneau, au premier scan ; en cas d'échec, simple champ libre et nouvel essai au scan suivant
  const [emplacements, setEmplacements] = useState(null);
  const emplacementsRef = useRef(false);

  const chargerEmplacements = useCallback(() => {
    if (emplacementsRef.current) return;
    emplacementsRef.current = true;
    // Erreur synchrone comprise (ancien client d'API) : jamais d'exception jusqu'au panneau
    Promise.resolve()
      .then(() => api.getEtagereConfig())
      .then((c) => setEmplacements(listeEmplacements(c)))
      .catch(() => {
        emplacementsRef.current = false;
        setEmplacements((e) => e || []);
      });
  }, []);

  // Catalogue des prestations (ligne de reprise « à chiffrer par la boutique ») : lu au scan d'un
  // ticket, cache 10 min de lib/prestations ; sans lui, seule la clé donnée par le serveur compte
  const [catalogue, setCatalogue] = useState(() => cataloguePrestations());
  const chargerCatalogue = useCallback(() => {
    Promise.resolve()
      .then(() => chargerPrestations())
      .then((c) => { if (c) setCatalogue(c); })
      .catch(() => {});
  }, []);

  // Emplacement enregistré depuis le panneau (PUT /api/etagere/{id}/emplacement déjà fait)
  const majEmplacement = useCallback((id, valeur) => {
    setView((v) => (v && v.id === id ? { ...v, emplacementSaisi: valeur } : v));
    invalidateCache('tickets', 'dashboard');
    notifyTicketUpdated(id);
  }, []);

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

  // Statut en cours d'enregistrement : le pied du panneau ne repropose pas l'action (pas de double envoi)
  const marquerEnvoi = useCallback((id, on) => {
    setView((v) => (v && v.id === id && !!v.envoiStatut !== on ? { ...v, envoiStatut: on } : v));
  }, []);

  // État de la carte « Prévenir le client » (issue de « Terminé + prévenir ») ; focus : la carte
  // se déplie et prend le focus (pas pour une étape intermédiaire « Envoi… »)
  const afficherAuto = useCallback((id, auto, { focus = true } = {}) => {
    setView((v) => (v && v.id === id
      ? { ...v, proposition: TERMINE, auto, carteN: focus ? (v.carteN || 0) + 1 : v.carteN } : v));
  }, []);

  /**
   * « Terminé + prévenir le client », une fois le statut enregistré : message « appareil prêt »
   * par SMS (portable ; serveur Brevo) sinon par e-mail ; SMS impossible pour l'instant (crédits
   * épuisés, clé ou IP refusée) : repli sur l'e-mail. Jamais de lien sms: ici : après un await le
   * navigateur le bloquerait, la carte « Prévenir » propose alors le bouton SMS.
   * Ne lève jamais : le ticket reste terminé quoi qu'il arrive à l'envoi.
   */
  const prevenirApresTermine = useCallback(async (d) => {
    const { id, code } = d;
    const t = d.ticket || {};
    const ouvert = () => viewRef.current?.id === id;
    const afficher = (auto, opts) => afficherAuto(id, auto, opts);
    const rouvrir = (auto) => () => showTicketRef.current?.(id, { label: code, proposition: TERMINE, auto });
    // Résultat : dans la carte si le panneau est ouvert, sinon la notification le rouvre sur la carte
    const signaler = (type, message, auto) => {
      if (ouvert()) {
        afficher(auto);
        toast[type](message);
      } else if (auto.etat === 'envoye') {
        toast[type](message);
      } else {
        toast[type](message, { duration: 10_000, onClick: rouvrir(auto) });
      }
    };

    try {
      const canal = canalPrevenir(avecTelJoignable(t));
      if (!canal) {
        const raison = raisonSansCanal(avecTelJoignable(t));
        signaler('warning', `${code} : Terminé — client non prévenu : ${raison}`,
          { etat: 'impossible', message: `Client non prévenu : ${raison}.` });
        return;
      }
      const ctx = await chargerContexteMessage();
      const msg = messagePret(ctx.templates, t, { lienAvis: ctx.lienAvis });
      // Montant à 0 € : le message part sans la phrase du montant, la notification le rappelle
      const mention = msg.montantRetire ? ` · ${MENTION_MONTANT_RETIRE}` : '';
      const email = String(t.client_email ?? '').trim();
      const aEmail = emailValide(email);

      const manuel = () => {
        const auto = {
          etat: 'manuel',
          canal: 'sms',
          message: `Envoi automatique des SMS désactivé : appuyez sur « SMS » pour l’envoyer depuis Messages${aEmail ? ', ou sur « E-mail »' : ''}.`,
        };
        if (ouvert()) {
          afficher(auto);
          toast.success(`${code} : Terminé — appuyez sur SMS pour prévenir le client`);
        } else {
          toast.success(`${code} : Terminé — prévenir le client ?`, { duration: 10_000, onClick: rouvrir(auto) });
        }
      };

      // avant : « SMS impossible (crédits épuisés) » quand l'e-mail remplace un SMS refusé
      const parEmail = async (avant = '') => {
        if (ouvert()) afficher({ etat: 'envoi', canal: 'email', message: `Envoi de l’e-mail à ${email}…` }, { focus: false });
        const debut = avant ? `${avant}. ` : '';
        try {
          const r = await api.envoyerEmail(email, msg.sujet, msg.texte);
          if (r?.status !== 'ok') throw new Error(r?.message || 'erreur d’envoi');
        } catch (err) {
          playScanSound('error');
          const e = erreurEnvoi(err);
          if (e.incertain) {
            signaler('warning', `${code} : Terminé — ${avant ? `${avant} ; ` : ''}envoi de l’e-mail incertain (${e.raison}) : vérifiez avant de renvoyer`,
              { etat: 'echec', canal: 'email', incertain: true, message: `${debut}Envoi de l’e-mail incertain (${e.raison}) : vérifiez avant de le renvoyer.` });
          } else {
            signaler('error', `${code} : Terminé — ${avant ? `${avant} ; ` : ''}e-mail non envoyé : ${e.raison}`,
              { etat: 'echec', canal: 'email', message: `${debut}E-mail non envoyé : ${e.raison}. Réessayez ou choisissez un autre canal.` });
          }
          return;
        }
        try {
          await api.logMessage(t.id, user.utilisateur || 'Accueil', ligneJournal(msg.libelle, msg.texte), 'email');
        } catch {
          toast.warning(`${code} : e-mail envoyé mais non noté sur le ticket.`);
        }
        signaler('success', (avant ? `${code} : Terminé · ${avant} → e-mail envoyé à ${email}` : `${code} : Terminé · e-mail envoyé`) + mention,
          { etat: 'envoye', canal: 'email', message: avant ? `${avant} : e-mail envoyé à ${email}` : `E-mail envoyé à ${email}` });
      };

      if (canal !== 'sms') {
        await parEmail();
        return;
      }
      let serveur = false;
      try {
        serveur = !!(await api.getSmsEtat())?.disponible;
      } catch { /* état illisible : envoi manuel */ }
      if (!serveur) {
        manuel();
        return;
      }
      const dest = libelleJoignable(t);
      if (ouvert()) afficher({ etat: 'envoi', canal: 'sms', message: `Envoi du SMS au ${dest}…` }, { focus: false });
      try {
        const r = await api.envoyerSms(t.id, msg.sms, msg.libelle);
        const envoye = messageSmsEnvoye(r);
        signaler('success', `${code} : Terminé · ${envoye}${mention}`, { etat: 'envoye', canal: 'sms', message: envoye });
      } catch (err) {
        if (err?.code === 'sms_non_configure') {
          Promise.resolve().then(() => api.getSmsEtat({ fresh: true })).catch(() => {});
          manuel();
          return;
        }
        const e = erreurEnvoi(err);
        // Refus qui se répétera (crédits, clé, IP) : l'e-mail prévient le client à la place
        if (!e.incertain && SMS_IMPOSSIBLE[err?.code] && aEmail) {
          await parEmail(`SMS impossible (${SMS_IMPOSSIBLE[err.code]})`);
          return;
        }
        playScanSound('error');
        if (e.incertain) {
          // Le SMS a pu partir : pas de repli ni de renvoi sans vérifier (notes relues ensuite)
          signaler('warning', `${code} : Terminé — envoi du SMS incertain (${e.raison}) : vérifiez avant de renvoyer`,
            { etat: 'echec', canal: 'sms', incertain: true, message: `Envoi du SMS incertain (${e.raison}) : vérifiez les notes du ticket avant de le renvoyer.` });
        } else {
          signaler('error', `${code} : Terminé — SMS non envoyé : ${e.raison}`,
            { etat: 'echec', canal: 'sms', message: `SMS non envoyé : ${e.raison}. ${aEmail ? 'Envoyez-le par e-mail ou réessayez.' : 'Réessayez ou choisissez un autre canal.'}` });
        }
      }
    } catch (err) {
      // Imprévu : le ticket reste terminé, la carte n'est pas laissée verrouillée sur « Envoi… »
      signaler('error', `${code} : Terminé — message non envoyé : ${err?.message || 'erreur inattendue'}`,
        { etat: 'echec', canal: null, message: 'Message non envoyé : réessayez depuis cette carte.' });
    }
  }, [toast, user.utilisateur, afficherAuto]);

  const runStatus = useCallback(async (d) => {
    const { id, code, statut, assign } = d;
    marquerEnvoi(id, true);
    let res;
    try {
      res = await api.changeStatus(id, statut);
      if (assign) await api.updateTicket(id, { technicien_assigne: assign }).catch(() => {});
      invalidateCache('tickets', 'dashboard');
      notifyTicketUpdated(id);
    } catch (err) {
      playScanSound('error');
      toast.error(`${code} : ${err?.message || 'changement de statut impossible'}`);
      marquerEnvoi(id, false);
      if (viewRef.current?.id === id) reload(id);
      return;
    }
    // Réparation terminée et enregistrée : le panneau propose de ranger l'appareil (« Rangé où ? »)
    if (statut === TERMINE) {
      setView((v) => (v && v.id === id ? { ...v, ranger: (v.ranger || 0) + 1 } : v));
    }
    if (d.prevenir) {
      if (viewRef.current?.id === id) {
        // Carte verrouillée (« Préparation du message… ») avant même la relecture de la fiche :
        // ses boutons ne peuvent pas lancer un second envoi pendant celui-ci
        afficherAuto(id, { etat: 'envoi', canal: canalPrevenir(avecTelJoignable(d.ticket)), message: 'Préparation du message…' });
        // Fiche relue (« Réparation terminée ») avant de rendre la main : pas de second « Terminé + prévenir »,
        // et la remise reste possible pendant l'envoi du message
        await reload(id);
      }
      marquerEnvoi(id, false);
      await prevenirApresTermine(d);
      if (viewRef.current?.id === id) reload(id);
      return;
    }
    if (d.sansPrevenir) {
      // Choix explicite : pas de proposition, la carte « Prévenir » reste disponible, repliée
      toast.success(`${code} : ${statut}`);
      setView((v) => (v && v.id === id ? { ...v, carteRepliee: (v.carteRepliee || 0) + 1 } : v));
    } else if (!res?.proposer_message) {
      toast.success(`${code} : ${statut}`);
    } else if (viewRef.current?.id === id) {
      // Panneau ouvert sur ce ticket : le message pré-rempli s'affiche en tête (rien n'est envoyé seul)
      toast.success(`${code} : ${statut}`);
      setView((v) => (v && v.id === id ? { ...v, proposition: statut } : v));
    } else {
      // Panneau fermé entre-temps : la notification le rouvre sur la proposition
      toast.success(`${code} : ${statut} — prévenir le client ?`, {
        duration: 10_000,
        onClick: () => showTicketRef.current?.(id, { label: code, proposition: statut }),
      });
    }
    marquerEnvoi(id, false);
    if (viewRef.current?.id === id) reload(id);
  }, [toast, reload, marquerEnvoi, prevenirApresTermine, afficherAuto]);

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
      prevenir: !!action.prevenir,
      sansPrevenir: !!action.sansPrevenir,
      // Fiche telle qu'affichée au clic : destinataire et montant du message « prêt »
      ticket: action.prevenir ? t : null,
      label: libelleDiffere(t, action),
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

  const showTicket = useCallback(async (id, {
    seq = ++seqRef.current, label = '', silent = false, proposition = null, auto = null,
  } = {}) => {
    setLookup((l) => l || { label: label || `#${id}` });
    try {
      const data = await fetchTicket(id);
      if (seq !== seqRef.current) return;
      if (!data.ticket?.montants) loadTva();
      chargerCatalogue();
      wizardRef.current = false;
      if (!silent) playScanSound('ok');
      setView({
        n: seq, id, ...data, verified: false, mismatch: null, proposition, auto,
        // Rouvert depuis une notification « prévenir le client » : la carte est dépliée et prend le focus
        carteN: proposition === TERMINE || auto ? 1 : 0,
      });
    } catch (err) {
      if (seq !== seqRef.current) return;
      playScanSound('error');
      toast.error(scanErrorMessage(err, { kind: 'ticket', label: `#${id}` }));
    } finally {
      if (seq === seqRef.current) setLookup(null);
    }
  }, [fetchTicket, toast, loadTva, chargerCatalogue]);

  const showTicketRef = useRef(showTicket);
  showTicketRef.current = showTicket;

  const handleScan = useCallback(async (scan) => {
    const label = scan.label || scan.query;
    if (busyRef.current) {
      playScanSound('error');
      toast.warning('Remise en cours d’enregistrement : patientez avant de scanner.');
      return;
    }
    // Scan pendant une saisie « Rangé où ? » (la douchette a laissé le champ tel qu'avant le scan) :
    // la sortie du champ enregistre l'emplacement tapé avant que le panneau passe au scan suivant
    const actif = typeof document !== 'undefined' ? document.activeElement : null;
    if (actif?.closest?.('[data-rangement]') && typeof actif.blur === 'function') actif.blur();
    commitDeferred();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      playScanSound('error');
      toast.error(`Hors connexion : impossible de vérifier ${label}.`);
      return;
    }
    const seq = ++seqRef.current;
    setLookup({ label });
    // Ouverture demandée par l'interface (openQuickScan) : ticket déjà connu, rien à résoudre
    const manuel = !!scan.ticketId;
    try {
      const r = manuel
        ? { type: 'ticket', id: scan.ticketId, ticket_code: scan.code }
        : await api.resolveCode(scan.query);
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
      if (cur && cur.id === r.id && manuel) {
        reload(r.id);
        return;
      }
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
      await showTicket(r.id, { seq, silent: manuel });
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

  const pretRecupere = useCallback(async (t) => {
    busyRef.current = true;
    try {
      const res = await api.updateTicket(t.id, { telephone_pret_rendu: 1 });
      await api.addHistory(t.id, `Téléphone de prêt restitué — par ${user.utilisateur}`)
        .catch(() => toast.warning(`${t.ticket_code} : restitution du prêt non notée dans l’historique.`));
      invalidateCache('tickets', 'dashboard');
      notifyTicketUpdated(t.id, res?.ticket);
      playScanSound('ok');
      toast.success(`${t.ticket_code} : téléphone de prêt récupéré`);
      reload(t.id);
      return res;
    } finally {
      busyRef.current = false;
    }
  }, [toast, reload, user.utilisateur]);

  // « Contacté par tél. » noté (POST /api/tickets/{id}/contact fait par ContactClient) : contact du
  // serveur repris tout de suite, dashboard et fiche prévenus, notes relues (la note « appel » s'y ajoute)
  const clientContacte = useCallback((id, contact) => {
    if (contact) setView((v) => (v && v.id === id && v.ticket ? { ...v, ticket: { ...v.ticket, contact } } : v));
    invalidateCache('tickets', 'dashboard');
    notifyTicketUpdated(id);
    reload(id);
  }, [reload]);

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
      tel: telJoignable(t),
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
          catalogue={catalogue}
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
          onPretRecupere={pretRecupere}
          onContacte={clientContacte}
          onShowTicket={(id, label) => showTicket(id, { label })}
          emplacements={emplacements}
          onBesoinEmplacements={chargerEmplacements}
          onEmplacement={majEmplacement}
          onDismissMismatch={() => setView((v) => (v ? { ...v, mismatch: null } : v))}
          onDismissProposition={() => setView((v) => (v ? { ...v, proposition: null } : v))}
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

// Points d'attention : encarts du système (rouge = danger, ambre = attention, bleu = information)
const ALERT_STYLES = {
  danger: 'callout-danger',
  warning: 'callout-warning',
  info: 'callout-info',
};

function ScanDialog({
  view, role, tva, userName, deferred, onClose, onReload, onOpenTicket, onOpenClient, onPrint,
  onSchedule, onCancelDeferred, onCommitDeferred, onRestitution, onEncaisser, onPretRecupere, onShowTicket,
  onDismissMismatch, onDismissProposition, onWizardChange, onContacte = () => {},
  emplacements = null, onBesoinEmplacements = () => {}, onEmplacement = () => {}, catalogue = null,
}) {
  const toast = useToast();
  const { actif: smsServeur } = useSmsServeur();
  const t = view.ticket || {};
  const m = useMemo(() => montantsTicket(t, tva), [t, tva]);
  const alertes = useMemo(() => alertesTicket(t, m, view.notes), [t, m, view.notes]);
  // Statut en cours d'enregistrement : rien à reproposer tant que la fiche n'est pas relue
  const actionsBase = useMemo(
    () => (view.envoiStatut ? [] : actionsTicket(t, role, view.notes)),
    [t, role, view.notes, view.envoiStatut],
  );
  const aPrevenir = actionsBase.some((a) => a.prevenir);
  // Modèles de la boutique : le sous-titre de « Terminé + prévenir » annonce un blocage « tarif à 0 € » avant le clic
  const [modeles, setModeles] = useState(null);
  useEffect(() => {
    if (!aPrevenir || modeles) return undefined;
    let vivant = true;
    chargerContexteMessage().then((c) => { if (vivant) setModeles(c.templates); });
    return () => { vivant = false; };
  }, [aPrevenir, modeles]);
  const actions = useMemo(() => actionsBase.map((a) => (a.prevenir
    ? { ...a, hint: indicationPrevenir(t, smsServeur, modeles), manuel: !smsServeur }
    : a)), [actionsBase, t, smsServeur, modeles]);
  const verifier = montantAVerifier(t, m, view.notes);
  const notes = useMemo(() => (view.notes || []).filter((n) => n.important).slice(0, 3), [view.notes]);
  const cfg = getStatusConfig(t.statut);
  const jours = joursDepuis(t.date_depot);

  const titleId = useId();
  const descId = useId();
  const confirmIds = useId();
  const propositionId = useId();
  const propositionRef = useRef(null);
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const wizardTitleRef = useRef(null);
  const scrollRef = useRef(null);
  const [wizard, setWizard] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [done, setDone] = useState(null);
  const alertesVisibles = done ? alertes.filter((a) => a.id !== 'rendu') : alertes;
  const [soundOn, setSoundOn] = useState(isScanSoundOn);

  // Carte « Prévenir le client » : ticket terminé, ou juste après « Terminé + prévenir »
  const carteTitreRef = useRef(null);
  const carteBoutonRef = useRef(null);
  const carteVisible = !wizard && !done && !estRendu(t)
    && (t.statut === TERMINE || view.proposition === TERMINE || !!view.auto);
  // Dépliée juste après « Terminé + prévenir » (ou rouverte depuis sa notification). Simple scan d'un
  // ticket terminé : souvent la remise, client au comptoir — une ligne « Pas encore prévenu · Prévenir… »
  const [carteOuverte, setCarteOuverte] = useState(() => (
    view.proposition === TERMINE || (!!view.auto && view.auto.etat !== 'envoye')
  ));
  const [focusCarte, setFocusCarte] = useState(null);
  // Focus de la carte demandé mais pas encore posé (il arrive au rendu suivant)
  const focusCarteAttenteRef = useRef(false);

  // Rangement : « Rangé où ? » proposé après « Terminé » (view.ranger), ou ouvert à la demande
  const rangementDescId = useId();
  const rangementEditeurRef = useRef(null);
  const rangementBoutonRef = useRef(null);
  const [rangementManuel, setRangementManuel] = useState(false);
  // Valeur de view.ranger quand la proposition a été fermée (enregistrée ou « Plus tard »)
  const [inviteFermee, setInviteFermee] = useState(0);
  const [annonceRangement, setAnnonceRangement] = useState('');
  const rangerVuRef = useRef(view.ranger || 0);
  // 'invite' (après « Terminé ») ou 'manuel' (clic) : focus à poser dans l'éditeur
  const focusRangerRef = useRef(null);
  const retourRangementRef = useRef(false);
  const emplacement = emplacementAffiche(t, view.emplacementSaisi);
  const inviteRangement = !!view.ranger && view.ranger !== inviteFermee;
  const blocRangement = rangementVisible(t, {
    emplacement, rendu: !!done, edition: inviteRangement || rangementManuel,
  });
  // Pendant la remise : l'emplacement reste affiché, sans saisie
  const editionRangement = blocRangement && !wizard
    ? (inviteRangement ? 'invite' : rangementManuel ? 'manuel' : null) : null;

  useEffect(() => { onBesoinEmplacements(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fermerRangement = useCallback(({ rendreFocus = true } = {}) => {
    if (view.ranger) setInviteFermee(view.ranger);
    setRangementManuel(false);
    focusRangerRef.current = null;
    if (rendreFocus) retourRangementRef.current = true;
  }, [view.ranger]);

  const rangementEnregistre = (valeur) => {
    // Enregistré au clic ou à l'Entrée (focus dans l'éditeur) : le focus revient sur « Modifier » ;
    // enregistré en quittant le champ vers une autre action : il y reste
    const dedans = !!rangementEditeurRef.current?.contains(document.activeElement);
    onEmplacement(view.id, valeur);
    setAnnonceRangement(valeur ? `Rangé en ${valeur}` : 'Emplacement retiré');
    fermerRangement({ rendreFocus: dedans });
  };

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

  // Message proposé après le changement de statut : affiché en tête, le focus y va
  // (« Réparation terminée » : la carte « Prévenir le client » s'en charge)
  useEffect(() => {
    if (!view.proposition || view.proposition === TERMINE) return;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    propositionRef.current?.focus({ preventScroll: true });
  }, [view.proposition]);

  // « Terminé + prévenir » ou notification rouverte : carte dépliée (réduite une fois le message parti)
  // et focus dessus — sur le bouton à utiliser quand il reste un geste à faire : SMS à envoyer depuis
  // Messages, ou autre canal après un refus (jamais après un envoi incertain : vérifier d'abord)
  useEffect(() => {
    if (!view.carteN) return;
    const etat = view.auto?.etat;
    setCarteOuverte(etat !== 'envoye');
    const geste = etat === 'manuel' || (etat === 'echec' && !view.auto?.incertain);
    focusCarteAttenteRef.current = true;
    setFocusCarte({ cible: geste ? 'bouton' : 'titre', n: view.carteN });
  }, [view.carteN]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view.carteRepliee) setCarteOuverte(false);
  }, [view.carteRepliee]);

  useEffect(() => {
    if (!focusCarte) return;
    focusCarteAttenteRef.current = false;
    const titre = carteTitreRef.current;
    const bouton = carteBoutonRef.current;
    const el = focusCarte.cible === 'bouton' && bouton && !bouton.disabled && bouton.isConnected ? bouton : titre;
    if (!el) return;
    el.focus({ preventScroll: true });
    const scroller = scrollRef.current;
    if (scroller && titre) {
      const top = titre.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
      scroller.scrollTop = Math.max(0, top);
    }
  }, [focusCarte]);

  // Rangement (après les focus de la carte, avant le repli sur le titre ci-dessous) :
  // - éditeur refermé : le focus revient sur « Modifier » / « Noter l'emplacement » ;
  // - ouvert au clic : focus dans le champ (tablette : sur un bouton d'emplacement, sans clavier virtuel) ;
  // - « Rangé où ? » après « Terminé » : focus dans le champ seulement s'il ne prend la place
  //   d'aucune action en cours (barre d'annulation, remise, confirmation, carte « Prévenir » qui
  //   attend un geste ou un envoi) et si le focus n'a été posé que par le panneau lui-même.
  //   La douchette reste utilisable : ScanListener retire le scan du champ et bloque son Entrée.
  useEffect(() => {
    if (view.ranger && view.ranger !== rangerVuRef.current) {
      rangerVuRef.current = view.ranger;
      focusRangerRef.current = 'invite';
    }
    if (retourRangementRef.current) {
      retourRangementRef.current = false;
      const active = document.activeElement;
      if (!active || active === document.body || !dialogRef.current?.contains(active)) {
        rangementBoutonRef.current?.focus({ preventScroll: true });
      }
    }
    const demande = focusRangerRef.current;
    if (!demande) return;
    const editeur = rangementEditeurRef.current;
    if (demande === 'manuel') {
      if (!editeur) return;
      focusRangerRef.current = null;
      // Tablette : premier bouton d'emplacement (pas de clavier virtuel), sinon le champ
      const cible = (ecranTactile() && editeur.querySelector('button[aria-pressed]:not([disabled])'))
        || editeur.querySelector('input') || editeur;
      cible.focus({ preventScroll: true });
      return;
    }
    const etat = view.auto?.etat;
    if (!editeur || wizard || confirm || deferred || ecranTactile() || (etat && etat !== 'envoi' && etat !== 'envoye')) {
      focusRangerRef.current = null;
      return;
    }
    // Statut ou message en cours d'enregistrement, focus de la carte pas encore posé : on attend
    if (view.envoiStatut || etat === 'envoi' || focusCarteAttenteRef.current) return;
    focusRangerRef.current = null;
    const active = document.activeElement;
    const libre = !active || active === document.body || active === titleRef.current
      || active === carteTitreRef.current || editeur.contains(active);
    if (libre) editeur.querySelector('input')?.focus({ preventScroll: true });
  });

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
    if (!action || confirm.submitting) return;
    if (action.id === 'pret') {
      setConfirm((c) => ({ ...c, submitting: true }));
      try {
        await onPretRecupere(t);
        setConfirm(null);
      } catch (err) {
        playScanSound('error');
        toast.error(`${t.ticket_code} : ${err?.message || 'enregistrement impossible'}`);
        setConfirm((c) => (c ? { ...c, submitting: false } : c));
      }
      return;
    }
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

  const primary = actions.filter((a) => a.primary && !a.note);
  const secondary = actions.filter((a) => !a.primary && !a.note);
  // Lignes d'explication (pas des boutons) : « Attente d'accord : passez par la fiche »
  const notesActions = actions.filter((a) => a.note);
  // « Rangé en B3 » lu avec le résumé à l'ouverture du panneau
  const descriptionPanneau = blocRangement && !editionRangement ? `${descId} ${rangementDescId}` : descId;

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
        aria-describedby={descriptionPanneau}
        onKeyDown={onKeyDown}
        className="relative flex max-h-[94vh] w-full flex-col overflow-hidden supports-[overflow:clip]:overflow-clip rounded-t-xl bg-white shadow-lg sm:max-h-[90vh] sm:max-w-2xl sm:rounded-xl motion-safe:animate-scale-in"
      >
        <div className="h-1.5 shrink-0" style={{ backgroundColor: cfg.color }} aria-hidden="true" />

        <header className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-3 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 t-overline">
                <ScanLine className="h-4 w-4" aria-hidden="true" /> Scan comptoir
              </p>
              <h2 id={titleId} ref={titleRef} tabIndex={-1}
                className="mt-0.5 rounded font-mono text-3xl font-bold tracking-tight tabular-nums text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                {t.ticket_code || `#${view.id}`}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge statut={t.statut} size="lg" />
                <PrioriteBadge priorite={t.priorite} taille="lg" />
                {t.est_retour_sav && (
                  <span className="badge badge-lg badge-warning">Retour SAV</span>
                )}
                {view.verified && (
                  <span className="badge badge-lg badge-success">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" /> {VERIFIED_LABELS[view.verified] || VERIFIED_LABELS.ticket}
                  </span>
                )}
              </div>
              <p id={descId} className="mt-2 text-sm text-slate-600">
                {modeleTicket(t)}
                {t.date_depot ? ` · déposé le ${formatDateShort(t.date_depot)}` : ''}
                {jours != null && (
                  <span className={jours > 30 ? 'font-semibold text-red-700' : ''}>
                    {jours === 0 ? ' (aujourd’hui)' : jours === 1 ? ' (hier)' : ` (il y a ${jours} j)`}
                  </span>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={toggleSound} aria-pressed={soundOn}
                aria-label="Son de la douchette" title={soundOn ? 'Son activé' : 'Son coupé'}
                className={`flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 ${FOCUS_RING}`}>
                {soundOn ? <Volume2 className="h-5 w-5" aria-hidden="true" /> : <VolumeX className="h-5 w-5" aria-hidden="true" />}
              </button>
              <button type="button" onClick={onClose} disabled={busy} aria-label="Fermer le panneau"
                className={`flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-400 disabled:hover:bg-transparent ${FOCUS_RING}`}>
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
          {blocRangement && (
            <Rangement
              ticketId={view.id}
              emplacement={emplacement}
              emplacements={emplacements}
              edition={editionRangement}
              modifiable={!wizard}
              descId={rangementDescId}
              annonce={annonceRangement}
              editeurRef={rangementEditeurRef}
              boutonRef={rangementBoutonRef}
              onOuvrir={() => {
                setRangementManuel(true);
                focusRangerRef.current = 'manuel';
              }}
              onFermer={() => fermerRangement()}
              onSaved={rangementEnregistre}
            />
          )}
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {view.proposition && view.proposition !== TERMINE && !wizard && (
            <section aria-labelledby={propositionId} className="card p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 id={propositionId} ref={propositionRef} tabIndex={-1}
                    className="flex items-center gap-2 rounded t-h2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    <MessageCircle className="h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
                    Prévenir {t.client_prenom || 'le client'} ?
                  </h3>
                  <p className="mt-0.5 text-sm text-slate-600">
                    « {view.proposition} » : message pré-rempli, rien n’est envoyé sans votre clic.
                  </p>
                </div>
                <button type="button" onClick={onDismissProposition} className="btn-secondary btn-sm shrink-0">
                  Plus tard
                </button>
              </div>
              <div className="card-section p-3">
                <Suspense fallback={<p className="text-sm text-slate-600">Chargement du message…</p>}>
                  <MessageComposer ticket={t} statutPropose={view.proposition} integre
                    onMessageSent={(r) => { if (!r?.echec) onDismissProposition(); }} />
                </Suspense>
              </div>
            </section>
          )}

          {view.mismatch && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="flex items-start gap-2 text-sm font-semibold text-red-800">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                {view.mismatch.code} scanné pendant la remise de {t.ticket_code} : vérifiez que c’est le bon appareil.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => onShowTicket(view.mismatch.id, view.mismatch.code)} className="btn-danger">
                  Afficher {view.mismatch.code}
                </button>
                <button type="button" onClick={onDismissMismatch} className="btn-secondary">
                  Continuer la remise de {t.ticket_code}
                </button>
              </div>
            </div>
          )}

          {done && (
            <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="flex items-center gap-2 text-base font-bold text-emerald-800">
                <CircleCheckBig className="h-5 w-5 shrink-0" aria-hidden="true" />
                {done.deja ? 'Déjà rendu au client' : 'Rendu au client'}
              </p>
              <p className="mt-1 text-sm text-emerald-800">
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
                <li key={a.id} className={`callout font-semibold ${ALERT_STYLES[a.level]}`}>
                  {a.level === 'info'
                    ? <Info aria-hidden="true" />
                    : <AlertTriangle aria-hidden="true" />}
                  <span className="min-w-0 break-words">{a.text}</span>
                </li>
              ))}
            </ul>
          )}

          {carteVisible && (
            <PrevenirClient
              ticket={t}
              notes={view.notes}
              auto={view.auto}
              smsServeur={smsServeur}
              auteur={userName}
              ouverte={carteOuverte}
              onOuvrir={() => setCarteOuverte(true)}
              onReplier={() => {
                setCarteOuverte(false);
                if (view.proposition === TERMINE) onDismissProposition();
              }}
              onEnvoye={() => {
                setCarteOuverte(false);
                setFocusCarte({ cible: 'titre', n: Date.now() });
                onReload(view.id);
              }}
              onNotesChange={() => onReload(view.id)}
              titreRef={carteTitreRef}
              boutonRef={carteBoutonRef}
            />
          )}

          {wizard && (
            <RestitutionForm t={t} m={m} verifier={verifier} state={wizard} setState={setWizard} titleRef={wizardTitleRef} />
          )}

          {/* Détail du paiement (total, acompte). Le « reste à payer » n'est affiché qu'une fois : dans le point
              d'attention rouge ci-dessus ; ce bloc ne reprend un montant en grand que pour confirmer « Payé » / « Rien à payer ». */}
          <section aria-label="Paiement" className="card-section">
            <h3 className="flex items-center gap-1.5 t-h3">
              <Wallet className="h-4 w-4 text-slate-400" aria-hidden="true" /> Paiement
            </h3>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-600">
                  {m.refusServeur ? 'Frais dus (devis refusé)' : m.estime ? 'Total (devis estimé)' : 'Total TTC'}
                </dt>
                <dd className="text-right font-semibold tabular-nums text-slate-900">{formatPrix(m.total)}</dd>
                <dt className="text-slate-600">Acompte</dt>
                <dd className="text-right font-semibold tabular-nums text-slate-900">{formatPrix(m.acompte)}</dd>
              </dl>
              {m.reste <= 0 && (
                <div className="text-right">
                  <span className="block text-sm font-semibold text-emerald-700">
                    {m.paye ? 'Payé' : 'Rien à payer'}
                  </span>
                  <span className="block text-3xl font-bold tabular-nums leading-none text-emerald-700">
                    {formatPrix(m.reste)}
                  </span>
                </div>
              )}
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <section aria-label="Client" className="card p-4">
              <h3 className="flex items-center gap-1.5 t-h3">
                <UserRound className="h-4 w-4 text-slate-400" aria-hidden="true" /> Client
              </h3>
              <p className="mt-1 text-lg font-bold text-slate-900">
                {[t.client_prenom, String(t.client_nom ?? '').toUpperCase()].filter(Boolean).join(' ') || '—'}
              </p>
              {t.client_societe && <p className="text-sm text-slate-600">{t.client_societe}</p>}
              {telJoignable(t) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <a href={`tel:${telJoignable(t).replace(/[^\d+]/g, '')}`} className="btn-secondary text-base tabular-nums">
                    <Phone aria-hidden="true" /> {libelleJoignable(t)}
                  </a>
                  <a href={waLink(telJoignable(t), '')} target="_blank" rel="noopener noreferrer"
                    aria-label={`WhatsApp ${libelleJoignable(t)}`}
                    className="btn-secondary btn-icon">
                    <MessageCircle className="text-emerald-700" aria-hidden="true" />
                  </a>
                </div>
              )}
              {estAutreNumero(t) && t.client_tel && (
                <p className="mt-1.5 text-sm text-slate-600 tabular-nums">Appareil déposé : {formatTel(t.client_tel)}</p>
              )}
              {/* Client contacté depuis le dernier changement de statut (même vérité que le dashboard et l'étagère) ;
                  ContactClient fait lui-même 44 px au doigt */}
              <div className="mt-3 border-t border-slate-100 pt-3">
                <ContactClient ticket={t} taille="carte" auteur={userName} onContacte={(contact) => onContacte(view.id, contact)} />
              </div>
            </section>

            <section aria-label="Appareil" className="card p-4">
              <h3 className="flex items-center gap-1.5 t-h3">
                <Smartphone className="h-4 w-4 text-slate-400" aria-hidden="true" /> Appareil
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
                            {ligneAChiffrer(l, catalogue) ? (
                              // Reprise : pas de prix tant que la boutique ne l'a pas chiffré dans la fiche
                              <span className="t-caption shrink-0 text-right">{mentionAChiffrer(catalogue)}</span>
                            ) : (
                              <span className="shrink-0 tabular-nums">{formatPrix(l.prix)}</span>
                            )}
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

          {notes.length > 0 && (
            <section aria-label="Notes importantes" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="flex items-center gap-1.5 t-h3 text-amber-900">
                <StickyNote className="h-4 w-4" aria-hidden="true" /> Notes importantes
              </h3>
              <ul className="mt-2 space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="text-sm text-amber-950">
                    <p className="whitespace-pre-line break-words">{n.contenu}</p>
                    <p className="mt-0.5 t-caption text-amber-800">
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
                className="btn-secondary btn-lg">
                Retour
              </button>
              <button type="button" onClick={submitRendre} disabled={wizard.submitting}
                className="btn-success btn-lg font-bold">
                {wizard.submitting
                  ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  : <PackageCheck aria-hidden="true" />}
                {wizard.submitting ? 'Enregistrement…' : 'Confirmer la remise'}
              </button>
            </div>
          ) : confirm ? (
            <div role="group" aria-label="Confirmation" className="rounded-xl border border-amber-200 bg-amber-50 p-3">
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
                  className="btn-secondary btn-lg px-3">
                  Annuler
                </button>
                <button type="button" onClick={confirmAction} disabled={confirm.submitting}
                  className={`btn-lg px-3 ${confirm.action.id === 'encaisser' ? 'btn-success' : 'btn-primary'}`}>
                  {confirm.submitting && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  {confirm.action.id === 'encaisser' ? 'Confirmer l’encaissement' : confirm.action.warn?.ok || 'Oui, continuer'}
                </button>
              </div>
            </div>
          ) : view.envoiStatut ? (
            <p role="status" className="flex min-h-[52px] items-center justify-center gap-2 text-sm font-semibold text-slate-700">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Enregistrement…
            </p>
          ) : primary.length + secondary.length > 2 ? (
            // Action principale sur toute la largeur, les autres en dessous
            <div className="space-y-2">
              {primary.length > 0 && (
                <div className="grid gap-2 sm:grid-flow-col sm:auto-cols-fr">
                  {primary.map((a) => (
                    <ActionButton key={a.id} action={a} onClick={() => startAction(a)} primary />
                  ))}
                </div>
              )}
              <div className={`grid gap-2 ${secondary.length === 2 ? 'grid-cols-2' : 'sm:grid-flow-col sm:auto-cols-fr'}`}>
                {secondary.map((a) => (
                  <ActionButton key={a.id} action={a} onClick={() => startAction(a)} />
                ))}
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

          {!wizard && !confirm && !deferred && !view.envoiStatut && notesActions.map((a) => (
            <p key={a.id} className="flex items-center gap-1.5 text-sm font-medium text-slate-600">
              <Info className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /> {a.label}
            </p>
          ))}

          {!wizard && (
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => onOpenTicket(view.id)} disabled={busy}
                className="btn-secondary min-h-[48px] flex-col gap-0.5 px-2 text-xs sm:flex-row sm:gap-2 sm:text-sm">
                <ExternalLink className="h-4 w-4" aria-hidden="true" /> Ouvrir la fiche
              </button>
              <button type="button" onClick={() => onOpenClient(t.client_id)} disabled={busy || !t.client_id}
                className="btn-secondary min-h-[48px] flex-col gap-0.5 px-2 text-xs sm:flex-row sm:gap-2 sm:text-sm">
                <UserRound className="h-4 w-4" aria-hidden="true" /> Fiche client
              </button>
              <button type="button" onClick={() => onPrint(t)} disabled={busy}
                className="btn-secondary min-h-[48px] flex-col gap-0.5 px-2 text-xs sm:flex-row sm:gap-2 sm:text-sm">
                <Printer className="h-4 w-4" aria-hidden="true" /> {done || estRendu(t) ? 'Imprimer le reçu' : 'Imprimer'}
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

/**
 * Emplacement de l'appareil, en tête du panneau (visible pendant la remise) : « Rangé en B3 » en
 * très gros pour aller le chercher, « Pas d'emplacement noté » sur un ticket terminé, ou l'éditeur
 * « Rangé où ? » (EmplacementInput, boutons des emplacements configurés). Facultatif, jamais bloquant.
 */
function Rangement({
  ticketId, emplacement, emplacements, edition, modifiable, descId, annonce,
  editeurRef, boutonRef, onOuvrir, onFermer, onSaved,
}) {
  // Lisible de loin : plus le nom est long, plus la police est petite (20 caractères au plus)
  const taille = !emplacement || emplacement.length <= 4 ? 'text-5xl'
    : emplacement.length <= 8 ? 'text-4xl' : 'text-2xl';

  let contenu;
  if (edition) {
    contenu = (
      // Hauteur bornée (téléphone à l'horizontale) : le pied du panneau reste visible
      <div ref={editeurRef} data-rangement="" tabIndex={-1}
        className="card-section flex max-h-[38vh] items-start gap-2 overflow-y-auto overscroll-contain p-3 focus:outline-none">
        <EmplacementInput ticketId={ticketId} value={emplacement} emplacements={emplacements || []}
          label="Rangé où ?" onSaved={onSaved} className="min-w-0 flex-1" />
        <button type="button" onClick={onFermer} data-rangement-fermer=""
          aria-label={edition === 'invite' ? 'Ranger l’appareil plus tard' : 'Fermer la saisie de l’emplacement'}
          className="btn-secondary min-h-[44px] shrink-0">
          {edition === 'invite' ? 'Plus tard' : 'Fermer'}
        </button>
      </div>
    );
  } else if (emplacement) {
    contenu = (
      // Pavé sombre conservé : l'emplacement se lit de loin, c'est le repère pour aller chercher l'appareil
      <div className="flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-2 text-white">
        <MapPin className="h-7 w-7 shrink-0 text-brand-300" aria-hidden="true" />
        <p id={descId} className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-300">Rangé en</span>{' '}
          <span className={`block break-words font-mono font-black leading-none tracking-wide ${taille}`}>{emplacement}</span>
        </p>
        {modifiable && (
          <button ref={boutonRef} type="button" onClick={onOuvrir} aria-label="Modifier l’emplacement"
            className="btn min-h-[44px] shrink-0 border border-white/30 bg-white/10 text-white hover:bg-white/20 focus-visible:ring-white focus-visible:ring-offset-slate-900">
            Modifier
          </button>
        )}
      </div>
    );
  } else {
    contenu = (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-2">
        <MapPin className="h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
        {/* Téléphone : le bouton passe à la ligne plutôt que d'écraser le texte */}
        <p id={descId} className="min-w-[12rem] flex-1 text-base font-bold text-slate-800">Pas d’emplacement noté</p>
        {modifiable && (
          <button ref={boutonRef} type="button" onClick={onOuvrir} className="btn-secondary min-h-[44px] shrink-0">
            Noter l’emplacement
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3">
      {contenu}
      {/* Annonce discrète après un enregistrement (l'éditeur, refermé aussitôt, ne la ferait pas) */}
      <p role="status" aria-live="polite" className="sr-only">{annonce}</p>
    </div>
  );
}

const ACTION_ICONS = {
  rendre: PackageCheck, demarrer: Play, terminer: Send, terminer_seul: CircleCheckBig,
  encaisser: HandCoins, facturer: Receipt, pret: Smartphone,
};
// Vert plein réservé à la remise et à l'encaissement ; toute autre action principale est violette (marque)
const ACTION_COLORS = {
  rendre: 'btn-success',
  encaisser: 'btn-success',
};

function ActionButton({ action, onClick, primary = false }) {
  const Icon = ACTION_ICONS[action.icon || action.id] || Play;
  const cls = primary
    ? `${ACTION_COLORS[action.id] || 'btn-primary'} btn-lg min-h-[56px] text-lg font-bold`
    : 'btn-secondary btn-lg';
  return (
    <button type="button" onClick={onClick}
      className={`${cls} w-full whitespace-normal py-1.5`}>
      <Icon aria-hidden="true" />
      {action.hint ? (
        // Par où le client sera prévenu, sous le libellé
        <span className="flex min-w-0 flex-col items-start text-left leading-tight">
          <span>{action.label}</span>
          <span className="break-words text-[13px] font-medium opacity-90">{action.hint}</span>
        </span>
      ) : action.label}
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
        className="btn bg-white text-slate-900 hover:bg-slate-100 focus-visible:ring-white focus-visible:ring-offset-slate-900">
        Annuler
      </button>
      <button type="button" onClick={onCommit}
        className="btn-ghost px-3 text-white underline underline-offset-2 hover:bg-white/10 hover:text-white focus-visible:ring-white focus-visible:ring-offset-slate-900">
        Valider maintenant
      </button>
    </div>
  );
}

const CHOICE = 'flex min-h-[48px] cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors duration-150';

function ModesPaiement({ name, value, onChange, errorId, invalid }) {
  return (
    <fieldset aria-describedby={invalid ? errorId : undefined}>
      <legend className="mb-1.5 text-sm font-semibold text-slate-800">Mode de paiement</legend>
      <div className="flex flex-wrap gap-2">
        {MODES_PAIEMENT.map((mode, i) => (
          <label key={mode}
            className="choice font-semibold has-[:checked]:border-brand-600 has-[:checked]:bg-brand-600 has-[:checked]:text-white has-[:checked]:hover:bg-brand-700 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 has-[:focus-visible]:ring-offset-2">
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
    <section aria-labelledby={`${ids}-title`} className="card space-y-3 p-4">
      <h3 id={`${ids}-title`} ref={titleRef} tabIndex={-1}
        className="flex items-center gap-2 rounded t-h2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <PackageCheck className="h-5 w-5 text-emerald-700" aria-hidden="true" /> Remise au client
      </h3>

      {!termine && (
        <label className={`${CHOICE} border-amber-300 bg-amber-50 text-amber-950`}>
          <input type="checkbox" data-field="force" checked={state.forceOk} {...fieldError('force')}
            onChange={(e) => set({ forceOk: e.target.checked })}
            className="mt-0.5 h-5 w-5 shrink-0 accent-amber-700" />
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
            className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-700" />
          <span>
            <span className="font-bold">Téléphone de prêt récupéré</span> : {String(t.telephone_pret).trim()}
            {imeiCourt(t.telephone_pret_imei) ? ` (IMEI ${imeiCourt(t.telephone_pret_imei)})` : ''}, vérifié.
          </span>
        </label>
      )}

      {verifier && reste > 0 && (
        <p className="callout callout-warning font-semibold">
          <AlertTriangle aria-hidden="true" /> {CONSEILS_FACTURATION[verifier]}
        </p>
      )}

      {reste > 0 ? (
        <fieldset className="space-y-2" data-field="paiement" tabIndex={-1}>
          <legend className="mb-1.5 text-sm font-semibold text-slate-800">
            Paiement : <span className="tabular-nums text-red-700">{formatPrix(reste)}</span> restent dus
          </legend>
          {[
            { v: 'encaisser', label: `Encaisser maintenant ${formatPrix(reste)}` },
            { v: 'non_paye', label: 'Non payé : le client réglera plus tard' },
          ].map((o) => (
            <label key={o.v} className={`${CHOICE} ${state.paiement === o.v ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
              <input type="radio" name={`${ids}-paiement`} value={o.v} checked={state.paiement === o.v}
                onChange={() => set({ paiement: o.v })} className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" />
              <span className="font-semibold text-slate-900">{o.label}</span>
            </label>
          ))}

          {state.paiement === 'encaisser' && (
            <ModesPaiement name={`${ids}-mode`} value={state.mode} onChange={(mode) => set({ mode })}
              errorId={errId} invalid={err?.field === 'mode'} />
          )}

          {state.paiement === 'non_paye' && (
            <div>
              <label htmlFor={`${ids}-motif`} className="input-label">
                Motif (obligatoire)
              </label>
              <input id={`${ids}-motif`} type="text" data-field="motif" maxLength={200} value={state.motif}
                {...fieldError('motif')}
                onChange={(e) => set({ motif: e.target.value })}
                placeholder="Ex. : règlera au prochain passage"
                className="input input-lg" />
            </div>
          )}
        </fieldset>
      ) : (
        <p className="callout callout-success items-center font-semibold">
          <CircleCheckBig aria-hidden="true" />
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
