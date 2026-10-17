import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import { invalidateCache } from '../hooks/useApi';
import { useToast } from '../components/Toast';
import ChoixCodeAcces, { resumeAcces, erreurAcces } from '../components/ChoixCodeAcces';
import {
  isValidPhone, isValidEmail, EnTete, BarreEtapes, ChampsVous, ChampsAppareil, ChampsPanne,
  CaseAttente, Recapitulatif, libelleAppareil, lignesVous,
} from '../components/DepotEtapes';
import { useCatalog } from '../hooks/useCatalog';
import { champsModele, modeleManquant, MARQUE_AUTRE } from '../lib/catalog';
import { MentionRgpd, ConsentementMarketing, useInfosRgpd } from './ConfidentialitePage';
import {
  ArrowLeft, ArrowRight, Check, Smartphone, User, AlertTriangle, KeyRound, Plus, RotateCcw, ClipboardCheck,
} from 'lucide-react';

/**
 * Dépôt au comptoir (/depot), même parcours en 4 étapes que la borne client : Vous · Votre
 * appareil · Le problème et l'accès · Vérification, puis le numéro de ticket (retour automatique).
 */
const PREFIX = 'borne';

const ETAPES = [
  { id: 'vous', court: 'Vous', titre: 'Vous', sousTitre: 'Vos coordonnées, pour vous prévenir quand c’est prêt', icone: User },
  { id: 'appareil', court: 'Appareil', titre: 'Votre appareil', sousTitre: 'Le type, la marque et le modèle', icone: Smartphone },
  { id: 'detail', court: 'Problème', titre: "Le problème et l'accès", sousTitre: "Ce qui ne va pas, et comment s'ouvre votre appareil", icone: AlertTriangle },
  { id: 'verification', court: 'Vérification', titre: 'Vérification', sousTitre: 'Relisez avant de déposer : tout est modifiable', icone: ClipboardCheck },
];
const VERIFICATION = ETAPES.length - 1;

const INITIAL_FORM = {
  nom: '', prenom: '', telephone: '', tel_contact: '', email: '', societe: '',
  categorie: '', marque: '', modele: '', modele_autre: '',
  panne: '', panne_detail: '', pin: '', pattern: '', acces_mode: null, notes_client: '',
  imei: '', carte_camby: false, consentement_marketing: false, attente_boutique: false,
};

