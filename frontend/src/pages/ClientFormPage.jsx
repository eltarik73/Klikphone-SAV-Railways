import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  Lock, Shield, Send, Package, ShoppingBag, Clock, Gift,
} from 'lucide-react';

// Flow = ordered list of step IDs
const FLOW_DEFAULT = ['client', 'appareil', 'modele', 'panne', 'securite', 'confirmation'];
const FLOW_COMMANDE = ['client', 'appareil', 'panne', 'confirmation'];
const FLOW_ACHAT = ['client', 'achat', 'confirmation'];

const LABELS = {
  client: 'Client', appareil: 'Appareil', modele: 'Modèle',
  panne: 'Panne', securite: 'Sécurité', confirmation: 'Confirmation',
  achat: 'Achat',
};
const LABELS_COMMANDE = { ...LABELS, panne: 'Commande' };

const ACHAT_TYPES = ['Téléphone', 'Accessoire', 'Ordinateur'];

// Validation helpers
const isValidPhone = (tel) => /^(?:0|\+33\s?)[1-9](?:[\s.-]?\d{2}){4}$/.test(tel.replace(/\s/g, '').length >= 10 ? tel : '') || /^\d{10,14}$/.test(tel.replace(/[\s.-]/g, ''));
const isValidEmail = (email) => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidIMEI = (imei) => !imei || /^\d{15}$/.test(imei.replace(/[\s-]/g, ''));

