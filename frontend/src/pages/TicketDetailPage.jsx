import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import { formatDate, formatPrix, STATUTS, waLink, smsLink } from '../lib/utils';
import {
  ArrowLeft, Phone, Mail, MessageCircle, Send, Save, Trash2,
  ChevronDown, Plus, CreditCard, FileText, Clock,
} from 'lucide-react';

export default function TicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [editFields, setEditFields] = useState({});

  useEffect(() => {
    loadTicket();
  }, [id]);

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
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <p className="text-gray-400">Ticket non trouvé</p>
      </div>
    );
  }

  const t = ticket;
  const appareil = t.modele_autre || `${t.marque || ''} ${t.modele || ''}`.trim();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold font-mono text-brand-600">{t.ticket_code}</h1>
            <StatusBadge statut={t.statut} />
          </div>
          <p className="text-sm text-gray-500 mt-0.5">{appareil} — {t.panne}</p>
        </div>

        {/* Bouton changer statut */}
        <div className="relative">
          <button
            onClick={() => setShowStatusMenu(!showStatusMenu)}
            className="btn-primary"
          >
            Statut <ChevronDown className="w-4 h-4" />
          </button>
          {showStatusMenu && (
            <div className="absolute right-0 top-full mt-2 w-72 card p-2 shadow-xl z-50 animate-in">
              {STATUTS.map(s => (
                <button
                  key={s}
                  onClick={() => handleStatusChange(s)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors
                    ${s === t.statut ? 'bg-brand-50 text-brand-700 font-semibold' : 'hover:bg-gray-50'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Colonne principale */}
        <div className="lg:col-span-2 space-y-6">
          {/* Infos appareil */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Appareil</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-400">Catégorie</span><p className="font-medium mt-0.5">{t.categorie}</p></div>
              <div><span className="text-gray-400">Marque</span><p className="font-medium mt-0.5">{t.marque}</p></div>
              <div><span className="text-gray-400">Modèle</span><p className="font-medium mt-0.5">{t.modele || t.modele_autre || '—'}</p></div>
              <div><span className="text-gray-400">IMEI</span><p className="font-medium mt-0.5 font-mono">{t.imei || '—'}</p></div>
              <div><span className="text-gray-400">Panne</span><p className="font-medium mt-0.5">{t.panne}</p></div>
              <div><span className="text-gray-400">Détail</span><p className="font-medium mt-0.5">{t.panne_detail || '—'}</p></div>
              {t.pin && <div><span className="text-gray-400">PIN</span><p className="font-medium mt-0.5 font-mono">{t.pin}</p></div>}
              {t.pattern && <div><span className="text-gray-400">Pattern</span><p className="font-medium mt-0.5">{t.pattern}</p></div>}
            </div>
            {t.notes_client && (
              <div className="mt-4 p-3 bg-amber-50 rounded-xl text-sm text-amber-800">
                <span className="font-semibold">Note client :</span> {t.notes_client}
              </div>
            )}
          </div>

          {/* Tarification */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Tarification</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
            <div className="flex justify-end mt-4">
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                <Save className="w-4 h-4" />
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>

          {/* Notes internes */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Notes internes</h2>
            {t.notes_internes && (
              <pre className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-xl p-4 mb-4 max-h-48 overflow-y-auto">
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
              <button onClick={handleAddNote} className="btn-secondary">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Historique */}
          {t.historique && (
            <div className="card p-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                <Clock className="w-4 h-4 inline mr-1.5" />Historique
              </h2>
              <pre className="text-sm text-gray-600 whitespace-pre-wrap max-h-48 overflow-y-auto">
                {t.historique}
              </pre>
            </div>
          )}
        </div>

        {/* Sidebar - Infos client + Actions */}
        <div className="space-y-6">
          {/* Client */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Client</h2>
            <p className="text-lg font-bold">{t.client_prenom || ''} {t.client_nom || ''}</p>
            {t.client_societe && <p className="text-sm text-gray-500">{t.client_societe}</p>}
            <div className="mt-4 space-y-2">
              {t.client_tel && (
                <a href={`tel:${t.client_tel}`} className="flex items-center gap-2 text-sm text-gray-600 hover:text-brand-600">
                  <Phone className="w-4 h-4" /> {t.client_tel}
                </a>
              )}
              {t.client_email && (
                <a href={`mailto:${t.client_email}`} className="flex items-center gap-2 text-sm text-gray-600 hover:text-brand-600">
                  <Mail className="w-4 h-4" /> {t.client_email}
                </a>
              )}
            </div>

            {/* Actions communication */}
            <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
              {t.client_tel && (
                <a
                  href={waLink(t.client_tel, `Bonjour, concernant votre ticket ${t.ticket_code}...`)}
                  target="_blank"
                  className="btn-success w-full text-xs"
                >
                  <MessageCircle className="w-4 h-4" /> WhatsApp
                </a>
              )}
              {t.client_tel && (
                <a
                  href={smsLink(t.client_tel, `Klikphone: Votre ticket ${t.ticket_code}...`)}
                  className="btn-secondary w-full text-xs"
                >
                  <Send className="w-4 h-4" /> SMS
                </a>
              )}
            </div>
          </div>

          {/* Dates */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Dates</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Dépôt</span>
                <span className="font-medium">{formatDate(t.date_depot)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Mise à jour</span>
                <span className="font-medium">{formatDate(t.date_maj)}</span>
              </div>
              {t.date_cloture && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Clôture</span>
                  <span className="font-medium">{formatDate(t.date_cloture)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Technicien */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Assignation</h2>
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
            <div className="mt-3">
              <label className="input-label">Personne en charge</label>
              <p className="text-sm font-medium">{t.personne_charge || '—'}</p>
            </div>
          </div>

          {/* Danger zone */}
          <div className="card p-6 border-rose-100">
            <button
              onClick={async () => {
                if (confirm('Supprimer ce ticket ?')) {
                  await api.deleteTicket(id);
                  navigate('/accueil');
                }
              }}
              className="btn-danger w-full"
            >
              <Trash2 className="w-4 h-4" /> Supprimer le ticket
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
