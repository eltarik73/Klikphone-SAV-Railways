import { useState, useEffect } from 'react';
import api from '../lib/api';
import {
  Settings, Save, Users, Plus, Trash2, Edit3, X,
  Key, Bell, Printer, Store, Check, Loader2,
} from 'lucide-react';

export default function ConfigPage() {
  const [config, setConfig] = useState({});
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  // Team form
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [teamForm, setTeamForm] = useState({ nom: '', role: 'tech', pin: '', actif: true });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [configData, teamData] = await Promise.all([
        api.getConfig(),
        api.getTeam(),
      ]);
      const configMap = {};
      if (Array.isArray(configData)) {
        configData.forEach(c => { configMap[c.cle] = c.valeur; });
      } else {
        Object.assign(configMap, configData);
      }
      setConfig(configMap);
      setTeam(teamData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      await api.setParams(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (key, value) => {
    setConfig(c => ({ ...c, [key]: value }));
  };

  const resetTeamForm = () => {
    setTeamForm({ nom: '', role: 'tech', pin: '', actif: true });
    setEditingMember(null);
    setShowTeamForm(false);
  };

  const handleSaveTeamMember = async () => {
    try {
      if (editingMember) {
        await api.updateTeamMember(editingMember.id, teamForm);
      } else {
        await api.createTeamMember(teamForm);
      }
      resetTeamForm();
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleEditMember = (member) => {
    setEditingMember(member);
    setTeamForm({
      nom: member.nom || '',
      role: member.role || 'tech',
      pin: member.pin || '',
      actif: member.actif !== false,
    });
    setShowTeamForm(true);
  };

  const handleDeleteMember = async (id) => {
    if (!confirm('Supprimer ce membre ?')) return;
    try {
      await api.deleteTeamMember(id);
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const tabs = [
    { id: 'general', label: 'Général', icon: Store },
    { id: 'team', label: 'Équipe', icon: Users },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'print', label: 'Impression', icon: Printer },
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight">Configuration</h1>
          <p className="text-sm text-slate-500 mt-0.5">Paramètres de l'application</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto scrollbar-none">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all
              ${activeTab === id
                ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/25'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* General tab */}
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
                <input value={config.tva || ''} onChange={e => updateConfig('tva', e.target.value)} className="input" placeholder="Ex: 20%" />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSaveConfig} disabled={saving} className={`btn-primary ${saved ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saved ? 'Enregistré !' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      {/* Team tab */}
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
                  </select>
                </div>
                <div>
                  <label className="input-label">Code PIN</label>
                  <input type="text" value={teamForm.pin} onChange={e => setTeamForm(f => ({ ...f, pin: e.target.value }))}
                    className="input font-mono text-center tracking-widest" maxLength={4} placeholder="0000" />
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
                <button onClick={handleSaveTeamMember} disabled={!teamForm.nom} className="btn-primary">
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
                    <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                      <span className="text-brand-700 font-bold text-sm">
                        {(member.nom?.[0] || '').toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-800">{member.nom}</p>
                        {!member.actif && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-400">Inactif</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 capitalize">{member.role}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {member.pin && (
                        <span className="text-xs font-mono text-slate-400 mr-2">
                          <Key className="w-3 h-3 inline mr-0.5" />{member.pin}
                        </span>
                      )}
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
        </div>
      )}

      {/* Notifications tab */}
      {activeTab === 'notifications' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Discord Webhook</h2>
            <div>
              <label className="input-label">URL du webhook</label>
              <input value={config.discord_webhook || ''} onChange={e => updateConfig('discord_webhook', e.target.value)}
                className="input font-mono text-xs" placeholder="https://discord.com/api/webhooks/..." />
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Email SMTP</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">Serveur SMTP</label>
                <input value={config.smtp_host || ''} onChange={e => updateConfig('smtp_host', e.target.value)} className="input" placeholder="smtp.gmail.com" />
              </div>
              <div>
                <label className="input-label">Port</label>
                <input value={config.smtp_port || ''} onChange={e => updateConfig('smtp_port', e.target.value)} className="input" placeholder="587" />
              </div>
              <div>
                <label className="input-label">Email expéditeur</label>
                <input value={config.smtp_user || ''} onChange={e => updateConfig('smtp_user', e.target.value)} className="input" />
              </div>
              <div>
                <label className="input-label">Mot de passe</label>
                <input type="password" value={config.smtp_password || ''} onChange={e => updateConfig('smtp_password', e.target.value)} className="input" />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSaveConfig} disabled={saving} className={`btn-primary ${saved ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saved ? 'Enregistré !' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      {/* Print tab */}
      {activeTab === 'print' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Paramètres d'impression</h2>
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

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Caisse enregistreuse</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="input-label">URL API Caisse</label>
                <input value={config.caisse_url || ''} onChange={e => updateConfig('caisse_url', e.target.value)}
                  className="input font-mono text-xs" placeholder="https://app.caisse-enregistreuse.fr/api/..." />
              </div>
              <div>
                <label className="input-label">Token API</label>
                <input type="password" value={config.caisse_token || ''} onChange={e => updateConfig('caisse_token', e.target.value)}
                  className="input" />
              </div>
              <div>
                <label className="input-label">ID Boutique</label>
                <input value={config.caisse_shop_id || ''} onChange={e => updateConfig('caisse_shop_id', e.target.value)}
                  className="input font-mono" />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSaveConfig} disabled={saving} className={`btn-primary ${saved ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saved ? 'Enregistré !' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
