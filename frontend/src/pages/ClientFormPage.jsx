import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { useToast } from '../components/Toast';
import PatternGrid from '../components/PatternGrid';
import {
  ArrowLeft, ArrowRight, Check, Smartphone, User, AlertTriangle,
  Lock, Shield, FileText, Send, Package,
} from 'lucide-react';

// Flow = ordered list of step IDs
const FLOW_DEFAULT = ['client', 'appareil', 'modele', 'panne', 'securite', 'confirmation'];
const FLOW_COMMANDE = ['client', 'appareil', 'panne', 'confirmation'];

const LABELS = {
  client: 'Client', appareil: 'Appareil', modele: 'Modèle',
  panne: 'Panne', securite: 'Sécurité', confirmation: 'Confirmation',
};
const LABELS_COMMANDE = { ...LABELS, panne: 'Commande' };

// Validation helpers
const isValidPhone = (tel) => /^(?:0|\+33\s?)[1-9](?:[\s.-]?\d{2}){4}$/.test(tel.replace(/\s/g, '').length >= 10 ? tel : '') || /^\d{10,14}$/.test(tel.replace(/[\s.-]/g, ''));
const isValidEmail = (email) => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidIMEI = (imei) => !imei || /^\d{15}$/.test(imei.replace(/[\s-]/g, ''));

