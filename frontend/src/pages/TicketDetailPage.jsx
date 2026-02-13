import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import ProgressTracker from '../components/ProgressTracker';
import FideliteCard from '../components/FideliteCard';
import PatternGrid from '../components/PatternGrid';
import PrintDrawer from '../components/PrintDrawer';
import MessageComposer from '../components/MessageComposer';
import { formatDate, formatPrix, STATUTS, waLink, smsLink, getStatusConfig } from '../lib/utils';
import { useToast } from '../components/Toast';
import {
  ArrowLeft, Phone, Mail, MessageCircle, Send, Save, Trash2,
  ChevronDown, Plus, Minus, User, Wrench, Package,
  FileText, Printer, Lock, Eye, Copy, Check,
  AlertTriangle, Smartphone, Shield, Calendar,
  Zap, Edit3, X, CheckCircle2,
  Flag, PhoneCall, Percent,
} from 'lucide-react';

// ─── Editable Section Component ────────────────────────────────
function EditableSection({ title, icon: Icon, iconBg, iconColor, editing, onEdit, onSave, onCancel, children, viewContent }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}>
            <Icon className={`w-4 h-4 ${iconColor}`} />
          </div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        </div>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <button onClick={onCancel} className="btn-ghost text-xs px-2.5 py-1.5">
              <X className="w-3.5 h-3.5" /> Annuler
            </button>
            <button onClick={onSave} className="btn-primary text-xs px-2.5 py-1.5">
              <Save className="w-3.5 h-3.5" /> Sauver
            </button>
          </div>
        ) : (
          <button onClick={onEdit} className="btn-ghost p-1.5" title="Modifier">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {editing ? children : viewContent}
    </div>
  );
}

// ─── Layout Blocks Config ────────────────────────────────────
const VALID_BLOCK_IDS = new Set(['client', 'device', 'dates', 'notes', 'messages', 'reparation', 'status', 'fidelite']);
const INITIAL_BLOCKS = [
  { id: 'client',      title: 'Client',               col: 'left',  order: 0, size: 'normal' },
  { id: 'device',      title: 'Appareil',             col: 'left',  order: 1, size: 'normal' },
  { id: 'dates',       title: 'Dates',                col: 'left',  order: 2, size: 'compact' },
  { id: 'messages',    title: 'Messages',             col: 'left',  order: 3, size: 'normal' },
  { id: 'notes',       title: 'Notes internes',       col: 'left',  order: 4, size: 'normal' },
  { id: 'reparation',  title: 'Réparation & Tarifs',  col: 'right', order: 0, size: 'large' },
  { id: 'status',      title: 'Statut',               col: 'right', order: 1, size: 'compact' },
  { id: 'fidelite',    title: 'Fidélité',             col: 'right', order: 2, size: 'compact' },
];

