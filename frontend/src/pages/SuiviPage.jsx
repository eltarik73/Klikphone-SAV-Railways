import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import { usePolling } from '../hooks/usePolling';
import StatusBadge from '../components/StatusBadge';
import ProgressTracker from '../components/ProgressTracker';
import FideliteCard from '../components/FideliteCard';
import ScratchCard from '../components/ScratchCard';
import { formatDate, formatPrix } from '../lib/utils';
import { normalizeTicketCode, normalizePhoneInput } from '../lib/ticketCode';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Search, Smartphone, ArrowLeft, MapPin, Phone, Hash, Calendar, Wrench, CreditCard, Package, Truck, Globe, RefreshCw, Send, Star, CheckCircle2, XCircle, MessageCircle, Tag, ArrowRight, ShieldCheck, Loader2, AlertCircle, FileText } from 'lucide-react';

const SUIVI_POLL_MS = 30_000;

// Message à afficher pour un refus du serveur sur une action publique
function messageErreur(err) {
  if (err?.status === 429) return 'Trop de tentatives. Réessayez dans quelques minutes.';
  if (err?.name === 'TypeError') return 'Connexion impossible. Vérifiez votre réseau puis réessayez.';
  return err?.message || 'Une erreur est survenue, réessayez.';
}
const preuveRefusee = (err) => err?.status === 401 || err?.status === 403;

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
  const [code, setCode] = useState(searchParams.get('ticket') || searchParams.get('tel') || '');
  const [ticket, setTicket] = useState(null);
  const [phoneResults, setPhoneResults] = useState([]);
  const [commandes, setCommandes] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  // Preuve d'accès aux actions (accepter/refuser le devis, message, avis) : le jeton `t` du lien
  // de suivi pour le ticket ouvert par ce lien ; sinon les 4 derniers chiffres du téléphone.
  const [urlToken] = useState(() => searchParams.get('t') || '');
  const [tokenCode, setTokenCode] = useState(null); // ticket_code auquel s'applique urlToken
  const [verified, setVerified] = useState(null);   // { code, tel4 } déjà accepté par le serveur
  const [verif, setVerif] = useState(null);         // demande en cours : { exec, digits, error, busy, info }
  const [actionError, setActionError] = useState('');

  // QR intelligent : si un membre du staff connecté scanne le QR d'un ticket
  // (arrivée avec ?ticket=), on le redirige vers la fiche interne.
  // Le client, sans session, reste sur le suivi public.
  const { user } = useAuth();
  const navigate = useNavigate();
  const fromQrRef = useRef(Boolean(searchParams.get('ticket')));
  useEffect(() => {
    if (fromQrRef.current && ticket?.id && ['accueil', 'tech'].includes(user?.target)) {
      navigate(`/${user.target}/ticket/${ticket.id}`, { replace: true });
    }
  }, [user?.target, ticket?.id, navigate]);

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

  const isPhoneInput = (val) => /^\+?\d[\d\s.-]{5,}$/.test(val.trim());

  const doSearch = useCallback(async (searchVal, { fromUrl = false } = {}) => {
    const val = (searchVal || code).trim();
    if (!val) return;
    setLoading(true);
    setError('');
    setTicket(null);
    setPhoneResults([]);
    setDevisResult(null);
    setMsgSent(false);
    setAvisSent(false);
    setActionError('');
    setVerif(null);

    // « 123 », « kp123 », « #123 », URL du QR → KP-000123 ; un téléphone fait au moins 9 chiffres
    const ticketCode = normalizeTicketCode(val, { allowBareNumber: true });

    try {
      if (!ticketCode && isPhoneInput(val)) {
        const results = await api.getTicketsByPhone(normalizePhoneInput(val));
        if (results.length === 0) {
          setError('Aucun ticket trouvé avec ce numéro.');
        } else if (results.length === 1) {
          const data = await api.getTicketByCode(results[0].ticket_code);
          setTicket(data);
          api.getPublicCommandes(data.ticket_code).then(setCommandes).catch(() => setCommandes([]));
          api.suiviHasAvis(data.ticket_code).then(r => setHasAvis(r.has_avis)).catch(() => {});
        } else {
          setPhoneResults(results);
        }
      } else {
        const data = await api.getTicketByCode(encodeURIComponent(ticketCode || val.toUpperCase()));
        setTicket(data);
        if (fromUrl && urlToken) setTokenCode(data.ticket_code);
        api.getPublicCommandes(data.ticket_code).then(setCommandes).catch(() => setCommandes([]));
        api.suiviHasAvis(data.ticket_code).then(r => setHasAvis(r.has_avis)).catch(() => {});
      }
    } catch {
      setError('Aucun ticket trouvé.');
    } finally {
      setLoading(false);
    }
  }, [code, urlToken]);

  useEffect(() => {
    const ticketParam = searchParams.get('ticket') || searchParams.get('tel');
    if (ticketParam) doSearch(ticketParam, { fromUrl: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rafraîchissement toutes les 30 s, en pause quand l'onglet est masqué (reprise immédiate au retour)
  const ticketCodeRef = useRef(null);
  ticketCodeRef.current = ticket?.ticket_code || null;
  usePolling(async () => {
    const current = ticketCodeRef.current;
    if (!current) return;
    try {
      const data = await api.background(() => api.getTicketByCode(current));
      if (ticketCodeRef.current !== current) return;
      setTicket(prev => (JSON.stringify(prev) === JSON.stringify(data) ? prev : data));
      setLastRefresh(new Date());
    } catch { /* silent */ }
  }, SUIVI_POLL_MS, { enabled: Boolean(ticket?.ticket_code), immediate: false });

  const preuvePour = (ticketCode) => {
    if (urlToken && tokenCode && tokenCode === ticketCode) return { t: urlToken };
    if (verified?.code === ticketCode) return { tel4: verified.tel4 };
    return null;
  };

  // Exécute une action protégée ; sans preuve (ou preuve refusée), demande les 4 chiffres
  const avecPreuve = async (exec) => {
    if (!ticket) return;
    const preuve = preuvePour(ticket.ticket_code);
    setActionError('');
    if (!preuve) {
      setVerif({ exec, digits: '', error: '', busy: false, info: '' });
      return;
    }
    try {
      await exec(preuve);
    } catch (err) {
      if (preuveRefusee(err)) {
        if (preuve.t) setTokenCode(null);
        else setVerified(null);
        setVerif({
          exec, digits: '', busy: false, error: '',
          info: preuve.t ? 'Ce lien de suivi n\'est plus valable : confirmez avec votre numéro de téléphone.' : '',
        });
      } else {
        setActionError(messageErreur(err));
      }
    }
  };

  const submitVerif = async (e) => {
    e?.preventDefault();
    if (!verif || verif.busy || !ticket) return;
    const tel4 = verif.digits.replace(/\D/g, '');
    if (tel4.length !== 4) {
      setVerif(v => ({ ...v, error: 'Saisissez les 4 derniers chiffres de votre numéro.' }));
      return;
    }
    const ticketCode = ticket.ticket_code;
    setVerif(v => ({ ...v, busy: true, error: '' }));
    try {
      await verif.exec({ tel4 });
      setVerified({ code: ticketCode, tel4 });
      setVerif(null);
    } catch (err) {
      setVerif(v => (v ? {
        ...v, busy: false,
        error: preuveRefusee(err)
          ? 'Ces 4 chiffres ne correspondent pas au numéro de téléphone du dossier.'
          : messageErreur(err),
      } : v));
    }
  };

  // Fenêtre des 4 chiffres : focus piégé, Échap ferme, retour du focus sur le bouton déclencheur
  const verifRef = useRef(null);
  const verifBusyRef = useRef(false);
  verifBusyRef.current = Boolean(verif?.busy);
  useFocusTrap(verifRef, Boolean(verif && ticket), {
    initialFocus: '#suivi-tel4',
    onEscape: () => { if (!verifBusyRef.current) setVerif(null); },
  });

  const handleSearch = (e) => { e?.preventDefault(); doSearch(); };

  const handleSelectPhoneResult = async (ticketCode) => {
    setLoading(true);
    try {
      const data = await api.getTicketByCode(ticketCode);
      setTicket(data);
      setPhoneResults([]);
      api.getPublicCommandes(data.ticket_code).then(setCommandes).catch(() => setCommandes([]));
      api.suiviHasAvis(data.ticket_code).then(r => setHasAvis(r.has_avis)).catch(() => {});
    } catch {
      setError('Erreur de chargement du ticket.');
    } finally {
      setLoading(false);
    }
  };

  // Les actions lèvent l'erreur : avecPreuve / submitVerif décident du message à afficher
  const handleSendMessage = () => {
    const texte = message.trim();
    if (!texte || !ticket || sendingMsg) return;
    const ticketCode = ticket.ticket_code;
    avecPreuve(async (preuve) => {
      setSendingMsg(true);
      try {
        await api.suiviSendMessage(ticketCode, texte, preuve);
        setMessage('');
        setMsgSent(true);
        setTimeout(() => setMsgSent(false), 4000);
      } finally { setSendingMsg(false); }
    });
  };

  const handleDevisValidation = (accepte) => {
    if (!ticket || devisLoading) return;
    const ticketCode = ticket.ticket_code;
    avecPreuve(async (preuve) => {
      setDevisLoading(true);
      try {
        await api.suiviValiderDevis(ticketCode, accepte, preuve);
        setDevisResult(accepte ? 'accepted' : 'refused');
        // Reload ticket to get new status
        api.getTicketByCode(ticketCode).then(setTicket).catch(() => {});
      } finally { setDevisLoading(false); }
    });
  };

  const handleSubmitAvis = () => {
    if (avisNote === 0 || !ticket || avisLoading) return;
    const ticketCode = ticket.ticket_code;
    const note = avisNote;
    const commentaire = avisComment.trim();
    avecPreuve(async (preuve) => {
      setAvisLoading(true);
      try {
        await api.suiviLaisserAvis(ticketCode, note, commentaire, preuve);
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
          <p className="text-base text-slate-500 mt-1.5">Entrez votre code ticket ou numéro de téléphone</p>
        </div>

        {/* Search (.depot-form : saisie 56 px / 16 px, pas de zoom iOS) */}
        <form onSubmit={handleSearch} className="depot-form flex gap-2 mb-6">
          <input type="text" value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="KP-000001 ou 06 12 34 56 78"
            aria-label="Numéro de ticket ou téléphone"
            autoComplete="off"
            className="input flex-1 min-w-0 text-center font-mono font-bold tracking-wider placeholder:font-sans placeholder:font-normal placeholder:tracking-normal" autoFocus />
          <button type="submit" disabled={loading} className="btn-primary btn-icon btn-lg min-w-14 min-h-14 shrink-0" aria-label="Rechercher">
            {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
          </button>
        </form>

        {error && (
          <div role="alert" className="callout callout-danger animate-in">
            <AlertCircle aria-hidden="true" />
            <p className="font-medium">{error}</p>
          </div>
        )}

        {phoneResults.length > 0 && (
          <div className="card overflow-hidden animate-in mb-5">
            <div className="px-4 sm:px-5 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-700">{phoneResults.length} ticket(s) trouvé(s)</p>
            </div>
            <div className="divide-y divide-slate-100">
              {phoneResults.map(r => (
                <button key={r.ticket_code} type="button" onClick={() => handleSelectPhoneResult(r.ticket_code)}
                  className="w-full flex items-center gap-3 min-h-14 px-4 sm:px-5 py-3 text-left transition-colors duration-150 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500">
                  <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center shrink-0" aria-hidden="true">
                    <Hash className="w-4 h-4 text-brand-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="t-mono text-sm font-bold text-brand-700">{r.ticket_code}</p>
                    <p className="t-small truncate">{r.marque} {r.modele || r.modele_autre} — {r.panne}</p>
                  </div>
                  <StatusBadge statut={r.statut} />
                </button>
              ))}
            </div>
          </div>
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
                  <h2 className="text-xl font-bold font-mono tabular-nums text-brand-700">{ticket.ticket_code}</h2>
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
            <FideliteCard ticketCode={ticket.ticket_code} compact />
            <ScratchCard ticketCode={ticket.ticket_code} />

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

        {/* Back */}
        <div className="mt-6 text-center">
          <a href="/" className="btn-ghost min-h-11">
            <ArrowLeft aria-hidden="true" /> Retour à l'accueil
          </a>
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

      {/* Vérification : 4 derniers chiffres du téléphone (lien de suivi sans jeton) */}
      {verif && ticket && (
        <div className="modal-overlay"
          onClick={() => { if (!verif.busy) setVerif(null); }}>
          <form
            ref={verifRef}
            role="dialog" aria-modal="true" aria-labelledby="suivi-verif-titre" aria-describedby="suivi-verif-texte"
            onClick={e => e.stopPropagation()}
            onSubmit={submitVerif}
            className="modal depot-form sm:max-w-sm"
          >
            <div className="modal-header">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center shrink-0" aria-hidden="true">
                  <ShieldCheck className="w-5 h-5 text-brand-600" />
                </div>
                <h2 id="suivi-verif-titre" className="t-h2">Confirmez qu'il s'agit de votre dossier</h2>
              </div>
            </div>
            <div className="modal-body">
              {verif.info && (
                <div className="callout callout-warning mb-4">
                  <AlertCircle aria-hidden="true" />
                  <span>{verif.info}</span>
                </div>
              )}
              <p id="suivi-verif-texte" className="t-body-lg mb-4">
                Saisissez les <strong>4 derniers chiffres</strong> du numéro de téléphone donné lors du dépôt de l'appareil ({ticket.ticket_code}).
              </p>
              <label htmlFor="suivi-tel4" className="input-label">4 derniers chiffres</label>
              <input
                id="suivi-tel4"
                type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="off"
                value={verif.digits}
                onChange={e => setVerif(v => ({ ...v, digits: e.target.value.replace(/\D/g, '').slice(0, 4), error: '' }))}
                aria-invalid={Boolean(verif.error)}
                aria-describedby={verif.error ? 'suivi-tel4-erreur' : undefined}
                className="input text-center font-mono text-2xl tracking-[0.5em]"
                placeholder="••••"
              />
              {verif.error && (
                <div id="suivi-tel4-erreur" role="alert" className="input-error text-sm">{verif.error}</div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" onClick={() => setVerif(null)} disabled={verif.busy}
                className="btn-ghost min-h-11 flex-1 sm:flex-none">
                Annuler
              </button>
              <button type="submit" disabled={verif.busy || verif.digits.length !== 4}
                className="btn-primary min-h-11 flex-1 sm:flex-none">
                {verif.busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
                Confirmer
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
