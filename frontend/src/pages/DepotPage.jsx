import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import { invalidateCache } from '../hooks/useApi';
import { useToast } from '../components/Toast';
import PatternGrid from '../components/PatternGrid';
import ModelCombobox from '../components/ModelCombobox';
import { useCatalog } from '../hooks/useCatalog';
import { champsModele, modeleManquant, modeleRequis, MARQUE_AUTRE } from '../lib/catalog';
import { MentionRgpd, ConsentementMarketing } from './ConfidentialitePage';
import {
  ArrowLeft, ArrowRight, Check, Smartphone, User, AlertTriangle,
  Lock, Shield, Plus, RotateCcw, Clock,
} from 'lucide-react';

// Validation helpers
const isValidPhone = (tel) => /^(?:0|\+33\s?)[1-9](?:[\s.-]?\d{2}){4}$/.test(tel.replace(/\s/g, '').length >= 10 ? tel : '') || /^\d{10,14}$/.test(tel.replace(/[\s.-]/g, ''));
const isValidEmail = (email) => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidIMEI = (imei) => !imei || /^\d{15}$/.test(imei.replace(/[\s-]/g, ''));

const STEPS = ['Client', 'Appareil', 'Modèle', 'Panne', 'Sécurité', 'Confirmation'];

const INITIAL_FORM = {
  nom: '', prenom: '', telephone: '', email: '', societe: '',
  categorie: '', marque: '', modele: '', modele_autre: '',
  panne: '', panne_detail: '', pin: '', pattern: '', notes_client: '',
  imei: '', consentement_marketing: false, attente_boutique: false,
};

// Tuile de choix (catégorie, panne) : 56 px, bordure 2 px, sélection = marque
const tuile = (actif) => `min-h-14 px-4 py-3 rounded-lg border-2 text-base font-semibold text-left leading-snug
  transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
  ${actif ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`;

// En-tête d'étape : pastille marque 40 px + titre + sous-titre (span : `.depot-form p` forcerait 16 px)
function EnTete({ icone: Icone, titre, sousTitre }) {
  return (
    <div className="flex items-center gap-3 mb-1">
      <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0" aria-hidden="true">
        <Icone className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold leading-snug text-slate-900">{titre}</h2>
        <span className="block text-sm text-slate-500">{sousTitre}</span>
      </div>
    </div>
  );
}

