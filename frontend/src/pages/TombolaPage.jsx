import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  AlertCircle, CircleCheck, Loader2, MessageCircle, MessageSquare, Phone, Plus, Printer, RefreshCw, Search,
  Trash2, UserPlus, X,
} from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { ReglementTombola } from '../components/CaseTombola';
import { formatTel } from '../lib/contact';
import { smsLink, waLink } from '../lib/utils';
import { dansCombien, dateCourte, dateTirage, pourSaisie, rangLot } from '../lib/tombola';
import { isValidPhone, estTelephoneFictif, MESSAGE_TEL_FICTIF } from '../components/DepotEtapes';
import { useInfosRgpd } from './ConfidentialitePage';

/**
 * Tombola des clients (menu « Tombola »). Point focal : l'état de la tombola en cours — ce qu'on
 * gagne, quand a lieu le tirage, combien de participants — puis, après le tirage, les gagnants à
 * prévenir. Une seule action primaire : « Inscrire un participant » tant qu'elle est ouverte,
 * « Créer une tombola » sinon. Créer, modifier, tirer, annuler et remplacer demandent le code admin.
 */
const SOURCES = { borne: 'Borne', comptoir: 'Comptoir', depot_distance: 'En ligne' };
const REGLES = [
  'Gratuite : ni ticket, ni mise, aucun achat demandé. Le personnel peut inscrire quelqu’un qui ne dépose rien.',
  'Une participation par personne (un numéro de téléphone) : tout le monde a la même chance.',
  'Lots offerts par la boutique et annoncés avant le tirage, un gagnant par lot.',
  'Tirage au hasard par le serveur, à la date annoncée, une seule fois.',
  'Un gagnant injoignable est remplacé par un nouveau tirage parmi les autres inscrits.',
];

const nomComplet = (p) => `${p?.prenom || ''} ${p?.nom || ''}`.trim() || 'Client sans nom';
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

// ─── Fenêtre générique (formulaires) ─────────────────────────────
function Fenetre({ titre, onClose, children, pied, large = false, bloque = false }) {
  const boxRef = useRef(null);
  const titreId = useId();
  useFocusTrap(boxRef, !bloque, { onEscape: () => onClose?.() });
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby={titreId}
        onMouseDown={(e) => e.stopPropagation()} className={`modal ${large ? 'sm:max-w-xl' : 'sm:max-w-md'}`}>
        <div className="modal-header">
          <h2 id={titreId} className="t-h2">{titre}</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="btn-ghost btn-icon min-w-11 min-h-11">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        {children}
        {pied && <div className="modal-footer">{pied}</div>}
      </div>
    </div>,
    document.body,
  );
}

function Erreur({ id, children }) {
  if (!children) return null;
  return <p id={id} role="alert" className="input-error"><AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />{children}</p>;
}

