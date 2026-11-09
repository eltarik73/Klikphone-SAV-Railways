import { useState } from 'react';
import { Star, MessageSquare, Clock, CheckCircle, RefreshCw, Send, Edit3, RotateCcw, Copy, ExternalLink, Check } from 'lucide-react';
import api from '../lib/api';
import { useApi, invalidateCache } from '../hooks/useApi';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useToast } from '../components/Toast';
import CarteChiffres from '../components/CarteChiffres';

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

// Taux en pourcentage (l'API envoie 85 pour 85 %) : « 85 % »
const fmtTaux = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 });
const fmtNote = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

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
              ? `${stats.total || 0} avis · Note moyenne ${stats.note_moyenne != null ? fmtNote.format(stats.note_moyenne) : '—'}/5`
              : 'Chargement…'}
          </p>
        </div>
        <div className="page-header-actions max-w-full">
          {/* Libellé masqué sur mobile : le nom accessible vient de l'aria-label */}
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            aria-label={syncing ? 'Synchronisation en cours' : 'Synchroniser les avis'}
            aria-busy={syncing}
            className="btn-secondary"
          >
            <RefreshCw className={syncing ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
            <span className="hidden sm:inline" aria-hidden="true">{syncing ? 'Synchronisation…' : 'Synchroniser'}</span>
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
            <p>Chargement des avis…</p>
          </div>
        ) : (
          <>
            {/* Chiffres clés : une carte, quatre colonnes séparées par un trait (2 × 2 sur téléphone) */}
            <CarteChiffres label="Chiffres des avis" colonnes={{ base: 2, sm: 4 }} chiffres={[
              {
                label: 'Note moyenne',
                valeur: stats?.note_moyenne != null
                  ? <>{fmtNote.format(stats.note_moyenne)}<span className="text-sm font-medium text-slate-500">/5</span></>
                  : '—',
              },
              { label: 'Total avis', valeur: stats?.total || 0 },
              { label: 'Non répondus', valeur: stats?.non_repondus || 0 },
              {
                label: 'Taux de réponse',
                valeur: stats?.taux_reponse != null ? fmtTaux.format(Number(stats.taux_reponse) / 100) : '—',
              },
            ]} />

            {/* Fonctionnement : une phrase, pas un bandeau */}
            <p className="t-small text-slate-600">
              Générez une réponse avec l’IA, modifiez-la si besoin, puis « Approuver et publier » : la réponse est
              copiée et Google s’ouvre pour la coller.
            </p>

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
                      {/* Avatar neutre : la note se lit dans les étoiles */}
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 bg-slate-100 text-slate-700"
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
                      <p className="mt-3 text-sm text-slate-700 leading-relaxed">
                        « {item.texte} »
                      </p>
                    )}

                    {/* Actions pour avis non répondu */}
                    {!item.repondu && (
                      <div className="mt-4">
                        {/* Bouton générer si pas encore de suggestion */}
                        {!item.ia_suggestion && (
                          <button
                            type="button"
                            onClick={() => handleGenerate(item.id)}
                            disabled={generatingId === item.id}
                            aria-busy={generatingId === item.id || undefined}
                            className="btn-secondary"
                          >
                            {generatingId === item.id
                              ? 'Génération en cours…'
                              : 'Générer une réponse IA'}
                          </button>
                        )}

                        {/* Bloc suggestion IA */}
                        {item.ia_suggestion && (
                          <div className="card-section mt-3">
                            <p className="t-h3 mb-2">Réponse IA suggérée</p>
                            <p className="text-sm text-slate-700 leading-relaxed">
                              {item.ia_suggestion}
                            </p>

                            {/* Boutons d'action */}
                            <div className="flex flex-wrap gap-2 mt-3">
                              <button
                                type="button"
                                onClick={async () => {
                                  await handleCopy(item.ia_suggestion, `approve-${item.id}`);
                                  await handleApprove(item.id, item.ia_suggestion);
                                  openGoogleReviews();
                                }}
                                className="btn-primary btn-sm"
                              >
                                {copiedId === `approve-${item.id}` ? (
                                  <><Check /> Copié, ouverture de Google…</>
                                ) : (
                                  <><Send /> Approuver et publier</>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEdit(item.id, item.ia_suggestion)}
                                className="btn-secondary btn-sm"
                              >
                                <Edit3 />
                                Modifier
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRegenerate(item.id)}
                                disabled={generatingId === item.id}
                                aria-busy={generatingId === item.id || undefined}
                                className="btn-ghost btn-sm"
                              >
                                <RotateCcw
                                  className={generatingId === item.id ? 'motion-safe:animate-spin' : ''}
                                />
                                Régénérer
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCopy(item.ia_suggestion, `copy-${item.id}`)}
                                className="btn-ghost btn-sm"
                              >
                                {copiedId === `copy-${item.id}` ? (
                                  <><Check className="text-emerald-700" /> Copié</>
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
                          <span className="t-h3 text-slate-700">
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
                            type="button"
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
                            type="button"
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
                          placeholder="Modifier la réponse…"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(item.id)}
                            className="btn-secondary"
                          >
                            Enregistrer la réponse
                          </button>
                          <button
                            type="button"
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
