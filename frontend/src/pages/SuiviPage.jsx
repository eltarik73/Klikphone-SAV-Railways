import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import { usePolling } from '../hooks/usePolling';
import StatusBadge from '../components/StatusBadge';
import ProgressTracker from '../components/ProgressTracker';
import FideliteCard from '../components/FideliteCard';
import ScratchCard from '../components/ScratchCard';
import { formatDate, formatPrix } from '../lib/utils';
import { normalizeTicketCode, normalizePhoneInput } from '../lib/ticketCode';
import { Search, Smartphone, ArrowLeft, MapPin, Phone, Hash, Calendar, Wrench, CreditCard, Package, Truck, Globe, RefreshCw, Send, Star, CheckCircle2, XCircle, MessageCircle, Tag, ArrowRight, Loader2, AlertCircle, FileText, QrCode } from 'lucide-react';

const SUIVI_POLL_MS = 30_000;
// Preuve d'accès mémorisée par code ticket, le temps de l'onglet (survit à un rechargement)
const CLE_PREUVE = 'kp_suivi_preuve:';
const STAFF = ['accueil', 'tech'];

export const TEXTES = {
  aide: 'Les deux sont indiqués sur votre ticket de dépôt. Vous pouvez aussi scanner le QR code du ticket.',
  codeInvalide: 'Indiquez le numéro de ticket tel qu\'il figure sur votre ticket de dépôt (ex. KP-000123).',
  telIncomplet: 'Saisissez le numéro de téléphone complet donné lors du dépôt.',
  introuvable: 'Aucun ticket ne correspond à ce numéro. Vérifiez le numéro indiqué sur votre ticket de dépôt.',
  // Sans personnel connecté, un code inconnu et un mauvais numéro reçoivent la même réponse
  // (verification_echouee) : le message couvre les deux sans révéler si le ticket existe
  mauvaisNumero: 'Ticket introuvable ou numéro incorrect : vérifiez le numéro de ticket et le téléphone donné au dépôt.',
  lienInvalide: 'Ce lien de suivi n\'est plus valable. Saisissez le numéro de téléphone donné lors du dépôt pour ouvrir votre suivi.',
  preuveRequise: 'Pour protéger vos données, indiquez le numéro de téléphone donné lors du dépôt.',
  reseau: 'Connexion impossible. Vérifiez votre réseau puis réessayez.',
};

export function lirePreuve(code) {
  try {
    const brut = sessionStorage.getItem(CLE_PREUVE + code);
    const p = brut ? JSON.parse(brut) : null;
    return p && (p.t || p.tel) ? p : null;
  } catch {
    return null;
  }
}
export function memoriserPreuve(code, preuve) {
  try {
    if (preuve && (preuve.t || preuve.tel)) sessionStorage.setItem(CLE_PREUVE + code, JSON.stringify(preuve));
  } catch { /* stockage indisponible : la preuve reste en mémoire */ }
}
// Bornes de la boutique qui ouvrent le suivi (tablette en mode dépôt) : elles seules
// donnent un retour à l'accueil, avec retour automatique. Arrivé par le QR ou un lien (téléphone
// du client), aucun retour vers l'accueil ni la connexion du personnel.
const RETOURS_BOUTIQUE = ['/client', '/depot', '/deposer'];
export const RETOUR_AUTO_MS = 60_000;

export function retourBoutique(etat) {
  const r = typeof etat?.retour === 'string' ? etat.retour : '';
  return RETOURS_BOUTIQUE.includes(r.split('?')[0]) ? r : null;
}

export function oublierPreuve(code) {
  try { sessionStorage.removeItem(CLE_PREUVE + code); } catch { /* idem */ }
}

const preuveRefusee = (err) => err?.status === 401 || err?.status === 403;
// Le serveur a vu le numéro saisi et l'a refusé : le champ téléphone est invalide (aria-invalid)
const numeroRefuse = (err) => preuveRefusee(err) && (err?.detail?.code || err?.code) === 'verification_echouee';

// Attente après trop de tentatives (429) : Retry-After du serveur, sinon « quelques minutes »
function texteAttente(err) {
  const s = Number(err?.retryAfter);
  if (Number.isFinite(s) && s > 0) {
    const min = Math.ceil(s / 60);
    return `Trop de tentatives. Réessayez dans ${min > 1 ? `${min} minutes` : 'une minute'}.`;
  }
  return 'Trop de tentatives. Réessayez dans quelques minutes.';
}

// Message à afficher pour un refus du serveur sur une action publique
function messageErreur(err) {
  if (err?.status === 429) return texteAttente(err);
  if (err?.name === 'TypeError') return TEXTES.reseau;
  return err?.message || 'Une erreur est survenue, réessayez.';
}

/** Message du formulaire d'accès pour une fiche refusée (404, 403 {code}, 429, réseau). */
export function messageAcces(err, { depuisLien = false } = {}) {
  if (err?.status === 404) return TEXTES.introuvable;
  if (err?.status === 429) return texteAttente(err);
  if (preuveRefusee(err)) {
    const code = err?.detail?.code || err?.code;
    if (code === 'verification_echouee') return TEXTES.mauvaisNumero;
    if (code === 'lien_invalide' || depuisLien) return TEXTES.lienInvalide;
    return TEXTES.preuveRequise;
  }
  return messageErreur(err);
}

