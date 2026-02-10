import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import { formatDate, getStatusIcon, getStatusConfig, STATUTS } from '../lib/utils';
import { Search, Smartphone, ArrowLeft, CheckCircle2, MapPin, Phone } from 'lucide-react';

export default function SuiviPage() {
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get('ticket') || '');
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const doSearch = useCallback(async (searchCode) => {
    const c = (searchCode || code).trim().toUpperCase();
    if (!c) return;
    setLoading(true);
    setError('');
    setTicket(null);

    try {
      const data = await api.getTicketByCode(c);
      setTicket(data);
    } catch {
      setError('Aucun ticket trouv\u00E9 avec ce code.');
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    const ticketParam = searchParams.get('ticket');
    if (ticketParam) {
      doSearch(ticketParam);
    }
  }, []);

  const handleSearch = (e) => {
    e?.preventDefault();
    doSearch();
  };

  const steps = STATUTS.slice(0, -1);
  const currentIdx = ticket ? steps.indexOf(ticket.statut) : -1;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8 animate-in">
          <div className="w-16 h-16 rounded-2xl bg-brand-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand-500/20">
            <Smartphone className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Suivi de r\u00E9paration</h1>
          <p className="text-sm text-slate-500 mt-1">Entrez votre code ticket</p>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-8">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="KP-000001"
            className="input flex-1 text-center font-mono text-lg font-bold tracking-wider uppercase"
            autoFocus
          />
          <button type="submit" disabled={loading} className="btn-primary px-5">
            <Search className="w-5 h-5" />
          </button>
        </form>

        {error && (
          <div className="card p-6 text-center animate-in">
            <p className="text-red-500 font-medium">{error}</p>
          </div>
        )}

        {ticket && (
          <div className="space-y-5 animate-in">
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
                  <p className="text-slate-400 text-xs mb-0.5">D\u00E9pos\u00E9 le</p>
                  <p className="font-medium text-slate-800">{formatDate(ticket.date_depot)}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs mb-0.5">Derni\u00E8re mise \u00E0 jour</p>
                  <p className="font-medium text-slate-800">{formatDate(ticket.date_maj)}</p>
                </div>
              </div>

              {ticket.commentaire_client && (
                <div className="mt-4 p-3 bg-brand-50 border border-brand-100 rounded-lg text-sm text-brand-800">
                  <span className="font-semibold">Message :</span> {ticket.commentaire_client}
                </div>
              )}
            </div>

            {/* Progress timeline */}
            <div className="card p-6">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-6">Progression</h3>
              <div className="space-y-0">
                {steps.map((stepName, i) => {
                  const done = i <= currentIdx;
                  const isCurrent = i === currentIdx;
                  const sc = getStatusConfig(stepName);
                  return (
                    <div key={stepName} className="flex items-start gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all
                          ${done
                            ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
                            : 'bg-slate-100 text-slate-400'
                          }
                          ${isCurrent ? 'ring-4 ring-emerald-100 scale-110' : ''}
                        `}>
                          {done ? <CheckCircle2 className="w-4 h-4" /> : <span className="text-xs font-bold">{i + 1}</span>}
                        </div>
                        {i < steps.length - 1 && (
                          <div className={`w-0.5 h-8 transition-colors ${i < currentIdx ? 'bg-emerald-300' : 'bg-slate-200'}`} />
                        )}
                      </div>
                      <div className={`pt-1.5 ${isCurrent ? 'font-bold text-slate-900' : done ? 'text-slate-600' : 'text-slate-400'}`}>
                        <p className="text-sm">{stepName}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Contact */}
            <div className="card p-6 text-center">
              <p className="text-sm text-slate-500 mb-3">Une question sur votre r\u00E9paration ?</p>
              <div className="flex items-center justify-center gap-2 text-lg font-bold text-slate-900">
                <Phone className="w-5 h-5 text-brand-500" />
                04 79 60 89 22
              </div>
              <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400 mt-2">
                <MapPin className="w-3 h-3" />
                79 Place Saint L\u00E9ger, Chamb\u00E9ry
              </div>
            </div>
          </div>
        )}

        {/* Back */}
        <div className="mt-8 text-center">
          <a href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-600 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Retour \u00E0 l'accueil
          </a>
        </div>
      </div>
    </div>
  );
}
