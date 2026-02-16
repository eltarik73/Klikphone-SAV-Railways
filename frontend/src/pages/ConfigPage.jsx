import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useApi, invalidateCache } from '../hooks/useApi';
import api from '../lib/api';
import { useToast } from '../components/Toast';
import { useSettings } from '../hooks/useSettings';
import {
  Settings, Save, Users, Plus, Trash2, Edit3, X,
  Key, Bell, Printer, Store, Check, Loader2, MessageCircle,
  Database, Download, Upload, Shield, Palette, Star,
  BookOpen, ChevronDown, ChevronRight, AlertTriangle, Monitor,
  Zap, CreditCard, AtSign, Mail, Search, FileText, Package,
} from 'lucide-react';

const COLORS = ['#3B82F6', '#8B5CF6', '#EC4899', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#06B6D4', '#6366F1', '#64748B'];

const DEFAULT_MSG_TEMPLATES = [
  { id: 1, label: "Appareil recu", message: "Bonjour {prenom}, votre {appareil} a bien ete pris en charge sous le numero {code}. Nous vous tiendrons informe de l'avancement. Klikphone 04 79 60 89 22" },
  { id: 2, label: "Diagnostic en cours", message: "Bonjour {prenom}, le diagnostic de votre {appareil} est en cours. Nous reviendrons vers vous rapidement. Klikphone" },
  { id: 3, label: "Devis a valider", message: "Bonjour {prenom}, le devis pour votre {appareil} est de {montant} EUR. Merci de nous confirmer votre accord. Klikphone 04 79 60 89 22" },
  { id: 4, label: "En cours de reparation", message: "Bonjour {prenom}, la reparation de votre {appareil} est en cours. Klikphone" },
  { id: 5, label: "Attente piece", message: "Bonjour {prenom}, nous sommes en attente d'une piece pour votre {appareil}. Nous vous previendrons des reception. Klikphone" },
  { id: 6, label: "Appareil pret", message: "Bonjour {prenom}, votre {appareil} est pret ! Vous pouvez venir le recuperer a la boutique. Montant : {montant} EUR. Klikphone 79 Place Saint Leger, Chambery" },
  { id: 7, label: "Commande arrivee", message: "Bonjour {prenom}, la piece commandee pour votre {appareil} est arrivee. Nous lancons la reparation. Klikphone 04 79 60 89 22" },
  { id: 8, label: "Non reparable", message: "Bonjour {prenom}, malheureusement votre {appareil} n'est pas reparable. Vous pouvez passer recuperer votre appareil en boutique. Klikphone" },
  { id: 9, label: "Rappel RDV", message: "Bonjour {prenom}, nous vous rappelons votre rendez-vous demain pour votre {appareil}. Klikphone 79 Place Saint Leger, Chambery" },
  { id: 10, label: "Personnalise", message: "" },
];

export default function ConfigPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { animations, setAnimations } = useSettings();
  const [config, setConfig] = useState({});
  const [team, setTeam] = useState([]);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  // Team form
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [teamForm, setTeamForm] = useState({ nom: '', role: 'tech', couleur: '#3B82F6', actif: true });
  const [showAdminCodeModal, setShowAdminCodeModal] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [adminCodeError, setAdminCodeError] = useState('');
  const [discordTesting, setDiscordTesting] = useState(false);

  // Message templates
  const [msgTemplates, setMsgTemplates] = useState([]);
  const [msgSaving, setMsgSaving] = useState(false);

  // PIN change
  const [pinForm, setPinForm] = useState({ target: 'accueil', old_pin: '', new_pin: '' });
  const [pinChanging, setPinChanging] = useState(false);

  // Admin password change
  const [adminPwdForm, setAdminPwdForm] = useState({ old_password: '', new_password: '', confirm: '' });
  const [adminPwdChanging, setAdminPwdChanging] = useState(false);
  const [adminPwdError, setAdminPwdError] = useState('');

  // Caisse
  const [caisseConfig, setCaisseConfig] = useState({});
  const [caisseSaving, setCaisseSaving] = useState(false);
  const [caisseTesting, setCaisseTesting] = useState(false);

  // SMTP email test
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpTestEmail, setSmtpTestEmail] = useState('');

  // Track unsaved config changes
  const initialConfigRef = useRef({});
  const hasUnsavedChanges = useCallback(() => {
    const init = initialConfigRef.current;
    return Object.keys(config).some(k => (config[k] || '') !== (init[k] || ''));
  }, [config]);

  // Warn on browser close/reload if unsaved changes
  useEffect(() => {
    const handler = (e) => {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // Catalog
  const [catalog, setCatalog] = useState({ marques: [], modeles: [] });
  const [catalogExpanded, setCatalogExpanded] = useState({});
  const [newMarque, setNewMarque] = useState({ categorie: 'Smartphone', marque: '' });
  const [newModele, setNewModele] = useState({ categorie: 'Smartphone', marque: '', modele: '' });

  const categories = ['Smartphone', 'Tablette', 'PC Portable', 'Console', 'Autre'];

  const { data: configData, loading, mutate: mutateConfig } = useApi(
    'config:main',
    async () => {
      const [configRaw, teamData] = await Promise.all([api.getConfig(), api.getTeam()]);
      const configMap = {};
      if (Array.isArray(configRaw)) {
        configRaw.forEach(c => { configMap[c.cle] = c.valeur; });
      } else {
        Object.assign(configMap, configRaw);
      }
      return { config: configMap, team: teamData };
    },
    { tags: ['config', 'team'], ttl: 300_000 }
  );

  useEffect(() => {
    if (configData) {
      setConfig(configData.config);
      initialConfigRef.current = { ...configData.config };
      setTeam(configData.team);
    }
  }, [configData]);

  const loadCatalog = async () => {
    try {
      const data = await api.getAllCatalog();
      setCatalog(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (activeTab === 'catalog') loadCatalog();
    if (activeTab === 'caisse') {
      api.getCaisseConfig().then(setCaisseConfig).catch(() => {});
    }
    if (activeTab === 'messages') {
      api.getMessageTemplates().then(data => {
        if (data && data.length > 0) setMsgTemplates(data);
        else setMsgTemplates(DEFAULT_MSG_TEMPLATES);
      }).catch(() => setMsgTemplates(DEFAULT_MSG_TEMPLATES));
    }
  }, [activeTab]);

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const params = Object.entries(config).map(([cle, valeur]) => ({ cle, valeur: valeur || '' }));
      await api.setParams(params);
      initialConfigRef.current = { ...config };
      toast.success('Configuration enregistrée');
    } catch (err) {
      toast.error('Erreur sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (key, value) => {
    setConfig(c => ({ ...c, [key]: value }));
  };

  // Team
  const resetTeamForm = () => {
    setTeamForm({ nom: '', role: 'tech', couleur: '#3B82F6', actif: true });
    setEditingMember(null);
    setShowTeamForm(false);
  };

  const handleSaveTeamMember = async (code) => {
    const isManager = teamForm.role === 'manager';
    // If manager role and no admin code provided yet, show modal
    if (isManager && !code) {
      setAdminCode('');
      setAdminCodeError('');
      setShowAdminCodeModal(true);
      return;
    }
    try {
      if (editingMember) {
        await api.updateTeamMember(editingMember.id, teamForm, isManager ? code : undefined);
      } else {
        await api.createTeamMember(teamForm, isManager ? code : undefined);
      }
      resetTeamForm();
      setShowAdminCodeModal(false);
      setAdminCode('');
      invalidateCache('config', 'team');
      toast.success(editingMember ? 'Membre mis à jour' : 'Membre créé');
    } catch (err) {
      if (err.message?.includes('Code administrateur')) {
        setAdminCodeError('Code administrateur incorrect');
      } else {
        toast.error(err.message || 'Erreur');
        setShowAdminCodeModal(false);
      }
    }
  };

  const handleEditMember = (member) => {
    setEditingMember(member);
    setTeamForm({
      nom: member.nom || '',
      role: member.role || 'tech',
      couleur: member.couleur || '#3B82F6',
      actif: member.actif !== 0,
    });
    setShowTeamForm(true);
  };

  const handleDeleteMember = async (id) => {
    if (!confirm('Supprimer ce membre ?')) return;
    try {
      await api.deleteTeamMember(id);
      invalidateCache('config', 'team');
      toast.success('Membre supprimé');
    } catch (err) {
      toast.error('Erreur suppression');
    }
  };

  // PIN
  const handleChangePin = async () => {
    setPinChanging(true);
    try {
      await api.changePin(pinForm.target, pinForm.old_pin, pinForm.new_pin);
      setPinForm({ target: pinForm.target, old_pin: '', new_pin: '' });
      toast.success('PIN modifié');
    } catch (err) {
      toast.error(err.message || 'Erreur changement PIN');
    } finally {
      setPinChanging(false);
    }
  };

  const handleChangeAdminPassword = async () => {
    setAdminPwdError('');
    if (adminPwdForm.new_password !== adminPwdForm.confirm) {
      setAdminPwdError('Les mots de passe ne correspondent pas');
      return;
    }
    if (adminPwdForm.new_password.length < 4) {
      setAdminPwdError('Le mot de passe doit faire au moins 4 caractères');
      return;
    }
    setAdminPwdChanging(true);
    try {
      await api.changeAdminPassword(adminPwdForm.old_password, adminPwdForm.new_password);
      setAdminPwdForm({ old_password: '', new_password: '', confirm: '' });
      toast.success('Mot de passe admin modifié');
    } catch (err) {
      setAdminPwdError(err.message || 'Erreur');
    } finally {
      setAdminPwdChanging(false);
    }
  };

  // Catalog
  const handleAddMarque = async () => {
    if (!newMarque.marque.trim()) return;
    try {
      await api.addMarque(newMarque.categorie, newMarque.marque.trim());
      setNewMarque(f => ({ ...f, marque: '' }));
      await loadCatalog();
      toast.success('Marque ajoutée');
    } catch (err) {
      toast.error('Erreur');
    }
  };

  const handleAddModele = async () => {
    if (!newModele.modele.trim() || !newModele.marque) return;
    try {
      await api.addModele(newModele.categorie, newModele.marque, newModele.modele.trim());
      setNewModele(f => ({ ...f, modele: '' }));
      await loadCatalog();
      toast.success('Modèle ajouté');
    } catch (err) {
      toast.error('Erreur');
    }
  };

  const handleDeleteMarque = async (categorie, marque) => {
    if (!confirm(`Supprimer ${marque} et tous ses modèles ?`)) return;
    try {
      await api.deleteMarque(categorie, marque);
      await loadCatalog();
      toast.success('Marque supprimée');
    } catch (err) {
      toast.error('Erreur');
    }
  };

  const handleDeleteModele = async (categorie, marque, modele) => {
    try {
      await api.deleteModele(categorie, marque, modele);
      await loadCatalog();
      toast.success('Modèle supprimé');
    } catch (err) {
      toast.error('Erreur');
    }
  };

  // Backup
  const handleDownloadBackup = async () => {
    try {
      const data = await api.getBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `klikphone_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Backup téléchargé');
    } catch (err) {
      toast.error('Erreur backup');
    }
  };

  const handleExportCSV = async () => {
    try {
      await api.exportClientsCsv();
      toast.success('Export CSV téléchargé');
    } catch (err) {
      toast.error('Erreur export CSV');
    }
  };

  const handleExportExcel = async () => {
    try {
      await api.exportClientsExcel();
      toast.success('Export Excel téléchargé');
    } catch (err) {
      toast.error('Erreur export Excel');
    }
  };

  const handleImportBackup = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.tables) {
        toast.error('Format de backup invalide');
        return;
      }
      if (!confirm(`Restaurer le backup du ${data.backup_date?.slice(0, 10) || '?'} ? Cela remplacera TOUTES les données actuelles.`)) return;
      const result = await api.importBackup(data);
      const total = Object.values(result.imported).reduce((a, b) => a + b, 0);
      toast.success(`Backup restauré : ${total} enregistrements importés`);
      invalidateCache('config', 'team');
    } catch (err) {
      toast.error(err.message || 'Erreur import backup');
    } finally {
      e.target.value = '';
    }
  };

  const tabs = [
    { id: 'general', label: 'Boutique', icon: Store },
    { id: 'team', label: 'Équipe', icon: Users },
    { id: 'catalog', label: 'Catalogue', icon: BookOpen },
    { id: 'messages', label: 'Messages', icon: MessageCircle },
    { id: 'notifications', label: 'Notifs', icon: Bell },
    { id: 'fidelite', label: 'Fidélité', icon: Star },
    { id: 'caisse', label: 'Caisse', icon: CreditCard },
    { id: 'security', label: 'Sécurité', icon: Shield },
    { id: 'modules', label: 'Modules', icon: Package },
    { id: 'appearance', label: 'Apparence', icon: Monitor },
    { id: 'backup', label: 'Sauvegarde', icon: Database },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight">Configuration</h1>
          <p className="text-sm text-slate-500 mt-0.5">Paramètres de l'application</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-6">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all
              ${activeTab === id
                ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/25'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* Unsaved changes banner */}
      {hasUnsavedChanges() && (activeTab === 'general' || activeTab === 'notifications' || activeTab === 'fidelite') && (
        <div className="flex items-center gap-3 mb-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl animate-in">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800 font-medium flex-1">Modifications non sauvegardées</p>
          <button onClick={handleSaveConfig} disabled={saving} className="btn-primary text-xs px-3 py-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Enregistrer
          </button>
        </div>
      )}

      {/* ═══ General tab ═══ */}
      {activeTab === 'general' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Informations boutique</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="input-label">Nom de la boutique</label>
                <input value={config.nom_boutique || ''} onChange={e => updateConfig('nom_boutique', e.target.value)} className="input" />
              </div>
              <div>
                <label className="input-label">Téléphone</label>
                <input value={config.telephone || ''} onChange={e => updateConfig('telephone', e.target.value)} className="input" />
              </div>
              <div className="sm:col-span-2">
                <label className="input-label">Adresse</label>
                <input value={config.adresse || ''} onChange={e => updateConfig('adresse', e.target.value)} className="input" />
              </div>
              <div>
                <label className="input-label">Email</label>
                <input value={config.email || ''} onChange={e => updateConfig('email', e.target.value)} className="input" />
              </div>
              <div>
                <label className="input-label">Site web</label>
                <input value={config.site_web || ''} onChange={e => updateConfig('site_web', e.target.value)} className="input" />
              </div>
              <div>
                <label className="input-label">SIRET</label>
                <input value={config.siret || ''} onChange={e => updateConfig('siret', e.target.value)} className="input font-mono" />
              </div>
              <div>
                <label className="input-label">TVA</label>
                <select value={config.tva || '20'} onChange={e => updateConfig('tva', e.target.value)} className="input">
                  <option value="0">Sans TVA</option>
                  <option value="20">20%</option>
                  <option value="10">10%</option>
                  <option value="5.5">5.5%</option>
                </select>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Impression</h2>
            <div className="space-y-4">
              <div>
                <label className="input-label">Mentions légales (bas de ticket)</label>
                <textarea value={config.mentions_legales || ''} onChange={e => updateConfig('mentions_legales', e.target.value)}
                  className="input min-h-[80px] resize-none" placeholder="Conditions générales, garantie..." />
              </div>
              <div>
                <label className="input-label">Message personnalisé (ticket client)</label>
                <input value={config.message_ticket || ''} onChange={e => updateConfig('message_ticket', e.target.value)}
                  className="input" placeholder="Merci de votre confiance !" />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSaveConfig} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {/* ═══ Team tab ═══ */}
      {activeTab === 'team' && (
        <div className="space-y-5">
          <div className="flex justify-end">
            <button onClick={() => { resetTeamForm(); setShowTeamForm(true); }} className="btn-primary">
              <Plus className="w-4 h-4" /> Ajouter un membre
            </button>
          </div>

          {showTeamForm && (
            <div className="card p-5 border-brand-200 animate-in">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-800">
                  {editingMember ? 'Modifier le membre' : 'Nouveau membre'}
                </h3>
                <button onClick={resetTeamForm} className="btn-ghost p-1.5">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="input-label">Nom *</label>
                  <input value={teamForm.nom} onChange={e => setTeamForm(f => ({ ...f, nom: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="input-label">Rôle</label>
                  <select value={teamForm.role} onChange={e => setTeamForm(f => ({ ...f, role: e.target.value }))} className="input">
                    <option value="tech">Technicien</option>
                    <option value="accueil">Accueil</option>
                    <option value="admin">Admin</option>
                    <option value="manager">Manager</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Couleur</label>
                  <div className="flex flex-wrap gap-1.5">
                    {COLORS.map(c => (
                      <button key={c} onClick={() => setTeamForm(f => ({ ...f, couleur: c }))}
                        className={`w-7 h-7 rounded-lg border-2 transition-all ${
                          teamForm.couleur === c ? 'border-slate-900 scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={teamForm.actif}
                      onChange={e => setTeamForm(f => ({ ...f, actif: e.target.checked }))}
                      className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                    <span className="text-sm text-slate-700">Actif</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end mt-4 pt-3 border-t border-slate-100">
                <button onClick={() => handleSaveTeamMember()} disabled={!teamForm.nom} className="btn-primary">
                  <Save className="w-4 h-4" /> {editingMember ? 'Mettre à jour' : 'Créer'}
                </button>
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            {team.length === 0 ? (
              <div className="py-12 text-center">
                <Users className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-400">Aucun membre dans l'équipe</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {team.map(member => (
                  <div key={member.id} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: (member.couleur || '#3B82F6') + '20' }}>
                      <span className="font-bold text-sm" style={{ color: member.couleur || '#3B82F6' }}>
                        {(member.nom?.[0] || '').toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-800">{member.nom}</p>
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: member.couleur || '#94A3B8' }} />
                        {!member.actif && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-400">Inactif</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 capitalize">{member.role}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleEditMember(member)} className="btn-ghost p-1.5">
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDeleteMember(member.id)} className="btn-ghost p-1.5">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Admin code modal for Manager role */}
          {showAdminCodeModal && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowAdminCodeModal(false)}>
              <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4 animate-in" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="w-5 h-5 text-amber-500" />
                  <h3 className="text-sm font-bold text-slate-800">Code administrateur requis</h3>
                </div>
                <p className="text-xs text-slate-500 mb-4">Le rôle Manager donne accès aux données financières. Entrez le code administrateur pour continuer.</p>
                <input
                  type="password"
                  value={adminCode}
                  onChange={e => { setAdminCode(e.target.value); setAdminCodeError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleSaveTeamMember(adminCode)}
                  className="input w-full mb-2"
                  placeholder="Code administrateur"
                  autoFocus
                />
                {adminCodeError && (
                  <p className="text-xs text-red-500 mb-3">{adminCodeError}</p>
                )}
                <div className="flex justify-end gap-2 mt-3">
                  <button onClick={() => setShowAdminCodeModal(false)} className="btn-ghost text-sm px-3 py-1.5">
                    Annuler
                  </button>
                  <button onClick={() => handleSaveTeamMember(adminCode)} disabled={!adminCode} className="btn-primary text-sm px-3 py-1.5">
                    Valider
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ Catalog tab ═══ */}
      {activeTab === 'catalog' && (
        <div className="space-y-5">
          {/* Add marque */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Ajouter une marque</h2>
            <div className="flex gap-2">
              <select value={newMarque.categorie} onChange={e => setNewMarque(f => ({ ...f, categorie: e.target.value }))} className="input w-40">
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input value={newMarque.marque} onChange={e => setNewMarque(f => ({ ...f, marque: e.target.value }))}
                className="input flex-1" placeholder="Nom de la marque" onKeyDown={e => e.key === 'Enter' && handleAddMarque()} />
              <button onClick={handleAddMarque} disabled={!newMarque.marque.trim()} className="btn-primary px-3">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Add modele */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Ajouter un modèle</h2>
            <div className="flex gap-2 flex-wrap">
              <select value={newModele.categorie} onChange={e => setNewModele(f => ({ ...f, categorie: e.target.value, marque: '' }))} className="input w-36">
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={newModele.marque} onChange={e => setNewModele(f => ({ ...f, marque: e.target.value }))} className="input w-40">
                <option value="">— Marque —</option>
                {[...new Set(catalog.marques.filter(m => m.categorie === newModele.categorie).map(m => m.marque))].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <input value={newModele.modele} onChange={e => setNewModele(f => ({ ...f, modele: e.target.value }))}
                className="input flex-1" placeholder="Nom du modèle" onKeyDown={e => e.key === 'Enter' && handleAddModele()} />
              <button onClick={handleAddModele} disabled={!newModele.modele.trim() || !newModele.marque} className="btn-primary px-3">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Catalog tree */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-100">
              <span className="table-header">Catalogue ({catalog.marques.length} marques, {catalog.modeles.length} modèles)</span>
            </div>
            {categories.map(cat => {
              const catMarques = [...new Set(catalog.marques.filter(m => m.categorie === cat).map(m => m.marque))];
              if (catMarques.length === 0) return null;
              return (
                <div key={cat}>
                  <button onClick={() => setCatalogExpanded(e => ({ ...e, [cat]: !e[cat] }))}
                    className="w-full flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    {catalogExpanded[cat] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    {cat} <span className="text-xs text-slate-400 font-normal">({catMarques.length})</span>
                  </button>
                  {catalogExpanded[cat] && (
                    <div className="pl-8 pr-5 pb-2">
                      {catMarques.map(marque => {
                        const modeles = catalog.modeles.filter(m => m.categorie === cat && m.marque === marque);
                        return (
                          <div key={marque} className="mb-2">
                            <div className="flex items-center gap-2 py-1">
                              <span className="text-xs font-semibold text-slate-600">{marque}</span>
                              <span className="text-[10px] text-slate-400">({modeles.length} modèles)</span>
                              <button onClick={() => handleDeleteMarque(cat, marque)} className="ml-auto btn-ghost p-1">
                                <Trash2 className="w-3 h-3 text-red-400" />
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1 ml-3">
                              {modeles.map(m => (
                                <span key={m.modele} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-xs text-slate-600">
                                  {m.modele}
                                  <button onClick={() => handleDeleteModele(cat, marque, m.modele)} className="hover:text-red-500">
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ Messages tab ═══ */}
      {activeTab === 'messages' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
              <MessageCircle className="w-4 h-4" /> Messages predefinis
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              Variables disponibles : {'{prenom}'} {'{nom}'} {'{appareil}'} {'{code}'} {'{montant}'} {'{adresse}'} {'{tel_boutique}'} {'{horaires}'}
            </p>
            <div className="space-y-3">
              {msgTemplates.map((tp, i) => (
                <div key={tp.id}>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">{tp.label}</label>
                  <textarea
                    value={tp.message}
                    onChange={e => {
                      const updated = [...msgTemplates];
                      updated[i] = { ...updated[i], message: e.target.value };
                      setMsgTemplates(updated);
                    }}
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                    placeholder={tp.id === 10 ? 'Template libre (le texte sera modifiable)' : 'Message...'}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                onClick={async () => {
                  setMsgSaving(true);
                  try {
                    await api.saveMessageTemplates(msgTemplates);
                    toast.success('Templates sauvegardes');
                  } catch { toast.error('Erreur sauvegarde'); }
                  finally { setMsgSaving(false); }
                }}
                disabled={msgSaving}
                className="btn-primary"
              >
                <Save className="w-4 h-4" /> {msgSaving ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
              <button
                onClick={() => { setMsgTemplates(DEFAULT_MSG_TEMPLATES); toast.success('Templates reinitialises (sauvegarder pour appliquer)'); }}
                className="btn-ghost"
              >
                Reinitialiser
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Notifications tab ═══ */}
      {activeTab === 'notifications' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Discord Webhook</h2>
            <div className="space-y-4">
              <div>
                <label className="input-label">URL du webhook</label>
                <div className="flex gap-2">
                  <input value={config.DISCORD_WEBHOOK || ''} onChange={e => updateConfig('DISCORD_WEBHOOK', e.target.value)}
                    className="input font-mono text-xs flex-1" placeholder="https://discord.com/api/webhooks/..." />
                  <button
                    onClick={async () => {
                      setDiscordTesting(true);
                      try {
                        // Save first to make sure the URL is stored
                        await handleSaveConfig();
                        await api.testDiscord();
                        toast.success('Webhook Discord fonctionnel !');
                      } catch (err) {
                        toast.error(err.message || 'Erreur webhook');
                      } finally {
                        setDiscordTesting(false);
                      }
                    }}
                    disabled={discordTesting || !config.DISCORD_WEBHOOK}
                    className="btn-primary px-3 py-2 text-xs whitespace-nowrap"
                  >
                    {discordTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Tester'}
                  </button>
                </div>
              </div>

              <div>
                <label className="input-label mb-2">Notifications activées</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { key: 'nouveau_ticket', label: 'Nouveau ticket', desc: 'Quand un ticket est créé' },
                    { key: 'changement_statut', label: 'Changement de statut', desc: 'Quand un statut change' },
                    { key: 'reparation_terminee', label: 'Réparation terminée', desc: 'Quand une réparation est finie' },
                    { key: 'accord_client', label: 'Accord client', desc: 'Acceptation ou refus du devis' },
                    { key: 'connexion', label: 'Connexions', desc: 'Connexions / déconnexions' },
                  ].map(n => (
                    <label key={n.key} className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 cursor-pointer transition">
                      <input
                        type="checkbox"
                        checked={(config[`discord_notif_${n.key}`] || '1') !== '0'}
                        onChange={e => updateConfig(`discord_notif_${n.key}`, e.target.checked ? '1' : '0')}
                        className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 mt-0.5"
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-700">{n.label}</p>
                        <p className="text-[10px] text-slate-400">{n.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <AtSign className="w-4 h-4 text-brand-600" /> Email
            </h2>

            <div className="p-3 bg-brand-50 border border-brand-100 rounded-lg mb-4">
              <p className="text-xs font-semibold text-brand-700 mb-1">Resend (recommandé)</p>
              <p className="text-[10px] text-brand-600">Créez un compte gratuit sur resend.com, récupérez votre clé API. 100 emails/jour gratuits.</p>
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className="input-label">Clé API Resend</label>
                <input value={config.RESEND_API_KEY || 're_BxiE1NX2_9qVCBVSvEAHztuFtzc8F38kr'} onChange={e => updateConfig('RESEND_API_KEY', e.target.value)}
                  className="input font-mono text-xs" placeholder="re_xxxxxxxx..." />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="input-label">Email expéditeur</label>
                  <input value={config.SMTP_USER || ''} onChange={e => updateConfig('SMTP_USER', e.target.value)} className="input" placeholder="contact@klikphone.com" />
                  <p className="text-[10px] text-slate-400 mt-0.5">Doit correspondre au domaine vérifié sur Resend</p>
                </div>
                <div>
                  <label className="input-label">Nom affiché</label>
                  <input value={config.SMTP_NAME || ''} onChange={e => updateConfig('SMTP_NAME', e.target.value)} className="input" placeholder="Klikphone" />
                </div>
              </div>
            </div>

            <details className="group">
              <summary className="text-[10px] text-slate-400 cursor-pointer hover:text-slate-600 mb-3">SMTP avancé (fallback si Resend non configuré)</summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="input-label">Serveur SMTP</label>
                  <input value={config.SMTP_HOST || ''} onChange={e => updateConfig('SMTP_HOST', e.target.value)} className="input" placeholder="ex4.mail.ovh.net" />
                </div>
                <div>
                  <label className="input-label">Port</label>
                  <input value={config.SMTP_PORT || ''} onChange={e => updateConfig('SMTP_PORT', e.target.value)} className="input" placeholder="465" />
                </div>
                <div className="sm:col-span-2">
                  <label className="input-label">Mot de passe SMTP</label>
                  <input type="password" value={config.SMTP_PASSWORD || ''} onChange={e => updateConfig('SMTP_PASSWORD', e.target.value)} className="input" />
                </div>
              </div>
            </details>

            <div className="mt-4 pt-4 border-t border-slate-100">
              <label className="input-label mb-1">Envoyer un email de test</label>
              <div className="flex gap-2">
                <input
                  value={smtpTestEmail}
                  onChange={e => setSmtpTestEmail(e.target.value)}
                  className="input flex-1"
                  placeholder="destinataire@email.com"
                  type="email"
                />
                <button
                  onClick={async () => {
                    if (!smtpTestEmail.trim()) { toast.error('Saisissez une adresse email de test'); return; }
                    setSmtpTesting(true);
                    try {
                      await handleSaveConfig();
                      const res = await api.testSmtpEmail(smtpTestEmail.trim());
                      if (res.status === 'ok') toast.success(res.message || 'Email de test envoyé !');
                      else toast.error(res.message || 'Erreur envoi');
                    } catch (err) {
                      toast.error(err.message || 'Erreur test email');
                    } finally {
                      setSmtpTesting(false);
                    }
                  }}
                  disabled={smtpTesting || !smtpTestEmail.trim()}
                  className="btn-primary px-4 text-xs whitespace-nowrap"
                >
                  {smtpTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                  Envoyer un email de test
                </button>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Chat & Assistant IA</h2>
            <div className="space-y-3">
              <div>
                <label className="input-label">Cle API Anthropic</label>
                <input type="password" value={config.ANTHROPIC_API_KEY || ''} onChange={e => updateConfig('ANTHROPIC_API_KEY', e.target.value)}
                  className="input font-mono text-xs" placeholder="sk-ant-..." />
                <p className="text-[10px] text-slate-400 mt-1">Necessaire pour l'assistant IA. Obtenir sur console.anthropic.com</p>
              </div>
              <div>
                <label className="input-label">Modele Claude (optionnel)</label>
                <input value={config.ANTHROPIC_MODEL || ''} onChange={e => updateConfig('ANTHROPIC_MODEL', e.target.value)}
                  className="input text-xs" placeholder="claude-sonnet-4-5-20250929" />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSaveConfig} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {/* ═══ Fidélité & Jeu tab ═══ */}
      {activeTab === 'fidelite' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Programme de fidélité</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-800">Activer le programme fidélité</p>
                  <p className="text-xs text-slate-400 mt-0.5">Les clients cumulent des points sur chaque réparation</p>
                </div>
                <button
                  onClick={() => updateConfig('fidelite_active', (config.fidelite_active || '1') === '1' ? '0' : '1')}
                  className={`relative w-11 h-6 rounded-full transition-colors ${(config.fidelite_active || '1') === '1' ? 'bg-brand-600' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${(config.fidelite_active || '1') === '1' ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Points par euro dépensé</label>
                  <input type="number" value={config.fidelite_points_par_euro || '10'} onChange={e => updateConfig('fidelite_points_par_euro', e.target.value)}
                    className="input" min="1" />
                </div>
                <div>
                  <label className="input-label">Palier film verre trempé (pts)</label>
                  <input type="number" value={config.fidelite_palier_film || '1000'} onChange={e => updateConfig('fidelite_palier_film', e.target.value)}
                    className="input" min="100" step="100" />
                </div>
                <div>
                  <label className="input-label">Palier réduction (pts)</label>
                  <input type="number" value={config.fidelite_palier_reduction || '5000'} onChange={e => updateConfig('fidelite_palier_reduction', e.target.value)}
                    className="input" min="100" step="100" />
                </div>
                <div>
                  <label className="input-label">Montant réduction (€)</label>
                  <input type="number" value={config.fidelite_montant_reduction || '10'} onChange={e => updateConfig('fidelite_montant_reduction', e.target.value)}
                    className="input" min="1" />
                </div>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Jeu de grattage</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-800">Activer le jeu de grattage</p>
                  <p className="text-xs text-slate-400 mt-0.5">Un ticket grattable sur la page de suivi client</p>
                </div>
                <button
                  onClick={() => updateConfig('grattage_actif', (config.grattage_actif || '1') === '1' ? '0' : '1')}
                  className={`relative w-11 h-6 rounded-full transition-colors ${(config.grattage_actif || '1') === '1' ? 'bg-brand-600' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${(config.grattage_actif || '1') === '1' ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              <div>
                <label className="input-label">Fréquence de gain (1 gagnant tous les N tickets)</label>
                <input type="number" value={config.grattage_frequence || '10'} onChange={e => updateConfig('grattage_frequence', e.target.value)}
                  className="input w-40" min="2" />
                <p className="text-[10px] text-slate-400 mt-1">Ex: 10 = en moyenne 1 gagnant sur 10 tickets grattés</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSaveConfig} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {/* ═══ Caisse tab ═══ */}
      {activeTab === 'caisse' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h3 className="font-bold text-sm text-slate-800 mb-4 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-brand-600" /> Caisse Enregistreuse
            </h3>

            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input type="checkbox" checked={caisseConfig.CAISSE_ENABLED === '1'}
                onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_ENABLED: e.target.checked ? '1' : '0' }))}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 w-5 h-5" />
              <span className="text-sm font-semibold text-slate-700">Activer l'intégration Caisse Enregistreuse</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="input-label">Email de connexion</label>
                <input value={caisseConfig.CAISSE_LOGIN || ''} onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_LOGIN: e.target.value }))} className="input" />
              </div>
              <div>
                <label className="input-label">Token API (APIKEY)</label>
                <input value={caisseConfig.CAISSE_APIKEY || ''} onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_APIKEY: e.target.value }))} className="input font-mono text-xs" />
              </div>
              <div>
                <label className="input-label">Mot de passe</label>
                <input type="password" value={caisseConfig.CAISSE_PASSWORD || ''} onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_PASSWORD: e.target.value }))} className="input" />
              </div>
              <div>
                <label className="input-label">ID Boutique (SHOPID)</label>
                <input value={caisseConfig.CAISSE_SHOPID || ''} onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_SHOPID: e.target.value }))} className="input font-mono" />
              </div>
              <div>
                <label className="input-label">ID Carte bancaire</label>
                <input value={caisseConfig.CAISSE_CB_ID || ''} onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_CB_ID: e.target.value }))} className="input font-mono" />
              </div>
              <div>
                <label className="input-label">ID Espèces</label>
                <input value={caisseConfig.CAISSE_ESP_ID || ''} onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_ESP_ID: e.target.value }))} className="input font-mono" />
              </div>
              <div>
                <label className="input-label">ID Caisse (GENERALE)</label>
                <input value={caisseConfig.CAISSE_ID || ''} onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_ID: e.target.value }))} className="input font-mono" />
              </div>
              <div>
                <label className="input-label">ID Utilisateur</label>
                <input value={caisseConfig.CAISSE_USER_ID || ''} onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_USER_ID: e.target.value }))} className="input font-mono" />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={async () => {
                  setCaisseTesting(true);
                  try {
                    await api.saveCaisseConfig(caisseConfig);
                    const res = await api.testCaisseConnexion();
                    if (res.status === 'ok') toast.success(res.message || 'Connexion réussie');
                    else toast.error(res.message || 'Erreur connexion');
                  } catch (err) {
                    toast.error(err.message || 'Erreur test connexion');
                  } finally {
                    setCaisseTesting(false);
                  }
                }}
                disabled={caisseTesting}
                className="btn-secondary"
              >
                {caisseTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Tester la connexion
              </button>
              <button
                onClick={async () => {
                  setCaisseSaving(true);
                  try {
                    await api.saveCaisseConfig(caisseConfig);
                    toast.success('Configuration caisse enregistrée');
                  } catch (err) {
                    toast.error('Erreur sauvegarde');
                  } finally {
                    setCaisseSaving(false);
                  }
                }}
                disabled={caisseSaving}
                className="btn-primary"
              >
                {caisseSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Security tab ═══ */}
      {activeTab === 'security' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Changer le PIN d'accès</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="input-label">Espace</label>
                <select value={pinForm.target} onChange={e => setPinForm(f => ({ ...f, target: e.target.value }))} className="input">
                  <option value="accueil">Accueil</option>
                  <option value="tech">Technicien</option>
                </select>
              </div>
              <div>
                <label className="input-label">Ancien PIN</label>
                <input type="password" value={pinForm.old_pin} onChange={e => setPinForm(f => ({ ...f, old_pin: e.target.value }))}
                  className="input font-mono text-center tracking-widest" maxLength={4} placeholder="····" />
              </div>
              <div>
                <label className="input-label">Nouveau PIN</label>
                <input type="password" value={pinForm.new_pin} onChange={e => setPinForm(f => ({ ...f, new_pin: e.target.value }))}
                  className="input font-mono text-center tracking-widest" maxLength={4} placeholder="····" />
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={handleChangePin}
                disabled={pinChanging || pinForm.old_pin.length !== 4 || pinForm.new_pin.length !== 4}
                className="btn-primary">
                {pinChanging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                Changer le PIN
              </button>
            </div>
          </div>

          {/* Admin password */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
              <Shield className="w-4 h-4 text-red-500" />
              Mot de passe administrateur
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Ce mot de passe protège l'accès à la section Administration (Reporting, Avis, Community, Config).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="input-label">Ancien mot de passe</label>
                <input type="password" value={adminPwdForm.old_password}
                  onChange={e => { setAdminPwdForm(f => ({ ...f, old_password: e.target.value })); setAdminPwdError(''); }}
                  className="input" placeholder="••••••••" />
              </div>
              <div>
                <label className="input-label">Nouveau mot de passe</label>
                <input type="password" value={adminPwdForm.new_password}
                  onChange={e => { setAdminPwdForm(f => ({ ...f, new_password: e.target.value })); setAdminPwdError(''); }}
                  className="input" placeholder="••••••••" />
              </div>
              <div>
                <label className="input-label">Confirmer</label>
                <input type="password" value={adminPwdForm.confirm}
                  onChange={e => { setAdminPwdForm(f => ({ ...f, confirm: e.target.value })); setAdminPwdError(''); }}
                  className="input" placeholder="••••••••" />
              </div>
            </div>
            {adminPwdError && (
              <p className="text-xs text-red-500 mt-2">{adminPwdError}</p>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={handleChangeAdminPassword}
                disabled={adminPwdChanging || !adminPwdForm.old_password || !adminPwdForm.new_password || !adminPwdForm.confirm}
                className="btn-primary">
                {adminPwdChanging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                Changer le mot de passe
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Modules tab ═══ */}
      {activeTab === 'modules' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Modules optionnels</h2>
            <p className="text-xs text-slate-400 mb-4">Activez ou désactivez les modules pour afficher les pages correspondantes dans le menu latéral.</p>

            {/* Module Devis */}
            <div className="flex items-center justify-between py-3 border-t border-slate-100">
              <div>
                <p className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-brand-500" /> Module Devis
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Gestion complète des devis clients avec statuts, impression et conversion en ticket</p>
              </div>
              <button
                onClick={async () => {
                  const newVal = config.MODULE_DEVIS_VISIBLE === 'true' ? 'false' : 'true';
                  setConfig(c => ({ ...c, MODULE_DEVIS_VISIBLE: newVal }));
                  try {
                    await api.setParam('MODULE_DEVIS_VISIBLE', newVal);
                    toast.success(newVal === 'true' ? 'Module Devis activé' : 'Module Devis désactivé');
                  } catch { toast.error('Erreur sauvegarde'); }
                }}
                className={`relative w-11 h-6 rounded-full transition-colors ${config.MODULE_DEVIS_VISIBLE === 'true' ? 'bg-brand-600' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${config.MODULE_DEVIS_VISIBLE === 'true' ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            {/* Module Devis Flash */}
            <div className="flex items-center justify-between py-3 border-t border-slate-100">
              <div>
                <p className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-500" /> Module Devis Flash
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Consultation rapide des prix de réparation et catalogue de téléphones en vente</p>
              </div>
              <button
                onClick={async () => {
                  const newVal = config.MODULE_DEVIS_FLASH_VISIBLE === 'true' ? 'false' : 'true';
                  setConfig(c => ({ ...c, MODULE_DEVIS_FLASH_VISIBLE: newVal }));
                  try {
                    await api.setParam('MODULE_DEVIS_FLASH_VISIBLE', newVal);
                    toast.success(newVal === 'true' ? 'Module Devis Flash activé' : 'Module Devis Flash désactivé');
                  } catch { toast.error('Erreur sauvegarde'); }
                }}
                className={`relative w-11 h-6 rounded-full transition-colors ${config.MODULE_DEVIS_FLASH_VISIBLE === 'true' ? 'bg-amber-500' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${config.MODULE_DEVIS_FLASH_VISIBLE === 'true' ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            <p className="text-[11px] text-slate-400 mt-4 pt-3 border-t border-slate-100">
              Rechargez la page après activation pour voir les changements dans le menu.
            </p>
          </div>
        </div>
      )}

      {/* ═══ Appearance tab ═══ */}
      {activeTab === 'appearance' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Apparence</h2>
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">Activer les animations</p>
                <p className="text-xs text-slate-400 mt-0.5">Transitions, effets de survol, apparitions progressives</p>
              </div>
              <button
                onClick={() => setAnimations(!animations)}
                className={`relative w-11 h-6 rounded-full transition-colors ${animations ? 'bg-brand-600' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${animations ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-2 pt-3 border-t border-slate-100">
              Désactivez les animations pour améliorer la fluidité sur les appareils plus lents.
            </p>

            {/* Autocomplétion toggle */}
            <div className="flex items-center justify-between py-3 mt-3 pt-3 border-t border-slate-100">
              <div>
                <p className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5 text-slate-500" /> Autocomplétion intelligente
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Suggestions dans les formulaires de modification de tickets</p>
              </div>
              <button
                onClick={async () => {
                  const newVal = config.AFFICHER_AUTOCOMPLETION === 'false' ? 'true' : 'false';
                  setConfig(c => ({ ...c, AFFICHER_AUTOCOMPLETION: newVal }));
                  try {
                    await api.setParam('AFFICHER_AUTOCOMPLETION', newVal);
                    toast.success(newVal === 'true' ? 'Autocomplétion activée' : 'Autocomplétion désactivée');
                  } catch { toast.error('Erreur sauvegarde'); }
                }}
                className={`relative w-11 h-6 rounded-full transition-colors ${config.AFFICHER_AUTOCOMPLETION !== 'false' ? 'bg-brand-600' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${config.AFFICHER_AUTOCOMPLETION !== 'false' ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              L'apprentissage continue en arrière-plan même si l'affichage est désactivé.
            </p>
          </div>
        </div>
      )}

      {/* ═══ Backup tab ═══ */}
      {activeTab === 'backup' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Export clients</h2>
            <p className="text-sm text-slate-500 mb-3">Téléchargez la liste de tous les clients (avec nombre de tickets).</p>
            <div className="flex gap-2">
              <button onClick={handleExportCSV} className="btn-primary">
                <Download className="w-4 h-4" /> CSV
              </button>
              <button onClick={handleExportExcel} className="btn-primary">
                <Download className="w-4 h-4" /> Excel (.xlsx)
              </button>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Sauvegarde complète</h2>
            <p className="text-sm text-slate-500 mb-3">
              Téléchargez un backup JSON complet de la base de données (clients, tickets, config, équipe, catalogue).
            </p>
            <div className="flex gap-2">
              <button onClick={handleDownloadBackup} className="btn-primary">
                <Database className="w-4 h-4" /> Télécharger le backup (JSON)
              </button>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Restaurer un backup</h2>
            <p className="text-sm text-slate-500 mb-3">
              Importez un fichier JSON de backup pour restaurer les données. Attention : cela remplacera toutes les données actuelles.
            </p>
            <label className="btn-primary cursor-pointer inline-flex">
              <Upload className="w-4 h-4" /> Importer un backup (.json)
              <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
