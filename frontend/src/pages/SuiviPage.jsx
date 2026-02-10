import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import { formatDate, getStatusIcon, STATUTS } from '../lib/utils';
import { Search, Wrench, ArrowLeft, CheckCircle2 } from 'lucide-react';

export default function SuiviPage() {
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get('ticket') || '');
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    setTicket(null);

    try {
      const data = await api.getTicketByCode(code.trim().toUpperCase());
      setTicket(data);
    } catch {
      setError('Aucun ticket trouvé avec ce code.');
    } finally {
      setLoading(false);
    }
  };

  // Étapes de progression
  const steps = STATUTS.slice(0, -1); // Sans "Clôturé"
  const currentIdx = ticket ? steps.indexOf(ticket.statut) : -1;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-brand-50/30">
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-brand-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand-500/20">
            <Wrench className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Suivi de réparation</h1>
          <p className="text-sm text-gray-500 mt-1">Entrez votre code ticket pour suivre l'avancement</p>
        </div>

        {/* Recherche */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-8">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="KP-000001"
            className="input flex-1 text-center font-mono text-lg font-bold tracking-wider uppercase"
            autoFocus
          />
          <button type="submit" disabled={loading} className="btn-primary px-6">
            <Search className="w-5 h-5" />
          </button>
        </form>

        {error && (
          <div className="card p-6 text-center animate-in">
            <p className="text-rose-500 font-medium">{error}</p>
          </div>
        )}

        {ticket && (
          <div className="space-y-6 animate-in">
            {/* Card ticket */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold font-mono text-brand-600">{ticket.ticket_code}</h2>
                <StatusBadge statut={ticket.statut} />
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-400">Appareil</span>
                  <p className="font-medium mt-0.5">
                    {ticket.marque} {ticket.modele || ticket.modele_autre}
                  </p>
                </div>
                <div>
                  <span className="text-gray-400">Panne</span>
                  <p className="font-medium mt-0.5">{ticket.panne}</p>
                </div>
                <div>
                  <span className="text-gray-400">Déposé le</span>
                  <p className="font-medium mt-0.5">{formatDate(ticket.date_depot)}</p>
                </div>
                <div>
                  <span className="text-gray-400">Dernière mise à jour</span>
                  <p className="font-medium mt-0.5">{formatDate(ticket.date_maj)}</p>
                </div>
              </div>

              {ticket.commentaire_client && (
                <div className="mt-4 p-3 bg-brand-50 rounded-xl text-sm text-brand-800">
                  <span className="font-semibold">Message :</span> {ticket.commentaire_client}
                </div>
              )}
            </div>

            {/* Timeline de progression */}
            <div className="card p-6">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-6">Progression</h3>
              <div className="space-y-0">
                {steps.map((step, i) => {
                  const done = i <= currentIdx;
                  const isCurrent = i === currentIdx;
                  return (
                    <div key={step} className="flex items-start gap-3">
                      {/* Ligne verticale + point */}
                      <div className="flex flex-col items-center">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all
                          ${done
                            ? 'bg-emerald-500 text-white'
                            : 'bg-gray-100 text-gray-400'
                          }
                          ${isCurrent ? 'ring-4 ring-emerald-100 scale-110' : ''}
                        `}>
                          {done ? <CheckCircle2 className="w-4 h-4" /> : <span className="text-xs">{i + 1}</span>}
                        </div>
                        {i < steps.length - 1 && (
                          <div className={`w-0.5 h-8 ${i < currentIdx ? 'bg-emerald-300' : 'bg-gray-200'}`} />
                        )}
                      </div>
                      {/* Label */}
                      <div className={`pt-1.5 ${isCurrent ? 'font-bold text-gray-900' : done ? 'text-gray-600' : 'text-gray-400'}`}>
                        <p className="text-sm">{getStatusIcon(step)} {step}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Contact */}
            <div className="card p-6 text-center">
              <p className="text-sm text-gray-500 mb-2">Une question ?</p>
              <p className="font-semibold">📞 04 79 60 89 22</p>
              <p className="text-xs text-gray-400 mt-1">79 Place Saint Léger, Chambéry</p>
            </div>
          </div>
        )}

        {/* Retour */}
        <div className="mt-8 text-center">
          <a href="/" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600">
            <ArrowLeft className="w-4 h-4" /> Retour à l'accueil
          </a>
        </div>
      </div>
    </div>
  );
}