export default function TicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';
  const isTech = user?.target === 'tech';

  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [notePrivate, setNotePrivate] = useState(true);
  const [copied, setCopied] = useState(false);

  // Edit states per section
  const [editingDevice, setEditingDevice] = useState(false);
  const [editingClient, setEditingClient] = useState(false);
  const [editingPricing, setEditingPricing] = useState(false);
  const [editingAssign, setEditingAssign] = useState(false);

  // Edit form data
  const [deviceForm, setDeviceForm] = useState({});
  const [clientForm, setClientForm] = useState({});
  const [pricingForm, setPricingForm] = useState({});

  // Repair lines (parsed from reparation_supp JSON or legacy)
  const [repairLines, setRepairLines] = useState([]);

  // Print drawer state
  const [showPrintDrawer, setShowPrintDrawer] = useState(false);

  // Accord client modal state
  const [showAccordModal, setShowAccordModal] = useState(false);
  const [accordLoading, setAccordLoading] = useState(false);
  const [accordForm, setAccordForm] = useState({ reparation: '', prix: '' });

  // Team members for tech dropdown
  const [teamMembers, setTeamMembers] = useState([]);

  // Attention flag
  const [showAttention, setShowAttention] = useState(false);

  // TVA config
  const [tvaRate, setTvaRate] = useState(0);

  // Notes privées
  const [privateNotes, setPrivateNotes] = useState([]);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNoteImportant, setNewNoteImportant] = useState(false);

  // Téléphone de prêt modal
  const [showPretModal, setShowPretModal] = useState(false);

  // Rendu au client — payment modal
  const [showRenduModal, setShowRenduModal] = useState(false);

  // Layout drag & drop
  const [blocks, setBlocks] = useState(INITIAL_BLOCKS);
  const [dragId, setDragId] = useState(null);
  const [layoutEditMode, setLayoutEditMode] = useState(false);

  // Commandes de pièces
  const [commandes, setCommandes] = useState([]);

  // Delete ticket modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteCode, setDeleteCode] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const parseRepairLines = (ticket) => {
    try {
      if (ticket.reparation_supp && ticket.reparation_supp.startsWith('[')) {
        return JSON.parse(ticket.reparation_supp);
      }
    } catch {}
    // Legacy: single reparation_supp + prix_supp
    const lines = [];
    if (ticket.panne) {
      lines.push({ label: ticket.panne, prix: ticket.devis_estime || 0 });
    }
    if (ticket.reparation_supp) {
      lines.push({ label: ticket.reparation_supp, prix: ticket.prix_supp || 0 });
    }
    return lines.length > 0 ? lines : [{ label: '', prix: 0 }];
  };

  const loadTicket = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getTicket(id);
      setTicket(data);
      setDeviceForm({
        categorie: data.categorie || '',
        marque: data.marque || '',
        modele: data.modele || '',
        modele_autre: data.modele_autre || '',
        imei: data.imei || '',
        panne: data.panne || '',
        panne_detail: data.panne_detail || '',
        pin: data.pin || '',
        pattern: data.pattern || '',
        notes_client: data.notes_client || '',
      });
      setClientForm({
        nom: data.client_nom || '',
        prenom: data.client_prenom || '',
        telephone: data.client_tel || '',
        email: data.client_email || '',
        societe: data.client_societe || '',
      });
      setPricingForm({
        devis_estime: data.devis_estime || '',
        tarif_final: data.tarif_final || '',
        acompte: data.acompte || '',
        technicien_assigne: data.technicien_assigne || '',
        type_ecran: data.type_ecran || '',
        date_recuperation: data.date_recuperation || '',
        reduction_montant: data.reduction_montant || '',
        reduction_pourcentage: data.reduction_pourcentage || '',
      });
      setRepairLines(parseRepairLines(data));
      // Show attention flag from dedicated field, notes, or important private notes
      setShowAttention(!!(data.attention || (data.notes_internes || '').includes('[ATTENTION]')));
      // Load commandes for this ticket
      try {
        const cmds = await api.getPartsByTicket(data.id);
        setCommandes(cmds || []);
      } catch { setCommandes([]); }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadTicket(); }, [loadTicket]);

  const loadNotes = useCallback(async () => {
    try {
      const data = await api.getNotes(id);
      setPrivateNotes(data || []);
    } catch { setPrivateNotes([]); }
  }, [id]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  useEffect(() => {
    api.getActiveTeam().then(setTeamMembers).catch(() => {});
    api.getConfig().then(params => {
      const arr = Array.isArray(params) ? params : [];
      const tvaParam = arr.find(p => p.cle === 'tva');
      if (tvaParam) setTvaRate(parseFloat(tvaParam.valeur) || 0);
    }).catch(() => {});
  }, []);

  // ─── Layout persistence & handlers ──────────────────────────────

  useEffect(() => {
    if (!user?.utilisateur) return;
    try {
      const saved = localStorage.getItem(`kp_layout_${user.utilisateur}`);
      if (saved) {
        const parsed = JSON.parse(saved).filter(b => VALID_BLOCK_IDS.has(b.id));
        // If saved layout is missing new blocks, add them from defaults
        const savedIds = new Set(parsed.map(b => b.id));
        const missing = INITIAL_BLOCKS.filter(b => !savedIds.has(b.id));
        if (parsed.length > 0) setBlocks([...parsed, ...missing]);
      }
    } catch {}
  }, [user?.utilisateur]);

  const saveLayout = () => {
    if (!user?.utilisateur) return;
    localStorage.setItem(`kp_layout_${user.utilisateur}`, JSON.stringify(blocks));
    toast.success('Layout sauvegardé');
    setLayoutEditMode(false);
  };

  const resetLayout = () => {
    if (!user?.utilisateur) return;
    localStorage.removeItem(`kp_layout_${user.utilisateur}`);
    setBlocks(INITIAL_BLOCKS);
    toast.success('Layout réinitialisé');
  };

  const handleLayoutDrop = (targetId) => {
    if (!dragId || dragId === targetId) return;
    setBlocks(prev => {
      const updated = prev.map(b => ({ ...b }));
      const drag = updated.find(b => b.id === dragId);
      const target = updated.find(b => b.id === targetId);
      if (!drag || !target) return prev;
      const tmpCol = drag.col, tmpOrder = drag.order;
      drag.col = target.col; drag.order = target.order;
      target.col = tmpCol; target.order = tmpOrder;
      return updated;
    });
    setDragId(null);
  };

  const cycleSize = (blockId) => {
    setBlocks(prev => prev.map(b =>
      b.id === blockId
        ? { ...b, size: b.size === 'compact' ? 'normal' : b.size === 'normal' ? 'large' : 'compact' }
        : b
    ));
  };

  const moveToCol = (blockId, newCol) => {
    setBlocks(prev => {
      const updated = prev.map(b => ({ ...b }));
      const block = updated.find(b => b.id === blockId);
      if (!block) return prev;
      block.col = newCol;
      block.order = updated.filter(b => b.col === newCol && b.id !== blockId).length;
      return updated;
    });
  };

  // ─── Save handlers ────────────────────────────────────────────

  const handleSaveDevice = async () => {
    setSaving(true);
    try {
      await api.updateTicket(id, deviceForm);
      setEditingDevice(false);
      await loadTicket();
      toast.success('Appareil mis à jour');
    } catch (err) {
      toast.error('Erreur sauvegarde appareil');
    } finally { setSaving(false); }
  };

  const handleSaveClient = async () => {
    setSaving(true);
    try {
      await api.updateClient(ticket.client_id, clientForm);
      setEditingClient(false);
      await loadTicket();
      toast.success('Client mis à jour');
    } catch (err) {
      toast.error('Erreur sauvegarde client');
    } finally { setSaving(false); }
  };

  const handleSavePricing = async () => {
    setSaving(true);
    try {
      // Calculate totals from repair lines
      const totalRepairs = repairLines.reduce((sum, l) => sum + (parseFloat(l.prix) || 0), 0);
      const reparationsJson = JSON.stringify(repairLines.filter(l => l.label));

      // Calculate reduction
      let reductionAmount = parseFloat(pricingForm.reduction_montant) || 0;
      const reductionPct = parseFloat(pricingForm.reduction_pourcentage) || 0;
      if (reductionPct > 0) {
        reductionAmount = totalRepairs * (reductionPct / 100);
      }

      const finalPrice = parseFloat(pricingForm.tarif_final) || (totalRepairs - reductionAmount) || null;

      const updates = {
        ...pricingForm,
        devis_estime: parseFloat(pricingForm.devis_estime) || null,
        tarif_final: finalPrice,
        acompte: parseFloat(pricingForm.acompte) || null,
        reduction_montant: reductionAmount || null,
        reduction_pourcentage: reductionPct || null,
        reparation_supp: reparationsJson,
        prix_supp: totalRepairs,
      };
      await api.updateTicket(id, updates);
      setEditingPricing(false);
      await loadTicket();
      toast.success('Tarification mise à jour');
    } catch (err) {
      toast.error('Erreur sauvegarde tarification');
    } finally { setSaving(false); }
  };

  const handleStatusChange = async (statut) => {
    // "Rendu au client" → special flow with modals
    if (statut === 'Rendu au client') {
      // Step 1: If there's a loaned phone not returned → show prêt modal first
      if (ticket.telephone_pret && !ticket.telephone_pret_rendu) {
        setShowPretModal(true);
        return;
      }
      // Step 2: Show payment modal
      setShowRenduModal(true);
      return;
    }
    try {
      await api.changeStatus(id, statut);
      await loadTicket();
      toast.success(`Statut changé : ${statut}`);
    } catch (err) {
      toast.error('Erreur changement de statut');
    }
  };

  const confirmRenduWithPret = async () => {
    // Mark phone returned, then show payment modal
    try {
      await api.updateTicket(id, { telephone_pret_rendu: 1 });
      setShowPretModal(false);
      setShowRenduModal(true);
    } catch (err) {
      toast.error('Erreur');
    }
  };

  const handleRenduPaye = async () => {
    try {
      await api.updateTicket(id, { paye: 1 });
      await api.changeStatus(id, 'Rendu au client');
      await api.changeStatus(id, 'Clôturé');
      setShowRenduModal(false);
      await loadTicket();
      toast.success('Ticket clôturé');
    } catch (err) {
      toast.error('Erreur');
    }
  };

  const handleRenduNonPaye = async () => {
    try {
      await api.changeStatus(id, 'Rendu au client');
      setShowRenduModal(false);
      await loadTicket();
      toast.success('Attention : ticket non payé');
    } catch (err) {
      toast.error('Erreur');
    }
  };

  const handleDeleteTicket = async () => {
    if (deleteCode !== 'caramail') {
      setDeleteError('Code incorrect');
      return;
    }
    setDeleting(true);
    try {
      await api.deleteTicket(id);
      toast.success('Ticket supprimé');
      navigate(basePath);
    } catch (err) {
      toast.error('Erreur lors de la suppression');
      setDeleting(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    try {
      const prefix = notePrivate ? '[INTERNE]' : '[CLIENT]';
      await api.addNote(id, `${prefix} ${noteText}`);
      setNoteText('');
      await loadTicket();

      toast.success('Note ajoutée');
    } catch (err) {
      toast.error('Erreur ajout de note');
    }
  };

  const handleAddPrivateNote = async () => {
    if (!newNoteText.trim()) return;
    try {
      await api.addPrivateNote(id, user?.utilisateur || 'Inconnu', newNoteText, newNoteImportant);
      setNewNoteText('');
      setNewNoteImportant(false);
      await loadNotes();
      toast.success('Note ajoutée');
    } catch { toast.error('Erreur ajout note'); }
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await api.deleteNote(id, noteId);
      await loadNotes();
      toast.success('Note supprimée');
    } catch { toast.error('Erreur suppression'); }
  };

  const handleToggleNoteImportant = async (noteId, current) => {
    try {
      await api.toggleNoteImportant(id, noteId, !current);
      await loadNotes();
    } catch { toast.error('Erreur'); }
  };

  const handleAddAttention = async () => {
    try {
      await api.addNote(id, '[ATTENTION] ⚠ Ce ticket nécessite une attention particulière');
      await api.updateTicket(id, { attention: 'Ce ticket nécessite une attention particulière' });
      await loadTicket();

      toast.success('Flag attention ajouté');
    } catch (err) {
      toast.error('Erreur ajout attention');
    }
  };

  const handleTogglePaye = async () => {
    try {
      const result = await api.togglePaye(id);
      await loadTicket();

      toast.success(result.paye ? 'Marqué payé' : 'Marqué non payé');
    } catch (err) {
      toast.error('Erreur toggle payé');
    }
  };

  const adjustPrice = (field, delta) => {
    setPricingForm(f => ({
      ...f,
      [field]: Math.max(0, (parseFloat(f[field]) || 0) + delta).toString(),
    }));
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(ticket.ticket_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendCaisse = async () => {
    try {
      await api.sendToCaisse(id);
      toast.success('Envoyé en caisse');
    } catch (err) {
      toast.error('Erreur envoi en caisse');
    }
  };

  const handleDemanderAccord = async () => {
    setAccordLoading(true);
    try {
      // Add repair line to list
      const newLine = { label: accordForm.reparation, prix: parseFloat(accordForm.prix) || 0 };
      const updatedLines = [...repairLines.filter(l => l.label), newLine];
      const totalRepairs = updatedLines.reduce((sum, l) => sum + (parseFloat(l.prix) || 0), 0);

      await api.updateTicket(id, {
        reparation_supp: JSON.stringify(updatedLines),
        prix_supp: totalRepairs,
      });
      await api.changeStatus(id, "En attente d'accord client");
      const result = await api.generateMessage(id, 'devis_a_valider');
      const msg = result.message || result;
      if (ticket.client_tel) {
        window.open(waLink(ticket.client_tel, msg), '_blank');
      }
      setShowAccordModal(false);
      setAccordForm({ reparation: '', prix: '' });
      await loadTicket();
      toast.success('Demande envoyée au client');
    } catch (err) {
      toast.error('Erreur envoi de la demande');
    } finally {
      setAccordLoading(false);
    }
  };

  // ─── Repair Lines ─────────────────────────────────────────────

  const addRepairLine = () => {
    setRepairLines(lines => [...lines, { label: '', prix: 0 }]);
  };

  const removeRepairLine = (idx) => {
    setRepairLines(lines => lines.filter((_, i) => i !== idx));
  };

  const updateRepairLine = (idx, field, value) => {
    setRepairLines(lines => lines.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const adjustRepairPrice = (idx, delta) => {
    setRepairLines(lines => lines.map((l, i) => i === idx ? { ...l, prix: Math.max(0, (parseFloat(l.prix) || 0) + delta) } : l));
  };

  const totalRepairs = repairLines.reduce((sum, l) => sum + (parseFloat(l.prix) || 0), 0);
  const reductionMontant = parseFloat(pricingForm.reduction_montant) || 0;
  const reductionPct = parseFloat(pricingForm.reduction_pourcentage) || 0;
  const effectiveReduction = reductionPct > 0 ? totalRepairs * (reductionPct / 100) : reductionMontant;
  const subtotalHT = parseFloat(pricingForm.tarif_final) || (totalRepairs - effectiveReduction);
  const tvaAmount = tvaRate > 0 ? subtotalHT * (tvaRate / 100) : 0;
  const totalTTC = subtotalHT + tvaAmount;
  const reste = totalTTC - (parseFloat(pricingForm.acompte) || 0);

  // ─── Render ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Chargement...</p>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <Smartphone className="w-7 h-7 text-slate-300" />
        </div>
        <p className="text-slate-500 font-medium">Ticket non trouvé</p>
        <button onClick={() => navigate(basePath)} className="btn-secondary mt-4">
          <ArrowLeft className="w-4 h-4" /> Retour au dashboard
        </button>
      </div>
    );
  }

  const t = ticket;
  const appareil = t.modele_autre || `${t.marque || ''} ${t.modele || ''}`.trim();

  // Parse notes into timeline entries
  const timelineEntries = [];
  if (t.notes_internes) {
    t.notes_internes.split('\n').filter(Boolean).forEach(line => {
      const isInternal = line.includes('[INTERNE]');
      const isClient = line.includes('[CLIENT]');
      const isAttention = line.includes('[ATTENTION]');
      const cleanLine = line.replace(/\[(INTERNE|CLIENT|ATTENTION)\]\s*/g, '');
      const tsMatch = cleanLine.match(/^\[(\d{2}\/\d{2}\/?\d{0,4}\s?\d{2}:\d{2})\]\s*/);
      const timestamp = tsMatch ? tsMatch[1] : '';
      const text = tsMatch ? cleanLine.replace(tsMatch[0], '') : cleanLine;
      timelineEntries.push({
        type: isAttention ? 'attention' : isClient ? 'client' : 'internal',
        text, timestamp, raw: line,
      });
    });
  }
  if (t.historique) {
    t.historique.split('\n').filter(Boolean).forEach(line => {
      const tsMatch = line.match(/^\[(\d{2}\/\d{2}\s?\d{2}:\d{2})\]\s*/);
      const timestamp = tsMatch ? tsMatch[1] : '';
      const text = tsMatch ? line.replace(tsMatch[0], '') : line;
      timelineEntries.push({ type: 'history', text, timestamp, raw: line });
    });
  }
  // Sort by timestamp desc (most recent first)
  timelineEntries.reverse();

  // ─── Block rendering ──────────────────────────────────────────

  const renderBlockContent = (blockId) => {
    switch (blockId) {
      case 'client':
        return (
          <EditableSection
            title="Client" icon={User} iconBg="bg-blue-50" iconColor="text-blue-600"
            editing={editingClient}
            onEdit={() => setEditingClient(true)}
            onSave={handleSaveClient}
            onCancel={() => { setEditingClient(false); setClientForm({ nom: t.client_nom || '', prenom: t.client_prenom || '', telephone: t.client_tel || '', email: t.client_email || '', societe: t.client_societe || '' }); }}
            viewContent={
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                    <span className="text-brand-700 font-bold text-sm">
                      {(t.client_prenom?.[0] || '').toUpperCase()}{(t.client_nom?.[0] || '').toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-bold text-slate-900 truncate">{t.client_prenom || ''} {t.client_nom || ''}</p>
                    {t.client_societe && <p className="text-xs text-slate-500">{t.client_societe}</p>}
                  </div>
                </div>
                <div className="space-y-2">
                  {t.client_tel && (
                    <a href={`tel:${t.client_tel}`} className="flex items-center gap-2.5 text-sm text-slate-600 hover:text-brand-600 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                        <Phone className="w-4 h-4 text-slate-500" />
                      </div>
                      <span className="font-mono text-xs">{t.client_tel}</span>
                    </a>
                  )}
                  {t.client_email && (
                    <a href={`mailto:${t.client_email}`} className="flex items-center gap-2.5 text-sm text-slate-600 hover:text-brand-600 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                        <Mail className="w-4 h-4 text-slate-500" />
                      </div>
                      <span className="text-xs truncate">{t.client_email}</span>
                    </a>
                  )}
                </div>
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-[10px] text-slate-400 text-center">Messages dans le bloc Messages ci-dessous</p>
                </div>
              </>
            }
          >
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="input-label">Prénom</label>
                  <input value={clientForm.prenom} onChange={e => setClientForm(f => ({ ...f, prenom: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="input-label">Nom</label>
                  <input value={clientForm.nom} onChange={e => setClientForm(f => ({ ...f, nom: e.target.value }))} className="input" />
                </div>
              </div>
              <div>
                <label className="input-label">Téléphone</label>
                <input value={clientForm.telephone} onChange={e => setClientForm(f => ({ ...f, telephone: e.target.value }))} className="input font-mono" />
              </div>
              <div>
                <label className="input-label">Email</label>
                <input value={clientForm.email} onChange={e => setClientForm(f => ({ ...f, email: e.target.value }))} className="input" />
              </div>
              <div>
                <label className="input-label">Société</label>
                <input value={clientForm.societe} onChange={e => setClientForm(f => ({ ...f, societe: e.target.value }))} className="input" />
              </div>
            </div>
          </EditableSection>
        );

      case 'device':
        return (
          <EditableSection
            title="Appareil" icon={Smartphone} iconBg="bg-brand-50" iconColor="text-brand-600"
            editing={editingDevice}
            onEdit={() => setEditingDevice(true)}
            onSave={handleSaveDevice}
            onCancel={() => { setEditingDevice(false); setDeviceForm({ categorie: t.categorie || '', marque: t.marque || '', modele: t.modele || '', modele_autre: t.modele_autre || '', imei: t.imei || '', panne: t.panne || '', panne_detail: t.panne_detail || '', pin: t.pin || '', pattern: t.pattern || '', notes_client: t.notes_client || '' }); }}
            viewContent={
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
                  {[
                    { label: 'Catégorie', value: t.categorie },
                    { label: 'Marque', value: t.marque },
                    { label: 'Modèle', value: t.modele || t.modele_autre || '—' },
                    { label: 'Panne', value: t.panne },
                    { label: 'IMEI / N° série', value: t.imei, mono: true },
                    { label: 'Détail panne', value: t.panne_detail },
                  ].map(({ label, value, mono }) => (
                    <div key={label}>
                      <p className="text-slate-400 text-xs mb-0.5">{label}</p>
                      <p className={`font-medium text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>{value || '—'}</p>
                    </div>
                  ))}
                </div>
                {(t.pin || t.pattern) && (
                  <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-6">
                    {t.pin && (
                      <div>
                        <p className="text-slate-400 text-xs mb-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Code PIN</p>
                        <p className="text-lg font-bold font-mono text-slate-800 tracking-widest">{t.pin}</p>
                      </div>
                    )}
                    {t.pattern && (
                      <div>
                        <p className="text-slate-400 text-xs mb-1 flex items-center gap-1"><Shield className="w-3 h-3" /> Pattern</p>
                        <PatternGrid value={t.pattern} readOnly size={120} />
                      </div>
                    )}
                  </div>
                )}
                {t.notes_client && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-lg text-sm text-amber-800">
                    <span className="font-semibold">Note client :</span> {t.notes_client}
                  </div>
                )}
              </>
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div><label className="input-label">Catégorie</label><input value={deviceForm.categorie} onChange={e => setDeviceForm(f => ({ ...f, categorie: e.target.value }))} className="input" /></div>
              <div><label className="input-label">Marque</label><input value={deviceForm.marque} onChange={e => setDeviceForm(f => ({ ...f, marque: e.target.value }))} className="input" /></div>
              <div><label className="input-label">Modèle</label><input value={deviceForm.modele} onChange={e => setDeviceForm(f => ({ ...f, modele: e.target.value }))} className="input" /></div>
              <div><label className="input-label">Panne</label><input value={deviceForm.panne} onChange={e => setDeviceForm(f => ({ ...f, panne: e.target.value }))} className="input" /></div>
              <div><label className="input-label">IMEI</label><input value={deviceForm.imei} onChange={e => setDeviceForm(f => ({ ...f, imei: e.target.value }))} className="input font-mono" /></div>
              <div><label className="input-label">Détail panne</label><input value={deviceForm.panne_detail} onChange={e => setDeviceForm(f => ({ ...f, panne_detail: e.target.value }))} className="input" /></div>
              <div><label className="input-label">Code PIN</label><input value={deviceForm.pin} onChange={e => setDeviceForm(f => ({ ...f, pin: e.target.value }))} className="input font-mono tracking-widest" maxLength={10} /></div>
              <div><label className="input-label">Pattern</label><input value={deviceForm.pattern} onChange={e => setDeviceForm(f => ({ ...f, pattern: e.target.value }))} className="input font-mono" placeholder="1-5-9-6-3" /></div>
              <div className="col-span-2 sm:col-span-3"><label className="input-label">Note client</label><textarea value={deviceForm.notes_client} onChange={e => setDeviceForm(f => ({ ...f, notes_client: e.target.value }))} className="input resize-none" rows={2} /></div>
            </div>
          </EditableSection>
        );

      case 'dates':
        return (
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center"><Calendar className="w-4 h-4 text-slate-500" /></div>
              <h2 className="text-sm font-semibold text-slate-800">Dates</h2>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center"><span className="text-slate-500">Dépôt</span><span className="font-medium text-slate-800">{formatDate(t.date_depot)}</span></div>
              <div className="flex justify-between items-center"><span className="text-slate-500">Mise à jour</span><span className="font-medium text-slate-800">{formatDate(t.date_maj)}</span></div>
              {t.date_cloture && <div className="flex justify-between items-center"><span className="text-slate-500">Clôture</span><span className="font-medium text-slate-800">{formatDate(t.date_cloture)}</span></div>}
              {t.date_recuperation && <div className="flex justify-between items-center"><span className="text-slate-500">Récupération</span><span className="font-medium text-slate-800">{t.date_recuperation}</span></div>}
            </div>
          </div>
        );

      case 'messages':
        return (
          <MessageComposer
            ticket={t}
            onMessageSent={() => loadNotes()}
          />
        );

      case 'notes':
        return (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center"><FileText className="w-4 h-4 text-amber-600" /></div>
                <h2 className="text-sm font-semibold text-slate-800">Notes internes</h2>
                <span className="text-[10px] text-slate-400">
                  {(() => {
                    const allNotes = [
                      ...privateNotes,
                      ...timelineEntries.filter(e => e.type === 'internal' || e.type === 'client' || e.type === 'attention'),
                    ];
                    return `${allNotes.length} note(s)`;
                  })()}
                </span>
              </div>
              <button onClick={handleAddAttention} className="btn-ghost text-xs gap-1 text-red-500 hover:bg-red-50" title="Ajouter flag attention">
                <Flag className="w-3.5 h-3.5" /> Attention
              </button>
            </div>

            {/* Add note input */}
            <div className="flex gap-2 mb-4">
              <div className="flex-1 flex gap-2">
                <button onClick={() => setNotePrivate(!notePrivate)}
                  className={`shrink-0 p-2.5 rounded-lg border transition-colors ${
                    notePrivate ? 'bg-slate-50 border-slate-200 text-slate-500' : 'bg-blue-50 border-blue-200 text-blue-500'
                  }`}
                  title={notePrivate ? 'Note interne' : 'Note visible client'}>
                  {notePrivate ? <Lock className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <input type="text" value={noteText} onChange={e => setNoteText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                  placeholder={notePrivate ? 'Note interne...' : 'Note visible par le client...'}
                  className="input flex-1" />
              </div>
              <button onClick={handleAddNote} className="btn-primary px-3"><Plus className="w-4 h-4" /></button>
            </div>

            {/* Compact notes list with type badges */}
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
              {privateNotes.map(note => {
                const tn = note.type_note || 'note';
                const badge = tn === 'whatsapp' ? { bg: 'bg-green-100 text-green-700', label: 'WhatsApp' }
                  : tn === 'sms' ? { bg: 'bg-blue-100 text-blue-700', label: 'SMS' }
                  : tn === 'email' ? { bg: 'bg-amber-100 text-amber-700', label: 'Email' }
                  : null;
                const isTechNote = note.auteur?.toLowerCase().includes('tech');
                const textColor = note.important ? 'text-red-600 font-semibold' : badge ? 'text-slate-600' : isTechNote ? 'text-blue-600' : 'text-emerald-600';
                return (
                  <div key={`db-${note.id}`} className="flex items-start gap-2 py-1.5">
                    {badge && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 mt-0.5 ${badge.bg}`}>
                        {badge.label}
                      </span>
                    )}
                    {!badge && tn === 'note' && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 uppercase tracking-wider shrink-0 mt-0.5">
                        {note.auteur || 'Note'}
                      </span>
                    )}
                    <span className={`text-sm flex-1 min-w-0 ${textColor}`}>{note.contenu}</span>
                    <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0 mt-0.5">
                      {note.date_creation ? new Date(note.date_creation).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : ''}
                    </span>
                  </div>
                );
              })}
              {timelineEntries.filter(e => e.type !== 'history').map((entry, i) => {
                const textColor = entry.type === 'attention' ? 'text-red-600 font-semibold' : entry.type === 'internal' ? 'text-blue-600' : 'text-emerald-600';
                return (
                  <div key={`tl-${i}`} className="flex items-start gap-2 py-1.5">
                    <span className={`text-sm flex-1 min-w-0 ${textColor}`}>{entry.text}</span>
                    {entry.timestamp && <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0 mt-0.5">{entry.timestamp}</span>}
                  </div>
                );
              })}
              {privateNotes.length === 0 && timelineEntries.filter(e => e.type !== 'history').length === 0 && (
                <p className="text-xs text-slate-400 text-center py-3">Aucune note</p>
              )}
            </div>

            {/* Timeline history */}
            {timelineEntries.filter(e => e.type === 'history').length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-2">Historique</p>
                <div className="relative max-h-48 overflow-y-auto pl-4">
                  <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-slate-200" />
                  <div className="space-y-0.5">
                    {timelineEntries.filter(e => e.type === 'history').map((entry, i) => (
                      <div key={i} className="relative flex items-start gap-3 py-1.5 px-2 rounded-lg hover:bg-slate-50 transition-colors">
                        <div className="absolute -left-4 top-3 w-2 h-2 rounded-full bg-brand-400 z-10" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-500">{entry.text}</p>
                          {entry.timestamp && <span className="text-[10px] text-slate-400">{entry.timestamp}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case 'reparation':
        return (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center"><Wrench className="w-4 h-4 text-emerald-600" /></div>
                <h2 className="text-sm font-semibold text-slate-800">Réparation & Tarifs</h2>
              </div>
              {!editingPricing && (
                <button onClick={() => setEditingPricing(true)} className="btn-ghost p-1.5" title="Modifier"><Edit3 className="w-3.5 h-3.5" /></button>
              )}
              {editingPricing && (
                <div className="flex items-center gap-1.5">
                  <button onClick={() => { setEditingPricing(false); setPricingForm({ devis_estime: t.devis_estime || '', tarif_final: t.tarif_final || '', acompte: t.acompte || '', technicien_assigne: t.technicien_assigne || '', type_ecran: t.type_ecran || '', date_recuperation: t.date_recuperation || '', reduction_montant: t.reduction_montant || '', reduction_pourcentage: t.reduction_pourcentage || '' }); setRepairLines(parseRepairLines(t)); }} className="btn-ghost text-xs px-2.5 py-1.5"><X className="w-3.5 h-3.5" /> Annuler</button>
                  <button onClick={handleSavePricing} className="btn-primary text-xs px-2.5 py-1.5"><Save className="w-3.5 h-3.5" /> Sauver</button>
                </div>
              )}
            </div>

            {/* 1. Technicien assigné — EN HAUT */}
            <div className="mb-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
              <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-2">Technicien assigné</div>
              {isTech && !editingAssign ? (
                <div className="flex items-center gap-2">
                  {(() => {
                    const m = teamMembers.find(m => t.technicien_assigne === m.nom || (t.technicien_assigne || '').startsWith(m.nom + ' '));
                    return m ? (
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: m.couleur || '#94a3b8' }}>
                        {t.technicien_assigne?.charAt(0) || '?'}
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-lg bg-slate-300 flex items-center justify-center text-white text-xs font-bold">
                        {t.technicien_assigne?.charAt(0) || '?'}
                      </div>
                    );
                  })()}
                  <span className="text-sm font-semibold text-slate-800">{t.technicien_assigne || 'Non assigné'}</span>
                  <button onClick={() => setEditingAssign(true)} className="text-slate-400 hover:text-brand-600 ml-auto"><Edit3 className="w-3.5 h-3.5" /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {(() => {
                    const m = teamMembers.find(m => (t.technicien_assigne || '') === m.nom);
                    return (
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: m?.couleur || '#94a3b8' }}>
                        {(t.technicien_assigne || editingAssign || '?').charAt(0)}
                      </div>
                    );
                  })()}
                  {teamMembers.length > 0 ? (
                    <select
                      value={t.technicien_assigne || ''}
                      onChange={async (e) => {
                        const nom = e.target.value;
                        if (!nom) return;
                        try {
                          await api.updateTicket(id, { technicien_assigne: nom });
                          await loadTicket();
                          toast.success(`Assigné à ${nom}`);
                          setEditingAssign(false);
                        } catch { toast.error('Erreur assignation'); }
                      }}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold bg-white"
                    >
                      <option value="">— Non assigné —</option>
                      {teamMembers.map(m => <option key={m.id} value={m.nom}>{m.nom}{m.role ? ` (${m.role})` : ''}</option>)}
                    </select>
                  ) : (
                    <input type="text" value={pricingForm.technicien_assigne} onChange={e => setPricingForm(f => ({ ...f, technicien_assigne: e.target.value }))} className="flex-1 input text-sm" placeholder="Nom du technicien" />
                  )}
                </div>
              )}
              {t.personne_charge && (
                <p className="text-[10px] text-slate-400 mt-2">Prise en charge : <span className="font-medium text-slate-600">{t.personne_charge}</span></p>
              )}
            </div>

            {editingPricing ? (
              /* ─── Edit mode ─── */
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="input-label mb-0">Lignes de réparation</label>
                    <button onClick={addRepairLine} className="btn-ghost text-xs px-2 py-1"><Plus className="w-3 h-3" /> Ajouter</button>
                  </div>
                  <div className="space-y-2">
                    {repairLines.map((line, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input value={line.label} onChange={e => updateRepairLine(i, 'label', e.target.value)} className="input flex-1" placeholder="Description réparation" />
                        <div className="relative w-28 shrink-0">
                          <input type="number" step="0.01" value={line.prix} onChange={e => updateRepairLine(i, 'prix', e.target.value)} className="input text-right pr-7" placeholder="0" />
                          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">€</span>
                        </div>
                        <button onClick={() => adjustRepairPrice(i, -5)} className="btn-ghost p-1.5 shrink-0"><Minus className="w-3 h-3" /></button>
                        <button onClick={() => adjustRepairPrice(i, 5)} className="btn-ghost p-1.5 shrink-0"><Plus className="w-3 h-3" /></button>
                        {repairLines.length > 1 && <button onClick={() => removeRepairLine(i)} className="btn-ghost p-1.5 shrink-0 text-red-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>}
                      </div>
                    ))}
                  </div>
                  <div className="text-right mt-2"><span className="text-xs text-slate-400">Total :</span><span className="text-sm font-bold text-slate-800 ml-2">{formatPrix(totalRepairs)}</span></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="input-label">Devis estimé</label>
                    <div className="flex items-center gap-1">
                      <button onClick={() => adjustPrice('devis_estime', -5)} className="btn-ghost p-1.5 shrink-0"><Minus className="w-3 h-3" /></button>
                      <div className="relative flex-1"><input type="number" step="0.01" value={pricingForm.devis_estime} onChange={e => setPricingForm(f => ({ ...f, devis_estime: e.target.value }))} className="input text-center pr-7" /><span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">€</span></div>
                      <button onClick={() => adjustPrice('devis_estime', 5)} className="btn-ghost p-1.5 shrink-0"><Plus className="w-3 h-3" /></button>
                    </div>
                  </div>
                  <div>
                    <label className="input-label">Tarif final</label>
                    <div className="flex items-center gap-1">
                      <button onClick={() => adjustPrice('tarif_final', -5)} className="btn-ghost p-1.5 shrink-0"><Minus className="w-3 h-3" /></button>
                      <div className="relative flex-1"><input type="number" step="0.01" value={pricingForm.tarif_final} onChange={e => setPricingForm(f => ({ ...f, tarif_final: e.target.value }))} className="input text-center pr-7" placeholder={totalRepairs || ''} /><span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">€</span></div>
                      <button onClick={() => adjustPrice('tarif_final', 5)} className="btn-ghost p-1.5 shrink-0"><Plus className="w-3 h-3" /></button>
                    </div>
                  </div>
                  <div>
                    <label className="input-label">Acompte</label>
                    <div className="flex items-center gap-1">
                      <button onClick={() => adjustPrice('acompte', -5)} className="btn-ghost p-1.5 shrink-0"><Minus className="w-3 h-3" /></button>
                      <div className="relative flex-1"><input type="number" step="0.01" value={pricingForm.acompte} onChange={e => setPricingForm(f => ({ ...f, acompte: e.target.value }))} className="input text-center pr-7" /><span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">€</span></div>
                      <button onClick={() => adjustPrice('acompte', 5)} className="btn-ghost p-1.5 shrink-0"><Plus className="w-3 h-3" /></button>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="input-label flex items-center gap-1"><Percent className="w-3 h-3" /> Réduction (%)</label><input type="number" step="1" min="0" max="100" value={pricingForm.reduction_pourcentage} onChange={e => setPricingForm(f => ({ ...f, reduction_pourcentage: e.target.value, reduction_montant: '' }))} className="input" placeholder="0" /></div>
                  <div><label className="input-label">Réduction (€)</label><div className="relative"><input type="number" step="0.01" value={pricingForm.reduction_montant} onChange={e => setPricingForm(f => ({ ...f, reduction_montant: e.target.value, reduction_pourcentage: '' }))} className="input pr-7" placeholder="0" /><span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">€</span></div></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="input-label">Qualité écran</label>
                    <select value={pricingForm.type_ecran} onChange={e => setPricingForm(f => ({ ...f, type_ecran: e.target.value }))} className="input">
                      <option value="">—</option>
                      <option value="Original">Original (OEM)</option>
                      <option value="Original reconditionné">Original reconditionné</option>
                      <option value="Compatible Premium">Compatible Premium</option>
                      <option value="Compatible">Compatible</option>
                      <option value="OLED">OLED</option>
                      <option value="OLED Premium">OLED Premium</option>
                      <option value="Incell">Incell</option>
                      <option value="LCD">LCD</option>
                    </select>
                  </div>
                  <div><label className="input-label">Date récupération</label><input type="text" value={pricingForm.date_recuperation} onChange={e => setPricingForm(f => ({ ...f, date_recuperation: e.target.value }))} className="input" placeholder="Ex: demain 14h, lundi..." /></div>
                </div>
              </div>
            ) : (
              /* ─── View mode ─── */
              <>
                {/* Pièces commandées */}
                {commandes.length > 0 && (
                  <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="text-[11px] font-bold text-amber-800 uppercase tracking-wider mb-2 flex items-center gap-1">
                      <Package className="w-3 h-3" /> Pièce(s) commandée(s)
                    </div>
                    {commandes.map(cmd => (
                      <div key={cmd.id} className="flex items-center justify-between py-1.5 border-b border-amber-100 last:border-0">
                        <div>
                          <div className="text-sm font-semibold text-slate-700">{cmd.description}</div>
                          {cmd.notes && <div className="text-xs text-slate-500">{cmd.notes}</div>}
                          {cmd.fournisseur && <div className="text-xs text-slate-400">Fournisseur : {cmd.fournisseur}</div>}
                        </div>
                        <div className="flex items-center gap-2">
                          {cmd.prix > 0 && (
                            <span className="text-sm font-bold">{formatPrix(cmd.prix)}</span>
                          )}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            cmd.statut === 'En attente' ? 'bg-amber-100 text-amber-700' :
                            cmd.statut === 'Commandée' ? 'bg-blue-100 text-blue-700' :
                            cmd.statut === 'Expédiée' ? 'bg-purple-100 text-purple-700' :
                            cmd.statut === 'Reçue' ? 'bg-green-100 text-green-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {cmd.statut}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 2. Repair lines */}
                <div className="mb-3">
                  {repairLines.filter(l => l.label).map((line, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-700">{line.label}</span>
                        {t.type_ecran && i === 0 && (
                          <span className="text-[10px] font-semibold text-violet-600 bg-violet-50 px-2 py-0.5 rounded">{t.type_ecran}</span>
                        )}
                      </div>
                      <span className="text-sm font-bold text-slate-800">{formatPrix(line.prix)}</span>
                    </div>
                  ))}
                  {repairLines.filter(l => l.label).length === 0 && (
                    <p className="text-sm text-slate-400 italic py-2">Aucune réparation enregistrée</p>
                  )}
                </div>

                {/* 3. Reduction */}
                {effectiveReduction > 0 && (
                  <div className="flex justify-between py-1 text-sm text-emerald-600">
                    <span className="flex items-center gap-1"><Percent className="w-3 h-3" /> Réduction{reductionPct > 0 ? ` (${reductionPct}%)` : ''}</span>
                    <span className="font-medium">- {formatPrix(effectiveReduction)}</span>
                  </div>
                )}

                {/* 4. Totals */}
                <div className="border-t border-slate-200 mt-2 pt-2 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">{tvaRate > 0 ? 'Sous-total HT' : 'Tarif final'}</span>
                    <span className="font-semibold text-slate-800">{formatPrix(subtotalHT)}</span>
                  </div>
                  {tvaRate > 0 && (
                    <>
                      <div className="flex justify-between text-sm"><span className="text-slate-500">TVA ({tvaRate}%)</span><span className="font-medium text-slate-600">{formatPrix(tvaAmount)}</span></div>
                      <div className="flex justify-between text-sm font-bold border-t border-slate-200 pt-2"><span className="text-slate-800">Total TTC</span><span className="text-slate-900">{formatPrix(totalTTC)}</span></div>
                    </>
                  )}
                  <div className="flex justify-between text-sm"><span className="text-slate-500">Acompte versé</span><span className="font-medium text-slate-800">- {t.acompte ? formatPrix(t.acompte) : '0,00 €'}</span></div>
                </div>

                {/* 5. Reste à payer */}
                {reste > 0 && (
                  <div className="flex justify-between mt-3 px-4 py-3 rounded-xl bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200">
                    <span className="font-extrabold text-emerald-700 text-[15px]">RESTE À PAYER</span>
                    <span className="font-extrabold text-emerald-700 text-[15px]">{formatPrix(reste)}</span>
                  </div>
                )}

                {/* 6. Action buttons */}
                <div className="flex gap-2 mt-3 flex-wrap">
                  <button onClick={handleTogglePaye}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      t.paye ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                    }`}>
                    <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />{t.paye ? 'Payé ✓' : 'Marquer payé'}
                  </button>
                  <button onClick={handleSendCaisse} className="px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold border border-slate-200 hover:bg-slate-200">
                    <Zap className="w-3.5 h-3.5 inline mr-1" />Envoyer en caisse
                  </button>
                  <button onClick={() => setShowAccordModal(true)} className="px-3 py-2 rounded-lg bg-orange-50 text-orange-600 text-xs font-semibold border border-orange-200 hover:bg-orange-100">
                    <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />Accord client
                  </button>
                </div>
              </>
            )}
          </div>
        );

      case 'status':
        return (
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: getStatusConfig(t.statut).color + '20' }}>
                <ChevronDown className="w-4 h-4" style={{ color: getStatusConfig(t.statut).color }} />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Changer le statut</h2>
            </div>
            <select
              value={t.statut}
              onChange={e => handleStatusChange(e.target.value)}
              className="w-full py-3 px-4 text-base font-semibold rounded-xl border-2 transition-colors cursor-pointer appearance-none bg-no-repeat"
              style={{
                borderColor: getStatusConfig(t.statut).color,
                color: getStatusConfig(t.statut).color,
                backgroundColor: getStatusConfig(t.statut).color + '10',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(getStatusConfig(t.statut).color)}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundPosition: 'right 12px center',
                backgroundSize: '20px',
              }}
            >
              {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={() => { setShowDeleteModal(true); setDeleteCode(''); setDeleteError(''); }}
              className="w-full mt-3 py-2.5 px-4 rounded-xl border-2 border-red-200 text-red-500 text-sm font-semibold hover:bg-red-50 hover:border-red-300 transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> Supprimer le ticket
            </button>
          </div>
        );

      case 'fidelite':
        return t.client_id && !isTech ? <FideliteCard clientId={t.client_id} /> : null;

      default:
        return null;
    }
  };

  const renderBlock = (block) => {
    const content = renderBlockContent(block.id);
    if (!content) return null;

    if (!layoutEditMode) {
      return <div key={block.id}>{content}</div>;
    }

    const sizeLabel = block.size === 'compact' ? 'S' : block.size === 'large' ? 'L' : 'M';

    return (
      <div
        key={block.id}
        draggable
        onDragStart={() => setDragId(block.id)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleLayoutDrop(block.id); }}
        className={`relative group rounded-xl transition-all ${
          dragId === block.id ? 'opacity-40 scale-[0.98]' : ''
        } ${layoutEditMode ? 'ring-2 ring-dashed ring-slate-200 hover:ring-brand-400' : ''}`}
      >
        <div className="absolute -top-3 left-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <span className="px-2 py-0.5 bg-brand-600 text-white text-[10px] rounded-full font-medium cursor-grab active:cursor-grabbing shadow-sm">
            ⠿ {block.title}
          </span>
          <button onClick={() => cycleSize(block.id)}
            className="px-1.5 py-0.5 bg-slate-700 text-white text-[10px] rounded-full hover:bg-slate-600 shadow-sm">
            {sizeLabel}
          </button>
          <button onClick={() => moveToCol(block.id, block.col === 'left' ? 'right' : 'left')}
            className="px-1.5 py-0.5 bg-slate-700 text-white text-[10px] rounded-full hover:bg-slate-600 shadow-sm">
            {block.col === 'left' ? '→' : '←'}
          </button>
        </div>
        <div className={block.size === 'compact' ? 'max-h-52 overflow-hidden' : ''}>
          {content}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Dark Header — spacious */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 text-white px-4 sm:px-6 lg:px-8 py-8 sm:py-10 -mx-4 sm:-mx-6 lg:-mx-8 -mt-4 sm:-mt-6 lg:-mt-8 mb-6">
        <div className="max-w-7xl mx-auto">
          {/* Top row: back button */}
          <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors mb-5 -ml-1">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs font-medium">Retour</span>
          </button>

          <div className="flex flex-col sm:flex-row sm:items-start gap-5">
            {/* Left: ticket info */}
            <div className="flex-1 min-w-0 space-y-3">
              {/* Ticket code */}
              <div className="flex items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-display font-bold text-white font-mono tracking-tight">{t.ticket_code}</h1>
                <button onClick={handleCopyCode} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors" title="Copier le code">
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                </button>
                {t.paye && (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Payé
                  </span>
                )}
              </div>

              {/* Summary line */}
              <div className="text-sm text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="flex items-center gap-1"><User className="w-3.5 h-3.5 text-slate-500" /> {t.client_prenom || ''} {t.client_nom || ''}</span>
                <span className="text-slate-600">•</span>
                <span className="flex items-center gap-1"><Smartphone className="w-3.5 h-3.5 text-slate-500" /> {appareil || '—'}</span>
                <span className="text-slate-600">•</span>
                <span className="flex items-center gap-1">
                  <Wrench className="w-3.5 h-3.5 text-slate-500" />
                  {repairLines.filter(l => l.label).length > 0
                    ? repairLines.filter(l => l.label).map(l => l.label).join(' + ')
                    : (t.panne || '—')}
                </span>
                <span className="text-slate-600">•</span>
                <span className="font-semibold text-emerald-400">{formatPrix(totalTTC || 0)}</span>
                {t.paye && <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">Payé</span>}
                {!t.paye && reste > 0 && <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full">Reste {formatPrix(reste)}</span>}
              </div>
              {t.client_tel && (
                <a href={`tel:${t.client_tel}`} className="text-sm text-slate-400 hover:text-white font-mono transition-colors">{t.client_tel}</a>
              )}
            </div>

            {/* Right: status badge + print */}
            <div className="flex sm:flex-col items-center sm:items-end gap-3 shrink-0">
              <StatusBadge statut={t.statut} size="lg" />
              <button onClick={() => setShowPrintDrawer(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white text-sm font-medium transition-colors">
                <Printer className="w-4 h-4" /> Imprimer
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Accord client modal */}
      {showAccordModal && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={() => setShowAccordModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-bold text-slate-900">Demander accord client</h3>
                  <p className="text-sm text-slate-500">Réparation supplémentaire</p>
                </div>
              </div>

              <div className="space-y-3 mb-5">
                <div>
                  <label className="input-label">Réparation supplémentaire</label>
                  <input type="text"
                    value={accordForm.reparation}
                    onChange={e => setAccordForm(f => ({ ...f, reparation: e.target.value }))}
                    className="input" placeholder="Ex: changement batterie"
                  />
                </div>
                <div>
                  <label className="input-label">Prix supplémentaire</label>
                  <div className="relative">
                    <input type="number" step="0.01"
                      value={accordForm.prix}
                      onChange={e => setAccordForm(f => ({ ...f, prix: e.target.value }))}
                      className="input pr-7" placeholder="0.00"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">€</span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-400 mb-4">
                Le statut passera à "En attente d'accord client" et un message WhatsApp sera envoyé.
              </p>

              <div className="flex gap-2">
                <button onClick={() => setShowAccordModal(false)} className="btn-ghost flex-1">Annuler</button>
                <button onClick={handleDemanderAccord} disabled={accordLoading}
                  className="btn-primary flex-1 bg-orange-600 hover:bg-orange-700">
                  {accordLoading ? 'Envoi...' : 'Envoyer la demande'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Téléphone de prêt modal */}
      {showPretModal && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={() => setShowPretModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                  <PhoneCall className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-bold text-slate-900">Téléphone de prêt</h3>
                  <p className="text-sm text-slate-500">Ce client a un téléphone de prêt !</p>
                </div>
              </div>
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl mb-4">
                <p className="text-sm font-semibold text-amber-800">
                  Téléphone prêté : {ticket.telephone_pret}
                </p>
                {ticket.telephone_pret_imei && (
                  <p className="text-xs text-amber-600 font-mono mt-1">IMEI : {ticket.telephone_pret_imei}</p>
                )}
                <p className="text-xs text-amber-700 mt-2 font-medium">
                  Pensez à récupérer le téléphone de prêt avant de rendre l'appareil au client !
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowPretModal(false)} className="btn-ghost flex-1">Annuler</button>
                <button onClick={confirmRenduWithPret} className="btn-primary flex-1">
                  Téléphone récupéré, rendre au client
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Rendu au client — payment modal */}
      {showRenduModal && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={() => setShowRenduModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-bold text-slate-900">Rendu au client</h3>
                  <p className="text-sm text-slate-500">Le client a-t-il réglé ?</p>
                </div>
              </div>

              {reste > 0 && (
                <div className="p-4 bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 rounded-xl mb-5 text-center">
                  <p className="text-xs text-emerald-600 font-medium mb-1">Reste à payer</p>
                  <p className="text-2xl font-extrabold text-emerald-700">{formatPrix(reste)}</p>
                </div>
              )}

              <div className="space-y-2">
                <button onClick={handleRenduPaye}
                  className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Oui, payé
                </button>
                <button onClick={handleRenduNonPaye}
                  className="w-full py-3 px-4 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-sm font-bold border border-red-200 transition-colors flex items-center justify-center gap-2">
                  <X className="w-4 h-4" /> Non, pas payé
                </button>
                <button onClick={() => setShowRenduModal(false)}
                  className="w-full py-2.5 px-4 rounded-xl text-slate-400 hover:text-slate-600 text-sm font-medium transition-colors flex items-center justify-center gap-1">
                  <ArrowLeft className="w-3.5 h-3.5" /> Annuler
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Delete ticket modal */}
      {showDeleteModal && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={() => setShowDeleteModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-bold text-slate-900">Supprimer le ticket</h3>
                  <p className="text-sm text-slate-500">{t.ticket_code}</p>
                </div>
              </div>
              <p className="text-sm text-slate-600 mb-4">
                Cette action est irréversible. Toutes les données liées (notes, commandes, historique) seront supprimées.
              </p>
              <div className="mb-4">
                <label className="input-label">Code administrateur</label>
                <input
                  type="password"
                  value={deleteCode}
                  onChange={e => { setDeleteCode(e.target.value); setDeleteError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleDeleteTicket()}
                  className="input"
                  placeholder="Entrez le code admin"
                  autoFocus
                />
                {deleteError && (
                  <p className="text-xs text-red-500 mt-1 font-medium">{deleteError}</p>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowDeleteModal(false)} className="btn-ghost flex-1">Annuler</button>
                <button
                  onClick={handleDeleteTicket}
                  disabled={deleting || !deleteCode}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? 'Suppression...' : 'Supprimer'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="px-4 sm:px-6 lg:px-8">
      {/* Attention card — shows when attention field set OR important private notes exist */}
      {(() => {
        const importantNotes = privateNotes.filter(n => n.important);
        const hasAttention = showAttention || importantNotes.length > 0;
        if (!hasAttention) return null;
        return (
          <div className="flex items-start gap-3 p-4 mb-5 rounded-xl bg-red-50 border border-red-200 shadow-sm animate-in">
            <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm font-bold text-red-800">Note importante</p>
              {t.attention && (
                <p className="text-sm text-red-700">{t.attention}</p>
              )}
              {importantNotes.map(note => (
                <p key={note.id} className="text-sm text-red-700">
                  <span className="font-semibold">{note.auteur} :</span> {note.contenu}
                </p>
              ))}
              {!t.attention && importantNotes.length === 0 && (
                <p className="text-sm text-red-700">Ce ticket nécessite une attention particulière</p>
              )}
            </div>
            <button onClick={() => setShowAttention(false)} className="shrink-0 p-1 rounded-lg text-red-300 hover:text-red-600 hover:bg-red-100 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })()}

      {/* Progress tracker */}
      <div className="card p-5 mb-6">
        <ProgressTracker statut={t.statut} hasPiece={t.commande_piece === 1} />
      </div>

      {/* Layout toolbar */}
      <div className="flex items-center gap-2 mb-5">
        <button
          onClick={() => setLayoutEditMode(!layoutEditMode)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            layoutEditMode ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <Edit3 className="w-3.5 h-3.5" />
          {layoutEditMode ? 'Mode édition' : 'Personnaliser'}
        </button>
        {layoutEditMode && (
          <>
            <button onClick={saveLayout} className="btn-primary text-xs px-3 py-1.5">
              <Save className="w-3.5 h-3.5" /> Sauver
            </button>
            <button onClick={resetLayout} className="btn-ghost text-xs px-3 py-1.5">
              Réinitialiser
            </button>
          </>
        )}
      </div>

      {layoutEditMode && (
        <div className="p-3 mb-5 rounded-lg bg-brand-50 border border-brand-200 text-xs text-brand-700">
          Glissez-déposez les blocs pour réorganiser. Cliquez S/M/L pour changer la taille, les flèches pour déplacer entre colonnes.
        </div>
      )}

      {/* Content grid — dynamic layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-5">
        <div className="space-y-5">
          {blocks.filter(b => b.col === 'left').sort((a, b) => a.order - b.order).map(renderBlock)}
        </div>
        <div className="space-y-5">
          {blocks.filter(b => b.col === 'right').sort((a, b) => a.order - b.order).map(renderBlock)}
        </div>
      </div>
      </div>

      {/* Print Drawer */}
      <PrintDrawer
        open={showPrintDrawer}
        onClose={() => setShowPrintDrawer(false)}
        ticketId={id}
        ticketCode={t.ticket_code}
        clientTel={t.client_tel}
        clientEmail={t.client_email}
      />
    </div>
  );
}
