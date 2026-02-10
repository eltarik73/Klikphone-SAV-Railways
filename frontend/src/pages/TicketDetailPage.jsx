import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import { formatDate, formatPrix, STATUTS, waLink, smsLink, getStatusConfig } from '../lib/utils';
import {
  ArrowLeft, Phone, Mail, MessageCircle, Send, Save, Trash2,
  ChevronDown, Plus, Clock, User, Wrench, CreditCard,
  FileText, ExternalLink,
} from 'lucide-react';

export default function TicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';

  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [editFields, setEditFields] = useState({});

  useEffect(() => { loadTicket(); }, [id]);

  const loadTicket = async () => {
    setLoading(true);
    try {
      const data = await api.getTicket(id);
      setTicket(data);
      setEditFields({
        devis_estime: data.devis_estime || '',
        tarif_final: data.tarif_final || '',
        acompte: data.acompte || '',
        notes_internes: data.notes_internes || '',
        technicien_assigne: data.technicien_assigne || '',
        reparation_supp: data.reparation_supp || '',
        prix_supp: data.prix_supp || '',
        type_ecran: data.type_ecran || '',
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = {};
      for (const [k, v] of Object.entries(editFields)) {
        if (v !== '' && v !== null && v !== undefined) {
          updates[k] = ['devis_estime', 'tarif_final', 'acompte', 'prix_supp'].includes(k)
            ? parseFloat(v) || 0
            : v;
        }
      }
      await api.updateTicket(id, updates);
      await loadTicket();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (statut) => {
    try {
      await api.changeStatus(id, statut);
      await loadTicket();
      setShowStatusMenu(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    try {
      await api.addNote(id, noteText);
      setNoteText('');
      await loadTicket();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-slate-400 font-medium">Ticket non trouvé</p>
        <button onClick={() => navigate(basePath)} className="btn-secondary mt-4">
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>
      </div>
    );
  }

  const t = ticket;
  const appareil = t.modele_autre || `${t.marque || ''} ${t.modele || ''}`.trim();

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2 mt-0.5 shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold font-mono text-brand-600">{t.ticket_code}</h1>
            <StatusBadge statut={t.statut} />
          </div>
          <p className="text-sm text-slate-500 mt-1 truncate">{appareil} — {t.panne}</p>
        </div>

        {/* Status dropdown */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowStatusMenu(!showStatusMenu)}
            className="btn-primary"
          >
            Statut <ChevronDown className={`w-4 h-4 transition-transform ${showStatusMenu ? 'rotate-180' : ''}`} />
          </button>
          {showStatusMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowStatusMenu(false)} />
              <div className="absolute right-0 top-full mt-2 w-72 card p-1.5 shadow-xl z-50 animate-scale-in">
                {STATUTS.map(s => {
                  const sc = getStatusConfig(s);
                  return (
                    <button
                      key={s}
                      onClick={() => handleStatusChange(s)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors
                        ${s === t.statut ? 'bg-brand-50 text-brand-700 font-semibold' : 'hover:bg-slate-50 text-slate-700'}`}
                    >
                      <span className={`w-2 h-2 rounded-full ${sc.dot}`} />
                      {s}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-5">
          {/* Device info */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Wrench className="w-4 h-4 text-slate-400" />
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Appareil</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              <div>
                <p className="text-slate-400 text-xs mb-0.5">Catégorie</p>
                <p className="font-medium text-slate-800">{t.categorie}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs mb-0.5">Marque</p>
                <p className="font-medium text-slate-800">{t.marque}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs mb-0.5">Modèle</p>
                <p className="font-medium text-slate-800">{t.modele || t.modele_autre || '—'}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs mb-0.5">Panne</p>
                <p className="font-medium text-slate-800">{t.panne}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs mb-0.5">IMEI</p>
                <p className="font-medium text-slate-800 font-mono text-xs">{t.imei || '—'}</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs mb-0.5">Détail</p>
                <p className="font-medium text-slate-800">{t.panne_detail || '—'}</p>
              </div>
              {t.pin && (
                <div>
                  <p className="text-slate-400 text-xs mb-0.5">Code PIN</p>
                  <p className="font-medium text-slate-800 font-mono">{t.pin}</p>
                </div>
              )}
              {t.pattern && (
                <div>
                  <p className="text-slate-400 text-xs mb-0.5">Pattern</p>
                  <p className="font-medium text-slate-800">{t.pattern}</p>
                </div>
              )}
            </div>
            {t.notes_client && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-lg text-sm text-amber-800">
                <span className="font-semibold">Note client :</span> {t.notes_client}
              </div>
            )}
          </div>

          {/* Pricing */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <CreditCard className="w-4 h-4 text-slate-400" />
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tarification</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="input-label">Devis estimé (€)</label>
                <input
                  type="number" step="0.01"
                  value={editFields.devis_estime}
                  onChange={e => setEditFields(f => ({ ...f, devis_estime: e.target.value }))}
                  className="input"
                />
              </div>
              <div>
                <label className="input-label">Tarif final (€)</label>
                <input
                  type="number" step="0.01"
                  value={editFields.tarif_final}
                  onChange={e => setEditFields(f => ({ ...f, tarif_final: e.target.value }))}
                  className="input"
                />
              </div>
              <div>
                <label className="input-label">Acompte (€)</label>
                <input
                  type="number" step="0.01"
                  value={editFields.acompte}
                  onChange={e => setEditFields(f => ({ ...f, acompte: e.target.value }))}
                  className="input"
                />
              </div>
              <div>
                <label className="input-label">Réparation supp.</label>
                <input
                  type="text"
                  value={editFields.reparation_supp}
                  onChange={e => setEditFields(f => ({ ...f, reparation_supp: e.target.value }))}
                  className="input"
                />
              </div>
              <div>
                <label className="input-label">Prix supp. (€)</label>
                <input
                  type="number" step="0.01"
                  value={editFields.prix_supp}
                  onChange={e => setEditFields(f => ({ ...f, prix_supp: e.target.value }))}
                  className="input"
                />
              </div>
              <div>
                <label className="input-label">Type écran</label>
                <select
                  value={editFields.type_ecran}
                  onChange={e => setEditFields(f => ({ ...f, type_ecran: e.target.value }))}
                  className="input"
                >
                  <option value="">—</option>
                  <option value="Original">Original</option>
                  <option value="Compatible">Compatible</option>
                  <option value="OLED">OLED</option>
                  <option value="Incell">Incell</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end mt-4 pt-3 border-t border-slate-100">
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                <Save className="w-4 h-4" />
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>

          {/* Internal notes */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-4 h-4 text-slate-400" />
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Notes internes</h2>
            </div>
            {t.notes_internes && (
              <pre className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-4 mb-4 max-h-48 overflow-y-auto border border-slate-100">
                {t.notes_internes}
              </pre>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                placeholder="Ajouter une note..."
                className="input flex-1"
              />
              <button onClick={handleAddNote} className="btn-secondary px-3">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* History */}
          {t.historique && (
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-slate-400" />
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Historique</h2>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {t.historique.split('\n').filter(Boolean).reverse().map((line, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm">
                    <div className="w-2 h-2 rounded-full bg-slate-300 mt-1.5 shrink-0" />
                    <p className="text-slate-600">{line}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Client info */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <User className="w-4 h-4 text-slate-400" />
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Client</h2>
            </div>
            <p className="text-lg font-bold text-slate-900">{t.client_prenom || ''} {t.client_nom || ''}</p>
            {t.client_societe && <p className="text-sm text-slate-500 mt-0.5">{t.client_societe}</p>}
            <div className="mt-3 space-y-2">
              {t.client_tel && (
                <a href={`tel:${t.client_tel}`} className="flex items-center gap-2.5 text-sm text-slate-600 hover:text-brand-600 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <Phone className="w-4 h-4 text-slate-500" />
                  </div>
                  {t.client_tel}
                </a>
              )}
              {t.client_email && (
                <a href={`mailto:${t.client_email}`} className="flex items-center gap-2.5 text-sm text-slate-600 hover:text-brand-600 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <Mail className="w-4 h-4 text-slate-500" />
                  </div>
                  {t.client_email}
                </a>
              )}
            </div>

            {/* Communication actions */}
            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-2">
              {t.client_tel && (
                <a
                  href={waLink(t.client_tel, `Bonjour, concernant votre ticket ${t.ticket_code}...`)}
                  target="_blank"
                  className="btn-success text-xs py-2"
                >
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                </a>
              )}
              {t.client_tel && (
                <a
                  href={smsLink(t.client_tel, `Klikphone: Votre ticket ${t.ticket_code}...`)}
                  className="btn-secondary text-xs py-2"
                >
                  <Send className="w-3.5 h-3.5" /> SMS
                </a>
              )}
            </div>
          </div>

          {/* Dates */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-slate-400" />
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Dates</h2>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Dépôt</span>
                <span className="font-medium text-slate-800">{formatDate(t.date_depot)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Mise à jour</span>
                <span className="font-medium text-slate-800">{formatDate(t.date_maj)}</span>
              </div>
              {t.date_cloture && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Clôture</span>
                  <span className="font-medium text-slate-800">{formatDate(t.date_cloture)}</span>
                </div>
              )}
              {t.date_recuperation && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Récupération</span>
                  <span className="font-medium text-slate-800">{t.date_recuperation}</span>
                </div>
              )}
            </div>
          </div>

          {/* Assignment */}
          <div className="card p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Assignation</h2>
            <div>
              <label className="input-label">Technicien assigné</label>
              <input
                type="text"
                value={editFields.technicien_assigne}
                onChange={e => setEditFields(f => ({ ...f, technicien_assigne: e.target.value }))}
                className="input"
                placeholder="Nom du technicien"
              />
            </div>
            {t.personne_charge && (
              <div className="mt-3">
                <p className="text-xs text-slate-400 mb-0.5">Personne en charge</p>
                <p className="text-sm font-medium text-slate-800">{t.personne_charge}</p>
              </div>
            )}
          </div>

          {/* Danger zone */}
          <div className="card p-5 border-red-200/50">
            <button
              onClick={async () => {
                if (confirm('Supprimer ce ticket ?')) {
                  await api.deleteTicket(id);
                  navigate(basePath);
                }
              }}
              className="btn-danger w-full text-xs"
            >
              <Trash2 className="w-3.5 h-3.5" /> Supprimer le ticket
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
