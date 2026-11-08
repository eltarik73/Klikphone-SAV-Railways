import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Wrench, ChevronDown, Loader2 } from 'lucide-react';
import api from '../lib/api';
import { useApi } from '../hooks/useApi';
import StatusBadge from './StatusBadge';
import { PrioriteBadge, comparerPriorite } from './PrioriteBadge';
import { IconesContact } from './ContactClient';
import { libelleContact, normaliserContact } from '../lib/contact';
import { useMaintenant } from './DelaiReparation';
import { delaiTicket } from '../lib/delai';

// Le serveur trie déjà (priorité, heure promise, statut, dépôt) ; tri stable de secours sur la
// seule priorité, qui garde l'ordre serveur à priorité égale.
export function trierFile(tickets) {
  return [...(tickets || [])].sort((a, b) => comparerPriorite(a?.priorite, b?.priorite));
}

// Délai promis en texte : rouge seulement pour un retard (le rouge est un calque réservé au retard), ambre
// pour « bientôt » et « Délai à fixer », gris sinon. Mêmes règles que la pastille (lib/delai.delaiTicket).
const TON_DELAI = { retard: 'text-red-700', bientot: 'text-amber-800', aucun: 'text-amber-800' };
function DelaiLigne({ ticket, maintenant }) {
  const info = delaiTicket(ticket, maintenant);
  if (!info) return null;
  return (
    <span title={info.titre} data-delai={info.etat}
      className={`text-xs font-medium tabular-nums shrink-0 ${TON_DELAI[info.etat] || 'text-slate-600'}`}>
      <span className="sr-only">Délai de réparation : </span>{info.libelle}
    </span>
  );
}

