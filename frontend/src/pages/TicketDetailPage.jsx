import { useState, useEffect, useCallback, useRef, useId } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import { envoyerSms } from '../lib/sms';
import { useSmsServeur } from '../hooks/useSmsServeur';
import { invalidateCache } from '../hooks/useApi';
import { useAutoSave } from '../hooks/useAutoSave';
import StatusBadge from '../components/StatusBadge';
import ProgressTracker from '../components/ProgressTracker';
import FideliteCard from '../components/FideliteCard';
import PatternGrid from '../components/PatternGrid';
import PrintDrawer from '../components/PrintDrawer';
import MessageComposer from '../components/MessageComposer';
import RepairTimer from '../components/RepairTimer';
import LiveCountdown from '../components/LiveCountdown';
import RepairQueue from '../components/RepairQueue';
import PersonnaliserPanel from '../components/PersonnaliserPanel';
import AutocompleteField from '../components/AutocompleteField';
import ModelCombobox from '../components/ModelCombobox';
import { useCatalog } from '../hooks/useCatalog';
import { MARQUE_AUTRE } from '../lib/catalog';
import {
  chargerPrestations, cataloguePrestations, lignesFiche, libelleCourt, rattachementCommandes,
  formatJson, indexLigneEcran, prixNombre,
} from '../lib/prestations';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { formatDate, formatPrix, STATUTS, waLink, smsLink, getStatusConfig } from '../lib/utils';
import { useToast } from '../components/Toast';
import {
  ArrowLeft, Phone, Mail, MessageCircle, Send, Trash2,
  ChevronDown, Plus, User, Wrench, Package,
  FileText, Printer, Lock, Eye, Copy, Check,
  AlertTriangle, Smartphone, Shield, Calendar, Clock,
  Zap, Edit3, X, CheckCircle2, Sparkles,
  Flag, PhoneCall, Percent, RotateCcw, Globe, Star, ExternalLink, History, PackageCheck,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

const ANIM_ENTREE = 'motion-safe:animate-[fadeIn_0.3s_ease-out_forwards]';
const STATUTS_REMISE = new Set(['Rendu au client', 'Clôturé']);
const SOURCES_MONTANTS = new Set(['devis_estime', 'acompte', 'reduction_montant', 'reduction_pourcentage']);
const CHAMPS_CLIENT = {
  nom: 'client_nom', prenom: 'client_prenom', telephone: 'client_tel', email: 'client_email', societe: 'client_societe',
};
const MODES_PAIEMENT = ['CB', 'Espèces', 'Chèque', 'Virement', 'Autre'];
const GARANTIE_MOIS = 6;
// URL de suivi tapée par la douchette dans le champ qui avait le focus au moment du scan
const TEXTE_SCANNE = /[?&]ticket=[A-Z0-9%-]{3,}/i;
const MOTIF_REFUS = '❌ Devis refusé par le client (au comptoir)';
// Émis par QuickScanPanel (chargé à part : pas d'import, juste le nom de l'événement)
const EVENT_TICKET_MAJ = 'kp:ticket-updated';
const BON_REDUCTION = 10;
// Termes appris par l'autocomplétion, en fin de saisie seulement (jamais les fragments « batt »)
const CHAMPS_APPRIS = { panne: 'panne', panne_detail: 'detail_panne', modele_autre: 'modele_custom' };

// ─── Données ↔ formulaires ─────────────────────────────────────
function formulaireAppareil(d) {
  return {
    categorie: d.categorie || '', marque: d.marque || '', modele: d.modele || '',
    modele_autre: d.modele_autre || '', imei: d.imei || '', panne: d.panne || '',
    panne_detail: d.panne_detail || '', pin: d.pin || '', pattern: d.pattern || '',
    notes_client: d.notes_client || '',
  };
}

function formulaireClient(d) {
  return {
    nom: d.client_nom || '', prenom: d.client_prenom || '', telephone: d.client_tel || '',
    email: d.client_email || '', societe: d.client_societe || '',
  };
}

function formulaireTarif(d) {
  return {
    devis_estime: d.devis_estime || '', acompte: d.acompte || '', type_ecran: d.type_ecran || '',
    date_recuperation: d.date_recuperation || '', reduction_montant: d.reduction_montant || '',
    reduction_pourcentage: d.reduction_pourcentage || '', type_document: d.type_document || 'devis',
  };
}

function modeReduction(d) {
  return parseFloat(d.reduction_montant) > 0 && !(parseFloat(d.reduction_pourcentage) > 0) ? 'eur' : 'pct';
}

// Seules les lignes avec une description sont imprimées : ce sont aussi les seules comptées
function lignesComptees(lignes) {
  return (lignes || []).filter(l => String(l?.label ?? '').trim());
}

function calculMontants(form, lignes, mode) {
  const somme = lignesComptees(lignes).reduce((s, l) => s + prixNombre(l.prix), 0);
  const devis = prixNombre(form.devis_estime);
  const surDevis = somme === 0 && devis > 0;
  const base = surDevis ? devis : somme;
  const pct = prixNombre(form.reduction_pourcentage);
  const eur = prixNombre(form.reduction_montant);
  const reduction = mode === 'pct' ? base * (pct / 100) : eur;
  return { somme, devis, surDevis, base, pct, eur, reduction, acompte: prixNombre(form.acompte) };
}

/**
 * Champs à envoyer pour une modification de la section tarifs (PATCH partiel).
 * `changes` contient les champs touchés (+ marqueurs `lignes` / `mode`) ; les montants
 * dérivés ne partent que si les lignes, la réduction, l'acompte ou le devis estimé changent.
 */
function patchTarif(form, lignes, mode, changes, paye) {
  const patch = {};
  let derive = false;
  for (const [k, v] of Object.entries(changes)) {
    if (k === 'lignes' || k === 'mode' || SOURCES_MONTANTS.has(k)) { derive = true; continue; }
    patch[k] = v;
  }
  if (!derive) return patch;
  const m = calculMontants(form, lignes, mode);
  const net = Math.max(0, m.base - m.reduction);
  const reste = Math.max(0, net - m.acompte);
  Object.assign(patch, {
    reparation_supp: JSON.stringify(lignesComptees(lignes).map(l => ({ label: String(l.label).trim(), prix: prixNombre(l.prix) }))),
    prix_supp: m.somme,
    devis_estime: m.devis,
    tarif_final: net,
    acompte: m.acompte,
    reduction_pourcentage: mode === 'pct' ? m.pct : 0,
    reduction_montant: mode === 'eur' ? m.eur : 0,
  });
  // Un ticket déjà payé garde son statut de paiement ; « Payé » n'existe qu'avec paye=1
  // (statut_paiement() côté serveur), même si l'acompte couvre tout
  if (!paye) {
    patch.reste_a_payer = reste;
    patch.statut_paiement = m.acompte > 0 ? 'Acompte versé' : 'Non payé';
  }
  return patch;
}

function sansTexteScanne(patch, reference) {
  const propre = {};
  const rejetes = [];
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === 'string' && TEXTE_SCANNE.test(v) && !TEXTE_SCANNE.test(String(reference?.[k] ?? ''))) rejetes.push(k);
    else propre[k] = v;
  }
  return { propre, rejetes };
}

function restaurerChamps(form, enregistre, cles) {
  const next = { ...form };
  for (const k of cles) if (TEXTE_SCANNE.test(String(next[k] ?? ''))) next[k] = enregistre?.[k] ?? '';
  return next;
}

// date_cloture est du TEXTE : comparaison de chaînes AAAA-MM-JJ, jamais de timestamp
function finGarantie(dateCloture) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateCloture || ''));
  if (!m) return null;
  const fin = new Date(Number(m[1]), Number(m[2]) - 1 + GARANTIE_MOIS, Number(m[3]));
  const iso = `${fin.getFullYear()}-${String(fin.getMonth() + 1).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`;
  return { iso, texte: `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` };
}

function aujourdhuiIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Auto-save status indicator ────────────────────────────────
function AutoSaveIndicator({ etat }) {
  const status = etat?.status;
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-[11px] font-medium">
      {status === 'dirty' && (
        <><span className="w-2 h-2 rounded-full bg-slate-400" aria-hidden="true" /><span className="text-slate-600">Modifié…</span></>
      )}
      {status === 'saving' && (
        <><span className="w-3 h-3 border-2 border-amber-600 border-t-transparent rounded-full motion-safe:animate-spin" aria-hidden="true" /><span className="text-amber-800">Enregistrement…</span></>
      )}
      {status === 'saved' && <span className="text-emerald-700">Enregistré ✓</span>}
      {status === 'error' && (
        <>
          <AlertTriangle className="w-3.5 h-3.5 text-red-600" aria-hidden="true" />
          <span className="text-red-700">Non enregistré</span>
          <button
            type="button"
            onClick={() => etat.retry().catch(() => {})}
            className="ml-1 inline-flex items-center gap-1 min-h-11 px-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-bold hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Réessayer
          </button>
        </>
      )}
    </span>
  );
}

function afficherIndicateur(editing, etat) {
  return editing || (!!etat?.status && etat.status !== 'saved');
}

// ─── Editable Section Component ────────────────────────────────
function EditableSection({ title, icon: Icon, iconBg, iconColor, editing, onEdit, onClose, children, viewContent, autoSave }) {
  const titreId = useId();
  return (
    <section className="card p-5" aria-labelledby={titreId}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}>
            <Icon className={`w-4 h-4 ${iconColor}`} aria-hidden="true" />
          </div>
          <h2 id={titreId} className="text-sm font-semibold text-slate-800">{title}</h2>
          {afficherIndicateur(editing, autoSave) && <AutoSaveIndicator etat={autoSave} />}
        </div>
        {editing ? (
          <button type="button" onClick={onClose} className="btn-ghost text-xs px-3 min-h-11 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <X className="w-3.5 h-3.5" aria-hidden="true" /> Fermer
          </button>
        ) : (
          <button type="button" onClick={onEdit} className="btn-ghost p-0 min-w-11 min-h-11 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" title="Modifier" aria-label={`Modifier ${title}`}>
            <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {editing ? children : viewContent}
    </section>
  );
}

// ─── Modale accessible (Échap, focus piégé puis rendu à l'élément d'origine) ─────
function Modal({ labelledBy, onClose, busy = false, panelClassName = 'max-w-md p-6', children }) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const precedent = document.activeElement;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!busyRef.current) closeRef.current?.();
      } else if (e.key === 'Tab' && panel) {
        const focusables = [...panel.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
        if (focusables.length === 0) return;
        const premier = focusables[0];
        const dernier = focusables[focusables.length - 1];
        if (e.shiftKey && (document.activeElement === premier || document.activeElement === panel)) { e.preventDefault(); dernier.focus(); }
        else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (precedent && typeof precedent.focus === 'function' && document.contains(precedent)) precedent.focus();
    };
  }, []);

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          tabIndex={-1}
          className={`bg-white rounded-2xl shadow-2xl w-full max-h-[90vh] overflow-y-auto focus:outline-none ${ANIM_ENTREE} ${panelClassName}`}
        >
          {children}
        </div>
      </div>
    </>
  );
}

// ─── Avantages client (bon de grattage, réduction fidélité) ─────
function avantagesDisponibles(fidelite) {
  return {
    bon: fidelite?.bon_grattage === 'reduction' ? BON_REDUCTION : 0,
    fidelite: fidelite?.recompenses_disponibles?.reduction ? (parseFloat(fidelite?.montant_reduction || 10) || 0) : 0,
  };
}

function montantAvantages(fidelite, choix, plafond) {
  const d = avantagesDisponibles(fidelite);
  const total = (choix.bon ? d.bon : 0) + (choix.fidelite ? d.fidelite : 0);
  return Math.round(Math.min(Math.max(0, plafond), total) * 100) / 100;
}

