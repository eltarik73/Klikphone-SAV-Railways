import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { lienSuivi } from '../lib/ticketCode';
import { invalidateCache } from '../hooks/useApi';
import { useToast } from '../components/Toast';
import ChoixCodeAcces, { resumeAcces, erreurAcces } from '../components/ChoixCodeAcces';
import {
  isValidPhone, isValidEmail, tuile, EnTete, BarreEtapes, ChampsVous, ChampsAppareil, ChampsPanne,
  CaseAttente, Recapitulatif, libelleAppareil, lignesVous, ErreurChamp, estTelephoneFictif, MESSAGE_TEL_FICTIF,
} from '../components/DepotEtapes';
import { useCatalog } from '../hooks/useCatalog';
import { champsModele, modeleManquant, MARQUE_AUTRE } from '../lib/catalog';
import { MentionRgpd, ConsentementMarketing, useInfosRgpd } from './ConfidentialitePage';
import DelaiReparation from '../components/DelaiReparation';
import { dateDelai, phrasePret } from '../lib/delai';
import { rechargerSiNouvelleVersion, useRechargementAuRepos, formulaireIntact } from '../lib/miseAJour';
import {
  ArrowLeft, ArrowRight, Check, Smartphone, User, AlertTriangle, KeyRound,
  Send, Package, ShoppingBag, ClipboardCheck, Clock,
} from 'lucide-react';

/**
 * Borne client « Déposer un appareil » (/client) en 4 étapes : Vous · Votre appareil ·
 * Le problème et l'accès (ou Votre commande / Votre achat) · Vérification. Le récapitulatif
 * de la dernière étape renvoie à l'étape à corriger ; l'envoi ne part que de là.
 *
 * Borne en boucle sans rechargement : à chaque retour après un dépôt, et au repos, elle se
 * recharge d'elle-même si une nouvelle version a été déployée (lib/miseAJour.js).
 *
 * Mode personnel (/client?staff=1 avec une session du personnel, bouton « Nouveau ticket » du
 * tableau de bord) : même page, mais une réparation exige le délai promis au client
 * (date_recuperation) ; après l'envoi on revient au tableau de bord, sans compte à rebours.
 * Sur la borne publique (/client, /depot), le client ne fixe jamais de délai.
 */
const ETAPES = ['vous', 'appareil', 'detail', 'verification'];
const ACHAT_TYPES = ['Téléphone', 'Accessoire', 'Ordinateur'];
const PREFIX = 'depot';

const FORM_INITIAL = {
  nom: '', prenom: '', telephone: '', tel_contact: '', email: '', societe: '',
  categorie: '', marque: '', modele: '', modele_autre: '',
  panne: '', panne_detail: '', pin: '', pattern: '', acces_mode: null, notes_client: '',
  imei: '', carte_camby: false, consentement_marketing: false, attente_boutique: false,
};

// Session du personnel ouverte sur ce poste : tableau de bord de retour (/accueil ou /tech), sinon null
function retourPersonnel() {
  try {
    if (!(api.token || localStorage.getItem('kp_token'))) return null;
    return localStorage.getItem('kp_target') === 'tech' ? '/tech' : '/accueil';
  } catch {
    return api.token ? '/accueil' : null;
  }
}

function definirEtapes({ isAchat, isCommande, avecDelai }) {
  const detail = isAchat
    ? { id: 'detail', court: 'Achat', titre: 'Votre achat', sousTitre: 'Ce que vous achetez', icone: ShoppingBag }
    : isCommande
      ? { id: 'detail', court: 'Commande', titre: 'Votre commande', sousTitre: 'La pièce à commander', icone: Package }
      : {
        id: 'detail', court: 'Problème', titre: "Le problème et l'accès", icone: AlertTriangle,
        sousTitre: avecDelai ? "La panne, l'accès à l'appareil et le délai de réparation" : "Ce qui ne va pas, et comment s'ouvre votre appareil",
      };
  return [
    { id: 'vous', court: 'Vous', titre: 'Vous', sousTitre: 'Vos coordonnées, pour vous prévenir quand c’est prêt', icone: User },
    { id: 'appareil', court: 'Appareil', titre: 'Votre appareil', sousTitre: 'Le type, la marque et le modèle', icone: Smartphone },
    detail,
    { id: 'verification', court: 'Vérification', titre: 'Vérification', sousTitre: 'Relisez avant de déposer : tout est modifiable', icone: ClipboardCheck },
  ];
}

