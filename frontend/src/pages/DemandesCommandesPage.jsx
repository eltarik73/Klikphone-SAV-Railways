import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import {
  ShoppingBag, Phone, Mail, User, Package, Clock, Check, X,
  MessageSquare, ArrowLeft, RefreshCw, Loader2, Filter, Trash2, Lock,
  AlertTriangle,
} from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../components/Toast';
import { useFocusTrap } from '../hooks/useFocusTrap';

const STATUS_CONFIG = {
  nouvelle: { label: 'Nouvelle', badge: 'badge-warning' },
  en_cours: { label: 'En cours', badge: 'badge-info' },
  confirmee: { label: 'Confirmée', badge: 'badge-success' },
  annulee: { label: 'Annulée', badge: 'badge-neutral' },
};

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export default function DemandesCommandesPage() {
  const location = useLocation();
  const basePath = location.pathname.startsWith('/tech') ? '/tech' : '/accueil';
  const toast = useToast();

  const [demandes, setDemandes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatut, setFilterStatut] = useState('all');
  const [savingId, setSavingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, label }
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  // Modale de suppression : focus piégé, Échap (hors envoi), focus rendu au bouton « Supprimer » à la fermeture
  const supprRef = useRef(null);
  useFocusTrap(supprRef, Boolean(deleteTarget), {
    initialFocus: '#demande-suppr-code',
    onEscape: () => { if (!deleting) setDeleteTarget(null); },
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listDemandesCommandes(filterStatut === 'all' ? null : filterStatut);
      setDemandes(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error('Erreur chargement : ' + (e.message || ''));
    } finally {
      setLoading(false);
    }
  }, [filterStatut, toast]);

  useEffect(() => { load(); }, [load]);

  async function changerStatut(id, statut) {
    setSavingId(id);
    try {
      await api.updateDemandeCommande(id, { statut });
      setDemandes(ds => ds.map(d => d.id === id ? { ...d, statut, date_maj: new Date().toISOString() } : d));
      toast.success(`Statut → ${STATUS_CONFIG[statut]?.label || statut}`);
    } catch (e) {
      toast.error('Erreur : ' + (e.message || ''));
    } finally {
      setSavingId(null);
    }
  }

  function ouvrirSuppression(d) {
    setDeleteTarget({ id: d.id, label: `#${d.id} — ${d.marque} ${d.modele} (${d.nom})` });
    setDeletePassword('');
    setDeleteError('');
  }

  async function confirmerSuppression() {
    if (!deleteTarget) return;
    if (!deletePassword) {
      setDeleteError('Code admin requis');
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      await api.deleteDemandeCommande(deleteTarget.id, deletePassword);
      setDemandes(ds => ds.filter(d => d.id !== deleteTarget.id));
      toast.success('Demande supprimée');
      setDeleteTarget(null);
      setDeletePassword('');
    } catch (e) {
      setDeleteError(e.message?.includes('Code admin') ? 'Code admin incorrect' : (e.message || 'Erreur'));
    } finally {
      setDeleting(false);
    }
  }

  const counts = demandes.reduce((acc, d) => {
    acc[d.statut] = (acc[d.statut] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="page max-w-[1280px]">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-start gap-2 min-w-0">
          <Link to={basePath} className="btn-ghost btn-icon shrink-0 -ml-2" aria-label="Retour">
            <ArrowLeft aria-hidden="true" />
          </Link>
          <div className="min-w-0">
            <h1 className="page-header-title">
              Demandes de commande
            </h1>
            <p className="page-header-subtitle">
              Depuis la vitrine publique /site-tarifs-iphone
            </p>
          </div>
        </div>
        <div className="page-header-actions">
          <button type="button" onClick={load} className="btn-secondary btn-icon" title="Rafraîchir" aria-label="Rafraîchir">
            <RefreshCw className={loading ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex items-center gap-2 mb-6 max-sm:scroll-fade-x">
        <Filter className="w-4 h-4 text-slate-400 shrink-0 max-sm:hidden" aria-hidden="true" />
        <div className="segmented" role="group" aria-label="Filtrer par statut">
          {[
            ['all', 'Toutes', demandes.length],
            ['nouvelle', 'Nouvelles', counts.nouvelle || 0],
            ['en_cours', 'En cours', counts.en_cours || 0],
            ['confirmee', 'Confirmées', counts.confirmee || 0],
            ['annulee', 'Annulées', counts.annulee || 0],
          ].map(([v, label, n]) => (
            <button
              key={v}
              type="button"
              onClick={() => setFilterStatut(v)}
              aria-pressed={filterStatut === v}
              className={`segmented-item ${filterStatut === v ? 'segmented-item-active' : ''}`}
            >
              {label} {n > 0 && <span className={`badge badge-sm ${filterStatut === v ? 'badge-brand' : 'badge-neutral'}`}>{n}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Liste */}
      {loading && !demandes.length ? (
        <div className="space-y-3" role="status">
          {[1, 2, 3].map(i => <div key={i} className="skeleton h-40" aria-hidden="true" />)}
          <p className="sr-only">Chargement…</p>
        </div>
      ) : demandes.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon">
            <ShoppingBag aria-hidden="true" />
          </div>
          <p className="t-h2">Aucune demande pour ce filtre</p>
          <p className="t-body text-slate-500 max-w-sm">Les commandes passées depuis la vitrine apparaîtront ici</p>
        </div>
      ) : (
        <div className="space-y-4">
          {demandes.map(d => {
            const sc = STATUS_CONFIG[d.statut] || STATUS_CONFIG.nouvelle;
            const isSaving = savingId === d.id;
            return (
              <div key={d.id} className="card card-body">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0" aria-hidden="true">
                      <ShoppingBag className="w-5 h-5 text-slate-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="t-h2">
                        #{d.id} · {d.marque} {d.modele}
                      </p>
                      <p className="t-caption mt-0.5 flex items-center gap-2 flex-wrap">
                        <span className="flex items-center gap-1 tabular-nums"><Clock className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" /> {fmtDate(d.date_creation)}</span>
                        {d.stockage && <><span>·</span><span>{d.stockage}</span></>}
                        {d.prix > 0 && <><span>·</span><span className="t-num text-sm">{d.prix}€</span></>}
                      </p>
                    </div>
                  </div>
                  <span className={`badge ${sc.badge} shrink-0`}>
                    <span className="badge-dot" aria-hidden="true" />
                    {sc.label}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-3 gap-y-1 text-sm mb-3">
                  <div className="flex items-center gap-2 min-h-11 text-slate-800 min-w-0">
                    <User className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                    <span className="font-semibold truncate">{d.nom}</span>
                  </div>
                  <a href={`tel:${d.telephone}`} className="inline-flex items-center gap-2 min-h-11 text-brand-700 hover:text-brand-800 font-medium tabular-nums rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    <Phone className="w-4 h-4 shrink-0" aria-hidden="true" />
                    {d.telephone}
                  </a>
                  {d.email && (
                    <a href={`mailto:${d.email}`} className="inline-flex items-center gap-2 min-h-11 text-slate-600 hover:text-brand-700 min-w-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                      <Mail className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{d.email}</span>
                    </a>
                  )}
                </div>

                {d.message && (
                  <div className="card-section t-body mb-3 flex gap-2">
                    <MessageSquare className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
                    <span className="whitespace-pre-line">{d.message}</span>
                  </div>
                )}

                {/* Actions de changement de statut */}
                <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-slate-100">
                  {d.statut === 'nouvelle' && (
                    <button
                      type="button"
                      onClick={() => changerStatut(d.id, 'en_cours')}
                      disabled={isSaving}
                      className="btn-primary grow sm:grow-0"
                    >
                      {isSaving ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Package aria-hidden="true" />}
                      Prendre en charge
                    </button>
                  )}
                  {['nouvelle', 'en_cours'].includes(d.statut) && (
                    <button
                      type="button"
                      onClick={() => changerStatut(d.id, 'confirmee')}
                      disabled={isSaving}
                      className={`${d.statut === 'en_cours' ? 'btn-primary' : 'btn-secondary'} grow sm:grow-0`}
                    >
                      {isSaving ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                      Confirmer
                    </button>
                  )}
                  {d.statut !== 'annulee' && d.statut !== 'confirmee' && (
                    <button
                      type="button"
                      onClick={() => changerStatut(d.id, 'annulee')}
                      disabled={isSaving}
                      className="btn-ghost grow sm:grow-0"
                    >
                      <X aria-hidden="true" /> Annuler
                    </button>
                  )}
                  {(d.statut === 'annulee' || d.statut === 'confirmee') && (
                    <button
                      type="button"
                      onClick={() => changerStatut(d.id, 'nouvelle')}
                      disabled={isSaving}
                      className="btn-secondary grow sm:grow-0"
                    >
                      <RefreshCw aria-hidden="true" /> Rouvrir
                    </button>
                  )}
                  {/* Suppression definitive (code admin requis) */}
                  <button
                    type="button"
                    onClick={() => ouvrirSuppression(d)}
                    disabled={isSaving}
                    className="btn-danger-ghost grow sm:grow-0 sm:ml-auto"
                    title="Supprimer définitivement (code admin requis)"
                  >
                    <Trash2 aria-hidden="true" /> Supprimer
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de confirmation suppression (code admin requis) */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteTarget(null)}>
          <div ref={supprRef} role="dialog" aria-modal="true" aria-labelledby="demande-suppr-titre" className="modal sm:max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center shrink-0" aria-hidden="true">
                  <AlertTriangle className="w-5 h-5 text-red-700" />
                </div>
                <div className="min-w-0">
                  <h3 id="demande-suppr-titre" className="t-h2">Supprimer la demande</h3>
                  <p className="t-caption truncate">{deleteTarget.label}</p>
                </div>
              </div>
            </div>
            <div className="modal-body">
              <p className="t-body mb-4">
                Cette action est <strong className="text-red-700">irréversible</strong>. Entrez le code admin pour confirmer.
              </p>
              <div>
                <label htmlFor="demande-suppr-code" className="input-label flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" /> Code administrateur
                </label>
                <input
                  id="demande-suppr-code"
                  type="password"
                  value={deletePassword}
                  onChange={e => { setDeletePassword(e.target.value); setDeleteError(''); }}
                  onKeyDown={e => e.key === 'Enter' && confirmerSuppression()}
                  className="input"
                  placeholder="Entrez le code admin"
                  autoFocus
                  disabled={deleting}
                  aria-invalid={deleteError ? 'true' : undefined}
                  aria-describedby={deleteError ? 'demande-suppr-erreur' : undefined}
                />
                {deleteError && (
                  <p id="demande-suppr-erreur" role="alert" className="input-error">{deleteError}</p>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="btn-ghost"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmerSuppression}
                disabled={deleting || !deletePassword}
                className="btn-danger"
              >
                {deleting ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                {deleting ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
