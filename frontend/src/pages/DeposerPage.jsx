import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import {
  ArrowLeft, ArrowRight, Check, Smartphone, User, AlertTriangle,
  Send, MapPin, Phone, Clock, Globe, Copy, Share2, MessageCircle,
} from 'lucide-react';

const isValidPhone = (tel) => /^(?:0|\+33\s?)[1-9](?:[\s.-]?\d{2}){4}$/.test(tel.replace(/\s/g, '').length >= 10 ? tel : '') || /^\d{10,14}$/.test(tel.replace(/[\s.-]/g, ''));
const isValidEmail = (email) => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const STEPS = ['Coordonnées', 'Appareil', 'Panne'];

export default function DeposerPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [createdCode, setCreatedCode] = useState(null);

  const [categories, setCategories] = useState([]);
  const [marques, setMarques] = useState([]);
  const [modeles, setModeles] = useState([]);
  const [pannes, setPannes] = useState([]);

  const [form, setForm] = useState({
    nom: '', prenom: '', telephone: '', email: '',
    categorie: '', marque: '', modele: '', modele_autre: '',
    panne: '', panne_detail: '', notes_client: '',
  });

  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => {});
    api.getPannes().then(setPannes).catch(() => {});
  }, []);

  useEffect(() => {
    if (form.categorie) {
      api.getMarques(form.categorie).then(setMarques).catch(() => setMarques([]));
      setForm(f => ({ ...f, marque: '', modele: '', modele_autre: '' }));
    }
  }, [form.categorie]);

  useEffect(() => {
    if (form.categorie && form.marque && form.marque !== 'Autre') {
      api.getModeles(form.categorie, form.marque).then(setModeles).catch(() => setModeles([]));
      setForm(f => ({ ...f, modele: '', modele_autre: '' }));
    }
  }, [form.marque]);

  const updateForm = (field, value) => {
    setForm(f => ({ ...f, [field]: value }));
    setErrors(e => ({ ...e, [field]: undefined }));
  };

  const validateStep = () => {
    const errs = {};
    if (step === 0) {
      if (!form.nom.trim()) errs.nom = 'Le nom est requis';
      if (!form.telephone.trim()) errs.telephone = 'Le téléphone est requis';
      else if (!isValidPhone(form.telephone)) errs.telephone = 'Numéro invalide (10 chiffres min.)';
      if (form.email && !isValidEmail(form.email)) errs.email = 'Email invalide';
    }
    if (step === 1) {
      if (!form.categorie) errs.categorie = 'La catégorie est requise';
      if (!form.marque) errs.marque = 'La marque est requise';
      if ((form.marque === 'Autre' || form.modele === 'Autre') && !form.modele_autre.trim()) {
        errs.modele_autre = 'Veuillez préciser le modèle';
      }
    }
    if (step === 2) {
      if (!form.panne) errs.panne = 'Veuillez sélectionner une panne';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const canNext = () => {
    if (step === 0) return form.nom && form.telephone;
    if (step === 1) return form.categorie && form.marque && (form.marque !== 'Autre' && form.modele !== 'Autre' || form.modele_autre.trim());
    if (step === 2) return form.panne;
    return true;
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const result = await api.createDepotDistance({
        nom: form.nom,
        prenom: form.prenom,
        telephone: form.telephone,
        email: form.email,
        categorie: form.categorie,
        marque: form.marque,
        modele: (form.marque === 'Autre' || form.modele === 'Autre') ? '' : form.modele,
        modele_autre: (form.marque === 'Autre' || form.modele === 'Autre') ? form.modele_autre : '',
        panne: form.panne,
        panne_detail: form.panne_detail,
        notes_client: form.notes_client,
      });
      setCreatedCode(result.ticket_code);
    } catch (err) {
      setErrors({ submit: err.message || 'Erreur lors de l\'envoi' });
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    if (!validateStep()) return;
    if (step === 2) {
      handleSubmit();
    } else {
      setStep(s => s + 1);
    }
  };

  const FieldError = ({ field }) => errors[field] ? (
    <p className="text-xs text-red-500 mt-1">{errors[field]}</p>
  ) : null;

  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(createdCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const handleShare = () => {
    const url = `${window.location.origin}/suivi?ticket=${createdCode}`;
    const text = `Mon numéro de suivi Klikphone : ${createdCode}\nSuivre ma réparation : ${url}`;
    if (navigator.share) {
      navigator.share({ title: `Klikphone - ${createdCode}`, text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    }
  };

  const handleWhatsAppSelf = () => {
    const tel = form.telephone.replace(/[\s.-]/g, '');
    const num = tel.startsWith('0') ? '33' + tel.slice(1) : tel;
    const url = `${window.location.origin}/suivi?ticket=${createdCode}`;
    const msg = `Klikphone - Votre numéro de suivi : ${createdCode}\nSuivez votre réparation ici : ${url}`;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // Confirmation screen
  if (createdCode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-brand-50/30">
        <div className="max-w-lg mx-auto px-4 py-8">
          <div className="card p-8 text-center animate-in">
            <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-6">
              <Check className="w-10 h-10 text-emerald-500" />
            </div>
            <h2 className="text-2xl font-display font-bold text-slate-900 mb-2">
              Demande enregistrée !
            </h2>

            {/* Alerte: notez ce numéro */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5 flex items-center gap-2 text-left">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <p className="text-xs font-semibold text-amber-800">
                Conservez ce numéro ! Il vous permettra de suivre votre réparation.
              </p>
            </div>

            {/* Code avec bouton copier */}
            <p className="text-slate-500 text-sm mb-2">Votre numéro de suivi :</p>
            <div className="bg-brand-50 rounded-xl py-5 px-6 mb-3 border-2 border-brand-200 relative">
              <p className="text-4xl font-extrabold font-mono text-brand-600 tracking-wider select-all">{createdCode}</p>
              <button
                onClick={handleCopy}
                className="absolute top-2 right-2 p-2 rounded-lg bg-white/80 hover:bg-white shadow-sm transition-all"
                title="Copier"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-brand-400" />}
              </button>
            </div>
            {copied && <p className="text-xs text-emerald-600 font-medium mb-2">Copié !</p>}

            {/* Actions: partager / WhatsApp */}
            <div className="flex gap-2 mb-5">
              <button onClick={handleShare}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-all">
                <Share2 className="w-4 h-4" /> Partager
              </button>
              <button onClick={handleWhatsAppSelf}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-sm font-medium transition-all">
                <MessageCircle className="w-4 h-4" /> M'envoyer par WhatsApp
              </button>
            </div>

            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-5 text-left">
              <h3 className="text-sm font-bold text-indigo-800 mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4" /> Prochaines étapes
              </h3>
              <ol className="text-sm text-indigo-700 space-y-2 list-decimal list-inside">
                <li>Notre équipe va valider votre demande</li>
                <li>Présentez-vous en boutique avec votre appareil</li>
                <li>Votre dossier est déjà créé — accueil rapide</li>
              </ol>
            </div>

            {form.email && (
              <p className="text-xs text-slate-400 mb-4">
                Un email de confirmation a été envoyé à <strong>{form.email}</strong>
              </p>
            )}

            {!form.email && (
              <p className="text-xs text-slate-400 mb-4">
                Vous pouvez retrouver votre ticket avec votre numéro de téléphone sur la page de suivi.
              </p>
            )}

            <div className="space-y-3">
              <button
                onClick={() => navigate(`/suivi?ticket=${createdCode}`)}
                className="btn-primary w-full"
              >
                <Send className="w-4 h-4" /> Suivre ma réparation
              </button>
              <a href="/" className="btn-secondary w-full inline-flex items-center justify-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Retour à l'accueil
              </a>
            </div>
          </div>

          <div className="mt-6 card p-4">
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <MapPin className="w-4 h-4 text-brand-600 shrink-0" />
              <span>79 Place Saint Léger, Chambéry</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-600 mt-2">
              <Phone className="w-4 h-4 text-brand-600 shrink-0" />
              <span>04 79 60 89 22</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-brand-50/30">
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8 animate-in">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-600/20">
            <Globe className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-display font-bold text-slate-900">Dépôt à distance</h1>
          <p className="text-sm text-slate-500 mt-1">Pré-enregistrez votre appareil en ligne</p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-1 mb-8">
          {STEPS.map((s, i) => (
            <div key={i} className="flex-1 flex flex-col items-center">
              <div className={`w-full h-2 rounded-full transition-all duration-500 ${
                i < step ? 'bg-indigo-500' : i === step ? 'bg-indigo-400' : 'bg-slate-200'
              }`} />
              <p className={`text-xs font-medium mt-1.5 ${
                i <= step ? 'text-indigo-600' : 'text-slate-400'
              }`}>{s}</p>
            </div>
          ))}
        </div>

        {/* Step 0: Coordonnées */}
        {step === 0 && (
          <div className="card p-6 space-y-4 animate-in">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center">
                <User className="w-5 h-5 text-sky-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Vos coordonnées</h2>
                <p className="text-xs text-slate-400">Pour vous recontacter</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">Nom *</label>
                <input value={form.nom} onChange={e => updateForm('nom', e.target.value)}
                  className={`input ${errors.nom ? 'border-red-300' : ''}`} placeholder="Dupont" />
                <FieldError field="nom" />
              </div>
              <div>
                <label className="input-label">Prénom</label>
                <input value={form.prenom} onChange={e => updateForm('prenom', e.target.value)} className="input" placeholder="Jean" />
              </div>
            </div>
            <div>
              <label className="input-label">Téléphone *</label>
              <input type="tel" value={form.telephone} onChange={e => updateForm('telephone', e.target.value)}
                className={`input ${errors.telephone ? 'border-red-300' : ''}`} placeholder="06 XX XX XX XX" />
              <FieldError field="telephone" />
            </div>
            <div>
              <label className="input-label">Email</label>
              <input type="email" value={form.email} onChange={e => updateForm('email', e.target.value)}
                className={`input ${errors.email ? 'border-red-300' : ''}`} placeholder="pour recevoir les notifications" />
              <FieldError field="email" />
              <p className="text-xs text-slate-400 mt-1">Recommandé pour recevoir les mises à jour de votre réparation</p>
            </div>
          </div>
        )}

        {/* Step 1: Appareil */}
        {step === 1 && (
          <div className="card p-6 space-y-4 animate-in">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-brand-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Votre appareil</h2>
                <p className="text-xs text-slate-400">Type, marque et modèle</p>
              </div>
            </div>

            <div>
              <label className="input-label">Catégorie *</label>
              <div className="grid grid-cols-2 gap-2">
                {categories.filter(c => c !== 'Commande').map(cat => (
                  <button
                    key={cat}
                    onClick={() => updateForm('categorie', cat)}
                    className={`p-3 rounded-xl text-sm font-medium border-2 transition-all text-left
                      ${form.categorie === cat
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <FieldError field="categorie" />
            </div>

            {form.categorie && (
              <div>
                <label className="input-label">Marque *</label>
                <select value={form.marque} onChange={e => updateForm('marque', e.target.value)} className="input">
                  <option value="">Sélectionner...</option>
                  {marques.map(m => <option key={m} value={m}>{m}</option>)}
                  <option value="Autre">Autre</option>
                </select>
                <FieldError field="marque" />
              </div>
            )}

            {form.marque && form.marque !== 'Autre' && modeles.length > 0 && (
              <div>
                <label className="input-label">Modèle</label>
                <select value={form.modele} onChange={e => updateForm('modele', e.target.value)} className="input">
                  <option value="">Sélectionner...</option>
                  {modeles.map(m => <option key={m} value={m}>{m}</option>)}
                  <option value="Autre">Autre</option>
                </select>
              </div>
            )}

            {(form.marque === 'Autre' || form.modele === 'Autre') && (
              <div>
                <label className="input-label">Préciser marque / modèle *</label>
                <input value={form.modele_autre} onChange={e => updateForm('modele_autre', e.target.value)}
                  className={`input ${errors.modele_autre ? 'border-red-300' : ''}`} placeholder="Ex: Samsung Galaxy S24" />
                <FieldError field="modele_autre" />
              </div>
            )}
          </div>
        )}

        {/* Step 2: Panne */}
        {step === 2 && (
          <div className="card p-6 space-y-4 animate-in">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Le problème</h2>
                <p className="text-xs text-slate-400">Décrivez la panne</p>
              </div>
            </div>

            <div>
              <label className="input-label">Type de panne *</label>
              <div className="grid grid-cols-2 gap-2">
                {pannes.map(p => (
                  <button
                    key={p}
                    onClick={() => updateForm('panne', p)}
                    className={`p-3 rounded-xl text-sm font-medium border-2 transition-all text-left
                      ${form.panne === p
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <FieldError field="panne" />
            </div>

            <div>
              <label className="input-label">Détails</label>
              <textarea
                value={form.panne_detail}
                onChange={e => updateForm('panne_detail', e.target.value)}
                className="input min-h-[80px] resize-none"
                placeholder="Décrivez plus précisément le problème..."
              />
            </div>

            <div>
              <label className="input-label">Notes</label>
              <textarea
                value={form.notes_client}
                onChange={e => updateForm('notes_client', e.target.value)}
                className="input min-h-[60px] resize-none"
                placeholder="Informations complémentaires (accessoires, état cosmétique...)"
              />
            </div>

            {errors.submit && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {errors.submit}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={() => step === 0 ? navigate('/') : setStep(s => s - 1)}
            className="btn-secondary flex-1 py-3"
          >
            <ArrowLeft className="w-4 h-4" /> {step === 0 ? 'Accueil' : 'Retour'}
          </button>

          <button
            onClick={handleNext}
            disabled={loading || !canNext()}
            className={`flex-[2] py-3 ${step === 2 ? 'btn-primary bg-emerald-600 hover:bg-emerald-700' : 'btn-primary'}`}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Envoi...
              </span>
            ) : step === 2 ? (
              <>Envoyer ma demande <Check className="w-4 h-4" /></>
            ) : (
              <>Suivant <ArrowRight className="w-4 h-4" /></>
            )}
          </button>
        </div>

        {/* Info bar */}
        <div className="mt-8 card p-4 bg-slate-50">
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <MapPin className="w-4 h-4 shrink-0" />
            <span>79 Place Saint Léger, Chambéry</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-500 mt-1.5">
            <Phone className="w-4 h-4 shrink-0" />
            <span>04 79 60 89 22</span>
          </div>
        </div>

        <div className="mt-4 text-center">
          <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 10, color: '#A1A1AA' }}>
            Propulsé par{' '}
            <span style={{ fontWeight: 800, fontSize: 11 }}>
              <span style={{ color: '#7C3AED' }}>Tk</span>
              <span style={{ color: '#18181B' }}>S</span>
              <span style={{ color: '#EC4899' }}>∞</span>
              <span style={{ color: '#18181B' }}>26</span>
            </span>
            {' '}— une solution{' '}
            <span style={{ fontWeight: 700, color: '#7C3AED' }}>Klik&Dev</span>
          </div>
        </div>
      </div>
    </div>
  );
}