// Tuile de choix (catégorie, panne, type d'achat) : 56 px, bordure 2 px, sélection = marque
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
  const [pannes, setPannes] = useState([]);
  const [modeleLibre, setModeleLibre] = useState(false);

  const [form, setForm] = useState({
    nom: '', prenom: '', telephone: '', email: '', societe: '',
    categorie: '', marque: '', modele: '', modele_autre: '',
    panne: '', panne_detail: '', pin: '', pattern: '', notes_client: '',
    imei: '', carte_camby: false, consentement_marketing: false, attente_boutique: false,
  });

  // Pièce à commander (for regular tickets with piece checkbox)
  const [pieceACommander, setPieceACommander] = useState(false);
  const [pieceNom, setPieceNom] = useState('');
  const [pieceDetails, setPieceDetails] = useState('');
  const [fournisseur, setFournisseur] = useState('');
  const [prixEstime, setPrixEstime] = useState('');

  // Achat fields
  const [achatType, setAchatType] = useState('');
  const [achatDescription, setAchatDescription] = useState('');
  const [achatPrix, setAchatPrix] = useState('');

  // ─── Flow logic ──────────────────────────────────────────────
  const isCommande = form.categorie === 'Commande';
  const isAchat = form.categorie === 'Achat';
  const flow = isAchat ? FLOW_ACHAT : isCommande ? FLOW_COMMANDE : FLOW_DEFAULT;
  const labels = isCommande ? LABELS_COMMANDE : LABELS;
  const currentId = flow[step] || 'client';
  const isLastStep = step === flow.length - 2; // last before confirmation
  const isConfirmation = currentId === 'confirmation';
  const catalogue = useCatalog(form.categorie && !isAchat && !isCommande ? form.categorie : null, form.marque);

  const resetForm = () => {
    setForm({
      nom: '', prenom: '', telephone: '', email: '', societe: '',
      categorie: '', marque: '', modele: '', modele_autre: '',
      panne: '', panne_detail: '', pin: '', pattern: '', notes_client: '',
      imei: '', consentement_marketing: false, attente_boutique: false,
    });
    setPieceACommander(false);
    setPieceNom('');
    setPieceDetails('');
    setFournisseur('');
    setPrixEstime('');
    setAchatType('');
    setAchatDescription('');
    setAchatPrix('');
    setCreatedCode(null);
    setStep(0);
    setErrors({});
    setCountdown(null);
    setCategories([]);
    setPannes([]);
    setModeleLibre(false);
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
    let cancelled = false;
    api.getCategories().then((data) => { if (!cancelled) setCategories(data); }).catch(() => {});
    api.getPannes().then((data) => { if (!cancelled) setPannes(data); }).catch(() => {});
    // Pre-fill from query params (coming from ClientsPage "Nouvelle réparation")
    const clientId = searchParams.get('client_id');
    const tel = searchParams.get('tel');
    if (clientId && tel) {
      setForm(f => ({ ...f, telephone: tel }));
      api.getClient(parseInt(clientId)).then(c => {
        if (cancelled) return;
        setForm(f => ({
          ...f,
          nom: c.nom || '', prenom: c.prenom || '',
          telephone: c.telephone || tel, email: c.email || '',
          societe: c.societe || '',
        }));
      }).catch(() => {});
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (form.categorie) {
      setForm(f => ({ ...f, marque: '', modele: '', modele_autre: '' }));
    }
  }, [form.categorie]);

  useEffect(() => {
    if (form.categorie && form.marque) {
      setForm(f => ({ ...f, modele: '', modele_autre: '' }));
      setModeleLibre(false);
    }
  }, [form.categorie, form.marque]);

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
    if (currentId === 'modele') {
      if (!form.marque) errs.marque = 'Choisissez la marque';
      else if (modeleManquant(form)) {
        if (form.marque === MARQUE_AUTRE) errs.modele_autre = 'Veuillez préciser le modèle';
        else errs.modele = 'Choisissez votre modèle';
      }
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
        societe: form.societe, carte_camby: form.carte_camby ? 1 : 0,
        rgpd_informe: true, consentement_marketing: Boolean(form.consentement_marketing),
      });

      if (isAchat) {
        // Achat flow: create ticket with "Achat" category, auto-close
        const result = await api.createTicket({
          client_id: client.id, categorie: 'Achat',
          marque: achatType, modele: '', modele_autre: achatDescription,
          panne: `Achat ${achatType}`,
          panne_detail: achatDescription,
          notes_client: form.notes_client,
        });
        // Set price and mark as paid + closed
        if (achatPrix) {
          await api.updateTicket(result.id, {
            devis_estime: parseFloat(achatPrix) || 0,
            tarif_final: parseFloat(achatPrix) || 0,
            paye: 1,
            statut_paiement: 'Payé',
            reste_a_payer: 0,
          });
        }
        await api.changeStatus(result.id, 'Clôturé');
        setCreatedCode(result.ticket_code);
        setStep(flow.length - 1);
      } else {
        const appareil = champsModele(form.marque, form.modele, form.modele_autre);
        // Le symptôme choisi par le client reste dans panne (stats, forfait) ; la pièce est
        // portée par la commande. Sans symptôme, la pièce sert de motif.
        const pieceSeule = !isCommande && !form.panne && pieceACommander && pieceNom;
        const result = await api.createTicket({
          client_id: client.id, categorie: form.categorie,
          marque: form.marque,
          ...appareil,
          panne: isCommande || pieceSeule ? 'Pièce à commander' : form.panne,
          panne_detail: pieceSeule
            ? `${pieceNom}${pieceDetails ? ' — ' + pieceDetails : ''}`
            : form.panne_detail,
          pin: form.pin,
          pattern: form.pattern,
          notes_client: form.notes_client,
          commande_piece: (isCommande || pieceACommander) ? 1 : 0,
          ...(!isCommande && form.attente_boutique ? { priorite: 'attente' } : {}),
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

        // create_ticket apprend déjà panne, panne_detail et modele_autre : seul un modèle
        // saisi librement dans « modele » reste à apprendre ici.
        if (!appareil.modele_autre && modeleLibre && appareil.modele) {
          api.learnTerm('modele_custom', appareil.modele).catch(() => {});
        }

        setCreatedCode(result.ticket_code);
        setStep(flow.length - 1);
      }
      // Invalide tous les caches impactés par la création de ticket/achat
      // → le dashboard se rafraichit instantanément avec le nouveau ticket.
      invalidateCache('tickets', 'dashboard', 'interactions', 'clients', 'commandes');
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
      case 'modele': return form.marque && !modeleManquant(form);
      case 'panne': return isCommande ? form.panne_detail.trim() : (form.panne || pieceACommander);
      case 'achat': return achatType && achatDescription.trim();
      case 'securite': return true;
      default: return true;
    }
  };

  const handleNext = () => {
    if (!validateStep()) return;
    if (isLastStep) {
      // Fire-and-forget: handleSubmit already manages its own loading/error state via toast
      handleSubmit().catch((err) => {
        console.error('[ClientFormPage] handleSubmit failed', err);
      });
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

  // <div> et non <p> : `.depot-form p` écraserait la couleur rouge de l'erreur
  const FieldError = ({ field }) => errors[field] ? (
    <div id={`depot-${field}-erreur`} role="alert" className="input-error text-sm">{errors[field]}</div>
  ) : null;
  const invalide = (field) => (errors[field] ? { 'aria-invalid': 'true', 'aria-describedby': `depot-${field}-erreur` } : {});

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="depot-form w-full max-w-[640px] mx-auto px-4 py-5 sm:py-6 pb-10">
        {/* Header */}
        <div className="flex items-center gap-2 mb-5">
          <button
            type="button"
            onClick={handleBack}
            className="btn-ghost btn-icon btn-lg -ml-2"
            aria-label="Retour à l'étape précédente"
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="t-display">Déposer un appareil</h1>
            <span className="block text-sm text-slate-500 mt-0.5">Étape {step + 1} sur {flow.length} — {labels[currentId]}</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex gap-1.5 mb-6">
          {flow.map((id, i) => (
            <div key={id} className="flex-1 min-w-0">
              <div className={`h-2 rounded-full transition-colors duration-300 ${
                i <= step ? 'bg-brand-600' : 'bg-slate-200'
              }`} />
              <span lang="fr" className={`block text-xs mt-1.5 text-center leading-tight tracking-tight break-words hyphens-auto ${
                i === step ? 'font-semibold text-brand-700' : i < step ? 'font-medium text-brand-700' : 'font-medium text-slate-500'
              }`}>{labels[id]}</span>
            </div>
          ))}
        </div>

        {/* ═══ Step: Client ═══ */}
        {currentId === 'client' && (
          <div className="card p-5 sm:p-6 space-y-5 animate-in">
            <EnTete icone={User} titre="Vos coordonnées" sousTitre="Informations de contact" />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="depot-nom" className="input-label">Nom *</label>
                <input id="depot-nom" value={form.nom} onChange={e => updateForm('nom', e.target.value)}
                  autoComplete="family-name" className="input" placeholder="Dupont" {...invalide('nom')} />
                <FieldError field="nom" />
              </div>
              <div>
                <label htmlFor="depot-prenom" className="input-label">Prénom</label>
                <input id="depot-prenom" value={form.prenom} onChange={e => updateForm('prenom', e.target.value)}
                  autoComplete="given-name" className="input" placeholder="Jean" />
              </div>
            </div>
            <div>
              <label htmlFor="depot-telephone" className="input-label">Téléphone *</label>
              <input id="depot-telephone" type="tel" inputMode="tel" autoComplete="tel" value={form.telephone} onChange={e => updateForm('telephone', e.target.value)}
                className="input" placeholder="06 XX XX XX XX" {...invalide('telephone')} />
              <FieldError field="telephone" />
            </div>
            <div>
              <label htmlFor="depot-email" className="input-label">Email</label>
              <input id="depot-email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={e => updateForm('email', e.target.value)}
                className="input" placeholder="optionnel" {...invalide('email')} />
              <FieldError field="email" />
            </div>
            <div>
              <label htmlFor="depot-societe" className="input-label">Société</label>
              <input id="depot-societe" value={form.societe} onChange={e => updateForm('societe', e.target.value)}
                autoComplete="organization" className="input" placeholder="optionnel" />
            </div>
            <label className="callout bg-brand-50 border-brand-200 text-brand-800 items-center min-h-14 cursor-pointer hover:bg-brand-100/60 transition-colors duration-150">
              <Gift aria-hidden="true" />
              <input type="checkbox" checked={form.carte_camby} onChange={e => updateForm('carte_camby', e.target.checked)}
                className="checkbox w-6 h-6" />
              <span className="text-base font-medium">Avez-vous la carte Camby ?</span>
            </label>
            <ConsentementMarketing id="depot-consentement" checked={form.consentement_marketing}
              onChange={(v) => updateForm('consentement_marketing', v)} />
            <MentionRgpd kiosque />
          </div>
        )}

        {/* ═══ Step: Appareil (catégorie) ═══ */}
        {currentId === 'appareil' && (
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
              <button
                type="button"
                aria-pressed={form.categorie === 'Achat'}
                onClick={() => updateForm('categorie', 'Achat')}
                className={`${tuile(form.categorie === 'Achat')} flex items-center gap-2`}
              >
                <ShoppingBag className="w-5 h-5 shrink-0" aria-hidden="true" /> Achat
              </button>
            </div>
          </div>
        )}

        {/* ═══ Step: Modèle (skipped for Commande) ═══ */}
        {currentId === 'modele' && (
          <div className="card p-5 sm:p-6 space-y-5 animate-in">
            <EnTete icone={Smartphone} titre="Marque & modèle" sousTitre={form.categorie} />

            <div>
              <label htmlFor="depot-marque" className="input-label">Marque *</label>
              <select id="depot-marque" value={form.marque} onChange={e => updateForm('marque', e.target.value)}
                className="select input pr-12" {...invalide('marque')}>
                <option value="">{catalogue.loading && !catalogue.marques.length ? 'Chargement…' : 'Sélectionner...'}</option>
                {catalogue.marques.map(m => <option key={m} value={m}>{m}</option>)}
                <option value={MARQUE_AUTRE}>Autre</option>
              </select>
              <FieldError field="marque" />
            </div>

            {form.marque && form.marque !== MARQUE_AUTRE && (
              <ModelCombobox
                id="depot-modele"
                label="Modèle"
                required={modeleRequis(form.categorie)}
                marque={form.marque}
                modeles={catalogue.modelesDe(form.marque)}
                loading={catalogue.loading}
                value={form.modele}
                onChange={(texte, { libre }) => { updateForm('modele', texte); setModeleLibre(libre); }}
                error={errors.modele}
              />
            )}

            {form.marque === MARQUE_AUTRE && (
              <div>
                <label htmlFor="depot-modele-autre" className="input-label">Préciser marque / modèle *</label>
                <input id="depot-modele-autre" value={form.modele_autre} onChange={e => updateForm('modele_autre', e.target.value)}
                  className="input" placeholder="Ex: Samsung Galaxy S24" autoFocus {...invalide('modele_autre')} />
                <FieldError field="modele_autre" />
              </div>
            )}
          </div>
        )}

        {/* ═══ Step: Panne / Détail commande ═══ */}
        {currentId === 'panne' && (
          <div className="card p-5 sm:p-6 space-y-5 animate-in">
            <EnTete icone={isCommande ? Package : AlertTriangle}
              titre={isCommande ? 'Détail commande' : 'Le problème'}
              sousTitre={isCommande ? 'Décrivez la pièce à commander' : 'Décrivez la panne'} />

            {isCommande ? (
              /* ─── Mode Commande ─── */
              <>
                <div className="callout callout-info">
                  <Package aria-hidden="true" />
                  <span>La panne sera automatiquement définie comme "Pièce à commander"</span>
                </div>

                <div>
                  <label htmlFor="depot-piece" className="input-label">Pièce à commander *</label>
                  <input
                    id="depot-piece"
                    value={form.panne_detail}
                    onChange={e => updateForm('panne_detail', e.target.value)}
                    className="input"
                    placeholder="Ex: Écran OLED iPhone 14 Pro, Nappe Face ID..."
                    autoFocus
                  />
                </div>

                <div>
                  <label htmlFor="depot-commande-notes" className="input-label">Détails supplémentaires (référence, couleur, capacité...)</label>
                  <textarea
                    id="depot-commande-notes"
                    value={form.notes_client}
                    onChange={e => updateForm('notes_client', e.target.value)}
                    className="input resize-none"
                    rows={3}
                    placeholder="Précisions sur la pièce, référence exacte, couleur, capacité..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="depot-fournisseur" className="input-label">Fournisseur</label>
                    <input id="depot-fournisseur" value={fournisseur} onChange={e => setFournisseur(e.target.value)}
                      className="input" placeholder="Ex: Utopya, MobileParts..." />
                  </div>
                  <div>
                    <label htmlFor="depot-prix-estime" className="input-label">Prix estimé (€)</label>
                    <input id="depot-prix-estime" type="number" step="0.01" inputMode="decimal" value={prixEstime} onChange={e => setPrixEstime(e.target.value)}
                      className="input" placeholder="0.00" />
                  </div>
                </div>
              </>
            ) : (
              /* ─── Mode Réparation ─── */
              <>
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
                  <label htmlFor="depot-panne-detail" className="input-label">Détails supplémentaires</label>
                  <textarea
                    id="depot-panne-detail"
                    value={form.panne_detail}
                    onChange={e => updateForm('panne_detail', e.target.value)}
                    className="input resize-none"
                    rows={3}
                    placeholder="Décrivez plus précisément le problème..."
                  />
                </div>

                <div>
                  <label htmlFor="depot-notes" className="input-label">Notes</label>
                  <textarea
                    id="depot-notes"
                    value={form.notes_client}
                    onChange={e => updateForm('notes_client', e.target.value)}
                    className="input resize-none"
                    rows={2}
                    placeholder="Informations complémentaires (accessoires, état cosmétique...)"
                  />
                </div>

                <label htmlFor="depot-attente" className="flex items-start gap-3 p-4 min-h-14 rounded-lg border-2 border-slate-200 bg-white has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 cursor-pointer transition-colors duration-150">
                  <input id="depot-attente" type="checkbox" checked={form.attente_boutique}
                    onChange={e => updateForm('attente_boutique', e.target.checked)}
                    aria-describedby="depot-attente-aide"
                    className="checkbox w-6 h-6 mt-0.5" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-base font-semibold text-slate-900">
                      <Clock className="w-5 h-5 text-brand-600 shrink-0" aria-hidden="true" /> Je patiente en boutique
                    </span>
                    <span id="depot-attente-aide" className="block text-sm text-slate-600 mt-0.5">
                      L'atelier traite en priorité les clients qui attendent sur place.
                    </span>
                  </span>
                </label>

                {/* Pièce à commander */}
                <div className="border-t border-slate-100 pt-4">
                  <label htmlFor="depot-piece-a-commander" className="flex items-center gap-3 min-h-11 cursor-pointer">
                    <input id="depot-piece-a-commander" type="checkbox" checked={pieceACommander} onChange={e => setPieceACommander(e.target.checked)}
                      className="checkbox w-6 h-6" />
                    <Package className="w-5 h-5 text-slate-500 shrink-0" aria-hidden="true" />
                    <span className="text-base font-semibold text-slate-900">Pièce à commander</span>
                  </label>
                </div>

                {pieceACommander && (
                  <div className="card-section space-y-4 animate-in">
                    <div className="t-h3 flex items-center gap-2">
                      <Package className="w-4 h-4 text-slate-500" aria-hidden="true" /> Détail de la commande
                    </div>
                    <div>
                      <label htmlFor="depot-piece-nom" className="input-label">Pièce à commander *</label>
                      <input id="depot-piece-nom" value={pieceNom} onChange={e => setPieceNom(e.target.value)}
                        placeholder="Ex: Écran OLED iPhone 14 Pro, Nappe Face ID..."
                        className="input" />
                    </div>
                    <div>
                      <label htmlFor="depot-piece-details" className="input-label">Détails / Commentaire</label>
                      <textarea id="depot-piece-details" value={pieceDetails} onChange={e => setPieceDetails(e.target.value)}
                        placeholder="Précisions sur la pièce, référence, couleur, capacité..."
                        rows={2}
                        className="input resize-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="depot-piece-fournisseur" className="input-label">Fournisseur</label>
                        <input id="depot-piece-fournisseur" value={fournisseur} onChange={e => setFournisseur(e.target.value)}
                          placeholder="Ex: Utopya, MobileParts..."
                          className="input" />
                      </div>
                      <div>
                        <label htmlFor="depot-piece-prix" className="input-label">Prix estimé</label>
                        <input id="depot-piece-prix" type="number" inputMode="decimal" value={prixEstime} onChange={e => setPrixEstime(e.target.value)}
                          placeholder="0.00"
                          className="input" />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ═══ Step: Achat ═══ */}
        {currentId === 'achat' && (
          <div className="card p-5 sm:p-6 space-y-5 animate-in">
            <EnTete icone={ShoppingBag} titre="Détail de l'achat" sousTitre="Enregistrer un achat sans réparation" />

            <fieldset>
              <legend className="input-label">Type d'achat *</legend>
              <div className="grid grid-cols-3 gap-3">
                {ACHAT_TYPES.map(type => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={achatType === type}
                    onClick={() => setAchatType(type)}
                    className={`${tuile(achatType === type)} text-center`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="depot-achat-description" className="input-label">Description de l'achat *</label>
              <input
                id="depot-achat-description"
                value={achatDescription}
                onChange={e => setAchatDescription(e.target.value)}
                className="input"
                placeholder="Ex: iPhone 15 128Go Noir, Coque silicone..."
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="depot-achat-prix" className="input-label">Prix de vente (€)</label>
              <input
                id="depot-achat-prix"
                type="number"
                step="0.01"
                inputMode="decimal"
                value={achatPrix}
                onChange={e => setAchatPrix(e.target.value)}
                className="input"
                placeholder="0.00"
              />
            </div>

            <div>
              <label htmlFor="depot-achat-notes" className="input-label">Notes</label>
              <textarea
                id="depot-achat-notes"
                value={form.notes_client}
                onChange={e => updateForm('notes_client', e.target.value)}
                className="input resize-none"
                rows={2}
                placeholder="Informations complémentaires..."
              />
            </div>
          </div>
        )}

        {/* ═══ Step: Sécurité (skipped for Commande) ═══ */}
        {currentId === 'securite' && (
          <div className="card p-5 sm:p-6 space-y-5 animate-in">
            <EnTete icone={Lock} titre="Codes d'accès" sousTitre="Optionnel — nécessaire pour le diagnostic" />

            <div className="callout callout-info">
              <Shield aria-hidden="true" />
              <span>Ces informations sont confidentielles et nécessaires uniquement pour le diagnostic de votre appareil.</span>
            </div>

            <div>
              <label htmlFor="depot-pin" className="input-label flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-slate-500" aria-hidden="true" /> Code PIN / Mot de passe
              </label>
              <input
                id="depot-pin"
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

        {/* ═══ Step: Confirmation ═══ */}
        {isConfirmation && createdCode && (
          <div className="card p-6 sm:p-8 text-center animate-in">
            <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-5" aria-hidden="true">
              <Check className="w-10 h-10 text-emerald-700" />
            </div>
            <h2 className="t-display text-balance mb-2">Merci pour votre confiance !</h2>
            <p className="text-slate-500 mb-5">Votre numéro de ticket :</p>
            <div className="bg-brand-50 rounded-xl py-4 px-6 mb-4 border border-brand-200">
              {/* <div> et non <p> : `.depot-form p` ramènerait le code à 16 px slate-700 */}
              <div className="text-4xl font-bold font-mono text-brand-700 tracking-wider tabular-nums">{createdCode}</div>
            </div>
            <p className="text-slate-600 mb-6">
              Conservez ce code pour suivre l'avancement de votre {isAchat ? 'achat' : isCommande ? 'commande' : 'réparation'}.
            </p>
            {countdown !== null && (
              <div className="mb-6">
                <div className="w-full bg-slate-200 rounded-full h-1.5 mb-2" aria-hidden="true">
                  <div
                    className="bg-brand-600 h-1.5 rounded-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
                    style={{ width: `${(countdown / 10) * 100}%` }}
                  />
                </div>
                <span className="block text-sm text-slate-500 tabular-nums">Retour automatique dans {countdown} seconde{countdown > 1 ? 's' : ''}...</span>
              </div>
            )}
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => navigate(`/suivi?ticket=${createdCode}`)}
                className="btn-primary btn-lg btn-block"
              >
                <Send aria-hidden="true" /> Suivre ma {isAchat ? 'achat' : isCommande ? 'commande' : 'réparation'}
              </button>
              <button type="button" onClick={resetForm} className="btn-secondary btn-lg btn-block">
                <ArrowLeft aria-hidden="true" /> Nouveau dépôt
              </button>
            </div>
          </div>
        )}

        {/* Navigation */}
        {!isConfirmation && (
          <div className="flex gap-3 mt-6">
            <button type="button" onClick={handleBack} className="btn-secondary btn-lg flex-1 min-h-14">
              <ArrowLeft aria-hidden="true" /> Retour
            </button>

            <button
              type="button"
              onClick={handleNext}
              disabled={loading || !canNext()}
              className="btn-primary btn-lg flex-[2] min-h-14"
            >
              {loading ? 'Envoi...' : isLastStep ? 'Confirmer le dépôt' : 'Suivant'}
              {!isLastStep && <ArrowRight aria-hidden="true" />}
              {isLastStep && <Check aria-hidden="true" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