export default function ClientFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [createdCode, setCreatedCode] = useState(null);
  const [errors, setErrors] = useState({});
  const [countdown, setCountdown] = useState(null);

  const [categories, setCategories] = useState([]);
  const [marques, setMarques] = useState([]);
  const [modeles, setModeles] = useState([]);
  const [pannes, setPannes] = useState([]);

  const [form, setForm] = useState({
    nom: '', prenom: '', telephone: '', email: '', societe: '',
    categorie: '', marque: '', modele: '', modele_autre: '',
    panne: '', panne_detail: '', pin: '', pattern: '', notes_client: '',
    imei: '',
  });

  // Pièce à commander (for regular tickets with piece checkbox)
  const [pieceACommander, setPieceACommander] = useState(false);
  const [pieceNom, setPieceNom] = useState('');
  const [pieceDetails, setPieceDetails] = useState('');
  const [fournisseur, setFournisseur] = useState('');
  const [prixEstime, setPrixEstime] = useState('');

  // ─── Flow logic ──────────────────────────────────────────────
  const isCommande = form.categorie === 'Commande';
  const flow = isCommande ? FLOW_COMMANDE : FLOW_DEFAULT;
  const labels = isCommande ? LABELS_COMMANDE : LABELS;
  const currentId = flow[step] || 'client';
  const isLastStep = step === flow.length - 2; // last before confirmation
  const isConfirmation = currentId === 'confirmation';

  const resetForm = () => {
    setForm({
      nom: '', prenom: '', telephone: '', email: '', societe: '',
      categorie: '', marque: '', modele: '', modele_autre: '',
      panne: '', panne_detail: '', pin: '', pattern: '', notes_client: '',
      imei: '',
    });
    setPieceACommander(false);
    setPieceNom('');
    setPieceDetails('');
    setFournisseur('');
    setPrixEstime('');
    setCreatedCode(null);
    setStep(0);
    setErrors({});
    setCountdown(null);
    setCategories([]);
    setMarques([]);
    setModeles([]);
    setPannes([]);
    api.getCategories().then(setCategories).catch(() => {});
    api.getPannes().then(setPannes).catch(() => {});
  };

  // Countdown timer after ticket creation
  useEffect(() => {
    if (!isConfirmation || !createdCode) return;
    setCountdown(10);
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          resetForm();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isConfirmation, createdCode]);

  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => {});
    api.getPannes().then(setPannes).catch(() => {});
    // Pre-fill from query params (coming from ClientsPage "Nouvelle réparation")
    const clientId = searchParams.get('client_id');
    const tel = searchParams.get('tel');
    if (clientId && tel) {
      setForm(f => ({ ...f, telephone: tel }));
      api.getClient(parseInt(clientId)).then(c => {
        setForm(f => ({
          ...f,
          nom: c.nom || '', prenom: c.prenom || '',
          telephone: c.telephone || tel, email: c.email || '',
          societe: c.societe || '',
        }));
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (form.categorie) {
      api.getMarques(form.categorie).then(setMarques).catch(() => setMarques([]));
      setForm(f => ({ ...f, marque: '', modele: '', modele_autre: '' }));
    }
  }, [form.categorie]);

  useEffect(() => {
    if (form.categorie && form.marque) {
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
    if (currentId === 'client') {
      if (!form.nom.trim()) errs.nom = 'Le nom est requis';
      if (!form.telephone.trim()) errs.telephone = 'Le téléphone est requis';
      else if (!isValidPhone(form.telephone)) errs.telephone = 'Numéro invalide (10 chiffres min.)';
      if (form.email && !isValidEmail(form.email)) errs.email = 'Email invalide';
    }
    if (currentId === 'modele' && form.imei && !isValidIMEI(form.imei)) {
      errs.imei = 'IMEI invalide (15 chiffres)';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const client = await api.createOrGetClient({
        nom: form.nom, prenom: form.prenom,
        telephone: form.telephone, email: form.email,
        societe: form.societe,
      });
      const result = await api.createTicket({
        client_id: client.id, categorie: form.categorie,
        marque: form.marque,
        modele: form.modele === 'Autre' ? '' : form.modele,
        modele_autre: form.modele === 'Autre' ? form.modele_autre : '',
        panne: isCommande ? 'Pièce à commander' : (pieceACommander && pieceNom ? 'Pièce à commander' : form.panne),
        panne_detail: isCommande ? form.panne_detail : (pieceACommander && pieceNom
          ? `${pieceNom}${pieceDetails ? ' — ' + pieceDetails : ''}`
          : form.panne_detail),
        pin: form.pin,
        pattern: form.pattern,
        notes_client: form.notes_client,
        imei: form.imei,
        commande_piece: (isCommande || pieceACommander) ? 1 : 0,
      });

      // Auto-create commande for "Commande" type
      if (isCommande) {
        await api.createPartAuto({
          ticket_id: result.id,
          description: form.panne_detail.trim(),
          fournisseur: fournisseur || '',
          prix: prixEstime ? parseFloat(prixEstime) : null,
          notes: form.notes_client || '',
        });
      }
      // Auto-create commande if piece à commander (regular ticket)
      else if (pieceACommander && pieceNom) {
        await api.createPartAuto({
          ticket_id: result.id,
          description: pieceNom,
          fournisseur: fournisseur || '',
          prix: prixEstime ? parseFloat(prixEstime) : null,
          notes: pieceDetails || '',
        });
      }

      setCreatedCode(result.ticket_code);
      setStep(flow.length - 1); // go to confirmation
    } catch (err) {
      toast.error(err.message || 'Erreur lors de la création du ticket');
    } finally {
      setLoading(false);
    }
  };

  const canNext = () => {
    switch (currentId) {
      case 'client': return form.nom && form.telephone;
      case 'appareil': return form.categorie;
      case 'modele': return form.marque;
      case 'panne': return isCommande ? form.panne_detail.trim() : (form.panne || pieceACommander);
      case 'securite': return true;
      default: return true;
    }
  };

  const handleNext = () => {
    if (!validateStep()) return;
    if (isLastStep) {
      handleSubmit();
    } else {
      setStep(s => s + 1);
    }
  };

  const handleBack = () => {
    if (step === 0) {
      navigate('/');
    } else {
      setStep(s => s - 1);
    }
  };

  const FieldError = ({ field }) => errors[field] ? (
    <p className="text-xs text-red-500 mt-1">{errors[field]}</p>
  ) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-brand-50/30">
      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={handleBack} className="btn-ghost p-2">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-display font-bold text-slate-900">Déposer un appareil</h1>
            <p className="text-xs text-slate-400">Étape {step + 1} sur {flow.length} — {labels[currentId]}</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex gap-1 mb-8">
          {flow.map((id, i) => (
            <div key={id} className="flex-1">
              <div className={`h-1.5 rounded-full transition-all duration-500 ${
                i < step ? 'bg-brand-500' : i === step ? 'bg-brand-400' : 'bg-slate-200'
              }`} />
              <p className={`text-[9px] font-medium mt-1 text-center ${
                i <= step ? 'text-brand-600' : 'text-slate-400'
              }`}>{labels[id]}</p>
            </div>
          ))}
        </div>

        {/* ═══ Step: Client ═══ */}
        {currentId === 'client' && (
          <div className="card p-6 space-y-4 animate-in">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center">
                <User className="w-5 h-5 text-sky-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Vos coordonnées</h2>
                <p className="text-xs text-slate-400">Informations de contact</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">Nom *</label>
                <input value={form.nom} onChange={e => updateForm('nom', e.target.value)}
                  className={`input ${errors.nom ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : ''}`} placeholder="Dupont" />
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
                className={`input ${errors.telephone ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : ''}`} placeholder="06 XX XX XX XX" />
              <FieldError field="telephone" />
            </div>
            <div>
              <label className="input-label">Email</label>
              <input type="email" value={form.email} onChange={e => updateForm('email', e.target.value)}
                className={`input ${errors.email ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : ''}`} placeholder="optionnel" />
              <FieldError field="email" />
            </div>
            <div>
              <label className="input-label">Société</label>
              <input value={form.societe} onChange={e => updateForm('societe', e.target.value)} className="input" placeholder="optionnel" />
            </div>
          </div>
        )}

        {/* ═══ Step: Appareil (catégorie) ═══ */}
        {currentId === 'appareil' && (
          <div className="card p-6 space-y-4 animate-in">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-brand-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Type d'appareil</h2>
                <p className="text-xs text-slate-400">Sélectionnez la catégorie</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => updateForm('categorie', cat)}
                  className={`p-4 rounded-xl text-sm font-medium border-2 transition-all text-left
                    ${form.categorie === cat
                      ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-sm shadow-brand-500/10'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ═══ Step: Modèle (skipped for Commande) ═══ */}
        {currentId === 'modele' && (
          <div className="card p-6 space-y-4 animate-in">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-brand-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Marque & modèle</h2>
                <p className="text-xs text-slate-400">{form.categorie}</p>
              </div>
            </div>

            <div>
              <label className="input-label">Marque *</label>
              <select value={form.marque} onChange={e => updateForm('marque', e.target.value)} className="input">
                <option value="">Sélectionner...</option>
                {marques.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {form.marque && modeles.length > 0 && (
              <div>
                <label className="input-label">Modèle</label>
                <select value={form.modele} onChange={e => updateForm('modele', e.target.value)} className="input">
                  <option value="">Sélectionner...</option>
                  {modeles.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}

            {(form.marque === 'Autre' || form.modele === 'Autre') && (
              <div>
                <label className="input-label">Préciser le modèle</label>
                <input value={form.modele_autre} onChange={e => updateForm('modele_autre', e.target.value)} className="input" placeholder="Ex: Samsung Galaxy S24" />
              </div>
            )}

            <div>
              <label className="input-label">IMEI / N° de série</label>
              <input value={form.imei} onChange={e => updateForm('imei', e.target.value)}
                className={`input font-mono ${errors.imei ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : ''}`}
                placeholder="Tapez *#06# sur votre appareil" />
              <FieldError field="imei" />
            </div>
          </div>
        )}

        {/* ═══ Step: Panne / Détail commande ═══ */}
        {currentId === 'panne' && (
          <div className="card p-6 space-y-4 animate-in">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                {isCommande ? <Package className="w-5 h-5 text-amber-600" /> : <AlertTriangle className="w-5 h-5 text-amber-600" />}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{isCommande ? 'Détail commande' : 'Le problème'}</h2>
                <p className="text-xs text-slate-400">{isCommande ? 'Décrivez la pièce à commander' : 'Décrivez la panne'}</p>
              </div>
            </div>

            {isCommande ? (
              /* ─── Mode Commande ─── */
              <>
                <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-sm text-amber-700 flex items-center gap-2">
                  <Package className="w-4 h-4 shrink-0" />
                  La panne sera automatiquement définie comme "Pièce à commander"
                </div>

                <div>
                  <label className="input-label">Pièce à commander *</label>
                  <input
                    value={form.panne_detail}
                    onChange={e => updateForm('panne_detail', e.target.value)}
                    className="input"
                    placeholder="Ex: Écran OLED iPhone 14 Pro, Nappe Face ID..."
                    autoFocus
                  />
                </div>

                <div>
                  <label className="input-label">Détails supplémentaires (référence, couleur, capacité...)</label>
                  <textarea
                    value={form.notes_client}
                    onChange={e => updateForm('notes_client', e.target.value)}
                    className="input min-h-[80px] resize-none"
                    placeholder="Précisions sur la pièce, référence exacte, couleur, capacité..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="input-label">Fournisseur</label>
                    <input value={fournisseur} onChange={e => setFournisseur(e.target.value)}
                      className="input" placeholder="Ex: Utopya, MobileParts..." />
                  </div>
                  <div>
                    <label className="input-label">Prix estimé (€)</label>
                    <input type="number" step="0.01" value={prixEstime} onChange={e => setPrixEstime(e.target.value)}
                      className="input" placeholder="0.00" />
                  </div>
                </div>
              </>
            ) : (
              /* ─── Mode Réparation ─── */
              <>
                <div>
                  <label className="input-label">Type de panne *</label>
                  <div className="grid grid-cols-2 gap-2">
                    {pannes.map(p => (
                      <button
                        key={p}
                        onClick={() => updateForm('panne', p)}
                        className={`p-2.5 rounded-lg text-xs font-medium border-2 transition-all text-left
                          ${form.panne === p
                            ? 'border-brand-500 bg-brand-50 text-brand-700'
                            : 'border-slate-200 hover:border-slate-300 text-slate-700'}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="input-label">Détails supplémentaires</label>
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

                {/* Pièce à commander */}
                <div className="border-t border-slate-100 pt-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={pieceACommander} onChange={e => setPieceACommander(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500" />
                    <Package className="w-4 h-4 text-amber-600" />
                    <span className="text-sm font-semibold text-amber-700">Pièce à commander</span>
                  </label>
                </div>

                {pieceACommander && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3 animate-in">
                    <div className="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1">
                      <Package className="w-3 h-3" /> Détail de la commande
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 font-semibold">Pièce à commander *</label>
                      <input value={pieceNom} onChange={e => setPieceNom(e.target.value)}
                        placeholder="Ex: Écran OLED iPhone 14 Pro, Nappe Face ID..."
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mt-1" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 font-semibold">Détails / Commentaire</label>
                      <textarea value={pieceDetails} onChange={e => setPieceDetails(e.target.value)}
                        placeholder="Précisions sur la pièce, référence, couleur, capacité..."
                        rows={2}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mt-1 resize-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-slate-600 font-semibold">Fournisseur</label>
                        <input value={fournisseur} onChange={e => setFournisseur(e.target.value)}
                          placeholder="Ex: Utopya, MobileParts..."
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mt-1" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-600 font-semibold">Prix estimé</label>
                        <input type="number" value={prixEstime} onChange={e => setPrixEstime(e.target.value)}
                          placeholder="0.00"
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mt-1" />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ═══ Step: Sécurité (skipped for Commande) ═══ */}
        {currentId === 'securite' && (
          <div className="card p-6 space-y-5 animate-in">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
                <Lock className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Codes d'accès</h2>
                <p className="text-xs text-slate-400">Optionnel — nécessaire pour le diagnostic</p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-sm text-amber-700">
              Ces informations sont confidentielles et nécessaires uniquement pour le diagnostic de votre appareil.
            </div>

            <div>
              <label className="input-label flex items-center gap-1.5">
                <Lock className="w-3 h-3" /> Code PIN / Mot de passe
              </label>
              <input
                type="text"
                value={form.pin}
                onChange={e => updateForm('pin', e.target.value)}
                className="input text-center text-lg font-mono tracking-widest"
                placeholder="••••"
              />
            </div>

            <div>
              <label className="input-label flex items-center gap-1.5">
                <Shield className="w-3 h-3" /> Schéma de déverrouillage
              </label>
              <div className="flex justify-center">
                <PatternGrid
                  value={form.pattern}
                  onChange={(val) => updateForm('pattern', val)}
                  size={200}
                />
              </div>
            </div>
          </div>
        )}

        {/* ═══ Step: Confirmation ═══ */}
        {isConfirmation && createdCode && (
          <div className="card p-8 text-center animate-in">
            <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-6">
              <Check className="w-10 h-10 text-emerald-500" />
            </div>
            <h2 className="text-2xl font-display font-bold text-slate-900 mb-2">Merci pour votre confiance !</h2>
            <p className="text-slate-500 mb-6">Votre numéro de ticket :</p>
            <div className="bg-brand-50 rounded-xl py-4 px-6 mb-4 border border-brand-100">
              <p className="text-4xl font-bold font-mono text-brand-600 tracking-wider">{createdCode}</p>
            </div>
            <p className="text-sm text-slate-400 mb-6">
              Conservez ce code pour suivre l'avancement de votre {isCommande ? 'commande' : 'réparation'}.
            </p>
            {countdown !== null && (
              <div className="mb-6">
                <div className="w-full bg-slate-200 rounded-full h-1.5 mb-2">
                  <div
                    className="bg-brand-500 h-1.5 rounded-full transition-all duration-1000"
                    style={{ width: `${(countdown / 10) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400">Retour automatique dans {countdown} seconde{countdown > 1 ? 's' : ''}...</p>
              </div>
            )}
            <div className="space-y-3">
              <button
                onClick={() => navigate(`/suivi?ticket=${createdCode}`)}
                className="btn-primary w-full"
              >
                <Send className="w-4 h-4" /> Suivre ma {isCommande ? 'commande' : 'réparation'}
              </button>
              <button onClick={resetForm} className="btn-secondary w-full">
                <ArrowLeft className="w-4 h-4" /> Nouveau dépôt
              </button>
            </div>
          </div>
        )}

        {/* Navigation */}
        {!isConfirmation && (
          <div className="flex justify-between mt-6">
            <button onClick={handleBack} className="btn-secondary">
              <ArrowLeft className="w-4 h-4" /> Retour
            </button>

            <button
              onClick={handleNext}
              disabled={loading || !canNext()}
              className={isLastStep ? 'btn-primary bg-emerald-600 hover:bg-emerald-700' : 'btn-primary'}
            >
              {loading ? 'Envoi...' : isLastStep ? 'Confirmer le dépôt' : 'Suivant'}
              {!isLastStep && <ArrowRight className="w-4 h-4" />}
              {isLastStep && <Check className="w-4 h-4" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
