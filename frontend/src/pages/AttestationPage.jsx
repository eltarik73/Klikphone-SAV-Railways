import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../components/Toast';
import PrintPreview from '../components/PrintPreview';
import ModelCombobox from '../components/ModelCombobox';
import { useCatalog } from '../hooks/useCatalog';
import { normKey } from '../lib/catalog';
import { waLink } from '../lib/utils';
import {
  FileText, Mail, Printer, AlertTriangle, Search,
  Check, Loader2, UserPlus, Users, Smartphone,
  MessageCircle, X, Download,
} from 'lucide-react';

// Accent-insensitive search helper
function normalize(str) {
  return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export default function AttestationPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';

  // Client mode
  const [clientMode, setClientMode] = useState('new'); // 'new' or 'existing'
  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const searchRef = useRef(null);

  // Form
  const [form, setForm] = useState({
    nom: '', prenom: '', adresse: '',
    marque: '', modele: '', imei: '',
    etat: '', motif: '', compte_rendu: '',
  });
  const [email, setEmail] = useState('');
  const [telephone, setTelephone] = useState('');
  const [htmlPreview, setHtmlPreview] = useState('');
  const previewRef = useRef(null);
  const [previewReady, setPreviewReady] = useState(false);
  const previewDocuments = useMemo(() => (htmlPreview ? [{
    id: 'attestation',
    label: 'Attestation',
    desc: 'Attestation de non-réparabilité',
    formats: { a4: { paper: 'a4', label: 'A4', source: { kind: 'html', html: htmlPreview } } },
  }] : []), [htmlPreview]);
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Catalog data
  const [categories] = useState(['Smartphone', 'Tablette', 'PC Portable', 'Console', 'Autre']);
  const [selectedCategorie, setSelectedCategorie] = useState('Smartphone');
  // Marque hors catalogue (option "Autre") : marque et modèle en saisie libre
  const [marqueManual, setMarqueManual] = useState(false);
  const catalogue = useCatalog(selectedCategorie, marqueManual ? '' : form.marque);
  // Marque d'une attestation rechargée, rapprochée du catalogue une fois celui-ci chargé
  const [marqueARapprocher, setMarqueARapprocher] = useState(null);
  // Format d'envoi par email : 'pdf' ou 'word'
  const [emailFormat, setEmailFormat] = useState('pdf');

  const etats = ['Bon état', 'Écran cassé', 'Traces d\'oxydation', 'Très endommagé', 'Autre'];

  const updateForm = (field, value) => setForm(f => ({ ...f, [field]: value }));

  // Les attestations ne stockent pas de catégorie : rapprochement sur la catégorie affichée.
  // Marque connue (casse ignorée) → liste, avec le libellé du catalogue ; sinon saisie libre.
  useEffect(() => {
    if (marqueARapprocher === null || catalogue.loading) return;
    const key = normKey(marqueARapprocher);
    const connue = key ? catalogue.marques.find(m => normKey(m) === key) : null;
    setMarqueManual(!!key && !connue);
    if (connue && connue !== marqueARapprocher) setForm(f => ({ ...f, marque: connue }));
    setMarqueARapprocher(null);
  }, [marqueARapprocher, catalogue.loading, catalogue.marques]);

  // Client search with debounce
  useEffect(() => {
    if (clientMode !== 'existing' || clientSearch.length < 2) {
      setClientResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setClientSearchLoading(true);
      try {
        const results = await api.getClients({ search: clientSearch, limit: 10 });
        setClientResults(results);
        setShowClientDropdown(true);
      } catch { setClientResults([]); }
      finally { setClientSearchLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [clientSearch, clientMode]);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowClientDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelectClient = (client) => {
    setSelectedClient(client);
    setForm(f => ({
      ...f,
      nom: client.nom || '',
      prenom: client.prenom || '',
    }));
    setEmail(client.email || '');
    setTelephone(client.telephone || '');
    setClientSearch(`${client.prenom || ''} ${client.nom || ''}`.trim());
    setShowClientDropdown(false);
  };

  const handleClearClient = () => {
    setSelectedClient(null);
    setClientSearch('');
    setForm(f => ({ ...f, nom: '', prenom: '' }));
    setEmail('');
    setTelephone('');
  };

  const getPayload = () => ({
    ...form,
    telephone,
    email,
    client_id: selectedClient?.id || null,
  });

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const data = await api.getAttestationHistory();
      setHistory(data);
    } catch { setHistory([]); }
    finally { setHistoryLoading(false); }
  };

  const handleReload = async (att) => {
    setForm({
      nom: att.nom || '', prenom: att.prenom || '', adresse: att.adresse || '',
      marque: att.marque || '', modele: att.modele || '', imei: att.imei || '',
      etat: att.etat || '', motif: att.motif || '', compte_rendu: att.compte_rendu || '',
    });
    // Le modèle hors catalogue bascule seul en saisie libre dans ModelCombobox
    setMarqueARapprocher(att.marque || '');
    setEmail(att.email || '');
    setTelephone(att.telephone || att.client_telephone || '');
    try {
      const result = await api.getAttestation(att.id);
      if (result.html) setHtmlPreview(result.html);
    } catch {}
    setShowHistory(false);
    toast.success('Attestation rechargée');
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await api.generateAttestation(getPayload());
      setHtmlPreview(result.html);
      toast.success('Attestation générée et sauvegardée');
    } catch (err) {
      toast.error('Erreur génération');
    } finally {
      setLoading(false);
    }
  };

  // Impression depuis l'iframe sandboxée de l'aperçu : pas de popup ni de document.write
  const handlePrint = () => {
    if (!htmlPreview) return;
    previewRef.current?.print();
  };

  const handleSendEmail = async () => {
    if (!email || !htmlPreview) return;
    try {
      await api.emailAttestation(getPayload(), email, emailFormat);
      setEmailSent(true);
      toast.success(`Email envoyé (${emailFormat === 'word' ? 'Word' : 'PDF'}) et attestation sauvegardée`);
      setTimeout(() => setEmailSent(false), 3000);
    } catch (err) {
      toast.error('Erreur envoi email');
    }
  };

  const handleDownloadWord = async () => {
    try {
      const blob = await api.downloadAttestationDocx(getPayload());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attestation_${form.marque}_${form.modele}.docx`.replace(/ /g, '_');
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Word téléchargé');
    } catch { toast.error('Erreur Word'); }
  };

  const handleWhatsApp = () => {
    const tel = telephone || '';
    if (!tel) { toast.error('Pas de numéro de téléphone'); return; }
    const msg = `Bonjour ${form.prenom},\n\nVeuillez trouver ci-joint l'attestation de non-réparabilité de votre appareil ${form.marque} ${form.modele}.\n\nCordialement,\nKLIKPHONE - 04 79 60 89 22`;
    window.open(waLink(tel, msg), '_blank');
  };

  // Filter client results with accent-insensitive matching
  const filteredResults = clientResults.filter(c => {
    const q = normalize(clientSearch);
    return normalize(c.nom).includes(q) ||
           normalize(c.prenom).includes(q) ||
           (c.telephone || '').includes(clientSearch);
  });

  return (
    <div className="page max-w-[1120px]">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header-title">
            Attestation de non-réparabilité
          </h1>
          <p className="page-header-subtitle">
            Générez un document officiel A4 pour les appareils irréparables
          </p>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadHistory(); }}
            aria-expanded={showHistory}
            className="btn-secondary"
          >
            <FileText aria-hidden="true" />
            Historique
          </button>
        </div>
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="mb-6 card">
          <div className="card-header">
            <h3 className="t-h2">Historique des attestations</h3>
          </div>
          <div className="px-4 sm:px-5 pb-4 sm:pb-5">
            {historyLoading ? (
              <p className="loading-inline justify-center w-full py-4" role="status"><Loader2 aria-hidden="true" /> Chargement…</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">Aucune attestation enregistrée</p>
            ) : (
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {history.map(att => (
                  <button
                    key={att.id}
                    type="button"
                    onClick={() => handleReload(att)}
                    className="w-full flex items-center gap-3 px-3 min-h-14 py-2 rounded-lg hover:bg-slate-50 transition-colors duration-150 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0" aria-hidden="true">
                      <FileText className="w-4 h-4 text-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {att.marque} {att.modele} — {att.prenom} {att.nom}
                      </p>
                      <p className="t-caption tabular-nums">
                        {new Date(att.date_creation).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {att.cree_par && ` · par ${att.cree_par}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {att.email_envoye && (
                        <span className="badge badge-sm badge-success">Email envoyé</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ─── Form Column ─── */}
        <div className="space-y-4 min-w-0">

          {/* Client mode toggle */}
          <div className="card card-body">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center" aria-hidden="true">
                <Users className="w-4 h-4 text-slate-500" />
              </div>
              <h2 className="t-h2">Client</h2>
            </div>

            {/* Toggle buttons */}
            <div className="segmented w-full mb-4" role="group" aria-label="Type de client">
              <button
                type="button"
                onClick={() => { setClientMode('existing'); handleClearClient(); }}
                aria-pressed={clientMode === 'existing'}
                className={`segmented-item flex-1 ${clientMode === 'existing' ? 'segmented-item-active' : ''}`}
              >
                <Search className="w-4 h-4" aria-hidden="true" /> Client existant
              </button>
              <button
                type="button"
                onClick={() => { setClientMode('new'); handleClearClient(); }}
                aria-pressed={clientMode === 'new'}
                className={`segmented-item flex-1 ${clientMode === 'new' ? 'segmented-item-active' : ''}`}
              >
                <UserPlus className="w-4 h-4" aria-hidden="true" /> Nouveau client
              </button>
            </div>

            {/* Client search (existing mode) */}
            {clientMode === 'existing' && (
              <div className="mb-4" ref={searchRef}>
                <label htmlFor="attestation-client-recherche" className="input-label">Rechercher un client</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" aria-hidden="true" />
                  <input
                    id="attestation-client-recherche"
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                    className="input pl-9 pr-12"
                    placeholder="Nom, prénom ou téléphone..."
                    autoComplete="off"
                  />
                  {clientSearchLoading && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 motion-safe:animate-spin" aria-hidden="true" />
                  )}
                  {selectedClient && (
                    <button type="button" onClick={handleClearClient} aria-label="Retirer le client"
                      className="btn-ghost btn-icon absolute right-0.5 top-1/2 -translate-y-1/2 text-slate-500">
                      <X aria-hidden="true" />
                    </button>
                  )}
                </div>

                {/* Results dropdown */}
                {showClientDropdown && filteredResults.length > 0 && (
                  <div className="mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto z-30 relative">
                    {filteredResults.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectClient(c)}
                        className="w-full flex items-center gap-3 px-3 min-h-11 py-1.5 hover:bg-slate-50 transition-colors duration-150 text-left focus:outline-none focus-visible:bg-brand-50"
                      >
                        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center shrink-0" aria-hidden="true">
                          <span className="text-brand-700 font-bold text-xs">
                            {(c.prenom?.[0] || '').toUpperCase()}{(c.nom?.[0] || '').toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{c.prenom} {c.nom}</p>
                          {c.telephone && <p className="t-caption tabular-nums">{c.telephone}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {showClientDropdown && clientSearch.length >= 2 && filteredResults.length === 0 && !clientSearchLoading && (
                  <div className="mt-2 card-section text-sm text-slate-500 text-center py-3">
                    Aucun client trouvé
                  </div>
                )}

                {selectedClient && (
                  <div className="mt-2 callout callout-success items-center py-2">
                    <Check aria-hidden="true" />
                    <span className="font-medium">{selectedClient.prenom} {selectedClient.nom}</span>
                    {selectedClient.telephone && <span className="ml-auto tabular-nums text-xs whitespace-nowrap">{selectedClient.telephone}</span>}
                  </div>
                )}
              </div>
            )}

            {/* Name fields */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <label htmlFor="attestation-nom" className="input-label">Nom *</label>
                <input id="attestation-nom" value={form.nom} onChange={e => updateForm('nom', e.target.value)}
                  className="input" readOnly={clientMode === 'existing' && !!selectedClient} />
              </div>
              <div>
                <label htmlFor="attestation-prenom" className="input-label">Prénom *</label>
                <input id="attestation-prenom" value={form.prenom} onChange={e => updateForm('prenom', e.target.value)}
                  className="input" readOnly={clientMode === 'existing' && !!selectedClient} />
              </div>
            </div>
            <div className="mt-4">
              <label htmlFor="attestation-adresse" className="input-label">Adresse</label>
              <input id="attestation-adresse" value={form.adresse} onChange={e => updateForm('adresse', e.target.value)}
                className="input" placeholder="Rue, code postal, ville" />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 mt-4">
              <div>
                <label htmlFor="attestation-telephone" className="input-label">Téléphone</label>
                <input id="attestation-telephone" type="tel" value={telephone} onChange={e => setTelephone(e.target.value)}
                  className="input tabular-nums" placeholder="06 ..."
                  readOnly={clientMode === 'existing' && !!selectedClient} />
              </div>
              <div>
                <label htmlFor="attestation-email" className="input-label">Email</label>
                <input id="attestation-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="input" placeholder="client@email.com"
                  readOnly={clientMode === 'existing' && !!selectedClient} />
              </div>
            </div>
          </div>

          {/* Device info */}
          <div className="card card-body">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center" aria-hidden="true">
                <Smartphone className="w-4 h-4 text-slate-500" />
              </div>
              <h2 className="t-h2">Appareil</h2>
            </div>

            {/* Category tabs */}
            <div className="mb-4 max-sm:scroll-fade-x">
              <div className="segmented" role="group" aria-label="Catégorie d'appareil">
                {categories.map(cat => (
                  <button key={cat} type="button"
                    onClick={() => { setSelectedCategorie(cat); setMarqueManual(false); updateForm('marque', ''); updateForm('modele', ''); }}
                    aria-pressed={selectedCategorie === cat}
                    className={`segmented-item ${selectedCategorie === cat ? 'segmented-item-active' : ''}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
              {/* ─── Marque (catalogue ou saisie libre via "Autre") ─── */}
              <div>
                <label htmlFor="attestation-marque" className="input-label">Marque *</label>
                {marqueManual ? (
                  <div className="flex gap-2">
                    <input
                      id="attestation-marque"
                      value={form.marque}
                      onChange={e => updateForm('marque', e.target.value)}
                      className="input flex-1 min-w-0"
                      placeholder="Saisir la marque"
                      autoFocus
                    />
                    <button
                      type="button"
                      title="Revenir à la liste"
                      aria-label="Revenir à la liste des marques"
                      onClick={() => { setMarqueManual(false); updateForm('marque', ''); updateForm('modele', ''); }}
                      className="btn-secondary btn-icon shrink-0"
                    >
                      <X aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <select
                    id="attestation-marque"
                    value={form.marque}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === '__autre__') {
                        // Marque hors liste : marque ET modèle en saisie libre
                        setMarqueManual(true);
                        updateForm('marque', ''); updateForm('modele', '');
                      } else {
                        updateForm('marque', v); updateForm('modele', '');
                      }
                    }}
                    className="select"
                  >
                    <option value="">{catalogue.loading && !catalogue.marques.length ? 'Chargement…' : 'Sélectionner...'}</option>
                    {catalogue.marques.map(m => <option key={m} value={m}>{m}</option>)}
                    <option value="__autre__">✏️ Autre (saisie manuelle)</option>
                  </select>
                )}
              </div>

              {/* ─── Modèle : recherche dans le catalogue ou saisie libre ─── */}
              <ModelCombobox
                id="attestation-modele"
                label="Modèle"
                required
                marque={marqueManual ? '' : form.marque}
                modeles={marqueManual ? [] : catalogue.modelesDe(form.marque)}
                loading={!marqueManual && !!form.marque && catalogue.loading}
                value={form.modele}
                onChange={(texte) => updateForm('modele', texte)}
                commitOnClose
                disabled={!marqueManual && !form.marque}
                placeholder={!marqueManual && !form.marque ? 'Choisissez d\'abord la marque' : undefined}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4 mt-4">
              <div>
                <label htmlFor="attestation-imei" className="input-label">IMEI / N° série</label>
                <input id="attestation-imei" value={form.imei} onChange={e => updateForm('imei', e.target.value)}
                  className="input t-mono" />
              </div>
              <div>
                <label htmlFor="attestation-etat" className="input-label">État de l'appareil</label>
                <select
                  id="attestation-etat"
                  value={form.etat}
                  onChange={e => updateForm('etat', e.target.value)}
                  className="select"
                >
                  <option value="">Sélectionner...</option>
                  {etats.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Motif & Compte-rendu */}
          <div className="card card-body">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center" aria-hidden="true">
                <AlertTriangle className="w-4 h-4 text-slate-500" />
              </div>
              <h2 className="t-h2">Diagnostic</h2>
            </div>
            <div className="mb-4">
              <label htmlFor="attestation-motif" className="input-label">Motif de non-réparabilité *</label>
              <textarea
                id="attestation-motif"
                value={form.motif}
                onChange={e => updateForm('motif', e.target.value)}
                className="textarea min-h-[96px] resize-none"
                placeholder="Expliquez pourquoi l'appareil ne peut pas être réparé..."
              />
            </div>
            <div>
              <label htmlFor="attestation-compte-rendu" className="input-label">Compte-rendu technique</label>
              <textarea
                id="attestation-compte-rendu"
                value={form.compte_rendu}
                onChange={e => updateForm('compte_rendu', e.target.value)}
                className="textarea min-h-[120px] resize-none"
                placeholder="Détails techniques : tests effectués, composants vérifiés..."
              />
            </div>
          </div>

          {/* Generate button */}
          <button type="button" onClick={handleGenerate}
            disabled={loading || !form.nom || !form.marque || !form.modele || !form.motif}
            className="btn-primary btn-lg btn-block">
            {loading ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <FileText aria-hidden="true" />}
            Générer l'attestation
          </button>
        </div>

        {/* ─── Preview Column ─── */}
        <div className="space-y-4 min-w-0">
          <div className="card overflow-hidden">
            <div className="px-4 sm:px-5 py-3 bg-slate-50 border-b border-slate-100">
              <h3 className="t-h2">Aperçu du document</h3>
            </div>
            {htmlPreview ? (
              <PrintPreview
                ref={previewRef}
                variant="inline"
                title="Aperçu de l'attestation"
                documents={previewDocuments}
                onReadyChange={setPreviewReady}
                showFooter={false}
                canvasClassName="h-[750px] max-h-[80vh] min-h-[420px]"
              />
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <FileText aria-hidden="true" />
                </div>
                <p className="t-h2">Aucun aperçu</p>
                <p className="t-body text-slate-500 max-w-sm">Remplissez le formulaire et cliquez sur "Générer"</p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          {htmlPreview && (
            <div className="card card-body space-y-3">
              <h3 className="t-h2 mb-3">Actions</h3>

              {/* Imprimer + Télécharger PDF / Word */}
              <button type="button" onClick={handlePrint} disabled={!previewReady} className="btn-primary btn-block">
                <Printer aria-hidden="true" /> {previewReady ? 'Imprimer' : 'Préparation de l\'aperçu…'}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const blob = await api.downloadAttestationPdf(getPayload());
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `attestation_${form.marque}_${form.modele}.pdf`.replace(/ /g, '_');
                      a.click();
                      URL.revokeObjectURL(url);
                      toast.success('PDF téléchargé');
                    } catch { toast.error('Erreur PDF'); }
                  }}
                  className="btn-secondary flex-1"
                >
                  <Download aria-hidden="true" /> PDF
                </button>
                <button
                  type="button"
                  onClick={handleDownloadWord}
                  className="btn-secondary flex-1"
                >
                  <Download aria-hidden="true" /> Word
                </button>
              </div>

              {/* Email avec choix du format PDF / Word */}
              <div className="pt-1">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="t-caption">Format de la pièce jointe :</span>
                  <div className="segmented" role="group" aria-label="Format de la pièce jointe">
                    <button type="button" onClick={() => setEmailFormat('pdf')} aria-pressed={emailFormat === 'pdf'}
                      className={`segmented-item text-xs min-h-8 px-2.5 ${emailFormat === 'pdf' ? 'segmented-item-active' : ''}`}>PDF</button>
                    <button type="button" onClick={() => setEmailFormat('word')} aria-pressed={emailFormat === 'word'}
                      className={`segmented-item text-xs min-h-8 px-2.5 ${emailFormat === 'word' ? 'segmented-item-active' : ''}`}>Word</button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <label htmlFor="attestation-email-envoi" className="sr-only">Email du client</label>
                  <input id="attestation-email-envoi" type="email" value={email} onChange={e => setEmail(e.target.value)}
                    className="input flex-1 min-w-0" placeholder="Email du client" />
                  <button type="button" onClick={handleSendEmail} disabled={!email || emailSent}
                    className={`shrink-0 ${emailSent ? 'btn-success' : 'btn-secondary'}`}>
                    {emailSent ? <Check aria-hidden="true" /> : <Mail aria-hidden="true" />}
                    {emailSent ? 'Envoyé' : 'Email'}
                  </button>
                </div>
              </div>

              {/* WhatsApp */}
              <div className="flex gap-2">
                <label htmlFor="attestation-tel-envoi" className="sr-only">Tél du client</label>
                <input id="attestation-tel-envoi" type="tel" value={telephone} onChange={e => setTelephone(e.target.value)}
                  className="input flex-1 min-w-0 tabular-nums" placeholder="Tél du client" />
                <button type="button" onClick={handleWhatsApp} disabled={!telephone}
                  className="btn-whatsapp shrink-0">
                  <MessageCircle aria-hidden="true" /> WhatsApp
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
