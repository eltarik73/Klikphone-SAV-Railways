import { useState } from 'react';
import { Star, MessageSquare, Clock, CheckCircle, RefreshCw, Sparkles, Send, Edit3, RotateCcw, TrendingUp, Copy, ExternalLink, Check } from 'lucide-react';
import api from '../lib/api';
import { useApi, invalidateCache } from '../hooks/useApi';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useToast } from '../components/Toast';

// ─── Helpers ────────────────────────────────────

function StarRating({ note }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          aria-hidden="true"
          className={`w-4 h-4 ${i <= note ? 'text-amber-500 fill-amber-500' : 'text-slate-300'}`}
        />
      ))}
      <span className="sr-only">{note} sur 5</span>
    </div>
  );
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function getInitiales(nom) {
  if (!nom) return '?';
  const parts = nom.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].substring(0, 2).toUpperCase();
}

// ─── Composant principal ────────────────────────

export default function AvisGoogle() {
  const toast = useToast();
  // Routes marketing : rôle admin ET code admin saisi sur ce poste (403 admin_requis sinon)
  const { sensible, adminPrompt } = useAdminElevation();
  const signalerErreur = (err, defaut) => {
    if (err?.code !== 'admin_cancelled') toast.error(err?.message || defaut);
  };
  const { data: avisData, error: loadError, loading, isRevalidating, mutate: mutateAvis } = useApi(
    'avis-google',
    () => sensible(async () => {
      const [a, s] = await Promise.all([api.getAvisGoogle(), api.getAvisGoogleStats()]);
      return { avis: a, stats: s };
    }),
    { tags: ['marketing'], ttl: 120_000 }
  );
  const avis = avisData?.avis ?? [];
  const stats = avisData?.stats ?? null;

  const [filter, setFilter] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [generatingId, setGeneratingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  async function handleSync() {
    setSyncing(true);
    try {
      await sensible(() => api.syncAvisGoogle());
      invalidateCache('marketing');
    } catch (e) {
      signalerErreur(e, 'Synchronisation impossible');
    } finally {
      setSyncing(false);
    }
  }

  async function handleGenerate(id) {
    setGeneratingId(id);
    try {
      const result = await sensible(() => api.genererReponseAvis(id));
      const suggestion = result.ia_suggestion || result.suggestion || result.reponse;
      mutateAvis(prev => prev ? {
        ...prev,
        avis: prev.avis.map(a =>
          a.id === id ? { ...a, ia_suggestion: suggestion } : a
        )
      } : prev);
    } catch (e) {
      signalerErreur(e, 'Génération de la réponse impossible');
    } finally {
      setGeneratingId(null);
    }
  }

  async function handleApprove(id, text) {
    try {
      await sensible(() => api.publierReponseAvis(id, {
        reponse_texte: text,
        reponse_par: localStorage.getItem('kp_user') || 'Accueil',
      }));
      invalidateCache('marketing');
    } catch (e) {
      signalerErreur(e, 'Publication impossible');
    }
  }

  function handleEdit(id, currentText) {
    setEditingId(id);
    setEditText(currentText || '');
  }

  async function handleSaveEdit(id) {
    try {
      await sensible(() => api.updateReponseAvis(id, { reponse_texte: editText }));
      setEditingId(null);
      setEditText('');
      invalidateCache('marketing');
    } catch (e) {
      signalerErreur(e, 'Enregistrement impossible');
    }
  }

  function handleRegenerate(id) {
    handleGenerate(id);
  }

  async function handleCopy(text, id) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

  function openGoogleReviews() {
    // Opens the Google Business Profile review management page
    window.open('https://business.google.com/', '_blank');
  }

  // ─── Filtrage ─────────────────────────────────

  const filtered = avis.filter(a => {
    if (filter === 'all') return true;
    if (filter === 'pending') return !a.repondu;
    if (filter === '5') return a.note === 5;
    if (filter === '4') return a.note === 4;
    if (filter === '3') return a.note <= 3;
    return true;
  });

  const filters = [
    { key: 'all', label: 'Tous' },
    { key: 'pending', label: 'Non répondus' },
    { key: '5', label: '5★' },
    { key: '4', label: '4★' },
    { key: '3', label: '≤3★' },
  ];

  // ─── Rendu ────────────────────────────────────

  return (
    <div className="page max-w-[1280px]">
      {adminPrompt}
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Avis Google</h1>
          <p className="page-header-subtitle">
            {stats
              ? `${stats.total || 0} avis · Note moyenne ${stats.note_moyenne?.toFixed(1) || '—'}/5`
              : 'Chargement...'}
          </p>
        </div>
        <div className="page-header-actions max-w-full">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn-primary"
          >
            <RefreshCw className={syncing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{syncing ? 'Synchronisation...' : 'Synchroniser'}</span>
          </button>
        </div>
      </div>

      {/* Contenu */}
      <div className="space-y-6">
        {loadError && !avisData && !loading && (
          <div role="alert" className="callout callout-danger items-center flex-wrap">
            <p className="flex-1 min-w-0">
              {loadError.code === 'admin_cancelled'
                ? 'Code admin requis pour afficher les avis.'
                : `Avis indisponibles : ${loadError.message || 'erreur du serveur'}`}
            </p>
            <button type="button" onClick={() => mutateAvis()}
              className="btn-secondary btn-sm">
              Réessayer
            </button>
          </div>
        )}
        {loading ? (
          <div className="loading-inline justify-center w-full py-20" role="status">
            <RefreshCw aria-hidden="true" />
            <p>Chargement des avis...</p>
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
              {/* Note moyenne */}
              <div className="kpi-card">
                <div className="kpi-icon bg-amber-50 text-amber-500">
                  <Star className="fill-current" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="kpi-value">
                    {stats?.note_moyenne?.toFixed(1) || '—'}<span className="text-sm font-medium text-slate-500">/5</span>
                  </p>
                  <p className="kpi-label">Note moyenne</p>
                </div>
              </div>

              {/* Total avis */}
              <div className="kpi-card">
                <div className="kpi-icon">
                  <MessageSquare aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="kpi-value">{stats?.total || 0}</p>
                  <p className="kpi-label">Total avis</p>
                </div>
              </div>

              {/* Non répondus */}
              <div className="kpi-card">
                <div className={`kpi-icon ${(stats?.non_repondus || 0) > 0 ? 'bg-amber-50 text-amber-700' : ''}`}>
                  <Clock aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="kpi-value">{stats?.non_repondus || 0}</p>
                  <p className="kpi-label">Non répondus</p>
                </div>
              </div>

              {/* Taux de réponse */}
              <div className="kpi-card">
                <div className="kpi-icon bg-emerald-50 text-emerald-700">
                  <CheckCircle aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="kpi-value">
                    {stats?.taux_reponse != null ? `${stats.taux_reponse}%` : '—'}
                  </p>
                  <p className="kpi-label">Taux de réponse</p>
                </div>
              </div>
            </div>

            {/* Info banner */}
            <div className="callout callout-info">
              <ExternalLink aria-hidden="true" />
              <p>
                <span className="font-semibold">Comment ça marche :</span> Générez une réponse IA, modifiez-la si besoin, puis cliquez "Approuver & Publier". La réponse sera copiée et Google ouvert pour la coller.
              </p>
            </div>

            {/* Filtres */}
            <div className="scroll-fade-x">
              <div className="segmented" role="group" aria-label="Filtrer les avis">
                {filters.map(f => (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={filter === f.key}
                    onClick={() => setFilter(f.key)}
                    className={`segmented-item ${filter === f.key ? 'segmented-item-active' : ''}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Liste des avis */}
            {filtered.length === 0 ? (
              <div className="empty-state card">
                <div className="empty-state-icon"><MessageSquare aria-hidden="true" /></div>
                <p className="t-h2">Aucun avis trouvé</p>
                <p className="t-body text-slate-500">
                  Modifiez vos filtres ou synchronisez les avis
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filtered.map(item => (
                  <div
                    key={item.id}
                    className="card card-body"
                  >
                    {/* En-tête de l'avis */}
                    <div className="flex items-start gap-3">
                      {/* Avatar : neutre pour un bon avis, ambre (attention) sous 4 étoiles */}
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                          item.note >= 4
                            ? 'bg-brand-50 text-brand-700'
                            : 'bg-amber-50 text-amber-800'
                        }`}
                        aria-hidden="true"
                      >
                        {getInitiales(item.auteur)}
                      </div>

                      {/* Infos */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm text-slate-900">
                            {item.auteur || 'Anonyme'}
                          </span>
                          <StarRating note={item.note} />
                          <span className="t-caption">
                            {formatDate(item.date)}
                          </span>
                        </div>

                        {/* Badge statut */}
                        <div className="mt-1">
                          {item.repondu ? (
                            <span className="badge badge-success">
                              <CheckCircle className="w-3 h-3" aria-hidden="true" />
                              Répondu
                            </span>
                          ) : (
                            <span className="badge badge-warning">
                              <Clock className="w-3 h-3" aria-hidden="true" />
                              En attente
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Texte de l'avis */}
                    {item.texte && (
                      <p className="mt-3 text-sm text-slate-700 italic leading-relaxed">
                        « {item.texte} »
                      </p>
                    )}

                    {/* Actions pour avis non répondu */}
                    {!item.repondu && (
                      <div className="mt-4">
                        {/* Bouton générer si pas encore de suggestion */}
                        {!item.ia_suggestion && (
                          <button
                            onClick={() => handleGenerate(item.id)}
                            disabled={generatingId === item.id}
                            className="btn-secondary"
                          >
                            <Sparkles
                              className={`text-brand-600 ${generatingId === item.id ? 'animate-pulse' : ''}`}
                            />
                            {generatingId === item.id
                              ? 'Génération en cours...'
                              : 'Générer réponse IA'}
                          </button>
                        )}

                        {/* Bloc suggestion IA */}
                        {item.ia_suggestion && (
                          <div className="card-section mt-3 border-l-4 border-brand-500">
                            <div className="flex items-center gap-2 mb-2">
                              <Sparkles className="w-4 h-4 text-brand-600" aria-hidden="true" />
                              <span className="t-h3 text-brand-700">
                                Réponse IA suggérée
                              </span>
                            </div>
                            <p className="text-sm text-slate-700 leading-relaxed">
                              {item.ia_suggestion}
                            </p>

                            {/* Boutons d'action */}
                            <div className="flex flex-wrap gap-2 mt-3">
                              <button
                                onClick={async () => {
                                  await handleCopy(item.ia_suggestion, `approve-${item.id}`);
                                  await handleApprove(item.id, item.ia_suggestion);
                                  openGoogleReviews();
                                }}
                                className="btn-primary btn-sm"
                              >
                                {copiedId === `approve-${item.id}` ? (
                                  <><Check /> Copié ! Ouvrir Google...</>
                                ) : (
                                  <><Send /> Approuver & Publier</>
                                )}
                              </button>
                              <button
                                onClick={() => handleEdit(item.id, item.ia_suggestion)}
                                className="btn-secondary btn-sm"
                              >
                                <Edit3 />
                                Modifier
                              </button>
                              <button
                                onClick={() => handleRegenerate(item.id)}
                                disabled={generatingId === item.id}
                                className="btn-secondary btn-sm"
                              >
                                <RotateCcw
                                  className={generatingId === item.id ? 'animate-spin' : ''}
                                />
                                Régénérer
                              </button>
                              <button
                                onClick={() => handleCopy(item.ia_suggestion, `copy-${item.id}`)}
                                className="btn-ghost btn-sm"
                              >
                                {copiedId === `copy-${item.id}` ? (
                                  <><Check className="text-emerald-700" /> Copié !</>
                                ) : (
                                  <><Copy /> Copier</>
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Réponse publiée */}
                    {item.repondu && item.reponse_texte && (
                      <div className="card-section mt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                          <span className="t-h3 text-emerald-700">
                            Réponse publiée
                          </span>
                        </div>
                        <p className="text-sm text-slate-700 leading-relaxed">
                          {item.reponse_texte}
                        </p>
                        <div className="flex items-center gap-2 mt-2 t-caption">
                          {item.reponse_date && (
                            <span>{formatDate(item.reponse_date)}</span>
                          )}
                          {item.reponse_par && (
                            <span>· par {item.reponse_par}</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2 -ml-3">
                          <button
                            onClick={() => handleCopy(item.reponse_texte, `pub-${item.id}`)}
                            className="btn-ghost btn-sm"
                          >
                            {copiedId === `pub-${item.id}` ? (
                              <><Check className="text-emerald-700" /> Copié</>
                            ) : (
                              <><Copy /> Copier</>
                            )}
                          </button>
                          <button
                            onClick={openGoogleReviews}
                            className="btn-ghost btn-sm text-brand-700 hover:text-brand-800"
                          >
                            <ExternalLink /> Voir sur Google
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Mode édition */}
                    {editingId === item.id && (
                      <div className="mt-4 space-y-3">
                        <label htmlFor={`avis-reponse-${item.id}`} className="sr-only">Modifier la réponse</label>
                        <textarea
                          id={`avis-reponse-${item.id}`}
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          rows={4}
                          className="textarea resize-none"
                          placeholder="Modifier la réponse..."
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleSaveEdit(item.id)}
                            className="btn-primary"
                          >
                            <Send />
                            Sauvegarder
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditText('');
                            }}
                            className="btn-ghost"
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
