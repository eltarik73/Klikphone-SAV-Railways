import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { lienSuivi } from '../lib/ticketCode';
import ModelCombobox from '../components/ModelCombobox';
import ChoixCodeAcces, { erreurAcces } from '../components/ChoixCodeAcces';
import { tuile, EnTete, ChampsVous, TuilesPannes, isValidPhone, isValidEmail, estTelephoneFictif, MESSAGE_TEL_FICTIF,
} from '../components/DepotEtapes';
import { useCatalog } from '../hooks/useCatalog';
import { champsModele, modeleManquant, modeleRequis, MARQUE_AUTRE } from '../lib/catalog';
import { MentionRgpd, ConsentementMarketing, useInfosRgpd } from './ConfidentialitePage';
import {
  ArrowLeft, ArrowRight, Check, Smartphone, User, AlertTriangle, AlertCircle, KeyRound,
  Send, MapPin, Phone, Clock, Globe, Copy, Share2, MessageCircle, Loader2,
} from 'lucide-react';

const STEPS = ['Coordonnées', 'Appareil', 'Panne'];

// <div> et non <p> : `.depot-form p` imposerait 16 px à cette mention
function PiedDePage() {
  return (
    <div className="text-center py-3 text-xs text-slate-500">
      Propulsé par{' '}
      <span className="font-extrabold">
        <span className="text-brand-600">Tk</span>
        <span className="text-slate-900">S</span>
        <span className="text-pink-700">∞</span>
        <span className="text-slate-900">26</span>
      </span>
      {' '}— une solution{' '}
      <span className="font-bold text-brand-600">Klik&Dev</span>
    </div>
  );
}

