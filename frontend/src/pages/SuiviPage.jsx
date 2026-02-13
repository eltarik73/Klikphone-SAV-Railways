import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import ProgressTracker from '../components/ProgressTracker';
import FideliteCard from '../components/FideliteCard';
import ScratchCard from '../components/ScratchCard';
import { formatDate } from '../lib/utils';
import { Search, Smartphone, ArrowLeft, MapPin, Phone, Hash, Calendar, Wrench, CreditCard, Package, Truck } from 'lucide-react';
import { formatPrix } from '../lib/utils';

export default function SuiviPage() {
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get('ticket') || searchParams.get('tel') || '');
  const [ticket, setTicket] = useState(null);
  const [phoneResults, setPhoneResults] = useState([]);
  const [commandes, setCommandes] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isPhoneInput = (val) => /^\+?\d[\d\s.-]{5,}$/.test(val.trim());

  const doSearch = useCallback(async (searchVal) => {
    const val = (searchVal || code).trim();
    if (!val) return;
    setLoading(true);
    setError('');
    setTicket(null);
    setPhoneResults([]);

    try {
      if (isPhoneInput(val)) {
        const results = await api.getTicketsByPhone(val.replace(/[\s.-]/g, ''));
        if (results.length === 0) {
          setError('Aucun ticket trouvé avec ce numéro.');
        } else if (results.length === 1) {
          const data = await api.getTicketByCode(results[0].ticket_code);
          setTicket(data);
          api.getPublicCommandes(data.ticket_code).then(setCommandes).catch(() => setCommandes([]));
        } else {
          setPhoneResults(results);
        }
      } else {
        const data = await api.getTicketByCode(val.toUpperCase());
        setTicket(data);
        api.getPublicCommandes(data.ticket_code).then(setCommandes).catch(() => setCommandes([]));
      }
    } catch {
      setError('Aucun ticket trouvé.');
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    const ticketParam = searchParams.get('ticket') || searchParams.get('tel');
    if (ticketParam) {
      doSearch(ticketParam);
    }
  }, []);

  const handleSearch = (e) => {
    e?.preventDefault();
    doSearch();
  };

  const handleSelectPhoneResult = async (ticketCode) => {
    setLoading(true);
    try {
      const data = await api.getTicketByCode(ticketCode);
      setTicket(data);
      setPhoneResults([]);
      api.getPublicCommandes(data.ticket_code).then(setCommandes).catch(() => setCommandes([]));
    } catch {
      setError('Erreur de chargement du ticket.');
    } finally {
      setLoading(false);
    }
  };

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
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="KP-000001 ou 06 12 34 56 78"
            className="input flex-1 text-center font-mono text-lg font-bold tracking-wider"
            autoFocus
          />
          <button type="submit" disabled={loading} className="btn-primary px-5">
            <Search className="w-5 h-5" />
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
                <button key={r.ticket_code}
                  onClick={() => handleSelectPhoneResult(r.ticket_code)}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-brand-50/40 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                    <Hash className="w-4 h-4 text-brand-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-brand-600 font-mono">{r.ticket_code}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {r.marque} {r.modele || r.modele_autre} — {r.panne}
                    </p>
                  </div>
                  <StatusBadge statut={r.statut} />
                </button>
              ))}
            </div>
          </div>
        )}

        {ticket && (
          <div className="space-y-5 animate-in">
            {/* Progress tracker */}
            <div className="card p-5">
              <ProgressTracker statut={ticket.statut} hasPiece={ticket.commande_piece === 1} />
            </div>

            {/* Ticket card */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold font-mono text-brand-600">{ticket.ticket_code}</h2>
                <StatusBadge statut={ticket.statut} />
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-400 text-xs mb-0.5">Appareil</p>
                  <p className="font-medium text-slate-800">
                    {ticket.marque} {ticket.modele || ticket.modele_autre}
                  </p>
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
              {ticket.date_recuperation && (
                <div className="mt-4 flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                  <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
                  <div className="text-sm">
                    <span className="text-blue-600 font-medium">Récupération prévue : </span>
                    <span className="text-blue-800 font-bold">{ticket.date_recuperation}</span>
                  </div>
                </div>
              )}

              {/* Réparations */}
              {(ticket.reparation_supp || ticket.panne_detail) && (
                <div className="mt-4 p-3 bg-slate-50 border border-slate-100 rounded-lg text-sm">
                  <div className="flex items-center gap-1.5 text-slate-600 font-semibold mb-2">
                    <Wrench className="w-3.5 h-3.5" />
                    Détail réparation
                  </div>
                  {ticket.panne_detail && (
                    <p className="text-slate-600 text-xs mb-1">{ticket.panne_detail}</p>
                  )}
                  {ticket.reparation_supp && (
                    <p className="text-slate-600 text-xs">Réparation supp. : {ticket.reparation_supp}</p>
                  )}
                </div>
              )}

              {/* Tarification */}
              {(() => {
                const devis = Number(ticket.devis_estime || 0);
                const prixSupp = Number(ticket.prix_supp || 0);
                const acompte = Number(ticket.acompte || 0);
                const total = devis + prixSupp;
                if (total <= 0) return null;
                const reste = total - acompte;
                return (
                  <div className="mt-4 p-3 bg-emerald-50 border border-emerald-100 rounded-lg text-sm">
                    <div className="flex items-center gap-1.5 text-emerald-700 font-semibold mb-2">
                      <CreditCard className="w-3.5 h-3.5" />
                      Tarification
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-slate-700">
                        <span>{ticket.panne}</span>
                        <span className="font-medium">{formatPrix(devis)}</span>
                      </div>
                      {ticket.reparation_supp && prixSupp > 0 && (
                        <div className="flex justify-between text-slate-600 text-xs">
                          <span>{ticket.reparation_supp}</span>
                          <span>{formatPrix(prixSupp)}</span>
                        </div>
                      )}
                      <div className="border-t border-emerald-200 pt-1 mt-1 flex justify-between font-bold text-emerald-800">
                        <span>Total</span>
                        <span>{formatPrix(total)}</span>
                      </div>
                      {acompte > 0 && (
                        <>
                          <div className="flex justify-between text-slate-500 text-xs">
                            <span>Acompte versé</span>
                            <span>- {formatPrix(acompte)}</span>
                          </div>
                          <div className="flex justify-between font-bold text-emerald-900">
                            <span>Reste à payer</span>
                            <span>{formatPrix(reste)}</span>
                          </div>
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

            {/* Commande de pièce — visible si existe */}
            {commandes.map(cmd => {
              const isReceived = cmd.statut === 'Reçue';
              const isDone = ['Réparation terminée', 'Rendu au client', 'Clôturé'].includes(ticket.statut);
              if (isDone) return null;
              return isReceived ? (
                <div key={cmd.id} className="card p-5 bg-green-50 border border-green-200">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                      <Package className="w-4 h-4 text-green-600" />
                    </div>
                    <span className="font-bold text-sm text-green-800">Pièce reçue</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-700">{cmd.piece}</div>
                  {cmd.date_reception && (
                    <div className="text-xs text-green-600 mt-1">
                      Reçue le {formatDate(cmd.date_reception)}
                    </div>
                  )}
                  <div className="text-xs text-slate-500 mt-2">
                    La réparation de votre appareil va être lancée rapidement.
                  </div>
                </div>
              ) : (
                <div key={cmd.id} className="card p-5 bg-amber-50 border border-amber-200">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                      <Truck className="w-4 h-4 text-amber-600" />
                    </div>
                    <span className="font-bold text-sm text-amber-800">Pièce en cours d'acheminement</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-700">{cmd.piece}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      cmd.statut === 'En attente' ? 'bg-amber-100 text-amber-700' :
                      cmd.statut === 'Commandée' ? 'bg-blue-100 text-blue-700' :
                      'bg-purple-100 text-purple-700'
                    }`}>
                      {cmd.statut === 'En attente' ? 'En attente de commande' :
                       cmd.statut === 'Commandée' ? 'Commandée' : 'Expédiée'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-2">
                    Nous vous préviendrons dès réception pour lancer la réparation.
                  </div>
                </div>
              );
            })}

            {/* Fidélité */}
            <FideliteCard ticketCode={ticket.ticket_code} compact />

            {/* Jeu de grattage */}
            <ScratchCard ticketCode={ticket.ticket_code} />

            {/* Contact */}
            <div className="card p-6 text-center">
              <p className="text-sm text-slate-500 mb-3">Une question sur votre réparation ?</p>
              <div className="flex items-center justify-center gap-2 text-lg font-bold text-slate-900">
                <Phone className="w-5 h-5 text-brand-600" />
                04 79 60 89 22
              </div>
              <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400 mt-2">
                <MapPin className="w-3 h-3" />
                79 Place Saint Léger, Chambéry
              </div>
            </div>
          </div>
        )}

        {/* Back */}
        <div className="mt-8 text-center">
          <a href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-600 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Retour à l'accueil
          </a>
        </div>
      </div>
    </div>
  );
}