// ─── Remise au client (POST /restitution) ──────────────────────
// `reste` : reste dû du ticket (serveur), avantages déjà écrits en réduction compris ;
// `dejaApplique` : montant de ces avantages (tentative précédente dans cette modale).
function RestitutionModal({ ticket, reste, dejaApplique = 0, fidelite, devisRefuse = false, onClose, onConfirm }) {
  const titreId = useId();
  const motifId = useId();
  const modeId = useId();
  const motifRef = useRef(null);
  const resteDu = Math.max(0, Number(reste) || 0);
  const resteAvant = Math.round((resteDu + (Number(dejaApplique) || 0)) * 100) / 100;
  const [choixPaiement, setPaiement] = useState(resteAvant > 0 ? 'encaisser' : 'deja_paye');
  // « Déjà payé » avec un reste dû est toujours refusé (409) : un règlement en caisse s'encaisse
  const paiement = resteAvant > 0 ? (choixPaiement === 'deja_paye' ? 'encaisser' : choixPaiement) : 'deja_paye';
  const [mode, setMode] = useState('CB');
  const [motif, setMotif] = useState('');
  const [pretOk, setPretOk] = useState(false);
  const [confirmeNT, setConfirmeNT] = useState(false);
  const [bon, setBon] = useState(false);
  const [fid, setFid] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const envoiRef = useRef(false);
  const [erreur, setErreur] = useState(null);

  const pretEnCours = (!!ticket.telephone_pret && !ticket.telephone_pret_rendu) || erreur?.code === 'pret_non_restitue';
  const nonTermine = ticket.statut !== 'Réparation terminée' || erreur?.code === 'non_termine';
  const dispo = avantagesDisponibles(fidelite);
  const bonMontant = dispo.bon;
  const fideliteDispo = dispo.fidelite > 0;
  const fideliteMontant = dispo.fidelite;
  const avecAvantages = paiement === 'encaisser' && resteAvant > 0;
  const choix = { bon: avecAvantages && bon && bonMontant > 0, fidelite: avecAvantages && fid && fideliteDispo };
  const reduction = montantAvantages(fidelite, choix, resteAvant);
  const montant = Math.round(Math.max(0, resteAvant - reduction) * 100) / 100;
  const motifManquant = paiement === 'non_paye' && motif.trim().length < 3;
  const bloque = envoi || (pretEnCours && !pretOk) || (nonTermine && !confirmeNT) || motifManquant;

  const confirmer = async () => {
    // Verrou synchrone : deux clics dans le même instant ne partent qu'une fois
    if (bloque || envoiRef.current) return;
    envoiRef.current = true;
    setEnvoi(true);
    setErreur(null);
    // montant = ce que le client paie : les avantages sont écrits en réduction sur le ticket
    // avant la remise, le serveur refuse (409 reste_a_payer) s'il calcule autre chose.
    const body = {
      paiement,
      mode_paiement: paiement === 'encaisser' ? mode : null,
      montant: paiement === 'encaisser' ? montant : null,
      motif_non_paye: paiement === 'non_paye' ? motif.trim() : null,
      pret_restitue: pretEnCours ? pretOk : null,
      confirmer_non_termine: nonTermine ? confirmeNT : false,
    };
    try {
      await onConfirm(body, { ...choix, montant: reduction });
    } catch (err) {
      const d = err?.data && typeof err.data === 'object' && !Array.isArray(err.data) ? err.data : null;
      setErreur({ code: d?.code || null, message: err?.message || 'Remise impossible' });
      if (d?.code === 'reste_a_payer') {
        // La fiche relit le ticket : `reste` devient celui du serveur
        setPaiement('encaisser');
      } else if (d?.code === 'pret_non_restitue') {
        setPretOk(false);
      } else if (d?.code === 'non_termine') {
        setConfirmeNT(false);
      } else if (d?.code === 'motif_requis') {
        setPaiement('non_paye');
        setTimeout(() => motifRef.current?.focus(), 0);
      }
      envoiRef.current = false;
      setEnvoi(false);
    }
  };

  const optionPaiement = (valeur, titre, detail) => (
    <label className={`flex items-start gap-3 p-3 min-h-11 rounded-xl border-2 cursor-pointer transition-colors ${paiement === valeur ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}>
      <input type="radio" name={`${titreId}-paiement`} value={valeur} checked={paiement === valeur}
        onChange={() => setPaiement(valeur)} className="mt-0.5 w-5 h-5 accent-emerald-600 shrink-0" />
      <span className="text-sm">
        <span className="block font-semibold text-slate-900">{titre}</span>
        {detail && <span className="block text-xs text-slate-600">{detail}</span>}
      </span>
    </label>
  );

  return (
    <Modal labelledBy={titreId} onClose={onClose} busy={envoi} panelClassName="max-w-lg p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
          <PackageCheck className="w-5 h-5 text-emerald-700" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 id={titreId} className="text-lg font-display font-bold text-slate-900">Rendre au client</h3>
          <p className="text-sm text-slate-600 truncate">
            <span className="font-mono font-semibold">{ticket.ticket_code}</span> — {ticket.client_prenom || ''} {ticket.client_nom || ''}
          </p>
        </div>
        <button type="button" onClick={onClose} disabled={envoi} className="ml-auto btn-ghost p-0 min-w-11 min-h-11 shrink-0" aria-label="Fermer">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-4">
        {nonTermine && (
          <div className={`p-3 rounded-xl border ${erreur?.code === 'non_termine' ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
            <p className="text-sm font-semibold text-amber-900">
              Réparation non terminée (statut : {ticket.statut})
            </p>
            <label className="mt-2 flex items-start gap-2.5 min-h-11 cursor-pointer">
              <input type="checkbox" checked={confirmeNT} onChange={e => setConfirmeNT(e.target.checked)} className="mt-0.5 w-5 h-5 accent-amber-600 shrink-0" />
              <span className="text-sm text-amber-900">Je confirme rendre l'appareil en l'état (devis refusé, non réparable, reprise par le client…)</span>
            </label>
          </div>
        )}

        {pretEnCours && (
          <div className={`p-3 rounded-xl border ${erreur?.code === 'pret_non_restitue' ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
            <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
              <PhoneCall className="w-4 h-4" aria-hidden="true" /> Téléphone de prêt : {ticket.telephone_pret || 'à récupérer'}
            </p>
            {ticket.telephone_pret_imei && <p className="text-xs text-amber-800 font-mono mt-1">IMEI : {ticket.telephone_pret_imei}</p>}
            <label className="mt-2 flex items-start gap-2.5 min-h-11 cursor-pointer">
              <input type="checkbox" checked={pretOk} onChange={e => setPretOk(e.target.checked)} className="mt-0.5 w-5 h-5 accent-amber-600 shrink-0" />
              <span className="text-sm text-amber-900">Téléphone de prêt récupéré et vérifié</span>
            </label>
          </div>
        )}

        {devisRefuse && (ticket.montants?.refus_devis || resteAvant > 0) && (
          <p className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-700">
            {ticket.montants?.refus_devis
              ? 'Devis refusé : la réparation n’est pas facturée, seuls les frais (diagnostic…) restent dus.'
              : 'Devis refusé : si rien n’est facturé, passez les lignes et le devis estimé à 0 € (ou au seul diagnostic) dans « Réparation & Tarifs » avant la remise.'}
          </p>
        )}

        {resteAvant > 0 ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-slate-800 mb-2">
              Reste à payer : <span className="text-red-700 text-base font-extrabold">{formatPrix(resteAvant)}</span>
            </legend>
            {optionPaiement('encaisser', 'Encaisser maintenant', reduction > 0
              ? `${formatPrix(montant)} à encaisser après ${formatPrix(reduction)} d'avantages`
              : 'Déjà réglé en caisse ou à distance : indiquez le mode utilisé')}
            {paiement === 'encaisser' && (
              <div className="pl-3 space-y-3">
                <div>
                  <label htmlFor={modeId} className="input-label">Mode de paiement</label>
                  <select id={modeId} value={mode} onChange={e => setMode(e.target.value)} className="input min-h-11">
                    {MODES_PAIEMENT.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                {(bonMontant > 0 || fidelite?.bon_grattage === 'film' || fideliteDispo) && (
                  <div className="rounded-xl border-2 border-amber-200 bg-amber-50/70 p-3 space-y-1">
                    <p className="text-[11px] uppercase tracking-wider text-amber-800 font-bold flex items-center gap-1.5">
                      <Star className="w-3 h-3 fill-amber-500 text-amber-500" aria-hidden="true" /> Avantages client
                    </p>
                    {bonMontant > 0 && (
                      <label className="flex items-center gap-2.5 min-h-11 cursor-pointer">
                        <input type="checkbox" checked={bon} onChange={e => setBon(e.target.checked)} className="w-5 h-5 accent-amber-600" />
                        <span className="text-sm text-slate-800">Bon de grattage : −{formatPrix(bonMontant)}</span>
                      </label>
                    )}
                    {fidelite?.bon_grattage === 'film' && (
                      <p className="text-sm text-slate-800 flex items-center gap-2 min-h-11"><Check className="w-4 h-4 text-amber-700" aria-hidden="true" /> Film verre trempé offert à remettre</p>
                    )}
                    {fideliteDispo && (
                      <label className="flex items-center gap-2.5 min-h-11 cursor-pointer">
                        <input type="checkbox" checked={fid} onChange={e => setFid(e.target.checked)} className="w-5 h-5 accent-amber-600" />
                        <span className="text-sm text-slate-800">Fidélité : −{formatPrix(fideliteMontant)} ({fidelite.points} points)</span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}
            {optionPaiement('non_paye', 'Non payé', 'Le client règlera plus tard')}
            {paiement === 'non_paye' && (
              <div className="pl-3">
                <label htmlFor={motifId} className="input-label">Motif (obligatoire)</label>
                <textarea id={motifId} ref={motifRef} value={motif} onChange={e => setMotif(e.target.value)} rows={2}
                  aria-required="true" aria-invalid={motifManquant && erreur?.code === 'motif_requis' ? true : undefined}
                  className="input resize-none" placeholder="Ex : règle demain, paiement en attente…" />
              </div>
            )}
          </fieldset>
        ) : (
          <p className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm font-semibold text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {ticket.paye ? 'Déjà payé' : 'Rien à encaisser'}
          </p>
        )}

        {erreur && (
          <p role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 flex gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /> {erreur.message}
          </p>
        )}
      </div>

      <div className="flex gap-2 mt-6">
        <button type="button" onClick={onClose} disabled={envoi} className="btn-ghost flex-1 min-h-12">Annuler</button>
        <button
          type="button"
          onClick={confirmer}
          disabled={bloque}
          aria-busy={envoi || undefined}
          className="flex-[2] min-h-12 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2"
        >
          {envoi
            ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full motion-safe:animate-spin" aria-hidden="true" /> Enregistrement…</>
            : <><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Confirmer la remise</>}
        </button>
      </div>
    </Modal>
  );
}

// ─── Layout Config ────────────────────────────────────────────
const DEFAULT_LAYOUT = {
  left: ['client', 'device', 'dates', 'messages', 'notes'],
  right: ['reparation', 'status', 'queue', 'fidelite'],
};
const ALL_WIDGET_IDS = new Set([...DEFAULT_LAYOUT.left, ...DEFAULT_LAYOUT.right]);

export default function TicketDetailPage() {
  const { id } = useParams();
  // Une instance par ticket : modales, enregistrements en attente et chargements
  // ne passent jamais d'un ticket à l'autre (scan, file d'attente, retour SAV).
  return <TicketDetail key={id} id={id} />;
}

function TicketDetail({ id }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const { actif: smsServeur } = useSmsServeur();
  const reduireAnimations = useReducedMotion();
  const uid = useId();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';
  const isTech = user?.target === 'tech';

  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [prestations, setPrestations] = useState(() => cataloguePrestations());
  // Fidelite & bon grattage du client (chargés à l'ouverture du paiement ou de la remise)
  const [clientFidelite, setClientFidelite] = useState(null);
  const [applyBonGrattage, setApplyBonGrattage] = useState(false);
  const [applyFidelite, setApplyFidelite] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [notePrivate, setNotePrivate] = useState(true);
  const [copied, setCopied] = useState(false);

  // Edit states per section
  const [editingDevice, setEditingDevice] = useState(false);
  const [editingClient, setEditingClient] = useState(false);
  const [editingPricing, setEditingPricing] = useState(false);

  // Formulaires (source de vérité pendant l'édition, jamais écrasés par une réponse serveur)
  const [deviceForm, setDeviceForm] = useState({});
  const [clientForm, setClientForm] = useState({});
  const [pricingForm, setPricingForm] = useState({});
  const [repairLines, setRepairLines] = useState([]);
  const [reductionMode, setReductionMode] = useState('pct');
  // Catégorie/marque enregistrées (déjà débouncées par l'auto-save) : pas de requête à chaque frappe
  const catalogueAppareil = useCatalog(editingDevice ? (ticket?.categorie || null) : null, ticket?.marque || '');

  const [showPrintDrawer, setShowPrintDrawer] = useState(false);

  // Accord client modal state
  const [showAccordModal, setShowAccordModal] = useState(false);
  const [accordLoading, setAccordLoading] = useState(false);
  const [accordMessage, setAccordMessage] = useState('');
  const [accordTemplateMsg, setAccordTemplateMsg] = useState(null);

  const [teamMembers, setTeamMembers] = useState([]);
  const [showAttention, setShowAttention] = useState(false);
  const [tvaRate, setTvaRate] = useState(0);

  // Notes privées
  const [privateNotes, setPrivateNotes] = useState([]);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNoteImportant, setNewNoteImportant] = useState(false);

  // Remise au client : { cible } ; paiement : { cloturer }
  const [restitution, setRestitution] = useState(null);
  const [paiement, setPaiement] = useState(null);
  const [paying, setPaying] = useState(false);
  const [statutEnCours, setStatutEnCours] = useState(false);
  const [envoiCaisse, setEnvoiCaisse] = useState(false);
  // Avantages client écrits en réduction sur le ticket, pas encore débités (montant en €)
  const [avantagesAppliques, setAvantagesAppliques] = useState(0);

  // Layout (DnD)
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [editMode, setEditMode] = useState(false);

  // Widget preferences + panels
  const [widgetPrefs, setWidgetPrefs] = useState({ timer: true, countdown: true, queue: true });
  const [showPersonnaliser, setShowPersonnaliser] = useState(false);
  const [autocompletionEnabled, setAutocompletionEnabled] = useState(true);

  // Commandes de pièces (libellés en cours de création/suppression : garde anti double clic)
  const [commandes, setCommandes] = useState([]);
  const [commandesEnCours, setCommandesEnCours] = useState(() => new Set());
  const commandesEnCoursRef = useRef(new Set());

  // Autres réparations du même client
  const [autresTickets, setAutresTickets] = useState(null);

  // Delete ticket modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteCode, setDeleteCode] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const [caisseEnabled, setCaisseEnabled] = useState(false);

  // Retour SAV modal
  const [showRetourSAVModal, setShowRetourSAVModal] = useState(false);
  const [retourSAVForm, setRetourSAVForm] = useState({ panne: '', panne_detail: '' });
  const [creatingSAV, setCreatingSAV] = useState(false);

  // Dernières valeurs connues, lues par les gestionnaires d'événements (pas de closure périmée)
  const mountedRef = useRef(true);
  const ticketRef = useRef(null);
  const prestationsRef = useRef(prestations);
  const deviceFormRef = useRef({});
  const clientFormRef = useRef({});
  const pricingFormRef = useRef({});
  const repairLinesRef = useRef([]);
  const reductionModeRef = useRef('pct');
  const clientIdRef = useRef(null);
  const enregistreRef = useRef({ device: {}, client: {} });
  const savesRef = useRef({});
  const loadSeqRef = useRef(0);
  const fideliteDemandeeRef = useRef(false);
  const apprendreRef = useRef(false);
  const apprisRef = useRef({});
  // { bon, fidelite, montant, avant: { mode, reduction_montant, reduction_pourcentage } }
  const avantagesRef = useRef(null);
  // Une remise partie sans réponse (réseau) : un « déjà rendu » au réessai est la nôtre
  const remiseSansReponseRef = useRef(false);
  // Verrous synchrones des gestes d'argent et de statut (double clic)
  const verrousRef = useRef(new Set());
  const verrouiller = (cle) => {
    if (verrousRef.current.has(cle)) return false;
    verrousRef.current.add(cle);
    return true;
  };
  const deverrouiller = (cle) => { verrousRef.current.delete(cle); };

  const majDeviceForm = (f) => { deviceFormRef.current = f; setDeviceForm(f); };
  const majClientForm = (f) => { clientFormRef.current = f; setClientForm(f); };
  const majPricingForm = (f) => { pricingFormRef.current = f; setPricingForm(f); };
  const majRepairLines = (l) => { repairLinesRef.current = l; setRepairLines(l); };
  const majMode = (m) => { reductionModeRef.current = m; setReductionMode(m); };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Clés non confirmées par le serveur : une réponse ne doit pas les écraser dans `ticket`
  const clesEnAttente = useCallback((courant) => {
    const cles = new Set();
    for (const [nom, s] of Object.entries(savesRef.current)) {
      if (!s) continue;
      for (const k of s.pendingKeys({ inflight: nom !== courant })) {
        cles.add(nom === 'client' ? (CHAMPS_CLIENT[k] || k) : k);
      }
    }
    return cles;
  }, []);

  // ticketRef est mis à jour tout de suite (pas dans un updater, exécuté au rendu suivant) :
  // un gestionnaire qui relit le ticket juste après un enregistrement voit la réponse du serveur
  const fusionnerTicket = useCallback((row, exclure) => {
    if (!row || !mountedRef.current) return;
    const prev = ticketRef.current;
    if (!prev) return;
    const next = { ...prev };
    for (const [k, v] of Object.entries(row)) if (!exclure?.has(k)) next[k] = v;
    ticketRef.current = next;
    setTicket(next);
  }, []);

  const invaliderListes = () => invalidateCache('tickets', 'dashboard', 'interactions');

  // ─── Enregistrement automatique (PATCH partiel, un envoi à la fois) ───
  const deviceSave = useAutoSave(useCallback(async (patch) => {
    const { propre, rejetes } = sansTexteScanne(patch, enregistreRef.current.device);
    if (rejetes.length && mountedRef.current) {
      majDeviceForm(restaurerChamps(deviceFormRef.current, enregistreRef.current.device, rejetes));
      toast.warning('Texte de la douchette ignoré : le champ a repris sa valeur enregistrée');
    }
    if (Object.keys(propre).length === 0) return null;
    const learn = apprendreRef.current && Object.keys(propre).some(k => k in CHAMPS_APPRIS);
    if (learn) apprendreRef.current = false;
    fusionnerTicket(propre, clesEnAttente('device'));
    const res = await api.updateTicket(id, propre, { learn });
    Object.assign(enregistreRef.current.device, propre);
    if (learn) {
      for (const k of Object.keys(CHAMPS_APPRIS)) if (k in propre) apprisRef.current[k] = String(propre[k] || '').trim();
    }
    fusionnerTicket(res.ticket, clesEnAttente('device'));
    // Sans lignes enregistrées, la ligne par défaut suit le symptôme (comme l'impression)
    if (res.ticket && ('panne' in propre || 'panne_detail' in propre) && !formatJson(res.ticket)
      && !savesRef.current.pricing?.hasPending() && mountedRef.current) {
      majRepairLines(lignesFiche(res.ticket, prestationsRef.current));
    }
    return res;
  }, [id, toast, fusionnerTicket, clesEnAttente]), {
    delay: 800,
    onUnload: (patch) => {
      const { propre } = sansTexteScanne(patch, enregistreRef.current.device);
      const learn = Object.keys(propre).some(k => k in CHAMPS_APPRIS);
      if (Object.keys(propre).length) api.updateTicket(id, propre, { keepalive: true, learn }).then(invaliderListes);
    },
    onError: () => toast.error('Appareil non enregistré : vérifiez la connexion puis « Réessayer »'),
  });

  const clientSave = useAutoSave(useCallback(async (patch) => {
    const clientId = clientIdRef.current;
    if (!clientId) throw new Error('Client introuvable');
    const { propre, rejetes } = sansTexteScanne(patch, enregistreRef.current.client);
    if (rejetes.length && mountedRef.current) {
      majClientForm(restaurerChamps(clientFormRef.current, enregistreRef.current.client, rejetes));
      toast.warning('Texte de la douchette ignoré : le champ a repris sa valeur enregistrée');
    }
    if (Object.keys(propre).length === 0) return null;
    const vue = {};
    for (const [k, v] of Object.entries(propre)) vue[CHAMPS_CLIENT[k] || k] = v;
    fusionnerTicket(vue, clesEnAttente('client'));
    const res = await api.updateClient(clientId, propre);
    Object.assign(enregistreRef.current.client, propre);
    invalidateCache('clients');
    return res;
  }, [toast, fusionnerTicket, clesEnAttente]), {
    delay: 800,
    onUnload: (patch) => {
      const clientId = clientIdRef.current;
      const { propre } = sansTexteScanne(patch, enregistreRef.current.client);
      if (clientId && Object.keys(propre).length) api.patchKeepalive(`/api/clients/${clientId}`, propre).then(() => invalidateCache('clients', 'tickets', 'dashboard'));
    },
    onError: () => toast.error('Client non enregistré : vérifiez la connexion puis « Réessayer »'),
  });

  const pricingSave = useAutoSave(useCallback(async (patch) => {
    const { propre, rejetes } = sansTexteScanne(patch, null);
    if (rejetes.length && mountedRef.current) toast.warning('Texte de la douchette ignoré dans les lignes : corrigez la description');
    if (Object.keys(propre).length === 0) return null;
    const res = await api.updateTicket(id, propre);
    fusionnerTicket(res.ticket, clesEnAttente('pricing'));
    return res;
  }, [id, toast, fusionnerTicket, clesEnAttente]), {
    delay: 500,
    onUnload: (patch) => {
      const { propre } = sansTexteScanne(patch, null);
      if (Object.keys(propre).length) api.updateTicket(id, propre, { keepalive: true }).then(invaliderListes);
    },
    onError: () => toast.error('Prix non enregistrés : vérifiez la connexion puis « Réessayer »'),
  });

  savesRef.current = { device: deviceSave, client: clientSave, pricing: pricingSave };
  const flushDevice = deviceSave.flush;
  const flushClient = clientSave.flush;
  const flushPricing = pricingSave.flush;

  // Avant une impression, un changement de statut, la caisse ou la remise : tout doit être en base
  const toutEnregistrer = useCallback(async () => {
    const res = await Promise.allSettled([flushDevice(), flushClient(), flushPricing()]);
    const echec = res.find(r => r.status === 'rejected');
    if (echec) throw echec.reason || new Error('Enregistrement impossible');
  }, [flushDevice, flushClient, flushPricing]);

  // Les listes (dashboard, file d'attente) sont rafraîchies à la sortie de la fiche, pas à chaque frappe
  const listesPerimeesRef = useRef(false);
  useEffect(() => {
    if (deviceSave.status === 'saved' || pricingSave.status === 'saved' || clientSave.status === 'saved') listesPerimeesRef.current = true;
  }, [deviceSave.status, pricingSave.status, clientSave.status]);
  useEffect(() => () => {
    if (listesPerimeesRef.current) invalidateCache('tickets', 'dashboard', 'interactions', 'clients');
  }, []);
  // Sortie de la fiche avec une modale de paiement ouverte après un échec : la réduction
  // écrite pour des avantages jamais débités est retirée
  useEffect(() => () => {
    const a = avantagesRef.current;
    if (!a) return;
    avantagesRef.current = null;
    const changes = { reduction_montant: a.avant.reduction_montant, reduction_pourcentage: a.avant.reduction_pourcentage };
    const patch = patchTarif({ ...pricingFormRef.current, ...changes }, repairLinesRef.current, a.avant.mode,
      { ...changes, mode: true }, !!ticketRef.current?.paye);
    api.updateTicket(id, patch, { keepalive: true });
  }, [id]);

  // ─── Chargement ────────────────────────────────────────────────
  const appliquerTicket = useCallback((data, cat, { force = false } = {}) => {
    const saves = savesRef.current;
    const omis = force ? new Set() : clesEnAttente(null);
    const prev = ticketRef.current;
    const next = { ...data };
    if (prev) for (const k of omis) if (k in prev) next[k] = prev[k];
    ticketRef.current = next;
    setTicket(next);
    clientIdRef.current = data.client_id;
    if (force || !saves.device?.hasPending()) {
      const f = formulaireAppareil(data);
      majDeviceForm(f);
      enregistreRef.current.device = { ...f };
      if (force) apprisRef.current = { panne: f.panne.trim(), panne_detail: f.panne_detail.trim(), modele_autre: f.modele_autre.trim() };
    }
    if (force || !saves.client?.hasPending()) {
      const f = formulaireClient(data);
      majClientForm(f);
      enregistreRef.current.client = { ...f };
    }
    if (force || !saves.pricing?.hasPending()) {
      majPricingForm(formulaireTarif(data));
      majRepairLines(lignesFiche(data, cat));
      majMode(modeReduction(data));
    }
    setShowAttention(!!(data.attention || (data.notes_internes || '').includes('[ATTENTION]')));
  }, [clesEnAttente]);

  const loadTicket = useCallback(async (showSpinner = true) => {
    const seq = ++loadSeqRef.current;
    if (showSpinner) setLoading(true);
    try {
      const [data, cmds, notes, cat] = await Promise.all([
        api.getTicket(id),
        api.getPartsByTicket(id).catch(() => []),
        api.getNotes(id).catch(() => []),
        chargerPrestations(),
      ]);
      // Une réponse plus ancienne qu'une autre demande, ou arrivée après la sortie, est ignorée
      if (seq !== loadSeqRef.current || !mountedRef.current) return;
      prestationsRef.current = cat;
      setPrestations(cat);
      appliquerTicket(data, cat, { force: showSpinner });
      setCommandes(Array.isArray(cmds) ? cmds : []);
      setPrivateNotes(Array.isArray(notes) ? notes : []);
    } catch (err) {
      if (seq !== loadSeqRef.current || !mountedRef.current) return;
      console.error('[loadTicket]', err);
      if (showSpinner) { ticketRef.current = null; setTicket(null); }
    } finally {
      if (showSpinner && seq === loadSeqRef.current && mountedRef.current) setLoading(false);
    }
  }, [id, appliquerTicket]);

  useEffect(() => {
    loadTicket();
    api.markTicketRead(id).then(() => invalidateCache('interactions')).catch(() => {});
  }, [loadTicket, id]);

  // Remise, encaissement ou statut faits depuis le scan rapide sur ce ticket : la fiche se relit
  useEffect(() => {
    const onMaj = (e) => {
      if (String(e.detail?.id) === String(id)) loadTicket(false);
    };
    window.addEventListener(EVENT_TICKET_MAJ, onMaj);
    return () => window.removeEventListener(EVENT_TICKET_MAJ, onMaj);
  }, [id, loadTicket]);

  const loadNotes = useCallback(async () => {
    try {
      const data = await api.getNotes(id);
      if (mountedRef.current) setPrivateNotes(Array.isArray(data) ? data : []);
    } catch { if (mountedRef.current) setPrivateNotes([]); }
  }, [id]);

  // Équipe + paramètres : cache partagé entre fiches (5 min). Les modèles de message
  // ne sont lus qu'à l'ouverture de la demande d'accord, la fidélité qu'au paiement.
  useEffect(() => {
    let actif = true;
    Promise.all([
      api.getCached('/api/team/active', 5 * 60_000).catch(() => []),
      api.getCached('/api/config', 5 * 60_000).catch(() => []),
    ]).then(([team, params]) => {
      if (!actif) return;
      setTeamMembers(Array.isArray(team) ? team : []);
      const arr = Array.isArray(params) ? params : [];
      const valeur = (cle) => arr.find(p => p.cle === cle)?.valeur;
      const tva = valeur('tva');
      if (tva != null) setTvaRate(parseFloat(tva) || 0);
      const ac = valeur('AFFICHER_AUTOCOMPLETION');
      if (ac != null) setAutocompletionEnabled(ac !== 'false');
      const caisse = valeur('CAISSE_ENABLED');
      if (caisse != null) setCaisseEnabled(caisse === '1');
      else api.getCaisseConfig().then(c => { if (actif) setCaisseEnabled(c?.CAISSE_ENABLED === '1'); }).catch(() => {});
    });
    return () => { actif = false; };
  }, []);

  const chargerFidelite = useCallback(() => {
    const cid = ticketRef.current?.client_id;
    if (!cid || fideliteDemandeeRef.current) return;
    fideliteDemandeeRef.current = true;
    api.getFidelite(cid)
      .then(d => { if (mountedRef.current) setClientFidelite(d); })
      .catch(() => { fideliteDemandeeRef.current = false; });
  }, []);

  // Autres réparations du client (après l'affichage de la fiche)
  useEffect(() => {
    const cid = ticket?.client_id;
    if (!cid) return undefined;
    let actif = true;
    const timer = setTimeout(() => {
      api.getClientTickets(cid)
        .then(rows => {
          if (!actif) return;
          setAutresTickets((Array.isArray(rows) ? rows : [])
            .filter(r => String(r.id) !== String(id))
            .map(r => ({
              id: r.id, ticket_code: r.ticket_code, statut: r.statut, date_depot: r.date_depot,
              date_cloture: r.date_cloture, marque: r.marque, modele: r.modele, modele_autre: r.modele_autre,
              panne: r.panne, est_retour_sav: r.est_retour_sav,
            })));
        })
        .catch(() => { if (actif) setAutresTickets([]); });
    }, 400);
    return () => { actif = false; clearTimeout(timer); };
  }, [ticket?.client_id, id]);

  // ─── Layout persistence & handlers ──────────────────────────────

  useEffect(() => {
    if (!user?.utilisateur) return;
    try {
      const saved = localStorage.getItem(`kp_layout_${user.utilisateur}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.left && parsed.right) {
          const allSaved = [...parsed.left, ...parsed.right];
          const validLeft = parsed.left.filter(wid => ALL_WIDGET_IDS.has(wid));
          const validRight = parsed.right.filter(wid => ALL_WIDGET_IDS.has(wid));
          const savedSet = new Set(allSaved.filter(wid => ALL_WIDGET_IDS.has(wid)));
          const missing = [...ALL_WIDGET_IDS].filter(wid => !savedSet.has(wid));
          setLayout({ left: validLeft, right: [...validRight, ...missing] });
        }
      }
    } catch {}
    try {
      const savedPrefs = localStorage.getItem(`kp_prefs_${user.utilisateur}`);
      if (savedPrefs) setWidgetPrefs(p => ({ ...p, ...JSON.parse(savedPrefs) }));
    } catch {}
  }, [user?.utilisateur]);

  const persistLayout = (newLayout) => {
    setLayout(newLayout);
    if (user?.utilisateur) {
      try { localStorage.setItem(`kp_layout_${user.utilisateur}`, JSON.stringify(newLayout)); } catch {}
    }
  };

  const resetLayout = () => {
    if (!user?.utilisateur) return;
    try { localStorage.removeItem(`kp_layout_${user.utilisateur}`); } catch {}
    setLayout(DEFAULT_LAYOUT);
    toast.success('Layout réinitialisé');
  };

  const savePrefs = (newPrefs) => {
    setWidgetPrefs(newPrefs);
    if (user?.utilisateur) {
      try { localStorage.setItem(`kp_prefs_${user.utilisateur}`, JSON.stringify(newPrefs)); } catch {}
    }
  };

  const handleDragEnd = (result) => {
    const { source, destination } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const sourceCol = source.droppableId;
    const destCol = destination.droppableId;
    const newLayout = { left: [...layout.left], right: [...layout.right] };

    if (sourceCol === destCol) {
      const items = newLayout[sourceCol];
      const [moved] = items.splice(source.index, 1);
      items.splice(destination.index, 0, moved);
    } else {
      const sourceItems = newLayout[sourceCol];
      const destItems = newLayout[destCol];
      const [moved] = sourceItems.splice(source.index, 1);
      destItems.splice(destination.index, 0, moved);
    }

    persistLayout(newLayout);
  };

  // ─── Modifications des formulaires ─────────────────────────────

  const updateDeviceForm = (updates, opts) => {
    majDeviceForm({ ...deviceFormRef.current, ...updates });
    deviceSave.schedule(updates, opts);
  };

  // Fin de saisie (sortie du champ, suggestion choisie, fermeture) : l'envoi porte ?learn=1 ;
  // une valeur déjà enregistrée par le délai d'auto-save est apprise une seule fois ici.
  const finSaisieAppareil = () => {
    apprendreRef.current = true;
    deviceSave.flush()
      .then(() => {
        if (!mountedRef.current) return;
        const f = deviceFormRef.current;
        for (const [k, categorie] of Object.entries(CHAMPS_APPRIS)) {
          const v = String(f[k] || '').trim();
          if (v.length < 2 || v === apprisRef.current[k] || v === 'Pièce à commander' || TEXTE_SCANNE.test(v)) continue;
          apprisRef.current[k] = v;
          api.learnTerm(categorie, v).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => { apprendreRef.current = false; });
  };

  const updateClientForm = (updates, opts) => {
    majClientForm({ ...clientFormRef.current, ...updates });
    clientSave.schedule(updates, opts);
  };

  // Mise à jour optimiste : la vue, les messages et l'accord voient les nouveaux prix tout de suite
  const programmerTarif = (changes, opts) => {
    const patch = patchTarif(pricingFormRef.current, repairLinesRef.current, reductionModeRef.current, changes, !!ticketRef.current?.paye);
    if (Object.keys(patch).length === 0) return;
    fusionnerTicket(patch, null);
    pricingSave.schedule(patch, opts);
  };

  const updatePricingForm = (changes, opts) => {
    majPricingForm({ ...pricingFormRef.current, ...changes });
    programmerTarif(changes, opts);
  };

  const changerModeReduction = (mode) => {
    if (mode === reductionModeRef.current) return;
    majMode(mode);
    const vide = mode === 'pct' ? { reduction_montant: '' } : { reduction_pourcentage: '' };
    majPricingForm({ ...pricingFormRef.current, ...vide });
    programmerTarif({ ...vide, mode: true }, { wait: 0 });
  };

  const updateRepairLines = (lignes, opts) => {
    majRepairLines(lignes);
    programmerTarif({ lignes: true }, opts);
  };

  const addRepairLine = () => updateRepairLines([...repairLinesRef.current, { label: '', prix: 0 }], { wait: 0 });
  const removeRepairLine = (idx) => updateRepairLines(repairLinesRef.current.filter((_, i) => i !== idx), { wait: 0 });
  const updateRepairLine = (idx, field, value) => updateRepairLines(
    repairLinesRef.current.map((l, i) => (i === idx ? { ...l, [field]: value } : l)),
    { wait: field === 'label' ? 800 : 500 },
  );

  const flushSilencieux = (save) => () => { save.flush().catch(() => {}); };

  // ─── Commandes de pièces (optimiste) ─────────────────────────
  const marquerCommandeEnCours = (cle, actif) => {
    const s = new Set(commandesEnCoursRef.current);
    if (actif) s.add(cle); else s.delete(cle);
    commandesEnCoursRef.current = s;
    setCommandesEnCours(s);
  };

  const basculerCommandeLigne = async (line, coche) => {
    const label = String(line.label || '').trim();
    const tk = ticketRef.current;
    if (!label || !tk || commandesEnCoursRef.current.has(label)) return;
    if (coche && rattachementCommandes(repairLinesRef.current, commandes, tk.panne, prestationsRef.current)(label)) return;
    marquerCommandeEnCours(label, true);
    try {
      if (coche) {
        const tempId = `tmp-${Date.now()}`;
        // La commande porte le nom de la pièce (« Batterie »), pas celui du forfait
        const temp = {
          id: tempId, ticket_id: tk.id, ticket_code: tk.ticket_code, description: libelleCourt(label, prestationsRef.current),
          fournisseur: 'Mobilax', prix: prixNombre(line.prix), statut: 'En attente',
        };
        setCommandes(prev => [temp, ...prev]);
        fusionnerTicket({ commande_piece: 1 }, null);
        try {
          const res = await api.createPart({
            ticket_id: tk.id, ticket_code: tk.ticket_code, description: temp.description, fournisseur: temp.fournisseur, prix: temp.prix,
          });
          const row = res?.description ? res : { ...temp, id: res?.id ?? tempId };
          if (mountedRef.current) setCommandes(prev => prev.map(c => (c.id === tempId ? row : c)));
          if (res?.id == null) {
            const cmds = await api.getPartsByTicket(tk.id).catch(() => null);
            if (cmds && mountedRef.current) setCommandes(cmds);
          }
          invalidateCache('commandes', 'tickets', 'dashboard');
          toast.success('Pièce ajoutée aux commandes');
        } catch {
          if (mountedRef.current) setCommandes(prev => prev.filter(c => c.id !== tempId));
          toast.error('Erreur ajout commande');
        }
      } else {
        const cmd = rattachementCommandes(repairLinesRef.current, commandes, tk.panne, prestationsRef.current)(label);
        if (!cmd) return;
        setCommandes(prev => prev.filter(c => c.id !== cmd.id));
        try {
          await api.deletePart(cmd.id);
          invalidateCache('commandes');
          toast.success('Commande retirée');
        } catch {
          if (mountedRef.current) setCommandes(prev => [cmd, ...prev]);
          toast.error('Erreur suppression commande');
        }
      }
    } finally {
      if (mountedRef.current) marquerCommandeEnCours(label, false);
    }
  };

  // ─── Statut, remise, paiement ───────────────────────────────

  // Les avantages (bon −10 €, réduction fidélité) sont écrits en réduction € sur le ticket AVANT
  // l'encaissement : le serveur historise, compte le CA et crédite les points sur ce que le client
  // paie vraiment. Ils ne sont débités qu'après un paiement réussi ; une modale fermée sans
  // paiement remet la réduction d'origine.
  const ecrireReduction = (avant, extra) => {
    let mode = avant.mode;
    let changes = { reduction_montant: avant.reduction_montant, reduction_pourcentage: avant.reduction_pourcentage };
    if (extra > 0) {
      const m = calculMontants({ ...pricingFormRef.current, ...changes }, repairLinesRef.current, avant.mode);
      mode = 'eur';
      changes = { reduction_montant: Math.min(m.base, Math.round((m.reduction + extra) * 100) / 100), reduction_pourcentage: '' };
    }
    majMode(mode);
    majPricingForm({ ...pricingFormRef.current, ...changes });
    programmerTarif({ ...changes, mode: true }, { wait: 0 });
  };

  const appliquerAvantages = async (choix) => {
    const montant = Math.round((Number(choix?.montant) || 0) * 100) / 100;
    const actuel = avantagesRef.current;
    const memeChoix = actuel
      ? actuel.montant === montant && actuel.bon === !!choix?.bon && actuel.fidelite === !!choix?.fidelite
      : montant === 0;
    if (!memeChoix) {
      const f = pricingFormRef.current;
      const avant = actuel?.avant || {
        mode: reductionModeRef.current, reduction_montant: f.reduction_montant, reduction_pourcentage: f.reduction_pourcentage,
      };
      ecrireReduction(avant, montant);
      avantagesRef.current = montant > 0 ? { bon: !!choix.bon, fidelite: !!choix.fidelite, montant, avant } : null;
      setAvantagesAppliques(montant > 0 ? montant : 0);
    }
    await flushPricing();
  };

  const annulerAvantages = () => {
    const actuel = avantagesRef.current;
    avantagesRef.current = null;
    if (!actuel || !mountedRef.current) return;
    setAvantagesAppliques(0);
    ecrireReduction(actuel.avant, 0);
    flushPricing().catch(() => {});
  };

  const debiterAvantages = async (tk) => {
    const a = avantagesRef.current;
    avantagesRef.current = null;
    if (mountedRef.current) setAvantagesAppliques(0);
    if (!a) return;
    const echecs = [];
    if (a.bon) await api.consommerBonGrattage(tk.client_id, tk.id).catch(() => echecs.push('bon de grattage'));
    if (a.fidelite) await api.utiliserPoints({ client_id: tk.client_id, type: 'reduction' }).catch(() => echecs.push('réduction fidélité'));
    const noms = [a.bon && 'bon de grattage', a.fidelite && 'fidélité'].filter(Boolean).join(' + ');
    api.addHistory(tk.id, `Avantage client −${a.montant.toFixed(2).replace('.', ',')} € (${noms}) déduit du prix`).catch(() => {});
    // Bon utilisé, points débités : relus à la prochaine ouverture
    fideliteDemandeeRef.current = false;
    if (mountedRef.current) setClientFidelite(null);
    if (echecs.length) toast.warning(`Avantage déduit mais non débité : ${echecs.join(', ')}`);
  };

  const ouvrirRestitution = (cible = 'Rendu au client') => {
    chargerFidelite();
    remiseSansReponseRef.current = false;
    setRestitution({ cible });
  };

  const fermerRestitution = () => {
    setRestitution(null);
    annulerAvantages();
  };

  const ouvrirPaiement = (opts = {}) => {
    chargerFidelite();
    setApplyBonGrattage(false);
    setApplyFidelite(false);
    setPaiement({ cloturer: !!opts.cloturer });
  };

  const fermerPaiement = () => {
    setPaiement(null);
    annulerAvantages();
  };

  const changerStatut = async (statut, { silencieux = false } = {}) => {
    if (!verrouiller('statut')) return false;
    setStatutEnCours(true);
    try {
      try {
        await toutEnregistrer();
      } catch {
        toast.error('Modifications non enregistrées : réessayez avant de changer le statut');
        return false;
      }
      try {
        await api.changeStatus(id, statut);
        invaliderListes();
        fusionnerTicket({ statut }, null);
        await loadTicket(false);
        if (!silencieux) toast.success(`Statut changé : ${statut}`);
        return true;
      } catch (err) {
        const dejaRemis = STATUTS_REMISE.has(ticketRef.current?.statut);
        if (err?.data?.code === 'utiliser_restitution' && !dejaRemis) ouvrirRestitution(statut);
        else toast.error(err?.message || 'Erreur changement de statut');
        return false;
      }
    } finally {
      deverrouiller('statut');
      if (mountedRef.current) setStatutEnCours(false);
    }
  };

  const handleStatusChange = async (statut) => {
    const tk = ticketRef.current;
    if (!tk || statut === tk.statut || statutEnCours) return;
    // Rendu / Clôturé passent par la remise (paiement, prêt, auteur) : le sélecteur ne la contourne pas
    if (STATUTS_REMISE.has(statut)) {
      if (!STATUTS_REMISE.has(tk.statut)) { ouvrirRestitution(statut); return; }
      if (statut === 'Clôturé' && !tk.paye) { ouvrirPaiement({ cloturer: true }); return; }
    }
    await changerStatut(statut);
  };

  const effectuerRestitution = async (body, avantages) => {
    const tk = ticketRef.current;
    // Rendu entre-temps (scan rapide) : pas de réduction écrite sur un ticket déjà remis
    if (STATUTS_REMISE.has(tk?.statut) && !remiseSansReponseRef.current) {
      fermerRestitution();
      toast.info('Ce ticket est déjà rendu au client');
      return;
    }
    try {
      await toutEnregistrer();
      await appliquerAvantages(body.paiement === 'encaisser' ? avantages : null);
    } catch {
      throw new Error('Modifications non enregistrées : réessayez avant la remise');
    }
    let r;
    try {
      r = await api.restitution(id, body);
    } catch (err) {
      if (!err?.status) {
        remiseSansReponseRef.current = true;
        throw new Error('Pas de réponse du serveur : la remise est peut-être enregistrée. Confirmez à nouveau pour vérifier (rien ne sera compté deux fois).');
      }
      // Le serveur calcule un autre reste : la fiche se relit, la modale affiche le sien
      if (err?.data?.code === 'reste_a_payer') await loadTicket(false);
      throw err;
    }
    if (!mountedRef.current) return;
    if (r?.ticket) appliquerTicket(r.ticket, prestationsRef.current);
    setRestitution(null);
    invalidateCache('tickets', 'interactions', 'dashboard', 'commandes');
    if (r?.deja_rendu) {
      // Notre remise précédente est passée (réponse perdue) : ses avantages sont dus ; sinon
      // quelqu'un d'autre a rendu le ticket et la réduction écrite est retirée
      if (remiseSansReponseRef.current) {
        await debiterAvantages(tk);
        toast.success('Remise bien enregistrée (la réponse précédente s’était perdue)');
      } else {
        annulerAvantages();
        toast.info('Ce ticket était déjà rendu au client : rien n’a été modifié');
      }
      remiseSansReponseRef.current = false;
      loadTicket(false);
      return;
    }
    // Avantages débités seulement une fois la remise enregistrée (pas de double débit au réessai)
    await debiterAvantages(tk);
    const points = r?.points_fidelite;
    toast.success(points ? `Rendu au client · +${points} pts fidélité` : 'Rendu au client');
    // Un ticket réglé est clôturé (date de clôture = chiffre d'affaires), comme avant
    const apres = r?.ticket || {};
    if (apres.paye && apres.statut === 'Rendu au client') {
      const ok = await changerStatut('Clôturé', { silencieux: true });
      if (!ok) toast.warning('Remise enregistrée, clôture à refaire depuis le statut');
    } else {
      loadTicket(false);
    }
  };

  const confirmerPaiement = async () => {
    if (!verrouiller('paiement')) return;
    setPaying(true);
    const tk = ticketRef.current;
    try {
      if (tk?.paye) {
        fermerPaiement();
        toast.info('Ce ticket est déjà payé');
        return;
      }
      const choix = {
        bon: applyBonGrattage && avantagesDisponibles(clientFidelite).bon > 0,
        fidelite: applyFidelite && avantagesDisponibles(clientFidelite).fidelite > 0,
      };
      choix.montant = montantAvantages(clientFidelite, choix, resteDu + avantagesAppliques);
      try {
        await toutEnregistrer();
        await appliquerAvantages(choix);
      } catch {
        toast.error('Prix non enregistrés : réessayez avant de confirmer le paiement');
        return;
      }
      // Paiement d'abord, avantages débités ensuite : un échec ne consomme rien
      const res = await api.setPaye(id, true);
      const paye = res?.paye != null ? !!res.paye : true;
      fusionnerTicket(paye ? { paye: 1, statut_paiement: 'Payé', reste_a_payer: 0 } : { paye: 0 }, null);
      invaliderListes();
      const cloturer = paiement?.cloturer || tk.statut === 'Rendu au client';
      setPaiement(null);
      setApplyBonGrattage(false);
      setApplyFidelite(false);
      if (paye) await debiterAvantages(tk);
      const points = res?.points_fidelite ?? res?.fidelite?.points_gagnes;
      toast.success(points ? `Marqué payé · +${points} pts fidélité` : 'Marqué payé');
      // Le serveur clôture lui-même un « Rendu au client » réglé ; sinon on clôture ici
      const statutApres = res?.statut || tk.statut;
      if (paye && cloturer && statutApres !== 'Clôturé') await changerStatut('Clôturé', { silencieux: true });
      else loadTicket(false);
    } catch (err) {
      toast.error(err?.message || 'Paiement non enregistré');
    } finally {
      deverrouiller('paiement');
      if (mountedRef.current) setPaying(false);
    }
  };

  const demarquerPaiement = async () => {
    if (verrousRef.current.has('paiement') || !confirm('Démarquer comme non payé ?')) return;
    if (!verrouiller('paiement')) return;
    setPaying(true);
    try {
      await api.setPaye(id, false);
      invaliderListes();
      await loadTicket(false);
      toast.success('Marqué non payé');
    } catch (err) {
      toast.error(err?.message || 'Erreur');
    } finally {
      deverrouiller('paiement');
      if (mountedRef.current) setPaying(false);
    }
  };

  const handleDeleteTicket = async () => {
    if (!deleteCode) {
      setDeleteError('Code requis');
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      // Vérification du code admin côté serveur (plus de comparaison hardcodée).
      await api.verifyAdmin('admin', deleteCode);
    } catch {
      setDeleteError('Code incorrect');
      setDeleting(false);
      return;
    }
    try {
      await api.deleteTicket(id);
      invaliderListes();
      toast.success('Ticket supprimé');
      navigate(basePath);
    } catch (err) {
      toast.error('Erreur lors de la suppression');
      setDeleting(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    try {
      const prefix = notePrivate ? '[INTERNE]' : '[CLIENT]';
      await api.addNote(id, `${prefix} ${noteText}`);
      setNoteText('');
      await loadTicket(false);
      toast.success('Note ajoutée');
    } catch (err) {
      toast.error('Erreur ajout de note');
    }
  };

  const handleAddPrivateNote = async () => {
    if (!newNoteText.trim()) return;
    try {
      await api.addPrivateNote(id, user?.utilisateur || 'Inconnu', newNoteText, newNoteImportant);
      setNewNoteText('');
      setNewNoteImportant(false);
      await loadNotes();
      toast.success('Note ajoutée');
    } catch { toast.error('Erreur ajout note'); }
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await api.deleteNote(id, noteId);
      await loadNotes();
      toast.success('Note supprimée');
    } catch { toast.error('Erreur suppression'); }
  };

  const handleDeleteInternalNote = async (rawLine) => {
    try {
      const current = ticketRef.current?.notes_internes || '';
      const lines = current.split('\n').filter(l => l.trim() !== rawLine.trim());
      await api.updateTicket(id, { notes_internes: lines.join('\n') });
      await loadTicket(false);
      toast.success('Note supprimée');
    } catch { toast.error('Erreur suppression'); }
  };

  const handleToggleNoteImportant = async (noteId, current) => {
    try {
      await api.toggleNoteImportant(id, noteId, !current);
      await loadNotes();
    } catch { toast.error('Erreur'); }
  };

  const handleAddAttention = async () => {
    const message = prompt('Message de la note importante :');
    if (!message || !message.trim()) return;
    try {
      await api.addPrivateNote(id, user?.utilisateur || 'Accueil', message.trim(), true);
      await api.updateTicket(id, { attention: message.trim() });
      await loadTicket(false);
      toast.success('Note importante ajoutée');
    } catch (err) {
      toast.error('Erreur ajout attention');
    }
  };

  const handleCopyCode = () => {
    const code = ticket?.ticket_code;
    if (!code) return;
    const show = () => {
      setCopied(true);
      setTimeout(() => { if (mountedRef.current) setCopied(false); }, 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(show).catch((err) => {
        console.warn('[TicketDetailPage] clipboard write failed', err);
        toast.error('Impossible de copier le code');
      });
    } else {
      console.warn('[TicketDetailPage] clipboard API not available');
      toast.error('Copie non supportée par ce navigateur');
    }
  };

  // ─── Calcul des totaux avec fallback devis_estime ─────────────────────
  // Si aucune ligne de réparation détaillée n'est saisie mais qu'un "devis estimé"
  // est renseigné (cas avant diagnostic), on utilise ce dernier comme base de calcul.
  const montants = calculMontants(pricingForm, repairLines, reductionMode);
  const useDevisEstime = montants.surDevis;
  const totalRepairs = montants.base;
  const reductionMontant = montants.eur;
  const reductionPct = montants.pct;
  const effectiveReduction = montants.reduction;
  // Prix saisis TTC, comme services/montants.py côté serveur : la TVA est incluse, jamais rajoutée.
  // Sans saisie en attente, les montants du serveur (ticket.montants) font foi : ce sont eux
  // que la remise et le paiement vérifient.
  const montantsServeur = ticket?.montants && Number.isFinite(Number(ticket.montants.total)) && !pricingSave.hasPending()
    ? ticket.montants : null;
  const totalNet = montantsServeur ? Number(montantsServeur.total) : Math.max(0, totalRepairs - effectiveReduction);
  const totalTTC = totalNet;
  const reste = totalTTC - (montantsServeur ? Number(montantsServeur.acompte) || 0 : montants.acompte);
  const resteDu = ticket?.paye ? 0 : Math.max(0, Math.round(reste * 100) / 100);
  const lignesAffichees = lignesComptees(repairLines);
  const indexEcran = indexLigneEcran(lignesAffichees, prestations);

  const handleSendCaisse = async () => {
    const tk = ticketRef.current;
    if (!tk || !verrouiller('caisse')) return;
    setEnvoiCaisse(true);
    try {
      try {
        await toutEnregistrer();
      } catch {
        toast.error('Prix non enregistrés : réessayez avant l’envoi en caisse');
        return;
      }
      // Montant, libellé et client sont recalculés par le serveur depuis le ticket
      const envoyer = async (force) => {
        try {
          return await api.envoyerCaisse(force ? { ticket_id: tk.id, force: true } : { ticket_id: tk.id });
        } catch (err) {
          const code = err?.data?.code;
          if (code === 'deja_envoye' && !force) {
            const date = err.data.date ? new Date(err.data.date) : null;
            const quand = date && !Number.isNaN(date.getTime())
              ? ` le ${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
              : '';
            if (!confirm(`Vente déjà envoyée en caisse${quand}.\nRenvoyer créera une seconde vente (si la première a été annulée sur la caisse).\n\nRenvoyer quand même ?`)) return null;
            return envoyer(true);
          }
          if (code === 'envoi_en_cours') {
            toast.info('Envoi en caisse déjà en cours pour ce ticket : patientez quelques secondes');
            return null;
          }
          if (!err?.status) {
            // Le serveur attend la caisse jusqu'à 15 s : la vente a pu passer malgré l'erreur
            toast.warning('La caisse n’a pas répondu à temps : vérifiez la vente sur la caisse avant de renvoyer');
            loadTicket(false);
            return null;
          }
          throw err;
        }
      };
      const res = await envoyer(false);
      if (!res) return;
      if (res.result === 'OK') {
        const montant = Number(res.montant);
        toast.success(Number.isFinite(montant) ? `Vente envoyée en caisse : ${formatPrix(montant)}` : (res.message || 'Vente envoyée en caisse'));
        loadTicket(false);
      } else {
        toast.error(res.message || 'Erreur caisse');
      }
    } catch (err) {
      toast.error(err?.message || 'Erreur envoi en caisse');
    } finally {
      deverrouiller('caisse');
      if (mountedRef.current) setEnvoiCaisse(false);
    }
  };

  const DEFAULT_ACCORD_TEMPLATE = "Bonjour {prenom}, le devis pour la réparation de votre {marque} {modele} est de {montant} €. Vous pouvez accepter ou refuser directement en cliquant ici : {lien_suivi}. Merci, l'équipe Klikphone";

  // Lu dans les refs : appelé juste après un enregistrement, sans attendre un nouveau rendu
  const getAccordMontant = () => {
    const tk = ticketRef.current;
    if (!tk) return 0;
    const serveur = tk.montants && !pricingSave.hasPending() ? Number(tk.montants.total) : NaN;
    if (Number.isFinite(serveur) && serveur > 0) return serveur;
    const m = calculMontants(pricingFormRef.current, repairLinesRef.current, reductionModeRef.current);
    const net = Math.max(0, m.base - m.reduction);
    if (net > 0) return net;
    if (parseFloat(tk.tarif_final) > 0) return parseFloat(tk.tarif_final);
    if (parseFloat(tk.devis_estime) > 0) return parseFloat(tk.devis_estime);
    return 0;
  };

  const saisiesEnAttente = () => Object.values(savesRef.current).some(s => s?.hasPending());

  const buildAccordMessage = (modele) => {
    const tk = ticketRef.current;
    if (!tk) return '';
    const montant = getAccordMontant();
    const suiviUrl = `${window.location.origin}/suivi?ticket=${tk.ticket_code || ''}`;
    const template = modele || DEFAULT_ACCORD_TEMPLATE;
    const prestation = lignesComptees(repairLinesRef.current).map(l => String(l.label).trim()).join(' + ') || tk.panne || '';
    return template
      .replace(/\{prenom\}/g, tk.client_prenom || '')
      .replace(/\{nom\}/g, tk.client_nom || '')
      .replace(/\{marque\}/g, tk.marque || '')
      .replace(/\{modele\}/g, tk.modele_autre || tk.modele || '')
      .replace(/\{appareil\}/g, tk.modele_autre || `${tk.marque || ''} ${tk.modele || ''}`.trim() || 'appareil')
      .replace(/\{code\}/g, tk.ticket_code || '')
      .replace(/\{prestation\}/g, prestation)
      .replace(/\{panne\}/g, tk.panne || '')
      .replace(/\{montant\}/g, montant.toFixed(2))
      .replace(/\{lien_suivi\}/g, suiviUrl);
  };

  // Le prix annoncé au client doit être celui du serveur (page /suivi, devis imprimé)
  const openAccordModal = async () => {
    if (!verrouiller('accord')) return;
    try {
      try {
        await toutEnregistrer();
      } catch {
        toast.error('Prix non enregistrés : réessayez avant la demande d’accord');
        return;
      }
      if (!mountedRef.current) return;
      const montant = getAccordMontant();
      if (montant === 0) {
        toast.error("Renseigne un tarif avant d'envoyer la demande d'accord");
        return;
      }
      let modele = accordTemplateMsg;
      if (modele === null) {
        try {
          const tpls = await api.getMessageTemplates();
          modele = (Array.isArray(tpls) ? tpls : []).find(tp => tp.id === 12)?.message || '';
        } catch { modele = ''; }
        if (!mountedRef.current) return;
        setAccordTemplateMsg(modele);
      }
      setAccordMessage(buildAccordMessage(modele));
      setShowAccordModal(true);
    } finally {
      deverrouiller('accord');
    }
  };

  const handleSendAccord = async (canal) => {
    if (!accordMessage.trim()) { toast.error('Message vide'); return; }
    setAccordLoading(true);
    try {
      // Normalement rien n'attend (enregistré à l'ouverture) : WhatsApp/SMS s'ouvrent alors
      // sans attente, dans le geste de l'utilisateur (bloqueur de fenêtres)
      if (saisiesEnAttente()) {
        try {
          await toutEnregistrer();
        } catch {
          toast.error('Prix non enregistrés : la demande n’est pas partie, réessayez');
          return;
        }
      }
      const tk = ticketRef.current;
      const tel = tk.client_tel;
      const email = tk.client_email;
      // SMS parti par le serveur (Brevo) : la note est déjà écrite côté serveur
      let smsServeurEnvoye = false;

      if (canal === 'whatsapp') {
        if (!tel) { toast.error('Pas de téléphone'); return; }
        window.open(waLink(tel, accordMessage), '_blank');
      } else if (canal === 'sms') {
        if (!tel) { toast.error('Pas de téléphone'); return; }
        try {
          const res = await envoyerSms({ serveur: smsServeur, ticketId: id, tel, message: accordMessage, libelle: 'Demande accord' });
          smsServeurEnvoye = res.mode === 'serveur';
        } catch (err) {
          // Refus lisible (doublon, numéro fixe, crédits…) : statut inchangé, échec noté sur le ticket
          toast.error(err?.message || 'SMS non envoyé');
          if (err?.status === 424) loadNotes();
          return;
        }
      } else if (canal === 'email') {
        if (!email) { toast.error("Ce client n'a pas d'adresse email"); return; }
        const res = await api.envoyerEmail(email, `Klikphone SAV - Accord ${tk.ticket_code}`, accordMessage);
        if (res.status !== 'ok') { toast.error(res.message || "Erreur d'envoi email"); return; }
      }

      await api.changeStatus(id, "En attente d'accord client");

      if (!smsServeurEnvoye) {
        const auteur = user?.utilisateur || 'Accueil';
        const logText = `[Demande accord] ${accordMessage.substring(0, 120)}${accordMessage.length > 120 ? '...' : ''}`;
        await api.logMessage(id, auteur, logText, canal);
      }

      setShowAccordModal(false);
      invaliderListes();
      await loadTicket(false);
      toast.success(smsServeurEnvoye ? "Demande d'accord envoyée par SMS" : "Demande d'accord envoyée");
    } catch (err) {
      toast.error('Erreur envoi de la demande');
    } finally {
      if (mountedRef.current) setAccordLoading(false);
    }
  };

  const handleAccordResponse = async (accepted) => {
    const auteur = user?.utilisateur || 'Accueil';
    if (accepted) {
      const ok = await changerStatut('En cours de réparation', { silencieux: true });
      if (!ok) return;
      await api.addPrivateNote(id, auteur, 'Accord client reçu — réparation lancée').catch(() => {});
      await loadNotes();
      toast.success('Ticket en cours de réparation');
      return;
    }
    // Refus : le serveur traite « accord → Réparation terminée » comme un devis refusé
    // (issue refus_devis, pièces non marquées reçues, pas d'annonce « prêt »), puis on rend en l'état.
    const ok = await changerStatut('Réparation terminée', { silencieux: true });
    if (!ok) return;
    await api.addPrivateNote(id, auteur, MOTIF_REFUS).catch(() => {});
    await loadNotes();
    toast.success('Refus enregistré : l’appareil peut être rendu au client');
    ouvrirRestitution('Rendu au client');
  };

  // ─── Retour SAV ─────────────────────────────────────────────
  const handleCreateRetourSAV = async () => {
    if (!retourSAVForm.panne.trim()) {
      toast.error('Veuillez décrire la panne');
      return;
    }
    const tk = ticketRef.current;
    setCreatingSAV(true);
    try {
      const result = await api.createRetourSAV(tk.id, tk.client_id, {
        categorie: tk.categorie || '',
        marque: tk.marque || '',
        modele: tk.modele || '',
        modele_autre: tk.modele_autre || '',
        imei: tk.imei || '',
        panne: retourSAVForm.panne,
        panne_detail: retourSAVForm.panne_detail,
        pin: tk.pin || '',
        pattern: tk.pattern || '',
      });
      invaliderListes();
      toast.success(`Retour SAV créé : ${result.ticket_code}`);
      setShowRetourSAVModal(false);
      setRetourSAVForm({ panne: '', panne_detail: '' });
      navigate(`${basePath}/ticket/${result.id}`);
    } catch (err) {
      toast.error(err.message || 'Erreur création retour SAV');
    } finally {
      if (mountedRef.current) setCreatingSAV(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8" aria-busy="true" aria-label="Chargement du ticket">
        {/* Header skeleton */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-slate-200 motion-safe:animate-pulse" />
          <div className="space-y-2 flex-1">
            <div className="h-5 w-48 bg-slate-200 rounded motion-safe:animate-pulse" />
            <div className="h-3 w-32 bg-slate-100 rounded motion-safe:animate-pulse" />
          </div>
          <div className="h-9 w-24 bg-slate-100 rounded-xl motion-safe:animate-pulse" />
        </div>
        {/* Info cards skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-5">
              <div className="h-3 w-20 bg-slate-100 rounded mb-3 motion-safe:animate-pulse" />
              <div className="space-y-2">
                <div className="h-4 w-full bg-slate-100 rounded motion-safe:animate-pulse" />
                <div className="h-4 w-3/4 bg-slate-100 rounded motion-safe:animate-pulse" />
              </div>
            </div>
          ))}
        </div>
        {/* Timeline skeleton */}
        <div className="card p-5">
          <div className="h-4 w-28 bg-slate-100 rounded mb-4 motion-safe:animate-pulse" />
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-100 shrink-0 motion-safe:animate-pulse" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-full bg-slate-100 rounded motion-safe:animate-pulse" />
                  <div className="h-3 w-2/3 bg-slate-100 rounded motion-safe:animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <Smartphone className="w-7 h-7 text-slate-400" aria-hidden="true" />
        </div>
        <p className="text-slate-600 font-medium">Ticket non trouvé</p>
        <button type="button" onClick={() => navigate(basePath)} className="btn-secondary mt-4 min-h-11">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Retour au dashboard
        </button>
      </div>
    );
  }

  const t = ticket;
  const appareil = t.modele_autre || `${t.marque || ''} ${t.modele || ''}`.trim();
  const remis = STATUTS_REMISE.has(t.statut);
  const commandeDe = rattachementCommandes(repairLines, commandes, t.panne, prestations);
  const surDevisSansPrix = totalTTC === 0 && !t.paye && (t.type_document || 'devis') !== 'facture';
  // Décision la plus récente sur le devis (notes triées de la plus récente à la plus ancienne)
  const decisionDevis = privateNotes.find(n => /^(✅|❌) Devis/.test(String(n.contenu || '').trim()));
  const devisRefuse = !remis && (t.issue === 'refus_devis' || String(decisionDevis?.contenu || '').trim().startsWith('❌'));
  const peutRendre = !remis && t.statut !== 'Pré-enregistré';
  const proposerRemise = peutRendre && (t.statut === 'Réparation terminée' || devisRefuse);
  const aujourdHui = aujourdhuiIso();

  // Parse notes into timeline entries
  const timelineEntries = [];
  if (t.notes_internes) {
    t.notes_internes.split('\n').filter(Boolean).forEach(line => {
      const isInternal = line.includes('[INTERNE]');
      const isClient = line.includes('[CLIENT]');
      const isAttention = line.includes('[ATTENTION]');
      const cleanLine = line.replace(/\[(INTERNE|CLIENT|ATTENTION)\]\s*/g, '');
      const tsMatch = cleanLine.match(/^\[(\d{2}\/\d{2}\/?\d{0,4}\s?\d{2}:\d{2})\]\s*/);
      const timestamp = tsMatch ? tsMatch[1] : '';
      const text = tsMatch ? cleanLine.replace(tsMatch[0], '') : cleanLine;
      timelineEntries.push({
        type: isAttention ? 'attention' : isClient ? 'client' : 'internal',
        text, timestamp, raw: line,
      });
    });
  }
  if (t.historique) {
    t.historique.split('\n').filter(Boolean).forEach(line => {
      const tsMatch = line.match(/^\[(\d{2}\/\d{2}\s?\d{2}:\d{2})\]\s*/);
      const timestamp = tsMatch ? tsMatch[1] : '';
      const text = tsMatch ? line.replace(tsMatch[0], '') : line;
      timelineEntries.push({ type: 'history', text, timestamp, raw: line });
    });
  }
  // Sort by timestamp desc (most recent first)
  timelineEntries.reverse();

  const badgeCommande = (cmd, compact = false) => {
    if (!cmd) return null;
    const st = cmd.statut || 'En attente';
    const cfg = st === 'Reçu' ? 'bg-green-100 text-green-800'
      : st === 'Commandée' ? 'bg-blue-100 text-blue-800'
      : st === 'En réparation' ? 'bg-violet-100 text-violet-800'
      : 'bg-amber-100 text-amber-800';
    return (
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${compact ? '' : 'ml-2'} ${cfg}`}>
        {compact && <Package className="w-2.5 h-2.5 inline mr-0.5" aria-hidden="true" />}{st}
      </span>
    );
  };

  const prixLigne = (prix) => (prixNombre(prix) === 0 && surDevisSansPrix
    ? <span className="text-sm font-medium text-slate-500">Sur devis</span>
    : <span className="text-sm font-bold text-slate-800">{formatPrix(prixNombre(prix))}</span>);

  const boutonRendre = (taille = 'normal') => (
    <button
      type="button"
      onClick={() => ouvrirRestitution('Rendu au client')}
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 ${taille === 'grand' ? 'w-full min-h-12 px-4 text-sm' : 'min-h-11 px-4 text-sm'}`}
    >
      <PackageCheck className="w-4 h-4" aria-hidden="true" /> Rendre au client
    </button>
  );

  // ─── Block rendering ──────────────────────────────────────────

  const renderBlockContent = (blockId) => {
    switch (blockId) {
      case 'client':
        return (
          <EditableSection
            title="Client" icon={User} iconBg="bg-blue-50" iconColor="text-blue-600"
            editing={editingClient}
            autoSave={clientSave}
            onEdit={() => setEditingClient(true)}
            onClose={() => { flushSilencieux(clientSave)(); setEditingClient(false); }}
            viewContent={
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                    <span className="text-brand-700 font-bold text-sm">
                      {(t.client_prenom?.[0] || '').toUpperCase()}{(t.client_nom?.[0] || '').toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-bold text-slate-900 truncate">{t.client_prenom || ''} {t.client_nom || ''}</p>
                    {t.client_societe && <p className="text-xs text-slate-600">{t.client_societe}</p>}
                    {t.client_carte_camby ? <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">🎫 Camby</span> : null}
                  </div>
                  {t.client_id && (
                    <button
                      type="button"
                      onClick={() => navigate(`${basePath}/clients?client=${t.client_id}`)}
                      className="btn-ghost text-xs px-3 min-h-11 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                    >
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Fiche client
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {t.client_tel && (
                    <a href={`tel:${t.client_tel}`} className="flex items-center gap-2.5 min-h-11 text-sm text-slate-700 hover:text-brand-600 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                        <Phone className="w-4 h-4 text-slate-500" aria-hidden="true" />
                      </div>
                      <span className="font-mono text-xs">{t.client_tel}</span>
                    </a>
                  )}
                  {t.client_email && (
                    <a href={`mailto:${t.client_email}`} className="flex items-center gap-2.5 min-h-11 text-sm text-slate-700 hover:text-brand-600 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                        <Mail className="w-4 h-4 text-slate-500" aria-hidden="true" />
                      </div>
                      <span className="text-xs truncate">{t.client_email}</span>
                    </a>
                  )}
                </div>

                {/* Autres réparations du client (garantie, appareils en cours) */}
                {autresTickets && autresTickets.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5" aria-hidden="true" /> Autres réparations ({autresTickets.length})
                    </p>
                    <ul className="space-y-1">
                      {autresTickets.slice(0, 5).map(o => {
                        const garantie = STATUTS_REMISE.has(o.statut) ? finGarantie(o.date_cloture) : null;
                        const sousGarantie = !!garantie && garantie.iso >= aujourdHui;
                        const appareilO = o.modele_autre || `${o.marque || ''} ${o.modele || ''}`.trim() || '—';
                        return (
                          <li key={o.id}>
                            <button
                              type="button"
                              onClick={() => navigate(`${basePath}/ticket/${o.id}`)}
                              className="w-full min-h-11 flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                            >
                              <span className="font-mono text-xs font-bold text-slate-800 shrink-0">{o.ticket_code}</span>
                              <span className="text-xs text-slate-600 truncate flex-1 min-w-0">{appareilO}{o.panne ? ` · ${o.panne}` : ''}</span>
                              {sousGarantie && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 shrink-0" title={`Garantie jusqu'au ${garantie.texte}`}>
                                  Garantie → {garantie.texte}
                                </span>
                              )}
                              <StatusBadge statut={o.statut} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {autresTickets.length > 5 && (
                      <button type="button" onClick={() => navigate(`${basePath}/clients?client=${t.client_id}`)} className="mt-1 text-xs font-semibold text-brand-700 hover:underline min-h-11 px-2">
                        Voir les {autresTickets.length} réparations sur la fiche client
                      </button>
                    )}
                  </div>
                )}

                {/* Retour SAV button */}
                {!t.est_retour_sav && t.statut !== 'En attente de diagnostic' && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => { setRetourSAVForm({ panne: '', panne_detail: '' }); setShowRetourSAVModal(true); }}
                      className="w-full flex items-center justify-center gap-2 min-h-11 px-3 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold border border-red-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Retour SAV
                    </button>
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-[11px] text-slate-500 text-center">Messages dans le bloc Messages ci-dessous</p>
                </div>
              </>
            }
          >
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor={`${uid}-prenom`} className="input-label">Prénom</label>
                  <input id={`${uid}-prenom`} value={clientForm.prenom} onChange={e => updateClientForm({ prenom: e.target.value })} onBlur={flushSilencieux(clientSave)} className="input" autoComplete="off" />
                </div>
                <div>
                  <label htmlFor={`${uid}-nom`} className="input-label">Nom</label>
                  <input id={`${uid}-nom`} value={clientForm.nom} onChange={e => updateClientForm({ nom: e.target.value })} onBlur={flushSilencieux(clientSave)} className="input" autoComplete="off" />
                </div>
              </div>
              <div>
                <label htmlFor={`${uid}-tel`} className="input-label">Téléphone</label>
                <input id={`${uid}-tel`} type="tel" value={clientForm.telephone} onChange={e => updateClientForm({ telephone: e.target.value })} onBlur={flushSilencieux(clientSave)} className="input font-mono" autoComplete="off" />
              </div>
              <div>
                <label htmlFor={`${uid}-email`} className="input-label">Email</label>
                <input id={`${uid}-email`} type="email" value={clientForm.email} onChange={e => updateClientForm({ email: e.target.value })} onBlur={flushSilencieux(clientSave)} className="input" autoComplete="off" />
              </div>
              <div>
                <label htmlFor={`${uid}-societe`} className="input-label">Société</label>
                <input id={`${uid}-societe`} value={clientForm.societe} onChange={e => updateClientForm({ societe: e.target.value })} onBlur={flushSilencieux(clientSave)} className="input" autoComplete="off" />
              </div>
            </div>
          </EditableSection>
        );

      case 'device':
        return (
          <EditableSection
            title="Appareil" icon={Smartphone} iconBg="bg-brand-50" iconColor="text-brand-600"
            editing={editingDevice}
            autoSave={deviceSave}
            onEdit={() => setEditingDevice(true)}
            onClose={() => { finSaisieAppareil(); setEditingDevice(false); }}
            viewContent={
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
                  {[
                    { label: 'Catégorie', value: t.categorie },
                    { label: 'Marque', value: t.marque },
                    { label: 'Modèle', value: (t.modele && t.modele !== 'Autre' ? t.modele : t.modele_autre) || t.modele || '—' },
                    { label: 'Panne', value: t.panne },
                    { label: 'IMEI / N° série', value: t.imei, mono: true },
                    { label: 'Détail panne', value: t.panne_detail },
                  ].map(({ label, value, mono }) => (
                    <div key={label}>
                      <p className="text-slate-500 text-xs mb-0.5">{label}</p>
                      <p className={`font-medium text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>{value || '—'}</p>
                    </div>
                  ))}
                </div>
                {(t.pin || t.pattern) && (
                  <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-6">
                    {t.pin && (
                      <div>
                        <p className="text-slate-500 text-xs mb-1 flex items-center gap-1"><Lock className="w-3 h-3" aria-hidden="true" /> Code PIN</p>
                        <p className="text-lg font-bold font-mono text-slate-800 tracking-widest">{t.pin}</p>
                      </div>
                    )}
                    {t.pattern && (
                      <div>
                        <p className="text-slate-500 text-xs mb-1 flex items-center gap-1"><Shield className="w-3 h-3" aria-hidden="true" /> Pattern</p>
                        <PatternGrid value={t.pattern} readOnly size={120} />
                      </div>
                    )}
                  </div>
                )}
                {t.notes_client && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-lg text-sm text-amber-900">
                    <span className="font-semibold">Note client :</span> {t.notes_client}
                  </div>
                )}
              </>
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor={`${uid}-categorie`} className="input-label">Catégorie</label>
                <input id={`${uid}-categorie`} value={deviceForm.categorie} onChange={e => updateDeviceForm({ categorie: e.target.value })} onBlur={flushSilencieux(deviceSave)} className="input" />
              </div>
              <div>
                <label htmlFor="ticket-marque" className="input-label">Marque</label>
                <input id="ticket-marque" list="ticket-marques" value={deviceForm.marque} onChange={e => updateDeviceForm({ marque: e.target.value })} onBlur={flushSilencieux(deviceSave)} className="input" autoComplete="off" />
                <datalist id="ticket-marques">
                  {catalogueAppareil.marques.map(m => <option key={m} value={m} />)}
                  <option value={MARQUE_AUTRE} />
                </datalist>
              </div>
              {/* Toute édition vide modele_autre (prioritaire sur les impressions), sauf marque « Autre » où il porte le modèle */}
              <div onBlur={finSaisieAppareil}>
                <ModelCombobox
                  id="ticket-modele"
                  label="Modèle"
                  marque={deviceForm.marque}
                  modeles={catalogueAppareil.modelesDe(deviceForm.marque)}
                  loading={catalogueAppareil.loading}
                  commitOnClose
                  value={(deviceForm.modele && deviceForm.modele !== 'Autre') ? deviceForm.modele : (deviceForm.modele_autre || '')}
                  onChange={(texte, meta) => {
                    // Saisie libre : chaque frappe (délai normal) ; choix au catalogue : envoi immédiat
                    updateDeviceForm(deviceForm.marque === MARQUE_AUTRE
                      ? { modele: '', modele_autre: texte }
                      : { modele: texte, modele_autre: '' }, meta?.libre ? undefined : { wait: 0 });
                    if (!meta?.libre) finSaisieAppareil();
                  }}
                />
              </div>
              {/* Le symptôme reste le motif du client ; le forfait vit dans les lignes de prix */}
              <div onBlur={finSaisieAppareil}><AutocompleteField label="Panne (motif client)" categorie="panne" value={deviceForm.panne} onChange={v => updateDeviceForm({ panne: v })} onSelect={s => { updateDeviceForm({ panne: s.value }, { wait: 0 }); finSaisieAppareil(); }} enabled={autocompletionEnabled} placeholder="Écran cassé, Batterie..." /></div>
              <div>
                <label htmlFor={`${uid}-imei`} className="input-label">IMEI</label>
                <input id={`${uid}-imei`} data-scan-target="imei" inputMode="numeric" value={deviceForm.imei} onChange={e => updateDeviceForm({ imei: e.target.value })} onBlur={flushSilencieux(deviceSave)} className="input font-mono" autoComplete="off" />
              </div>
              <div onBlur={finSaisieAppareil}><AutocompleteField label="Détail panne" categorie="detail_panne" value={deviceForm.panne_detail} onChange={v => updateDeviceForm({ panne_detail: v })} onSelect={s => { updateDeviceForm({ panne_detail: s.value }, { wait: 0 }); finSaisieAppareil(); }} enabled={autocompletionEnabled} placeholder="Détails supplémentaires..." /></div>
              <div>
                <label htmlFor={`${uid}-pin`} className="input-label">Code PIN</label>
                <input id={`${uid}-pin`} value={deviceForm.pin} onChange={e => updateDeviceForm({ pin: e.target.value })} onBlur={flushSilencieux(deviceSave)} className="input font-mono tracking-widest" maxLength={10} autoComplete="off" />
              </div>
              <div>
                <label htmlFor={`${uid}-pattern`} className="input-label">Pattern</label>
                <input id={`${uid}-pattern`} value={deviceForm.pattern} onChange={e => updateDeviceForm({ pattern: e.target.value })} onBlur={flushSilencieux(deviceSave)} className="input font-mono" placeholder="1-5-9-6-3" autoComplete="off" />
              </div>
              <div className="col-span-2 sm:col-span-3">
                <label htmlFor={`${uid}-notes-client`} className="input-label">Note client</label>
                <textarea id={`${uid}-notes-client`} value={deviceForm.notes_client} onChange={e => updateDeviceForm({ notes_client: e.target.value })} onBlur={flushSilencieux(deviceSave)} className="input resize-none" rows={2} />
              </div>
            </div>
          </EditableSection>
        );

      case 'dates':
        return (
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center"><Calendar className="w-4 h-4 text-slate-500" aria-hidden="true" /></div>
              <h2 className="text-sm font-semibold text-slate-800">Dates</h2>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center"><span className="text-slate-600">Dépôt</span><span className="font-medium text-slate-800">{formatDate(t.date_depot)}</span></div>
              <div className="flex justify-between items-center"><span className="text-slate-600">Mise à jour</span><span className="font-medium text-slate-800">{formatDate(t.date_maj)}</span></div>
              {t.date_rendu && (
                <div className="flex justify-between items-center gap-3">
                  <span className="text-slate-600">Rendu</span>
                  <span className="font-medium text-slate-800 text-right">{formatDate(t.date_rendu)}{t.rendu_par ? ` · ${t.rendu_par}` : ''}</span>
                </div>
              )}
              {t.date_cloture && <div className="flex justify-between items-center"><span className="text-slate-600">Clôture</span><span className="font-medium text-slate-800">{formatDate(t.date_cloture)}</span></div>}
              {t.date_recuperation && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Récupération</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{t.date_recuperation}</span>
                    <LiveCountdown dateStr={t.date_recuperation} visible={widgetPrefs.countdown} />
                  </div>
                </div>
              )}
            </div>
          </div>
        );

      case 'messages':
        return (
          <MessageComposer
            ticket={t}
            onMessageSent={() => loadNotes()}
          />
        );

      case 'notes':
        return (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center"><FileText className="w-4 h-4 text-amber-600" aria-hidden="true" /></div>
                <h2 className="text-sm font-semibold text-slate-800">Notes internes</h2>
                <span className="text-[11px] text-slate-500">
                  {(() => {
                    const allNotes = [
                      ...privateNotes,
                      ...timelineEntries.filter(e => e.type === 'internal' || e.type === 'client' || e.type === 'attention'),
                    ];
                    return `${allNotes.length} note(s)`;
                  })()}
                </span>
              </div>
              <button type="button" onClick={handleAddAttention} className="btn-ghost text-xs gap-1 min-h-11 text-red-600 hover:bg-red-50" title="Ajouter flag attention">
                <Flag className="w-3.5 h-3.5" aria-hidden="true" /> Attention
              </button>
            </div>

            {/* Add note input */}
            <div className="flex gap-2 mb-4">
              <div className="flex-1 flex gap-2">
                <button type="button" onClick={() => setNotePrivate(!notePrivate)}
                  className={`shrink-0 min-w-11 min-h-11 flex items-center justify-center rounded-lg border transition-colors ${
                    notePrivate ? 'bg-slate-50 border-slate-200 text-slate-600' : 'bg-blue-50 border-blue-200 text-blue-600'
                  }`}
                  title={notePrivate ? 'Note interne' : 'Note visible client'}
                  aria-label={notePrivate ? 'Note interne (cliquer pour la rendre visible au client)' : 'Note visible par le client (cliquer pour la rendre interne)'}
                  aria-pressed={!notePrivate}>
                  {notePrivate ? <Lock className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                </button>
                <input type="text" value={noteText} onChange={e => setNoteText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                  placeholder={notePrivate ? 'Note interne...' : 'Note visible par le client...'}
                  aria-label={notePrivate ? 'Nouvelle note interne' : 'Nouvelle note visible par le client'}
                  className="input flex-1" />
              </div>
              <button type="button" onClick={handleAddNote} className="btn-primary px-3 min-w-11 min-h-11" aria-label="Ajouter la note"><Plus className="w-4 h-4" aria-hidden="true" /></button>
            </div>

            {/* Compact notes list with type badges */}
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
              {privateNotes.map(note => {
                const tn = note.type_note || 'note';
                // Détection robuste : si l'auteur est "Client" (insertion par
                // /suivi) on force le badge CLIENT même si type_note n'est pas
                // 'message_client' (compat anciennes notes / data legacy).
                const isClientMsg = tn === 'message_client'
                  || (note.auteur || '').trim().toLowerCase() === 'client';
                // Badge selon le type de note : on identifie visuellement
                // CLIENT (message via /suivi), ACCORD (validation devis), AVIS,
                // et les canaux d'envoi staff (WhatsApp/SMS/Email).
                const badge = isClientMsg ? { bg: 'bg-violet-100 text-violet-800 ring-1 ring-violet-300', label: '💬 CLIENT' }
                  : tn === 'whatsapp' ? { bg: 'bg-green-100 text-green-800', label: 'WhatsApp' }
                  : tn === 'sms' ? { bg: 'bg-blue-100 text-blue-800', label: 'SMS' }
                  : tn === 'email' ? { bg: 'bg-amber-100 text-amber-800', label: 'Email' }
                  : tn === 'validation_devis' ? { bg: 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300', label: '✅ ACCORD' }
                  : tn === 'avis_client' ? { bg: 'bg-yellow-100 text-yellow-800 ring-1 ring-yellow-300', label: '⭐ AVIS' }
                  : null;
                const isTechNote = note.auteur?.toLowerCase().includes('tech');
                const textColor = note.important ? 'text-red-700 font-semibold'
                  : isClientMsg ? 'text-violet-800 font-medium'
                  : badge ? 'text-slate-700'
                  : isTechNote ? 'text-blue-700'
                  : 'text-emerald-700';
                return (
                  <div key={`db-${note.id}`} className={`flex items-start gap-2 py-1.5 ${isClientMsg ? 'bg-violet-50/40 -mx-2 px-2 rounded' : ''}`}>
                    {badge && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 mt-0.5 ${badge.bg}`}>
                        {badge.label}
                      </span>
                    )}
                    {!badge && tn === 'note' && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 uppercase tracking-wider shrink-0 mt-0.5">
                        {note.auteur || 'Note'}
                      </span>
                    )}
                    <span className={`text-sm flex-1 min-w-0 ${textColor}`}>{note.contenu}</span>
                    <span className="text-[11px] text-slate-500 whitespace-nowrap shrink-0 mt-0.5">
                      {note.date_creation ? new Date(note.date_creation).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : ''}
                    </span>
                    <button type="button" onClick={() => { if (confirm('Supprimer cette note ?')) handleDeleteNote(note.id); }} className="min-w-11 min-h-11 -my-2 flex items-center justify-center text-slate-400 hover:text-red-600 shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 rounded" title="Supprimer" aria-label="Supprimer cette note">
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              {timelineEntries.filter(e => e.type !== 'history').map((entry) => {
                const textColor = entry.type === 'attention' ? 'text-red-700 font-semibold' : entry.type === 'internal' ? 'text-blue-700' : 'text-emerald-700';
                return (
                  <div key={`tl-${entry.raw}`} className="flex items-start gap-2 py-1.5">
                    <span className={`text-sm flex-1 min-w-0 ${textColor}`}>{entry.text}</span>
                    {entry.timestamp && <span className="text-[11px] text-slate-500 whitespace-nowrap shrink-0 mt-0.5">{entry.timestamp}</span>}
                    <button type="button" onClick={() => { if (confirm('Supprimer cette note ?')) handleDeleteInternalNote(entry.raw); }} className="min-w-11 min-h-11 -my-2 flex items-center justify-center text-slate-400 hover:text-red-600 shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 rounded" title="Supprimer" aria-label="Supprimer cette entrée">
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              {privateNotes.length === 0 && timelineEntries.filter(e => e.type !== 'history').length === 0 && (
                <p className="text-xs text-slate-500 text-center py-3">Aucune note</p>
              )}
            </div>

            {/* Timeline history */}
            {timelineEntries.filter(e => e.type === 'history').length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">Historique</p>
                <div className="relative max-h-48 overflow-y-auto pl-4">
                  <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-slate-200" aria-hidden="true" />
                  <div className="space-y-0.5">
                    {timelineEntries.filter(e => e.type === 'history').map((entry, i) => (
                      <div key={`hist-${entry.timestamp || ''}-${i}`} className="relative flex items-start gap-3 py-1.5 px-2 rounded-lg hover:bg-slate-50 transition-colors">
                        <div className="absolute -left-4 top-3 w-2 h-2 rounded-full bg-brand-400 z-10" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-600">{entry.text}</p>
                          {entry.timestamp && <span className="text-[11px] text-slate-500">{entry.timestamp}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case 'reparation':
        return (
          <section className="card p-5" aria-labelledby={`${uid}-reparation`}>
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center"><Wrench className="w-4 h-4 text-emerald-600" aria-hidden="true" /></div>
                <h2 id={`${uid}-reparation`} className="text-sm font-semibold text-slate-800">Réparation & Tarifs</h2>
                {afficherIndicateur(editingPricing, pricingSave) && <AutoSaveIndicator etat={pricingSave} />}
              </div>
              {!editingPricing ? (
                <button type="button" onClick={() => setEditingPricing(true)} className="btn-ghost p-0 min-w-11 min-h-11 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" title="Modifier" aria-label="Modifier la réparation et les tarifs"><Edit3 className="w-3.5 h-3.5" aria-hidden="true" /></button>
              ) : (
                <button type="button" onClick={() => { flushSilencieux(pricingSave)(); setEditingPricing(false); }} className="btn-ghost text-xs px-3 min-h-11 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"><X className="w-3.5 h-3.5" aria-hidden="true" /> Fermer</button>
              )}
            </div>

            {/* 1. Technicien assigné — EN HAUT */}
            <div className="mb-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
              <label htmlFor={`${uid}-tech`} className="block text-[11px] text-slate-600 uppercase tracking-wider mb-2">Technicien assigné</label>
              <select
                id={`${uid}-tech`}
                value={t.technicien_assigne || ''}
                onChange={(e) => {
                  const nom = e.target.value;
                  const oldTech = ticketRef.current?.technicien_assigne || '';
                  if (nom === oldTech) return;
                  fusionnerTicket({ technicien_assigne: nom || null }, null);
                  api.updateTicket(id, { technicien_assigne: nom || null })
                    .then(() => {
                      invaliderListes();
                      toast.success(nom ? `Assigné à ${nom}` : 'Technicien retiré');
                    })
                    .catch(() => {
                      fusionnerTicket({ technicien_assigne: oldTech || null }, null);
                      toast.error('Erreur assignation');
                    });
                }}
                className="w-full min-h-11 px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold bg-white cursor-pointer"
                style={{ WebkitAppearance: 'menulist', fontSize: '16px' }}
              >
                <option value="">— Non assigné —</option>
                {Array.isArray(teamMembers) && teamMembers.map(m => (
                  <option key={m.id} value={m.nom}>{m.nom}{m.role ? ` (${m.role})` : ''}</option>
                ))}
              </select>
              {t.personne_charge && (
                <p className="text-[11px] text-slate-500 mt-2">Prise en charge : <span className="font-medium text-slate-700">{t.personne_charge}</span></p>
              )}
            </div>

            {editingPricing ? (
              /* ─── Edit mode ─── */
              <div className="space-y-4">
                {/* 1. Lignes de réparation */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="input-label mb-0">Lignes de réparation</span>
                    <button type="button" onClick={addRepairLine} className="btn-ghost text-xs px-3 min-h-11"><Plus className="w-3 h-3" aria-hidden="true" /> Ajouter</button>
                  </div>
                  <datalist id={`${uid}-prestations`}>
                    {(prestations?.prestations || []).map(p => <option key={p.cle} value={p.prestation} />)}
                  </datalist>
                  <div className="space-y-2">
                    {repairLines.map((line, i) => {
                      const label = String(line.label || '').trim();
                      const cmd = commandeDe(label);
                      const enCours = label ? commandesEnCours.has(label) : false;
                      return (
                        <div key={i} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <input
                              value={line.label}
                              list={`${uid}-prestations`}
                              onChange={e => updateRepairLine(i, 'label', e.target.value)}
                              onBlur={flushSilencieux(pricingSave)}
                              className="input flex-1 min-w-0"
                              placeholder="Description réparation"
                              aria-label={`Description de la ligne ${i + 1}`}
                              autoComplete="off"
                            />
                            <div className="relative w-28 shrink-0">
                              <input
                                type="number" step="0.01" inputMode="decimal"
                                value={line.prix}
                                onChange={e => updateRepairLine(i, 'prix', e.target.value)}
                                onBlur={flushSilencieux(pricingSave)}
                                className="input text-right pr-7"
                                placeholder="0"
                                aria-label={`Prix de la ligne ${i + 1} en euros`}
                              />
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500" aria-hidden="true">€</span>
                            </div>
                            {repairLines.length > 1 && (
                              <button type="button" onClick={() => removeRepairLine(i)} className="btn-ghost p-0 min-w-11 min-h-11 shrink-0 text-red-500 hover:text-red-700" aria-label={`Supprimer la ligne ${i + 1}`}>
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                          {!label && prixNombre(line.prix) > 0 && (
                            <p className="text-[11px] text-amber-800 ml-1">Ajoutez une description : sans elle, cette ligne n'est ni comptée ni imprimée.</p>
                          )}
                          {label && (
                            <label className="inline-flex items-center gap-1.5 ml-1 min-h-11 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!cmd}
                                disabled={enCours}
                                onChange={(e) => basculerCommandeLigne(line, e.target.checked)}
                                className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                              />
                              <span className="text-[11px] text-amber-800 font-medium"><Package className="w-3 h-3 inline mr-0.5" aria-hidden="true" />Pièce à commander</span>
                              {badgeCommande(cmd)}
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Qualité écran + Date récupération */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`${uid}-ecran`} className="input-label">Qualité écran</label>
                    <select id={`${uid}-ecran`} value={pricingForm.type_ecran} onChange={e => updatePricingForm({ type_ecran: e.target.value }, { wait: 0 })} className="input min-h-11">
                      <option value="">—</option>
                      <option value="Original">Original (OEM)</option>
                      <option value="Original reconditionné">Original reconditionné</option>
                      <option value="Compatible Premium">Compatible Premium</option>
                      <option value="Compatible">Compatible</option>
                      <option value="OLED">OLED</option>
                      <option value="OLED Premium">OLED Premium</option>
                      <option value="Incell">Incell</option>
                      <option value="LCD">LCD</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`${uid}-recup`} className="input-label">Date récupération</label>
                    <input id={`${uid}-recup`} type="datetime-local" value={pricingForm.date_recuperation} onChange={e => updatePricingForm({ date_recuperation: e.target.value })} onBlur={flushSilencieux(pricingSave)} className="input min-h-11" />
                  </div>
                </div>

                {/* 3. Séparateur tarification + toggle Devis/Facture */}
                <div className="relative py-1" aria-hidden="true">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
                  <div className="relative flex justify-center"><span className="bg-white px-3 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Tarification</span></div>
                </div>

                {/* Toggle Devis / Facture */}
                <div className="flex items-center gap-2" role="group" aria-labelledby={`${uid}-typedoc`}>
                  <span id={`${uid}-typedoc`} className="input-label mb-0 flex items-center gap-1"><FileText className="w-3 h-3" aria-hidden="true" /> Type de document</span>
                  <div className="flex bg-slate-100 rounded-lg p-0.5 text-[11px] font-semibold">
                    <button type="button" aria-pressed={(pricingForm.type_document || 'devis') === 'devis'} onClick={() => updatePricingForm({ type_document: 'devis' }, { wait: 0 })}
                      className={`px-3 min-h-11 rounded-md transition-colors ${(pricingForm.type_document || 'devis') === 'devis' ? 'bg-white shadow-sm text-brand-700' : 'text-slate-600'}`}>Devis</button>
                    <button type="button" aria-pressed={pricingForm.type_document === 'facture'} onClick={() => updatePricingForm({ type_document: 'facture' }, { wait: 0 })}
                      className={`px-3 min-h-11 rounded-md transition-colors ${pricingForm.type_document === 'facture' ? 'bg-white shadow-sm text-brand-700' : 'text-slate-600'}`}>Facture</button>
                  </div>
                </div>

                {/* 4. Devis estimé */}
                <div>
                  <label htmlFor={`${uid}-devis`} className="input-label">Devis estimé (avant diagnostic)</label>
                  <div className="relative"><input id={`${uid}-devis`} type="number" step="0.01" inputMode="decimal" value={pricingForm.devis_estime} onChange={e => updatePricingForm({ devis_estime: e.target.value })} onBlur={flushSilencieux(pricingSave)} className="input pr-7" placeholder="0" /><span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500" aria-hidden="true">€</span></div>
                </div>

                {/* 5. Réduction — toggle % / € */}
                <div>
                  <div className="flex items-center gap-2 mb-2" role="group" aria-labelledby={`${uid}-reduc`}>
                    <span id={`${uid}-reduc`} className="input-label mb-0 flex items-center gap-1"><Percent className="w-3 h-3" aria-hidden="true" /> Réduction</span>
                    <div className="flex bg-slate-100 rounded-lg p-0.5 text-[11px] font-semibold">
                      <button type="button" aria-pressed={reductionMode === 'pct'} aria-label="Réduction en pourcentage" onClick={() => changerModeReduction('pct')}
                        className={`px-3 min-h-11 min-w-11 rounded-md transition-colors ${reductionMode === 'pct' ? 'bg-white shadow-sm text-brand-700' : 'text-slate-600'}`}>%</button>
                      <button type="button" aria-pressed={reductionMode === 'eur'} aria-label="Réduction en euros" onClick={() => changerModeReduction('eur')}
                        className={`px-3 min-h-11 min-w-11 rounded-md transition-colors ${reductionMode === 'eur' ? 'bg-white shadow-sm text-brand-700' : 'text-slate-600'}`}>€</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="relative">
                      <input type="number" step="1" min="0" max="100" inputMode="decimal"
                        aria-label="Réduction en pourcentage"
                        value={reductionMode === 'pct' ? pricingForm.reduction_pourcentage : (totalRepairs > 0 && reductionMontant > 0 ? (reductionMontant / totalRepairs * 100).toFixed(1) : '')}
                        onChange={reductionMode === 'pct' ? (e => updatePricingForm({ reduction_pourcentage: e.target.value, reduction_montant: '' })) : undefined}
                        onBlur={flushSilencieux(pricingSave)}
                        readOnly={reductionMode !== 'pct'}
                        className={`input pr-7 ${reductionMode !== 'pct' ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`} placeholder="0" />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500" aria-hidden="true">%</span>
                    </div>
                    <div className="relative">
                      <input type="number" step="0.01" inputMode="decimal"
                        aria-label="Réduction en euros"
                        value={reductionMode === 'eur' ? pricingForm.reduction_montant : (totalRepairs > 0 && reductionPct > 0 ? (totalRepairs * reductionPct / 100).toFixed(2) : '')}
                        onChange={reductionMode === 'eur' ? (e => updatePricingForm({ reduction_montant: e.target.value, reduction_pourcentage: '' })) : undefined}
                        onBlur={flushSilencieux(pricingSave)}
                        readOnly={reductionMode !== 'eur'}
                        className={`input pr-7 ${reductionMode !== 'eur' ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`} placeholder="0" />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500" aria-hidden="true">€</span>
                    </div>
                  </div>
                </div>

                {/* 6. Acompte versé */}
                <div>
                  <label htmlFor={`${uid}-acompte`} className="input-label">Acompte versé</label>
                  <div className="relative"><input id={`${uid}-acompte`} type="number" step="0.01" inputMode="decimal" value={pricingForm.acompte} onChange={e => updatePricingForm({ acompte: e.target.value })} onBlur={flushSilencieux(pricingSave)} className="input pr-7" placeholder="0" /><span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500" aria-hidden="true">€</span></div>
                </div>

                {/* 7. Bloc récapitulatif */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                  {useDevisEstime && (
                    <div className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 mb-1.5">
                      <Sparkles className="w-3 h-3" aria-hidden="true" />
                      <span>Estimation forfaitaire (pas de détail des lignes)</span>
                    </div>
                  )}
                  {(() => {
                    const ht = tvaRate > 0 ? totalRepairs / (1 + tvaRate / 100) : totalRepairs;
                    const tva = totalRepairs - ht;
                    const htLabel = useDevisEstime ? 'Devis estimé HT' : 'Total lignes HT';
                    return (
                      <>
                        <div className="flex justify-between text-sm"><span className="text-slate-600">{htLabel}</span><span className="font-semibold text-slate-800">{formatPrix(ht)}</span></div>
                        <div className="flex justify-between text-sm"><span className="text-slate-600">TVA ({tvaRate || 0}%)</span><span className="font-medium text-slate-700">{formatPrix(tva)}</span></div>
                        <div className="flex justify-between text-sm font-bold border-t border-slate-200 pt-1"><span className="text-slate-800">Total TTC</span><span className="text-slate-900">{formatPrix(totalRepairs)}</span></div>
                      </>
                    );
                  })()}
                  {effectiveReduction > 0 && <div className="flex justify-between text-sm text-emerald-700"><span>Réduction{reductionMode === 'pct' && reductionPct > 0 ? ` (${reductionPct}%)` : ''}</span><span className="font-medium">- {formatPrix(effectiveReduction)}</span></div>}
                  <div className="flex justify-between text-sm font-bold"><span className="text-slate-800">{(pricingForm.type_document || 'devis') === 'devis' ? 'Montant du devis' : 'Tarif final'}</span><span className="text-slate-900">{formatPrix(totalNet)}</span></div>
                  {montants.acompte > 0 && <div className="flex justify-between text-sm"><span className="text-slate-600">Acompte versé</span><span className="font-medium text-blue-700">- {formatPrix(montants.acompte)}</span></div>}
                  <div className={`flex justify-between text-base font-extrabold border-t-2 border-slate-300 pt-2 mt-1 ${reste > 0 ? 'text-red-700' : 'text-emerald-700'}`}><span>RESTE À PAYER</span><span>{formatPrix(Math.max(0, reste))}</span></div>
                </div>

                {/* 8. Bouton payé */}
                <button type="button"
                  disabled={paying}
                  aria-busy={paying || undefined}
                  onClick={() => (t.paye ? demarquerPaiement() : ouvrirPaiement())}
                  className={`w-full min-h-12 rounded-xl text-sm font-bold transition-colors disabled:opacity-60 ${
                    t.paye ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-800 border-2 border-emerald-300 hover:bg-emerald-100'
                  }`}>
                  <CheckCircle2 className="w-4 h-4 inline mr-1.5" aria-hidden="true" />{t.paye ? 'Payé ✓' : 'Marquer comme payé'}
                </button>
              </div>
            ) : (
              /* ─── View mode ─── */
              <>
                {/* Document type badge */}
                <div className="mb-3 flex items-center gap-2">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                    (t.type_document || 'devis') === 'facture' ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600'
                  }`}>
                    <FileText className="w-3 h-3 inline mr-0.5" aria-hidden="true" />{(t.type_document || 'devis') === 'facture' ? 'Facture' : 'Devis'}
                  </span>
                </div>

                {/* Repair lines */}
                <div className="mb-3">
                  {lignesAffichees.map((line, i) => (
                    <div key={i} className="py-2 border-b border-slate-50 last:border-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="text-sm font-medium text-slate-700">{line.label}</span>
                          {t.type_ecran && i === indexEcran && (
                            <span className="text-[11px] font-semibold text-violet-700 bg-violet-50 px-2 py-0.5 rounded">{t.type_ecran}</span>
                          )}
                          {badgeCommande(commandeDe(line.label), true)}
                        </div>
                        {prixLigne(line.prix)}
                      </div>
                    </div>
                  ))}
                  {lignesAffichees.length === 0 && (
                    <p className="text-sm text-slate-500 italic py-2">Aucune réparation enregistrée</p>
                  )}
                </div>

                {/* Pièces commandées (compact) */}
                {commandes.length > 0 && (
                  <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="text-[11px] font-bold text-amber-900 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <Package className="w-3 h-3" aria-hidden="true" /> {commandes.length} pièce(s) commandée(s)
                    </div>
                    {commandes.map(cmd => (
                      <div key={cmd.id} className="flex items-center justify-between py-1 text-xs">
                        <span className="text-slate-700 font-medium">{cmd.description}</span>
                        <span className={`font-bold px-1.5 py-0.5 rounded-full text-[10px] ${
                          cmd.statut === 'Reçu' ? 'bg-green-100 text-green-800' :
                          cmd.statut === 'Commandée' ? 'bg-blue-100 text-blue-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>{cmd.statut || 'En attente'}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Récap tarification */}
                <div className="border-t border-slate-200 mt-2 pt-2 space-y-1">
                  {montantsServeur?.refus_devis && (
                    <div className="flex items-center gap-1.5 text-[11px] text-red-800 bg-red-50 border border-red-200 rounded-md px-2 py-1 mb-1.5">
                      <X className="w-3 h-3" aria-hidden="true" />
                      <span>Devis refusé : seuls les frais (diagnostic…) sont dus</span>
                    </div>
                  )}
                  {useDevisEstime && (
                    <div className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 mb-1.5">
                      <Sparkles className="w-3 h-3" aria-hidden="true" />
                      <span>Estimation forfaitaire (pas de détail des lignes)</span>
                    </div>
                  )}
                  {(() => {
                    const ht = tvaRate > 0 ? totalRepairs / (1 + tvaRate / 100) : totalRepairs;
                    const tva = totalRepairs - ht;
                    const htLabel = useDevisEstime ? 'Devis estimé HT' : 'Total lignes HT';
                    return (
                      <>
                        <div className="flex justify-between text-sm"><span className="text-slate-600">{htLabel}</span><span className="font-semibold text-slate-800">{formatPrix(ht)}</span></div>
                        <div className="flex justify-between text-sm"><span className="text-slate-600">TVA ({tvaRate || 0}%)</span><span className="font-medium text-slate-700">{formatPrix(tva)}</span></div>
                        <div className="flex justify-between text-sm font-bold border-t border-slate-200 pt-1"><span className="text-slate-800">Total TTC</span><span className="text-slate-900">{formatPrix(totalRepairs)}</span></div>
                      </>
                    );
                  })()}
                  {effectiveReduction > 0 && (
                    <div className="flex justify-between text-sm text-emerald-700">
                      <span className="flex items-center gap-1"><Percent className="w-3 h-3" aria-hidden="true" /> Réduction{reductionMode === 'pct' && reductionPct > 0 ? ` (${reductionPct}%)` : ''}</span>
                      <span className="font-medium">- {formatPrix(effectiveReduction)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold"><span className="text-slate-800">{(t.type_document || 'devis') === 'devis' ? 'Montant du devis' : 'Tarif final'}</span><span className="text-slate-900">{formatPrix(totalNet)}</span></div>
                  {montants.acompte > 0 && <div className="flex justify-between text-sm"><span className="text-slate-600">Acompte versé</span><span className="font-medium text-blue-700">- {formatPrix(montants.acompte)}</span></div>}
                </div>

                {/* Reste à payer / Payé */}
                {t.paye ? (
                  <div className="mt-3 px-4 py-3 rounded-xl bg-gradient-to-r from-emerald-100 to-green-100 border border-emerald-300 text-center">
                    <span className="font-extrabold text-emerald-800 text-[15px]">PAYÉ</span>
                    <div className="text-xs text-emerald-800 mt-0.5">Reste à payer : 0,00 €</div>
                  </div>
                ) : reste > 0 ? (
                  <div className="flex justify-between mt-3 px-4 py-3 rounded-xl bg-gradient-to-r from-red-50 to-orange-50 border border-red-200">
                    <span className="font-extrabold text-red-700 text-[15px]">RESTE À PAYER</span>
                    <span className="font-extrabold text-red-700 text-[15px]">{formatPrix(reste)}</span>
                  </div>
                ) : null}

                {/* Action buttons */}
                <div className="flex gap-2 mt-3 flex-wrap">
                  <button type="button"
                    disabled={paying}
                    aria-busy={paying || undefined}
                    onClick={() => (t.paye ? demarquerPaiement() : ouvrirPaiement())}
                    className={`flex-1 min-h-11 px-3 rounded-xl text-xs font-bold transition-colors disabled:opacity-60 ${
                      t.paye ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-800 border-2 border-emerald-300 hover:bg-emerald-100'
                    }`}>
                    <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />{t.paye ? 'Payé ✓' : 'Marquer comme payé'}
                  </button>
                  {caisseEnabled && (
                    <button type="button" onClick={handleSendCaisse} disabled={envoiCaisse} aria-busy={envoiCaisse || undefined}
                      className="min-h-11 px-3 rounded-xl bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-60 inline-flex items-center gap-1">
                      {envoiCaisse
                        ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full motion-safe:animate-spin" aria-hidden="true" />
                        : <Zap className="w-3.5 h-3.5" aria-hidden="true" />}
                      Caisse
                    </button>
                  )}
                  <button type="button" onClick={openAccordModal} className="min-h-11 px-3 rounded-xl bg-orange-50 text-orange-800 text-xs font-semibold border border-orange-200 hover:bg-orange-100">
                    <AlertTriangle className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />Accord
                  </button>
                </div>
              </>
            )}
          </section>
        );

      case 'status':
        return (
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: getStatusConfig(t.statut).color + '20' }}>
                <ChevronDown className="w-4 h-4" style={{ color: getStatusConfig(t.statut).color }} aria-hidden="true" />
              </div>
              <h2 id={`${uid}-statut`} className="text-sm font-semibold text-slate-800">Changer le statut</h2>
            </div>
            <select
              aria-labelledby={`${uid}-statut`}
              value={t.statut}
              disabled={statutEnCours}
              aria-busy={statutEnCours || undefined}
              onChange={e => handleStatusChange(e.target.value)}
              className="w-full min-h-12 py-3 px-4 text-base font-semibold rounded-xl border-2 transition-colors cursor-pointer appearance-none bg-no-repeat disabled:opacity-60"
              style={{
                borderColor: getStatusConfig(t.statut).color,
                color: getStatusConfig(t.statut).color,
                backgroundColor: getStatusConfig(t.statut).color + '10',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(getStatusConfig(t.statut).color)}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundPosition: 'right 12px center',
                backgroundSize: '20px',
              }}
            >
              {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {proposerRemise && <div className="mt-3">{boutonRendre('grand')}</div>}
            {t.statut === 'Rendu au client' && !t.paye && (
              <button type="button" onClick={() => ouvrirPaiement({ cloturer: true })}
                className="mt-3 w-full min-h-12 px-4 rounded-xl bg-red-50 hover:bg-red-100 text-red-800 border border-red-200 text-sm font-bold transition-colors">
                Encaisser le solde {resteDu > 0 ? `(${formatPrix(resteDu)})` : ''}
              </button>
            )}
            {/* Accord client — quick response buttons */}
            {t.statut === "En attente d'accord client" && !devisRefuse && (
              <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-xl space-y-2">
                <p className="text-[11px] font-semibold text-orange-800 uppercase tracking-wider">Réponse du client</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleAccordResponse(true)}
                    disabled={statutEnCours}
                    className="flex-1 min-h-11 px-3 rounded-lg bg-emerald-50 text-emerald-800 text-xs font-bold border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-60"
                  >
                    <Check className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />Client a validé
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAccordResponse(false)}
                    disabled={statutEnCours}
                    className="flex-1 min-h-11 px-3 rounded-lg bg-red-50 text-red-700 text-xs font-bold border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-60"
                  >
                    <X className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />Client a refusé
                  </button>
                </div>
              </div>
            )}
            <RepairTimer ticket={t} visible={widgetPrefs.timer} />
          </div>
        );

      case 'queue':
        if (!widgetPrefs.queue) return null;
        return (
          <RepairQueue
            open={true}
            onClose={() => {}}
            currentTicketId={parseInt(id)}
            basePath={basePath}
            user={user}
            inline
          />
        );

      case 'fidelite':
        return t.client_id && !isTech ? <FideliteCard clientId={t.client_id} /> : null;

      default:
        return null;
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Dark Header — spacious (motion fadeUp pattern Claude Design) */}
      <motion.div
        initial={reduireAnimations ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduireAnimations ? 0 : 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="bg-gradient-to-br from-slate-800 to-slate-900 text-white px-4 sm:px-6 lg:px-8 py-8 sm:py-10 -mx-4 sm:-mx-6 lg:-mx-8 -mt-4 sm:-mt-6 lg:-mt-8 mb-6">
        <div className="max-w-7xl mx-auto">
          {/* Top row: back button */}
          <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-1.5 min-h-11 text-slate-300 hover:text-white transition-colors mb-3 -ml-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 rounded-lg px-1">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs font-medium">Retour</span>
          </button>

          <div className="flex flex-col sm:flex-row sm:items-start gap-5">
            {/* Left: ticket info */}
            <div className="flex-1 min-w-0 space-y-3">
              {/* Ticket code */}
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-display font-bold text-white font-mono tracking-tight">{t.ticket_code}</h1>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="min-w-11 min-h-11 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                  title="Copier le code"
                  aria-label={copied ? 'Code copié' : 'Copier le code du ticket'}
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" aria-hidden="true" /> : <Copy className="w-4 h-4 text-slate-300" aria-hidden="true" />}
                </button>
                {t.est_retour_sav && (
                  <span className="liquid-glass px-2.5 py-1 rounded-full text-red-300 text-xs font-bold flex items-center gap-1">
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> SAV
                  </span>
                )}
                {t.source === 'distance' && (
                  <span className="liquid-glass px-2.5 py-1 rounded-full text-indigo-300 text-xs font-bold flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5" aria-hidden="true" /> <span className="font-editorial font-normal">Distance</span>
                  </span>
                )}
                {t.paye ? (
                  <span className="liquid-glass px-2.5 py-1 rounded-full text-emerald-300 text-xs font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> <span className="font-editorial font-normal">Payé</span>
                  </span>
                ) : null}
              </div>

              {/* Summary line */}
              <div className="text-sm text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="flex items-center gap-1"><User className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" /> {t.client_prenom || ''} {t.client_nom || ''}</span>
                <span className="text-slate-500" aria-hidden="true">•</span>
                <span className="flex items-center gap-1"><Smartphone className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" /> {appareil || '—'}</span>
                <span className="text-slate-500" aria-hidden="true">•</span>
                <span className="flex items-center gap-1">
                  <Wrench className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  {lignesAffichees.length > 0
                    ? lignesAffichees.map(l => l.label).join(' + ')
                    : (t.panne || '—')}
                </span>
                <span className="text-slate-500" aria-hidden="true">•</span>
                <span className="font-semibold text-emerald-400">{surDevisSansPrix ? 'Sur devis' : formatPrix(totalTTC || 0)}</span>
                {!t.paye && reste > 0 && <span className="text-xs bg-amber-500/20 text-amber-200 px-2 py-0.5 rounded-full">Reste {formatPrix(reste)}</span>}
              </div>
              {t.client_tel && (
                <a href={`tel:${t.client_tel}`} className="inline-flex items-center min-h-11 text-sm text-slate-300 hover:text-white font-mono transition-colors">{t.client_tel}</a>
              )}
            </div>

            {/* Right: status badge + print */}
            <div className="flex sm:flex-col items-center sm:items-end gap-3 shrink-0 flex-wrap">
              <StatusBadge statut={t.statut} size="lg" />
              {proposerRemise && boutonRendre()}
              <button type="button" onClick={() => setShowPrintDrawer(true)}
                className="flex items-center gap-2 min-h-11 px-4 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
                <Printer className="w-4 h-4" aria-hidden="true" /> Imprimer
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Bannière statut devis — verte si validé, rouge si refusé, orange si en attente */}
      {(() => {
        if (!devisRefuse && decisionDevis && String(decisionDevis.contenu || '').trim().startsWith('✅')) {
          const dateStr = decisionDevis.date_creation
            ? new Date(decisionDevis.date_creation).toLocaleString('fr-FR', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })
            : null;
          return (
            <div
              role="status"
              aria-live="polite"
              className="bg-emerald-50 border-l-4 border-emerald-500 px-4 sm:px-6 lg:px-8 py-3 -mx-4 sm:-mx-6 lg:-mx-8 mb-2"
            >
              <div className="max-w-7xl mx-auto flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-emerald-900">Client a validé le devis</p>
                  {dateStr && <p className="text-xs text-emerald-800">Validé le {dateStr}</p>}
                </div>
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" aria-hidden="true" />
                  Confirmé
                </span>
              </div>
            </div>
          );
        }

        if (devisRefuse) {
          return (
            <div role="status" aria-live="polite" className="bg-red-50 border-l-4 border-red-500 px-4 sm:px-6 lg:px-8 py-3 -mx-4 sm:-mx-6 lg:-mx-8 mb-2">
              <div className="max-w-7xl mx-auto flex items-center gap-3 flex-wrap">
                <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                  <X className="w-4 h-4 text-red-600" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-red-900">Devis refusé par le client</p>
                  <p className="text-xs text-red-800">
                    L'appareil est à rendre en l'état (bouton « Rendre au client »).
                    {t.montants?.refus_devis && ` Seuls les frais (diagnostic…) sont dus : ${formatPrix(Number(t.montants.total) || 0)}.`}
                  </p>
                </div>
              </div>
            </div>
          );
        }

        if (t.statut === "En attente d'accord client") {
          return (
            <div
              role="status"
              aria-live="polite"
              className="bg-amber-50 border-l-4 border-amber-500 px-4 sm:px-6 lg:px-8 py-3 -mx-4 sm:-mx-6 lg:-mx-8 mb-2"
            >
              <div className="max-w-7xl mx-auto flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4 text-amber-600" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-amber-900">En attente de l'accord client</p>
                  <p className="text-xs text-amber-800">Le devis a été envoyé, le client n'a pas encore validé. Pense à le relancer.</p>
                </div>
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 motion-safe:animate-pulse" aria-hidden="true" />
                  À relancer
                </span>
              </div>
            </div>
          );
        }

        return null;
      })()}

      {/* Retour SAV banner (red) */}
      {t.est_retour_sav && (
        <div className="bg-red-50 border-l-4 border-red-500 px-4 sm:px-6 lg:px-8 py-3 -mx-4 sm:-mx-6 lg:-mx-8 mb-2">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
              <RotateCcw className="w-4 h-4 text-red-600" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-red-900">RETOUR SAV</p>
              <p className="text-xs text-red-800">
                Prise en charge garantie — Montant : 0,00 €
                {t.ticket_original && (
                  <> — Ticket original : <button type="button" onClick={() => navigate(`${basePath}/ticket/${t.ticket_original.id}`)} className="font-mono font-bold underline hover:text-red-900 min-h-11">{t.ticket_original.ticket_code}</button> ({t.ticket_original.statut})</>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Warning: retours SAV sur ce ticket (yellow) */}
      {t.retours_sav && t.retours_sav.length > 0 && (
        <div className="bg-amber-50 border-l-4 border-amber-500 px-4 sm:px-6 lg:px-8 py-3 -mx-4 sm:-mx-6 lg:-mx-8 mb-2">
          <div className="max-w-7xl mx-auto flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-900">{t.retours_sav.length} retour{t.retours_sav.length > 1 ? 's' : ''} SAV lié{t.retours_sav.length > 1 ? 's' : ''}</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {t.retours_sav.map(r => (
                  <button key={r.id} type="button" onClick={() => navigate(`${basePath}/ticket/${r.id}`)}
                    className="min-h-11 text-xs font-mono font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 px-2 py-1 rounded-lg transition-colors">
                    {r.ticket_code} <span className="font-normal">({r.statut})</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dépôt à distance — validation banner */}
      {t.statut === 'Pré-enregistré' && t.source === 'distance' && (
        <div className="bg-indigo-50 border-l-4 border-indigo-500 px-4 sm:px-6 lg:px-8 py-3 -mx-4 sm:-mx-6 lg:-mx-8 mb-2">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
              <Globe className="w-4 h-4 text-indigo-600" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-indigo-900">Dépôt à distance — En attente de validation</p>
              <p className="text-xs text-indigo-800">Le client a pré-enregistré cet appareil en ligne</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await api.validerDepot(t.id);
                    toast.success('Dépôt validé — passage en diagnostic');
                    loadTicket(false);
                  } catch (err) { toast.error(err.message); }
                }}
                className="btn-primary text-xs px-3 min-h-11 bg-emerald-600 hover:bg-emerald-700"
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" /> Valider
              </button>
              <button
                type="button"
                onClick={() => {
                  const motif = prompt('Motif du refus :');
                  if (motif === null) return;
                  api.refuserDepot(t.id, motif || 'Non précisé')
                    .then(() => { toast.success('Dépôt refusé'); loadTicket(false); })
                    .catch(err => toast.error(err.message));
                }}
                className="btn-ghost text-xs px-3 min-h-11 text-red-700 hover:bg-red-50"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" /> Refuser
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Accord client modal */}
      {showAccordModal && (
        <Modal labelledBy={`${uid}-accord-titre`} onClose={() => setShowAccordModal(false)} busy={accordLoading} panelClassName="max-w-lg p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-orange-600" aria-hidden="true" />
            </div>
            <div>
              <h3 id={`${uid}-accord-titre`} className="text-lg font-display font-bold text-slate-900">Demande d'accord client</h3>
              <p className="text-sm text-slate-600">
                {t.ticket_code} — {t.client_prenom} {t.client_nom}
              </p>
            </div>
            <button type="button" onClick={() => setShowAccordModal(false)} className="ml-auto btn-ghost p-0 min-w-11 min-h-11" aria-label="Fermer">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Recap réparations */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl mb-4">
            <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2">Récapitulatif des réparations</div>
            {lignesAffichees.map((line, i) => (
              <div key={i} className="flex justify-between gap-2 py-1.5 border-b border-slate-100 last:border-0">
                <span className="text-sm text-slate-700">
                  {line.label}
                  {t.type_ecran && i === indexEcran && (
                    <span className="text-[11px] font-semibold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded ml-2">{t.type_ecran}</span>
                  )}
                </span>
                <span className="text-sm font-bold text-slate-800">{formatPrix(prixNombre(line.prix))}</span>
              </div>
            ))}
            <div className="flex justify-between pt-2 mt-1 border-t border-slate-300">
              <span className="text-sm font-bold text-slate-900">Montant du devis</span>
              <span className="text-sm font-bold text-emerald-800">{formatPrix(totalNet)}</span>
            </div>
          </div>

          {/* Message éditable */}
          <div className="mb-4">
            <label htmlFor={`${uid}-accord-msg`} className="text-xs font-semibold text-slate-700 mb-1 block">Message au client</label>
            <textarea
              id={`${uid}-accord-msg`}
              value={accordMessage}
              onChange={e => setAccordMessage(e.target.value)}
              rows={7}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
            />
          </div>

          {/* Boutons d'envoi */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleSendAccord('whatsapp')}
              disabled={accordLoading}
              className="flex-1 flex items-center justify-center gap-1.5 min-h-11 rounded-lg bg-green-700 hover:bg-green-800 text-white text-xs font-bold transition-colors disabled:opacity-50"
            >
              <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" /> WhatsApp
            </button>
            <button
              type="button"
              onClick={() => handleSendAccord('sms')}
              disabled={accordLoading}
              title={smsServeur ? 'Envoyer le SMS depuis le serveur (Brevo)' : "Ouvrir l'app Messages de l'appareil"}
              className="flex-1 flex items-center justify-center gap-1.5 min-h-11 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold border border-slate-200 transition-colors disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" /> SMS
            </button>
            <button
              type="button"
              onClick={() => handleSendAccord('email')}
              disabled={accordLoading}
              className="flex-1 flex items-center justify-center gap-1.5 min-h-11 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold border border-slate-200 transition-colors disabled:opacity-50"
            >
              <Mail className="w-3.5 h-3.5" aria-hidden="true" /> Email
            </button>
          </div>
        </Modal>
      )}

      {/* Remise au client */}
      {restitution && (
        <RestitutionModal
          ticket={t}
          reste={resteDu}
          dejaApplique={avantagesAppliques}
          fidelite={clientFidelite}
          devisRefuse={devisRefuse}
          onClose={fermerRestitution}
          onConfirm={effectuerRestitution}
        />
      )}

      {/* Confirmation paiement modal */}
      {paiement && (
        <Modal labelledBy={`${uid}-paye-titre`} onClose={fermerPaiement} busy={paying} panelClassName="max-w-sm p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" aria-hidden="true" />
            </div>
            <div>
              <h3 id={`${uid}-paye-titre`} className="text-lg font-display font-bold text-slate-900">Confirmer le paiement</h3>
              <p className="text-sm text-slate-600">{paiement.cloturer ? 'Le ticket sera ensuite clôturé.' : 'Le client a-t-il bien réglé ?'}</p>
            </div>
          </div>

          {(() => {
            const dispo = avantagesDisponibles(clientFidelite);
            const bonFilmDispo = clientFidelite?.bon_grattage === 'film';
            const fideliteDispo = dispo.fidelite > 0;
            const fideliteMontant = dispo.fidelite;
            // Reste avant avantages (ceux d'une tentative précédente sont déjà écrits sur le ticket)
            const resteAvant = Math.round((resteDu + avantagesAppliques) * 100) / 100;
            const reduction = montantAvantages(clientFidelite, { bon: applyBonGrattage, fidelite: applyFidelite }, resteAvant);
            const resteApresRed = Math.max(0, resteAvant - reduction);
            return (
              <>
                {resteAvant > 0 && (
                  <div className="p-4 bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 rounded-xl mb-4 text-center">
                    <p className="text-xs text-emerald-800 font-medium mb-1">Reste à payer</p>
                    {reduction > 0 && (
                      <p className="text-sm text-slate-500 line-through">{formatPrix(resteAvant)}</p>
                    )}
                    <p className="text-2xl font-extrabold text-emerald-800">{formatPrix(resteApresRed)}</p>
                    {reduction > 0 && (
                      <p className="text-[11px] text-amber-800 font-semibold mt-1">
                        −{formatPrix(reduction)} de réduction appliquée
                      </p>
                    )}
                  </div>
                )}

                {/* Avantages client disponibles (bon grattage + fidelite) */}
                {(clientFidelite?.bon_grattage || fideliteDispo) && (
                  <div className="mb-4 rounded-xl border-2 border-amber-200 bg-amber-50/70 p-3 space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-amber-800 font-bold flex items-center gap-1.5">
                      <Star className="w-3 h-3 fill-amber-500 text-amber-500" aria-hidden="true" /> Avantages client disponibles
                    </p>

                    {clientFidelite?.bon_grattage === 'reduction' && (
                      <label className="flex items-start gap-2.5 p-2 min-h-11 rounded-lg bg-white/80 hover:bg-white cursor-pointer transition-colors">
                        <input type="checkbox" checked={applyBonGrattage}
                          onChange={e => setApplyBonGrattage(e.target.checked)}
                          className="mt-0.5 w-5 h-5 rounded accent-amber-500 shrink-0" />
                        <div className="flex-1 text-sm">
                          <p className="font-semibold text-slate-800">💰 Bon de grattage : −10€</p>
                          <p className="text-[11px] text-slate-600">Gagné lors d'un précédent ticket</p>
                        </div>
                      </label>
                    )}
                    {bonFilmDispo && (
                      <div className="flex items-start gap-2.5 p-2 rounded-lg bg-white/80">
                        <Check className="mt-0.5 w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
                        <div className="flex-1 text-sm">
                          <p className="font-semibold text-slate-800">🎁 Film verre trempé offert</p>
                          <p className="text-[11px] text-slate-600">À remettre au client en main propre</p>
                        </div>
                      </div>
                    )}
                    {fideliteDispo && (
                      <label className="flex items-start gap-2.5 p-2 min-h-11 rounded-lg bg-white/80 hover:bg-white cursor-pointer transition-colors">
                        <input type="checkbox" checked={applyFidelite}
                          onChange={e => setApplyFidelite(e.target.checked)}
                          className="mt-0.5 w-5 h-5 rounded accent-amber-500 shrink-0" />
                        <div className="flex-1 text-sm">
                          <p className="font-semibold text-slate-800">⭐ Fidélité : −{formatPrix(fideliteMontant)}</p>
                          <p className="text-[11px] text-slate-600">{clientFidelite.points} points ({clientFidelite.palier_reduction} requis)</p>
                        </div>
                      </label>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <button type="button" onClick={confirmerPaiement} disabled={paying} aria-busy={paying || undefined}
                    className="w-full min-h-12 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                    {paying
                      ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full motion-safe:animate-spin" aria-hidden="true" /> Enregistrement…</>
                      : <><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Oui, confirmer le paiement</>}
                  </button>
                  <button type="button" onClick={fermerPaiement} disabled={paying}
                    className="w-full min-h-11 px-4 rounded-xl text-slate-600 hover:text-slate-800 text-sm font-medium transition-colors flex items-center justify-center gap-1">
                    <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Annuler
                  </button>
                </div>
              </>
            );
          })()}
        </Modal>
      )}

      {/* Delete ticket modal */}
      {showDeleteModal && (
        <Modal labelledBy={`${uid}-suppr-titre`} onClose={() => setShowDeleteModal(false)} busy={deleting} panelClassName="max-w-sm p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
              <Trash2 className="w-5 h-5 text-red-600" aria-hidden="true" />
            </div>
            <div>
              <h3 id={`${uid}-suppr-titre`} className="text-lg font-display font-bold text-slate-900">Supprimer le ticket</h3>
              <p className="text-sm text-slate-600">{t.ticket_code}</p>
            </div>
          </div>
          <p className="text-sm text-slate-700 mb-4">
            Cette action est irréversible. Toutes les données liées (notes, commandes, historique) seront supprimées.
          </p>
          <div className="mb-4">
            <label htmlFor={`${uid}-suppr-code`} className="input-label">Code administrateur</label>
            <input
              id={`${uid}-suppr-code`}
              type="password"
              value={deleteCode}
              onChange={e => { setDeleteCode(e.target.value); setDeleteError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleDeleteTicket()}
              className="input"
              placeholder="Entrez le code admin"
              aria-invalid={deleteError ? true : undefined}
              aria-describedby={deleteError ? `${uid}-suppr-err` : undefined}
              autoFocus
            />
            {deleteError && (
              <p id={`${uid}-suppr-err`} role="alert" className="text-xs text-red-600 mt-1 font-medium">{deleteError}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowDeleteModal(false)} className="btn-ghost flex-1 min-h-11">Annuler</button>
            <button
              type="button"
              onClick={handleDeleteTicket}
              disabled={deleting || !deleteCode}
              className="flex-1 min-h-11 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {deleting ? 'Suppression...' : 'Supprimer'}
            </button>
          </div>
        </Modal>
      )}

      {/* Retour SAV modal */}
      {showRetourSAVModal && (
        <Modal labelledBy={`${uid}-sav-titre`} onClose={() => setShowRetourSAVModal(false)} busy={creatingSAV} panelClassName="max-w-lg p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
              <RotateCcw className="w-5 h-5 text-red-600" aria-hidden="true" />
            </div>
            <div>
              <h3 id={`${uid}-sav-titre`} className="text-lg font-display font-bold text-slate-900">Retour SAV</h3>
              <p className="text-sm text-slate-600">Créer un ticket lié à {t.ticket_code}</p>
            </div>
            <button type="button" onClick={() => setShowRetourSAVModal(false)} className="ml-auto btn-ghost p-0 min-w-11 min-h-11" aria-label="Fermer">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Recap ticket original */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl mb-4">
            <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">Ticket original</div>
            <div className="text-sm font-bold text-slate-800">{t.ticket_code} — {appareil}</div>
            <div className="text-xs text-slate-600 mt-0.5">{t.panne} {t.panne_detail ? `(${t.panne_detail})` : ''}</div>
          </div>

          <div className="space-y-3 mb-5">
            <div>
              <label htmlFor={`${uid}-sav-motif`} className="input-label">Motif du retour SAV *</label>
              <input
                id={`${uid}-sav-motif`}
                value={retourSAVForm.panne}
                onChange={e => setRetourSAVForm(f => ({ ...f, panne: e.target.value }))}
                className="input"
                placeholder="Ex: Même panne réapparue, écran décollé..."
                aria-required="true"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor={`${uid}-sav-detail`} className="input-label">Détail</label>
              <textarea
                id={`${uid}-sav-detail`}
                value={retourSAVForm.panne_detail}
                onChange={e => setRetourSAVForm(f => ({ ...f, panne_detail: e.target.value }))}
                className="input"
                rows={3}
                placeholder="Précisions complémentaires..."
              />
            </div>
          </div>

          <div className="p-3 bg-red-50 border border-red-200 rounded-xl mb-4">
            <p className="text-xs text-red-800 font-medium">
              Ce ticket sera marqué comme retour SAV et lié au ticket {t.ticket_code}. Le montant sera de 0,00 € (prise en charge garantie).
            </p>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => setShowRetourSAVModal(false)} className="btn-ghost flex-1 min-h-11">Annuler</button>
            <button
              type="button"
              onClick={handleCreateRetourSAV}
              disabled={creatingSAV || !retourSAVForm.panne.trim()}
              className="flex-1 min-h-11 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {creatingSAV ? 'Création...' : <><RotateCcw className="w-4 h-4" aria-hidden="true" /> Créer le retour SAV</>}
            </button>
          </div>
        </Modal>
      )}

      <div className="px-4 sm:px-6 lg:px-8">
      {/* Attention card — shows when important private notes exist */}
      {(() => {
        const importantNotes = privateNotes.filter(n => n.important);
        if (!showAttention && importantNotes.length === 0) return null;
        return (
          <div className={`flex items-start gap-3 p-4 mb-5 rounded-xl bg-red-50 border border-red-200 shadow-sm ${ANIM_ENTREE}`}>
            <div className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm font-bold text-red-900">Note importante</p>
              {importantNotes.map(note => (
                <p key={note.id} className="text-sm text-red-800">{note.contenu.replace(/^\[ATTENTION\]\s*⚠?\s*/i, '')}</p>
              ))}
              {importantNotes.length === 0 && t.attention && (
                <p className="text-sm text-red-800">{t.attention}</p>
              )}
            </div>
            <button type="button" onClick={() => setShowAttention(false)} className="shrink-0 min-w-11 min-h-11 flex items-center justify-center rounded-lg text-red-400 hover:text-red-700 hover:bg-red-100 transition-colors" aria-label="Masquer la note importante">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        );
      })()}

      {/* Progress tracker */}
      <div className="card p-5 mb-6">
        <ProgressTracker statut={t.statut} hasPiece={t.commande_piece === 1} />
      </div>

      {/* Layout toolbar */}
      <div className="flex items-center gap-2 mb-5">
        <button
          type="button"
          onClick={() => setShowPersonnaliser(true)}
          className="flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
        >
          <Edit3 className="w-3.5 h-3.5" aria-hidden="true" /> Personnaliser
        </button>
      </div>

      {/* Edit mode banner */}
      {editMode && (
        <div className="flex items-center justify-between p-3 mb-5 rounded-xl bg-blue-50 border-2 border-dashed border-blue-300">
          <div className="flex items-center gap-2">
            <span className="text-blue-700 text-sm font-bold">Mode édition activé</span>
            <span className="text-slate-600 text-xs">— Glisse les widgets par ⠿</span>
          </div>
          <button
            type="button"
            onClick={() => setEditMode(false)}
            className="min-h-11 px-3 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors"
          >
            Terminer
          </button>
        </div>
      )}

      {/* Content grid — drag & drop layout */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 lg:grid-cols-[55fr_45fr] gap-5">
          {['left', 'right'].map(colId => (
            <Droppable key={colId} droppableId={colId} isDropDisabled={!editMode}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`space-y-5 min-h-[200px] rounded-xl p-1 transition-colors duration-200 ${
                    snapshot.isDraggingOver
                      ? colId === 'left'
                        ? 'bg-blue-50/40 ring-2 ring-dashed ring-blue-300'
                        : 'bg-violet-50/40 ring-2 ring-dashed ring-violet-300'
                      : ''
                  }`}
                >
                  {layout[colId].map((widgetId, index) => {
                    const content = renderBlockContent(widgetId);
                    if (!content) return null;

                    return (
                      <Draggable key={widgetId} draggableId={widgetId} index={index} isDragDisabled={!editMode}>
                        {(dragProvided, dragSnapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            className={`relative transition-shadow ${
                              dragSnapshot.isDragging
                                ? 'shadow-2xl shadow-blue-500/25 motion-safe:rotate-[1.5deg] z-50 opacity-90'
                                : ''
                            } ${editMode && !dragSnapshot.isDragging ? 'ring-2 ring-dashed ring-slate-200' : ''} rounded-xl`}
                          >
                            {/* Drag handle — only in edit mode */}
                            {editMode && (
                              <div
                                {...dragProvided.dragHandleProps}
                                className="absolute -top-2.5 right-3 z-10"
                              >
                                <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-100 text-blue-700 text-[16px] cursor-grab active:cursor-grabbing shadow-sm motion-safe:animate-wiggle select-none">
                                  ⠿
                                </span>
                              </div>
                            )}
                            {/* Hidden handle to satisfy DnD when not in edit mode */}
                            {!editMode && (
                              <div {...dragProvided.dragHandleProps} className="hidden" />
                            )}
                            {content}
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>
      </div>

      {/* Delete link */}
      <div className="mt-10 mb-4 text-center">
        <button
          type="button"
          onClick={() => { setShowDeleteModal(true); setDeleteCode(''); setDeleteError(''); }}
          className="min-h-11 px-3 text-xs text-slate-500 hover:text-red-600 transition-colors"
        >
          Supprimer ce ticket
        </button>
      </div>

      {/* Print Drawer : les saisies en attente sont enregistrées avant de générer le document */}
      <PrintDrawer
        open={showPrintDrawer}
        onClose={() => setShowPrintDrawer(false)}
        ticketId={id}
        ticketCode={t.ticket_code}
        clientTel={t.client_tel}
        clientEmail={t.client_email}
        onBeforePrint={toutEnregistrer}
      />

      {/* Personnaliser panel */}
      <PersonnaliserPanel
        open={showPersonnaliser}
        onClose={() => setShowPersonnaliser(false)}
        prefs={widgetPrefs}
        onPrefsChange={savePrefs}
        layout={layout}
        onResetLayout={resetLayout}
        editMode={editMode}
        onToggleEditMode={() => setEditMode(m => !m)}
      />
    </div>
  );
}
