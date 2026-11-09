import { useState, useMemo, useEffect, useRef } from 'react';
import {
  FileText, Calendar, LayoutGrid, BarChart3,
  Instagram, Facebook, Linkedin, Globe, Plus, Send, Clock,
  Trash2, Edit3, Eye, ChevronLeft, ChevronRight,
  Copy, Check, X, Loader2, ImagePlus, Trash, Smartphone,
  Camera, Link2, RefreshCw, AlertTriangle
} from 'lucide-react';
import api from '../lib/api';
import { useApi, invalidateCache } from '../hooks/useApi';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import VentesIphoneStory from '../components/VentesIphoneStory';
import CarteChiffres from '../components/CarteChiffres';

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
    'publié': 'badge-success',
    'programmé': 'badge-info',
    'brouillon': 'badge-neutral',
    'erreur': 'badge-danger',
  };
  const c = config[statut] || config.brouillon;
  return (
    <span className={`badge badge-sm ${c}`}>
      {statut}
    </span>
  );
}

function getWeekDays(startDate) {
  const days = [];
  const start = new Date(startDate);
  // Lundi de la semaine en cours ; le dimanche (getDay() = 0) appartient à la semaine qui finit, pas à la suivante
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

// Jour local AAAA-MM-JJ (toISOString donne le jour UTC : décalé d'un jour autour de minuit à Paris)
function jourLocal(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

// Jour d'un événement du calendrier marketing (l'API renvoie date_evenement)
const jourEvenement = (e) => String(e.date_evenement || e.date_heure || e.date || '').slice(0, 10);

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

const RESEAUX = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  google: 'Google Business',
};
const libelleReseau = (p) => RESEAUX[p] || (p ? p.charAt(0).toUpperCase() + p.slice(1) : 'le réseau');
// Réseaux proposés à la connexion dans « Comptes connectés »
const RESEAUX_CONNECTABLES = ['instagram', 'facebook', 'linkedin'];

function formatDateHeure(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const sansDiese = (tag) => String(tag || '').replace(/^#+/, '');

// Variation en pourcentage (l’API envoie 12 pour 12 %) : « +12 % »
const fmtTendance = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const formatTendance = (v) => fmtTendance.format(Number(v) / 100);

const TYPE_LABELS = {
  promo: 'Promo',
  actualite: 'Actualité',
  conseil: 'Conseil',
  temoignage: 'Témoignage',
  stats: 'Stats',
};

// ─── Main Component ───────────────────────────────────────

export default function CommunityManager() {
  const toast = useToast();
  const confirmation = useConfirmDialog();
  // Routes marketing : rôle admin ET code admin saisi sur ce poste (403 admin_requis sinon)
  const { sensible, adminPrompt } = useAdminElevation();
  const signalerErreur = (err, defaut) => {
    if (err?.code !== 'admin_cancelled') toast.error(err?.message || defaut);
  };

  // Tabs
  const [activeTab, setActiveTab] = useState('posts');

  // Post filters
  const [filterPlateforme, setFilterPlateforme] = useState('');
  const [filterStatut, setFilterStatut] = useState('');

  // Generator
  const [genPlateforme, setGenPlateforme] = useState('instagram');
  const [genType, setGenType] = useState('promo');
  const [genContexte, setGenContexte] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedPost, setGeneratedPost] = useState(null);
  const [genImageUrl, setGenImageUrl] = useState('');
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [genImagePrompt, setGenImagePrompt] = useState('');
  const [iaSecondes, setIaSecondes] = useState(0);
  const generationRef = useRef(null); // génération IA suivie (annulée au démontage)
  const [envoiPhoto, setEnvoiPhoto] = useState(null); // 'gen' ou id du post dont la photo part
  const [connexionEnCours, setConnexionEnCours] = useState(null);

  // Calendar
  const [calendarWeekStart, setCalendarWeekStart] = useState(() => new Date());
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({ titre: '', type: 'post', date: '', heure: '10:00', couleur: '#7C3AED' });

  // Editing / Programming
  const [programmingId, setProgrammingId] = useState(null);
  const [programDate, setProgramDate] = useState('');
  const [programHeure, setProgramHeure] = useState('10:00');
  const [copiedId, setCopiedId] = useState(null);
  const [publishResult, setPublishResult] = useState(null); // {success, message, platforms}
  const [publishing, setPublishing] = useState(null); // post id being published
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editTexte, setEditTexte] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // ─── Data hooks ────────────────────────────────────────────

  const postsKey = activeTab === 'posts' ? `cm:posts:${filterPlateforme}:${filterStatut}` : null;
  const { data: postsData, error: postsError, loading: postsLoading, mutate: mutatePosts } = useApi(
    postsKey,
    async () => {
      const params = {};
      if (filterPlateforme) params.plateforme = filterPlateforme;
      if (filterStatut) params.statut = filterStatut;
      return sensible(() => api.getMarketingPosts(params));
    },
    { tags: ['marketing-posts'], ttl: 120_000 }
  );
  const posts = Array.isArray(postsData) ? postsData : [];

  // Réseaux connectés chez Late (Zernio) : affichés à côté du générateur
  const comptesKey = activeTab === 'posts' ? 'cm:comptes' : null;
  const { data: comptesData, error: comptesError, loading: comptesLoading } = useApi(
    comptesKey,
    () => sensible(() => api.getComptesReseaux()),
    { tags: ['marketing-comptes'], ttl: 300_000 }
  );
  const comptes = Array.isArray(comptesData) ? comptesData : [];
  const connectes = new Set(comptes.filter((c) => c.isActive).map((c) => c.plateforme));

  // Retour de Zernio après une connexion (?connexion=late&connected=instagram&username=…)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connexion') !== 'late') return;
    const reseau = params.get('connected') || params.get('platform');
    if (params.get('error')) {
      toast.error(`Connexion ${libelleReseau(reseau)} non aboutie : ${params.get('error')}`);
    } else {
      const nom = params.get('username');
      toast.success(`${libelleReseau(reseau)} connecté${nom ? ` (@${nom})` : ''}`);
    }
    invalidateCache('marketing-comptes');
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Posts programmés dont l'heure est passée : statut relu chez Late, une fois par visite
  const aActualiser = posts.some((p) => p.statut === 'programmé' && p.date_programmee
    && new Date(p.date_programmee) <= new Date());
  const actualiseRef = useRef(false);
  useEffect(() => {
    if (!aActualiser || actualiseRef.current) return;
    actualiseRef.current = true;
    api.actualiserPostsProgrammes()
      .then((r) => { if (r?.mis_a_jour) invalidateCache('marketing-posts'); })
      .catch(() => {});
  }, [aActualiser]);

  useEffect(() => () => { generationRef.current = null; }, []);

  const calKey = activeTab === 'calendrier' ? `cm:cal:${jourLocal(calendarWeekStart)}` : null;
  const { data: calData, error: calError, loading: calLoading } = useApi(
    calKey,
    async () => {
      const days = getWeekDays(calendarWeekStart);
      const date_debut = jourLocal(days[0]);
      const date_fin = jourLocal(days[6]);
      return sensible(() => api.getCalendrierMarketing({ date_debut, date_fin }));
    },
    { tags: ['marketing-calendar'], ttl: 120_000 }
  );
  const events = Array.isArray(calData) ? calData : [];

  const tplKey = activeTab === 'templates' ? 'cm:templates' : null;
  const { data: tplData, error: tplError, loading: tplLoading } = useApi(
    tplKey,
    () => sensible(() => api.getMarketingTemplates()),
    { tags: ['marketing-templates'], ttl: 300_000 }
  );
  const templates = Array.isArray(tplData) ? tplData : [];

  const analyticsKey = activeTab === 'analytics' ? 'cm:analytics' : null;
  const { data: analyticsData, error: analyticsError, loading: analyticsLoading } = useApi(
    analyticsKey,
    async () => {
      const [overview, postsData] = await sensible(() => Promise.all([
        api.getMarketingAnalytics(),
        api.getMarketingAnalyticsPosts(),
      ]));
      return { analytics: overview || null, analyticsPosts: Array.isArray(postsData) ? postsData : [] };
    },
    { tags: ['marketing-analytics'], ttl: 120_000 }
  );
  const analytics = analyticsData?.analytics ?? null;
  const analyticsPosts = analyticsData?.analyticsPosts ?? [];

  const loading = postsLoading || calLoading || tplLoading || analyticsLoading;
  // Seul l'onglet affiché charge (les autres clés sont nulles) : son erreur, s'il n'a rien à montrer
  const loadError = (!postsData && postsError) || (!calData && calError) || (!tplData && tplError)
    || (!analyticsData && analyticsError) || null;
  const retryLoad = () => invalidateCache('marketing-posts', 'marketing-calendar', 'marketing-templates', 'marketing-analytics');

  // ─── Handlers ───────────────────────────────────────────

  const handleGenerate = async () => {
    if (!genContexte.trim()) return;
    setGenerating(true);
    try {
      const data = await sensible(() => api.genererPost({
        plateforme: genPlateforme,
        type_contenu: genType,
        contexte: genContexte,
      }));
      setGeneratedPost(data);
    } catch (err) {
      signalerErreur(err, 'Génération impossible');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateImage = async () => {
    const prompt = genImagePrompt.trim();
    if (!prompt) return;
    const jeton = {};
    generationRef.current = jeton;
    setGeneratingImage(true);
    setIaSecondes(0);
    try {
      const { job_id: jobId } = await sensible(() => api.genererImage({ prompt }));
      const debut = Date.now();
      let echecs = 0;
      while (generationRef.current === jeton) {
        await new Promise((r) => setTimeout(r, 4000));
        if (generationRef.current !== jeton) return;
        setIaSecondes(Math.round((Date.now() - debut) / 1000));
        let suivi;
        try {
          suivi = await api.suiviGenerationImage(jobId);
          echecs = 0;
        } catch (err) {
          echecs += 1;
          if (echecs >= 3) throw err;
          continue;
        }
        if (suivi.statut === 'termine' && suivi.image_url) {
          setImageLoading(true);
          setGenImageUrl(suivi.image_url);
          return;
        }
        if (suivi.statut === 'erreur') {
          toast.error(suivi.erreur || 'Génération de l’image impossible');
          return;
        }
        if (Date.now() - debut > 8 * 60_000) {
          toast.error('Génération trop longue : réessayez plus tard ou ajoutez votre propre photo.');
          return;
        }
      }
    } catch (err) {
      signalerErreur(err, 'Génération de l’image impossible');
    } finally {
      if (generationRef.current === jeton) {
        generationRef.current = null;
        setGeneratingImage(false);
      }
    }
  };

  const annulerGeneration = () => {
    generationRef.current = null;
    setGeneratingImage(false);
  };

  // Photo choisie sur l'ordinateur ou le téléphone → JPEG prêt pour Instagram (URL publique)
  const televerserPhoto = async (fichier) => {
    if (!fichier) return null;
    if (fichier.type && !fichier.type.startsWith('image/')) {
      toast.error('Choisissez une image (JPEG, PNG ou WebP).');
      return null;
    }
    const data = await sensible(() => api.envoyerPhotoMarketing(fichier));
    return data?.image_url || null;
  };

  const handlePhotoGenerateur = async (e) => {
    const fichier = e.target.files?.[0];
    e.target.value = '';
    if (!fichier) return;
    setEnvoiPhoto('gen');
    try {
      const url = await televerserPhoto(fichier);
      if (url) {
        setImageLoading(true);
        setGenImageUrl(url);
      }
    } catch (err) {
      signalerErreur(err, 'Envoi de la photo impossible');
    } finally {
      setEnvoiPhoto(null);
    }
  };

  const handlePhotoPost = async (post, e) => {
    const fichier = e.target.files?.[0];
    e.target.value = '';
    if (!fichier) return;
    setEnvoiPhoto(post.id);
    try {
      const url = await televerserPhoto(fichier);
      if (url) {
        await sensible(() => api.updateMarketingPost(post.id, { image_url: url }));
        invalidateCache('marketing-posts');
        toast.success('Photo ajoutée au post');
      }
    } catch (err) {
      signalerErreur(err, 'Envoi de la photo impossible');
    } finally {
      setEnvoiPhoto(null);
    }
  };

  const handleConnecter = async (plateforme) => {
    setConnexionEnCours(plateforme);
    try {
      const retour = window.location.pathname.startsWith('/accueil') ? '/accueil/community' : '/tech/community';
      const { url } = await sensible(() => api.getLienConnexionReseau(plateforme, retour));
      window.location.assign(url);
    } catch (err) {
      signalerErreur(err, `Connexion ${libelleReseau(plateforme)} impossible`);
      setConnexionEnCours(null);
    }
  };

  const commencerEdition = (post) => {
    setEditingId(post.id);
    setEditTexte(post.contenu || '');
  };

  const handleSaveEdit = async (post) => {
    if (!editTexte.trim()) return;
    setSavingEdit(true);
    try {
      await sensible(() => api.updateMarketingPost(post.id, { contenu: editTexte }));
      setEditingId(null);
      invalidateCache('marketing-posts');
    } catch (err) {
      signalerErreur(err, 'Enregistrement impossible');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSaveDraft = async (post) => {
    try {
      await sensible(() => api.createMarketingPost({
        titre: post.titre || `Post ${genType}`,
        contenu: post.contenu || '',
        plateforme: post.plateforme || genPlateforme,
        type_contenu: post.type_contenu || genType,
        hashtags: post.hashtags || [],
        image_url: genImageUrl || null,
        statut: 'brouillon',
      }));
      setGeneratedPost(null);
      setGenContexte('');
      setGenImageUrl('');
      setGenImagePrompt('');
      invalidateCache('marketing-posts');
    } catch (err) {
      signalerErreur(err, 'Enregistrement du brouillon impossible');
    }
  };

  const messagePublication = (result) => {
    const reseaux = (result?.platforms_published || []).map(libelleReseau).join(', ') || 'le réseau';
    return result?.warning ? `Publié sur ${reseaux}. ${result.warning}` : `Publié sur ${reseaux}`;
  };

  const handlePublish = async (id) => {
    setPublishing(id);
    setPublishResult(null);
    try {
      const result = await sensible(() => api.publierPost(id));
      setPublishResult({ success: true, message: messagePublication(result), platforms: result.platforms_published || [] });
      invalidateCache('marketing-posts');
    } catch (err) {
      if (err?.code === 'admin_cancelled') return;
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
      const created = await sensible(() => api.createMarketingPost(postData));
      if (created && created.id) {
        try {
          const result = await sensible(() => api.publierPost(created.id));
          setPublishResult({ success: true, message: messagePublication(result), platforms: result.platforms_published || [] });
        } catch (err) {
          if (err?.code === 'admin_cancelled') return;
          // Le post reste en brouillon : on peut corriger (photo, texte) puis republier
          setPublishResult({ success: false, message: `${err?.message || 'Erreur lors de la publication'} — post gardé en brouillon.` });
        }
      }
      setGeneratedPost(null);
      setGenContexte('');
      setGenImageUrl('');
      setGenImagePrompt('');
      invalidateCache('marketing-posts');
    } catch (err) {
      if (err?.code === 'admin_cancelled') return;
      const msg = err?.message || 'Erreur lors de la publication';
      setPublishResult({ success: false, message: msg });
    } finally {
      setPublishing(null);
      setTimeout(() => setPublishResult(null), 6000);
    }
  };

  const handleDelete = (post) => {
    confirmation.demander({
      title: post.titre ? `Supprimer le brouillon « ${post.titre} » ?` : 'Supprimer ce brouillon ?',
      description: 'Le texte et la photo du brouillon seront effacés. Rien n’a été publié.',
      confirmLabel: 'Supprimer le brouillon',
      destructive: true,
      onConfirm: async () => {
        try {
          await sensible(() => api.deleteMarketingPost(post.id));
          invalidateCache('marketing-posts');
        } catch (err) {
          signalerErreur(err, 'Suppression impossible');
        }
      },
    });
  };

  const handleProgrammer = async (id) => {
    if (!programDate) return;
    try {
      await sensible(() => api.programmerPost(id, {
        date_programmee: `${programDate}T${programHeure}:00`,
      }));
      setProgrammingId(null);
      setProgramDate('');
      setProgramHeure('10:00');
      invalidateCache('marketing-posts');
      toast.success(`Publication programmée le ${new Date(`${programDate}T${programHeure}:00`).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`);
    } catch (err) {
      signalerErreur(err, 'Programmation impossible');
    }
  };

  const handleAddEvent = async () => {
    if (!newEvent.titre.trim() || !newEvent.date) return;
    try {
      await sensible(() => api.createCalendrierEvent({
        ...newEvent,
        date_heure: `${newEvent.date}T${newEvent.heure}:00`,
      }));
      setNewEvent({ titre: '', type: 'post', date: '', heure: '10:00', couleur: '#7C3AED' });
      setShowAddEvent(false);
      invalidateCache('marketing-calendar');
    } catch (err) {
      signalerErreur(err, 'Ajout de l’événement impossible');
    }
  };

  const handleDeleteEvent = async (id) => {
    try {
      await sensible(() => api.deleteCalendrierEvent(id));
      invalidateCache('marketing-calendar');
    } catch (err) {
      signalerErreur(err, 'Suppression de l’événement impossible');
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
    { id: 'ventes', label: 'Ventes iPhone', icon: Smartphone },
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
    <div className="loading-inline justify-center w-full py-16" role="status">
      <Loader2 aria-hidden="true" /><span className="sr-only">Chargement…</span>
    </div>
  );

  // ─── RENDER ─────────────────────────────────────────────

  return (
    <div className="page max-w-[1280px]">
      {adminPrompt}
      {confirmation.dialog}
      {/* Header */}
      <div className="page-header mb-0">
        <div>
          <h1 className="page-header-title">Community Manager</h1>
          <p className="page-header-subtitle">Gérez vos réseaux sociaux et votre présence en ligne</p>
        </div>
      </div>
      <div className="scroll-fade-x mb-6">
        <div className="page-tabs" role="tablist" aria-label="Sections">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={`page-tab ${activeTab === id ? 'page-tab-active' : ''}`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden sr-only">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div>
        {loadError && !loading && (
          <div role="alert" className="callout callout-danger items-center flex-wrap mb-6">
            <p className="flex-1 min-w-0">
              {loadError.code === 'admin_cancelled'
                ? 'Code admin requis pour afficher cet onglet.'
                : `Données indisponibles : ${loadError.message || 'erreur du serveur'}`}
            </p>
            <button type="button" onClick={retryLoad}
              className="btn-secondary btn-sm">
              Réessayer
            </button>
          </div>
        )}

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
                  aria-label="Filtrer par plateforme"
                  className="select sm:w-auto"
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
                  aria-label="Filtrer par statut"
                  className="select sm:w-auto"
                >
                  <option value="">Tous les statuts</option>
                  <option value="brouillon">Brouillon</option>
                  <option value="programmé">Programmé</option>
                  <option value="publié">Publié</option>
                  <option value="erreur">Erreur</option>
                </select>
              </div>

              {/* Fonctionnement de la publication : une phrase, pas un bandeau */}
              <p className="t-small text-slate-600">
                Chaque post part directement sur le compte de sa plateforme, via Zernio (ex-Late). Instagram exige
                une photo : ajoutez la vôtre ou générez-en une.
              </p>

              {/* Posts list */}
              {loading ? (
                <Spinner />
              ) : posts.length === 0 ? (
                <div className="empty-state card">
                  <div className="empty-state-icon">
                    <FileText aria-hidden="true" />
                  </div>
                  <p className="t-h2">Aucun post trouvé</p>
                  <p className="t-body text-slate-500">Utilisez le générateur IA pour créer votre premier post</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {posts.map((post) => {
                    const brouillon = post.statut === 'brouillon';
                    const photoManquante = post.plateforme === 'instagram' && !post.image_url;
                    const enEdition = editingId === post.id;
                    const deplie = expandedId === post.id;
                    return (
                    <div
                      key={post.id}
                      className="card p-4"
                    >
                      {/* Top row */}
                      <div className="flex items-center gap-2 mb-2">
                        <PlatformIcon platform={post.plateforme} size={18} />
                        <span className="text-sm font-semibold text-slate-900 flex-1 truncate">
                          {post.titre || 'Sans titre'}
                        </span>
                        <StatusBadge statut={post.statut} />
                      </div>

                      {/* Image + Content preview */}
                      {post.image_url && (
                        <div className="mb-2 rounded-lg overflow-hidden border border-slate-100">
                          <img src={post.image_url} alt="" className={`w-full object-cover ${deplie ? 'max-h-96' : 'h-28'}`} loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
                        </div>
                      )}
                      {brouillon && photoManquante && (
                        <p className="flex items-center gap-1.5 text-sm text-amber-800 mb-2">
                          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                          Photo obligatoire pour Instagram
                        </p>
                      )}
                      {enEdition ? (
                        <div className="mb-3">
                          <label htmlFor={`cm-edit-${post.id}`} className="sr-only">Texte du post</label>
                          <textarea
                            id={`cm-edit-${post.id}`}
                            value={editTexte}
                            onChange={(e) => setEditTexte(e.target.value)}
                            rows={6}
                            className="textarea mb-2"
                          />
                          <div className="flex gap-2">
                            <button type="button" onClick={() => handleSaveEdit(post)}
                              disabled={savingEdit || !editTexte.trim()} aria-busy={savingEdit || undefined} className="btn-secondary btn-sm">
                              {savingEdit ? <Loader2 className="animate-spin" /> : <Check />} Enregistrer
                            </button>
                            <button type="button" onClick={() => setEditingId(null)} className="btn-ghost btn-sm">
                              Annuler
                            </button>
                          </div>
                        </div>
                      ) : post.contenu && (
                        <p className={`text-sm text-slate-600 mb-3 ${deplie ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>{post.contenu}</p>
                      )}

                      {/* Bottom row */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {post.statut === 'programmé' && post.date_programmee ? (
                            <span className="t-caption shrink-0 inline-flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" aria-hidden="true" /> {formatDateHeure(post.date_programmee)}
                            </span>
                          ) : (post.date_publication || post.created_at) && (
                            <span className="t-caption shrink-0">
                              {formatDateFr(post.date_publication || post.created_at)}
                            </span>
                          )}
                          {post.hashtags && post.hashtags.length > 0 && (
                            <div className="flex items-center gap-1.5 overflow-hidden">
                              {(Array.isArray(post.hashtags) ? post.hashtags : []).slice(0, 3).map((tag, i) => (
                                <span key={i} className="t-caption truncate">
                                  #{sansDiese(tag)}
                                </span>
                              ))}
                              {Array.isArray(post.hashtags) && post.hashtags.length > 3 && (
                                <span className="t-caption">+{post.hashtags.length - 3}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(getFullPostText(post), `post-${post.id}`)}
                            className="btn-ghost btn-icon text-slate-500"
                            title="Copier le texte"
                            aria-label="Copier le texte"
                          >
                            {copiedId === `post-${post.id}` ? (
                              <Check className="text-emerald-700" />
                            ) : (
                              <Copy />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedId(deplie ? null : post.id)}
                            className="btn-ghost btn-icon text-slate-500"
                            title={deplie ? 'Réduire' : 'Voir tout le post'}
                            aria-label={deplie ? 'Réduire' : 'Voir tout le post'}
                            aria-expanded={deplie}
                          >
                            <Eye />
                          </button>
                          {brouillon && (
                            <button
                              type="button"
                              onClick={() => (enEdition ? setEditingId(null) : commencerEdition(post))}
                              className="btn-ghost btn-icon text-slate-500"
                              title="Modifier le texte"
                              aria-label="Modifier le texte"
                              aria-pressed={enEdition}
                            >
                              <Edit3 />
                            </button>
                          )}
                          {brouillon && (
                            <button
                              type="button"
                              onClick={() => handleDelete(post)}
                              className="btn-danger-ghost btn-icon text-slate-500 hover:text-red-700"
                              title="Supprimer le brouillon"
                              aria-label="Supprimer le brouillon"
                            >
                              <Trash2 />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Brouillon actions */}
                      {brouillon && (
                        <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => handlePublish(post.id)}
                            disabled={publishing === post.id || photoManquante}
                            title={photoManquante ? 'Ajoutez d’abord une photo' : undefined}
                            aria-busy={publishing === post.id || undefined}
                            className="btn-secondary btn-sm"
                          >
                            {publishing === post.id ? (
                              <><Loader2 className="animate-spin" /> Publication…</>
                            ) : (
                              <><Send /> Publier sur {libelleReseau(post.plateforme)}</>
                            )}
                          </button>
                          <label className={`${photoManquante ? 'btn-secondary' : 'btn-ghost'} btn-sm cursor-pointer focus-within:ring-2 focus-within:ring-brand-500 ${envoiPhoto === post.id ? 'opacity-60 pointer-events-none' : ''}`}>
                            <input
                              type="file"
                              accept="image/*"
                              className="sr-only"
                              onChange={(e) => handlePhotoPost(post, e)}
                              disabled={envoiPhoto === post.id}
                            />
                            {envoiPhoto === post.id ? <Loader2 className="animate-spin" /> : <Camera />}
                            {post.image_url ? 'Changer la photo' : 'Ajouter une photo'}
                          </label>
                          {programmingId === post.id ? (
                            <div className="flex flex-wrap items-center gap-2 flex-1">
                              <input
                                type="date"
                                value={programDate}
                                min={new Date().toLocaleDateString('sv-SE')}
                                onChange={(e) => setProgramDate(e.target.value)}
                                aria-label="Date de publication"
                                className="input w-auto"
                              />
                              <input
                                type="time"
                                value={programHeure}
                                onChange={(e) => setProgramHeure(e.target.value)}
                                aria-label="Heure de publication"
                                className="input w-auto"
                              />
                              <button
                                type="button"
                                onClick={() => handleProgrammer(post.id)}
                                disabled={!programDate || photoManquante}
                                className="btn-secondary btn-sm"
                              >
                                Programmer
                              </button>
                              <button
                                type="button"
                                onClick={() => setProgrammingId(null)}
                                className="btn-ghost btn-sm"
                              >
                                Annuler
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setProgrammingId(post.id)}
                              className="btn-ghost btn-sm"
                            >
                              <Clock /> Programmer
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right column — AI Generator */}
            <div className="lg:col-span-2 space-y-4">
              {/* Comptes connectés (Late / Zernio) */}
              <section className="card card-body" aria-labelledby="cm-comptes-titre">
                <div className="flex items-center gap-2 mb-3">
                  <h2 id="cm-comptes-titre" className="t-h2 flex-1">Comptes connectés</h2>
                  <button
                    type="button"
                    onClick={() => invalidateCache('marketing-comptes')}
                    className="btn-ghost btn-icon text-slate-500"
                    title="Actualiser"
                    aria-label="Actualiser les comptes connectés"
                  >
                    <RefreshCw className={comptesLoading ? 'animate-spin motion-reduce:animate-none' : ''} />
                  </button>
                </div>
                {comptesError && !comptesData ? (
                  <p className="text-sm text-red-700">
                    {comptesError.code === 'admin_cancelled'
                      ? 'Code admin requis pour voir les comptes.'
                      : comptesError.message || 'Comptes indisponibles.'}
                  </p>
                ) : comptesLoading && !comptesData ? (
                  <p className="text-sm text-slate-500" role="status">Chargement…</p>
                ) : (
                  <ul className="space-y-2">
                    {comptes.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 min-h-11">
                        <PlatformIcon platform={c.plateforme} size={18} />
                        <span className="text-sm text-slate-900 flex-1 min-w-0 truncate">
                          <span className="font-semibold">{libelleReseau(c.plateforme)}</span>
                          {c.username && <span className="text-slate-600"> · @{c.username}</span>}
                        </span>
                        <span className={`badge badge-sm ${c.isActive ? 'badge-success' : 'badge-warning'}`}>
                          {c.isActive ? 'Connecté' : 'Inactif'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleConnecter(c.plateforme)}
                          disabled={connexionEnCours === c.plateforme}
                          className="btn-ghost btn-sm text-slate-600"
                          title={`Reconnecter ${libelleReseau(c.plateforme)} (si la publication est refusée)`}
                        >
                          {connexionEnCours === c.plateforme ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                          <span className="sr-only sm:not-sr-only">Reconnecter</span>
                        </button>
                      </li>
                    ))}
                    {RESEAUX_CONNECTABLES.filter((p) => !connectes.has(p)).map((p) => (
                      <li key={p} className="flex items-center gap-2 min-h-11">
                        <PlatformIcon platform={p} size={18} />
                        <span className="text-sm text-slate-600 flex-1">{libelleReseau(p)} non connecté</span>
                        <button
                          type="button"
                          onClick={() => handleConnecter(p)}
                          disabled={connexionEnCours === p}
                          className="btn-secondary btn-sm"
                        >
                          {connexionEnCours === p ? <Loader2 className="animate-spin" /> : <Link2 />}
                          Connecter
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="card card-body">
                <h2 className="t-h2 mb-4">Générer un post</h2>

                {/* Plateforme */}
                <p id="cm-plateforme" className="input-label">Plateforme</p>
                <div className="segmented flex-wrap mb-4" role="group" aria-labelledby="cm-plateforme">
                  {platformButtons.map(({ id, icon: Icon, label }) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={genPlateforme === id}
                      onClick={() => setGenPlateforme(id)}
                      className={`segmented-item ${genPlateforme === id ? 'segmented-item-active' : ''}`}
                      title={label}
                    >
                      <Icon className="w-4 h-4" aria-hidden="true" />
                      <span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                </div>

                {/* Type */}
                <label htmlFor="cm-type" className="input-label">Type de contenu</label>
                <select
                  id="cm-type"
                  value={genType}
                  onChange={(e) => setGenType(e.target.value)}
                  className="select mb-4"
                >
                  <option value="promo">Promo</option>
                  <option value="actualite">Actualité</option>
                  <option value="conseil">Conseil</option>
                  <option value="temoignage">Témoignage</option>
                  <option value="stats">Stats</option>
                </select>

                {/* Contexte */}
                <label htmlFor="cm-contexte" className="input-label">Contexte</label>
                <textarea
                  id="cm-contexte"
                  value={genContexte}
                  onChange={(e) => setGenContexte(e.target.value)}
                  placeholder="Décrivez le contexte du post…"
                  rows={4}
                  className="textarea resize-none mb-4"
                />

                {/* Image */}
                <p id="cm-image-titre" className="input-label">
                  Image <span className="text-slate-500 font-normal">(obligatoire pour Instagram)</span>
                </p>
                <div className="mb-4" aria-labelledby="cm-image-titre" role="group">
                  {!genImageUrl ? (
                    <div className="space-y-2">
                      <label className={`btn-secondary btn-block cursor-pointer focus-within:ring-2 focus-within:ring-brand-500 ${envoiPhoto === 'gen' ? 'opacity-60 pointer-events-none' : ''}`}>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={handlePhotoGenerateur}
                          disabled={envoiPhoto === 'gen'}
                        />
                        {envoiPhoto === 'gen' ? <Loader2 className="animate-spin" /> : <Camera />}
                        {envoiPhoto === 'gen' ? 'Envoi de la photo…' : 'Ajouter une photo'}
                      </label>
                      <p className="t-caption text-center">ou générez une image avec l'IA</p>
                      <label htmlFor="cm-image-prompt" className="sr-only">Description de l'image à générer</label>
                      <textarea
                        id="cm-image-prompt"
                        value={genImagePrompt}
                        onChange={(e) => setGenImagePrompt(e.target.value)}
                        placeholder="Ex : iPhone 15 Pro posé sur un établi de réparation, outils autour"
                        rows={2}
                        className="textarea min-h-[72px] resize-none"
                      />
                      {generatingImage ? (
                        <div className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2" role="status">
                          <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none text-slate-500 shrink-0" aria-hidden="true" />
                          <span className="text-sm text-slate-700 flex-1 tabular-nums">
                            Génération IA… {iaSecondes > 0 ? `${iaSecondes} s` : ''} <span className="text-slate-600">(1 à 6 min)</span>
                          </span>
                          <button type="button" onClick={annulerGeneration} className="btn-ghost btn-sm">
                            Annuler
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={handleGenerateImage}
                          disabled={!genImagePrompt.trim()}
                          className="btn-secondary btn-block"
                        >
                          <ImagePlus /> Générer l'image avec l'IA
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                      {imageLoading && (
                        <div className="w-full h-52 flex flex-col items-center justify-center gap-2 bg-slate-50" role="status">
                          <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none text-slate-500" aria-hidden="true" />
                          <span className="text-sm text-slate-600">Chargement de l'image…</span>
                        </div>
                      )}
                      <img
                        src={genImageUrl}
                        alt="Aperçu de l'image du post"
                        className={`w-full h-52 object-cover ${imageLoading ? 'hidden' : ''}`}
                        onLoad={() => setImageLoading(false)}
                        onError={(e) => { setImageLoading(false); e.target.className = 'hidden'; }}
                      />
                      {!imageLoading && (
                        <div className="absolute bottom-0 inset-x-0 flex gap-1.5 p-2 bg-white/90 border-t border-slate-200">
                          <button
                            type="button"
                            onClick={() => { setGenImageUrl(''); setImageLoading(false); }}
                            className="btn-danger-ghost btn-sm"
                          >
                            <Trash /> Changer d'image
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Generate button */}
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || !genContexte.trim()}
                  aria-busy={generating || undefined}
                  className={`${generatedPost ? 'btn-secondary' : 'btn-primary'} btn-block`}
                >
                  {generating ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Génération en cours…
                    </>
                  ) : (
                    "Générer avec l'IA"
                  )}
                </button>
              </div>

              {/* Generated post preview */}
              {generatedPost && (
                <div className="card card-body">
                  <div className="flex items-center gap-2 mb-3">
                    <PlatformIcon platform={generatedPost.plateforme || genPlateforme} size={18} />
                    <span className="text-sm font-semibold text-slate-900">
                      {generatedPost.titre || 'Post généré'}
                    </span>
                  </div>

                  <p className="text-sm text-slate-700 mb-3 whitespace-pre-wrap">
                    {generatedPost.contenu}
                  </p>

                  {genImageUrl && (
                    <div className="mb-3 rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                      {imageLoading && (
                        <div className="w-full h-32 flex items-center justify-center bg-slate-50" role="status">
                          <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none text-slate-500" aria-hidden="true" />
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
                        <span key={i} className="badge badge-sm badge-neutral">
                          #{sansDiese(tag)}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveDraft(generatedPost)}
                      className="btn-secondary flex-1"
                    >
                      <FileText />
                      Sauvegarder en brouillon
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePublishGenerated(generatedPost)}
                      disabled={publishing === 'gen'}
                      aria-busy={publishing === 'gen' || undefined}
                      className="btn-primary flex-1"
                    >
                      {publishing === 'gen' ? (
                        <><Loader2 className="animate-spin" /> Publication…</>
                      ) : (
                        <><Send /> Publier maintenant</>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(getFullPostText(generatedPost), 'gen-copy')}
                      className="btn-ghost"
                    >
                      {copiedId === 'gen-copy' ? (
                        <><Check className="text-emerald-700" /> Copié</>
                      ) : (
                        <><Copy /> Copier</>
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
            <div className="card flex items-center justify-between px-3 py-2">
              <button
                type="button"
                onClick={goToPrevWeek}
                aria-label="Semaine précédente"
                className="btn-ghost btn-icon"
              >
                <ChevronLeft />
              </button>
              <h2 className="t-h2">
                Semaine du {formatDateLabel(weekDays[0])}
              </h2>
              <button
                type="button"
                onClick={goToNextWeek}
                aria-label="Semaine suivante"
                className="btn-ghost btn-icon"
              >
                <ChevronRight />
              </button>
            </div>

            {loading ? (
              <Spinner />
            ) : (
              <>
                {/* Desktop: 7 columns grid */}
                <div className="hidden md:grid grid-cols-7 gap-2">
                  {weekDays.map((day, idx) => {
                    const dayStr = jourLocal(day);
                    const isToday = jourLocal(new Date()) === dayStr;
                    const dayEvents = events
                      .filter((e) => jourEvenement(e) === dayStr)
                      .sort((a, b) => String(a.heure || '').localeCompare(String(b.heure || '')));

                    return (
                      <div
                        key={idx}
                        className="card min-h-[180px] overflow-hidden"
                        aria-current={isToday ? 'date' : undefined}
                      >
                        {/* Day header */}
                        <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 text-center">
                          <div className="t-caption">
                            {JOURS[idx]}{isToday && <span className="sr-only"> (aujourd’hui)</span>}
                          </div>
                          <div className={`text-lg font-semibold tabular-nums ${isToday ? 'text-brand-700' : 'text-slate-900'}`}>
                            {day.getDate()}
                          </div>
                        </div>

                        {/* Day events */}
                        <div className="p-2 space-y-1.5">
                          {dayEvents.map((event) => (
                            <div
                              key={event.id}
                              className="group relative rounded-lg p-2 pr-9 text-xs bg-slate-50 hover:bg-slate-100 transition-colors duration-150"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: event.couleur || '#7C3AED' }} aria-hidden="true" />
                                <span className="font-semibold text-slate-800 truncate">{event.titre}</span>
                              </div>
                              {(event.heure || event.type) && (
                                <div className="text-slate-600 mt-0.5 tabular-nums">
                                  {event.heure}{event.heure && event.type ? ' · ' : ''}{event.type}
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeleteEvent(event.id)}
                                aria-label={`Supprimer l'événement ${event.titre}`}
                                className="btn-danger-ghost btn-icon btn-sm absolute top-0.5 right-0.5 text-slate-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity duration-150"
                              >
                                <Trash2 />
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
                    const dayStr = jourLocal(day);
                    const isToday = jourLocal(new Date()) === dayStr;
                    const dayEvents = events
                      .filter((e) => jourEvenement(e) === dayStr)
                      .sort((a, b) => String(a.heure || '').localeCompare(String(b.heure || '')));

                    return (
                      <div
                        key={idx}
                        className="card p-3"
                        aria-current={isToday ? 'date' : undefined}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-sm font-semibold ${isToday ? 'text-brand-700' : 'text-slate-900'}`}>
                            {JOURS[idx]} {day.getDate()}
                          </span>
                          {isToday && (
                            <span className="badge badge-sm badge-neutral">
                              Aujourd’hui
                            </span>
                          )}
                        </div>
                        {dayEvents.length === 0 ? (
                          <p className="t-caption">Aucun événement</p>
                        ) : (
                          <div className="space-y-1.5">
                            {dayEvents.map((event) => (
                              <div
                                key={event.id}
                                className="flex items-center justify-between gap-2 rounded-lg p-2 bg-slate-50"
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: event.couleur || '#7C3AED' }} aria-hidden="true" />
                                    <span className="text-sm font-semibold text-slate-800 truncate">{event.titre}</span>
                                  </div>
                                  <div className="text-xs text-slate-600 tabular-nums">{event.heure}{event.heure && event.type ? ' · ' : ''}{event.type}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteEvent(event.id)}
                                  aria-label={`Supprimer l'événement ${event.titre}`}
                                  className="btn-danger-ghost btn-icon text-slate-500 shrink-0"
                                >
                                  <Trash2 />
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
              <div className="card card-body">
                <h3 className="t-h2 mb-4">Ajouter un événement</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="cm-evt-titre" className="input-label">Titre</label>
                    <input
                      id="cm-evt-titre"
                      type="text"
                      value={newEvent.titre}
                      onChange={(e) => setNewEvent({ ...newEvent, titre: e.target.value })}
                      placeholder="Titre de l'événement"
                      className="input"
                    />
                  </div>
                  <div>
                    <label htmlFor="cm-evt-type" className="input-label">Type</label>
                    <select
                      id="cm-evt-type"
                      value={newEvent.type}
                      onChange={(e) => setNewEvent({ ...newEvent, type: e.target.value })}
                      className="select"
                    >
                      <option value="post">Post</option>
                      <option value="story">Story</option>
                      <option value="campagne">Campagne</option>
                      <option value="evenement">Événement</option>
                      <option value="autre">Autre</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="cm-evt-date" className="input-label">Date</label>
                    <input
                      id="cm-evt-date"
                      type="date"
                      value={newEvent.date}
                      onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })}
                      className="input"
                    />
                  </div>
                  <div>
                    <label htmlFor="cm-evt-heure" className="input-label">Heure</label>
                    <input
                      id="cm-evt-heure"
                      type="time"
                      value={newEvent.heure}
                      onChange={(e) => setNewEvent({ ...newEvent, heure: e.target.value })}
                      className="input"
                    />
                  </div>
                  <div>
                    <p id="cm-evt-couleur" className="input-label">Couleur</p>
                    <div className="flex items-center gap-2" role="group" aria-labelledby="cm-evt-couleur">
                      {['#7C3AED', '#2563eb', '#16a34a', '#e11d48', '#ea580c', '#0891b2'].map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setNewEvent({ ...newEvent, couleur: color })}
                          aria-label={`Couleur ${color}`}
                          aria-pressed={newEvent.couleur === color}
                          className={`w-9 h-9 rounded-full border-2 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
                            newEvent.couleur === color ? 'border-slate-900' : 'border-transparent hover:border-slate-300'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowAddEvent(false)}
                    className="btn-ghost"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={handleAddEvent}
                    disabled={!newEvent.titre.trim() || !newEvent.date}
                    className="btn-primary"
                  >
                    Ajouter l’événement
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddEvent(true)}
                className="btn-secondary btn-block border-dashed border-slate-300"
              >
                <Plus /> Ajouter un événement
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
              <div className="empty-state card">
                <div className="empty-state-icon">
                  <LayoutGrid aria-hidden="true" />
                </div>
                <p className="t-h2">Aucun template disponible</p>
                <p className="t-body text-slate-500">Les templates facilitent la création de posts récurrents</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className="card flex flex-col"
                  >
                    <div className="p-4 sm:p-5 flex flex-col flex-1">
                      {/* Nom */}
                      <div className="mb-3">
                        <h3 className="t-h2 truncate">{template.nom}</h3>
                        {template.description && (
                          <p className="text-sm text-slate-600 mt-0.5 line-clamp-2">{template.description}</p>
                        )}
                      </div>

                      {/* Platform badge */}
                      {template.plateforme && (
                        <div className="flex items-center gap-1.5 mb-3">
                          <PlatformIcon platform={template.plateforme} size={16} />
                          <span className="t-caption capitalize">{template.plateforme}</span>
                        </div>
                      )}

                      {/* Content preview */}
                      {template.contenu && (
                        <p className="text-sm text-slate-600 line-clamp-3 mb-3">
                          {template.contenu}
                        </p>
                      )}

                      {/* Default hashtags */}
                      {template.hashtags && template.hashtags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {(Array.isArray(template.hashtags) ? template.hashtags : []).slice(0, 4).map((tag, i) => (
                            <span key={i} className="badge badge-sm badge-neutral">
                              #{sansDiese(tag)}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Use button */}
                      <button
                        type="button"
                        onClick={() => handleUseTemplate(template)}
                        className="btn-secondary btn-block mt-auto"
                      >
                        Utiliser ce modèle
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── TAB: VENTES iPHONE + STORY VIDEO ───────── */}
        {activeTab === 'ventes' && <VentesIphoneStory />}

        {/* ─── TAB: ANALYTICS ─────────────────────────── */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {loading ? (
              <Spinner />
            ) : (
              <>
                {/* Chiffres clés : une carte, trois colonnes séparées par un trait */}
                <CarteChiffres label="Chiffres de l’audience" colonnes={{ base: 1, sm: 3 }} chiffres={[
                  { label: 'Portée totale', valeur: analytics?.portee_totale, tendance: analytics?.portee_trend },
                  { label: 'Interactions', valeur: analytics?.interactions, tendance: analytics?.interactions_trend },
                  { label: 'Nouveaux abonnés', valeur: analytics?.nouveaux_abonnes, tendance: analytics?.abonnes_trend },
                ].map(({ label, valeur, tendance }) => ({
                  label,
                  valeur: valeur?.toLocaleString('fr-FR') ?? '—',
                  variation: tendance != null && (
                    <span className={`text-xs font-medium tabular-nums ${Number(tendance) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {formatTendance(tendance)}
                    </span>
                  ),
                }))} />

                {/* Posts performance table */}
                <div className="card overflow-hidden">
                  <div className="card-header">
                    <h3 className="t-h2">Performance des posts</h3>
                  </div>

                  {analyticsPosts.length === 0 ? (
                    <div className="p-8 text-center">
                      <p className="text-sm text-slate-500">Aucune donnée de performance disponible</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="table">
                        <thead>
                          <tr className="bg-slate-50">
                            <th className="table-header">
                              Post
                            </th>
                            <th className="table-header">
                              Plateforme
                            </th>
                            <th className="table-header">
                              Date
                            </th>
                            <th className="table-header text-right">
                              Vues
                            </th>
                            <th className="table-header text-right">
                              Likes
                            </th>
                            <th className="table-header text-right">
                              Commentaires
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {analyticsPosts.map((post, idx) => (
                            <tr key={post.id || idx} className="table-row">
                              <td>
                                <span className="font-medium text-slate-900 truncate block max-w-[200px]">
                                  {post.titre || 'Sans titre'}
                                </span>
                              </td>
                              <td>
                                <div className="flex items-center gap-1.5">
                                  <PlatformIcon platform={post.plateforme} size={16} />
                                  <span className="text-slate-600 capitalize text-sm">{post.plateforme}</span>
                                </div>
                              </td>
                              <td className="table-cell-muted">
                                {formatDateFr(post.date_publication || post.date_creation)}
                              </td>
                              <td className="table-cell-num">
                                {(post.vues ?? 0).toLocaleString('fr-FR')}
                              </td>
                              <td className="table-cell-num">
                                {(post.likes ?? 0).toLocaleString('fr-FR')}
                              </td>
                              <td className="table-cell-num">
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
        <div role={publishResult.success ? 'status' : 'alert'}
          className={`toast fixed bottom-4 right-4 lg:bottom-20 lg:right-6 z-[60] items-center ${
            publishResult.success ? 'border-l-emerald-600' : 'border-l-red-600'
          }`}>
          {publishResult.success ? (
            <Check className="w-5 h-5 shrink-0 text-emerald-700" aria-hidden="true" />
          ) : (
            <X className="w-5 h-5 shrink-0 text-red-700" aria-hidden="true" />
          )}
          <span className="flex-1 font-medium">{publishResult.message}</span>
          <button
            type="button"
            onClick={() => setPublishResult(null)}
            aria-label="Fermer le message"
            className="btn-ghost btn-icon shrink-0"
          >
            <X />
          </button>
        </div>
      )}
    </div>
  );
}
