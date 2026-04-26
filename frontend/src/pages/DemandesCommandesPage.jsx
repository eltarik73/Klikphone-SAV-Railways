import { useState, useEffect, useCallback } from 'react';
import { useLocation, Link } from 'react-router-dom';
import {
  ShoppingBag, Phone, Mail, User, Package, Clock, Check, X,
  MessageSquare, ArrowLeft, RefreshCw, Loader2, Filter, Trash2, Lock,
  AlertTriangle,
} from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../components/Toast';

const STATUS_CONFIG = {
  nouvelle: { label: 'Nouvelle', color: 'bg-amber-500/20 text-amber-300 border-amber-400/40', dot: 'bg-amber-400' },
  en_cours: { label: 'En cours', color: 'bg-violet-500/20 text-violet-300 border-violet-400/40', dot: 'bg-violet-400' },
  confirmee: { label: 'Confirmée', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40', dot: 'bg-emerald-400' },
  annulee: { label: 'Annulée', color: 'bg-slate-600/20 text-slate-400 border-slate-500/40', dot: 'bg-slate-500' },
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
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Link to={basePath} className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
            <ArrowLeft className="w-4 h-4 text-slate-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight">
              Demandes de <span className="font-editorial text-brand-600">commande</span>
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Depuis la vitrine publique /site-tarifs-iphone
            </p>
          </div>
        </div>
        <button onClick={load} className="btn-ghost p-2.5" title="Rafraîchir">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filtres */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <Filter className="w-4 h-4 text-slate-400" />
        {[
          ['all', 'Toutes', demandes.length],
          ['nouvelle', 'Nouvelles', counts.nouvelle || 0],
          ['en_cours', 'En cours', counts.en_cours || 0],
          ['confirmee', 'Confirmées', counts.confirmee || 0],
          ['annulee', 'Annulées', counts.annulee || 0],
        ].map(([v, label, n]) => (
          <button
            key={v}
            onClick={() => setFilterStatut(v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5
              ${filterStatut === v
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {label} {n > 0 && <span className={filterStatut === v ? 'bg-white/20 px-1.5 rounded' : 'bg-slate-200 px-1.5 rounded'}>{n}</span>}
          </button>
        ))}
      </div>

      {/* Liste */}
      {loading && !demandes.length ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
        </div>
      ) : demandes.length === 0 ? (
        <div className="card p-12 text-center">
          <ShoppingBag className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Aucune demande pour ce filtre</p>
          <p className="text-xs text-slate-400 mt-1">Les commandes passées depuis la vitrine apparaîtront ici</p>
        </div>
      ) : (
        <div className="space-y-3">
          {demandes.map(d => {
            const sc = STATUS_CONFIG[d.statut] || STATUS_CONFIG.nouvelle;
            const isSaving = savingId === d.id;
            return (
              <div key={d.id} className="card p-5 border-l-4" style={{ borderLeftColor: d.statut === 'nouvelle' ? '#F59E0B' : d.statut === 'en_cours' ? '#7C3AED' : d.statut === 'confirmee' ? '#10B981' : '#64748B' }}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                      <ShoppingBag className="w-5 h-5 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-display font-bold text-slate-900 text-lg leading-tight">
                        #{d.id} · {d.marque} {d.modele}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtDate(d.date_creation)}</span>
                        {d.stockage && <><span>·</span><span>{d.stockage}</span></>}
                        {d.prix > 0 && <><span>·</span><span className="font-bold text-amber-600">{d.prix}€</span></>}
                      </p>
                    </div>
                  </div>
                  <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${sc.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                    {sc.label}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm mb-3">
                  <div className="flex items-center gap-2 text-slate-700">
                    <User className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="font-semibold truncate">{d.nom}</span>
                  </div>
                  <a href={`tel:${d.telephone}`} className="flex items-center gap-2 text-brand-600 hover:text-brand-700 font-medium">
                    <Phone className="w-4 h-4 shrink-0" />
                    {d.telephone}
                  </a>
                  {d.email && (
                    <a href={`mailto:${d.email}`} className="flex items-center gap-2 text-slate-600 hover:text-brand-600 truncate">
                      <Mail className="w-4 h-4 shrink-0" />
                      <span className="truncate">{d.email}</span>
                    </a>
                  )}
                </div>

                {d.message && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 mb-3 flex gap-2">
                    <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span className="whitespace-pre-line">{d.message}</span>
                  </div>
                )}

                {/* Actions de changement de statut */}
                <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-slate-100">
                  {d.statut === 'nouvelle' && (
                    <button
                      onClick={() => changerStatut(d.id, 'en_cours')}
                      disabled={isSaving}
                      className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Package className="w-3 h-3" />}
                      Prendre en charge
                    </button>
                  )}
                  {['nouvelle', 'en_cours'].includes(d.statut) && (
                    <button
                      onClick={() => changerStatut(d.id, 'confirmee')}
                      disabled={isSaving}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      Confirmer
                    </button>
                  )}
                  {d.statut !== 'annulee' && d.statut !== 'confirmee' && (
                    <button
                      onClick={() => changerStatut(d.id, 'annulee')}
                      disabled={isSaving}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      <X className="w-3 h-3" /> Annuler
                    </button>
                  )}
                  {(d.statut === 'annulee' || d.statut === 'confirmee') && (
                    <button
                      onClick={() => changerStatut(d.id, 'nouvelle')}
                      disabled={isSaving}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className="w-3 h-3" /> Rouvrir
                    </button>
                  )}
                  {/* Suppression definitive (code admin requis) */}
                  <button
                    onClick={() => ouvrirSuppression(d)}
                    disabled={isSaving}
                    className="ml-auto px-3 py-1.5 rounded-lg text-red-500 hover:bg-red-50 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    title="Supprimer définitivement (code admin requis)"
                  >
                    <Trash2 className="w-3 h-3" /> Supprimer
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de confirmation suppression (code admin requis) */}
      {deleteTarget && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => !deleting && setDeleteTarget(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-bold text-slate-900">Supprimer la demande</h3>
                  <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[230px]">{deleteTarget.label}</p>
                </div>
              </div>
              <p className="text-sm text-slate-600 mb-4">
                Cette action est <strong className="text-red-600">irréversible</strong>. Entrez le code admin pour confirmer.
              </p>
              <div className="mb-3">
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1.5">
                  <Lock className="w-3 h-3" /> Code administrateur
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={e => { setDeletePassword(e.target.value); setDeleteError(''); }}
                  onKeyDown={e => e.key === 'Enter' && confirmerSuppression()}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 text-slate-900 text-sm outline-none transition"
                  placeholder="Entrez le code admin"
                  autoFocus
                  disabled={deleting}
                />
                {deleteError && (
                  <p className="text-xs text-red-600 mt-1.5 font-semibold">{deleteError}</p>
                )}
              </div>
              <div className="flex items-center gap-2 mt-5">
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  onClick={confirmerSuppression}
                  disabled={deleting || !deletePassword}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  {deleting ? 'Suppression…' : 'Supprimer'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