// Sous-titre de carte (icône 16 px + libellé) : un seul style pour Détail réparation / Tarification
function TitreBloc({ icone: Icone, children }) {
  return (
    <div className="t-h3 flex items-center gap-1.5 mb-2">
      <Icone className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" /> {children}
    </div>
  );
}

export default function SuiviPage() {
  const [searchParams] = useSearchParams();
  // Code du ticket : ?ticket= (QR, lien, douchette) tel quel, normalisé à la soumission
  const [code, setCode] = useState(() => (searchParams.get('ticket') || '').trim());
  const [tel, setTel] = useState('');
  const [erreurCode, setErreurCode] = useState('');
  const [erreurTel, setErreurTel] = useState('');
  // Numéro refusé par le serveur (verification_echouee) : champ invalide jusqu'à la prochaine saisie
  const [telRefuse, setTelRefuse] = useState(false);
  const [ticket, setTicket] = useState(null);
  const [commandes, setCommandes] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Ouverture par un lien avec jeton : pas de formulaire pendant le chargement
  const [ouvertureLien, setOuvertureLien] = useState(() => Boolean(searchParams.get('ticket')));
  const [lastRefresh, setLastRefresh] = useState(null);

  // Preuve acceptée par le serveur pour le ticket affiché : { t } (jeton du QR / lien) ou
  // { tel } (numéro complet donné au dépôt). Jointe à TOUS les appels de la fiche.
  const [preuve, setPreuve] = useState(null);
  const preuveRef = useRef(null);
  preuveRef.current = preuve;
  const [actionError, setActionError] = useState('');

  // Personnel connecté : la session suffit (pas de preuve) ; QR intelligent : un membre du staff
  // qui scanne le QR d'un ticket (arrivée avec ?ticket=) va sur la fiche interne.
  const { user } = useAuth();
  const estStaff = STAFF.includes(user?.target);
  const navigate = useNavigate();
  // Ouvert depuis la tablette de la boutique : retour à son accueil, preuve jamais mémorisée
  // (appareil partagé), pas de bascule vers la fiche interne même si un membre y est connecté
  const retour = retourBoutique(useLocation().state);
  const boutiqueRef = useRef(Boolean(retour));
  const fromQrRef = useRef(Boolean(searchParams.get('ticket')));
  useEffect(() => {
    if (fromQrRef.current && ticket?.id && estStaff && !boutiqueRef.current) {
      navigate(`/${user.target}/ticket/${ticket.id}`, { replace: true });
    }
  }, [estStaff, user?.target, ticket?.id, navigate]);

  // Message state
  const [message, setMessage] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [msgSent, setMsgSent] = useState(false);

  // Devis validation state
  const [devisLoading, setDevisLoading] = useState(false);
  const [devisResult, setDevisResult] = useState(null); // 'accepted' | 'refused'

  // Avis state
  const [avisNote, setAvisNote] = useState(0);
  const [avisHover, setAvisHover] = useState(0);
  const [avisComment, setAvisComment] = useState('');
  const [avisLoading, setAvisLoading] = useState(false);
  const [avisSent, setAvisSent] = useState(false);
  const [hasAvis, setHasAvis] = useState(false);

  // Focus : champ téléphone après un refus (lien invalide, mauvais numéro), titre après ouverture
  const telRef = useRef(null);
  const titreRef = useRef(null);
  const [focusTel, setFocusTel] = useState(0);
  useEffect(() => {
    if (focusTel > 0) telRef.current?.focus();
  }, [focusTel]);

  const chargerAnnexes = (ticketCode, p) => {
    api.getPublicCommandes(ticketCode, p).then(setCommandes).catch(() => setCommandes([]));
    api.suiviHasAvis(ticketCode, p).then(r => setHasAvis(Boolean(r?.has_avis))).catch(() => {});
  };

  // Charge la fiche avec la preuve (null pour le personnel connecté) ; un refus ramène au formulaire
  const charger = useCallback(async (ticketCode, p, { depuisLien = false } = {}) => {
    setLoading(true);
    setError('');
    setActionError('');
    setTelRefuse(false);
    setTicket(null);
    setCommandes([]);
    setDevisResult(null);
    setMsgSent(false);
    setAvisSent(false);
    try {
      const data = await api.getTicketByCode(ticketCode, p);
      const codeReel = data.ticket_code || ticketCode;
      setCode(codeReel);
      setPreuve(p);
      preuveRef.current = p;
      if (p && !boutiqueRef.current) memoriserPreuve(codeReel, p);
      setTicket(data);
      chargerAnnexes(codeReel, p);
      setTel('');
      setTimeout(() => titreRef.current?.focus(), 0);
    } catch (err) {
      if (preuveRefusee(err)) {
        oublierPreuve(ticketCode);
        setPreuve(null);
        preuveRef.current = null;
      }
      setTelRefuse(numeroRefuse(err));
      setError(messageAcces(err, { depuisLien }));
      setFocusTel(n => n + 1);
    } finally {
      setLoading(false);
      setOuvertureLien(false);
    }
  }, []);

  // Arrivée par URL : ?t=…&ticket=… (QR, lien envoyé) ouvre directement ; ?ticket= seul (ancien
  // lien, douchette) rouvre avec la preuve mémorisée dans l'onglet, sinon formulaire prérempli
  useEffect(() => {
    const brut = searchParams.get('ticket');
    if (!brut) return;
    const ticketCode = normalizeTicketCode(brut, { allowBareNumber: true }) || brut.trim().toUpperCase();
    setCode(ticketCode);
    const jeton = (searchParams.get('t') || '').trim();
    // Personnel connecté qui scanne un QR (hors borne) : sa session suffit, le jeton n'est pas joint
    if (estStaff && !boutiqueRef.current) { charger(ticketCode, null); return; }
    if (jeton) { charger(ticketCode, { t: jeton }, { depuisLien: true }); return; }
    const memo = lirePreuve(ticketCode);
    if (memo) { charger(ticketCode, memo); return; }
    setOuvertureLien(false);
    setFocusTel(n => n + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rafraîchissement toutes les 30 s, en pause quand l'onglet est masqué (reprise immédiate au retour)
  const ticketCodeRef = useRef(null);
  ticketCodeRef.current = ticket?.ticket_code || null;
  usePolling(async () => {
    const current = ticketCodeRef.current;
    if (!current) return;
    try {
      const data = await api.background(() => api.getTicketByCode(current, preuveRef.current));
      if (ticketCodeRef.current !== current) return;
      setTicket(prev => (JSON.stringify(prev) === JSON.stringify(data) ? prev : data));
      setLastRefresh(new Date());
    } catch { /* silent */ }
  }, SUIVI_POLL_MS, { enabled: Boolean(ticket?.ticket_code), immediate: false });

  // Tablette de la boutique : retour à l'accueil d'où l'on vient, de lui-même après une minute
  // sans activité (le client suivant ne doit pas trouver le dossier ouvert)
  const quitterVersAccueil = useCallback(() => {
    if (ticketCodeRef.current) oublierPreuve(ticketCodeRef.current);
    navigate(retour, { replace: true });
  }, [navigate, retour]);
  useEffect(() => {
    if (!retour) return undefined;
    let minuterie;
    const relancer = () => {
      clearTimeout(minuterie);
      minuterie = setTimeout(quitterVersAccueil, RETOUR_AUTO_MS);
    };
    const evenements = ['pointerdown', 'keydown', 'touchstart'];
    evenements.forEach((e) => window.addEventListener(e, relancer, { passive: true }));
    relancer();
    return () => {
      clearTimeout(minuterie);
      evenements.forEach((e) => window.removeEventListener(e, relancer));
    };
  }, [retour, quitterVersAccueil]);

  // Formulaire : numéro de ticket (KP-000123, « kp123 », URL du QR scanné…) + téléphone complet
  const handleSubmit = (e) => {
    e?.preventDefault();
    if (loading) return;
    const ticketCode = normalizeTicketCode(code, { allowBareNumber: true });
    const chiffres = normalizePhoneInput(tel);
    const errCode = ticketCode ? '' : TEXTES.codeInvalide;
    const errTel = chiffres.length >= 9 ? '' : TEXTES.telIncomplet;
    setErreurCode(errCode);
    setErreurTel(errTel);
    setTelRefuse(false);
    setError('');
    if (errCode || errTel) return;
    charger(ticketCode, { tel: tel.trim() });
  };

  // Retour au formulaire (preuve refusée par une action, ou « Autre ticket ») ; `refus` = l'erreur
  // du serveur, pour marquer le téléphone invalide si c'est le numéro qui a été refusé
  const retourFormulaire = (msg = '', refus = null) => {
    const ticketCode = ticket?.ticket_code || code;
    if (msg && ticketCode) oublierPreuve(ticketCode);
    setTicket(null);
    setCommandes([]);
    setPreuve(null);
    preuveRef.current = null;
    setError(msg);
    setTelRefuse(numeroRefuse(refus));
    setActionError('');
    setFocusTel(n => n + 1);
  };

  // Exécute une action protégée avec la preuve de la fiche ; preuve refusée → formulaire
  const avecPreuve = async (exec) => {
    if (!ticket) return;
    const p = preuveRef.current;
    setActionError('');
    if (!p && !estStaff) {
      retourFormulaire(TEXTES.preuveRequise);
      return;
    }
    try {
      await exec(p || {});
    } catch (err) {
      if (preuveRefusee(err)) retourFormulaire(messageAcces(err, { depuisLien: Boolean(p?.t) }), err);
      else setActionError(messageErreur(err));
    }
  };

  // Les actions lèvent l'erreur : avecPreuve décide du message à afficher
  const handleSendMessage = () => {
    const texte = message.trim();
    if (!texte || !ticket || sendingMsg) return;
    const ticketCode = ticket.ticket_code;
    avecPreuve(async (p) => {
      setSendingMsg(true);
      try {
        await api.suiviSendMessage(ticketCode, texte, p);
        setMessage('');
        setMsgSent(true);
        setTimeout(() => setMsgSent(false), 4000);
      } finally { setSendingMsg(false); }
    });
  };

  const handleDevisValidation = (accepte) => {
    if (!ticket || devisLoading) return;
    const ticketCode = ticket.ticket_code;
    avecPreuve(async (p) => {
      setDevisLoading(true);
      try {
        await api.suiviValiderDevis(ticketCode, accepte, p);
        setDevisResult(accepte ? 'accepted' : 'refused');
        // Reload ticket to get new status
        api.getTicketByCode(ticketCode, p).then(setTicket).catch(() => {});
      } finally { setDevisLoading(false); }
    });
  };

  const handleSubmitAvis = () => {
    if (avisNote === 0 || !ticket || avisLoading) return;
    const ticketCode = ticket.ticket_code;
    const note = avisNote;
    const commentaire = avisComment.trim();
    avecPreuve(async (p) => {
      setAvisLoading(true);
      try {
        await api.suiviLaisserAvis(ticketCode, note, commentaire, p);
        setAvisSent(true);
        setHasAvis(true);
      } finally { setAvisLoading(false); }
    });
  };

  // Parse repair lines for devis display
  const getRepairLines = () => {
    if (!ticket) return [];
    let repLines = [];
    try {
      const parsed = JSON.parse(ticket.reparation_supp || '[]');
      if (Array.isArray(parsed)) repLines = parsed.filter(r => r.label);
    } catch { /* legacy */ }
    if (repLines.length > 0) return repLines.map(r => ({ label: r.label, prix: Number(r.prix || 0) }));
    const devis = Number(ticket.devis_estime || 0);
    if (devis > 0) return [{ label: ticket.panne || 'Réparation', prix: devis }];
    return [];
  };

  const afficherFormulaire = !ticket && !ouvertureLien;
  const describedByTel = [erreurTel ? 'suivi-tel-erreur' : '', error ? 'suivi-erreur' : '', 'suivi-aide'].filter(Boolean).join(' ');

  const isTerminal = ticket && ['Réparation terminée', 'Rendu au client', 'Clôturé'].includes(ticket.statut);
  const isAccordClient = ticket?.statut === "En attente d'accord client";

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-[640px] mx-auto px-4 py-6 sm:py-8">
        {/* Header */}
        <div className="text-center mb-6 animate-in">
          <div className="w-14 h-14 rounded-xl bg-brand-600 text-white flex items-center justify-center mx-auto mb-4 shadow-xs" aria-hidden="true">
            <Smartphone className="w-7 h-7" />
          </div>
          <h1 className="t-display">Suivi de réparation</h1>
          <p className="text-base text-slate-500 mt-1.5">
            {ticket ? 'Suivez l\'avancement de votre réparation' : 'Indiquez le numéro de ticket et le téléphone donnés lors du dépôt'}
          </p>
        </div>

        {/* Chargement d'un lien avec jeton (QR, SMS, e-mail) : pas de formulaire à l'écran */}
        {ouvertureLien && !ticket && (
          <div role="status" className="card card-body flex items-center justify-center gap-3 text-slate-600 mb-6">
            <Loader2 className="w-5 h-5 motion-safe:animate-spin text-brand-600" aria-hidden="true" />
            <span>Ouverture de votre suivi…</span>
          </div>
        )}

        {error && (
          <div id="suivi-erreur" role="alert" className="callout callout-danger animate-in mb-4">
            <AlertCircle aria-hidden="true" />
            <p className="font-medium">{error}</p>
          </div>
        )}

        {/* Accès : numéro de ticket + téléphone (.depot-form : saisie 56 px / 16 px, pas de zoom iOS) */}
        {afficherFormulaire && (
          <form onSubmit={handleSubmit} noValidate aria-busy={loading || undefined} aria-describedby="suivi-aide"
            className="depot-form card card-body animate-in mb-6">
            <div className="space-y-4">
              <div>
                <label htmlFor="suivi-code" className="input-label">Numéro de ticket</label>
                <input id="suivi-code" type="text" value={code}
                  onChange={(e) => { setCode(e.target.value); setErreurCode(''); }}
                  placeholder="KP-000123"
                  autoComplete="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="next"
                  aria-invalid={erreurCode ? 'true' : undefined}
                  aria-describedby={erreurCode ? 'suivi-code-erreur' : undefined}
                  className="input font-mono font-bold tracking-wider uppercase placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:normal-case"
                  autoFocus={!code} />
                {erreurCode && <p id="suivi-code-erreur" role="alert" className="input-error text-sm">{erreurCode}</p>}
              </div>
              <div>
                <label htmlFor="suivi-tel" className="input-label">Numéro de téléphone</label>
                <input id="suivi-tel" ref={telRef} type="tel" value={tel}
                  onChange={(e) => { setTel(e.target.value); setErreurTel(''); setTelRefuse(false); }}
                  placeholder="06 12 34 56 78"
                  autoComplete="tel" inputMode="tel" enterKeyHint="go"
                  aria-invalid={erreurTel || telRefuse ? 'true' : undefined}
                  aria-describedby={describedByTel}
                  className="input tabular-nums" />
                {erreurTel && <p id="suivi-tel-erreur" role="alert" className="input-error text-sm">{erreurTel}</p>}
              </div>
              <p id="suivi-aide" className="flex items-start gap-2 text-sm text-slate-500">
                <QrCode className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{TEXTES.aide}</span>
              </p>
              <button type="submit" disabled={loading} className="btn-primary btn-lg btn-block min-h-14">
                {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
                Voir mon suivi
              </button>
            </div>
          </form>
        )}

        {ticket && (
          <div className="space-y-4 animate-in">
            {actionError && (
              <div role="alert" className="callout callout-danger">
                <AlertCircle aria-hidden="true" />
                <p className="font-medium">{actionError}</p>
              </div>
            )}
            {/* Pré-enregistré banner */}
            {ticket.statut === 'Pré-enregistré' && (
              <div className="callout callout-info">
                <Globe aria-hidden="true" />
                <div>
                  <p className="font-semibold">Demande pré-enregistrée</p>
                  <p className="mt-0.5">Notre équipe va valider votre demande. Présentez-vous en boutique avec votre appareil.</p>
                </div>
              </div>
            )}

            {/* Progress tracker */}
            <div className="card card-body">
              <ProgressTracker statut={ticket.statut} hasPiece={ticket.commande_piece === 1} isDistance={ticket.source === 'distance'} />
            </div>

            {/* Ticket card */}
            <div className="card card-body">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-4">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 ref={titreRef} tabIndex={-1} className="text-xl font-bold font-mono tabular-nums text-brand-700 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{ticket.ticket_code}</h2>
                  {ticket.source === 'distance' && (
                    <span className="badge badge-info">
                      <Globe className="w-3.5 h-3.5" aria-hidden="true" /> Distance
                    </span>
                  )}
                </div>
                <StatusBadge statut={ticket.statut} />
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div className="min-w-0">
                  <dt className="t-caption">Appareil</dt>
                  <dd className="mt-0.5 text-base font-medium text-slate-900 [overflow-wrap:anywhere]">{ticket.marque} {ticket.modele || ticket.modele_autre}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="t-caption">Panne</dt>
                  <dd className="mt-0.5 text-base font-medium text-slate-900 [overflow-wrap:anywhere]">{ticket.panne}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="t-caption">Déposé le</dt>
                  <dd className="mt-0.5 text-base font-medium text-slate-900 tabular-nums">{formatDate(ticket.date_depot)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="t-caption">Dernière mise à jour</dt>
                  <dd className="mt-0.5 text-base font-medium text-slate-900 tabular-nums">{formatDate(ticket.date_maj)}</dd>
                </div>
              </dl>

              {/* Date de récupération */}
              {ticket.date_recuperation && (() => {
                const d = new Date(ticket.date_recuperation);
                const isValid = !isNaN(d.getTime());
                const now = new Date();
                let countdown = '';
                if (isValid && d > now) {
                  const diff = d - now;
                  const days = Math.floor(diff / 86400000);
                  const hours = Math.floor((diff % 86400000) / 3600000);
                  countdown = days > 0 ? `dans ${days}j ${hours}h` : `dans ${hours}h`;
                } else if (isValid && d <= now) {
                  countdown = 'Date dépassée';
                }
                const displayDate = isValid ? d.toLocaleString('fr-FR', { weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' }) : ticket.date_recuperation;
                const depassee = isValid && d <= now;
                return (
                  <div className={`mt-4 callout ${depassee ? 'callout-danger' : 'callout-info'}`}>
                    <Calendar aria-hidden="true" />
                    <div>
                      <span className="font-medium">Récupération prévue : </span>
                      <span className="font-bold">{displayDate}</span>
                      {countdown && <span className="ml-2 text-xs font-semibold whitespace-nowrap">({countdown})</span>}
                    </div>
                  </div>
                );
              })()}

              {/* Réparations */}
              {(() => {
                let repLines = [];
                try { const parsed = JSON.parse(ticket.reparation_supp || '[]'); if (Array.isArray(parsed)) repLines = parsed.filter(r => r.label); } catch {}
                const hasDetail = ticket.panne_detail || repLines.length > 0;
                if (!hasDetail) return null;
                return (
                  <div className="mt-4 card-section">
                    <TitreBloc icone={Wrench}>Détail réparation</TitreBloc>
                    {ticket.panne_detail && <p className="t-body [overflow-wrap:anywhere]">{ticket.panne_detail}</p>}
                    {repLines.length > 0 && <p className="t-body [overflow-wrap:anywhere]">{repLines.map(r => r.label).join(' + ')}</p>}
                  </div>
                );
              })()}

              {/* Tarification (visible sauf en attente d'accord — là c'est le bloc devis qui prend le relais) */}
              {!isAccordClient && (() => {
                const lines = getRepairLines();
                // Montants calculés par le serveur (même règle que la fiche et la restitution) ;
                // repli local pour une réponse sans `montants` : jamais de reste négatif
                const m = ticket.montants;
                const redPct = Number(ticket.reduction_pourcentage || 0);
                const subtotal = m ? Number(m.sous_total) : lines.reduce((s, l) => s + l.prix, 0);
                if (subtotal <= 0) return null;
                const acompte = m ? Number(m.acompte) : Number(ticket.acompte || 0);
                const reduction = m ? Number(m.reduction)
                  : (redPct > 0 ? subtotal * (redPct / 100) : Number(ticket.reduction_montant || 0));
                const total = m ? Number(m.total) : Math.max(0, subtotal - reduction);
                const paye = Boolean(m ? m.paye : Number(ticket.paye) === 1 || ticket.paye === true);
                const reste = paye ? 0 : (m ? Number(m.reste) : Math.max(0, total - acompte));
                return (
                  <div className="mt-4 card-section">
                    <TitreBloc icone={CreditCard}>Tarification</TitreBloc>
                    <div className="space-y-1.5">
                      {lines.map((l, i) => (
                        <div key={i} className="flex justify-between gap-3 text-sm text-slate-700">
                          <span className="min-w-0">{l.label}</span><span className="t-num tabular-nums shrink-0">{formatPrix(l.prix)}</span>
                        </div>
                      ))}
                      {reduction > 0 && (
                        <div className="flex justify-between gap-3 text-sm text-emerald-700">
                          <span>Réduction{redPct > 0 ? ` (${redPct}%)` : ''}</span><span className="tabular-nums shrink-0">- {formatPrix(reduction)}</span>
                        </div>
                      )}
                      <div className="border-t border-slate-200 pt-2 mt-2 flex justify-between gap-3 text-base font-bold text-slate-900">
                        <span>Total</span><span className="tabular-nums">{formatPrix(total)}</span>
                      </div>
                      {acompte > 0 && (
                        <div className="flex justify-between gap-3 text-sm text-slate-500"><span>Acompte versé</span><span className="tabular-nums">- {formatPrix(acompte)}</span></div>
                      )}
                      {paye ? (
                        <div className="flex justify-between gap-3 text-base font-bold text-emerald-700">
                          <span>Règlement</span>
                          <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Payé</span>
                        </div>
                      ) : acompte > 0 && (
                        <div className="flex justify-between gap-3 text-base font-bold text-slate-900"><span>Reste à payer</span><span className={`tabular-nums ${reste > 0 ? 'text-red-700' : ''}`}>{formatPrix(reste)}</span></div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {ticket.commentaire_client && (
                <div className="mt-4 callout callout-info">
                  <MessageCircle aria-hidden="true" />
                  <p className="[overflow-wrap:anywhere]"><span className="font-semibold">Message :</span> {ticket.commentaire_client}</p>
                </div>
              )}
            </div>

            {/* ── BLOC DEVIS À VALIDER ── */}
            {isAccordClient && !devisResult && (() => {
              const lines = getRepairLines();
              const subtotal = lines.reduce((s, l) => s + l.prix, 0);
              const redPct = Number(ticket.reduction_pourcentage || 0);
              const redMnt = Number(ticket.reduction_montant || 0);
              const reduction = redPct > 0 ? subtotal * (redPct / 100) : redMnt;
              const totalTTC = Math.max(0, subtotal - reduction);
              const ht = totalTTC / 1.20;
              const tva = totalTTC - ht;
              return (
                <div className="card card-body border-amber-200 animate-in">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0" aria-hidden="true">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold leading-snug text-slate-900">Devis à valider</h3>
                      <p className="text-sm text-slate-500">Veuillez accepter ou refuser le devis ci-dessous</p>
                    </div>
                  </div>
                  <div className="space-y-2 mb-5">
                    {lines.map((l, i) => (
                      <div key={i} className="flex justify-between gap-3 text-sm">
                        <span className="text-slate-700 min-w-0">{l.label}</span>
                        <span className="t-num tabular-nums shrink-0">{formatPrix(l.prix)}</span>
                      </div>
                    ))}
                    {reduction > 0 && (
                      <div className="flex justify-between gap-3 text-sm text-emerald-700">
                        <span>Réduction{redPct > 0 ? ` (${redPct}%)` : ''}</span>
                        <span className="tabular-nums">- {formatPrix(reduction)}</span>
                      </div>
                    )}
                    <div className="border-t border-slate-200 pt-2 mt-2 space-y-1">
                      <div className="flex justify-between gap-3 text-sm text-slate-600"><span>HT</span><span className="tabular-nums">{formatPrix(ht)}</span></div>
                      <div className="flex justify-between gap-3 text-sm text-slate-600"><span>TVA (20%)</span><span className="tabular-nums">{formatPrix(tva)}</span></div>
                      <div className="flex justify-between gap-3 text-lg font-bold text-slate-900 border-t border-slate-200 pt-2 mt-1">
                        <span>Total TTC</span><span className="tabular-nums">{formatPrix(totalTTC)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button type="button" onClick={() => handleDevisValidation(true)} disabled={devisLoading}
                      className="btn-primary btn-lg flex-1">
                      <CheckCircle2 aria-hidden="true" /> J'accepte
                    </button>
                    <button type="button" onClick={() => handleDevisValidation(false)} disabled={devisLoading}
                      className="btn-secondary btn-lg flex-1 text-red-700 hover:bg-red-50 hover:border-red-200">
                      <XCircle aria-hidden="true" /> Je refuse
                    </button>
                  </div>
                </div>
              );
            })()}

            {devisResult === 'accepted' && (
              <div className="callout callout-success animate-in" role="status">
                <CheckCircle2 aria-hidden="true" />
                <div>
                  <p className="text-base font-bold">Devis accepté !</p>
                  <p className="mt-0.5">La réparation de votre appareil va être lancée.</p>
                </div>
              </div>
            )}
            {devisResult === 'refused' && (
              <div className="callout callout-danger animate-in" role="status">
                <XCircle aria-hidden="true" />
                <div>
                  <p className="text-base font-bold">Devis refusé</p>
                  <p className="mt-0.5">Notre équipe va vous contacter pour discuter des alternatives.</p>
                </div>
              </div>
            )}

            {/* Commande de pièce */}
            {commandes.map(cmd => {
              const isReceived = cmd.statut === 'Reçue' || cmd.statut === 'Reçu';
              const isDone = ['Réparation terminée', 'Rendu au client', 'Clôturé'].includes(ticket.statut);
              if (isDone) return null;
              return isReceived ? (
                <div key={cmd.id} className="card card-body">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0" aria-hidden="true"><Package className="w-4 h-4" /></div>
                    <span className="text-base font-semibold text-slate-900">Pièce reçue</span>
                  </div>
                  <div className="text-sm font-medium text-slate-700">{cmd.piece || cmd.description}</div>
                  {cmd.date_reception && <div className="t-caption mt-1">Reçue le {formatDate(cmd.date_reception)}</div>}
                  <div className="text-sm text-slate-500 mt-2">La réparation va être lancée rapidement.</div>
                </div>
              ) : (
                <div key={cmd.id} className="card card-body">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0" aria-hidden="true"><Truck className="w-4 h-4" /></div>
                    <span className="text-base font-semibold text-slate-900">Pièce en cours d'acheminement</span>
                  </div>
                  <div className="text-sm font-medium text-slate-700">{cmd.piece || cmd.description}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`badge ${
                      cmd.statut === 'En attente' ? 'badge-warning' :
                      cmd.statut === 'Commandée' ? 'badge-info' : 'badge-brand'
                    }`}>{cmd.statut === 'En attente' ? 'En attente' : cmd.statut === 'Commandée' ? 'Commandée' : 'Expédiée'}</span>
                  </div>
                  <div className="text-sm text-slate-500 mt-2">Nous vous préviendrons dès réception.</div>
                </div>
              );
            })}

            {/* ── BLOC AVIS CLIENT ── */}
            {isTerminal && !hasAvis && !avisSent && (
              <div className="card card-body animate-in">
                <div className="text-center mb-4">
                  <h3 className="text-lg font-semibold leading-snug text-slate-900 inline-flex items-center gap-2">
                    <Star className="w-5 h-5 text-amber-500 fill-amber-500" aria-hidden="true" /> Notez votre expérience
                  </h3>
                  <p className="text-sm text-slate-500 mt-0.5">Votre avis nous aide à nous améliorer</p>
                </div>
                <div className="flex justify-center gap-1 mb-4">
                  {[1,2,3,4,5].map(n => (
                    <button key={n} type="button"
                      onMouseEnter={() => setAvisHover(n)}
                      onMouseLeave={() => setAvisHover(0)}
                      onClick={() => setAvisNote(n)}
                      aria-label={`${n} étoile${n > 1 ? 's' : ''} sur 5`}
                      aria-pressed={avisNote === n}
                      className="w-11 h-11 flex items-center justify-center rounded-lg transition-transform duration-150 motion-safe:hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      <Star aria-hidden="true" className={`w-8 h-8 transition-colors duration-150 ${(avisHover || avisNote) >= n ? 'text-amber-500 fill-amber-500' : 'text-slate-500'}`} />
                    </button>
                  ))}
                </div>
                <textarea
                  value={avisComment} onChange={e => setAvisComment(e.target.value)}
                  aria-label="Commentaire (optionnel)"
                  placeholder="Un commentaire ? (optionnel)"
                  className="textarea resize-none mb-3" rows={2}
                />
                <button type="button" onClick={handleSubmitAvis} disabled={avisNote === 0 || avisLoading}
                  className="btn-primary btn-lg btn-block">
                  {avisLoading && <Loader2 className="animate-spin" aria-hidden="true" />}
                  Envoyer mon avis
                </button>
              </div>
            )}
            {(avisSent || (isTerminal && hasAvis)) && (
              <div className="callout callout-success animate-in" role="status">
                <Star className="fill-current" aria-hidden="true" />
                <div>
                  <p className="text-base font-bold">Merci pour votre avis !</p>
                  <p className="mt-0.5">Il a été transmis à notre équipe.</p>
                </div>
              </div>
            )}

            {/* Fidélité */}
            <FideliteCard ticketCode={ticket.ticket_code} preuve={preuve} compact />
            <ScratchCard ticketCode={ticket.ticket_code} preuve={preuve} />

            {/* ── MESSAGE CLIENT ── */}
            <div className="card card-body">
              <div className="flex items-center gap-2 mb-3">
                <MessageCircle className="w-5 h-5 text-brand-600" aria-hidden="true" />
                <h3 className="t-h2">Envoyer un message</h3>
              </div>
              {msgSent && (
                <div role="status" className="callout callout-success mb-3">
                  <CheckCircle2 aria-hidden="true" />
                  <p className="font-medium">Message envoyé ! L'équipe le verra sur votre fiche.</p>
                </div>
              )}
              <div className="depot-form flex gap-2">
                <input type="text" value={message} onChange={e => setMessage(e.target.value)}
                  placeholder="Votre message..."
                  aria-label="Votre message à l'équipe"
                  className="input flex-1 min-w-0"
                  onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                />
                <button type="button" onClick={handleSendMessage} disabled={!message.trim() || sendingMsg}
                  className="btn-primary btn-icon btn-lg min-w-14 min-h-14 shrink-0" aria-label="Envoyer le message">
                  {sendingMsg ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
                </button>
              </div>
            </div>

            {/* Auto-refresh */}
            <div className="flex items-center justify-center gap-2 t-caption">
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              <span>Mise à jour automatique toutes les 30s</span>
              {lastRefresh && <span className="tabular-nums">— {lastRefresh.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>

            {/* Autre ticket : retour au formulaire (la preuve de celui-ci reste mémorisée dans l'onglet) */}
            <div className="text-center">
              <button type="button" onClick={() => retourFormulaire()} className="btn-ghost min-h-11">
                <Hash aria-hidden="true" /> Suivre un autre ticket
              </button>
            </div>

            {/* Contact */}
            <div className="card card-body text-center">
              <p className="text-sm text-slate-500 mb-2">Une question sur votre réparation ?</p>
              <a href="tel:0479608922" className="inline-flex items-center justify-center gap-2 min-h-11 px-2 text-xl font-bold text-slate-900 tabular-nums rounded-lg hover:text-brand-700 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                <Phone className="w-5 h-5 text-brand-600" aria-hidden="true" /> 04 79 60 89 22
              </a>
              <div className="flex items-center justify-center gap-1.5 text-sm text-slate-500 mt-1">
                <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" /> 79 Place Saint Léger, Chambéry
              </div>
            </div>
          </div>
        )}

        {/* CTA — Voir nos tarifs telephones (iPhone + Samsung + Google + Xiaomi) */}
        <a
          href="/site-tarifs-iphone"
          onClick={() => api.trackEvent('tarifs_click', 'suivi', '/site-tarifs-iphone')}
          className="group card card-interactive border-brand-200 hover:border-brand-300 mt-8 block p-4 sm:p-5"
          aria-label="Voir nos tarifs téléphones"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0" aria-hidden="true">
              <Tag className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="t-overline text-brand-700 mb-1">
                Besoin d'un téléphone ?
              </p>
              <p className="text-lg font-bold leading-tight text-slate-900">
                Jetez un œil à nos tarifs
              </p>
              <p className="text-sm text-slate-600 mt-1">
                iPhone, Samsung, Google, Xiaomi — <strong className="text-slate-800">reconditionnés &amp; neufs</strong>, garantie 12 mois
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-brand-600 text-white flex items-center justify-center shrink-0 transition-colors duration-150 group-hover:bg-brand-700" aria-hidden="true">
              <ArrowRight className="w-5 h-5 transition-transform duration-150 motion-safe:group-hover:translate-x-0.5" />
            </div>
          </div>
        </a>

        {/* Retour : seulement sur la tablette de la boutique (jamais depuis le QR ou un lien) */}
        <div className="mt-6 text-center">
          {retour && (
            <>
              <button type="button" onClick={quitterVersAccueil} className="btn-ghost min-h-11">
                <ArrowLeft aria-hidden="true" /> Retour à l'accueil
              </button>
              <p className="text-xs text-slate-500 mt-1">Retour automatique après 1 minute sans activité.</p>
            </>
          )}
          <p className="text-center py-3 text-xs text-slate-500">
            Propulsé par{' '}
            <span className="font-extrabold">
              <span className="text-brand-600">Tk</span>
              <span className="text-slate-900">S</span>
              <span className="text-pink-700">∞</span>
              <span className="text-slate-900">26</span>
            </span>
            {' '}— une solution{' '}
            <span className="font-bold text-brand-600">Klik&Dev</span>
          </p>
        </div>
      </div>

    </div>
  );
}
