import { useState, useEffect } from 'react';
import { Star, MessageSquare, Clock, CheckCircle, RefreshCw, Sparkles, Send, Edit3, RotateCcw, TrendingUp } from 'lucide-react';
import api from '../lib/api';

// ─── Helpers ────────────────────────────────────

function StarRating({ note }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={`w-3.5 h-3.5 ${i <= note ? 'text-amber-400 fill-amber-400' : 'text-zinc-200'}`}
        />
      ))}
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
  const [avis, setAvis] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [generatingId, setGeneratingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [a, s] = await Promise.all([
        api.getAvisGoogle(),
        api.getAvisGoogleStats(),
      ]);
      setAvis(a);
      setStats(s);
    } catch (e) {
      console.error('Erreur chargement avis:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await api.syncAvisGoogle();
      await loadData();
    } catch (e) {
      console.error('Erreur synchronisation:', e);
    } finally {
      setSyncing(false);
    }
  }

  async function handleGenerate(id) {
    setGeneratingId(id);
    try {
      const result = await api.genererReponseAvis(id);
      setAvis(prev =>
        prev.map(a =>
          a.id === id
            ? { ...a, ia_suggestion: result.ia_suggestion || result.suggestion || result.reponse }
            : a
        )
      );
    } catch (e) {
      console.error('Erreur génération IA:', e);
    } finally {
      setGeneratingId(null);
    }
  }

  async function handleApprove(id, text) {
    try {
      await api.publierReponseAvis(id, {
        reponse_texte: text,
        reponse_par: localStorage.getItem('kp_user') || 'Accueil',
      });
      await loadData();
    } catch (e) {
      console.error('Erreur publication:', e);
    }
  }

  function handleEdit(id, currentText) {
    setEditingId(id);
    setEditText(currentText || '');
  }

  async function handleSaveEdit(id) {
    try {
      await api.updateReponseAvis(id, { reponse_texte: editText });
      setEditingId(null);
      setEditText('');
      await loadData();
    } catch (e) {
      console.error('Erreur mise à jour:', e);
    }
  }

  function handleRegenerate(id) {
    handleGenerate(id);
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
    <div className="min-h-screen bg-zinc-50 pb-20">
      {/* Header sticky */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                <Star className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-zinc-900">Avis Google</h1>
                <p className="text-xs text-zinc-500">
                  {stats
                    ? `${stats.total || 0} avis · Note moyenne ${stats.note_moyenne?.toFixed(1) || '—'}/5`
                    : 'Chargement...'}
                </p>
              </div>
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{syncing ? 'Synchronisation...' : 'Synchroniser'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Contenu */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
            <p className="mt-4 text-sm text-zinc-500">Chargement des avis...</p>
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {/* Note moyenne */}
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 relative overflow-hidden">
                <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                  <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                </div>
                <p className="text-2xl font-extrabold text-zinc-900">
                  {stats?.note_moyenne?.toFixed(1) || '—'}<span className="text-sm font-medium text-zinc-400">/5</span>
                </p>
                <p className="text-xs text-zinc-500 mt-1">Note moyenne</p>
              </div>

              {/* Total avis */}
              <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 relative overflow-hidden">
                <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-violet-600" />
                </div>
                <p className="text-2xl font-extrabold text-zinc-900">{stats?.total || 0}</p>
                <p className="text-xs text-zinc-500 mt-1">Total avis</p>
              </div>

              {/* Non répondus */}
              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 relative overflow-hidden">
                <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                  <Clock className="w-4 h-4 text-orange-500" />
                </div>
                <p className="text-2xl font-extrabold text-zinc-900">{stats?.non_repondus || 0}</p>
                <p className="text-xs text-zinc-500 mt-1">Non répondus</p>
              </div>

              {/* Taux de réponse */}
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 relative overflow-hidden">
                <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                </div>
                <p className="text-2xl font-extrabold text-zinc-900">
                  {stats?.taux_reponse != null ? `${stats.taux_reponse}%` : '—'}
                </p>
                <p className="text-xs text-zinc-500 mt-1">Taux de réponse</p>
              </div>
            </div>

            {/* Filtres */}
            <div className="flex gap-2 overflow-x-auto scrollbar-none pb-0.5">
              {filters.map(f => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                    filter === f.key
                      ? 'bg-zinc-900 text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-zinc-600 hover:bg-zinc-100'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Liste des avis */}
            {filtered.length === 0 ? (
              <div className="text-center py-20">
                <MessageSquare className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
                <p className="text-zinc-500 text-sm">Aucun avis trouvé</p>
                <p className="text-zinc-400 text-xs mt-1">
                  Modifiez vos filtres ou synchronisez les avis
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filtered.map(item => (
                  <div
                    key={item.id}
                    className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5"
                  >
                    {/* En-tête de l'avis */}
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 ${
                          item.note >= 4
                            ? 'bg-gradient-to-br from-violet-500 to-purple-600'
                            : 'bg-gradient-to-br from-orange-400 to-red-500'
                        }`}
                      >
                        {getInitiales(item.auteur)}
                      </div>

                      {/* Infos */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm text-zinc-900">
                            {item.auteur || 'Anonyme'}
                          </span>
                          <StarRating note={item.note} />
                          <span className="text-xs text-zinc-400">
                            {formatDate(item.date)}
                          </span>
                        </div>

                        {/* Badge statut */}
                        <div className="mt-1">
                          {item.repondu ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle className="w-3 h-3" />
                              Répondu
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200">
                              <Clock className="w-3 h-3" />
                              En attente
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Texte de l'avis */}
                    {item.texte && (
                      <p className="mt-3 text-sm text-zinc-700 italic leading-relaxed">
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
                            className="flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-violet-300 text-violet-700 text-sm font-medium hover:bg-violet-50 transition-colors disabled:opacity-50"
                          >
                            <Sparkles
                              className={`w-4 h-4 ${generatingId === item.id ? 'animate-pulse' : ''}`}
                            />
                            {generatingId === item.id
                              ? 'Génération en cours...'
                              : 'Générer réponse IA'}
                          </button>
                        )}

                        {/* Bloc suggestion IA */}
                        {item.ia_suggestion && (
                          <div className="mt-3 rounded-xl bg-purple-50 border-l-4 border-violet-500 p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <Sparkles className="w-4 h-4 text-violet-600" />
                              <span className="text-xs font-semibold text-violet-700">
                                Réponse IA suggérée
                              </span>
                            </div>
                            <p className="text-sm text-zinc-700 leading-relaxed">
                              {item.ia_suggestion}
                            </p>

                            {/* Boutons d'action */}
                            <div className="flex flex-wrap gap-2 mt-3">
                              <button
                                onClick={() => handleApprove(item.id, item.ia_suggestion)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors"
                              >
                                <Send className="w-3.5 h-3.5" />
                                Approuver & Publier
                              </button>
                              <button
                                onClick={() => handleEdit(item.id, item.ia_suggestion)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-violet-300 text-violet-700 text-xs font-medium hover:bg-violet-50 transition-colors"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                Modifier
                              </button>
                              <button
                                onClick={() => handleRegenerate(item.id)}
                                disabled={generatingId === item.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 text-zinc-600 text-xs font-medium hover:bg-zinc-50 transition-colors disabled:opacity-50"
                              >
                                <RotateCcw
                                  className={`w-3.5 h-3.5 ${generatingId === item.id ? 'animate-spin' : ''}`}
                                />
                                Régénérer
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Réponse publiée */}
                    {item.repondu && item.reponse_texte && (
                      <div className="mt-4 rounded-xl bg-green-50 border border-green-200 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle className="w-4 h-4 text-emerald-600" />
                          <span className="text-xs font-semibold text-emerald-700">
                            Réponse publiée
                          </span>
                        </div>
                        <p className="text-sm text-zinc-700 leading-relaxed">
                          {item.reponse_texte}
                        </p>
                        <div className="flex items-center gap-2 mt-2 text-xs text-zinc-400">
                          {item.reponse_date && (
                            <span>{formatDate(item.reponse_date)}</span>
                          )}
                          {item.reponse_par && (
                            <span>· par {item.reponse_par}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Mode édition */}
                    {editingId === item.id && (
                      <div className="mt-4 space-y-3">
                        <textarea
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          rows={4}
                          className="w-full rounded-xl border border-slate-200 bg-zinc-50 p-3 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all resize-none"
                          placeholder="Modifier la réponse..."
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSaveEdit(item.id)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
                          >
                            <Send className="w-3.5 h-3.5" />
                            Sauvegarder
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditText('');
                            }}
                            className="px-4 py-2 rounded-xl border border-zinc-300 text-zinc-600 text-sm font-medium hover:bg-zinc-50 transition-colors"
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
