import { useState } from 'react';
import api from '../lib/api';
import {
  FileText, Send, Mail, Printer, AlertTriangle,
  Check, Loader2,
} from 'lucide-react';

export default function AttestationPage() {
  const [form, setForm] = useState({
    nom: '', prenom: '', adresse: '',
    marque: '', modele: '', imei: '',
    etat: '', motif: '', compte_rendu: '',
  });
  const [email, setEmail] = useState('');
  const [htmlPreview, setHtmlPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const updateForm = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await api.generateAttestation(form);
      setHtmlPreview(result.html || result);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    if (!htmlPreview) return;
    const win = window.open('', '_blank');
    win.document.write(htmlPreview);
    win.document.close();
    win.print();
  };

  const handleSendEmail = async () => {
    if (!email || !htmlPreview) return;
    try {
      await api.emailAttestation(form, email);
      setEmailSent(true);
      setTimeout(() => setEmailSent(false), 3000);
    } catch (err) {
      console.error(err);
    }
  };

  const motifs = [
    'Composant introuvable',
    'Réparation non rentable',
    'Dommage irréversible (carte mère)',
    'Oxydation avancée',
    'Appareil trop ancien',
    'Autre',
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight">Attestation de non-réparabilité</h1>
        <p className="text-sm text-slate-500 mt-0.5">Générez un document officiel pour les appareils irréparables</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <div className="space-y-5">
          {/* Client info */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <FileText className="w-4 h-4 text-blue-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Informations client</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">Nom *</label>
                <input value={form.nom} onChange={e => updateForm('nom', e.target.value)} className="input" />
              </div>
              <div>
                <label className="input-label">Prénom *</label>
                <input value={form.prenom} onChange={e => updateForm('prenom', e.target.value)} className="input" />
              </div>
            </div>
            <div className="mt-3">
              <label className="input-label">Adresse</label>
              <input value={form.adresse} onChange={e => updateForm('adresse', e.target.value)} className="input" placeholder="Rue, code postal, ville" />
            </div>
          </div>

          {/* Device info */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-brand-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Appareil</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">Marque *</label>
                <input value={form.marque} onChange={e => updateForm('marque', e.target.value)} className="input" placeholder="Apple" />
              </div>
              <div>
                <label className="input-label">Modèle *</label>
                <input value={form.modele} onChange={e => updateForm('modele', e.target.value)} className="input" placeholder="iPhone 12" />
              </div>
            </div>
            <div className="mt-3">
              <label className="input-label">IMEI / N° série</label>
              <input value={form.imei} onChange={e => updateForm('imei', e.target.value)} className="input font-mono" />
            </div>
            <div className="mt-3">
              <label className="input-label">État de l'appareil</label>
              <input value={form.etat} onChange={e => updateForm('etat', e.target.value)} className="input" placeholder="Ex: Écran cassé, traces d'oxydation..." />
            </div>
          </div>

          {/* Motif */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-red-500" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Motif de non-réparabilité</h2>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {motifs.map(m => (
                <button key={m}
                  onClick={() => updateForm('motif', m)}
                  className={`p-2.5 rounded-lg text-xs font-medium border-2 transition-all text-left
                    ${form.motif === m
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div>
              <label className="input-label">Compte-rendu détaillé</label>
              <textarea
                value={form.compte_rendu}
                onChange={e => updateForm('compte_rendu', e.target.value)}
                className="input min-h-[100px] resize-none"
                placeholder="Détaillez les raisons techniques de la non-réparabilité..."
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <button onClick={handleGenerate}
              disabled={loading || !form.nom || !form.marque || !form.motif}
              className="btn-primary flex-1">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Générer l'attestation
            </button>
          </div>

          {/* Email send */}
          {htmlPreview && (
            <div className="card p-4">
              <div className="flex gap-2">
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="input flex-1" placeholder="Email du client" />
                <button onClick={handleSendEmail} disabled={!email || emailSent}
                  className={`btn-primary ${emailSent ? 'bg-emerald-600' : ''}`}>
                  {emailSent ? <Check className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
                  {emailSent ? 'Envoyé !' : 'Envoyer'}
                </button>
                <button onClick={handlePrint} className="btn-secondary">
                  <Printer className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="card overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Aperçu</h3>
          </div>
          {htmlPreview ? (
            <iframe
              srcDoc={htmlPreview}
              className="w-full h-[700px] border-0"
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
      </div>
    </div>
  );
}
