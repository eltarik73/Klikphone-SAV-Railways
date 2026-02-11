import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../components/Toast';
import { waLink } from '../lib/utils';
import {
  FileText, Send, Mail, Printer, AlertTriangle, Search,
  Check, Loader2, UserPlus, Users, Phone, Smartphone,
  MessageCircle, X, ChevronDown,
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
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // Catalog data
  const [categories] = useState(['Smartphone', 'Tablette', 'PC Portable', 'Console', 'Autre']);
  const [selectedCategorie, setSelectedCategorie] = useState('Smartphone');
  const [marques, setMarques] = useState([]);
  const [modeles, setModeles] = useState([]);

  const etats = ['Bon état', 'Écran cassé', 'Traces d\'oxydation', 'Très endommagé', 'Autre'];

  const updateForm = (field, value) => setForm(f => ({ ...f, [field]: value }));

  // Load marques when category changes
  useEffect(() => {
    if (!selectedCategorie) return;
    api.getMarques(selectedCategorie).then(setMarques).catch(() => setMarques([]));
    setModeles([]);
  }, [selectedCategorie]);

  // Load modeles when marque changes
  useEffect(() => {
    if (!selectedCategorie || !form.marque) { setModeles([]); return; }
    api.getModeles(selectedCategorie, form.marque).then(setModeles).catch(() => setModeles([]));
  }, [selectedCategorie, form.marque]);

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

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await api.generateAttestation(form);
      setHtmlPreview(result.html);
      toast.success('Attestation générée');
    } catch (err) {
      toast.error('Erreur génération');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    if (!htmlPreview) return;
    const win = window.open('', '_blank');
    win.document.write(htmlPreview);
    win.document.close();
    setTimeout(() => win.print(), 300);
  };

  const handleSendEmail = async () => {
    if (!email || !htmlPreview) return;
    try {
      await api.emailAttestation(form, email);
      setEmailSent(true);
      toast.success('Email envoyé');
      setTimeout(() => setEmailSent(false), 3000);
    } catch (err) {
      toast.error('Erreur envoi email');
    }
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
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight">
          Attestation de non-réparabilité
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Générez un document officiel A4 pour les appareils irréparables
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ─── Form Column ─── */}
        <div className="space-y-5">

          {/* Client mode toggle */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Users className="w-4 h-4 text-blue-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Client</h2>
            </div>

            {/* Toggle buttons */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => { setClientMode('existing'); handleClearClient(); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border-2 transition-all
                  ${clientMode === 'existing'
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
              >
                <Search className="w-4 h-4" /> Client existant
              </button>
              <button
                onClick={() => { setClientMode('new'); handleClearClient(); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border-2 transition-all
                  ${clientMode === 'new'
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
              >
                <UserPlus className="w-4 h-4" /> Nouveau client
              </button>
            </div>

            {/* Client search (existing mode) */}
            {clientMode === 'existing' && (
              <div className="mb-4" ref={searchRef}>
                <label className="input-label">Rechercher un client</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                    className="input pl-9 pr-8"
                    placeholder="Nom, prénom ou téléphone..."
                  />
                  {clientSearchLoading && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" />
                  )}
                  {selectedClient && (
                    <button onClick={handleClearClient}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-100">
                      <X className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  )}
                </div>

                {/* Results dropdown */}
                {showClientDropdown && filteredResults.length > 0 && (
                  <div className="mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto z-30 relative">
                    {filteredResults.map(c => (
                      <button
                        key={c.id}
                        onClick={() => handleSelectClient(c)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left"
                      >
                        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                          <span className="text-brand-700 font-bold text-xs">
                            {(c.prenom?.[0] || '').toUpperCase()}{(c.nom?.[0] || '').toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{c.prenom} {c.nom}</p>
                          {c.telephone && <p className="text-xs text-slate-400 font-mono">{c.telephone}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {showClientDropdown && clientSearch.length >= 2 && filteredResults.length === 0 && !clientSearchLoading && (
                  <div className="mt-1 p-3 bg-slate-50 rounded-lg text-sm text-slate-500 text-center">
                    Aucun client trouvé
                  </div>
                )}

                {selectedClient && (
                  <div className="mt-2 p-2.5 bg-emerald-50 rounded-lg flex items-center gap-2 text-sm text-emerald-700">
                    <Check className="w-4 h-4 shrink-0" />
                    <span className="font-medium">{selectedClient.prenom} {selectedClient.nom}</span>
                    {selectedClient.telephone && <span className="text-emerald-500 font-mono text-xs ml-auto">{selectedClient.telephone}</span>}
                  </div>
                )}
              </div>
            )}

            {/* Name fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">Nom *</label>
                <input value={form.nom} onChange={e => updateForm('nom', e.target.value)}
                  className="input" readOnly={clientMode === 'existing' && !!selectedClient} />
              </div>
              <div>
                <label className="input-label">Prénom *</label>
                <input value={form.prenom} onChange={e => updateForm('prenom', e.target.value)}
                  className="input" readOnly={clientMode === 'existing' && !!selectedClient} />
              </div>
            </div>
            <div className="mt-3">
              <label className="input-label">Adresse</label>
              <input value={form.adresse} onChange={e => updateForm('adresse', e.target.value)}
                className="input" placeholder="Rue, code postal, ville" />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="input-label">Téléphone</label>
                <input value={telephone} onChange={e => setTelephone(e.target.value)}
                  className="input font-mono" placeholder="06 ..."
                  readOnly={clientMode === 'existing' && !!selectedClient} />
              </div>
              <div>
                <label className="input-label">Email</label>
                <input value={email} onChange={e => setEmail(e.target.value)}
                  className="input" placeholder="client@email.com"
                  readOnly={clientMode === 'existing' && !!selectedClient} />
              </div>
            </div>
          </div>

          {/* Device info */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
                <Smartphone className="w-4 h-4 text-brand-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Appareil</h2>
            </div>

            {/* Category tabs */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {categories.map(cat => (
                <button key={cat}
                  onClick={() => { setSelectedCategorie(cat); updateForm('marque', ''); updateForm('modele', ''); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                    ${selectedCategorie === cat
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">Marque *</label>
                <div className="relative">
                  <select
                    value={form.marque}
                    onChange={e => { updateForm('marque', e.target.value); updateForm('modele', ''); }}
                    className="input appearance-none pr-8"
                  >
                    <option value="">Sélectionner...</option>
                    {marques.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="input-label">Modèle *</label>
                <div className="relative">
                  <select
                    value={form.modele}
                    onChange={e => updateForm('modele', e.target.value)}
                    className="input appearance-none pr-8"
                    disabled={!form.marque}
                  >
                    <option value="">Sélectionner...</option>
                    {modeles.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="input-label">IMEI / N° série</label>
                <input value={form.imei} onChange={e => updateForm('imei', e.target.value)}
                  className="input font-mono" />
              </div>
              <div>
                <label className="input-label">État de l'appareil</label>
                <div className="relative">
                  <select
                    value={form.etat}
                    onChange={e => updateForm('etat', e.target.value)}
                    className="input appearance-none pr-8"
                  >
                    <option value="">Sélectionner...</option>
                    {etats.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
            </div>
          </div>

          {/* Motif & Compte-rendu */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-red-500" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Diagnostic</h2>
            </div>
            <div className="mb-3">
              <label className="input-label">Motif de non-réparabilité *</label>
              <textarea
                value={form.motif}
                onChange={e => updateForm('motif', e.target.value)}
                className="input min-h-[80px] resize-none"
                placeholder="Expliquez pourquoi l'appareil ne peut pas être réparé..."
              />
            </div>
            <div>
              <label className="input-label">Compte-rendu technique</label>
              <textarea
                value={form.compte_rendu}
                onChange={e => updateForm('compte_rendu', e.target.value)}
                className="input min-h-[100px] resize-none"
                placeholder="Détails techniques : tests effectués, composants vérifiés..."
              />
            </div>
          </div>

          {/* Generate button */}
          <button onClick={handleGenerate}
            disabled={loading || !form.nom || !form.marque || !form.modele || !form.motif}
            className="btn-primary w-full justify-center py-3 text-base">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
            Générer l'attestation
          </button>
        </div>

        {/* ─── Preview Column ─── */}
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Aperçu du document</h3>
            </div>
            {htmlPreview ? (
              <iframe
                srcDoc={htmlPreview}
                className="w-full h-[750px] border-0"
                title="Aperçu attestation"
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-[500px] text-center px-6">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                  <FileText className="w-8 h-8 text-slate-300" />
                </div>
                <p className="text-slate-500 font-medium">Aucun aperçu</p>
                <p className="text-sm text-slate-400 mt-1">Remplissez le formulaire et cliquez sur "Générer"</p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          {htmlPreview && (
            <div className="card p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Actions</h3>

              {/* Print */}
              <button onClick={handlePrint} className="btn-primary w-full justify-center gap-2">
                <Printer className="w-4 h-4" /> Imprimer (A4)
              </button>

              {/* Email */}
              <div className="flex gap-2">
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="input flex-1" placeholder="Email du client" />
                <button onClick={handleSendEmail} disabled={!email || emailSent}
                  className={`btn-primary shrink-0 ${emailSent ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}>
                  {emailSent ? <Check className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
                  {emailSent ? 'Envoyé' : 'Email'}
                </button>
              </div>

              {/* WhatsApp */}
              <div className="flex gap-2">
                <input type="tel" value={telephone} onChange={e => setTelephone(e.target.value)}
                  className="input flex-1 font-mono" placeholder="Tél du client" />
                <button onClick={handleWhatsApp} disabled={!telephone}
                  className="btn-whatsapp shrink-0">
                  <MessageCircle className="w-4 h-4" /> WhatsApp
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