function QueueList({ queue, currentTicketId, basePath, isTech, onClose, navigate }) {
  // Une seule horloge pour toute la file (délais)
  const maintenant = useMaintenant();
  return (
    <div className="space-y-1">
      {queue.map((t, i) => {
        const isCurrent = t.id === currentTicketId;
        // Client contacté depuis le dernier changement de statut (t.contact, serveur) : seulement s'il l'a été
        const contact = t.contact ? normaliserContact(t.contact) : null;

        return (
          <button
            key={t.id}
            type="button"
            onClick={() => { onClose(); navigate(`${basePath}/ticket/${t.id}`); }}
            className={`w-full text-left px-3 py-2 min-h-11 rounded-lg border transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              isCurrent
                ? 'border-brand-300 bg-brand-50/60'
                : 'border-transparent hover:bg-slate-50'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {/* Rang dans la file : un simple numéro (le statut dit déjà ce qui est en main) */}
              <span className="w-5 shrink-0 pt-0.5 text-right t-small tabular-nums text-slate-500" aria-hidden="true">{i + 1}</span>
              <div className="flex-1 min-w-0">
                {/* En tête de ligne pour le technicien : le délai promis (« 15:30 · dans 1 h 20 », « En retard… ») */}
                <div className="flex items-center gap-1.5 mb-0.5 min-w-0">
                  <DelaiLigne ticket={t} maintenant={maintenant} />
                  <span className="t-mono text-xs font-semibold text-slate-500 shrink-0">{t.ticket_code}</span>
                  <span className="text-sm font-semibold text-slate-900 truncate">
                    {t.client_prenom} {t.client_nom}
                  </span>
                </div>
                <div className="t-small truncate mb-1.5">
                  {t.modele || t.marque} {t.panne ? `• ${t.panne}` : ''}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <PrioriteBadge priorite={t.priorite} court />
                  {!isTech && t.technicien_assigne && (
                    <span className="t-caption">{t.technicien_assigne}</span>
                  )}
                  <StatusBadge statut={t.statut} />
                </div>
                {contact?.depuis_statut && (
                  <div className="mt-1.5 flex items-center gap-1.5 t-caption min-w-0">
                    <IconesContact contact={contact} decoratif />
                    <span className="truncate">{libelleContact(contact)}</span>
                  </div>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Chargement({ className = 'py-8' }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <span className="loading-inline"><Loader2 aria-hidden="true" /> Chargement…</span>
    </div>
  );
}

function Vide({ className = 'py-8' }) {
  return (
    <div className={`text-center ${className}`}>
      <Wrench className="w-8 h-8 text-slate-400 mx-auto mb-2" aria-hidden="true" />
      <p className="text-sm text-slate-500 font-medium">Aucune réparation en attente</p>
    </div>
  );
}

export default function RepairQueue({ open, onClose, currentTicketId, basePath, user, inline }) {
  const navigate = useNavigate();
  const isTech = user?.target === 'tech';
  const techFilter = isTech ? user.utilisateur : null;
  const [collapsed, setCollapsed] = useState(false);

  const { data: tickets, loading } = useApi(
    open ? `queue:repair:${techFilter || 'all'}` : null,
    () => api.getRepairQueue(techFilter),
    { tags: ['tickets'], ttl: 15000 }
  );

  // Close on Escape (panel mode only)
  useEffect(() => {
    if (!open || inline) return;
    const handler = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, inline]);

  const queue = useMemo(() => trierFile(tickets), [tickets]);

  if (!open) return null;

  // En-tête clair partout (titre t-h2 + compteur) : le contenu de la file porte l'information, pas le bandeau
  const titre = isTech ? 'Mes réparations' : "File d'attente";
  const compteur = queue.length > 0 && (
    <span className="badge-count">{queue.length}</span>
  );

  // ─── Inline widget mode ─────────────────────────────────────
  if (inline) {
    return (
      <div className="card overflow-hidden">
        {/* Header */}
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          aria-expanded={!collapsed}
          className={`card-header w-full min-h-14 bg-white text-slate-900 transition-colors duration-150 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${
            collapsed ? '' : 'border-b border-slate-100'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Wrench className="w-4 h-4 shrink-0 text-slate-500" aria-hidden="true" />
            <span className="t-h2 truncate">
              {titre}
            </span>
            {compteur}
          </div>
          <ChevronDown className={`w-4 h-4 shrink-0 text-slate-500 transition-transform duration-150 motion-reduce:transition-none ${collapsed ? '-rotate-90' : ''}`} aria-hidden="true" />
        </button>

        {/* Content */}
        {!collapsed && (
          <div className="p-3 max-h-[500px] overflow-y-auto">
            {loading ? (
              <Chargement />
            ) : queue.length === 0 ? (
              <Vide />
            ) : (
              <QueueList
                queue={queue}
                currentTicketId={currentTicketId}
                basePath={basePath}
                isTech={isTech}
                onClose={() => {}}
                navigate={navigate}
              />
            )}
          </div>
        )}

        {/* Footer */}
        {!collapsed && (
          <div className="px-4 sm:px-5 py-2.5 border-t border-slate-100 t-caption text-center">
            {isTech ? 'Vos tickets assignés en cours' : 'Tous les tickets en attente de traitement'}
          </div>
        )}
      </div>
    );
  }

  // ─── Panel mode (slide-in) ──────────────────────────────────
  return (
    <>
      <div className="fixed inset-0 bg-slate-900/50 z-40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-label={titre} className="drawer sm:w-[400px]">
        <div className="drawer-header">
          <div className="flex items-center gap-2.5 min-w-0">
            <Wrench className="w-4 h-4 shrink-0 text-slate-500" aria-hidden="true" />
            <span className="t-h2 truncate">
              {titre}
            </span>
            {compteur}
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer la file d'attente" className="btn-ghost btn-icon -mr-2">
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <Chargement className="py-12" />
          ) : queue.length === 0 ? (
            <Vide className="py-12" />
          ) : (
            <QueueList
              queue={queue}
              currentTicketId={currentTicketId}
              basePath={basePath}
              isTech={isTech}
              onClose={onClose}
              navigate={navigate}
            />
          )}
        </div>
        <div className="px-4 sm:px-5 py-3 border-t border-slate-100 t-caption text-center shrink-0">
          {isTech ? 'Vos tickets assignés en cours' : 'Tous les tickets en attente de traitement'}
        </div>
      </div>
    </>
  );
}