export default function DeposerPage() {
  const navigate = useNavigate();
  const infosRgpd = useInfosRgpd();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [createdCode, setCreatedCode] = useState(null);
  // Jeton du lien de suivi renvoyé à la création (sinon le client saisira son téléphone)
  const [createdToken, setCreatedToken] = useState(null);

  const [categories, setCategories] = useState([]);
  const [pannes, setPannes] = useState([]);

  const [form, setForm] = useState({
    nom: '', prenom: '', telephone: '', tel_contact: '', email: '',
    categorie: '', marque: '', modele: '', modele_autre: '',
    panne: '', panne_detail: '', notes_client: '',
    pin: '', pattern: '', acces_mode: null,
    carte_camby: false, consentement_marketing: false,
  });
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
    setForm(f => ({ ...f, modele: '', modele_autre: '' }));
  }, [form.marque]);

  const updateForm = (field, value) => {
    setForm(f => ({ ...f, [field]: value }));
    setErrors(e => ({ ...e, [field]: undefined }));
  };

  const updateAcces = ({ pin, pattern, mode }) => {
    setForm(f => ({ ...f, pin, pattern, acces_mode: mode }));
    setErrors(e => ({ ...e, acces: undefined }));
  };

  const validateStep = () => {
    const errs = {};
    if (step === 0) {
      if (!form.nom.trim()) errs.nom = 'Le nom est requis';
      if (!form.telephone.trim()) errs.telephone = 'Le téléphone est requis';
      else if (!isValidPhone(form.telephone)) errs.telephone = 'Numéro invalide (10 chiffres min.)';
      else if (estTelephoneFictif(form.telephone)) errs.telephone = MESSAGE_TEL_FICTIF;
      if (form.tel_contact.trim() && !isValidPhone(form.tel_contact)) errs.tel_contact = 'Numéro invalide (10 chiffres min.)';
      else if (form.tel_contact.trim() && estTelephoneFictif(form.tel_contact)) errs.tel_contact = MESSAGE_TEL_FICTIF;
      if (form.email && !isValidEmail(form.email)) errs.email = 'Email invalide';
    }
    if (step === 1) {
      if (!form.categorie) errs.categorie = 'La catégorie est requise';
      if (!form.marque) errs.marque = 'La marque est requise';
      else if (modeleManquant(form)) {
        if (form.marque === MARQUE_AUTRE) errs.modele_autre = 'Veuillez préciser le modèle';
        else errs.modele = 'Choisissez votre modèle';
      }
    }
    if (step === 2) {
      if (!form.panne) errs.panne = 'Veuillez sélectionner une panne';
      // Code facultatif à distance : seule une tuile choisie sans valeur est signalée
      if (form.acces_mode === 'code' || form.acces_mode === 'schema') {
        const acces = erreurAcces(form);
        if (acces) errs.acces = acces;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const canNext = () => {
    if (step === 0) return form.nom && form.telephone;
    if (step === 1) return form.categorie && form.marque && !modeleManquant(form);
    if (step === 2) return form.panne;
    return true;
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const result = await api.createDepotDistance({
        nom: form.nom.trim(),
        prenom: (form.prenom || '').trim(),
        telephone: form.telephone.trim(),
        tel_contact: form.tel_contact.trim() || null,
        email: (form.email || '').trim(),
        carte_camby: form.carte_camby ? 1 : 0,
        rgpd_informe: true, consentement_marketing: Boolean(form.consentement_marketing),
        categorie: form.categorie,
        marque: form.marque,
        ...champsModele(form.marque, form.modele, form.modele_autre),
        panne: form.panne,
        panne_detail: (form.panne_detail || '').trim(),
        notes_client: (form.notes_client || '').trim(),
        pin: form.pin,
        pattern: form.pattern,
      });
      setCreatedToken(result.suivi_token || null);
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

  // <div> et non <p> : `.depot-form p` écraserait la couleur rouge de l'erreur
  const FieldError = ({ field }) => errors[field] ? (
    <div id={`distance-${field}-erreur`} role="alert" className="input-error text-sm">{errors[field]}</div>
  ) : null;
  const invalide = (field) => (errors[field] ? { 'aria-invalid': 'true', 'aria-describedby': `distance-${field}-erreur` } : {});

  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(createdCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const handleShare = () => {
    const url = lienSuivi(window.location.origin, createdCode, createdToken);
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
    const url = lienSuivi(window.location.origin, createdCode, createdToken);
    const msg = `Klikphone - Votre numéro de suivi : ${createdCode}\nSuivez votre réparation ici : ${url}`;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // Confirmation screen
  if (createdCode) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-[640px] mx-auto px-4 py-6 sm:py-8">
          <div className="card p-6 sm:p-8 text-center animate-in">
            <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-5" aria-hidden="true">
              <Check className="w-10 h-10 text-emerald-700" />
            </div>
            <h2 className="t-display text-balance mb-5">
              Demande enregistrée !
            </h2>

            {/* Alerte: notez ce numéro */}
            <div className="callout callout-warning items-center text-left mb-5">
              <AlertTriangle aria-hidden="true" />
              <p className="font-medium">
                Conservez ce numéro ! Il vous permettra de suivre votre réparation.
              </p>
            </div>

            {/* Code avec bouton copier */}
            <p className="text-slate-500 mb-2">Votre numéro de suivi :</p>
            <div className="bg-brand-50 rounded-xl py-5 px-6 mb-3 border border-brand-200 relative">
              <p className="text-4xl font-bold font-mono text-brand-700 tracking-wider tabular-nums select-all">{createdCode}</p>
              <button
                type="button"
                onClick={handleCopy}
                className="btn-ghost btn-icon absolute top-2 right-2 text-brand-700 hover:bg-brand-100"
                title="Copier"
              >
                {copied ? <Check className="text-emerald-700" aria-hidden="true" /> : <Copy aria-hidden="true" />}
              </button>
            </div>
            <div role="status" aria-live="polite" className="min-h-5 mb-3">
              {copied && <p className="text-sm text-emerald-700 font-medium">Copié !</p>}
            </div>

            {/* Actions: partager / WhatsApp */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
              <button type="button" onClick={handleShare} className="btn-secondary min-h-11">
                <Share2 aria-hidden="true" /> Partager
              </button>
              <button type="button" onClick={handleWhatsAppSelf} className="btn-whatsapp min-h-11">
                <MessageCircle aria-hidden="true" /> M'envoyer par WhatsApp
              </button>
            </div>

            <div className="callout callout-info text-left mb-5">
              <Clock aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="font-semibold mb-1.5">Prochaines étapes</h3>
                <ol className="space-y-1.5 list-decimal list-inside">
                  <li>Notre équipe va valider votre demande</li>
                  <li>Présentez-vous en boutique avec votre appareil</li>
                  <li>Votre dossier est déjà créé — accueil rapide</li>
                </ol>
              </div>
            </div>

            {form.email && (
              <p className="text-sm text-slate-500 mb-5 [overflow-wrap:anywhere]">
                Un email de confirmation a été envoyé à <strong className="text-slate-700">{form.email}</strong>
              </p>
            )}

            {!form.email && (
              <p className="text-sm text-slate-500 mb-5">
                Vous pouvez retrouver votre ticket avec votre numéro de téléphone sur la page de suivi.
              </p>
            )}

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => navigate(lienSuivi('', createdCode, createdToken), { state: { retour: '/deposer' } })}
                className="btn-primary btn-lg btn-block"
              >
                <Send aria-hidden="true" /> Suivre ma réparation
              </button>
              <a href="/" className="btn-secondary btn-lg btn-block">
                <ArrowLeft aria-hidden="true" /> Retour à l'accueil
              </a>
            </div>
          </div>

          <div className="mt-6 card p-4 space-y-2">
            <div className="flex items-center gap-3 text-sm text-slate-700">
              <MapPin className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
              <span>79 Place Saint Léger, Chambéry</span>
            </div>
            <a href="tel:0479608922" className="flex items-center gap-3 min-h-11 text-sm font-medium text-slate-700 hover:text-brand-700 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              <Phone className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
              <span>04 79 60 89 22</span>
            </a>
          </div>
          <PiedDePage />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="depot-form max-w-[640px] mx-auto px-4 py-6 sm:py-8">
        {/* Header */}
        <div className="text-center mb-6 animate-in">
          <div className="w-14 h-14 rounded-xl bg-brand-600 text-white flex items-center justify-center mx-auto mb-4 shadow-xs" aria-hidden="true">
            <Globe className="w-7 h-7" />
          </div>
          <h1 className="t-display">Dépôt à distance</h1>
          <span className="block text-base text-slate-500 mt-1.5">Pré-enregistrez votre appareil en ligne</span>
        </div>

        {/* Progress */}
        <div className="flex gap-1.5 mb-6">
          {STEPS.map((s, i) => (
            <div key={i} className="flex-1 min-w-0">
              <div className={`h-2 rounded-full transition-colors duration-300 ${
                i <= step ? 'bg-brand-600' : 'bg-slate-200'
              }`} />
              <span className={`block text-xs mt-1.5 text-center leading-tight tracking-tight ${
                i === step ? 'font-semibold text-brand-700' : i < step ? 'font-medium text-brand-700' : 'font-medium text-slate-500'
              }`}>{s}</span>
            </div>
          ))}
        </div>

        {/* Step 0: Coordonnées */}
        {step === 0 && (
          <div className="card p-5 sm:p-6 space-y-5 animate-in">
            <EnTete icone={User} titre="Vos coordonnées" sousTitre="Pour vous recontacter" />

            <ChampsVous prefix="distance" form={form} errors={errors} onChange={updateForm} societe={false}
              aideEmail="Recommandé pour recevoir les mises à jour de votre réparation" />
            <ConsentementMarketing id="distance-consentement" checked={form.consentement_marketing}
              onChange={(v) => updateForm('consentement_marketing', v)} />
            <MentionRgpd />
          </div>
        )}

        {/* Step 1: Appareil */}
        {step === 1 && (
          <div className="card p-5 sm:p-6 space-y-5 animate-in">
            <EnTete icone={Smartphone} titre="Votre appareil" sousTitre="Type, marque et modèle" />

            <fieldset>
              <legend className="input-label">Catégorie *</legend>
              <div className="grid grid-cols-2 gap-3">
                {categories.filter(c => c !== 'Commande').map(cat => (
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
              <FieldError field="categorie" />
            </fieldset>

            {form.categorie && (
              <div>
                <label htmlFor="distance-marque" className="input-label">Marque *</label>
                <select id="distance-marque" value={form.marque} onChange={e => updateForm('marque', e.target.value)}
                  className="select input pr-12" {...invalide('marque')}>
                  <option value="">{catalogue.loading && !catalogue.marques.length ? 'Chargement…' : 'Sélectionner...'}</option>
                  {catalogue.marques.map(m => <option key={m} value={m}>{m}</option>)}
                  <option value={MARQUE_AUTRE}>Autre</option>
                </select>
                <FieldError field="marque" />
              </div>
            )}

            {form.marque && form.marque !== MARQUE_AUTRE && (
              <ModelCombobox
                id="distance-modele"
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
                <label htmlFor="distance-modele-autre" className="input-label">Préciser marque / modèle *</label>
                <input id="distance-modele-autre" value={form.modele_autre} onChange={e => updateForm('modele_autre', e.target.value)}
                  className="input" placeholder="Ex: Samsung Galaxy S24" {...invalide('modele_autre')} />
                <FieldError field="modele_autre" />
              </div>
            )}
          </div>
        )}

        {/* Step 2: Panne */}
        {step === 2 && (
          <div className="card p-5 sm:p-6 space-y-5 animate-in">
            <EnTete icone={AlertTriangle} titre="Le problème" sousTitre="Décrivez la panne" />

            <fieldset>
              <legend className="input-label">Type de panne *</legend>
              {/* Mêmes tuiles (icône + libellé) que les bornes /client et /depot */}
              <TuilesPannes pannes={pannes} valeur={form.panne} onChoisir={(p) => updateForm('panne', p)} />
              <FieldError field="panne" />
            </fieldset>

            <div>
              <label htmlFor="distance-panne-detail" className="input-label">Détails</label>
              <textarea
                id="distance-panne-detail"
                value={form.panne_detail}
                onChange={e => updateForm('panne_detail', e.target.value)}
                className="input resize-none"
                rows={3}
                placeholder="Décrivez plus précisément le problème..."
              />
            </div>

            <div>
              <label htmlFor="distance-notes" className="input-label">Notes</label>
              <textarea
                id="distance-notes"
                value={form.notes_client}
                onChange={e => updateForm('notes_client', e.target.value)}
                className="input resize-none"
                rows={2}
                placeholder="Informations complémentaires (accessoires, état cosmétique...)"
              />
            </div>

            {/* Code d'accès : facultatif à distance, il pourra être donné en boutique */}
            <div className="border-t border-slate-100 pt-5">
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <KeyRound className="w-5 h-5 text-brand-600 shrink-0" aria-hidden="true" /> L'accès à votre appareil (facultatif)
              </h3>
              <span className="block mt-1 mb-3 text-sm text-slate-600">Vous pourrez aussi nous le donner en boutique, au dépôt de l'appareil.</span>
              <ChoixCodeAcces
                idPrefix="distance-acces"
                pin={form.pin}
                pattern={form.pattern}
                mode={form.acces_mode}
                onChange={updateAcces}
                taille="compact"
                purgeJours={infosRgpd.purgeJours}
                error={errors.acces}
              />
            </div>

            {errors.submit && (
              <div role="alert" className="callout callout-danger">
                <AlertCircle aria-hidden="true" />
                <span>{errors.submit}</span>
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={() => step === 0 ? navigate('/') : setStep(s => s - 1)}
            className="btn-secondary btn-lg flex-1 min-h-14"
          >
            <ArrowLeft aria-hidden="true" /> {step === 0 ? 'Accueil' : 'Retour'}
          </button>

          <button
            type="button"
            onClick={handleNext}
            disabled={loading || !canNext()}
            className="btn-primary btn-lg flex-[2] min-h-14"
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Envoi...
              </>
            ) : step === 2 ? (
              <>Envoyer ma demande <Check aria-hidden="true" /></>
            ) : (
              <>Suivant <ArrowRight aria-hidden="true" /></>
            )}
          </button>
        </div>

        {/* Info bar */}
        <div className="mt-8 card p-4 space-y-2">
          <div className="flex items-center gap-3 text-sm text-slate-700">
            <MapPin className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
            <span>79 Place Saint Léger, Chambéry</span>
          </div>
          <a href="tel:0479608922" className="flex items-center gap-3 min-h-11 text-sm font-medium text-slate-700 hover:text-brand-700 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            <Phone className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
            <span>04 79 60 89 22</span>
          </a>
        </div>

        <div className="mt-4">
          <PiedDePage />
        </div>
      </div>
    </div>
  );
}
