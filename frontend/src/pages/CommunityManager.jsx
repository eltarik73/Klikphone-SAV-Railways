import { useState, useEffect, useMemo } from 'react';
import {
  FileText, Sparkles, Calendar, LayoutGrid, BarChart3,
  Instagram, Facebook, Linkedin, Globe, Plus, Send, Clock,
  Trash2, Edit3, Eye, Hash, ChevronLeft, ChevronRight,
  TrendingUp, Users, MousePointerClick, Megaphone,
  Copy, Check, Share2, X, Loader2, ImagePlus, Trash
} from 'lucide-react';
import api from '../lib/api';

// ─── Helpers ──────────────────────────────────────────────

function PlatformIcon({ platform, size = 16 }) {
  const config = {
    google: { icon: Globe, color: '#16a34a' },
    instagram: { icon: Instagram, color: '#e11d48' },
    facebook: { icon: Facebook, color: '#2563eb' },
    linkedin: { icon: Linkedin, color: '#1d4ed8' },
  };
  const c = config[platform] || config.google;
  return <c.icon style={{ color: c.color, width: size, height: size }} />;
}

function StatusBadge({ statut }) {
  const config = {
    'publié': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
    'programmé': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
    'brouillon': { bg: 'bg-zinc-100', text: 'text-zinc-600', border: 'border-zinc-200' },
    'erreur': { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' },
  };
  const c = config[statut] || config.brouillon;
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${c.bg} ${c.text} ${c.border}`}>
      {statut}
    </span>
  );
}

function getWeekDays(startDate) {
  const days = [];
  const start = new Date(startDate);
  start.setDate(start.getDate() - start.getDay() + 1); // Monday
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

function formatDateFr(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateLabel(d) {
  const date = new Date(d);
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const TYPE_LABELS = {
  promo: 'Promo',
  actualite: 'Actualité',
  conseil: 'Conseil',
  temoignage: 'Témoignage',
  stats: 'Stats',
};

// ─── Main Component ───────────────────────────────────────

export default function CommunityManager() {
  // Tabs
  const [activeTab, setActiveTab] = useState('posts');

  // Posts
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterPlateforme, setFilterPlateforme] = useState('');
  const [filterStatut, setFilterStatut] = useState('');

  // Generator
  const [genPlateforme, setGenPlateforme] = useState('google');
  const [genType, setGenType] = useState('promo');
  const [genContexte, setGenContexte] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedPost, setGeneratedPost] = useState(null);
  const [genImageUrl, setGenImageUrl] = useState('');
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);

  // Calendar
  const [events, setEvents] = useState([]);
  const [calendarWeekStart, setCalendarWeekStart] = useState(() => new Date());
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({ titre: '', type: 'post', date: '', heure: '10:00', couleur: '#7C3AED' });

  // Templates
  const [templates, setTemplates] = useState([]);

  // Analytics
  const [analytics, setAnalytics] = useState(null);
  const [analyticsPosts, setAnalyticsPosts] = useState([]);

  // Editing / Programming
  const [programmingId, setProgrammingId] = useState(null);
  const [programDate, setProgramDate] = useState('');
  const [programHeure, setProgramHeure] = useState('10:00');
  const [copiedId, setCopiedId] = useState(null);
  const [publishResult, setPublishResult] = useState(null); // {success, message, platforms}
  const [publishing, setPublishing] = useState(null); // post id being published

  // ─── Loaders ────────────────────────────────────────────

  const loadPosts = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterPlateforme) params.plateforme = filterPlateforme;
      if (filterStatut) params.statut = filterStatut;
      const data = await api.getMarketingPosts(params);
      setPosts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Erreur chargement posts:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadCalendar = async () => {
    setLoading(true);
    try {
      const days = getWeekDays(calendarWeekStart);
      const date_debut = days[0].toISOString().split('T')[0];
      const date_fin = days[6].toISOString().split('T')[0];
      const data = await api.getCalendrierMarketing({ date_debut, date_fin });
      setEvents(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Erreur chargement calendrier:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await api.getMarketingTemplates();
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Erreur chargement templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const [overview, postsData] = await Promise.all([
        api.getMarketingAnalytics(),
        api.getMarketingAnalyticsPosts(),
      ]);
      setAnalytics(overview || null);
      setAnalyticsPosts(Array.isArray(postsData) ? postsData : []);
    } catch (err) {
      console.error('Erreur chargement analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  // ─── Effects ────────────────────────────────────────────

  useEffect(() => {
    if (activeTab === 'posts') loadPosts();
    else if (activeTab === 'calendrier') loadCalendar();
    else if (activeTab === 'templates') loadTemplates();
    else if (activeTab === 'analytics') loadAnalytics();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'posts') loadPosts();
  }, [filterPlateforme, filterStatut]);

  useEffect(() => {
    if (activeTab === 'calendrier') loadCalendar();
  }, [calendarWeekStart]);

  // ─── Handlers ───────────────────────────────────────────

  const handleGenerate = async () => {
    if (!genContexte.trim()) return;
    setGenerating(true);
    try {
      const data = await api.genererPost({
        plateforme: genPlateforme,
        type_contenu: genType,
        contexte: genContexte,
      });
      setGeneratedPost(data);
    } catch (err) {
      console.error('Erreur génération:', err);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateImage = async () => {
    const contexte = generatedPost?.contenu || genContexte;
    if (!contexte.trim()) return;
    setGeneratingImage(true);
    setImageLoading(true);
    try {
      const data = await api.genererImage({ contexte, style: 'professional' });
      if (data.image_url) {
        setGenImageUrl(data.image_url);
      }
    } catch (err) {
      console.error('Erreur génération image:', err);
      setImageLoading(false);
    } finally {
      setGeneratingImage(false);
    }
  };

  const handleSaveDraft = async (post) => {
    try {
      await api.createMarketingPost({
        titre: post.titre || `Post ${genType}`,
        contenu: post.contenu || '',
        plateforme: post.plateforme || genPlateforme,
        type_contenu: post.type_contenu || genType,
        hashtags: post.hashtags || [],
        image_url: genImageUrl || null,
        statut: 'brouillon',
      });
      setGeneratedPost(null);
      setGenContexte('');
      setGenImageUrl('');
      loadPosts();
    } catch (err) {
      console.error('Erreur sauvegarde:', err);
    }
  };

  const handlePublish = async (id) => {
    setPublishing(id);
    setPublishResult(null);
    try {
      const result = await api.publierPost(id);
      const platforms = result.platforms_published || [];
      const warning = result.warning || '';
      const msg = warning
        ? `${warning} (${platforms.join(', ')})`
        : `Publié sur ${platforms.join(', ') || 'les réseaux'}`;
      setPublishResult({ success: true, message: msg, platforms });
      loadPosts();
    } catch (err) {
      console.error('Erreur publication:', err);
      const msg = err?.message || 'Erreur lors de la publication';
      setPublishResult({ success: false, message: msg });
    } finally {
      setPublishing(null);
      setTimeout(() => setPublishResult(null), 6000);
    }
  };

  const handlePublishGenerated = async (post) => {
    setPublishing('gen');
    setPublishResult(null);
    try {
      const postData = {
        titre: post.titre || `Post ${genType}`,
        contenu: post.contenu || '',
        plateforme: post.plateforme || genPlateforme,
        type_contenu: post.type_contenu || genType,
        hashtags: post.hashtags || [],
        image_url: genImageUrl || null,
        statut: 'brouillon',
      };
      const created = await api.createMarketingPost(postData);
      if (created && created.id) {
        const result = await api.publierPost(created.id);
        const platforms = result.platforms_published || [];
        const warning = result.warning || '';
        const msg = warning
          ? `${warning} (${platforms.join(', ')})`
          : `Publié sur ${platforms.join(', ') || 'les réseaux'}`;
        setPublishResult({ success: true, message: msg, platforms });
      }
      setGeneratedPost(null);
      setGenContexte('');
      setGenImageUrl('');
      loadPosts();
    } catch (err) {
      console.error('Erreur publication:', err);
      const msg = err?.message || 'Erreur lors de la publication';
      setPublishResult({ success: false, message: msg });
    } finally {
      setPublishing(null);
      setTimeout(() => setPublishResult(null), 6000);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer ce brouillon ?')) return;
    try {
      await api.deleteMarketingPost(id);
      loadPosts();
    } catch (err) {
      console.error('Erreur suppression:', err);
    }
  };

  const handleProgrammer = async (id) => {
    if (!programDate) return;
    try {
      await api.programmerPost(id, {
        date_programmee: `${programDate}T${programHeure}:00`,
      });
      setProgrammingId(null);
      setProgramDate('');
      setProgramHeure('10:00');
      loadPosts();
    } catch (err) {
      console.error('Erreur programmation:', err);
    }
  };

  const handleAddEvent = async () => {
    if (!newEvent.titre.trim() || !newEvent.date) return;
    try {
      await api.createCalendrierEvent({
        ...newEvent,
        date_heure: `${newEvent.date}T${newEvent.heure}:00`,
      });
      setNewEvent({ titre: '', type: 'post', date: '', heure: '10:00', couleur: '#7C3AED' });
      setShowAddEvent(false);
      loadCalendar();
    } catch (err) {
      console.error('Erreur ajout événement:', err);
    }
  };

  const handleDeleteEvent = async (id) => {
    try {
      await api.deleteCalendrierEvent(id);
      loadCalendar();
    } catch (err) {
      console.error('Erreur suppression événement:', err);
    }
  };

  const handleUseTemplate = (template) => {
    setActiveTab('posts');
    if (template.plateforme) setGenPlateforme(template.plateforme);
    if (template.type_contenu) setGenType(template.type_contenu);
    setGenContexte(template.contenu || template.description || '');
    setGeneratedPost(null);
  };

  // ─── Clipboard & Share ──────────────────────────────────

  async function copyToClipboard(text, id) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
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

  function getFullPostText(post) {
    let text = post.contenu || '';
    const tags = Array.isArray(post.hashtags) ? post.hashtags : [];
    if (tags.length > 0) {
      text += '\n\n' + tags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ');
    }
    return text;
  }

  // Publication passe par Late API côté backend — plus besoin de window.open

  // ─── Calendar navigation ───────────────────────────────

  const weekDays = useMemo(() => getWeekDays(calendarWeekStart), [calendarWeekStart]);

  const goToPrevWeek = () => {
    const d = new Date(calendarWeekStart);
    d.setDate(d.getDate() - 7);
    setCalendarWeekStart(d);
  };

  const goToNextWeek = () => {
    const d = new Date(calendarWeekStart);
    d.setDate(d.getDate() + 7);
    setCalendarWeekStart(d);
  };

  // ─── Tabs config ────────────────────────────────────────

  const tabs = [
    { id: 'posts', label: 'Posts', icon: FileText },
    { id: 'calendrier', label: 'Calendrier', icon: Calendar },
    { id: 'templates', label: 'Templates', icon: LayoutGrid },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  ];

  const platformButtons = [
    { id: 'google', icon: Globe, label: 'Google' },
    { id: 'instagram', icon: Instagram, label: 'Instagram' },
    { id: 'facebook', icon: Facebook, label: 'Facebook' },
    { id: 'linkedin', icon: Linkedin, label: 'LinkedIn' },
  ];

  // ─── Spinner ────────────────────────────────────────────

  const Spinner = () => (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // ─── RENDER ─────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-50 pb-20">
      {/* Header (sticky) */}
      <div className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                <Megaphone className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-zinc-900 tracking-tight">Community Manager</h1>
                <p className="text-sm text-zinc-500">Gérez vos réseaux sociaux et votre présence en ligne</p>
              </div>
            </div>
            <div className="flex items-center gap-1 bg-zinc-100 rounded-xl p-1">
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeTab === id
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-700 hover:bg-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {/* ─── TAB: POSTS ─────────────────────────────── */}
        {activeTab === 'posts' && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Left column — Posts list */}
            <div className="lg:col-span-3 space-y-4">
              {/* Filter row */}
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={filterPlateforme}
                  onChange={(e) => setFilterPlateforme(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                >
                  <option value="">Toutes les plateformes</option>
                  <option value="google">Google</option>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                  <option value="linkedin">LinkedIn</option>
                </select>
                <select
                  value={filterStatut}
                  onChange={(e) => setFilterStatut(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                >
                  <option value="">Tous les statuts</option>
                  <option value="brouillon">Brouillon</option>
                  <option value="programmé">Programmé</option>
                  <option value="publié">Publié</option>
                  <option value="erreur">Erreur</option>
                </select>
              </div>

              {/* Info workflow */}
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-200">
                <Share2 className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-700">
                  <span className="font-semibold">Publication :</span> Quand vous publiez un post, le contenu est copié automatiquement et vous pouvez le coller directement sur la plateforme choisie.
                </p>
              </div>

              {/* Posts list */}
              {loading ? (
                <Spinner />
              ) : posts.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center mx-auto mb-4">
                    <FileText className="w-7 h-7 text-zinc-300" />
                  </div>
                  <p className="text-zinc-500 font-medium">Aucun post trouvé</p>
                  <p className="text-sm text-zinc-400 mt-1">Utilisez le générateur IA pour créer votre premier post</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {posts.map((post) => (
                    <div
                      key={post.id}
                      className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 hover:shadow-md transition-shadow"
                    >
                      {/* Top row */}
                      <div className="flex items-center gap-2 mb-2">
                        <PlatformIcon platform={post.plateforme} size={18} />
                        <span className="text-sm font-semibold text-zinc-900 flex-1 truncate">
                          {post.titre || 'Sans titre'}
                        </span>
                        <StatusBadge statut={post.statut} />
                      </div>

                      {/* Image + Content preview */}
                      {post.image_url && (
                        <div className="mb-2 rounded-lg overflow-hidden border border-slate-100">
                          <img src={post.image_url} alt="" className="w-full h-28 object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
                        </div>
                      )}
                      {post.contenu && (
                        <p className="text-sm text-zinc-600 line-clamp-2 mb-3">{post.contenu}</p>
                      )}

                      {/* Bottom row */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {post.date_creation && (
                            <span className="text-xs text-zinc-400 shrink-0">
                              {formatDateFr(post.date_creation)}
                            </span>
                          )}
                          {post.hashtags && post.hashtags.length > 0 && (
                            <div className="flex items-center gap-1 overflow-hidden">
                              {(Array.isArray(post.hashtags) ? post.hashtags : []).slice(0, 3).map((tag, i) => (
                                <span
                                  key={i}
                                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-100 truncate"
                                >
                                  #{tag}
                                </span>
                              ))}
                              {Array.isArray(post.hashtags) && post.hashtags.length > 3 && (
                                <span className="text-[10px] text-zinc-400">+{post.hashtags.length - 3}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => copyToClipboard(getFullPostText(post), `post-${post.id}`)}
                            className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 transition-colors"
                            title="Copier"
                          >
                            {copiedId === `post-${post.id}` ? (
                              <Check className="w-4 h-4 text-emerald-500" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 transition-colors"
                            title="Voir"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 transition-colors"
                            title="Modifier"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          {post.statut === 'brouillon' && (
                            <button
                              onClick={() => handleDelete(post.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 transition-colors"
                              title="Supprimer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Brouillon actions */}
                      {post.statut === 'brouillon' && (
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
                          <button
                            onClick={() => handlePublish(post.id)}
                            disabled={publishing === post.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 transition-colors disabled:opacity-50"
                          >
                            {publishing === post.id ? (
                              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Publication...</>
                            ) : (
                              <><Send className="w-3.5 h-3.5" /> Publier via Late</>
                            )}
                          </button>
                          {programmingId === post.id ? (
                            <div className="flex items-center gap-2 flex-1">
                              <input
                                type="date"
                                value={programDate}
                                onChange={(e) => setProgramDate(e.target.value)}
                                className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                              />
                              <input
                                type="time"
                                value={programHeure}
                                onChange={(e) => setProgramHeure(e.target.value)}
                                className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                              />
                              <button
                                onClick={() => handleProgrammer(post.id)}
                                className="px-2 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
                              >
                                OK
                              </button>
                              <button
                                onClick={() => setProgrammingId(null)}
                                className="px-2 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-700"
                              >
                                Annuler
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setProgrammingId(post.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100 transition-colors"
                            >
                              <Clock className="w-3.5 h-3.5" /> Programmer
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right column — AI Generator */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-violet-50 rounded-2xl border border-violet-200 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-5 h-5 text-violet-600" />
                  <h2 className="text-base font-bold text-zinc-900">Générer un post</h2>
                </div>

                {/* Plateforme */}
                <label className="block text-xs font-semibold text-zinc-600 mb-2">Plateforme</label>
                <div className="flex items-center gap-2 mb-4">
                  {platformButtons.map(({ id, icon: Icon, label }) => (
                    <button
                      key={id}
                      onClick={() => setGenPlateforme(id)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
                        genPlateforme === id
                          ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                          : 'bg-white text-zinc-600 border-slate-200 hover:border-violet-300'
                      }`}
                      title={label}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                </div>

                {/* Type */}
                <label className="block text-xs font-semibold text-zinc-600 mb-2">Type de contenu</label>
                <select
                  value={genType}
                  onChange={(e) => setGenType(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-zinc-700 mb-4 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                >
                  <option value="promo">Promo</option>
                  <option value="actualite">Actualité</option>
                  <option value="conseil">Conseil</option>
                  <option value="temoignage">Témoignage</option>
                  <option value="stats">Stats</option>
                </select>

                {/* Contexte */}
                <label className="block text-xs font-semibold text-zinc-600 mb-2">Contexte</label>
                <textarea
                  value={genContexte}
                  onChange={(e) => setGenContexte(e.target.value)}
                  placeholder="Décrivez le contexte du post..."
                  rows={4}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-zinc-700 resize-none mb-4 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 placeholder:text-zinc-400"
                />

                {/* Image */}
                <label className="block text-xs font-semibold text-zinc-600 mb-2">
                  Image <span className="text-zinc-400 font-normal">(obligatoire pour Instagram)</span>
                </label>
                <div className="mb-4">
                  {!genImageUrl ? (
                    <div className="flex gap-2">
                      <button
                        onClick={handleGenerateImage}
                        disabled={generatingImage || (!genContexte.trim() && !generatedPost)}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-violet-300 bg-violet-50/50 text-violet-600 text-sm font-semibold hover:bg-violet-100 disabled:opacity-50 transition-colors"
                      >
                        {generatingImage ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> Génération...</>
                        ) : (
                          <><ImagePlus className="w-4 h-4" /> Générer une image IA</>
                        )}
                      </button>
                      <span className="flex items-center text-xs text-zinc-400">ou</span>
                      <input
                        type="url"
                        value={genImageUrl}
                        onChange={(e) => setGenImageUrl(e.target.value)}
                        placeholder="Coller une URL"
                        className="w-40 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 placeholder:text-zinc-400"
                      />
                    </div>
                  ) : (
                    <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-zinc-50">
                      {/* Loading placeholder */}
                      {imageLoading && (
                        <div className="w-full h-40 flex flex-col items-center justify-center gap-2 bg-violet-50">
                          <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
                          <span className="text-xs text-violet-600 font-medium">Chargement de l'image...</span>
                        </div>
                      )}
                      <img
                        src={genImageUrl}
                        alt="Aperçu"
                        className={`w-full h-40 object-cover ${imageLoading ? 'hidden' : ''}`}
                        onLoad={() => setImageLoading(false)}
                        onError={(e) => { setImageLoading(false); e.target.src = ''; e.target.className = 'hidden'; }}
                      />
                      {!imageLoading && (
                        <div className="absolute bottom-0 inset-x-0 flex gap-1.5 p-2 bg-gradient-to-t from-black/60 to-transparent">
                          <button
                            onClick={handleGenerateImage}
                            disabled={generatingImage}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/90 text-zinc-700 text-xs font-semibold hover:bg-white transition-colors"
                          >
                            {generatingImage ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="w-3.5 h-3.5" />
                            )}
                            Régénérer
                          </button>
                          <button
                            onClick={() => { setGenImageUrl(''); setImageLoading(false); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/90 text-red-600 text-xs font-semibold hover:bg-white transition-colors"
                          >
                            <Trash className="w-3.5 h-3.5" /> Supprimer
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Generate button */}
                <button
                  onClick={handleGenerate}
                  disabled={generating || !genContexte.trim()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white font-semibold text-sm hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                  {generating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Génération en cours...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Générer avec l'IA
                    </>
                  )}
                </button>
              </div>

              {/* Generated post preview */}
              {generatedPost && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 animate-in">
                  <div className="flex items-center gap-2 mb-3">
                    <PlatformIcon platform={generatedPost.plateforme || genPlateforme} size={18} />
                    <span className="text-sm font-bold text-zinc-900">
                      {generatedPost.titre || 'Post généré'}
                    </span>
                  </div>

                  <p className="text-sm text-zinc-600 mb-3 whitespace-pre-wrap">
                    {generatedPost.contenu}
                  </p>

                  {genImageUrl && (
                    <div className="mb-3 rounded-xl overflow-hidden border border-slate-200 bg-zinc-50">
                      {imageLoading && (
                        <div className="w-full h-32 flex items-center justify-center bg-violet-50">
                          <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
                        </div>
                      )}
                      <img
                        src={genImageUrl}
                        alt="Image du post"
                        className={`w-full h-32 object-cover ${imageLoading ? 'hidden' : ''}`}
                        onLoad={() => setImageLoading(false)}
                        onError={(e) => { setImageLoading(false); e.target.className = 'hidden'; }}
                      />
                    </div>
                  )}

                  {generatedPost.hashtags && generatedPost.hashtags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {(Array.isArray(generatedPost.hashtags) ? generatedPost.hashtags : []).map((tag, i) => (
                        <span
                          key={i}
                          className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-100"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleSaveDraft(generatedPost)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors"
                    >
                      <FileText className="w-4 h-4" />
                      Sauvegarder en brouillon
                    </button>
                    <button
                      onClick={() => handlePublishGenerated(generatedPost)}
                      disabled={publishing === 'gen'}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                    >
                      {publishing === 'gen' ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Publication...</>
                      ) : (
                        <><Send className="w-4 h-4" /> Publier maintenant</>
                      )}
                    </button>
                    <button
                      onClick={() => copyToClipboard(getFullPostText(generatedPost), 'gen-copy')}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border-2 border-slate-200 text-zinc-600 text-sm font-medium hover:bg-zinc-50 transition-colors"
                    >
                      {copiedId === 'gen-copy' ? (
                        <><Check className="w-4 h-4 text-emerald-500" /> Copié !</>
                      ) : (
                        <><Copy className="w-4 h-4" /> Copier</>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── TAB: CALENDRIER ────────────────────────── */}
        {activeTab === 'calendrier' && (
          <div className="space-y-4">
            {/* Week navigation */}
            <div className="flex items-center justify-between bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-3">
              <button
                onClick={goToPrevWeek}
                className="p-2 rounded-lg hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h2 className="text-sm font-bold text-zinc-900">
                Semaine du {formatDateLabel(weekDays[0])}
              </h2>
              <button
                onClick={goToNextWeek}
                className="p-2 rounded-lg hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700 transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {loading ? (
              <Spinner />
            ) : (
              <>
                {/* Desktop: 7 columns grid */}
                <div className="hidden md:grid grid-cols-7 gap-2">
                  {weekDays.map((day, idx) => {
                    const dayStr = day.toISOString().split('T')[0];
                    const isToday = new Date().toISOString().split('T')[0] === dayStr;
                    const dayEvents = events.filter((e) => {
                      const eDate = (e.date_heure || e.date || '').split('T')[0];
                      return eDate === dayStr;
                    });

                    return (
                      <div
                        key={idx}
                        className={`bg-white rounded-xl border shadow-sm min-h-[180px] ${
                          isToday ? 'border-violet-300 ring-1 ring-violet-100' : 'border-slate-200'
                        }`}
                      >
                        {/* Day header */}
                        <div className={`px-3 py-2 border-b text-center ${
                          isToday ? 'bg-violet-50 border-violet-100' : 'bg-zinc-50 border-slate-100'
                        }`}>
                          <div className="text-xs font-semibold text-zinc-500">{JOURS[idx]}</div>
                          <div className={`text-lg font-bold ${isToday ? 'text-violet-600' : 'text-zinc-900'}`}>
                            {day.getDate()}
                          </div>
                        </div>

                        {/* Day events */}
                        <div className="p-2 space-y-1.5">
                          {dayEvents.map((event) => (
                            <div
                              key={event.id}
                              className="group relative rounded-lg p-2 text-xs bg-zinc-50 hover:bg-zinc-100 transition-colors"
                              style={{ borderLeft: `3px solid ${event.couleur || '#7C3AED'}` }}
                            >
                              <div className="font-semibold text-zinc-800 truncate">{event.titre}</div>
                              {event.heure && (
                                <div className="text-zinc-400 mt-0.5">{event.heure}</div>
                              )}
                              {event.type && (
                                <span className="inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-100">
                                  {event.type}
                                </span>
                              )}
                              <button
                                onClick={() => handleDeleteEvent(event.id)}
                                className="absolute top-1 right-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 text-zinc-400 hover:text-red-500 transition-all"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Mobile: list view */}
                <div className="md:hidden space-y-2">
                  {weekDays.map((day, idx) => {
                    const dayStr = day.toISOString().split('T')[0];
                    const isToday = new Date().toISOString().split('T')[0] === dayStr;
                    const dayEvents = events.filter((e) => {
                      const eDate = (e.date_heure || e.date || '').split('T')[0];
                      return eDate === dayStr;
                    });

                    return (
                      <div
                        key={idx}
                        className={`bg-white rounded-xl border shadow-sm p-3 ${
                          isToday ? 'border-violet-300' : 'border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-sm font-bold ${isToday ? 'text-violet-600' : 'text-zinc-900'}`}>
                            {JOURS[idx]} {day.getDate()}
                          </span>
                          {isToday && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600">
                              Aujourd'hui
                            </span>
                          )}
                        </div>
                        {dayEvents.length === 0 ? (
                          <p className="text-xs text-zinc-400 italic">Aucun événement</p>
                        ) : (
                          <div className="space-y-1.5">
                            {dayEvents.map((event) => (
                              <div
                                key={event.id}
                                className="flex items-center justify-between rounded-lg p-2 bg-zinc-50"
                                style={{ borderLeft: `3px solid ${event.couleur || '#7C3AED'}` }}
                              >
                                <div>
                                  <div className="text-xs font-semibold text-zinc-800">{event.titre}</div>
                                  <div className="text-[10px] text-zinc-400">{event.heure} {event.type && `· ${event.type}`}</div>
                                </div>
                                <button
                                  onClick={() => handleDeleteEvent(event.id)}
                                  className="p-1 rounded hover:bg-red-100 text-zinc-400 hover:text-red-500 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Add event */}
            {showAddEvent ? (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <h3 className="text-sm font-bold text-zinc-900 mb-4">Ajouter un événement</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Titre</label>
                    <input
                      type="text"
                      value={newEvent.titre}
                      onChange={(e) => setNewEvent({ ...newEvent, titre: e.target.value })}
                      placeholder="Titre de l'événement"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Type</label>
                    <select
                      value={newEvent.type}
                      onChange={(e) => setNewEvent({ ...newEvent, type: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                    >
                      <option value="post">Post</option>
                      <option value="story">Story</option>
                      <option value="campagne">Campagne</option>
                      <option value="evenement">Événement</option>
                      <option value="autre">Autre</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Date</label>
                    <input
                      type="date"
                      value={newEvent.date}
                      onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Heure</label>
                    <input
                      type="time"
                      value={newEvent.heure}
                      onChange={(e) => setNewEvent({ ...newEvent, heure: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1">Couleur</label>
                    <div className="flex items-center gap-2">
                      {['#7C3AED', '#2563eb', '#16a34a', '#e11d48', '#ea580c', '#0891b2'].map((color) => (
                        <button
                          key={color}
                          onClick={() => setNewEvent({ ...newEvent, couleur: color })}
                          className={`w-7 h-7 rounded-full border-2 transition-all ${
                            newEvent.couleur === color ? 'border-zinc-900 scale-110' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-4">
                  <button
                    onClick={handleAddEvent}
                    disabled={!newEvent.titre.trim() || !newEvent.date}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Ajouter
                  </button>
                  <button
                    onClick={() => setShowAddEvent(false)}
                    className="px-4 py-2 rounded-xl text-sm text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddEvent(true)}
                className="w-full py-3 rounded-2xl border-2 border-dashed border-slate-300 text-sm font-semibold text-zinc-500 hover:border-violet-400 hover:text-violet-600 hover:bg-violet-50/50 transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> Ajouter un événement
              </button>
            )}
          </div>
        )}

        {/* ─── TAB: TEMPLATES ─────────────────────────── */}
        {activeTab === 'templates' && (
          <div>
            {loading ? (
              <Spinner />
            ) : templates.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
                <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center mx-auto mb-4">
                  <LayoutGrid className="w-7 h-7 text-zinc-300" />
                </div>
                <p className="text-zinc-500 font-medium">Aucun template disponible</p>
                <p className="text-sm text-zinc-400 mt-1">Les templates facilitent la création de posts récurrents</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
                  >
                    {/* Colored accent bar */}
                    <div
                      className="h-1 rounded-t-2xl"
                      style={{ backgroundColor: template.couleur || '#7C3AED' }}
                    />

                    <div className="p-5">
                      {/* Icon + name */}
                      <div className="flex items-start gap-3 mb-3">
                        <span className="text-2xl">{template.icone || '📝'}</span>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-bold text-zinc-900 truncate">{template.nom}</h3>
                          {template.description && (
                            <p className="text-sm text-zinc-500 mt-0.5 line-clamp-2">{template.description}</p>
                          )}
                        </div>
                      </div>

                      {/* Platform badge */}
                      {template.plateforme && (
                        <div className="flex items-center gap-1.5 mb-3">
                          <PlatformIcon platform={template.plateforme} size={14} />
                          <span className="text-xs text-zinc-500 capitalize">{template.plateforme}</span>
                        </div>
                      )}

                      {/* Content preview */}
                      {template.contenu && (
                        <p className="text-xs text-zinc-400 italic line-clamp-3 mb-3">
                          {template.contenu}
                        </p>
                      )}

                      {/* Default hashtags */}
                      {template.hashtags && template.hashtags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {(Array.isArray(template.hashtags) ? template.hashtags : []).slice(0, 4).map((tag, i) => (
                            <span
                              key={i}
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-100"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Use button */}
                      <button
                        onClick={() => handleUseTemplate(template)}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border-2 border-violet-200 text-violet-600 text-sm font-semibold hover:bg-violet-50 hover:border-violet-300 transition-all"
                      >
                        <Sparkles className="w-4 h-4" /> Utiliser
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── TAB: ANALYTICS ─────────────────────────── */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {loading ? (
              <Spinner />
            ) : (
              <>
                {/* KPI cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Portée totale */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                        <TrendingUp className="w-5 h-5 text-violet-600" />
                      </div>
                      {analytics?.portee_trend != null && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          analytics.portee_trend >= 0
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-600'
                        }`}>
                          {analytics.portee_trend >= 0 ? '+' : ''}{analytics.portee_trend}%
                        </span>
                      )}
                    </div>
                    <p className="text-2xl font-bold text-zinc-900">
                      {analytics?.portee_totale?.toLocaleString('fr-FR') ?? '—'}
                    </p>
                    <p className="text-sm text-zinc-500 mt-0.5">Portée totale</p>
                  </div>

                  {/* Interactions */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                        <MousePointerClick className="w-5 h-5 text-emerald-600" />
                      </div>
                      {analytics?.interactions_trend != null && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          analytics.interactions_trend >= 0
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-600'
                        }`}>
                          {analytics.interactions_trend >= 0 ? '+' : ''}{analytics.interactions_trend}%
                        </span>
                      )}
                    </div>
                    <p className="text-2xl font-bold text-zinc-900">
                      {analytics?.interactions?.toLocaleString('fr-FR') ?? '—'}
                    </p>
                    <p className="text-sm text-zinc-500 mt-0.5">Interactions</p>
                  </div>

                  {/* Nouveaux abonnés */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                        <Users className="w-5 h-5 text-blue-600" />
                      </div>
                      {analytics?.abonnes_trend != null && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          analytics.abonnes_trend >= 0
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-600'
                        }`}>
                          {analytics.abonnes_trend >= 0 ? '+' : ''}{analytics.abonnes_trend}%
                        </span>
                      )}
                    </div>
                    <p className="text-2xl font-bold text-zinc-900">
                      {analytics?.nouveaux_abonnes?.toLocaleString('fr-FR') ?? '—'}
                    </p>
                    <p className="text-sm text-zinc-500 mt-0.5">Nouveaux abonnés</p>
                  </div>
                </div>

                {/* Posts performance table */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-zinc-900">Performance des posts</h3>
                  </div>

                  {analyticsPosts.length === 0 ? (
                    <div className="p-8 text-center">
                      <p className="text-sm text-zinc-400">Aucune donnée de performance disponible</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-zinc-50">
                            <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                              Post
                            </th>
                            <th className="text-left px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                              Plateforme
                            </th>
                            <th className="text-left px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                              Date
                            </th>
                            <th className="text-right px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                              Vues
                            </th>
                            <th className="text-right px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                              Likes
                            </th>
                            <th className="text-right px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                              Commentaires
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {analyticsPosts.map((post, idx) => (
                            <tr key={post.id || idx} className="hover:bg-zinc-50/50 transition-colors">
                              <td className="px-5 py-3">
                                <span className="font-medium text-zinc-800 truncate block max-w-[200px]">
                                  {post.titre || 'Sans titre'}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex items-center gap-1.5">
                                  <PlatformIcon platform={post.plateforme} size={14} />
                                  <span className="text-zinc-600 capitalize text-xs">{post.plateforme}</span>
                                </div>
                              </td>
                              <td className="px-3 py-3 text-zinc-500 text-xs">
                                {formatDateFr(post.date_publication || post.date_creation)}
                              </td>
                              <td className="px-3 py-3 text-right text-zinc-800 font-medium">
                                {(post.vues ?? 0).toLocaleString('fr-FR')}
                              </td>
                              <td className="px-3 py-3 text-right text-zinc-800 font-medium">
                                {(post.likes ?? 0).toLocaleString('fr-FR')}
                              </td>
                              <td className="px-5 py-3 text-right text-zinc-800 font-medium">
                                {(post.commentaires ?? 0).toLocaleString('fr-FR')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ─── TOAST PUBLICATION ────────────────────────── */}
      {publishResult && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl text-sm font-semibold transition-all animate-in ${
          publishResult.success
            ? 'bg-emerald-600 text-white'
            : 'bg-red-600 text-white'
        }`}>
          {publishResult.success ? (
            <Check className="w-5 h-5 flex-shrink-0" />
          ) : (
            <X className="w-5 h-5 flex-shrink-0" />
          )}
          <span>{publishResult.message}</span>
          <button
            onClick={() => setPublishResult(null)}
            className="ml-2 p-1 rounded-lg hover:bg-white/20 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
