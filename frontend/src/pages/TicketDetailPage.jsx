import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import ProgressTracker from '../components/ProgressTracker';
import PatternGrid from '../components/PatternGrid';
import { formatDate, formatPrix, STATUTS, waLink, smsLink, getStatusConfig, MESSAGE_TEMPLATES } from '../lib/utils';
import {
  ArrowLeft, Phone, Mail, MessageCircle, Send, Save, Trash2,
  ChevronDown, Plus, Minus, Clock, User, Wrench, CreditCard,
  FileText, Printer, ExternalLink, Lock, Eye, Copy, Check,
  AlertTriangle, Smartphone, Hash, Shield, Calendar, UserCheck,
  MessageSquare, Zap,
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
  const [notePrivate, setNotePrivate] = useState(true);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [editFields, setEditFields] = useState({});
  const [copied, setCopied] = useState(false);

  // Message composer state
  const [showMessageComposer, setShowMessageComposer] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [messageText, setMessageText] = useState('');
  const [messageLoading, setMessageLoading] = useState(false);

  // Print state
  const [showPrintMenu, setShowPrintMenu] = useState(false);

  const loadTicket = useCallback(async () => {
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
  }, [id]);

  useEffect(() => { loadTicket(); }, [loadTicket]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = {};
      for (const [k, v] of Object.entries(editFields)) {
        if (v !== '' && v !== null && v !== undefined) {
          updates[k] = ['devis_estime', 'tarif_final', 'acompte', 'prix_supp'].includes(k)
            ? parseFloat(v) || 0
            : v;
        } else {
          updates[k] = null;
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
      const prefix = notePrivate ? '[INTERNE]' : '[CLIENT]';
      await api.addNote(id, `${prefix} ${noteText}`);
      setNoteText('');
      await loadTicket();
    } catch (err) {
      console.error(err);
    }
  };

  const adjustPrice = (field, delta) => {
    setEditFields(f => ({
      ...f,
      [field]: Math.max(0, (parseFloat(f[field]) || 0) + delta).toString(),
    }));
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(ticket.ticket_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGenerateMessage = async (templateKey) => {
    setSelectedTemplate(templateKey);
    setMessageLoading(true);
    try {
      const result = await api.generateMessage(id, templateKey);
      setMessageText(result.message || result);
    } catch (err) {
      console.error(err);
    } finally {
      setMessageLoading(false);
    }
  };

  const handleSendWhatsApp = async () => {
    if (!messageText || !ticket.client_tel) return;
    try {
      const result = await api.sendWhatsApp(id, messageText);
      if (result?.url) window.open(result.url, '_blank');
      else window.open(waLink(ticket.client_tel, messageText), '_blank');
      await loadTicket();
    } catch {
      window.open(waLink(ticket.client_tel, messageText), '_blank');
    }
  };

  const handleSendSMS = async () => {
    if (!messageText || !ticket.client_tel) return;
    try {
      await api.sendSMS(id, messageText);
      window.open(smsLink(ticket.client_tel, messageText), '_blank');
      await loadTicket();
    } catch {
      window.open(smsLink(ticket.client_tel, messageText), '_blank');
    }
  };

  const handleSendEmail = async () => {
    if (!messageText || !ticket.client_email) return;
    try {
      await api.sendEmail(id, messageText, `Ticket ${ticket.ticket_code} — Klikphone`);
      await loadTicket();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSendCaisse = async () => {
    try {
      await api.sendToCaisse(id);
    } catch (err) {
      console.error(err);
    }
  };

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
  const reste = (parseFloat(editFields.tarif_final) || 0) - (parseFloat(editFields.acompte) || 0);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2.5 mt-0.5 shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-display font-bold text-brand-600 font-mono tracking-tight">{t.ticket_code}</h1>
            <button onClick={handleCopyCode} className="p-1 rounded hover:bg-slate-100 transition-colors" title="Copier le code">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
            </button>
            <StatusBadge statut={t.statut} size="lg" />
          </div>
          <p className="text-sm text-slate-500 mt-1 truncate">
            {appareil} — {t.panne}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Print menu */}
          <div className="relative">
            <button onClick={() => setShowPrintMenu(!showPrintMenu)} className="btn-ghost p-2.5" title="Imprimer">
              <Printer className="w-4 h-4" />
            </button>
            {showPrintMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowPrintMenu(false)} />
                <div className="absolute right-0 top-full mt-2 w-56 card p-1.5 shadow-xl z-50 animate-in">
                  {[
                    { type: 'client', label: 'Ticket client', desc: 'Reçu 80mm' },
                    { type: 'staff', label: 'Fiche atelier', desc: 'Fiche technique' },
                    { type: 'combined', label: 'Les deux', desc: 'Client + Atelier' },
                    { type: 'devis', label: 'Devis A4', desc: 'Document PDF' },
                    { type: 'recu', label: 'Reçu A4', desc: 'Reçu de paiement' },
                  ].map(p => (
                    <a key={p.type}
                      href={api.getPrintUrl(id, p.type)}
                      target="_blank" rel="noopener noreferrer"
                      onClick={() => setShowPrintMenu(false)}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-slate-50 transition-colors"
                    >
                      <FileText className="w-4 h-4 text-slate-400" />
                      <div>
                        <p className="font-medium text-slate-700">{p.label}</p>
                        <p className="text-[11px] text-slate-400">{p.desc}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Status dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowStatusMenu(!showStatusMenu)}
              className="btn-primary"
            >
              Statut <ChevronDown className={`w-4 h-4 transition-transform ${showStatusMenu ? 'rotate-180' : ''}`} />
            </button>
            {showStatusMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowStatusMenu(false)} />
                <div className="absolute right-0 top-full mt-2 w-72 card p-1.5 shadow-xl z-50 animate-in">
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
      </div>

      {/* Progress tracker */}
      <div className="card p-5 mb-6">
        <ProgressTracker statut={t.statut} />
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ─── Left column (2/3) ─── */}
        <div className="lg:col-span-2 space-y-5">
          {/* Device info */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
                <Smartphone className="w-4 h-4 text-brand-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Appareil</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
              {[
                { label: 'Catégorie', value: t.categorie, icon: null },
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

            {/* PIN / Pattern */}
            {(t.pin || t.pattern) && (
              <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-6">
                {t.pin && (
                  <div>
                    <p className="text-slate-400 text-xs mb-1 flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Code PIN
                    </p>
                    <p className="text-lg font-bold font-mono text-slate-800 tracking-widest">{t.pin}</p>
                  </div>
                )}
                {t.pattern && (
                  <div>
                    <p className="text-slate-400 text-xs mb-1 flex items-center gap-1">
                      <Shield className="w-3 h-3" /> Pattern
                    </p>
                    <PatternGrid value={t.pattern} readOnly size={120} />
                  </div>
                )}
              </div>
            )}

            {/* Client notes */}
            {t.notes_client && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-lg text-sm text-amber-800">
                <span className="font-semibold">Note client :</span> {t.notes_client}
              </div>
            )}
          </div>

          {/* Pricing */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                </div>
                <h2 className="text-sm font-semibold text-slate-800">Tarification</h2>
              </div>
              {reste > 0 && (
                <div className="text-right">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">Reste à payer</p>
                  <p className="text-lg font-bold text-brand-600">{formatPrix(reste)}</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {/* Devis */}
              <div>
                <label className="input-label">Devis estimé</label>
                <div className="flex items-center gap-1">
                  <button onClick={() => adjustPrice('devis_estime', -5)} className="btn-ghost p-1.5 shrink-0">
                    <Minus className="w-3 h-3" />
                  </button>
                  <div className="relative flex-1">
                    <input type="number" step="0.01"
                      value={editFields.devis_estime}
                      onChange={e => setEditFields(f => ({ ...f, devis_estime: e.target.value }))}
                      className="input text-center pr-7"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">€</span>
                  </div>
                  <button onClick={() => adjustPrice('devis_estime', 5)} className="btn-ghost p-1.5 shrink-0">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Tarif final */}
              <div>
                <label className="input-label">Tarif final</label>
                <div className="flex items-center gap-1">
                  <button onClick={() => adjustPrice('tarif_final', -5)} className="btn-ghost p-1.5 shrink-0">
                    <Minus className="w-3 h-3" />
                  </button>
                  <div className="relative flex-1">
                    <input type="number" step="0.01"
                      value={editFields.tarif_final}
                      onChange={e => setEditFields(f => ({ ...f, tarif_final: e.target.value }))}
                      className="input text-center pr-7"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">€</span>
                  </div>
                  <button onClick={() => adjustPrice('tarif_final', 5)} className="btn-ghost p-1.5 shrink-0">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Acompte */}
              <div>
                <label className="input-label">Acompte</label>
                <div className="flex items-center gap-1">
                  <button onClick={() => adjustPrice('acompte', -5)} className="btn-ghost p-1.5 shrink-0">
                    <Minus className="w-3 h-3" />
                  </button>
                  <div className="relative flex-1">
                    <input type="number" step="0.01"
                      value={editFields.acompte}
                      onChange={e => setEditFields(f => ({ ...f, acompte: e.target.value }))}
                      className="input text-center pr-7"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">€</span>
                  </div>
                  <button onClick={() => adjustPrice('acompte', 5)} className="btn-ghost p-1.5 shrink-0">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Réparation supp */}
              <div>
                <label className="input-label">Réparation supp.</label>
                <input type="text"
                  value={editFields.reparation_supp}
                  onChange={e => setEditFields(f => ({ ...f, reparation_supp: e.target.value }))}
                  className="input"
                  placeholder="Ex: changement batterie"
                />
              </div>

              {/* Prix supp */}
              <div>
                <label className="input-label">Prix supp.</label>
                <div className="relative">
                  <input type="number" step="0.01"
                    value={editFields.prix_supp}
                    onChange={e => setEditFields(f => ({ ...f, prix_supp: e.target.value }))}
                    className="input pr-7"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">€</span>
                </div>
              </div>

              {/* Type écran */}
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

            <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
              <button onClick={handleSendCaisse} className="btn-ghost text-xs gap-1.5">
                <Zap className="w-3.5 h-3.5" /> Envoyer en caisse
              </button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                <Save className="w-4 h-4" />
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>

          {/* Notes */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                <FileText className="w-4 h-4 text-amber-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Notes</h2>
            </div>

            {t.notes_internes && (
              <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
                {t.notes_internes.split('\n').filter(Boolean).map((line, i) => {
                  const isInternal = line.includes('[INTERNE]');
                  const cleanLine = line.replace('[INTERNE] ', '').replace('[CLIENT] ', '');
                  return (
                    <div key={i} className={`flex items-start gap-2.5 text-sm p-2.5 rounded-lg ${
                      isInternal ? 'bg-slate-50' : 'bg-blue-50'
                    }`}>
                      {isInternal
                        ? <Lock className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                        : <Eye className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                      }
                      <p className={isInternal ? 'text-slate-600' : 'text-blue-700'}>{cleanLine}</p>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex gap-2">
              <div className="flex-1 flex gap-2">
                <button
                  onClick={() => setNotePrivate(!notePrivate)}
                  className={`shrink-0 p-2.5 rounded-lg border transition-colors ${
                    notePrivate
                      ? 'bg-slate-50 border-slate-200 text-slate-500'
                      : 'bg-blue-50 border-blue-200 text-blue-500'
                  }`}
                  title={notePrivate ? 'Note interne' : 'Note visible client'}
                >
                  {notePrivate ? <Lock className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <input
                  type="text"
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                  placeholder={notePrivate ? 'Note interne...' : 'Note visible par le client...'}
                  className="input flex-1"
                />
              </div>
              <button onClick={handleAddNote} className="btn-primary px-3">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Message Composer */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-green-600" />
                </div>
                <h2 className="text-sm font-semibold text-slate-800">Messages client</h2>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                {t.msg_whatsapp ? <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-600">WA</span> : null}
                {t.msg_sms ? <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">SMS</span> : null}
                {t.msg_email ? <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-600">Email</span> : null}
              </div>
            </div>

            {/* Template buttons */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {MESSAGE_TEMPLATES.map(tmpl => (
                <button
                  key={tmpl.key}
                  onClick={() => handleGenerateMessage(tmpl.key)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    selectedTemplate === tmpl.key
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tmpl.label}
                </button>
              ))}
            </div>

            {/* Message textarea */}
            <textarea
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              placeholder="Sélectionnez un modèle ou tapez votre message..."
              rows={4}
              className="input resize-none mb-3"
              disabled={messageLoading}
            />

            {/* Send buttons */}
            <div className="flex flex-wrap gap-2">
              {t.client_tel && (
                <button onClick={handleSendWhatsApp} disabled={!messageText}
                  className="btn-whatsapp text-xs">
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                </button>
              )}
              {t.client_tel && (
                <button onClick={handleSendSMS} disabled={!messageText}
                  className="btn-secondary text-xs">
                  <Send className="w-3.5 h-3.5" /> SMS
                </button>
              )}
              {t.client_email && (
                <button onClick={handleSendEmail} disabled={!messageText}
                  className="btn-ghost text-xs border border-slate-200">
                  <Mail className="w-3.5 h-3.5" /> Email
                </button>
              )}
            </div>
          </div>

          {/* History */}
          {t.historique && (
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                  <Clock className="w-4 h-4 text-slate-500" />
                </div>
                <h2 className="text-sm font-semibold text-slate-800">Historique</h2>
              </div>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {t.historique.split('\n').filter(Boolean).reverse().map((line, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm py-1.5">
                    <div className="w-2 h-2 rounded-full bg-slate-300 mt-1.5 shrink-0" />
                    <p className="text-slate-600 text-[13px]">{line}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── Right column (1/3) ─── */}
        <div className="space-y-5">
          {/* Client info */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <User className="w-4 h-4 text-blue-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Client</h2>
            </div>

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

            {/* Quick contact buttons */}
            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-2">
              {t.client_tel && (
                <a
                  href={waLink(t.client_tel, `Bonjour, concernant votre ticket ${t.ticket_code}...`)}
                  target="_blank" rel="noopener noreferrer"
                  className="btn-whatsapp text-xs py-2"
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
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                <Calendar className="w-4 h-4 text-slate-500" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Dates</h2>
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
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
                <UserCheck className="w-4 h-4 text-violet-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Assignation</h2>
            </div>
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
              <div className="mt-3 p-2.5 bg-slate-50 rounded-lg">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Prise en charge</p>
                <p className="text-sm font-medium text-slate-800">{t.personne_charge}</p>
              </div>
            )}
          </div>

          {/* Quick print */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                <Printer className="w-4 h-4 text-slate-500" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Impressions</h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <a href={api.getPrintUrl(id, 'client')} target="_blank" rel="noopener noreferrer"
                className="btn-ghost text-xs py-2 border border-slate-200 justify-center">
                Ticket client
              </a>
              <a href={api.getPrintUrl(id, 'staff')} target="_blank" rel="noopener noreferrer"
                className="btn-ghost text-xs py-2 border border-slate-200 justify-center">
                Fiche atelier
              </a>
              <a href={api.getPrintUrl(id, 'devis')} target="_blank" rel="noopener noreferrer"
                className="btn-ghost text-xs py-2 border border-slate-200 justify-center">
                Devis A4
              </a>
              <a href={api.getPrintUrl(id, 'recu')} target="_blank" rel="noopener noreferrer"
                className="btn-ghost text-xs py-2 border border-slate-200 justify-center">
                Reçu A4
              </a>
            </div>
          </div>

          {/* Danger zone */}
          <div className="card p-5 border-red-100">
            <button
              onClick={async () => {
                if (confirm('Supprimer ce ticket définitivement ?')) {
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