export default function DepotPage() {
  const toast = useToast();
  const infosRgpd = useInfosRgpd();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [createdCode, setCreatedCode] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const timerRef = useRef(null);
  const titreRef = useRef(null);

  const [categories, setCategories] = useState([]);
  const [pannes, setPannes] = useState([]);

  const [form, setForm] = useState({ ...INITIAL_FORM });
  const catalogue = useCatalog(form.categorie || null, form.marque);
  const etape = ETAPES[step] || ETAPES[0];
  const termine = Boolean(createdCode);
  const isVerification = step === VERIFICATION;

  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => {});
    api.getPannes().then(setPannes).catch(() => {});
  }, []);

  useEffect(() => {
    if (form.categorie) {
      setForm((f) => ({ ...f, marque: '', modele: '', modele_autre: '' }));
    }
  }, [form.categorie]);

  useEffect(() => {
    if (form.categorie && form.marque) {
      setForm((f) => ({ ...f, modele: '', modele_autre: '' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.marque]);

  // Retour automatique 10 s après la confirmation
  useEffect(() => {
    if (createdCode) {
      setCountdown(10);
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createdCode]);

  // Nouvelle étape : haut de page et titre annoncé
  useEffect(() => {
    titreRef.current?.scrollIntoView?.({ block: 'start' });
    titreRef.current?.focus?.({ preventScroll: true });
  }, [step, termine]);

  const handleReset = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setForm({ ...INITIAL_FORM });
    setStep(0);
    setErrors({});
    setCreatedCode(null);
    setCountdown(null);
  };

  const updateForm = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const updateAcces = ({ pin, pattern, mode }) => {
    setForm((f) => ({ ...f, pin, pattern, acces_mode: mode }));
    setErrors((e) => ({ ...e, acces: undefined }));
  };

  const validateStep = () => {
    const errs = {};
    if (step === 0) {
      if (!form.nom.trim()) errs.nom = 'Le nom est requis';
      if (!form.telephone.trim()) errs.telephone = 'Le téléphone est requis';
      else if (!isValidPhone(form.telephone)) errs.telephone = 'Numéro invalide (10 chiffres min.)';
      if (form.tel_contact.trim() && !isValidPhone(form.tel_contact)) errs.tel_contact = 'Numéro invalide (10 chiffres min.)';
      if (form.email && !isValidEmail(form.email)) errs.email = 'Email invalide';
    }
    if (step === 1) {
      if (!form.categorie) errs.categorie = "Choisissez le type d'appareil";
      else if (!form.marque) errs.marque = 'Choisissez la marque';
      else if (modeleManquant(form)) {
        if (form.marque === MARQUE_AUTRE) errs.modele_autre = 'Veuillez préciser le modèle';
        else errs.modele = 'Choisissez votre modèle';
      }
    }
    if (step === 2) {
      if (!form.panne) errs.panne = 'Choisissez ce qui ne va pas';
      const acces = erreurAcces(form);
      if (acces) errs.acces = acces;
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => document.querySelector('[role="alert"]')?.scrollIntoView?.({ block: 'center' }));
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const client = await api.createOrGetClient({
        nom: form.nom, prenom: form.prenom,
        telephone: form.telephone, email: form.email,
        societe: form.societe, carte_camby: form.carte_camby ? 1 : 0,
        rgpd_informe: true, consentement_marketing: Boolean(form.consentement_marketing),
      });
      const result = await api.createTicket({
        client_id: client.id, categorie: form.categorie,
        marque: form.marque,
        ...champsModele(form.marque, form.modele, form.modele_autre),
        panne: form.panne,
        panne_detail: form.panne_detail, pin: form.pin,
        pattern: form.pattern, notes_client: form.notes_client,
        tel_contact: form.tel_contact.trim() || null,
        ...(form.attente_boutique ? { priorite: 'attente' } : {}),
      });
      setCreatedCode(result.ticket_code);
      // Synchro dashboard/clients (la borne tourne dans la même SPA que le staff)
      invalidateCache('tickets', 'dashboard', 'interactions', 'clients');
    } catch (err) {
      toast.error(err.message || 'Erreur lors de la création du ticket');
    } finally {
      setLoading(false);
    }
  };

  const canNext = () => {
    if (step === 0) return Boolean(form.nom && form.telephone);
    if (step === 1) return Boolean(form.categorie && form.marque && !modeleManquant(form));
    if (step === 2) return Boolean(form.panne);
    return true;
  };

  const handleNext = () => {
    if (!validateStep()) return;
    if (isVerification) handleSubmit();
    else setStep((s) => s + 1);
  };

  const allerA = (i) => {
    setErrors({});
    setStep(i);
  };

  const sectionsRecap = [
    { id: 'vous', titre: 'Vous', icone: User, lignes: lignesVous(form), onModifier: () => allerA(0) },
    {
      id: 'appareil', titre: 'Votre appareil', icone: Smartphone, onModifier: () => allerA(1),
      lignes: [{ label: 'Type', valeur: form.categorie }, { label: 'Marque et modèle', valeur: libelleAppareil(form) }],
    },
    {
      id: 'detail', titre: "Le problème et l'accès", icone: AlertTriangle, onModifier: () => allerA(2),
      lignes: [
        { label: 'Problème', valeur: form.panne },
        { label: 'Détails', valeur: form.panne_detail },
        { label: 'Notes', valeur: form.notes_client },
        { label: 'Accès', valeur: resumeAcces(form), masque: true },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* En-tête borne — pas de barre latérale */}
      <div className="bg-slate-900 text-white px-4 sm:px-6 py-3 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-white p-1 overflow-hidden shrink-0">
            <img src="/logo_k.png" alt="Klikphone" className="w-full h-full object-contain" />
          </div>
          <div className="min-w-0">
            <h1 ref={titreRef} tabIndex={-1} className="text-lg font-display font-bold tracking-tight leading-tight focus:outline-none">KLIKPHONE</h1>
            <p className="text-xs text-slate-400 truncate">Déposer un appareil en réparation</p>
          </div>
        </div>
        {!termine && (
          <div className="text-right shrink-0">
            <p className="text-xs text-slate-400 tabular-nums">Étape {step + 1} / {ETAPES.length}</p>
            <p className="text-sm font-semibold text-brand-300">{etape.titre}</p>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col">
        <div className="depot-form w-full max-w-[640px] mx-auto px-4 py-5 sm:py-6 pb-10 flex-1 flex flex-col">
          {!termine && <BarreEtapes etapes={ETAPES} courante={step} />}

          {/* Étape 1 : Vous */}
          {!termine && step === 0 && (
            <div className="card p-5 sm:p-6 space-y-5 animate-in">
              <EnTete icone={etape.icone} titre={etape.titre} sousTitre={etape.sousTitre} />
              <ChampsVous prefix={PREFIX} form={form} errors={errors} onChange={updateForm} />
            </div>
          )}

          {/* Étape 2 : Votre appareil */}
          {!termine && step === 1 && (
            <div className="card p-5 sm:p-6 space-y-5 animate-in">
              <EnTete icone={etape.icone} titre={etape.titre} sousTitre={etape.sousTitre} />
              <ChampsAppareil
                prefix={PREFIX} form={form} errors={errors} onChange={updateForm}
                categories={categories} catalogue={catalogue}
              />
            </div>
          )}

          {/* Étape 3 : Le problème et l'accès */}
          {!termine && step === 2 && (
            <div className="card p-5 sm:p-6 space-y-5 animate-in">
              <EnTete icone={etape.icone} titre={etape.titre} sousTitre={etape.sousTitre} />
              <ChampsPanne prefix={PREFIX} form={form} errors={errors} onChange={updateForm} pannes={pannes} />

              <div className="border-t border-slate-100 pt-5">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900 mb-3">
                  <KeyRound className="w-5 h-5 text-brand-600 shrink-0" aria-hidden="true" /> L'accès à votre appareil
                </h3>
                <ChoixCodeAcces
                  idPrefix={`${PREFIX}-acces`}
                  pin={form.pin}
                  pattern={form.pattern}
                  mode={form.acces_mode}
                  onChange={updateAcces}
                  taille="borne"
                  purgeJours={infosRgpd.purgeJours}
                  error={errors.acces}
                />
              </div>
            </div>
          )}

          {/* Étape 4 : Vérification */}
          {!termine && isVerification && (
            <div className="card p-5 sm:p-6 space-y-5 animate-in">
              <EnTete icone={etape.icone} titre={etape.titre} sousTitre={etape.sousTitre} />
              <Recapitulatif sections={sectionsRecap} />
              <CaseAttente prefix={PREFIX} checked={form.attente_boutique} onChange={(v) => updateForm('attente_boutique', v)} />
              <ConsentementMarketing id={`${PREFIX}-consentement`} checked={form.consentement_marketing}
                onChange={(v) => updateForm('consentement_marketing', v)} />
              <MentionRgpd kiosque />
            </div>
          )}

          {/* Confirmation */}
          {termine && (
            <div className="card p-6 sm:p-8 text-center animate-in">
              <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-5" aria-hidden="true">
                <Check className="w-10 h-10 text-emerald-700" />
              </div>
              <h2 className="t-display text-balance mb-2">Demande enregistrée !</h2>
              <p className="text-slate-600 mb-5">Votre numéro de ticket :</p>
              <div className="bg-brand-50 rounded-xl py-4 px-6 mb-5 border border-brand-200">
                {/* <div> et non <p> : `.depot-form p` ramènerait le code à 16 px slate-700 */}
                <div className="text-3xl sm:text-4xl font-bold font-mono text-brand-700 tracking-wider tabular-nums">{createdCode}</div>
              </div>
              <p className="text-slate-600 mb-6">
                Conservez ce code pour suivre l'avancement de votre réparation.
              </p>

              {countdown !== null && (
                <div className="mb-6">
                  <div className="w-16 h-16 mx-auto rounded-full border-4 border-slate-200 flex items-center justify-center" aria-hidden="true">
                    <span className="text-2xl font-bold text-slate-700 tabular-nums">{countdown}</span>
                  </div>
                  <span className="block text-sm text-slate-600 mt-2 tabular-nums">Retour automatique dans {countdown}s</span>
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
          {!termine && (
            <div className="flex justify-between gap-3 mt-6">
              <button
                type="button"
                onClick={() => (step === 0 ? handleReset() : allerA(step - 1))}
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
                {loading ? 'Envoi...' : isVerification ? "Déposer l'appareil" : 'Suivant'}
                {!isVerification && <ArrowRight aria-hidden="true" />}
                {isVerification && !loading && <Check aria-hidden="true" />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