export default function ClientFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const { logout } = useAuth();
  const infosRgpd = useInfosRgpd();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [createdCode, setCreatedCode] = useState(null);
  const [createdToken, setCreatedToken] = useState(null); // jeton du lien de suivi (si renvoyé)
  const [errors, setErrors] = useState({});
  const [countdown, setCountdown] = useState(null);
  const [retourEnCours, setRetourEnCours] = useState(false);
  const titreRef = useRef(null);
  const minuterieRef = useRef(null);
  const retourRef = useRef(false);
  const monteeRef = useRef(true);
  // Création par le personnel : /client?staff=1 ET session ouverte (sinon borne publique)
  const [tableauDeBord] = useState(() => (searchParams.get('staff') === '1' ? retourPersonnel() : null));
  const modePersonnel = Boolean(tableauDeBord);
  // Délai promis (mode personnel, réparation) : valeur « AAAA-MM-JJTHH:MM » et puce choisie
  const [delai, setDelai] = useState({ valeur: '', cle: null });

  const [categories, setCategories] = useState([]);
  const [pannes, setPannes] = useState([]);
  const [modeleLibre, setModeleLibre] = useState(false);

  const [form, setForm] = useState({ ...FORM_INITIAL });

  // Pièce à commander (ticket de réparation avec la case cochée)
  const [pieceACommander, setPieceACommander] = useState(false);
  const [pieceNom, setPieceNom] = useState('');
  const [pieceDetails, setPieceDetails] = useState('');
  const [fournisseur, setFournisseur] = useState('');
  const [prixEstime, setPrixEstime] = useState('');

  // Achat
  const [achatType, setAchatType] = useState('');
  const [achatDescription, setAchatDescription] = useState('');
  const [achatPrix, setAchatPrix] = useState('');

  // ─── Parcours ────────────────────────────────────────────────
  const isCommande = form.categorie === 'Commande';
  const isAchat = form.categorie === 'Achat';
  const sansModele = isCommande || isAchat;
  const delaiRequis = modePersonnel && !isAchat && !isCommande;
  const etapes = definirEtapes({ isAchat, isCommande, avecDelai: delaiRequis });
  const currentId = ETAPES[step] || 'vous';
  const etape = etapes[step] || etapes[0];
  const isVerification = currentId === 'verification';
  const termine = Boolean(createdCode);
  const catalogue = useCatalog(form.categorie && !sansModele ? form.categorie : null, form.marque);

  const resetForm = () => {
    setForm({ ...FORM_INITIAL });
    setPieceACommander(false);
    setPieceNom('');
    setPieceDetails('');
    setFournisseur('');
    setPrixEstime('');
    setAchatType('');
    setAchatDescription('');
    setAchatPrix('');
    setCreatedCode(null);
    setCreatedToken(null);
    setStep(0);
    setErrors({});
    setCountdown(null);
    setModeleLibre(false);
    setDelai({ valeur: '', cle: null });
    api.getCategories().then(setCategories).catch(() => {});
    api.getPannes().then(setPannes).catch(() => {});
  };

  useEffect(() => {
    monteeRef.current = true;
    return () => { monteeRef.current = false; };
  }, []);

  // Retour automatique à l'accueil 10 s après la confirmation (remise à zéro hors du setState)
  useEffect(() => {
    if (!createdCode) return undefined;
    setCountdown(10);
    minuterieRef.current = setInterval(() => {
      setCountdown((prev) => (prev === null ? null : Math.max(prev - 1, 0)));
    }, 1000);
    return () => clearInterval(minuterieRef.current);
  }, [createdCode]);

  useEffect(() => {
    if (countdown === 0) retourApresDepot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  // Borne au repos (étape 1, rien de saisi, personne depuis 2 min) : rechargement si nouvelle version
  useRechargementAuRepos({
    auRepos: !modePersonnel && step === 0 && !createdCode && formulaireIntact(form, FORM_INITIAL),
  });

  useEffect(() => {
    let cancelled = false;
    api.getCategories().then((data) => { if (!cancelled) setCategories(data); }).catch(() => {});
    api.getPannes().then((data) => { if (!cancelled) setPannes(data); }).catch(() => {});
    // Pré-remplissage depuis la fiche client (ClientsPage « Nouvelle réparation »)
    const clientId = searchParams.get('client_id');
    const tel = searchParams.get('tel');
    if (clientId && tel) {
      setForm((f) => ({ ...f, telephone: tel }));
      api.getClient(parseInt(clientId, 10)).then((c) => {
        if (cancelled) return;
        setForm((f) => ({
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
      setForm((f) => ({ ...f, marque: '', modele: '', modele_autre: '' }));
    }
  }, [form.categorie]);

  useEffect(() => {
    if (form.categorie && form.marque) {
      setForm((f) => ({ ...f, modele: '', modele_autre: '' }));
      setModeleLibre(false);
    }
  }, [form.categorie, form.marque]);

  // Nouvelle étape : haut de page et titre annoncé
  useEffect(() => {
    titreRef.current?.scrollIntoView?.({ block: 'start' });
    titreRef.current?.focus?.({ preventScroll: true });
  }, [step, termine]);

  const updateForm = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  // Fin du compte à rebours ou « Nouveau dépôt » : si une nouvelle version a été déployée, la page
  // se recharge (le formulaire repart vide avec le nouveau code) ; sinon remise à zéro habituelle.
  const retourApresDepot = async () => {
    if (retourRef.current) return;
    retourRef.current = true;
    clearInterval(minuterieRef.current);
    setCountdown(null);
    setRetourEnCours(true);
    let recharge = false;
    try {
      recharge = await rechargerSiNouvelleVersion();
    } finally {
      retourRef.current = false;
    }
    if (recharge || !monteeRef.current) return;
    setRetourEnCours(false);
    resetForm();
  };

  const updateDelai = (valeur, { cle } = {}) => {
    setDelai({ valeur: valeur || '', cle: cle || null });
    setErrors((e) => ({ ...e, delai: undefined }));
  };

  const updateAcces = ({ pin, pattern, mode }) => {
    setForm((f) => ({ ...f, pin, pattern, acces_mode: mode }));
    setErrors((e) => ({ ...e, acces: undefined }));
  };

  const validateStep = () => {
    const errs = {};
    if (currentId === 'vous') {
      if (!form.nom.trim()) errs.nom = 'Le nom est requis';
      if (!form.telephone.trim()) errs.telephone = 'Le téléphone est requis';
      else if (!isValidPhone(form.telephone)) errs.telephone = 'Numéro invalide (10 chiffres min.)';
      // Numéro de remplissage (06 00 00 00 00…) : il rattachait le dépôt à une ancienne fiche d'essai
      else if (estTelephoneFictif(form.telephone)) errs.telephone = MESSAGE_TEL_FICTIF;
      if (form.tel_contact.trim() && !isValidPhone(form.tel_contact)) errs.tel_contact = 'Numéro invalide (10 chiffres min.)';
      else if (form.tel_contact.trim() && estTelephoneFictif(form.tel_contact)) errs.tel_contact = MESSAGE_TEL_FICTIF;
      if (form.email && !isValidEmail(form.email)) errs.email = 'Email invalide';
    }
    if (currentId === 'appareil') {
      if (!form.categorie) errs.categorie = "Choisissez le type d'appareil";
      else if (!sansModele) {
        if (!form.marque) errs.marque = 'Choisissez la marque';
        else if (modeleManquant(form)) {
          if (form.marque === MARQUE_AUTRE) errs.modele_autre = 'Veuillez préciser le modèle';
          else errs.modele = 'Choisissez votre modèle';
        }
      }
    }
    if (currentId === 'detail') {
      if (isAchat) {
        if (!achatType) errs.achat_type = "Choisissez le type d'achat";
        if (!achatDescription.trim()) errs.achat_description = "Décrivez l'achat";
      } else if (isCommande) {
        if (!form.panne_detail.trim()) errs.panne_detail = 'Indiquez la pièce à commander';
      } else {
        if (!form.panne && !pieceACommander) errs.panne = 'Choisissez ce qui ne va pas';
        if (pieceACommander && !pieceNom.trim()) errs.piece_nom = 'Indiquez la pièce à commander';
        if (delaiRequis) {
          const promis = dateDelai(delai.valeur);
          if (!promis) errs.delai = 'Choisissez un délai de réparation';
          else if (promis.getTime() < Date.now() - 60_000) errs.delai = 'Choisissez une heure à venir';
        }
        const acces = erreurAcces(form);
        if (acces) errs.acces = acces;
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => document.querySelector('[role="alert"]')?.scrollIntoView?.({ block: 'center' }));
      return false;
    }
    return true;
  };

  // Ticket créé : la borne affiche le code (compte à rebours) ; le personnel retourne au tableau de bord
  const aboutir = (result) => {
    // Le dashboard se rafraîchit aussitôt avec le nouveau ticket
    invalidateCache('tickets', 'dashboard', 'interactions', 'clients', 'commandes');
    if (!modePersonnel) {
      setCreatedToken(result.suivi_token || null);
      setCreatedCode(result.ticket_code);
      return;
    }
    const promis = delaiRequis ? dateDelai(delai.valeur) : null;
    toast.success(
      `Ticket ${result.ticket_code} créé${promis ? ` · ${phrasePret(promis, new Date())}` : ''}`,
      result.id ? { onClick: () => navigate(`${tableauDeBord}/ticket/${result.id}`) } : undefined,
    );
    // Le tableau de bord rouvre en haut, nouveau ticket visible (saut immédiat, sans défilement doux)
    window.scrollTo(0, 0);
    navigate(tableauDeBord);
  };

  const handleSubmit = async () => {
    // Achat : PATCH réservés au personnel ; sur la borne, rien n'est créé (pas de ticket orphelin)
    if (isAchat && !modePersonnel) {
      toast.error('Les achats sont enregistrés par le personnel en boutique.');
      return;
    }
    setLoading(true);
    try {
      // Personnel : session du poste, fiche complète ({ id }). Borne : aucun jeton, le serveur ne rend
      // qu'une référence client signée (client_ref, 20 min) — jamais l'id d'une fiche.
      const creerFiche = () => api.createOrGetClient({
        nom: form.nom, prenom: form.prenom,
        telephone: form.telephone, email: form.email,
        societe: form.societe, carte_camby: form.carte_camby ? 1 : 0,
        rgpd_informe: true, consentement_marketing: Boolean(form.consentement_marketing),
      }, { asStaff: modePersonnel });
      let client = await creerFiche();
      // Personnel sans fiche complète : le serveur a traité l'appel comme anonyme, le jeton du poste
      // a été révoqué (déconnexion ou changement d'utilisateur dans un autre onglet). Si cet autre
      // onglet a rouvert une session, on la reprend et on réessaie une fois ; sinon on se reconnecte,
      // sans créer de ticket (un client_id absent donnerait un 422 trompeur).
      if (modePersonnel && !client?.id && api.adopterJetonDuPoste()) client = await creerFiche();
      if (modePersonnel && !client?.id) {
        toast.error('Session expirée : reconnectez-vous.');
        logout();
        navigate(`/login${tableauDeBord}`);
        return;
      }
      const refClient = modePersonnel ? { client_id: client.id } : { client_ref: client.client_ref };
      const session = { asStaff: modePersonnel };
      const telContact = form.tel_contact.trim() || null;

      if (isAchat) {
        // Achat : ticket « Achat » clôturé aussitôt
        const result = await api.createTicket({
          ...refClient, categorie: 'Achat',
          marque: achatType, modele: '', modele_autre: achatDescription,
          panne: `Achat ${achatType}`,
          panne_detail: achatDescription,
          notes_client: form.notes_client,
          tel_contact: telContact,
        }, session);
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
        aboutir(result);
      } else {
        const appareil = champsModele(form.marque, form.modele, form.modele_autre);
        // Le symptôme choisi par le client reste dans panne (stats, forfait) ; la pièce est
        // portée par la commande. Sans symptôme, la pièce sert de motif.
        const pieceSeule = !isCommande && !form.panne && pieceACommander && pieceNom;
        const result = await api.createTicket({
          ...refClient, categorie: form.categorie,
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
          tel_contact: telContact,
          ...(!isCommande && form.attente_boutique ? { priorite: 'attente' } : {}),
          ...(delaiRequis ? { date_recuperation: delai.valeur } : {}),
        }, session);
        // Pièce commandée depuis la borne : preuve de suivi du ticket que l'on vient de créer
        // (jeton rendu avec le ticket, sinon le numéro donné à l'instant)
        const preuvePiece = modePersonnel ? {} : (result.suivi_token ? { t: result.suivi_token } : { tel: form.telephone });

        // Le schéma TicketCreate du serveur ignore encore date_recuperation : l'heure promise est
        // posée aussitôt par PATCH (texte « AAAA-MM-JJTHH:MM », comme le champ de la fiche).
        if (delaiRequis) {
          try {
            await api.updateTicket(result.id, { date_recuperation: delai.valeur });
          } catch {
            toast.warning(`${result.ticket_code} : délai non enregistré, fixez-le depuis la fiche.`);
          }
        }

        if (isCommande) {
          await api.createPartAuto({
            ticket_id: result.id, ...preuvePiece,
            description: form.panne_detail.trim(),
            fournisseur: fournisseur || '',
            prix: prixEstime ? parseFloat(prixEstime) : null,
            notes: form.notes_client || '',
          }, session);
        } else if (pieceACommander && pieceNom) {
          await api.createPartAuto({
            ticket_id: result.id, ...preuvePiece,
            description: pieceNom,
            fournisseur: fournisseur || '',
            prix: prixEstime ? parseFloat(prixEstime) : null,
            notes: pieceDetails || '',
          }, session);
        }

        // create_ticket apprend déjà panne, panne_detail et modele_autre : seul un modèle
        // saisi librement dans « modele » reste à apprendre ici.
        if (!appareil.modele_autre && modeleLibre && appareil.modele) {
          api.learnTerm('modele_custom', appareil.modele).catch(() => {});
        }

        aboutir(result);
      }
    } catch (err) {
      toast.error(err.message || 'Erreur lors de la création du ticket');
    } finally {
      setLoading(false);
    }
  };

  const canNext = () => {
    switch (currentId) {
      case 'vous': return Boolean(form.nom && form.telephone);
      case 'appareil': return Boolean(form.categorie && (sansModele || (form.marque && !modeleManquant(form))));
      case 'detail':
        if (isAchat) return Boolean(achatType && achatDescription.trim());
        if (isCommande) return Boolean(form.panne_detail.trim());
        return Boolean(form.panne || pieceACommander);
      default: return true;
    }
  };

  const handleNext = () => {
    if (!validateStep()) return;
    if (isVerification) {
      // Fire-and-forget : handleSubmit gère son chargement et ses erreurs (toast)
      handleSubmit().catch((err) => {
        console.error('[ClientFormPage] handleSubmit failed', err);
      });
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    setErrors({});
    if (step === 0) navigate(modePersonnel ? tableauDeBord : '/');
    else setStep((s) => s - 1);
  };

  const allerA = (i) => {
    setErrors({});
    setStep(i);
  };

  const inv = (field) => (errors[field] ? { 'aria-invalid': 'true', 'aria-describedby': `${PREFIX}-${field}-erreur` } : {});

  // Achat (ticket clôturé et payé aussitôt) : réservé au personnel, jamais sur la borne publique
  const tuileAchat = modePersonnel ? (
    <button
      type="button"
      aria-pressed={isAchat}
      onClick={() => updateForm('categorie', 'Achat')}
      className={`${tuile(isAchat)} flex items-center gap-2`}
    >
      <ShoppingBag className="w-5 h-5 shrink-0" aria-hidden="true" /> Achat
    </button>
  ) : null;

  const libelleEnvoi = isAchat ? "Enregistrer l'achat" : isCommande ? 'Valider la commande' : "Déposer l'appareil";

  // ─── Récapitulatif ───────────────────────────────────────────
  const sectionsRecap = [
    { id: 'vous', titre: 'Vous', icone: User, lignes: lignesVous(form), onModifier: () => allerA(0) },
    {
      id: 'appareil', titre: 'Votre appareil', icone: Smartphone, onModifier: () => allerA(1),
      lignes: isAchat
        ? [{ label: 'Type', valeur: 'Achat' }]
        : [{ label: 'Type', valeur: form.categorie }, { label: 'Marque et modèle', valeur: libelleAppareil(form) }],
    },
    isAchat ? {
      id: 'detail', titre: 'Votre achat', icone: ShoppingBag, onModifier: () => allerA(2),
      lignes: [
        { label: 'Type', valeur: achatType },
        { label: 'Description', valeur: achatDescription },
        { label: 'Prix', valeur: achatPrix ? `${achatPrix} €` : '' },
        { label: 'Notes', valeur: form.notes_client },
      ],
    } : isCommande ? {
      id: 'detail', titre: 'Votre commande', icone: Package, onModifier: () => allerA(2),
      lignes: [
        { label: 'Pièce', valeur: form.panne_detail },
        { label: 'Précisions', valeur: form.notes_client },
        { label: 'Fournisseur', valeur: fournisseur },
        { label: 'Prix estimé', valeur: prixEstime ? `${prixEstime} €` : '' },
      ],
    } : {
      id: 'detail', titre: "Le problème et l'accès", icone: AlertTriangle, onModifier: () => allerA(2),
      lignes: [
        { label: 'Problème', valeur: form.panne || (pieceACommander ? 'Pièce à commander' : '') },
        { label: 'Détails', valeur: form.panne_detail },
        { label: 'Notes', valeur: form.notes_client },
        ...(pieceACommander ? [{ label: 'Pièce à commander', valeur: [pieceNom, pieceDetails].filter(Boolean).join(' — ') }] : []),
        { label: 'Accès', valeur: resumeAcces(form), masque: true },
      ],
    },
    ...(delaiRequis ? [{
      id: 'delai', titre: 'Délai de réparation', icone: Clock, onModifier: () => allerA(2),
      lignes: [{ label: 'Récupération', valeur: dateDelai(delai.valeur) ? phrasePret(dateDelai(delai.valeur), new Date()) : '' }],
    }] : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="depot-form w-full max-w-[640px] mx-auto px-4 py-5 sm:py-6 pb-10">
        {/* En-tête */}
        <div className="flex items-center gap-2 mb-5">
          <button
            type="button"
            onClick={termine ? retourApresDepot : handleBack}
            disabled={termine && retourEnCours}
            className="btn-ghost btn-icon btn-lg -ml-2"
            aria-label={step === 0 && modePersonnel ? 'Retour au tableau de bord'
              : step === 0 || termine ? "Retour à l'accueil" : "Retour à l'étape précédente"}
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 ref={titreRef} tabIndex={-1} className="t-display focus:outline-none">
              {modePersonnel ? 'Nouveau ticket' : 'Déposer un appareil'}
            </h1>
            {!termine && (
              <span className="block text-sm text-slate-600 mt-0.5">Étape {step + 1} sur {ETAPES.length} — {etape.titre}</span>
            )}
          </div>
        </div>

        {!termine && <BarreEtapes etapes={etapes} courante={step} />}

        {/* ═══ Étape 1 : Vous ═══ */}
        {!termine && currentId === 'vous' && (
          <div className="card p-5 sm:p-6 space-y-5 animate-in">
            <EnTete icone={etape.icone} titre={etape.titre} sousTitre={etape.sousTitre} />
            <ChampsVous prefix={PREFIX} form={form} errors={errors} onChange={updateForm} />
          </div>
        )}

        {/* ═══ Étape 2 : Votre appareil (catégorie, marque, modèle sur un seul écran) ═══ */}
        {!termine && currentId === 'appareil' && (
          <div className="card p-5 sm:p-6 space-y-5 animate-in">
            <EnTete icone={etape.icone} titre={etape.titre} sousTitre={etape.sousTitre} />
            <ChampsAppareil
              prefix={PREFIX} form={form} errors={errors} onChange={updateForm}
              categories={categories} catalogue={catalogue} sansModele={sansModele}
              onModeleLibre={setModeleLibre}
              enfantsCategories={tuileAchat}
            />
            {isCommande && (
              <div className="callout callout-info">
                <Package aria-hidden="true" />
                <span>Commande de pièce : vous décrirez la pièce à l'étape suivante.</span>
              </div>
            )}
          </div>
        )}

        {/* ═══ Étape 3 : Le problème et l'accès / Votre commande / Votre achat ═══ */}
        {!termine && currentId === 'detail' && (
          <div className="card p-5 sm:p-6 space-y-5 animate-in">
            <EnTete icone={etape.icone} titre={etape.titre} sousTitre={etape.sousTitre} />

            {isAchat ? (
              <>
                <fieldset aria-describedby={errors.achat_type ? `${PREFIX}-achat_type-erreur` : undefined}>
                  <legend className="input-label">Type d'achat *</legend>
                  <div className="grid grid-cols-3 gap-3">
                    {ACHAT_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        aria-pressed={achatType === type}
                        onClick={() => { setAchatType(type); setErrors((e) => ({ ...e, achat_type: undefined })); }}
                        className={`${tuile(achatType === type)} text-center`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                  <ErreurChamp prefix={PREFIX} errors={errors} field="achat_type" />
                </fieldset>

                <div>
                  <label htmlFor={`${PREFIX}-achat-description`} className="input-label">Description de l'achat *</label>
                  <input
                    id={`${PREFIX}-achat-description`}
                    value={achatDescription}
                    onChange={(e) => { setAchatDescription(e.target.value); setErrors((er) => ({ ...er, achat_description: undefined })); }}
                    className="input"
                    placeholder="Ex: iPhone 15 128Go Noir, Coque silicone..."
                    {...inv('achat_description')}
                  />
                  <ErreurChamp prefix={PREFIX} errors={errors} field="achat_description" />
                </div>

                <div>
                  <label htmlFor={`${PREFIX}-achat-prix`} className="input-label">Prix de vente (€)</label>
                  <input
                    id={`${PREFIX}-achat-prix`}
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={achatPrix}
                    onChange={(e) => setAchatPrix(e.target.value)}
                    className="input"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label htmlFor={`${PREFIX}-achat-notes`} className="input-label">Notes</label>
                  <textarea
                    id={`${PREFIX}-achat-notes`}
                    value={form.notes_client}
                    onChange={(e) => updateForm('notes_client', e.target.value)}
                    className="input resize-none"
                    rows={2}
                    placeholder="Informations complémentaires..."
                  />
                </div>
              </>
            ) : isCommande ? (
              <>
                <div className="callout callout-info">
                  <Package aria-hidden="true" />
                  <span>La panne sera automatiquement définie comme "Pièce à commander"</span>
                </div>

                <div>
                  <label htmlFor={`${PREFIX}-piece`} className="input-label">Pièce à commander *</label>
                  <input
                    id={`${PREFIX}-piece`}
                    value={form.panne_detail}
                    onChange={(e) => updateForm('panne_detail', e.target.value)}
                    className="input"
                    placeholder="Ex: Écran OLED iPhone 14 Pro, Nappe Face ID..."
                    {...inv('panne_detail')}
                  />
                  <ErreurChamp prefix={PREFIX} errors={errors} field="panne_detail" />
                </div>

                <div>
                  <label htmlFor={`${PREFIX}-commande-notes`} className="input-label">Détails supplémentaires (référence, couleur, capacité...)</label>
                  <textarea
                    id={`${PREFIX}-commande-notes`}
                    value={form.notes_client}
                    onChange={(e) => updateForm('notes_client', e.target.value)}
                    className="input resize-none"
                    rows={3}
                    placeholder="Précisions sur la pièce, référence exacte, couleur, capacité..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor={`${PREFIX}-fournisseur`} className="input-label">Fournisseur</label>
                    <input id={`${PREFIX}-fournisseur`} value={fournisseur} onChange={(e) => setFournisseur(e.target.value)}
                      className="input" placeholder="Ex: Utopya, MobileParts..." />
                  </div>
                  <div>
                    <label htmlFor={`${PREFIX}-prix-estime`} className="input-label">Prix estimé (€)</label>
                    <input id={`${PREFIX}-prix-estime`} type="number" step="0.01" inputMode="decimal" value={prixEstime} onChange={(e) => setPrixEstime(e.target.value)}
                      className="input" placeholder="0.00" />
                  </div>
                </div>
              </>
            ) : (
              <>
                <ChampsPanne prefix={PREFIX} form={form} errors={errors} onChange={updateForm} pannes={pannes} />

                {/* Délai promis au client : obligatoire quand le personnel crée le ticket */}
                {delaiRequis && (
                  <div className="border-t border-slate-100 pt-5">
                    <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900 mb-3">
                      <Clock className="w-5 h-5 text-brand-600 shrink-0" aria-hidden="true" /> Délai de réparation
                    </h3>
                    <DelaiReparation
                      idPrefix={`${PREFIX}-delai`}
                      legende="Délai de réparation"
                      value={delai.valeur}
                      cle={delai.cle}
                      onChange={updateDelai}
                      required
                      error={errors.delai}
                      taille="borne"
                    />
                  </div>
                )}

                {/* Accès à l'appareil : code, schéma ou pas de code */}
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

                {/* Pièce à commander */}
                <div className="border-t border-slate-100 pt-4">
                  <label htmlFor={`${PREFIX}-piece-a-commander`} className="flex items-center gap-3 min-h-11 cursor-pointer">
                    <input id={`${PREFIX}-piece-a-commander`} type="checkbox" checked={pieceACommander}
                      onChange={(e) => { setPieceACommander(e.target.checked); setErrors((er) => ({ ...er, panne: undefined, piece_nom: undefined })); }}
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
                      <label htmlFor={`${PREFIX}-piece-nom`} className="input-label">Pièce à commander *</label>
                      <input id={`${PREFIX}-piece-nom`} value={pieceNom}
                        onChange={(e) => { setPieceNom(e.target.value); setErrors((er) => ({ ...er, piece_nom: undefined })); }}
                        placeholder="Ex: Écran OLED iPhone 14 Pro, Nappe Face ID..."
                        className="input" {...inv('piece_nom')} />
                      <ErreurChamp prefix={PREFIX} errors={errors} field="piece_nom" />
                    </div>
                    <div>
                      <label htmlFor={`${PREFIX}-piece-details`} className="input-label">Détails / Commentaire</label>
                      <textarea id={`${PREFIX}-piece-details`} value={pieceDetails} onChange={(e) => setPieceDetails(e.target.value)}
                        placeholder="Précisions sur la pièce, référence, couleur, capacité..."
                        rows={2}
                        className="input resize-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor={`${PREFIX}-piece-fournisseur`} className="input-label">Fournisseur</label>
                        <input id={`${PREFIX}-piece-fournisseur`} value={fournisseur} onChange={(e) => setFournisseur(e.target.value)}
                          placeholder="Ex: Utopya, MobileParts..."
                          className="input" />
                      </div>
                      <div>
                        <label htmlFor={`${PREFIX}-piece-prix`} className="input-label">Prix estimé</label>
                        <input id={`${PREFIX}-piece-prix`} type="number" inputMode="decimal" value={prixEstime} onChange={(e) => setPrixEstime(e.target.value)}
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

        {/* ═══ Étape 4 : Vérification ═══ */}
        {!termine && isVerification && (
          <div className="card p-5 sm:p-6 space-y-5 animate-in">
            <EnTete icone={etape.icone} titre={etape.titre} sousTitre={etape.sousTitre} />
            <Recapitulatif sections={sectionsRecap} />
            {!sansModele && (
              <CaseAttente prefix={PREFIX} checked={form.attente_boutique} onChange={(v) => updateForm('attente_boutique', v)} />
            )}
            <ConsentementMarketing id={`${PREFIX}-consentement`} checked={form.consentement_marketing}
              onChange={(v) => updateForm('consentement_marketing', v)} />
            <MentionRgpd kiosque />
          </div>
        )}

        {/* ═══ Confirmation ═══ */}
        {termine && (
          <div className="card p-6 sm:p-8 text-center animate-in">
            <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-5" aria-hidden="true">
              <Check className="w-10 h-10 text-emerald-700" />
            </div>
            <h2 className="t-display text-balance mb-2">Merci pour votre confiance !</h2>
            <p className="text-slate-600 mb-5">Votre numéro de ticket :</p>
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
                <span className="block text-sm text-slate-600 tabular-nums">Retour automatique dans {countdown} seconde{countdown > 1 ? 's' : ''}...</span>
              </div>
            )}
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => navigate(lienSuivi('', createdCode, createdToken))}
                className="btn-primary btn-lg btn-block"
              >
                <Send aria-hidden="true" /> Suivre {isAchat ? 'mon achat' : isCommande ? 'ma commande' : 'ma réparation'}
              </button>
              <button type="button" onClick={retourApresDepot} disabled={retourEnCours}
                aria-busy={retourEnCours || undefined} className="btn-secondary btn-lg btn-block">
                <ArrowLeft aria-hidden="true" /> Nouveau dépôt
              </button>
            </div>
          </div>
        )}

        {/* Navigation */}
        {!termine && (
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
              {loading ? 'Envoi...' : isVerification ? libelleEnvoi : 'Suivant'}
              {!isVerification && <ArrowRight aria-hidden="true" />}
              {isVerification && !loading && <Check aria-hidden="true" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