export default function DepotPage() {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [createdCode, setCreatedCode] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const timerRef = useRef(null);

  const [categories, setCategories] = useState([]);
  const [pannes, setPannes] = useState([]);

  const [form, setForm] = useState({ ...INITIAL_FORM });
  const catalogue = useCatalog(form.categorie || null, form.marque);

  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => {});
    api.getPannes().then(setPannes).catch(() => {});
  }, []);

  useEffect(() => {
    if (form.categorie) {
      setForm(f => ({ ...f, marque: '', modele: '', modele_autre: '' }));
    }
  }, [form.categorie]);

  useEffect(() => {
    if (form.categorie && form.marque) {
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
  };

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
    if (step === 2) {
      if (!form.marque) errs.marque = 'Choisissez la marque';
      else if (modeleManquant(form)) {
        if (form.marque === MARQUE_AUTRE) errs.modele_autre = 'Veuillez préciser le modèle';
        else errs.modele = 'Choisissez votre modèle';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // <div> et non <p> : `.depot-form p` écraserait la couleur rouge de l'erreur
  const FieldError = ({ field }) => errors[field] ? (
    <div id={`borne-${field}-erreur`} role="alert" className="input-error text-sm">{errors[field]}</div>
  ) : null;
  const invalide = (field) => (errors[field] ? { 'aria-invalid': 'true', 'aria-describedby': `borne-${field}-erreur` } : {});

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const client = await api.createOrGetClient({
        nom: form.nom, prenom: form.prenom,
        telephone: form.telephone, email: form.email,
        societe: form.societe,
        rgpd_informe: true, consentement_marketing: Boolean(form.consentement_marketing),
      });
      const result = await api.createTicket({
        client_id: client.id, categorie: form.categorie,
        marque: form.marque,
        ...champsModele(form.marque, form.modele, form.modele_autre),
        panne: form.panne,
        panne_detail: form.panne_detail, pin: form.pin,
        pattern: form.pattern, notes_client: form.notes_client,
        ...(form.attente_boutique ? { priorite: 'attente' } : {}),
      });
      setCreatedCode(result.ticket_code);
      setStep(5);
      // Synchro dashboard/clients (la borne tourne dans la même SPA que le staff)
      invalidateCache('tickets', 'dashboard', 'interactions', 'clients');
    } catch (err) {
      toast.error(err.message || 'Erreur lors de la création du ticket');
    } finally {
      setLoading(false);
    }
  };

  const canNext = () => {
    if (step === 0) return form.nom && form.telephone;
    if (step === 1) return form.categorie;
    if (step === 2) return form.marque && !modeleManquant(form);
    if (step === 3) return form.panne;
    if (step === 4) return true;
    return true;
  };

  const handleNext = () => {
    if (!validateStep()) return;
    if (step === 4) {
      handleSubmit();
    } else {
      setStep(s => s + 1);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Kiosk header — no sidebar */}
      <div className="bg-slate-900 text-white px-4 sm:px-6 py-3 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-white p-1 overflow-hidden shrink-0">
            <img src="/logo_k.png" alt="Klikphone" className="w-full h-full object-contain" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-display font-bold tracking-tight leading-tight">KLIKPHONE</h1>
            <p className="text-xs text-slate-400 truncate">Déposer un appareil en réparation</p>
          </div>
        </div>
        {step < 5 && (
          <div className="text-right shrink-0">
            <p className="text-xs text-slate-400 tabular-nums">Étape {step + 1} / {STEPS.length}</p>
            <p className="text-sm font-semibold text-brand-300">{STEPS[step]}</p>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col">
        <div className="depot-form w-full max-w-[640px] mx-auto px-4 py-5 sm:py-6 pb-10 flex-1 flex flex-col">
          {/* Progress bar with circles (stepper monochrome : la progression se lit au poids) */}
          {step < 5 && (
            <div className="grid grid-cols-6 w-full min-w-0 mb-6">
              {STEPS.map((s, i) => {
                const fait = i < step;
                const courant = i === step;
                return (
                  <div key={i} className="relative flex flex-col items-center min-w-0 px-0.5">
                    {/* Connector line */}
                    {i > 0 && (
                      <div className={`absolute top-[15px] h-0.5 rounded-full left-[calc(-50%_+_18px)] right-[calc(50%_+_18px)] ${
                        i <= step ? 'bg-brand-200' : 'bg-slate-200'
                      }`} aria-hidden="true" />
                    )}
                    {/* Circle */}
                    <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold tabular-nums transition-colors duration-150 ${
                      fait ? 'bg-brand-600 text-white'
                      : courant ? 'bg-white border-2 border-brand-600 text-brand-700'
                      : 'bg-slate-100 text-slate-500'
                    }`} aria-current={courant ? 'step' : undefined}>
                      {fait ? <Check className="w-4 h-4" aria-hidden="true" /> : i + 1}
                    </div>
                    <span lang="fr" className={`mt-1.5 max-w-full text-xs text-center leading-tight tracking-tight break-words hyphens-auto ${
                      courant ? 'font-semibold text-brand-700' : fait ? 'font-medium text-brand-700' : 'font-medium text-slate-500'
                    }`}>{s}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Step 0: Client */}
          {step === 0 && (
            <div className="card p-5 sm:p-6 space-y-5 animate-in">
              <EnTete icone={User} titre="Vos coordonnées" sousTitre="Informations de contact" />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="borne-nom" className="input-label">Nom *</label>
                  <input id="borne-nom" value={form.nom} onChange={e => updateForm('nom', e.target.value)}
                    autoComplete="family-name" className="input" placeholder="Dupont" {...invalide('nom')} />
                  <FieldError field="nom" />
                </div>
                <div>
                  <label htmlFor="borne-prenom" className="input-label">Prénom</label>
                  <input id="borne-prenom" value={form.prenom} onChange={e => updateForm('prenom', e.target.value)}
                    autoComplete="given-name" className="input" placeholder="Jean" />
                </div>
              </div>
              <div>
                <label htmlFor="borne-telephone" className="input-label">Téléphone *</label>
                <input id="borne-telephone" type="tel" inputMode="tel" autoComplete="tel" value={form.telephone} onChange={e => updateForm('telephone', e.target.value)}
                  className="input" placeholder="06 XX XX XX XX" {...invalide('telephone')} />
                <FieldError field="telephone" />
              </div>
              <div>
                <label htmlFor="borne-email" className="input-label">Email</label>
                <input id="borne-email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={e => updateForm('email', e.target.value)}
                  className="input" placeholder="optionnel" {...invalide('email')} />
                <FieldError field="email" />
              </div>
              <div>
                <label htmlFor="borne-societe" className="input-label">Société</label>
                <input id="borne-societe" value={form.societe} onChange={e => updateForm('societe', e.target.value)}
                  autoComplete="organization" className="input" placeholder="optionnel" />
              </div>
              <ConsentementMarketing id="borne-consentement" checked={form.consentement_marketing}
                onChange={(v) => updateForm('consentement_marketing', v)} />
              <MentionRgpd kiosque />
            </div>
          )}

          {/* Step 1: Catégorie */}
          {step === 1 && (
            <div className="card p-5 sm:p-6 space-y-5 animate-in">
              <EnTete icone={Smartphone} titre="Type d'appareil" sousTitre="Sélectionnez la catégorie" />

              <div className="grid grid-cols-2 gap-3">
                {categories.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    aria-pressed={form.categorie === cat}
                    onClick={() => updateForm('categorie', cat)}
                    className={tuile(form.categorie === cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Marque & Modèle */}
          {step === 2 && (
            <div className="card p-5 sm:p-6 space-y-5 animate-in">
              <EnTete icone={Smartphone} titre="Marque & modèle" sousTitre={form.categorie} />

              <div>
                <label htmlFor="borne-marque" className="input-label">Marque *</label>
                <select id="borne-marque" value={form.marque} onChange={e => updateForm('marque', e.target.value)}
                  className="select input pr-12" {...invalide('marque')}>
                  <option value="">{catalogue.loading && !catalogue.marques.length ? 'Chargement…' : 'Sélectionner...'}</option>
                  {catalogue.marques.map(m => <option key={m} value={m}>{m}</option>)}
                  <option value={MARQUE_AUTRE}>Autre</option>
                </select>
                <FieldError field="marque" />
              </div>

              {form.marque && form.marque !== MARQUE_AUTRE && (
                <ModelCombobox
                  id="borne-modele"
                  label="Modèle"
                  required={modeleRequis(form.categorie)}
                  marque={form.marque}
                  modeles={catalogue.modelesDe(form.marque)}
                  loading={catalogue.loading}
                  value={form.modele}
                  onChange={(texte) => updateForm('modele', texte)}
                  error={errors.modele}
                />
              )}

              {form.marque === MARQUE_AUTRE && (
                <div>
                  <label htmlFor="borne-modele-autre" className="input-label">Préciser marque / modèle *</label>
                  <input id="borne-modele-autre" value={form.modele_autre} onChange={e => updateForm('modele_autre', e.target.value)}
                    className="input" placeholder="Ex: Samsung Galaxy S24" autoFocus {...invalide('modele_autre')} />
                  <FieldError field="modele_autre" />
                </div>
              )}
            </div>
          )}

          {/* Step 3: Panne */}
          {step === 3 && (
            <div className="card p-5 sm:p-6 space-y-5 animate-in">
              <EnTete icone={AlertTriangle} titre="Le problème" sousTitre="Décrivez la panne" />

              <fieldset>
                <legend className="input-label">Type de panne *</legend>
                <div className="grid grid-cols-2 gap-3">
                  {pannes.map(p => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={form.panne === p}
                      onClick={() => updateForm('panne', p)}
                      className={tuile(form.panne === p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor="borne-panne-detail" className="input-label">Détails supplémentaires</label>
                <textarea
                  id="borne-panne-detail"
                  value={form.panne_detail}
                  onChange={e => updateForm('panne_detail', e.target.value)}
                  className="input resize-none"
                  rows={3}
                  placeholder="Décrivez plus précisément le problème..."
                />
              </div>

              <div>
                <label htmlFor="borne-notes" className="input-label">Notes</label>
                <textarea
                  id="borne-notes"
                  value={form.notes_client}
                  onChange={e => updateForm('notes_client', e.target.value)}
                  className="input resize-none"
                  rows={2}
                  placeholder="Informations complémentaires (accessoires, état cosmétique...)"
                />
              </div>

              <label htmlFor="borne-attente" className="flex items-start gap-3 p-4 min-h-14 rounded-lg border-2 border-slate-200 bg-white has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 cursor-pointer transition-colors duration-150">
                <input id="borne-attente" type="checkbox" checked={form.attente_boutique}
                  onChange={e => updateForm('attente_boutique', e.target.checked)}
                  aria-describedby="borne-attente-aide"
                  className="checkbox w-6 h-6 mt-0.5" />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-base font-semibold text-slate-900">
                    <Clock className="w-5 h-5 text-brand-600 shrink-0" aria-hidden="true" /> Je patiente en boutique
                  </span>
                  <span id="borne-attente-aide" className="block text-sm text-slate-600 mt-0.5">
                    L'atelier traite en priorité les clients qui attendent sur place.
                  </span>
                </span>
              </label>
            </div>
          )}

          {/* Step 4: Sécurité */}
          {step === 4 && (
            <div className="card p-5 sm:p-6 space-y-5 animate-in">
              <EnTete icone={Lock} titre="Codes d'accès" sousTitre="Optionnel — nécessaire pour le diagnostic" />

              <div className="callout callout-info">
                <Shield aria-hidden="true" />
                <span>Ces informations sont confidentielles et nécessaires uniquement pour le diagnostic de votre appareil.</span>
              </div>

              <div>
                <label htmlFor="borne-pin" className="input-label flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-slate-500" aria-hidden="true" /> Code PIN / Mot de passe
                </label>
                <input
                  id="borne-pin"
                  type="text"
                  autoComplete="off"
                  value={form.pin}
                  onChange={e => updateForm('pin', e.target.value)}
                  className="input text-center text-xl font-mono tracking-widest"
                  placeholder="••••"
                />
              </div>

              <div>
                <div className="input-label flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-slate-500" aria-hidden="true" /> Schéma de déverrouillage
                </div>
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
            <div className="card p-6 sm:p-8 text-center animate-in">
              <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-5" aria-hidden="true">
                <Check className="w-10 h-10 text-emerald-700" />
              </div>
              <h2 className="t-display text-balance mb-2">Demande enregistrée !</h2>
              <p className="text-slate-500 mb-5">Votre numéro de ticket :</p>
              <div className="bg-brand-50 rounded-xl py-4 px-6 mb-5 border border-brand-200">
                {/* <div> et non <p> : `.depot-form p` ramènerait le code à 16 px slate-700 */}
                <div className="text-3xl sm:text-4xl font-bold font-mono text-brand-700 tracking-wider tabular-nums">{createdCode}</div>
              </div>
              <p className="text-slate-600 mb-6">
                Conservez ce code pour suivre l'avancement de votre réparation.
              </p>

              {/* Countdown */}
              {countdown !== null && (
                <div className="mb-6">
                  <div className="w-16 h-16 mx-auto rounded-full border-4 border-slate-200 flex items-center justify-center" aria-hidden="true">
                    <span className="text-2xl font-bold text-slate-700 tabular-nums">{countdown}</span>
                  </div>
                  <span className="block text-sm text-slate-500 mt-2 tabular-nums">Retour automatique dans {countdown}s</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleReset}
                className="btn-primary btn-lg btn-block"
              >
                <Plus aria-hidden="true" /> Nouveau dépôt
              </button>
            </div>
          )}

          {/* Navigation */}
          {step < 5 && (
            <div className="flex justify-between gap-3 mt-6">
              <button
                type="button"
                onClick={() => step === 0 ? handleReset() : setStep(s => s - 1)}
                className={`${step === 0 ? 'btn-ghost' : 'btn-secondary'} btn-lg min-h-14`}
              >
                {step === 0 ? <><RotateCcw aria-hidden="true" /> Réinitialiser</> : <><ArrowLeft aria-hidden="true" /> Retour</>}
              </button>

              <button
                type="button"
                onClick={handleNext}
                disabled={loading || !canNext()}
                className="btn-primary btn-lg min-h-14 flex-1 sm:flex-none sm:min-w-[220px]"
              >
                {loading ? 'Envoi...' : step === 4 ? 'Confirmer le dépôt' : 'Suivant'}
                {step < 4 && <ArrowRight aria-hidden="true" />}
                {step === 4 && <Check aria-hidden="true" />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
