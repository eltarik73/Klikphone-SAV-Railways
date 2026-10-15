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
import { Search, Smartphone, ArrowLeft, MapPin, Phone, Hash, Calendar, Wrench, CreditCard, Package, Truck, Globe, RefreshCw, Send, Star, CheckCircle2, XCircle, MessageCircle, Tag, ArrowRight, Tv, ShieldCheck, Loader2 } from 'lucide-react';

const SUIVI_POLL_MS = 30_000;

// Message à afficher pour un refus du serveur sur une action publique
function messageErreur(err) {
  if (err?.status === 429) return 'Trop de tentatives. Réessayez dans quelques minutes.';
  if (err?.name === 'TypeError') return 'Connexion impossible. Vérifiez votre réseau puis réessayez.';
  return err?.message || 'Une erreur est survenue, réessayez.';
}
const preuveRefusee = (err) => err?.status === 401 || err?.status === 403;

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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-brand-50/30">
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8 animate-in">
          <div className="w-16 h-16 rounded-2xl bg-brand-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand-600/20">
            <Smartphone className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-display font-bold text-slate-900">Suivi de réparation</h1>
          <p className="text-sm text-slate-500 mt-1">Entrez votre code ticket ou numéro de téléphone</p>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-8">
          <input type="text" value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="KP-000001 ou 06 12 34 56 78"
            className="input flex-1 text-center font-mono text-lg font-bold tracking-wider" autoFocus />
          <button type="submit" disabled={loading} className="btn-primary px-5 min-h-[44px]" aria-label="Rechercher">
            <Search className="w-5 h-5" aria-hidden="true" />
          </button>
        </form>

        {error && (
          <div className="card p-6 text-center animate-in">
            <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-3">
              <Smartphone className="w-6 h-6 text-red-300" />
            </div>
            <p className="text-red-500 font-medium">{error}</p>
          </div>
        )}

        {phoneResults.length > 0 && (
          <div className="card overflow-hidden animate-in mb-5">
            <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-700">{phoneResults.length} ticket(s) trouvé(s)</p>
            </div>
            <div className="divide-y divide-slate-100">
              {phoneResults.map(r => (
                <button key={r.ticket_code} onClick={() => handleSelectPhoneResult(r.ticket_code)}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-brand-50/40 transition-colors text-left">
                  <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                    <Hash className="w-4 h-4 text-brand-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-brand-600 font-mono">{r.ticket_code}</p>
                    <p className="text-xs text-slate-500 truncate">{r.marque} {r.modele || r.modele_autre} — {r.panne}</p>
                  </div>
                  <StatusBadge statut={r.statut} />
                </button>
              ))}
            </div>
          </div>
        )}

        {ticket && (
          <div className="space-y-5 animate-in">
            {actionError && (
              <div role="alert" className="card p-4 bg-red-50 border border-red-200 text-sm text-red-700 font-medium text-center">
                {actionError}
              </div>
            )}
            {/* Pré-enregistré banner */}
            {ticket.statut === 'Pré-enregistré' && (
              <div className="card p-5 bg-indigo-50 border border-indigo-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
                    <Globe className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-indigo-800">Demande pré-enregistrée</p>
                    <p className="text-xs text-indigo-600 mt-0.5">Notre équipe va valider votre demande. Présentez-vous en boutique avec votre appareil.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Progress tracker */}
            <div className="card p-5">
              <ProgressTracker statut={ticket.statut} hasPiece={ticket.commande_piece === 1} isDistance={ticket.source === 'distance'} />
            </div>

            {/* Ticket card */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold font-mono text-brand-600">{ticket.ticket_code}</h2>
                  {ticket.source === 'distance' && (
                    <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600 text-[9px] font-bold flex items-center gap-0.5">
                      <Globe className="w-2.5 h-2.5" /> Distance
                    </span>
                  )}
                </div>
                <StatusBadge statut={ticket.statut} />
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-400 text-xs mb-0.5">Appareil</p>
                  <p className="font-medium text-slate-800">{ticket.marque} {ticket.modele || ticket.modele_autre}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs mb-0.5">Panne</p>
                  <p className="font-medium text-slate-800">{ticket.panne}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs mb-0.5">Déposé le</p>
                  <p className="font-medium text-slate-800">{formatDate(ticket.date_depot)}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs mb-0.5">Dernière mise à jour</p>
                  <p className="font-medium text-slate-800">{formatDate(ticket.date_maj)}</p>
                </div>
              </div>

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
                return (
                  <div className={`mt-4 flex items-center gap-2 p-3 rounded-lg ${isValid && d <= now ? 'bg-red-50 border border-red-100' : 'bg-blue-50 border border-blue-100'}`}>
                    <Calendar className={`w-4 h-4 shrink-0 ${isValid && d <= now ? 'text-red-500' : 'text-blue-500'}`} />
                    <div className="text-sm">
                      <span className={`font-medium ${isValid && d <= now ? 'text-red-600' : 'text-blue-600'}`}>Récupération prévue : </span>
                      <span className={`font-bold ${isValid && d <= now ? 'text-red-800' : 'text-blue-800'}`}>{displayDate}</span>
                      {countdown && <span className={`ml-2 text-xs font-semibold ${isValid && d <= now ? 'text-red-500' : 'text-emerald-600'}`}>({countdown})</span>}
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
                  <div className="mt-4 p-3 bg-slate-50 border border-slate-100 rounded-lg text-sm">
                    <div className="flex items-center gap-1.5 text-slate-600 font-semibold mb-2">
                      <Wrench className="w-3.5 h-3.5" /> Détail réparation
                    </div>
                    {ticket.panne_detail && <p className="text-slate-600 text-xs mb-1">{ticket.panne_detail}</p>}
                    {repLines.length > 0 && <p className="text-slate-600 text-xs">{repLines.map(r => r.label).join(' + ')}</p>}
                  </div>
                );
              })()}

              {/* Tarification (visible sauf en attente d'accord — là c'est le bloc devis qui prend le relais) */}
              {!isAccordClient && (() => {
                const lines = getRepairLines();
                const subtotal = lines.reduce((s, l) => s + l.prix, 0);
                if (subtotal <= 0) return null;
                const acompte = Number(ticket.acompte || 0);
                const redPct = Number(ticket.reduction_pourcentage || 0);
                const redMnt = Number(ticket.reduction_montant || 0);
                const reduction = redPct > 0 ? subtotal * (redPct / 100) : redMnt;
                const total = Math.max(0, subtotal - reduction);
                const reste = total - acompte;
                return (
                  <div className="mt-4 p-3 bg-emerald-50 border border-emerald-100 rounded-lg text-sm">
                    <div className="flex items-center gap-1.5 text-emerald-700 font-semibold mb-2">
                      <CreditCard className="w-3.5 h-3.5" /> Tarification
                    </div>
                    <div className="space-y-1">
                      {lines.map((l, i) => (
                        <div key={i} className="flex justify-between text-slate-700">
                          <span>{l.label}</span><span className="font-medium">{formatPrix(l.prix)}</span>
                        </div>
                      ))}
                      {reduction > 0 && (
                        <div className="flex justify-between text-emerald-600 text-xs">
                          <span>Réduction{redPct > 0 ? ` (${redPct}%)` : ''}</span><span>- {formatPrix(reduction)}</span>
                        </div>
                      )}
                      <div className="border-t border-emerald-200 pt-1 mt-1 flex justify-between font-bold text-emerald-800">
                        <span>Total</span><span>{formatPrix(total)}</span>
                      </div>
                      {acompte > 0 && (
                        <>
                          <div className="flex justify-between text-slate-500 text-xs"><span>Acompte versé</span><span>- {formatPrix(acompte)}</span></div>
                          <div className="flex justify-between font-bold text-emerald-900"><span>Reste à payer</span><span>{formatPrix(reste)}</span></div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}

              {ticket.commentaire_client && (
                <div className="mt-4 p-3 bg-brand-50 border border-brand-100 rounded-lg text-sm text-brand-800">
                  <span className="font-semibold">Message :</span> {ticket.commentaire_client}
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
                <div className="card p-6 border-2 border-orange-300 bg-orange-50 animate-in">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
                      <CreditCard className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-orange-800">📋 Devis à valider</h3>
                      <p className="text-xs text-orange-600">Veuillez accepter ou refuser le devis ci-dessous</p>
                    </div>
                  </div>
                  <div className="space-y-2 mb-4">
                    {lines.map((l, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-slate-700">{l.label}</span>
                        <span className="font-semibold text-slate-800">{formatPrix(l.prix)}</span>
                      </div>
                    ))}
                    {reduction > 0 && (
                      <div className="flex justify-between text-sm text-emerald-600">
                        <span>Réduction{redPct > 0 ? ` (${redPct}%)` : ''}</span>
                        <span>- {formatPrix(reduction)}</span>
                      </div>
                    )}
                    <div className="border-t border-orange-200 pt-2 mt-2 space-y-1">
                      <div className="flex justify-between text-sm text-slate-600"><span>HT</span><span>{formatPrix(ht)}</span></div>
                      <div className="flex justify-between text-sm text-slate-600"><span>TVA (20%)</span><span>{formatPrix(tva)}</span></div>
                      <div className="flex justify-between text-base font-extrabold text-orange-800 border-t border-orange-200 pt-1">
                        <span>Total TTC</span><span>{formatPrix(totalTTC)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => handleDevisValidation(true)} disabled={devisLoading}
                      className="flex-1 py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> J'accepte
                    </button>
                    <button onClick={() => handleDevisValidation(false)} disabled={devisLoading}
                      className="flex-1 py-3 rounded-xl bg-red-100 text-red-700 text-sm font-bold border-2 border-red-300 hover:bg-red-200 transition-colors flex items-center justify-center gap-2">
                      <XCircle className="w-4 h-4" /> Je refuse
                    </button>
                  </div>
                </div>
              );
            })()}

            {devisResult === 'accepted' && (
              <div className="card p-5 bg-emerald-50 border border-emerald-300 text-center animate-in">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                <p className="text-lg font-bold text-emerald-800">Devis accepté !</p>
                <p className="text-sm text-emerald-600 mt-1">La réparation de votre appareil va être lancée.</p>
              </div>
            )}
            {devisResult === 'refused' && (
              <div className="card p-5 bg-red-50 border border-red-300 text-center animate-in">
                <XCircle className="w-10 h-10 text-red-400 mx-auto mb-2" />
                <p className="text-lg font-bold text-red-800">Devis refusé</p>
                <p className="text-sm text-red-600 mt-1">Notre équipe va vous contacter pour discuter des alternatives.</p>
              </div>
            )}

            {/* Commande de pièce */}
            {commandes.map(cmd => {
              const isReceived = cmd.statut === 'Reçue' || cmd.statut === 'Reçu';
              const isDone = ['Réparation terminée', 'Rendu au client', 'Clôturé'].includes(ticket.statut);
              if (isDone) return null;
              return isReceived ? (
                <div key={cmd.id} className="card p-5 bg-green-50 border border-green-200">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center"><Package className="w-4 h-4 text-green-600" /></div>
                    <span className="font-bold text-sm text-green-800">Pièce reçue</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-700">{cmd.piece || cmd.description}</div>
                  {cmd.date_reception && <div className="text-xs text-green-600 mt-1">Reçue le {formatDate(cmd.date_reception)}</div>}
                  <div className="text-xs text-slate-500 mt-2">La réparation va être lancée rapidement.</div>
                </div>
              ) : (
                <div key={cmd.id} className="card p-5 bg-amber-50 border border-amber-200">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center"><Truck className="w-4 h-4 text-amber-600" /></div>
                    <span className="font-bold text-sm text-amber-800">Pièce en cours d'acheminement</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-700">{cmd.piece || cmd.description}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      cmd.statut === 'En attente' ? 'bg-amber-100 text-amber-700' :
                      cmd.statut === 'Commandée' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                    }`}>{cmd.statut === 'En attente' ? 'En attente' : cmd.statut === 'Commandée' ? 'Commandée' : 'Expédiée'}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-2">Nous vous préviendrons dès réception.</div>
                </div>
              );
            })}

            {/* ── BLOC AVIS CLIENT ── */}
            {isTerminal && !hasAvis && !avisSent && (
              <div className="card p-6 border-2 border-brand-200 bg-brand-50/50 animate-in">
                <div className="text-center mb-4">
                  <h3 className="text-lg font-bold text-slate-800">⭐ Notez votre expérience</h3>
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
                      className="p-1.5 rounded-lg transition-transform motion-safe:hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                    >
                      <Star aria-hidden="true" className={`w-8 h-8 ${(avisHover || avisNote) >= n ? 'text-yellow-400 fill-yellow-400' : 'text-slate-400'} transition-colors`} />
                    </button>
                  ))}
                </div>
                <textarea
                  value={avisComment} onChange={e => setAvisComment(e.target.value)}
                  aria-label="Commentaire (optionnel)"
                  placeholder="Un commentaire ? (optionnel)"
                  className="input w-full resize-none mb-3" rows={2}
                />
                <button onClick={handleSubmitAvis} disabled={avisNote === 0 || avisLoading}
                  className="w-full py-3 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-700 transition-colors disabled:opacity-50">
                  Envoyer mon avis
                </button>
              </div>
            )}
            {(avisSent || (isTerminal && hasAvis)) && (
              <div className="card p-5 bg-brand-50 border border-brand-200 text-center animate-in">
                <Star className="w-8 h-8 text-yellow-400 fill-yellow-400 mx-auto mb-2" />
                <p className="text-base font-bold text-brand-800">Merci pour votre avis !</p>
                <p className="text-sm text-brand-600 mt-0.5">Il a été transmis à notre équipe.</p>
              </div>
            )}

            {/* Fidélité */}
            <FideliteCard ticketCode={ticket.ticket_code} compact />
            <ScratchCard ticketCode={ticket.ticket_code} />

            {/* ── MESSAGE CLIENT ── */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <MessageCircle className="w-4 h-4 text-brand-600" />
                <h3 className="text-sm font-semibold text-slate-800">Envoyer un message</h3>
              </div>
              {msgSent && (
                <div className="mb-3 p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-medium text-center">
                  Message envoyé ! L'équipe le verra sur votre fiche.
                </div>
              )}
              <div className="flex gap-2">
                <input type="text" value={message} onChange={e => setMessage(e.target.value)}
                  placeholder="Votre message..."
                  aria-label="Votre message à l'équipe"
                  className="input flex-1 text-sm min-h-[44px]"
                  onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                />
                <button onClick={handleSendMessage} disabled={!message.trim() || sendingMsg}
                  className="btn-primary px-4 shrink-0 min-h-[44px]" aria-label="Envoyer le message">
                  {sendingMsg ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
                </button>
              </div>
            </div>

            {/* Auto-refresh */}
            <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
              <RefreshCw className="w-3 h-3" />
              <span>Mise à jour automatique toutes les 30s</span>
              {lastRefresh && <span>— {lastRefresh.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>

            {/* Contact */}
            <div className="card p-6 text-center">
              <p className="text-sm text-slate-500 mb-3">Une question sur votre réparation ?</p>
              <div className="flex items-center justify-center gap-2 text-lg font-bold text-slate-900">
                <Phone className="w-5 h-5 text-brand-600" /> 04 79 60 89 22
              </div>
              <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400 mt-2">
                <MapPin className="w-3 h-3" /> 79 Place Saint Léger, Chambéry
              </div>
            </div>
          </div>
        )}

        {/* CTA — Voir nos tarifs telephones (iPhone + Samsung + Google + Xiaomi) */}
        <a
          href="/site-tarifs-iphone"
          onClick={() => api.trackEvent('tarifs_click', 'suivi', '/site-tarifs-iphone')}
          className="group mt-8 block relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-brand-800 to-slate-900 text-white p-5 shadow-xl shadow-brand-900/20 hover:shadow-2xl hover:shadow-brand-900/30 transition-shadow"
          aria-label="Voir nos tarifs téléphones"
        >
          {/* Aurora backdrop subtil */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-brand-500/40 blur-3xl" />
            <div className="absolute -bottom-16 -left-8 w-48 h-48 rounded-full bg-amber-500/20 blur-3xl" />
          </div>
          <div className="relative flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center shrink-0 ring-1 ring-white/20">
              <Tag className="w-6 h-6 text-amber-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-[0.2em] text-amber-300/90 font-bold mb-1">
                Besoin d'un téléphone ?
              </p>
              <p className="text-base font-display font-extrabold leading-tight">
                Jetez un œil à nos <span className="font-editorial font-normal text-amber-200">tarifs</span>
              </p>
              <p className="text-xs text-slate-300 mt-1">
                iPhone, Samsung, Google, Xiaomi — <strong>reconditionnés &amp; neufs</strong>, garantie 12 mois
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-white/70 group-hover:text-white group-hover:translate-x-1 transition-all shrink-0" />
          </div>
        </a>

        {/* Back */}
        <div className="mt-6 text-center">
          <a href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-600 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Retour à l'accueil
          </a>
          <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 10, color: '#A1A1AA' }}>
            Propulsé par{' '}
            <span style={{ fontWeight: 800, fontSize: 11 }}>
              <span style={{ color: '#7C3AED' }}>Tk</span>
              <span style={{ color: '#18181B' }}>S</span>
              <span style={{ color: '#EC4899' }}>∞</span>
              <span style={{ color: '#18181B' }}>26</span>
            </span>
            {' '}— une solution{' '}
            <span style={{ fontWeight: 700, color: '#7C3AED' }}>Klik&Dev</span>
          </div>
        </div>
      </div>

      {/* Vérification : 4 derniers chiffres du téléphone (lien de suivi sans jeton) */}
      {verif && ticket && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-900/50"
          onClick={() => { if (!verif.busy) setVerif(null); }}>
          <form
            ref={verifRef}
            role="dialog" aria-modal="true" aria-labelledby="suivi-verif-titre" aria-describedby="suivi-verif-texte"
            onClick={e => e.stopPropagation()}
            onSubmit={submitVerif}
            className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 animate-fade-up"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-brand-600" aria-hidden="true" />
              </div>
              <h2 id="suivi-verif-titre" className="text-base font-bold text-slate-900">Confirmez qu'il s'agit de votre dossier</h2>
            </div>
            {verif.info && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3">{verif.info}</p>}
            <p id="suivi-verif-texte" className="text-sm text-slate-600 mb-4">
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
              className="input text-center font-mono text-2xl tracking-[0.5em] min-h-[52px]"
              placeholder="••••"
            />
            {verif.error && (
              <p id="suivi-tel4-erreur" role="alert" className="mt-2 text-sm text-red-700 font-medium">{verif.error}</p>
            )}
            <div className="flex gap-2 mt-5">
              <button type="button" onClick={() => setVerif(null)} disabled={verif.busy}
                className="btn-secondary flex-1 min-h-[44px]">
                Annuler
              </button>
              <button type="submit" disabled={verif.busy || verif.digits.length !== 4}
                className="btn-primary flex-1 min-h-[44px]">
                {verif.busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="w-4 h-4" aria-hidden="true" />}
                Confirmer
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