// ─── Créer ou modifier une tombola ───────────────────────────────
function FormulaireTombola({ tombola, onClose, onEnregistre, sensible }) {
  const toast = useToast();
  const uid = useId();
  const initial = pourSaisie(tombola?.tirage_le);
  const [titre, setTitre] = useState(tombola?.titre || '');
  const [lots, setLots] = useState((tombola?.lots || []).join('\n'));
  const [jour, setJour] = useState(initial.jour);
  const [heure, setHeure] = useState(initial.heure || '18:00');
  const [perso, setPerso] = useState(Boolean(tombola?.reglement_personnalise));
  const [reglement, setReglement] = useState(tombola?.reglement_personnalise ? tombola.reglement : '');
  const [erreurs, setErreurs] = useState({});
  const [envoi, setEnvoi] = useState(false);

  const liste = lots.split('\n').map((l) => l.trim()).filter(Boolean);
  const corrige = (cle) => setErreurs((e) => (e[cle] ? { ...e, [cle]: undefined } : e));

  const valider = () => {
    const e = {};
    if (!titre.trim()) e.titre = 'Donnez un titre à la tombola, par exemple « Tombola de fin d’année »';
    if (!liste.length) e.lots = 'Indiquez au moins un lot à gagner';
    else if (liste.length > 10) e.lots = '10 lots au maximum';
    if (!jour || !heure) e.date = 'Choisissez le jour et l’heure du tirage';
    else if (new Date(`${jour}T${heure}`).getTime() <= Date.now()) e.date = 'La date du tirage doit être dans le futur';
    setErreurs(e);
    return !Object.keys(e).length;
  };

  const enregistrer = async (ev) => {
    ev.preventDefault();
    if (envoi || !valider()) return;
    const corps = {
      titre: titre.trim(), lots: liste, tirage_le: `${jour}T${heure}`,
      reglement: perso ? reglement.trim() : '',
    };
    setEnvoi(true);
    try {
      const r = await sensible(() => (tombola ? api.updateTombola(tombola.id, corps) : api.createTombola(corps)));
      toast.success(tombola ? 'Tombola modifiée' : 'Tombola ouverte : la case apparaît sur les formulaires de dépôt');
      onEnregistre(r);
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(err.message || 'Enregistrement impossible');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Fenetre titre={tombola ? 'Modifier la tombola' : 'Créer une tombola'} onClose={onClose} large bloque={envoi}>
      <form onSubmit={enregistrer} noValidate className="contents">
        <div className="modal-body space-y-5">
          <div>
            <label htmlFor={`${uid}-titre`} className="input-label">Titre</label>
            <input id={`${uid}-titre`} className="input" value={titre} maxLength={80} autoComplete="off"
              onChange={(e) => { setTitre(e.target.value); corrige('titre'); }} aria-invalid={erreurs.titre ? 'true' : undefined}
              aria-describedby={erreurs.titre ? `${uid}-titre-err` : `${uid}-titre-aide`} />
            {erreurs.titre
              ? <Erreur id={`${uid}-titre-err`}>{erreurs.titre}</Erreur>
              : <p id={`${uid}-titre-aide`} className="input-help">Affiché sur la borne, le dépôt en ligne et l’affiche</p>}
          </div>
          <div>
            <label htmlFor={`${uid}-lots`} className="input-label">Lots à gagner</label>
            <textarea id={`${uid}-lots`} className="textarea" rows={3} value={lots}
              onChange={(e) => { setLots(e.target.value); corrige('lots'); }} aria-invalid={erreurs.lots ? 'true' : undefined}
              aria-describedby={erreurs.lots ? `${uid}-lots-err` : `${uid}-lots-aide`} />
            {erreurs.lots
              ? <Erreur id={`${uid}-lots-err`}>{erreurs.lots}</Erreur>
              : (
                <p id={`${uid}-lots-aide`} className="input-help">
                  Un lot par ligne : autant de gagnants que de lignes, le premier tiré reçoit le premier lot
                  {liste.length > 0 && <span className="tabular-nums"> — {pluriel(liste.length, 'gagnant')}</span>}
                </p>
              )}
          </div>
          <fieldset>
            <legend className="input-label">Tirage au sort</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${uid}-jour`} className="sr-only">Jour du tirage</label>
                <input id={`${uid}-jour`} type="date" className="input" value={jour}
                  onChange={(e) => { setJour(e.target.value); corrige('date'); }} aria-invalid={erreurs.date ? 'true' : undefined}
                  aria-describedby={erreurs.date ? `${uid}-date-err` : `${uid}-date-aide`} />
              </div>
              <div>
                <label htmlFor={`${uid}-heure`} className="sr-only">Heure du tirage</label>
                <input id={`${uid}-heure`} type="time" className="input" value={heure}
                  onChange={(e) => { setHeure(e.target.value); corrige('date'); }} aria-invalid={erreurs.date ? 'true' : undefined} />
              </div>
            </div>
            {erreurs.date
              ? <Erreur id={`${uid}-date-err`}>{erreurs.date}</Erreur>
              : <p id={`${uid}-date-aide`} className="input-help">Le logiciel tire au sort tout seul à cette date ; les inscriptions s’arrêtent à ce moment</p>}
          </fieldset>
          <div>
            <label htmlFor={`${uid}-perso`} className="flex items-center gap-3 min-h-11 cursor-pointer">
              <input id={`${uid}-perso`} type="checkbox" className="checkbox" checked={perso}
                onChange={(e) => setPerso(e.target.checked)} />
              <span className="t-label">Écrire mon propre règlement</span>
            </label>
            {perso ? (
              <>
                <label htmlFor={`${uid}-reglement`} className="sr-only">Règlement</label>
                <textarea id={`${uid}-reglement`} className="textarea" rows={6} maxLength={6000} value={reglement}
                  onChange={(e) => setReglement(e.target.value)} aria-describedby={`${uid}-reglement-aide`} />
                <p id={`${uid}-reglement-aide`} className="input-help">Vide : le règlement automatique est gardé</p>
              </>
            ) : (
              <p className="input-help">Sans cela, le règlement est rédigé automatiquement : gratuité, une participation par personne, lots, date du tirage</p>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" onClick={onClose} className="btn-ghost">Annuler</button>
          <button type="submit" disabled={envoi} aria-busy={envoi || undefined} className="btn-primary">
            {envoi && <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />}
            {tombola ? 'Enregistrer' : 'Ouvrir la tombola'}
          </button>
        </div>
      </form>
    </Fenetre>
  );
}

// ─── Inscrire quelqu'un au comptoir ──────────────────────────────
function FormulaireParticipant({ tombola, onClose, onInscrit }) {
  const toast = useToast();
  const uid = useId();
  const [form, setForm] = useState({ nom: '', prenom: '', telephone: '' });
  const [erreurs, setErreurs] = useState({});
  const [envoi, setEnvoi] = useState(false);
  const champ = (cle) => (e) => {
    setForm((f) => ({ ...f, [cle]: e.target.value }));
    setErreurs((x) => ({ ...x, [cle]: undefined }));
  };

  const inscrire = async (ev) => {
    ev.preventDefault();
    if (envoi) return;
    const e = {};
    if (!form.nom.trim()) e.nom = 'Le nom est requis';
    if (!form.telephone.trim()) e.telephone = 'Le numéro est requis : il sert à prévenir le gagnant';
    else if (!isValidPhone(form.telephone)) e.telephone = 'Le numéro doit avoir 10 chiffres, par exemple 06 12 34 56 78';
    else if (estTelephoneFictif(form.telephone)) e.telephone = MESSAGE_TEL_FICTIF;
    setErreurs(e);
    if (Object.keys(e).length) return;
    setEnvoi(true);
    try {
      const r = await api.inscrireTombola(tombola.id, {
        nom: form.nom.trim(), prenom: form.prenom.trim(), telephone: form.telephone.trim(),
      });
      toast.success(r?.deja_inscrit ? 'Ce numéro participait déjà : une seule participation par personne' : 'Participant inscrit');
      onInscrit();
    } catch (err) {
      toast.error(err.message || 'Inscription impossible');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Fenetre titre="Inscrire un participant" onClose={onClose}>
      <form onSubmit={inscrire} noValidate className="contents">
        <div className="modal-body space-y-4">
          <p className="t-body">Gratuit : aucun dépôt ni achat n’est demandé pour participer.</p>
          <div>
            <label htmlFor={`${uid}-nom`} className="input-label">Nom</label>
            <input id={`${uid}-nom`} className="input" value={form.nom} maxLength={100} autoComplete="off"
              onChange={champ('nom')} aria-invalid={erreurs.nom ? 'true' : undefined}
              aria-describedby={erreurs.nom ? `${uid}-nom-err` : undefined} />
            <Erreur id={`${uid}-nom-err`}>{erreurs.nom}</Erreur>
          </div>
          <div>
            <label htmlFor={`${uid}-prenom`} className="input-label">Prénom <span className="font-normal text-slate-500">(facultatif)</span></label>
            <input id={`${uid}-prenom`} className="input" value={form.prenom} maxLength={100} autoComplete="off"
              onChange={champ('prenom')} />
          </div>
          <div>
            <label htmlFor={`${uid}-tel`} className="input-label">Téléphone</label>
            <input id={`${uid}-tel`} type="tel" inputMode="tel" className="input tabular-nums" value={form.telephone}
              maxLength={30} autoComplete="off" onChange={champ('telephone')}
              aria-invalid={erreurs.telephone ? 'true' : undefined}
              aria-describedby={erreurs.telephone ? `${uid}-tel-err` : undefined} />
            <Erreur id={`${uid}-tel-err`}>{erreurs.telephone}</Erreur>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" onClick={onClose} className="btn-ghost">Annuler</button>
          <button type="submit" disabled={envoi} aria-busy={envoi || undefined} className="btn-primary">
            {envoi && <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />}
            Inscrire
          </button>
        </div>
      </form>
    </Fenetre>
  );
}

// ─── Un gagnant : prévenir, remettre le lot, remplacer ───────────
function Gagnant({ gagnant, boutique, occupe, onSuivi, onRemplacer }) {
  const remplace = Boolean(gagnant.remplace_le);
  const remis = Boolean(gagnant.lot_remis_le);
  const prevenu = Boolean(gagnant.prevenu_le);
  const prenom = (gagnant.prenom || '').trim();
  const message = `Bonjour${prenom ? ` ${prenom}` : ''}, vous avez été tiré au sort à la tombola ${boutique} : `
    + `vous gagnez « ${gagnant.lot} ». Passez en boutique pour retirer votre lot. L’équipe ${boutique}`;
  const tel = gagnant.telephone || '';

  if (remplace) {
    return (
      <li className="px-4 sm:px-5 py-3 text-sm text-slate-600">
        <span className="tabular-nums">{rangLot(gagnant.rang)}</span> — {nomComplet(gagnant)}, remplacé le {dateCourte(gagnant.remplace_le)}
      </li>
    );
  }
  return (
    <li className="px-4 sm:px-5 py-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <p className="text-sm text-slate-600"><span className="tabular-nums">{rangLot(gagnant.rang)}</span> — {gagnant.lot}</p>
        <p className="mt-0.5 text-base font-semibold text-slate-900 [overflow-wrap:anywhere]">{nomComplet(gagnant)}</p>
        <p className="mt-0.5 text-sm text-slate-700 tabular-nums">
          {tel ? formatTel(tel) : 'Numéro effacé'}
          <span className="text-slate-600">
            {' · '}
            {remis ? `Lot remis le ${dateCourte(gagnant.lot_remis_le)}`
              : prevenu ? `Prévenu le ${dateCourte(gagnant.prevenu_le)}` : 'À prévenir'}
          </span>
        </p>
      </div>
      {!remis && (
        <div className="flex flex-wrap items-center gap-2">
          {tel && (
            <div className="flex items-center">
              <a href={`tel:${tel.replace(/[^\d+]/g, '')}`} className="btn-ghost btn-icon btn-sm" title="Appeler"
                aria-label={`Appeler ${nomComplet(gagnant)}`}><Phone aria-hidden="true" /></a>
              <a href={waLink(tel, message)} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-icon btn-sm"
                title="Écrire sur WhatsApp" aria-label={`Écrire à ${nomComplet(gagnant)} sur WhatsApp (nouvel onglet)`}>
                <MessageCircle aria-hidden="true" />
              </a>
              <a href={smsLink(tel, message)} className="btn-ghost btn-icon btn-sm" title="Envoyer un SMS"
                aria-label={`Envoyer un SMS à ${nomComplet(gagnant)}`}><MessageSquare aria-hidden="true" /></a>
            </div>
          )}
          {!prevenu && (
            <button type="button" disabled={occupe} onClick={() => onSuivi(gagnant, { prevenu: true })} className="btn-secondary btn-sm">
              Noter « prévenu »
            </button>
          )}
          <button type="button" disabled={occupe} onClick={() => onRemplacer(gagnant)} className="btn-ghost btn-sm">
            Tirer un remplaçant
          </button>
          <button type="button" disabled={occupe} onClick={() => onSuivi(gagnant, { lot_remis: true })} className="btn-secondary btn-sm">
            <CircleCheck aria-hidden="true" /> Lot remis
          </button>
        </div>
      )}
      {remis && (
        <button type="button" disabled={occupe} onClick={() => onSuivi(gagnant, { lot_remis: false })} className="btn-ghost btn-sm self-start lg:self-center">
          Annuler la remise
        </button>
      )}
    </li>
  );
}

// ─── Chiffres de l'en-tête de la tombola ─────────────────────────
function Fait({ libelle, children }) {
  return (
    <div className="px-4 sm:px-5 py-4 min-w-0">
      <dt className="text-sm text-slate-600">{libelle}</dt>
      <dd className="mt-1 min-w-0">{children}</dd>
    </div>
  );
}

function Lots({ lots }) {
  if (lots.length === 1) return <p className="text-base font-semibold text-slate-900 [overflow-wrap:anywhere]">{lots[0]}</p>;
  return (
    <ol className="space-y-0.5">
      {lots.map((lot, i) => (
        <li key={`${i}-${lot}`} className="text-sm text-slate-900 [overflow-wrap:anywhere]">
          <span className="text-slate-600 tabular-nums">{i + 1}. </span><span className="font-medium">{lot}</span>
        </li>
      ))}
    </ol>
  );
}

export default function TombolaPage() {
  const toast = useToast();
  const { user } = useAuth();
  const { nom: boutique } = useInfosRgpd();
  const { sensible, adminPrompt } = useAdminElevation();
  const confirmation = useConfirmDialog();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';

  const [etat, setEtat] = useState({ tombolas: null, erreur: null });
  const [liste, setListe] = useState(null);          // participants de la tombola ouverte
  const [recherche, setRecherche] = useState('');
  const [fenetre, setFenetre] = useState(null);      // 'creer' | 'modifier' | 'participant' | 'reglement'
  const [occupe, setOccupe] = useState(false);
  const vivant = useRef(true);
  useEffect(() => { vivant.current = true; return () => { vivant.current = false; }; }, []);

  const charger = useCallback(async () => {
    try {
      const r = await api.getTombolas();
      if (!vivant.current) return;
      const tombolas = Array.isArray(r?.tombolas) ? r.tombolas : [];
      setEtat({ tombolas, erreur: null });
      const ouverte = tombolas.find((t) => t.statut === 'ouverte');
      if (ouverte) {
        const d = await api.getTombola(ouverte.id);
        if (vivant.current) setListe(Array.isArray(d?.liste) ? d.liste : []);
      } else {
        setListe(null);
      }
    } catch (err) {
      if (vivant.current) setEtat((e) => ({ tombolas: e.tombolas, erreur: err.message || 'Chargement impossible' }));
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const tombolas = etat.tombolas || [];
  const ouverte = tombolas.find((t) => t.statut === 'ouverte') || null;
  const derniereTiree = tombolas.find((t) => t.statut === 'tiree') || null;
  const courante = ouverte || derniereTiree;
  const precedentes = tombolas.filter((t) => t !== courante && t.statut !== 'ouverte');
  const heureDuTirage = ouverte ? new Date(ouverte.tirage_le).getTime() <= Date.now() : false;

  // À l'heure dite, le serveur tire dans la minute : la page se relit seule jusqu'au résultat
  useEffect(() => {
    if (!ouverte) return undefined;
    const reste = new Date(ouverte.tirage_le).getTime() - Date.now();
    const delai = reste <= 0 ? 15_000 : Math.min(reste + 20_000, 2_000_000_000);
    const t = setTimeout(charger, delai);
    return () => clearTimeout(t);
  }, [ouverte, charger, etat.tombolas]);

  const admin = async (action, succes) => {
    if (occupe) return;
    setOccupe(true);
    try {
      await sensible(action);
      if (succes) toast.success(succes);
      await charger();
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(err.message || 'Action impossible');
      await charger();
    } finally {
      if (vivant.current) setOccupe(false);
    }
  };

  const tirerMaintenant = () => confirmation.demander({
    title: `Tirer au sort « ${ouverte.titre} » maintenant ?`,
    description: `Le tirage était prévu le ${dateTirage(ouverte.tirage_le)}. Il désigne ${pluriel(ouverte.lots.length, 'gagnant')} parmi ${pluriel(ouverte.participants, 'participant')}, ferme les inscriptions et ne se refait pas.`,
    confirmLabel: 'Tirer au sort',
    onConfirm: () => admin(() => api.tirerTombola(ouverte.id), 'Tirage effectué'),
  });

  const annuler = () => confirmation.demander({
    title: `Annuler la tombola « ${ouverte.titre} » ?`,
    description: `Aucun tirage n’aura lieu et les ${pluriel(ouverte.participants, 'participation')} sont effacées. La case disparaît des formulaires de dépôt.`,
    confirmLabel: 'Annuler la tombola',
    cancelLabel: 'Garder la tombola',
    destructive: true,
    onConfirm: () => admin(() => api.annulerTombola(ouverte.id), 'Tombola annulée'),
  });

  const remplacer = (g) => confirmation.demander({
    title: `Tirer un remplaçant pour ${nomComplet(g)} ?`,
    description: `Le ${rangLot(g.rang)} (${g.lot}) est attribué à un autre inscrit, tiré au sort parmi ceux qui n’ont pas gagné. ${nomComplet(g)} perd son lot.`,
    confirmLabel: 'Tirer un remplaçant',
    onConfirm: () => admin(() => api.remplacerGagnant(g.id), 'Remplaçant tiré au sort'),
  });

  const retirer = (p) => confirmation.demander({
    title: `Retirer ${nomComplet(p)} de la tombola ?`,
    description: 'Cette personne ne participera plus au tirage. Elle peut être réinscrite ensuite.',
    confirmLabel: 'Retirer de la tombola',
    destructive: true,
    onConfirm: async () => {
      try {
        await api.retirerParticipation(p.id);
        toast.success('Participation retirée');
      } catch (err) {
        toast.error(err.message || 'Retrait impossible');
      }
      await charger();
    },
  });

  const suivre = async (g, corps) => {
    if (occupe) return;
    setOccupe(true);
    try {
      await api.suivreGagnant(g.id, corps);
      await charger();
    } catch (err) {
      toast.error(err.message || 'Enregistrement impossible');
    } finally {
      if (vivant.current) setOccupe(false);
    }
  };

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const chiffres = q.replace(/\D/g, '');
    if (!q || !liste) return liste || [];
    return liste.filter((p) => nomComplet(p).toLowerCase().includes(q)
      || (chiffres.length >= 3 && String(p.telephone || '').replace(/\D/g, '').includes(chiffres)));
  }, [liste, recherche]);

  const chargement = etat.tombolas === null && !etat.erreur;
  const gagnantsActifs = (courante?.gagnants || []).filter((g) => !g.remplace_le);
  const aPrevenir = gagnantsActifs.filter((g) => !g.prevenu_le && !g.lot_remis_le).length;

  return (
    <div className="page max-w-5xl">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-header-title">Tombola</h1>
          <p className="page-header-subtitle">Gratuite et sans obligation d’achat, tirée au sort par le logiciel à la date annoncée</p>
        </div>
        {!chargement && !etat.erreur && (
          <div className="page-header-actions">
            {ouverte && !heureDuTirage ? (
              <button type="button" onClick={() => setFenetre('participant')} className="btn-primary">
                <UserPlus aria-hidden="true" /> Inscrire un participant
              </button>
            ) : !ouverte && (
              <button type="button" onClick={() => setFenetre('creer')} className="btn-primary">
                <Plus aria-hidden="true" /> Créer une tombola
              </button>
            )}
          </div>
        )}
      </div>

      {chargement && (
        <div role="status" aria-label="Chargement de la tombola" className="space-y-4">
          <div className="skeleton h-40" />
          <div className="skeleton h-64" />
        </div>
      )}

      {etat.erreur && (
        <div role="alert" className="callout callout-danger items-center">
          <AlertCircle aria-hidden="true" />
          <p className="flex-1">La tombola n’a pas pu être chargée : {etat.erreur}</p>
          <button type="button" onClick={charger} className="btn-secondary btn-sm"><RefreshCw aria-hidden="true" /> Réessayer</button>
        </div>
      )}

      {!chargement && !etat.erreur && !courante && (
        <div className="card">
          <div className="empty-state">
            <h2 className="t-h2">Aucune tombola pour l’instant</h2>
            <p className="t-body max-w-md">
              Créez-en une : la case « Je participe à la tombola » apparaît alors sur la borne, le formulaire du
              comptoir et le dépôt en ligne, et le tirage se fait tout seul à la date choisie.
            </p>
          </div>
        </div>
      )}

      {courante && (
        <section aria-labelledby="tombola-courante" className="card">
          <div className="card-header flex-wrap">
            <div className="min-w-0">
              <h2 id="tombola-courante" className="t-h2 [overflow-wrap:anywhere]">{courante.titre}</h2>
            </div>
            {ouverte
              ? <span className={`badge ${heureDuTirage ? 'badge-info' : 'badge-success'}`}><span className="badge-dot" />{heureDuTirage ? 'Tirage en cours' : 'Inscriptions ouvertes'}</span>
              : <span className="badge badge-neutral"><span className="badge-dot" />Tirage effectué</span>}
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-3 border-t border-slate-100 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
            <Fait libelle={ouverte ? 'Tirage au sort' : 'Tirage effectué'}>
              <p className="text-base font-semibold text-slate-900">
                {ouverte ? dateTirage(courante.tirage_le) : dateTirage(courante.tiree_le)}
              </p>
              <p className="text-sm text-slate-600">
                {ouverte ? (dansCombien(courante.tirage_le) || 'Le résultat arrive dans la minute') : `Par ${courante.tiree_par || 'le logiciel'}`}
              </p>
            </Fait>
            <Fait libelle="Participants">
              <p className="kpi-value">{ouverte ? courante.participants : (courante.participants_au_tirage ?? courante.participants)}</p>
            </Fait>
            <Fait libelle={courante.lots.length > 1 ? 'Lots à gagner' : 'Lot à gagner'}>
              <Lots lots={courante.lots} />
            </Fait>
          </dl>

          {!ouverte && (
            <div className="border-t border-slate-100">
              <h3 className="px-4 sm:px-5 pt-4 t-h3">
                {gagnantsActifs.length ? `${pluriel(gagnantsActifs.length, 'gagnant')}${aPrevenir ? `, ${aPrevenir} à prévenir` : ''}` : 'Aucun gagnant'}
              </h3>
              {gagnantsActifs.length === 0 && (
                <p className="px-4 sm:px-5 py-3 t-body">Personne n’était inscrit au moment du tirage.</p>
              )}
              <ul aria-label="Gagnants" className="divide-y divide-slate-100">
                {courante.gagnants.map((g) => (
                  <Gagnant key={g.id} gagnant={g} boutique={boutique} occupe={occupe} onSuivi={suivre} onRemplacer={remplacer} />
                ))}
              </ul>
            </div>
          )}

          <div className="card-footer flex-wrap justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {ouverte && (
                <Link to={`${basePath}/tombola/affiche`} className="btn-secondary btn-sm">
                  <Printer aria-hidden="true" /> Affiche
                </Link>
              )}
              <button type="button" onClick={() => setFenetre('reglement')} className="btn-ghost btn-sm">Règlement</button>
              {ouverte && !heureDuTirage && (
                <button type="button" onClick={() => setFenetre('modifier')} className="btn-ghost btn-sm">Modifier</button>
              )}
            </div>
            {ouverte && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={occupe} onClick={annuler} className="btn-danger-ghost btn-sm">Annuler la tombola</button>
                <button type="button" disabled={occupe} onClick={tirerMaintenant} className="btn-secondary btn-sm">Tirer au sort maintenant</button>
              </div>
            )}
          </div>
        </section>
      )}

      {ouverte && (
        <section aria-labelledby="tombola-participants" className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 id="tombola-participants" className="t-h2">Participants</h2>
            {(liste?.length || 0) > 8 && (
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                <label htmlFor="tombola-recherche" className="sr-only">Chercher un participant</label>
                <input id="tombola-recherche" type="search" className="input pl-9" placeholder="Nom ou numéro" value={recherche}
                  onChange={(e) => setRecherche(e.target.value)} />
              </div>
            )}
          </div>
          {liste === null ? (
            <div className="skeleton h-40" role="status" aria-label="Chargement des participants" />
          ) : liste.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <h3 className="t-h2">Personne n’est encore inscrit</h3>
                <p className="t-body max-w-md">
                  Les clients s’inscrivent en cochant la case au moment de déposer leur appareil. Vous pouvez aussi
                  inscrire quelqu’un qui ne dépose rien.
                </p>
              </div>
            </div>
          ) : filtres.length === 0 ? (
            <p className="t-body py-6 text-center">Aucun participant ne correspond à « {recherche.trim()} ».</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th scope="col" className="table-header">Participant</th>
                    <th scope="col" className="table-header">Téléphone</th>
                    <th scope="col" className="table-header">Inscrit le</th>
                    <th scope="col" className="table-header">Par</th>
                    <th scope="col" className="table-header"><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtres.map((p) => (
                    <tr key={p.id} className="table-row">
                      <td className="font-medium text-slate-900 [overflow-wrap:anywhere]">{nomComplet(p)}</td>
                      <td className="tabular-nums whitespace-nowrap">{formatTel(p.telephone) || '—'}</td>
                      <td className="tabular-nums whitespace-nowrap">{dateCourte(p.inscrit_le)}</td>
                      <td className="whitespace-nowrap">
                        {SOURCES[p.source] || '—'}{p.inscrit_par ? <span className="text-slate-600"> · {p.inscrit_par}</span> : null}
                      </td>
                      <td className="text-right">
                        <button type="button" onClick={() => retirer(p)} className="btn-ghost btn-icon btn-sm"
                          aria-label={`Retirer ${nomComplet(p)} de la tombola`} title="Retirer de la tombola">
                          <Trash2 aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!chargement && !etat.erreur && (
        <section aria-labelledby="tombola-regles" className="mt-8">
          <h2 id="tombola-regles" className="t-h2 mb-3">Les règles que le logiciel fait respecter</h2>
          <ul className="card card-body space-y-2">
            {REGLES.map((r) => (
              <li key={r} className="t-body flex gap-2"><span aria-hidden="true" className="text-slate-500">—</span><span>{r}</span></li>
            ))}
          </ul>
        </section>
      )}

      {precedentes.length > 0 && (
        <section aria-labelledby="tombola-precedentes" className="mt-8">
          <h2 id="tombola-precedentes" className="t-h2 mb-3">Tombolas précédentes</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr className="border-b border-slate-200">
                  <th scope="col" className="table-header">Tombola</th>
                  <th scope="col" className="table-header">Tirage</th>
                  <th scope="col" className="table-header text-right">Participants</th>
                  <th scope="col" className="table-header">Gagnants</th>
                </tr>
              </thead>
              <tbody>
                {precedentes.map((t) => {
                  const gagnants = (t.gagnants || []).filter((g) => !g.remplace_le);
                  return (
                    <tr key={t.id} className="table-row">
                      <td className="font-medium text-slate-900 [overflow-wrap:anywhere]">{t.titre}</td>
                      <td className="tabular-nums whitespace-nowrap">
                        {t.statut === 'annulee' ? 'Annulée' : dateCourte(t.tiree_le || t.tirage_le)}
                      </td>
                      <td className="table-cell-num">{t.statut === 'annulee' ? '—' : (t.participants_au_tirage ?? t.participants)}</td>
                      <td className="[overflow-wrap:anywhere]">
                        {gagnants.length ? gagnants.map((g) => nomComplet(g)).join(', ') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(fenetre === 'creer' || fenetre === 'modifier') && (
        <FormulaireTombola tombola={fenetre === 'modifier' ? ouverte : null} sensible={sensible}
          onClose={() => setFenetre(null)}
          onEnregistre={() => { setFenetre(null); charger(); }} />
      )}
      {fenetre === 'participant' && ouverte && (
        <FormulaireParticipant tombola={ouverte} onClose={() => setFenetre(null)}
          onInscrit={() => { setFenetre(null); charger(); }} />
      )}
      <ReglementTombola open={fenetre === 'reglement'} onClose={() => setFenetre(null)} tombola={courante} />
      {confirmation.dialog}
      {adminPrompt}
    </div>
  );
}
