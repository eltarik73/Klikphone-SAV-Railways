import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import PatternGrid from '../components/PatternGrid';
import {
  ArrowLeft, ArrowRight, Check, Smartphone, User, AlertTriangle,
  Lock, Shield, Plus, RotateCcw,
} from 'lucide-react';

const STEPS = ['Client', 'Appareil', 'Modèle', 'Panne', 'Sécurité', 'Confirmation'];

const INITIAL_FORM = {
  nom: '', prenom: '', telephone: '', email: '', societe: '',
  categorie: '', marque: '', modele: '', modele_autre: '',
  panne: '', panne_detail: '', pin: '', pattern: '', notes_client: '',
  imei: '',
};

export default function DepotPage() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [createdCode, setCreatedCode] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const timerRef = useRef(null);

  const [categories, setCategories] = useState([]);
  const [marques, setMarques] = useState([]);
  const [modeles, setModeles] = useState([]);
  const [pannes, setPannes] = useState([]);

  const [form, setForm] = useState({ ...INITIAL_FORM });

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
    if (form.categorie && form.marque) {
      api.getModeles(form.categorie, form.marque).then(setModeles).catch(() => setModeles([]));
      setForm(f => ({ ...f, modele: '', modele_autre: '' }));
    }
  }, [form.marque]);

  // Auto-reset countdown on confirmation step
  useEffect(() => {
    if (step === 5 && createdCode) {
      setCountdown(10);
      timerRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            handleReset();
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [step, createdCode]);

  const handleReset = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setForm({ ...INITIAL_FORM });
    setStep(0);
    setCreatedCode(null);
    setCountdown(null);
    setMarques([]);
    setModeles([]);
  };

  const updateForm = (field, value) => setForm(f => ({ ...f, [field]: value }));

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
        marque: form.marque, modele: form.modele,
        modele_autre: form.modele_autre, panne: form.panne,
        panne_detail: form.panne_detail, pin: form.pin,
        pattern: form.pattern, notes_client: form.notes_client, imei: form.imei,
      });
      setCreatedCode(result.ticket_code);
      setStep(5);
    } catch (err) {
      alert(err.message || 'Erreur lors de la création');
    } finally {
      setLoading(false);
    }
  };

  const canNext = () => {
    if (step === 0) return form.nom && form.telephone;
    if (step === 1) return form.categorie;
    if (step === 2) return form.marque;
    if (step === 3) return form.panne;
    if (step === 4) return true;
    return true;
  };

  const handleNext = () => {
    if (step === 4) {
      handleSubmit();
    } else {
      setStep(s => s + 1);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-brand-50/30 flex flex-col">
      {/* Kiosk header — no sidebar */}
      <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <img src="/logo_k.png" alt="Klikphone" className="w-10 h-10 rounded-xl object-contain" />
          <div>
            <h1 className="text-lg font-display font-bold tracking-tight">KLIKPHONE</h1>
            <p className="text-[11px] text-slate-400">Déposer un appareil en réparation</p>
          </div>
        </div>
        {step < 5 && (
          <div className="text-right">
            <p className="text-xs text-slate-400">Étape {step + 1} / {STEPS.length}</p>
            <p className="text-sm font-semibold text-brand-300">{STEPS[step]}</p>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col">
        <div className="max-w-lg mx-auto w-full px-4 py-6 flex-1 flex flex-col">
          {/* Progress bar */}
          {step < 5 && (
            <div className="flex gap-1 mb-8">
              {STEPS.map((s, i) => (
                <div key={i} className="flex-1">
                  <div className={`h-2 rounded-full transition-all duration-500 ${
                    i < step ? 'bg-brand-500' : i === step ? 'bg-brand-400' : 'bg-slate-200'
                  }`} />
                  <p className={`text-[9px] font-medium mt-1 text-center ${
                    i <= step ? 'text-brand-600' : 'text-slate-400'
                  }`}>{s}</p>
                </div>
              ))}
            </div>
          )}

          {/* Step 0: Client */}
          {step === 0 && (
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
                  <input value={form.nom} onChange={e => updateForm('nom', e.target.value)} className="input" placeholder="Dupont" />
                </div>
                <div>
                  <label className="input-label">Prénom</label>
                  <input value={form.prenom} onChange={e => updateForm('prenom', e.target.value)} className="input" placeholder="Jean" />
                </div>
              </div>
              <div>
                <label className="input-label">Téléphone *</label>
                <input type="tel" value={form.telephone} onChange={e => updateForm('telephone', e.target.value)} className="input" placeholder="06 XX XX XX XX" />
              </div>
              <div>
                <label className="input-label">Email</label>
                <input type="email" value={form.email} onChange={e => updateForm('email', e.target.value)} className="input" placeholder="optionnel" />
              </div>
              <div>
                <label className="input-label">Société</label>
                <input value={form.societe} onChange={e => updateForm('societe', e.target.value)} className="input" placeholder="optionnel" />
              </div>
            </div>
          )}

          {/* Step 1: Catégorie */}
          {step === 1 && (
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

          {/* Step 2: Marque & Modèle */}
          {step === 2 && (
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
                <input value={form.imei} onChange={e => updateForm('imei', e.target.value)} className="input font-mono" placeholder="Tapez *#06# sur votre appareil" />
              </div>
            </div>
          )}

          {/* Step 3: Panne */}
          {step === 3 && (
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
            </div>
          )}

          {/* Step 4: Sécurité */}
          {step === 4 && (
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

          {/* Step 5: Confirmation */}
          {step === 5 && createdCode && (
            <div className="card p-8 text-center animate-in">
              <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-6">
                <Check className="w-10 h-10 text-emerald-500" />
              </div>
              <h2 className="text-2xl font-display font-bold text-slate-900 mb-2">Demande enregistrée !</h2>
              <p className="text-slate-500 mb-6">Votre numéro de ticket :</p>
              <div className="bg-brand-50 rounded-xl py-4 px-6 mb-6 border border-brand-100">
                <p className="text-3xl font-bold font-mono text-brand-600 tracking-wider">{createdCode}</p>
              </div>
              <p className="text-sm text-slate-400 mb-6">
                Conservez ce code pour suivre l'avancement de votre réparation.
              </p>

              {/* Countdown */}
              {countdown !== null && (
                <div className="mb-6">
                  <div className="w-16 h-16 mx-auto rounded-full border-4 border-slate-200 flex items-center justify-center">
                    <span className="text-2xl font-bold text-slate-600 font-mono">{countdown}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">Retour automatique dans {countdown}s</p>
                </div>
              )}

              <button
                onClick={handleReset}
                className="btn-primary w-full text-base py-3"
              >
                <Plus className="w-5 h-5" /> Nouveau dépôt
              </button>
            </div>
          )}

          {/* Navigation */}
          {step < 5 && (
            <div className="flex justify-between mt-6">
              <button
                onClick={() => step === 0 ? handleReset() : setStep(s => s - 1)}
                className="btn-secondary"
              >
                {step === 0 ? <><RotateCcw className="w-4 h-4" /> Réinitialiser</> : <><ArrowLeft className="w-4 h-4" /> Retour</>}
              </button>

              <button
                onClick={handleNext}
                disabled={loading || !canNext()}
                className={step === 4 ? 'btn-primary bg-emerald-600 hover:bg-emerald-700' : 'btn-primary'}
              >
                {loading ? 'Envoi...' : step === 4 ? 'Confirmer le dépôt' : 'Suivant'}
                {step < 4 && <ArrowRight className="w-4 h-4" />}
                {step === 4 && <Check className="w-4 h-4" />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
