import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useApi, invalidateCache, clearCache } from '../hooks/useApi';
import api from '../lib/api';
import SmsBrevoConfig from '../components/SmsBrevoConfig';
import { useToast } from '../components/Toast';
import { useSettings } from '../hooks/useSettings';
import { normKey, searchModeles, parseModelesEnMasse, sansPrefixeMarque, MARQUE_AUTRE } from '../lib/catalog';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { STATUTS_MESSAGE, statutsNotifies, basculerStatutNotifie } from '../lib/messages';
import { EMPLACEMENT_MAX, formatDelai, listeEmplacements, normaliserEmplacement } from '../lib/etagere';
import {
  Settings, Save, Users, Plus, Trash2, Edit3, X,
  Key, Bell, Printer, Store, Check, Loader2, MessageCircle,
  Database, Download, Upload, Shield, Palette, Star,
  BookOpen, ChevronDown, ChevronRight, AlertTriangle, Monitor,
  Zap, CreditCard, AtSign, Mail, Search, FileText, Package, Scale, ExternalLink, Archive, MapPin,
} from 'lucide-react';

const CATALOG_CATEGORIES = ['Smartphone', 'Tablette', 'PC Portable', 'Console', 'Autre'];
// Limite du backend ; pas de découpage : l'ordre (rang dans la liste) repartirait de zéro à chaque envoi
const BULK_MAX = 500;

// Secrets : l'API ne les renvoie plus en clair (absents ou masqués « •••• »). Une valeur masquée
// n'est jamais renvoyée au serveur : seule une nouvelle saisie remplace le secret enregistré.
const isMasked = (v) => typeof v === 'string' && (v.includes('••') || /^\*{3,}/.test(v.trim()));

function SecretInput({ id, value, onChange, placeholder, className = 'input', reveal = false }) {
  const masked = isMasked(value);
  return (
    <input
      id={id}
      type={reveal ? 'text' : 'password'}
      value={masked ? '' : (value || '')}
      onChange={e => onChange(e.target.value)}
      placeholder={masked ? '•••••••• enregistré (laisser vide pour conserver)' : placeholder}
      autoComplete="new-password"
      spellCheck={false}
      className={className}
    />
  );
}

// ─── Mentions légales & RGPD : clés canoniques (non secrètes) lues par les impressions ───
// Mêmes correspondances que backend/app/services/mentions.py (ANCIENNES) : les anciennes clés
// encore lues ailleurs (e-mails, devis, dépôt à distance) suivent la clé canonique quand elles
// existent déjà en base.
const ALIAS_MENTIONS = {
  BOUTIQUE_NOM: ['nom_boutique', 'NOM_BOUTIQUE'],
  BOUTIQUE_TEL: ['telephone', 'tel_boutique', 'TEL_BOUTIQUE'],
  BOUTIQUE_ADRESSE: ['adresse', 'ADRESSE_BOUTIQUE'],
  BOUTIQUE_EMAIL: ['email', 'EMAIL_BOUTIQUE'],
  BOUTIQUE_SIRET: ['siret', 'SIRET', 'SIRET_BOUTIQUE'],
  CGV_DEPOT: ['mentions_legales'],
};
export const DEFAUTS_MENTIONS = { GARANTIE_MOIS: '6', RGPD_RETENTION_MOIS: '36', PURGE_CODES_JOURS: '30' };
// Bornes identiques au serveur (services/mentions.py, ENTIERS)
const BORNES_MENTIONS = {
  GARANTIE_MOIS: [0, 120, 'La garantie'],
  RGPD_RETENTION_MOIS: [1, 240, 'La durée de conservation'],
  PURGE_CODES_JOURS: [1, 3650, "Le délai d'effacement des codes"],
};

/** Valeur affichée : clé canonique, sinon ancienne clé (base pas encore migrée). */
export function valeurMention(config, cle) {
  const v = config?.[cle];
  if (v !== undefined && v !== null) return String(v);
  for (const alias of ALIAS_MENTIONS[cle] || []) {
    if (config?.[alias]) return String(config[alias]);
  }
  return '';
}

/** Modification d'une clé canonique, recopiée dans ses anciennes clés présentes en base. */
export function avecMention(config, cle, valeur) {
  const next = { ...config, [cle]: valeur };
  for (const alias of ALIAS_MENTIONS[cle] || []) {
    if (Object.prototype.hasOwnProperty.call(config, alias)) next[alias] = valeur;
  }
  return next;
}

// SIRET : 14 chiffres et clé de Luhn (exception connue : La Poste, SIREN 356 000 000)
export function siretValide(siret) {
  const d = String(siret || '').replace(/\s/g, '');
  if (!/^\d{14}$/.test(d)) return false;
  if (d.startsWith('356000000')) return [...d].reduce((s, c) => s + Number(c), 0) % 5 === 0;
  let somme = 0;
  for (let i = 0; i < 14; i++) {
    let n = Number(d[13 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    somme += n;
  }
  return somme % 10 === 0;
}

/** { erreurs: {cle: msg} (bloquent l'enregistrement), alertes: [msg] (mentions manquantes, formats) } */
export function controlesMentions(config) {
  const v = (cle) => valeurMention(config, cle).trim();
  const erreurs = {};
  for (const [cle, [min, max, nom]] of Object.entries(BORNES_MENTIONS)) {
    const brut = v(cle);
    if (!brut) continue;
    const n = Number(brut);
    if (!Number.isInteger(n) || n < min || n > max) erreurs[cle] = `${nom} doit être un nombre entier entre ${min} et ${max}.`;
  }
  const alertes = [];
  const siret = v('BOUTIQUE_SIRET');
  if (!siret) alertes.push('SIRET manquant : il doit figurer sur les devis, reçus et factures.');
  else if (!siretValide(siret)) alertes.push('SIRET : 14 chiffres attendus, clé de contrôle incorrecte. Vérifiez la saisie.');
  if (!v('BOUTIQUE_RCS')) alertes.push('RCS (ou RM) manquant : ville d’immatriculation et SIREN, ex. « RCS Chambéry 123 456 789 ».');
  const tva = v('BOUTIQUE_TVA_INTRA').replace(/\s/g, '').toUpperCase();
  const mentionTva = v('TVA_MENTION');
  if (!tva && !mentionTva) alertes.push('Indiquez le n° de TVA intracommunautaire, ou la mention d’exonération (ex. art. 293 B du CGI).');
  else if (tva && !/^FR[0-9A-Z]{2}\d{9}$/.test(tva)) alertes.push('N° de TVA intracommunautaire : format attendu FR + 2 caractères + 9 chiffres.');
  // Même lecture du taux que le serveur (mentions._taux_nul) : absent ou vide = TVA facturée
  const taux = String(config?.tva ?? '').trim().replace(',', '.');
  const tauxNul = taux !== '' && Number(taux) === 0;
  if (/293\s*B/i.test(mentionTva) && !tauxNul) alertes.push('Mention « art. 293 B » (franchise de TVA) alors que le taux de TVA n’est pas 0 % : corrigez l’un ou l’autre.');
  else if (tauxNul && !/293\s*B/i.test(mentionTva)) alertes.push('Taux de TVA à 0 % : ajoutez la mention « TVA non applicable, art. 293 B du CGI ».');
  const forme = v('BOUTIQUE_FORME');
  if (!forme) alertes.push('Forme juridique et capital manquants (ex. « SAS au capital de 1 000 € »).');
  else if (/\b(SARL|SASU?|EURL|SA|SNC|SELARL)\b/i.test(forme) && !/capital/i.test(forme)) {
    alertes.push('Forme juridique : indiquez aussi le capital social (ex. « SARL au capital de 1 000 € »).');
  }
  if (!v('BOUTIQUE_ADRESSE')) alertes.push('Adresse manquante.');
  const email = v('RGPD_CONTACT_EMAIL');
  if (!email) alertes.push('Contact RGPD manquant : les clients doivent savoir où exercer leurs droits.');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) alertes.push('Contact RGPD : adresse e-mail invalide.');
  return { erreurs, alertes };
}

const CHAMPS_IDENTITE = [
  { cle: 'BOUTIQUE_NOM', label: 'Nom commercial', placeholder: 'Klikphone' },
  { cle: 'BOUTIQUE_FORME', label: 'Forme juridique et capital', placeholder: 'SAS au capital de 1 000 €' },
  { cle: 'BOUTIQUE_ADRESSE', label: 'Adresse', placeholder: '79 Place Saint-Léger, 73000 Chambéry', large: true },
  { cle: 'BOUTIQUE_TEL', label: 'Téléphone', placeholder: '04 79 60 89 22', type: 'tel' },
  { cle: 'BOUTIQUE_EMAIL', label: 'E-mail', placeholder: 'contact@exemple.fr', type: 'email' },
  { cle: 'BOUTIQUE_SIRET', label: 'SIRET (14 chiffres)', placeholder: '123 456 789 00012', mono: true, inputMode: 'numeric' },
  { cle: 'BOUTIQUE_RCS', label: 'RCS', placeholder: 'RCS Chambéry 123 456 789' },
  { cle: 'BOUTIQUE_TVA_INTRA', label: 'N° TVA intracommunautaire', placeholder: 'FR12 123456789', mono: true },
  { cle: 'TVA_MENTION', label: 'Mention TVA (si non assujetti)', placeholder: 'TVA non applicable, art. 293 B du CGI', large: true,
    aide: 'Laisser vide si vous facturez la TVA.' },
];
const CHAMPS_RGPD = [
  { cle: 'RGPD_CONTACT_EMAIL', label: 'Contact RGPD (e-mail)', placeholder: 'rgpd@exemple.fr', type: 'email', large: true,
    aide: 'Adresse donnée aux clients pour accéder à leurs données, les corriger ou les faire effacer.' },
  { cle: 'RGPD_RETENTION_MOIS', label: 'Conservation des données clients (mois)', type: 'number', min: 1, max: 240,
    aide: 'Après le dernier contact. Les factures restent conservées 10 ans (obligation comptable).' },
  { cle: 'PURGE_CODES_JOURS', label: 'Effacement des codes de déverrouillage (jours)', type: 'number', min: 1, max: 3650,
    aide: 'Après la remise de l’appareil (ticket rendu ou clôturé).' },
];

function ChampMention({ champ, config, onChange, erreur }) {
  const id = `mention-${champ.cle}`;
  const aideId = champ.aide ? `${id}-aide` : undefined;
  const errId = erreur ? `${id}-err` : undefined;
  return (
    <div className={champ.large ? 'sm:col-span-2' : ''}>
      <label htmlFor={id} className="input-label">{champ.label}</label>
      <input id={id} type={champ.type || 'text'} inputMode={champ.inputMode}
        min={champ.min} max={champ.max} step={champ.type === 'number' ? 1 : undefined}
        value={valeurMention(config, champ.cle)}
        placeholder={champ.placeholder ?? DEFAUTS_MENTIONS[champ.cle] ?? ''}
        onChange={e => onChange(champ.cle, e.target.value)}
        aria-invalid={erreur ? 'true' : undefined}
        aria-describedby={[aideId, errId].filter(Boolean).join(' ') || undefined}
        className={`input min-h-[44px] ${champ.mono ? 'font-mono' : ''} ${erreur ? 'border-red-400' : ''}`} />
      {champ.aide && <p id={aideId} className="text-xs text-slate-600 mt-1">{champ.aide}</p>}
      {erreur && <p id={errId} className="text-xs text-red-700 mt-1">{erreur}</p>}
    </div>
  );
}

/**
 * Aperçu indicatif du pied des documents imprimés : mêmes lignes que le serveur
 * (services/mentions.py : lignes_identite, mention_garantie, adresse_courte).
 */
export function lignesPiedDocument(config, origine = '') {
  const v = (cle) => valeurMention(config, cle).trim();
  const joindre = (...parts) => parts.filter(Boolean).join(' · ');
  const nom = v('BOUTIQUE_NOM') || 'Klikphone';
  const rcs = v('BOUTIQUE_RCS');
  const garantie = Number(v('GARANTIE_MOIS') || DEFAUTS_MENTIONS.GARANTIE_MOIS);
  const site = String(origine || '').replace(/^[a-z]+:\/\//i, '').replace(/^www\./, '').replace(/\/+$/, '');
  return [
    v('BOUTIQUE_FORME') ? `${nom}, ${v('BOUTIQUE_FORME')}` : nom,
    v('BOUTIQUE_ADRESSE'),
    joindre(v('BOUTIQUE_TEL') && `Tél : ${v('BOUTIQUE_TEL')}`, v('BOUTIQUE_EMAIL')),
    joindre(v('BOUTIQUE_SIRET') && `SIRET : ${v('BOUTIQUE_SIRET')}`, rcs && (/^RCS/i.test(rcs) ? rcs : `RCS ${rcs}`)),
    joindre(v('BOUTIQUE_TVA_INTRA') && `TVA intracom. : ${v('BOUTIQUE_TVA_INTRA')}`, v('TVA_MENTION')),
    garantie > 0 ? `Garantie ${garantie} mois pièces et main-d'œuvre sur la réparation effectuée, à compter de la restitution.` : '',
    `Politique de confidentialité : ${site}/confidentialite`,
  ].filter(Boolean);
}

// ─── Anonymisation automatique (backend/app/api/rgpd.py : tâche quotidienne) ───
// '1' l'active ; absente ou '0' : désactivée. Seul RGPD_RETENTION_AUTO est écrit : le serveur
// date le début à J+7 de l'activation (et l'efface quand on la coupe), puis note le dernier
// passage. L'admin voit l'aperçu, et peut encore la couper, avant toute anonymisation.
export const PARAM_RETENTION_AUTO = 'RGPD_RETENTION_AUTO';
export const PARAM_RETENTION_AUTO_DEBUT = 'RGPD_RETENTION_AUTO_DEBUT';
export const PARAM_RETENTION_DERNIERE = 'RGPD_RETENTION_DERNIERE';
export const RETENTION_AUTO_DELAI_JOURS = 7;
export const MOT_CONFIRMATION_AUTO = 'ANONYMISER';

const deux = (n) => String(n).padStart(2, '0');

/** Date locale du poste au format AAAA-MM-JJ (celui des paramètres de rétention). */
export function dateIsoLocale(d) {
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** « 2026-10-23 » → « 23/10/2026 » ; texte inattendu rendu tel quel. */
export function dateFr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? '');
}

/** Première anonymisation automatique : J+7 à partir de `aujourdhui` (AAAA-MM-JJ). */
export function debutRetentionAuto(aujourdhui = new Date()) {
  const d = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate() + RETENTION_AUTO_DELAI_JOURS);
  return dateIsoLocale(d);
}

/**
 * État de la tâche quotidienne : réponse de GET /api/rgpd/retention/apercu quand on l'a
 * (état réel du serveur), sinon paramètres lus par GET /api/config (désactivée par défaut).
 */
export function etatRetentionAuto(config, apercu) {
  const v = (cle) => String(config?.[cle] ?? '').trim();
  const serveur = !!apercu && typeof apercu.auto === 'boolean';
  const actif = serveur ? apercu.auto : v(PARAM_RETENTION_AUTO) === '1';
  return {
    actif,
    // Début : seulement pour une tâche activée (comme le serveur)
    debut: actif ? ((serveur ? apercu.auto_debut : v(PARAM_RETENTION_AUTO_DEBUT)) || null) : null,
    derniere: (serveur ? apercu.derniere_execution : v(PARAM_RETENTION_DERNIERE)) || null,
  };
}

/** Avertissement de la confirmation d'activation. */
export function texteActivationAuto(mois, debutIso) {
  return `Irréversible : les clients sans activité depuis ${mois} mois seront anonymisés chaque jour `
    + `à partir de J+${RETENTION_AUTO_DELAI_JOURS} (le ${dateFr(debutIso)}).`;
}

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

function OngletMentionsRgpd({ config, initial, onChange, onSave, saving, sensible, toast, onEnregistrerMaintenant }) {
  const { erreurs, alertes } = controlesMentions(config);
  const [apercu, setApercu] = useState(null);
  const [apercuBusy, setApercuBusy] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const [appliquerBusy, setAppliquerBusy] = useState(false);
  const [resultat, setResultat] = useState(null);
  const confirmerRef = useRef(null);
  // Anonymisation automatique : dernière réponse de l'aperçu (état du serveur et comptes)
  const [etatServeur, setEtatServeur] = useState(null);
  // Confirmation d'activation en cours : { mois, clients, codes }
  const [activation, setActivation] = useState(null);
  const [motAuto, setMotAuto] = useState('');
  const [autoBusy, setAutoBusy] = useState(false);
  const motAutoRef = useRef(null);
  const interrupteurRef = useRef(null);
  const dureesModifiees = ['RGPD_RETENTION_MOIS', 'PURGE_CODES_JOURS']
    .some(k => (config[k] ?? '') !== (initial[k] ?? ''));
  const origine = typeof window !== 'undefined' ? (window.location?.origin || '') : '';
  const auto = etatRetentionAuto(config, etatServeur);
  const aujourdhui = dateIsoLocale(new Date());
  const motAutoOk = motAuto.trim().toUpperCase() === MOT_CONFIRMATION_AUTO;

  useEffect(() => { if (confirmer) confirmerRef.current?.focus(); }, [confirmer]);
  useEffect(() => { if (activation) motAutoRef.current?.focus(); }, [activation]);

  // Élévation admin déjà ouverte : état réel de la tâche quotidienne, sans fenêtre d'identification
  useEffect(() => {
    if (!api.hasAdminToken?.()) return undefined;
    let vivant = true;
    Promise.resolve()
      .then(() => api.rgpdRetentionApercu())
      .then((data) => { if (vivant && data && typeof data === 'object') setEtatServeur(data); })
      .catch(() => {});
    return () => { vivant = false; };
  }, []);

  const fermerActivation = () => {
    setActivation(null);
    setMotAuto('');
    requestAnimationFrame(() => interrupteurRef.current?.focus());
  };

  const basculerAuto = async () => {
    if (autoBusy) return;
    if (activation) { fermerActivation(); return; }
    setAutoBusy(true);
    try {
      if (auto.actif) {
        // Couper n'efface rien : enregistré tout de suite (le serveur oublie la date de début)
        await onEnregistrerMaintenant([[PARAM_RETENTION_AUTO, '0']]);
        setEtatServeur(e => (e ? { ...e, auto: false, auto_debut: null } : e));
        toast.success('Anonymisation automatique désactivée');
        return;
      }
      // Activer : comptes et durée effective du serveur (élévation admin), puis confirmation forte
      const data = await sensible(() => api.rgpdRetentionApercu());
      if (data && typeof data === 'object') setEtatServeur(data);
      const moisRepli = Math.max(
        Number(valeurMention(initial, 'RGPD_RETENTION_MOIS')) || Number(DEFAUTS_MENTIONS.RGPD_RETENTION_MOIS),
        Number(valeurMention(initial, 'GARANTIE_MOIS')) || 0,
      );
      setMotAuto('');
      setActivation({
        mois: Number(data?.retention_mois) || moisRepli,
        clients: Number(data?.clients_a_anonymiser) || 0,
        codes: Number(data?.codes_a_purger) || 0,
      });
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(err?.message || 'Enregistrement impossible');
    } finally {
      setAutoBusy(false);
    }
  };

  const confirmerActivation = async () => {
    if (!activation || !motAutoOk || autoBusy) return;
    setAutoBusy(true);
    try {
      // Le serveur date le début (J+7) dans la même écriture ; en attendant sa relecture, J+7 local
      await onEnregistrerMaintenant([[PARAM_RETENTION_AUTO, '1']]);
      const estime = debutRetentionAuto();
      setEtatServeur(e => (e ? { ...e, auto: true, auto_debut: estime } : e));
      setActivation(null);
      setMotAuto('');
      toast.success('Anonymisation automatique activée');
      requestAnimationFrame(() => interrupteurRef.current?.focus());
      Promise.resolve()
        .then(() => api.rgpdRetentionApercu())
        .then((data) => { if (data && typeof data.auto === 'boolean') setEtatServeur(data); })
        .catch(() => {});
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(err?.message || 'Activation impossible');
    } finally {
      setAutoBusy(false);
    }
  };

  const calculerApercu = async () => {
    setApercuBusy(true);
    setResultat(null);
    setConfirmer(false);
    try {
      const data = await sensible(() => api.rgpdRetentionApercu());
      if (data && typeof data === 'object') setEtatServeur(data);
      setApercu({
        clients: Number(data?.clients_a_anonymiser) || 0,
        codes: Number(data?.codes_a_purger) || 0,
      });
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(err?.message || 'Aperçu indisponible');
    } finally {
      setApercuBusy(false);
    }
  };

  const appliquer = async () => {
    setAppliquerBusy(true);
    try {
      const data = await sensible(() => api.rgpdRetentionAppliquer());
      const clients = Number(data?.clients_anonymises ?? data?.clients_a_anonymiser ?? data?.clients) || 0;
      const codes = Number(data?.codes_purges ?? data?.codes_a_purger ?? data?.codes) || 0;
      setResultat({ clients, codes });
      setApercu(null);
      setConfirmer(false);
      // Comptes dépassés : l'anonymisation automatique n'affiche plus que son état
      setEtatServeur(e => (e ? { ...e, clients_a_anonymiser: undefined, codes_a_purger: undefined } : e));
      invalidateCache('clients', 'tickets', 'dashboard');
      toast.success(`${clients} client${clients > 1 ? 's' : ''} anonymisé${clients > 1 ? 's' : ''}, ${codes} code${codes > 1 ? 's' : ''} effacé${codes > 1 ? 's' : ''}`);
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(err?.message || 'Application impossible');
    } finally {
      setAppliquerBusy(false);
    }
  };

  const rien = apercu && apercu.clients === 0 && apercu.codes === 0;

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">Identité de la boutique</h2>
        <p className="text-xs text-slate-600 mb-4">Imprimée sur les tickets, devis, reçus et documents PDF.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {CHAMPS_IDENTITE.map(ch => (
            <ChampMention key={ch.cle} champ={ch} config={config} onChange={onChange} erreur={erreurs[ch.cle]} />
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-4">Conditions imprimées</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="mention-CGV_DEPOT" className="input-label">Conditions de dépôt (ticket client)</label>
            <textarea id="mention-CGV_DEPOT" value={valeurMention(config, 'CGV_DEPOT')}
              onChange={e => onChange('CGV_DEPOT', e.target.value)}
              className="input min-h-[120px]"
              placeholder="Ex. : l'appareil non récupéré … ; sauvegardez vos données avant le dépôt ; …" />
          </div>
          <div className="max-w-xs">
            <ChampMention config={config} onChange={onChange} erreur={erreurs.GARANTIE_MOIS}
              champ={{ cle: 'GARANTIE_MOIS', label: 'Garantie des réparations (mois)', type: 'number', min: 0, max: 120 }} />
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-4">Données personnelles (RGPD)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {CHAMPS_RGPD.map(ch => (
            <ChampMention key={ch.cle} champ={ch} config={config} onChange={onChange} erreur={erreurs[ch.cle]} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a href="/confidentialite" target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-[44px]">
            <ExternalLink className="w-4 h-4" aria-hidden="true" /> Voir la politique de confidentialité
            <span className="sr-only">(nouvel onglet)</span>
          </a>
          <p className="text-xs text-slate-600">Générée à partir des valeurs enregistrées.</p>
        </div>
      </div>

      {alertes.length > 0 && (
        <div className="card p-4 border-amber-200 bg-amber-50">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-900 mb-2">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> Mentions à compléter
          </h3>
          <ul className="list-disc pl-5 space-y-1 text-sm text-amber-900">
            {alertes.map(a => <li key={a}>{a}</li>)}
          </ul>
        </div>
      )}

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">Aperçu du pied de document</h2>
        <p className="text-xs text-slate-600 mb-3">Indicatif : la mise en page dépend du format (ticket, A4, PDF).</p>
        <div className="mx-auto max-w-[320px] rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3 font-mono text-[12px] leading-snug text-slate-800 text-center">
          {lignesPiedDocument(config, origine).map((l, i) => (
            <p key={i} className={`[overflow-wrap:anywhere] ${i === 0 ? 'font-bold' : ''}`}>{l}</p>
          ))}
          {valeurMention(config, 'CGV_DEPOT').trim() && (
            <p className="mt-2 pt-2 border-t border-dashed border-slate-300 text-left whitespace-pre-line text-[11px] [overflow-wrap:anywhere]">
              {valeurMention(config, 'CGV_DEPOT').trim()}
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={onSave} disabled={saving} className="btn-primary min-h-[44px]">
          {saving ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
          Enregistrer
        </button>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">Durées de conservation</h2>
        <p className="text-sm text-slate-600 mb-4">
          Anonymise les clients sans activité depuis {valeurMention(initial, 'RGPD_RETENTION_MOIS') || DEFAUTS_MENTIONS.RGPD_RETENTION_MOIS} mois
          et efface les codes PIN et schémas des tickets rendus ou clôturés depuis plus de {valeurMention(initial, 'PURGE_CODES_JOURS') || DEFAUTS_MENTIONS.PURGE_CODES_JOURS} jours.
          Les montants restent conservés (obligation comptable).
        </p>
        {dureesModifiees && (
          <p className="text-sm text-amber-800 mb-3" role="status">Enregistrez d'abord les nouvelles durées : l'aperçu utilise les valeurs enregistrées.</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={calculerApercu} disabled={apercuBusy || appliquerBusy || dureesModifiees}
            aria-busy={apercuBusy} className="btn-secondary min-h-[44px]">
            {apercuBusy ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <Search className="w-4 h-4" aria-hidden="true" />}
            Calculer l'aperçu
          </button>
          {apercu && !rien && !confirmer && (
            <button type="button" onClick={() => setConfirmer(true)} className="btn-danger min-h-[44px]">
              <Trash2 className="w-4 h-4" aria-hidden="true" /> Appliquer…
            </button>
          )}
        </div>
        <div aria-live="polite">
          {apercu && (
            <p className="mt-3 text-sm text-slate-800">
              {rien ? 'Rien à faire : aucune donnée n’a dépassé sa durée de conservation.' : (
                <>À traiter : <strong>{apercu.clients}</strong> client{apercu.clients > 1 ? 's' : ''} à anonymiser,
                  {' '}<strong>{apercu.codes}</strong> code{apercu.codes > 1 ? 's' : ''} de déverrouillage à effacer.</>
              )}
            </p>
          )}
          {resultat && (
            <p className="mt-3 text-sm text-emerald-800">
              Fait : {resultat.clients} client{resultat.clients > 1 ? 's' : ''} anonymisé{resultat.clients > 1 ? 's' : ''},
              {' '}{resultat.codes} code{resultat.codes > 1 ? 's' : ''} effacé{resultat.codes > 1 ? 's' : ''}.
            </p>
          )}
        </div>
        {confirmer && apercu && (
          <div role="group" aria-labelledby="retention-confirm-titre" className="mt-4 p-4 rounded-xl border-2 border-red-300 bg-red-50">
            <p id="retention-confirm-titre" className="text-sm font-semibold text-red-900">
              Anonymiser {apercu.clients} client{apercu.clients > 1 ? 's' : ''} et effacer {apercu.codes} code{apercu.codes > 1 ? 's' : ''} ?
            </p>
            <p className="text-sm text-red-900 mt-1">Action irréversible : noms, téléphones et e-mails seront définitivement effacés.</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button type="button" ref={confirmerRef} onClick={() => setConfirmer(false)} className="btn-secondary min-h-[44px]">Annuler</button>
              <button type="button" onClick={appliquer} disabled={appliquerBusy} aria-busy={appliquerBusy} className="btn-danger min-h-[44px]">
                {appliquerBusy && <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />}
                Confirmer l'anonymisation
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="retention-auto-titre" className="text-sm font-semibold text-slate-800">Anonymisation automatique</h2>
            <p id="retention-auto-aide" className="text-sm text-slate-600 mt-1">
              Une fois par jour, applique les durées de conservation ci-dessus sans intervention. Désactivée par défaut.
            </p>
          </div>
          <button type="button" role="switch" ref={interrupteurRef}
            aria-checked={auto.actif} aria-labelledby="retention-auto-titre" aria-describedby="retention-auto-aide"
            aria-busy={autoBusy || undefined}
            onClick={basculerAuto}
            disabled={autoBusy || (!auto.actif && !activation && dureesModifiees)}
            className="inline-flex min-h-[44px] min-w-[56px] shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
            <span aria-hidden="true" className={`relative block h-7 w-12 rounded-full motion-safe:transition-colors ${auto.actif ? 'bg-brand-600' : 'bg-slate-500'}`}>
              <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-sm motion-safe:transition-transform ${auto.actif ? 'translate-x-5' : 'translate-x-0'}`} />
            </span>
          </button>
        </div>

        <ul className="mt-3 space-y-1 text-sm" aria-live="polite">
          <li className={`font-semibold ${auto.actif ? 'text-brand-800' : 'text-slate-800'}`}>
            {!auto.actif ? 'Désactivée : aucune anonymisation automatique.'
              : !auto.debut ? `Activée : première exécution ${RETENTION_AUTO_DELAI_JOURS} jours après l’activation.`
                : auto.debut > aujourdhui ? `Activée : première exécution le ${dateFr(auto.debut)}. D’ici là, rien n’est effacé.`
                  : `Activée depuis le ${dateFr(auto.debut)} : un passage par jour.`}
          </li>
          {(auto.actif || auto.derniere) && (
            <li className="text-slate-700">
              {auto.derniere ? `Dernière exécution : ${dateFr(auto.derniere)}` : 'Pas encore exécutée.'}
            </li>
          )}
          {typeof etatServeur?.clients_a_anonymiser === 'number' && (
            <li className="text-slate-700">
              Aujourd’hui : {pluriel(etatServeur.clients_a_anonymiser, 'client')} sans activité au-delà de la durée de conservation,
              {' '}{pluriel(Number(etatServeur.codes_a_purger) || 0, 'code')} de déverrouillage à effacer.
            </li>
          )}
        </ul>
        {!auto.actif && !activation && dureesModifiees && (
          <p className="text-sm text-amber-800 mt-2">Enregistrez d'abord les nouvelles durées pour activer l'anonymisation automatique.</p>
        )}

        {activation && (
          <div role="group" aria-labelledby="retention-auto-confirm-titre"
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              e.stopPropagation();
              fermerActivation();
            }}
            className="mt-4 p-4 rounded-xl border-2 border-red-300 bg-red-50">
            <p id="retention-auto-confirm-titre" className="text-sm font-bold text-red-900">Activer l'anonymisation automatique ?</p>
            <p className="text-sm font-semibold text-red-900 mt-1">{texteActivationAuto(activation.mois, debutRetentionAuto())}</p>
            <p className="text-sm text-red-900 mt-1">
              Noms, téléphones, e-mails et adresses seront définitivement effacés (les montants restent : obligation comptable).
              {' '}Aujourd’hui, cela concernerait {pluriel(activation.clients, 'client')} ; {pluriel(activation.codes, 'code')} de déverrouillage
              {activation.codes > 1 ? ' seraient effacés' : ' serait effacé'}. Vous pourrez la désactiver à tout moment.
            </p>
            <label htmlFor="retention-auto-mot" className="input-label mt-3 text-red-900">
              Tapez {MOT_CONFIRMATION_AUTO} pour confirmer
            </label>
            <input id="retention-auto-mot" ref={motAutoRef} value={motAuto} autoComplete="off" spellCheck={false}
              autoCapitalize="characters"
              onChange={e => setMotAuto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && motAutoOk) { e.preventDefault(); confirmerActivation(); } }}
              className="input min-h-[44px] max-w-xs font-mono uppercase" />
            <div className="flex flex-wrap gap-2 mt-3">
              <button type="button" onClick={fermerActivation} className="btn-secondary min-h-[44px]">Annuler</button>
              <button type="button" onClick={confirmerActivation} disabled={!motAutoOk || autoBusy} aria-busy={autoBusy || undefined}
                className="btn-danger min-h-[44px] disabled:cursor-not-allowed disabled:opacity-60">
                {autoBusy && <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />}
                Activer l'anonymisation automatique
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Étagère (paramètres ETAGERE_*, lus par backend/app/services/etagere.py) ───
// Loi du 31 décembre 1903 : un objet confié pour réparation ne peut être vendu qu'un an
// après, et seulement sur autorisation du juge
export const ETAGERE_DELAI_MIN = 365;
export const ETAGERE_DELAI_MAX = 3650;
export const ETAGERE_EMPLACEMENTS_MAX = 40;
export const PALIERS_RELANCE_DEFAUT = '3, 10, 30, 90, 180, 330';
// Paramètre vidé exprès ≠ paramètre absent : « » = aucune relance, absent = paliers par défaut
const CLES_VIDE_EXPLICITE = new Set(['ETAGERE_RELANCE_PALIERS']);

/** La valeur diffère de celle enregistrée (vide et absent confondus, sauf CLES_VIDE_EXPLICITE). */
export function valeurModifiee(cle, valeur, initiale) {
  if (CLES_VIDE_EXPLICITE.has(cle)) return (valeur ?? null) !== (initiale ?? null);
  return (valeur || '') !== (initiale || '');
}

/**
 * Valeur envoyée au serveur (config.py) : paliers en ordre croissant sans doublon ; délai
 * vidé = délai légal par défaut (le serveur refuse un délai vide).
 */
export function normaliserParam(cle, valeur) {
  if (cle === 'ETAGERE_RELANCE_PALIERS') return lirePaliersRelance(valeur).paliers.join(', ');
  if (cle === 'ETAGERE_DELAI_ABANDON_JOURS') return String(valeur ?? '').trim() || String(ETAGERE_DELAI_MIN);
  return valeur || '';
}

/** « 30, 3;10 » → { paliers: [3, 10, 30], erreur } (triés, sans doublon ; vide : aucune relance). */
export function lirePaliersRelance(valeur) {
  const jetons = String(valeur ?? '').split(/[,;\s]+/).filter(Boolean);
  const invalide = jetons.find(j => !/^\d+$/.test(j) || Number(j) < 1 || Number(j) > ETAGERE_DELAI_MAX);
  const paliers = [...new Set(jetons.filter(j => /^\d+$/.test(j)).map(Number))]
    .filter(n => n >= 1 && n <= ETAGERE_DELAI_MAX)
    .sort((a, b) => a - b);
  return {
    paliers,
    erreur: invalide === undefined ? null
      : `Paliers de relance : « ${invalide} » n’est pas un nombre de jours entre 1 et ${ETAGERE_DELAI_MAX}.`,
  };
}

/** Erreurs bloquantes des paramètres d'étagère : { erreurs: { cle: message } }. */
export function controlesEtagere(config) {
  const erreurs = {};
  const delai = String(config?.ETAGERE_DELAI_ABANDON_JOURS ?? '').trim();
  if (delai && (!/^\d+$/.test(delai) || Number(delai) < ETAGERE_DELAI_MIN || Number(delai) > ETAGERE_DELAI_MAX)) {
    erreurs.ETAGERE_DELAI_ABANDON_JOURS = `Le délai de garde doit être un nombre entier de jours entre ${ETAGERE_DELAI_MIN} `
      + `(1 an, minimum légal) et ${ETAGERE_DELAI_MAX}.`;
  }
  const { erreur } = lirePaliersRelance(config?.ETAGERE_RELANCE_PALIERS);
  if (erreur) erreurs.ETAGERE_RELANCE_PALIERS = erreur;
  return { erreurs };
}

/**
 * Ajoute la saisie (« A1, A2 » : plusieurs à la fois) aux emplacements enregistrés (« A1, B2 ») :
 * { valeur, ajoutes, refuses } ; mêmes règles que le serveur (majuscules, 20 caractères, 40 au plus).
 */
export function ajouterEmplacements(valeur, saisie) {
  const liste = listeEmplacements({ emplacements: valeur });
  const ajoutes = [];
  const refuses = [];
  for (const brut of String(saisie ?? '').split(',')) {
    const propre = brut.replace(/\s+/g, ' ').trim();
    if (!propre) continue;
    if (propre.length > EMPLACEMENT_MAX) { refuses.push(`« ${propre} » : ${EMPLACEMENT_MAX} caractères maximum`); continue; }
    const e = normaliserEmplacement(propre);
    if (liste.includes(e)) { refuses.push(`${e} est déjà dans la liste`); continue; }
    if (liste.length >= ETAGERE_EMPLACEMENTS_MAX) { refuses.push(`${ETAGERE_EMPLACEMENTS_MAX} emplacements maximum`); break; }
    liste.push(e);
    ajoutes.push(e);
  }
  return { valeur: liste.join(', '), ajoutes, refuses };
}

export function retirerEmplacement(valeur, emplacement) {
  return listeEmplacements({ emplacements: valeur }).filter(e => e !== emplacement).join(', ');
}

function OngletEtagere({ config, onChange, onSave, saving }) {
  const { erreurs } = controlesEtagere(config);
  const [saisie, setSaisie] = useState('');
  const [retour, setRetour] = useState(null);
  const saisieRef = useRef(null);
  const emplacements = listeEmplacements({ emplacements: config.ETAGERE_EMPLACEMENTS });
  const delai = config.ETAGERE_DELAI_ABANDON_JOURS ?? '';
  const paliersTexte = config.ETAGERE_RELANCE_PALIERS ?? PALIERS_RELANCE_DEFAUT;
  const { paliers } = lirePaliersRelance(paliersTexte);
  const delaiJours = erreurs.ETAGERE_DELAI_ABANDON_JOURS ? null : (Number(String(delai).trim()) || ETAGERE_DELAI_MIN);
  const auDela = delaiJours ? paliers.filter(p => p >= delaiJours) : [];
  const paliersDefaut = lirePaliersRelance(PALIERS_RELANCE_DEFAUT).paliers.join(',') === paliers.join(',');

  const ajouter = () => {
    const r = ajouterEmplacements(config.ETAGERE_EMPLACEMENTS, saisie);
    if (r.ajoutes.length) {
      onChange('ETAGERE_EMPLACEMENTS', r.valeur);
      setSaisie('');
    }
    const textes = [];
    if (r.ajoutes.length) textes.push(`Ajouté : ${r.ajoutes.join(', ')}`);
    textes.push(...r.refuses);
    setRetour(textes.length ? { erreur: !r.ajoutes.length, texte: `${textes.join(' · ')}.` } : null);
    saisieRef.current?.focus();
  };

  const retirer = (e) => {
    onChange('ETAGERE_EMPLACEMENTS', retirerEmplacement(config.ETAGERE_EMPLACEMENTS, e));
    setRetour({ erreur: false, texte: `${e} retiré.` });
    // Le bouton cliqué disparaît : le focus revient au champ d'ajout
    saisieRef.current?.focus();
  };

  const normaliserPaliers = () => {
    if (lirePaliersRelance(paliersTexte).erreur || !String(paliersTexte).trim()) return;
    const propre = paliers.join(', ');
    if (propre !== paliersTexte) onChange('ETAGERE_RELANCE_PALIERS', propre);
  };

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-brand-600" aria-hidden="true" /> Emplacements de l’étagère
        </h2>
        <p className="text-sm text-slate-600 mb-4">
          Boutons proposés pour ranger un appareil réparé (fiche ticket, scan comptoir, étagère « À récupérer »).
          Un emplacement libre (ex. B3) reste toujours possible.
        </p>
        {emplacements.length > 0 ? (
          <ul aria-label="Emplacements proposés" className="flex flex-wrap gap-2">
            {emplacements.map(e => (
              <li key={e} className="inline-flex items-center rounded-lg border border-slate-300 bg-white pl-3 font-mono text-sm font-bold text-slate-900">
                {e}
                <button type="button" onClick={() => retirer(e)} aria-label={`Retirer ${e}`}
                  className="ml-1 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-r-lg text-slate-600 hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-700">Aucun emplacement proposé : l’équipe saisit l’emplacement à la main.</p>
        )}
        <div className="mt-4">
          <label htmlFor="etagere-ajout" className="input-label">Ajouter des emplacements</label>
          <div className="flex flex-wrap gap-2">
            <input id="etagere-ajout" ref={saisieRef} value={saisie} autoComplete="off" spellCheck={false}
              autoCapitalize="characters" placeholder="A1, A2, B1"
              aria-describedby="etagere-ajout-aide etagere-ajout-retour"
              onChange={e => { setSaisie(e.target.value.toUpperCase()); setRetour(null); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ajouter(); } }}
              className="input min-h-[44px] flex-1 min-w-[10rem] font-mono uppercase placeholder:normal-case" />
            <button type="button" onClick={ajouter} disabled={!saisie.trim()} className="btn-secondary min-h-[44px]">
              <Plus className="w-4 h-4" aria-hidden="true" /> Ajouter
            </button>
          </div>
          <p id="etagere-ajout-aide" className="text-xs text-slate-600 mt-1">
            Séparez par des virgules pour en ajouter plusieurs. {EMPLACEMENT_MAX} caractères par emplacement,
            {' '}{ETAGERE_EMPLACEMENTS_MAX} emplacements au plus ({emplacements.length} pour l’instant).
          </p>
          <p id="etagere-ajout-retour" role="status" aria-live="polite"
            className={`text-xs mt-1 min-h-[1rem] ${retour?.erreur ? 'font-semibold text-red-700' : 'text-emerald-800'}`}>
            {retour?.texte || ''}
          </p>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Archive className="w-4 h-4 text-brand-600" aria-hidden="true" /> Appareils non récupérés
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="etagere-delai" className="input-label">Délai de garde légal (jours)</label>
            <input id="etagere-delai" type="number" inputMode="numeric" min={ETAGERE_DELAI_MIN} max={ETAGERE_DELAI_MAX} step={1}
              value={delai} placeholder={String(ETAGERE_DELAI_MIN)}
              onChange={e => onChange('ETAGERE_DELAI_ABANDON_JOURS', e.target.value)}
              aria-invalid={erreurs.ETAGERE_DELAI_ABANDON_JOURS ? 'true' : undefined}
              aria-describedby={`etagere-delai-aide${erreurs.ETAGERE_DELAI_ABANDON_JOURS ? ' etagere-delai-err' : ''}`}
              className={`input min-h-[44px] ${erreurs.ETAGERE_DELAI_ABANDON_JOURS ? 'border-red-400' : ''}`} />
            <p id="etagere-delai-aide" className="text-xs text-slate-600 mt-1">
              Loi du 31/12/1903 : 1 an minimum, vente seulement sur autorisation du juge.
              {' '}{delaiJours ? `Soit ${formatDelai(delaiJours)}${String(delai).trim() ? '' : ' (par défaut)'}.` : ''}
            </p>
            {erreurs.ETAGERE_DELAI_ABANDON_JOURS && (
              <p id="etagere-delai-err" className="text-xs text-red-700 mt-1">{erreurs.ETAGERE_DELAI_ABANDON_JOURS}</p>
            )}
          </div>
          <div>
            <label htmlFor="etagere-paliers" className="input-label">Paliers de relance (jours)</label>
            <input id="etagere-paliers" inputMode="numeric" autoComplete="off" value={paliersTexte}
              onChange={e => onChange('ETAGERE_RELANCE_PALIERS', e.target.value)}
              onBlur={normaliserPaliers}
              aria-invalid={erreurs.ETAGERE_RELANCE_PALIERS ? 'true' : undefined}
              aria-describedby={`etagere-paliers-aide ${erreurs.ETAGERE_RELANCE_PALIERS ? 'etagere-paliers-err' : 'etagere-paliers-apercu'}`}
              className={`input min-h-[44px] font-mono ${erreurs.ETAGERE_RELANCE_PALIERS ? 'border-red-400' : ''}`} />
            <p id="etagere-paliers-aide" className="text-xs text-slate-600 mt-1">
              Jours après la fin de réparation, séparés par des virgules. Vide : aucune relance proposée.
            </p>
            {erreurs.ETAGERE_RELANCE_PALIERS ? (
              <p id="etagere-paliers-err" className="text-xs text-red-700 mt-1">{erreurs.ETAGERE_RELANCE_PALIERS}</p>
            ) : (
              <p id="etagere-paliers-apercu" className="text-xs text-slate-800 mt-1">
                {paliers.length ? `Relance proposée à ${paliers.map(p => `J+${p}`).join(', ')}.` : 'Aucune relance proposée.'}
                {auDela.length > 0 && ` Au-delà du délai de garde : ${auDela.map(p => `J+${p}`).join(', ')}.`}
              </p>
            )}
            {!paliersDefaut && (
              <button type="button" onClick={() => onChange('ETAGERE_RELANCE_PALIERS', PALIERS_RELANCE_DEFAUT)}
                className="mt-1 inline-flex min-h-[44px] items-center rounded-lg px-1 text-sm font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                Paliers par défaut ({PALIERS_RELANCE_DEFAUT})
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={onSave} disabled={saving} className="btn-primary min-h-[44px]">
          {saving ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
          Enregistrer
        </button>
      </div>
    </div>
  );
}

const COLORS = ['#3B82F6', '#8B5CF6', '#EC4899', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#06B6D4', '#6366F1', '#64748B'];

const DEFAULT_MSG_TEMPLATES = [
  { id: 1, label: "Appareil recu", message: "Bonjour {prenom}, votre {appareil} a bien ete pris en charge sous le numero {code}. Nous vous tiendrons informe de l'avancement. Klikphone 04 79 60 89 22" },
  { id: 2, label: "Diagnostic en cours", message: "Bonjour {prenom}, le diagnostic de votre {appareil} est en cours. Nous reviendrons vers vous rapidement. Klikphone" },
  { id: 3, label: "Devis a valider", message: "Bonjour {prenom}, le devis pour votre {appareil} est de {montant} EUR. Merci de nous confirmer votre accord. Klikphone 04 79 60 89 22" },
  { id: 4, label: "En cours de reparation", message: "Bonjour {prenom}, la reparation de votre {appareil} est en cours. Klikphone" },
  { id: 5, label: "Attente piece", message: "Bonjour {prenom}, nous sommes en attente d'une piece pour votre {appareil}. Nous vous previendrons des reception. Klikphone" },
  { id: 6, label: "Appareil pret", message: "Bonjour {prenom}, votre {appareil} est pret ! Vous pouvez venir le recuperer a la boutique. Montant : {montant} EUR. Klikphone 79 Place Saint Leger, Chambery" },
  { id: 7, label: "Commande arrivee", message: "Bonjour {prenom}, la piece commandee pour votre {appareil} est arrivee. Nous lancons la reparation. Klikphone 04 79 60 89 22" },
  { id: 8, label: "Non reparable", message: "Bonjour {prenom}, malheureusement votre {appareil} n'est pas reparable. Vous pouvez passer recuperer votre appareil en boutique. Klikphone" },
  { id: 9, label: "Rappel RDV", message: "Bonjour {prenom}, nous vous rappelons votre rendez-vous demain pour votre {appareil}. Klikphone 79 Place Saint Leger, Chambery" },
  { id: 10, label: "Personnalise", message: "" },
  { id: 12, label: "Demande d'accord", message: "Bonjour {prenom}, le devis pour la réparation de votre {marque} {modele} est de {montant} €. Vous pouvez accepter ou refuser directement en cliquant ici : {lien_suivi}. Merci, l'équipe Klikphone" },
];

export default function ConfigPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { animations, setAnimations } = useSettings();
  const [config, setConfig] = useState({});
  const [team, setTeam] = useState([]);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  // Team form
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [teamForm, setTeamForm] = useState({ nom: '', role: 'tech', couleur: '#3B82F6', actif: true });
  const [showAdminCodeModal, setShowAdminCodeModal] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [adminCodeError, setAdminCodeError] = useState('');
  const [discordTesting, setDiscordTesting] = useState(false);

  // Message templates
  const [msgTemplates, setMsgTemplates] = useState([]);
  const [msgSaving, setMsgSaving] = useState(false);

  // PIN change
  const [pinForm, setPinForm] = useState({ target: 'accueil', old_pin: '', new_pin: '' });
  const [pinChanging, setPinChanging] = useState(false);

  // Admin password change
  const [adminPwdForm, setAdminPwdForm] = useState({ old_password: '', new_password: '', confirm: '' });
  const [adminPwdChanging, setAdminPwdChanging] = useState(false);
  const [adminPwdError, setAdminPwdError] = useState('');

  // Caisse
  const [caisseConfig, setCaisseConfig] = useState({});
  const caisseInitRef = useRef({});
  const [caisseSaving, setCaisseSaving] = useState(false);
  const [caisseTesting, setCaisseTesting] = useState(false);

  // SMTP email test
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpTestEmail, setSmtpTestEmail] = useState('');

  // Sauvegarde
  const [backupBusy, setBackupBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);

  // Élévation admin : une action sensible refusée faute de jeton (valable 10 min) rouvre
  // l'identification admin, puis est rejouée une fois. Plusieurs refus simultanés attendent ensemble.
  const { sensible, adminPrompt } = useAdminElevation();

  // Track unsaved config changes
  const initialConfigRef = useRef({});
  const hasUnsavedChanges = useCallback(() => {
    const init = initialConfigRef.current;
    return Object.keys(config).some(k => valeurModifiee(k, config[k], init[k]));
  }, [config]);

  // Warn on browser close/reload if unsaved changes
  useEffect(() => {
    const handler = (e) => {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // Catalog
  const [catalogCategories, setCatalogCategories] = useState(CATALOG_CATEGORIES);
  const [catalogCategorie, setCatalogCategorie] = useState('Smartphone');
  const [catalog, setCatalog] = useState({ marques: [], version: null, repli: false });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogMarqueFiltre, setCatalogMarqueFiltre] = useState('');
  const [catalogExpanded, setCatalogExpanded] = useState({});
  const [newMarque, setNewMarque] = useState('');
  const [newModele, setNewModele] = useState({ marque: '', modele: '', annee: '' });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkResult, setBulkResult] = useState(null);
  const catalogReqRef = useRef(0);

  const { data: configData, loading, mutate: mutateConfig } = useApi(
    'config:main',
    async () => {
      const [configRaw, teamData] = await Promise.all([api.getConfig(), api.getTeam()]);
      const configMap = {};
      if (Array.isArray(configRaw)) {
        configRaw.forEach(c => { configMap[c.cle] = c.valeur; });
      } else {
        Object.assign(configMap, configRaw);
      }
      return { config: configMap, team: teamData };
    },
    { tags: ['config', 'team'], ttl: 300_000 }
  );

  useEffect(() => {
    if (configData) {
      // Relecture (enregistrement immédiat d'un interrupteur, autre poste) : la saisie pas
      // encore enregistrée ailleurs sur la page est gardée
      const init = initialConfigRef.current;
      const serveur = configData.config;
      setConfig(c => {
        const next = { ...serveur };
        for (const [k, v] of Object.entries(c)) if (valeurModifiee(k, v, init[k])) next[k] = v;
        return next;
      });
      initialConfigRef.current = { ...serveur };
      setTeam(configData.team);
    }
  }, [configData]);

  // Même tri que les formulaires (/tree) ; repli sur /all (ordre alphabétique) si /tree échoue.
  // Vue admin : toujours revalidée auprès du serveur (modifs faites depuis un autre poste comprises).
  const loadCatalog = async (cat = catalogCategorie) => {
    const req = ++catalogReqRef.current;
    setCatalogLoading(true);
    let data;
    try {
      const tree = await api.getCatalogTree(cat, { fresh: true });
      data = {
        marques: (Array.isArray(tree?.marques) ? tree.marques : [])
          .filter(x => x?.marque && x.marque !== MARQUE_AUTRE)
          .map(x => ({ marque: x.marque, modeles: (x.modeles || []).map(y => ({ m: y.m, a: y.a ?? null })) })),
        version: tree?.version ?? null,
        repli: false,
      };
    } catch {
      try {
        const all = await api.getAllCatalog();
        const marques = [...new Set((all?.marques || []).filter(m => m.categorie === cat).map(m => m.marque))];
        data = {
          marques: marques.map(marque => ({
            marque,
            modeles: (all?.modeles || []).filter(m => m.categorie === cat && m.marque === marque).map(m => ({ m: m.modele, a: m.annee ?? null })),
          })),
          version: null,
          repli: true,
        };
      } catch (err) {
        console.error(err);
        data = { marques: [], version: null, repli: true };
        if (req === catalogReqRef.current) toast.error('Catalogue indisponible');
      }
    }
    if (req !== catalogReqRef.current) return;
    setCatalog(data);
    setCatalogLoading(false);
  };

  const selectCatalogCategorie = (cat) => {
    setCatalogCategorie(cat);
    setCatalogMarqueFiltre('');
    setCatalogExpanded({});
    setNewModele({ marque: '', modele: '', annee: '' });
    setBulkResult(null);
    loadCatalog(cat);
  };

  useEffect(() => {
    if (activeTab === 'catalog') {
      loadCatalog();
      api.getCategories()
        .then(list => {
          if (!Array.isArray(list)) return;
          setCatalogCategories([...new Set([...list.filter(c => typeof c === 'string' && c.trim()), ...CATALOG_CATEGORIES])]);
        })
        .catch(() => {});
    }
    if (activeTab === 'caisse') {
      sensible(() => api.getCaisseConfig())
        .then(c => { caisseInitRef.current = { ...(c || {}) }; setCaisseConfig(c || {}); })
        .catch(err => { if (err?.code !== 'admin_cancelled') toast.error(err?.message || 'Configuration caisse indisponible'); });
    }
    if (activeTab === 'messages') {
      api.getMessageTemplates().then(data => {
        if (data && data.length > 0) setMsgTemplates(data);
        else setMsgTemplates(DEFAULT_MSG_TEMPLATES);
      }).catch(() => setMsgTemplates(DEFAULT_MSG_TEMPLATES));
    }
  }, [activeTab]);

  const handleSaveConfig = async () => {
    // Seules les valeurs modifiées bloquent : une ancienne valeur en base n'empêche pas d'enregistrer le reste
    const invalides = Object.entries(controlesMentions(config).erreurs)
      .filter(([cle]) => (config[cle] ?? '') !== (initialConfigRef.current[cle] ?? ''))
      .map(([, msg]) => msg);
    if (invalides.length) {
      setActiveTab('legal');
      toast.error(invalides[0]);
      return false;
    }
    const invalidesEtagere = Object.entries(controlesEtagere(config).erreurs)
      .filter(([cle]) => valeurModifiee(cle, config[cle], initialConfigRef.current[cle]))
      .map(([, msg]) => msg);
    if (invalidesEtagere.length) {
      setActiveTab('etagere');
      toast.error(invalidesEtagere[0]);
      return false;
    }
    setSaving(true);
    try {
      // Seules les valeurs modifiées partent ; un secret masqué (non modifié) jamais
      const init = initialConfigRef.current;
      const params = Object.entries(config)
        .filter(([cle, valeur]) => valeurModifiee(cle, valeur, init[cle]) && !isMasked(valeur))
        .map(([cle, valeur]) => ({ cle, valeur: normaliserParam(cle, valeur) }));
      if (params.length > 0) await sensible(() => api.setParams(params));
      // Boutons d'emplacement, délai et paliers relus par la fiche, le scan et l'étagère
      if (params.some(p => p.cle.startsWith('ETAGERE_'))) {
        Promise.resolve().then(() => api.getEtagereConfig({ fresh: true })).catch(() => {});
      }
      initialConfigRef.current = { ...config };
      // Rafraîchit l'entrée de cache 'config:main' avec les valeurs sauvegardées
      // (sinon le cache frais avec les ANCIENNES valeurs écrase l'écran au retour
      // sur la page, et un re-save renvoie les anciennes valeurs en base).
      mutateConfig(prev => prev ? { ...prev, config: { ...config } } : prev);
      invalidateCache('config');
      toast.success('Configuration enregistrée');
      return true;
    } catch (err) {
      toast.error(err?.message || 'Erreur sauvegarde');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (key, value) => {
    setConfig(c => ({ ...c, [key]: value }));
  };
  const updateMention = (key, value) => {
    setConfig(c => avecMention(c, key, value));
  };
  // Champ secret vidé : on revient à la valeur masquée enregistrée (le secret est conservé)
  const updateSecret = (key, value) => {
    const init = initialConfigRef.current[key];
    setConfig(c => ({ ...c, [key]: value === '' && isMasked(init) ? init : value }));
  };
  const updateCaisseSecret = (key, value) => {
    const init = caisseInitRef.current[key];
    setCaisseConfig(c => ({ ...c, [key]: value === '' && isMasked(init) ? init : value }));
  };
  const caissePayload = () => Object.fromEntries(Object.entries(caisseConfig).filter(([, v]) => !isMasked(v)));
  const saveCaisse = () => sensible(() => api.saveCaisseConfig(caissePayload()));

  // Interrupteur enregistré immédiatement (modules, autocomplétion)
  const saveParamNow = async (cle, valeur, message) => {
    setConfig(c => ({ ...c, [cle]: valeur }));
    try {
      await sensible(() => api.setParam(cle, valeur));
      initialConfigRef.current = { ...initialConfigRef.current, [cle]: valeur };
      invalidateCache('config');
      toast.success(message);
    } catch (err) {
      setConfig(c => ({ ...c, [cle]: initialConfigRef.current[cle] }));
      toast.error(err?.message || 'Erreur sauvegarde');
    }
  };

  // Plusieurs paramètres enregistrés tout de suite (anonymisation automatique) : [[cle, valeur]…].
  // L'appelant affiche le résultat ; l'erreur (annulation de l'élévation comprise) lui revient.
  const saveParamsNow = async (paires) => {
    await sensible(() => api.setParams(paires.map(([cle, valeur]) => ({ cle, valeur }))));
    const maj = Object.fromEntries(paires);
    initialConfigRef.current = { ...initialConfigRef.current, ...maj };
    setConfig(c => ({ ...c, ...maj }));
    invalidateCache('config');
  };

  // Team
  const resetTeamForm = () => {
    setTeamForm({ nom: '', role: 'tech', couleur: '#3B82F6', actif: true });
    setEditingMember(null);
    setShowTeamForm(false);
  };

  const handleSaveTeamMember = async (code) => {
    const isManager = teamForm.role === 'manager';
    // If manager role and no admin code provided yet, show modal
    if (isManager && !code) {
      setAdminCode('');
      setAdminCodeError('');
      setShowAdminCodeModal(true);
      return;
    }
    try {
      if (editingMember) {
        await sensible(() => api.updateTeamMember(editingMember.id, teamForm, isManager ? code : undefined));
      } else {
        await sensible(() => api.createTeamMember(teamForm, isManager ? code : undefined));
      }
      resetTeamForm();
      setShowAdminCodeModal(false);
      setAdminCode('');
      invalidateCache('config', 'team');
      toast.success(editingMember ? 'Membre mis à jour' : 'Membre créé');
    } catch (err) {
      if (err.message?.includes('Code administrateur')) {
        setAdminCodeError('Code administrateur incorrect');
      } else {
        toast.error(err.message || 'Erreur');
        setShowAdminCodeModal(false);
      }
    }
  };

  const handleEditMember = (member) => {
    setEditingMember(member);
    setTeamForm({
      nom: member.nom || '',
      role: member.role || 'tech',
      couleur: member.couleur || '#3B82F6',
      actif: member.actif !== 0,
    });
    setShowTeamForm(true);
  };

  const handleDeleteMember = async (id) => {
    if (!confirm('Supprimer ce membre ?')) return;
    try {
      await sensible(() => api.deleteTeamMember(id));
      invalidateCache('config', 'team');
      toast.success('Membre supprimé');
    } catch (err) {
      toast.error(err?.message || 'Erreur suppression');
    }
  };

  // PIN
  const handleChangePin = async () => {
    setPinChanging(true);
    try {
      await sensible(() => api.changePin(pinForm.target, pinForm.old_pin, pinForm.new_pin));
      setPinForm({ target: pinForm.target, old_pin: '', new_pin: '' });
      toast.success('PIN modifié');
    } catch (err) {
      toast.error(err.message || 'Erreur changement PIN');
    } finally {
      setPinChanging(false);
    }
  };

  const handleChangeAdminPassword = async () => {
    setAdminPwdError('');
    if (adminPwdForm.new_password !== adminPwdForm.confirm) {
      setAdminPwdError('Les mots de passe ne correspondent pas');
      return;
    }
    if (adminPwdForm.new_password.length < 4) {
      setAdminPwdError('Le mot de passe doit faire au moins 4 caractères');
      return;
    }
    setAdminPwdChanging(true);
    try {
      await sensible(() => api.changeAdminPassword(adminPwdForm.old_password, adminPwdForm.new_password));
      setAdminPwdForm({ old_password: '', new_password: '', confirm: '' });
      toast.success('Mot de passe admin modifié');
    } catch (err) {
      setAdminPwdError(err.message || 'Erreur');
    } finally {
      setAdminPwdChanging(false);
    }
  };

  // Catalog
  const anneeCatalogue = () => {
    const n = Number.parseInt(newModele.annee, 10);
    return Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : null;
  };

  const envoyerModeles = async (marque, modeles, annee) => {
    const res = await api.bulkAddModeles({ categorie: catalogCategorie, marque, annee, modeles });
    return { ajoutes: res?.ajoutes || 0, reactives: res?.reactives || 0 };
  };

  const handleAddMarque = async () => {
    const marque = newMarque.replace(/\s+/g, ' ').trim();
    if (!marque) return;
    if (normKey(marque) === normKey(MARQUE_AUTRE)) { toast.error('« Autre » est réservé à la saisie libre'); return; }
    if (catalog.marques.some(x => normKey(x.marque) === normKey(marque))) { toast.error('Cette marque existe déjà'); return; }
    setCatalogBusy(true);
    try {
      await api.addMarque(catalogCategorie, marque);
      setNewMarque('');
      setNewModele(f => ({ ...f, marque }));
      await loadCatalog();
      toast.success('Marque ajoutée');
    } catch (err) {
      toast.error(err.message || 'Erreur');
    } finally {
      setCatalogBusy(false);
    }
  };

  const handleAddModele = async () => {
    const { marque } = newModele;
    const modele = sansPrefixeMarque(marque, newModele.modele);
    if (!marque || !modele) return;
    if (modele.length > 80) { toast.error('80 caractères maximum'); return; }
    if (normKey(modele) === normKey(MARQUE_AUTRE)) { toast.error('« Autre » n\'est pas un modèle'); return; }
    setCatalogBusy(true);
    try {
      const { ajoutes, reactives } = await envoyerModeles(marque, [modele], anneeCatalogue());
      setNewModele(f => ({ ...f, modele: '' }));
      await loadCatalog();
      toast.success(ajoutes ? 'Modèle ajouté' : reactives ? 'Modèle réactivé' : 'Modèle déjà présent');
    } catch (err) {
      toast.error(err.message || 'Erreur');
    } finally {
      setCatalogBusy(false);
    }
  };

  const handleBulkAdd = async () => {
    const { marque } = newModele;
    const { modeles, tropLongs } = parseModelesEnMasse(bulkText, marque);
    if (!marque || modeles.length === 0 || modeles.length > BULK_MAX) return;
    setCatalogBusy(true);
    setBulkResult(null);
    try {
      const res = await envoyerModeles(marque, modeles, anneeCatalogue());
      setBulkResult({ ...res, marque, envoyes: modeles.length, ignores: tropLongs.length });
      setBulkText('');
      await loadCatalog();
      toast.success(`${res.ajoutes} modèle${res.ajoutes > 1 ? 's' : ''} ajouté${res.ajoutes > 1 ? 's' : ''}`);
    } catch (err) {
      toast.error(err.message || 'Erreur lors de l\'ajout en masse');
    } finally {
      setCatalogBusy(false);
    }
  };

  const handleDeleteMarque = async (marque, nbModeles) => {
    if (!confirm(`Supprimer la marque ${marque} et ses ${nbModeles} modèle${nbModeles > 1 ? 's' : ''} (${catalogCategorie}) ?`)) return;
    setCatalogBusy(true);
    try {
      await api.deleteMarque(catalogCategorie, marque);
      if (catalogMarqueFiltre === marque) setCatalogMarqueFiltre('');
      if (newModele.marque === marque) setNewModele(f => ({ ...f, marque: '' }));
      await loadCatalog();
      toast.success('Marque supprimée');
    } catch (err) {
      toast.error(err.message || 'Erreur');
    } finally {
      setCatalogBusy(false);
    }
  };

  const handleDeleteModele = async (marque, modele) => {
    if (!confirm(`Supprimer le modèle ${marque} ${modele} ?`)) return;
    setCatalogBusy(true);
    try {
      await api.deleteModele(catalogCategorie, marque, modele);
      await loadCatalog();
      toast.success('Modèle supprimé');
    } catch (err) {
      toast.error(err.message || 'Erreur');
    } finally {
      setCatalogBusy(false);
    }
  };

  // Vue filtrée : l'ordre de l'API est conservé, la recherche ne fait que masquer
  const catalogQuery = normKey(catalogSearch);
  const catalogFiltreActif = !!catalogQuery || !!catalogMarqueFiltre;
  const catalogVue = catalog.marques
    .filter(x => !catalogMarqueFiltre || x.marque === catalogMarqueFiltre)
    .map(x => {
      if (!catalogQuery || normKey(x.marque).startsWith(catalogQuery)) return { ...x, visibles: x.modeles };
      const hits = new Set(searchModeles(x.modeles, x.marque, catalogSearch, Infinity));
      return { ...x, visibles: x.modeles.filter(m => hits.has(m)) };
    })
    .filter(x => !catalogQuery || x.visibles.length > 0);
  const catalogNbModeles = catalog.marques.reduce((n, x) => n + x.modeles.length, 0);
  const bulkApercu = parseModelesEnMasse(bulkText, newModele.marque);

  // Backup
  // Export lourd : un seul appel (pas de relance automatique), bouton bloqué pendant l'export
  const handleDownloadBackup = async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      const data = await sensible(() => api.getBackup());
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `klikphone_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Backup téléchargé');
    } catch (err) {
      toast.error(err?.message ? `Erreur backup : ${err.message}` : 'Erreur backup');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleExportCSV = async () => {
    try {
      await api.exportClientsCsv();
      toast.success('Export CSV téléchargé');
    } catch (err) {
      toast.error('Erreur export CSV');
    }
  };

  const handleExportExcel = async () => {
    try {
      await api.exportClientsExcel();
      toast.success('Export Excel téléchargé');
    } catch (err) {
      toast.error('Erreur export Excel');
    }
  };

  const handleImportBackup = async (e) => {
    const file = e.target.files?.[0];
    if (!file || importBusy) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.tables) {
        toast.error('Format de backup invalide');
        return;
      }
      if (!confirm(`Restaurer le backup du ${data.backup_date?.slice(0, 10) || '?'} ? Cela remplacera TOUTES les données actuelles.`)) return;
      setImportBusy(true);
      const result = await sensible(() => api.importBackup(data));
      const total = Object.values(result.imported).reduce((a, b) => a + b, 0);
      toast.success(`Backup restauré : ${total} enregistrements importés`);
      // Une restauration remplace TOUTES les données : on vide tout le cache
      // (sinon dashboard/clients/commandes affichent les données d'avant le restore).
      clearCache();
      invalidateCache('config', 'team', 'tickets', 'dashboard', 'clients', 'commandes', 'interactions');
    } catch (err) {
      toast.error(err.message || 'Erreur import backup');
    } finally {
      setImportBusy(false);
      e.target.value = '';
    }
  };

  const tabs = [
    { id: 'general', label: 'Boutique', icon: Store },
    { id: 'legal', label: 'Mentions & RGPD', icon: Scale },
    { id: 'etagere', label: 'Étagère', icon: Archive },
    { id: 'team', label: 'Équipe', icon: Users },
    { id: 'catalog', label: 'Catalogue', icon: BookOpen },
    { id: 'messages', label: 'Messages', icon: MessageCircle },
    { id: 'notifications', label: 'Notifs', icon: Bell },
    { id: 'fidelite', label: 'Fidélité', icon: Star },
    { id: 'caisse', label: 'Caisse', icon: CreditCard },
    { id: 'security', label: 'Sécurité', icon: Shield },
    { id: 'modules', label: 'Modules', icon: Package },
    { id: 'appearance', label: 'Apparence', icon: Monitor },
    { id: 'backup', label: 'Sauvegarde', icon: Database },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl">
      {adminPrompt}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight">Configuration</h1>
          <p className="text-sm text-slate-500 mt-0.5">Paramètres de l'application</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 mb-6 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setActiveTab(id)} aria-pressed={activeTab === id}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 min-h-[44px] rounded-xl text-xs font-semibold transition-all whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
              ${activeTab === id
                ? 'bg-brand-600 text-white shadow-md shadow-brand-600/25'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 border border-transparent hover:border-slate-200'
              }`}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      {/* Unsaved changes banner */}
      {hasUnsavedChanges() && ['general', 'legal', 'etagere', 'notifications', 'fidelite'].includes(activeTab) && (
        <div className="flex items-center gap-3 mb-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl animate-in">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800 font-medium flex-1">Modifications non sauvegardées</p>
          <button onClick={handleSaveConfig} disabled={saving} className="btn-primary text-xs px-3 py-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Enregistrer
          </button>
        </div>
      )}

      {/* ═══ General tab ═══ */}
      {activeTab === 'general' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Informations boutique</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="boutique-nom" className="input-label">Nom de la boutique</label>
                <input id="boutique-nom" value={valeurMention(config, 'BOUTIQUE_NOM')} onChange={e => updateMention('BOUTIQUE_NOM', e.target.value)} className="input" />
              </div>
              <div>
                <label htmlFor="boutique-tel" className="input-label">Téléphone</label>
                <input id="boutique-tel" type="tel" value={valeurMention(config, 'BOUTIQUE_TEL')} onChange={e => updateMention('BOUTIQUE_TEL', e.target.value)} className="input" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="boutique-adresse" className="input-label">Adresse</label>
                <input id="boutique-adresse" value={valeurMention(config, 'BOUTIQUE_ADRESSE')} onChange={e => updateMention('BOUTIQUE_ADRESSE', e.target.value)} className="input" />
              </div>
              <div>
                <label htmlFor="boutique-email" className="input-label">Email</label>
                <input id="boutique-email" type="email" value={valeurMention(config, 'BOUTIQUE_EMAIL')} onChange={e => updateMention('BOUTIQUE_EMAIL', e.target.value)} className="input" />
              </div>
              <div>
                <label className="input-label">Site web</label>
                <input value={config.site_web || ''} onChange={e => updateConfig('site_web', e.target.value)} className="input" />
              </div>
              <div>
                <label htmlFor="boutique-siret" className="input-label">SIRET</label>
                <input id="boutique-siret" inputMode="numeric" value={valeurMention(config, 'BOUTIQUE_SIRET')} onChange={e => updateMention('BOUTIQUE_SIRET', e.target.value)} className="input font-mono" />
              </div>
              <div>
                <label className="input-label">TVA</label>
                <select value={config.tva || '20'} onChange={e => updateConfig('tva', e.target.value)} className="input">
                  <option value="0">Sans TVA</option>
                  <option value="20">20%</option>
                  <option value="10">10%</option>
                  <option value="5.5">5.5%</option>
                </select>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Impression</h2>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-sm text-slate-700">Conditions de dépôt, garantie, SIRET, TVA et RGPD imprimés sur les documents.</p>
                <button type="button" onClick={() => setActiveTab('legal')} className="btn-secondary min-h-[44px] text-xs">
                  <Scale className="w-4 h-4" aria-hidden="true" /> Mentions &amp; RGPD
                </button>
              </div>
              <div>
                <label className="input-label">Message personnalisé (ticket client)</label>
                <input value={config.message_ticket || ''} onChange={e => updateConfig('message_ticket', e.target.value)}
                  className="input" placeholder="Merci de votre confiance !" />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSaveConfig} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {activeTab === 'legal' && (
        <OngletMentionsRgpd config={config} initial={initialConfigRef.current} onChange={updateMention}
          onSave={handleSaveConfig} saving={saving} sensible={sensible} toast={toast}
          onEnregistrerMaintenant={saveParamsNow} />
      )}

      {activeTab === 'etagere' && (
        <OngletEtagere config={config} onChange={updateConfig} onSave={handleSaveConfig} saving={saving} />
      )}

      {/* ═══ Team tab ═══ */}
      {activeTab === 'team' && (
        <div className="space-y-5">
          <div className="flex justify-end">
            <button onClick={() => { resetTeamForm(); setShowTeamForm(true); }} className="btn-primary">
              <Plus className="w-4 h-4" /> Ajouter un membre
            </button>
          </div>

          {showTeamForm && (
            <div className="card p-5 border-brand-200 animate-in">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-800">
                  {editingMember ? 'Modifier le membre' : 'Nouveau membre'}
                </h3>
                <button onClick={resetTeamForm} className="btn-ghost p-1.5">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="input-label">Nom *</label>
                  <input value={teamForm.nom} onChange={e => setTeamForm(f => ({ ...f, nom: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="input-label">Rôle</label>
                  <select value={teamForm.role} onChange={e => setTeamForm(f => ({ ...f, role: e.target.value }))} className="input">
                    <option value="tech">Technicien</option>
                    <option value="accueil">Accueil</option>
                    <option value="admin">Admin</option>
                    <option value="manager">Manager</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Couleur</label>
                  <div className="flex flex-wrap gap-1.5">
                    {COLORS.map(c => (
                      <button key={c} onClick={() => setTeamForm(f => ({ ...f, couleur: c }))}
                        className={`w-7 h-7 rounded-lg border-2 transition-all ${
                          teamForm.couleur === c ? 'border-slate-900 scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={teamForm.actif}
                      onChange={e => setTeamForm(f => ({ ...f, actif: e.target.checked }))}
                      className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                    <span className="text-sm text-slate-700">Actif</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end mt-4 pt-3 border-t border-slate-100">
                <button onClick={() => handleSaveTeamMember()} disabled={!teamForm.nom} className="btn-primary">
                  <Save className="w-4 h-4" /> {editingMember ? 'Mettre à jour' : 'Créer'}
                </button>
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            {team.length === 0 ? (
              <div className="py-12 text-center">
                <Users className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-400">Aucun membre dans l'équipe</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {team.map(member => (
                  <div key={member.id} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: (member.couleur || '#3B82F6') + '20' }}>
                      <span className="font-bold text-sm" style={{ color: member.couleur || '#3B82F6' }}>
                        {(member.nom?.[0] || '').toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-800">{member.nom}</p>
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: member.couleur || '#94A3B8' }} />
                        {!member.actif && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-400">Inactif</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 capitalize">{member.role}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleEditMember(member)} className="btn-ghost p-1.5">
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDeleteMember(member.id)} className="btn-ghost p-1.5">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Admin code modal for Manager role */}
          {showAdminCodeModal && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowAdminCodeModal(false)}>
              <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4 animate-in" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="w-5 h-5 text-amber-500" />
                  <h3 className="text-sm font-bold text-slate-800">Code administrateur requis</h3>
                </div>
                <p className="text-xs text-slate-500 mb-4">Le rôle Manager donne accès aux données financières. Entrez le code administrateur pour continuer.</p>
                <input
                  type="password"
                  value={adminCode}
                  onChange={e => { setAdminCode(e.target.value); setAdminCodeError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleSaveTeamMember(adminCode)}
                  className="input w-full mb-2"
                  placeholder="Code administrateur"
                  autoFocus
                />
                {adminCodeError && (
                  <p className="text-xs text-red-500 mb-3">{adminCodeError}</p>
                )}
                <div className="flex justify-end gap-2 mt-3">
                  <button onClick={() => setShowAdminCodeModal(false)} className="btn-ghost text-sm px-3 py-1.5">
                    Annuler
                  </button>
                  <button onClick={() => handleSaveTeamMember(adminCode)} disabled={!adminCode} className="btn-primary text-sm px-3 py-1.5">
                    Valider
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ Catalog tab ═══ */}
      {activeTab === 'catalog' && (
        <div className="space-y-5">
          {/* Catégorie */}
          <div className="card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold text-slate-800">Catégorie</h2>
              <p className="text-xs text-slate-500" aria-live="polite">
                {catalogLoading ? 'Chargement…' : `${catalog.marques.length} marque${catalog.marques.length > 1 ? 's' : ''} · ${catalogNbModeles} modèle${catalogNbModeles > 1 ? 's' : ''}`}
                {catalog.version && <span className="ml-2 font-mono">v{catalog.version}</span>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Catégorie du catalogue">
              {catalogCategories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  aria-pressed={catalogCategorie === cat}
                  onClick={() => selectCatalogCategorie(cat)}
                  className={`min-h-11 px-4 rounded-xl text-sm font-semibold border motion-safe:transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1
                    ${catalogCategorie === cat
                      ? 'bg-brand-600 border-brand-600 text-white'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
            {catalog.repli && !catalogLoading && (
              <p className="mt-3 text-xs text-amber-700">Affichage de secours (ordre alphabétique, sans années) : l'arbre du catalogue est indisponible.</p>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Add marque */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Ajouter une marque <span className="font-normal text-slate-500">({catalogCategorie})</span></h2>
              <div className="flex gap-2">
                <label htmlFor="catalog-new-marque" className="sr-only">Nom de la marque</label>
                <input
                  id="catalog-new-marque"
                  value={newMarque}
                  onChange={e => setNewMarque(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddMarque(); } }}
                  className="input flex-1 min-h-11"
                  placeholder="Nom de la marque"
                  autoComplete="off"
                />
                <button type="button" onClick={handleAddMarque} disabled={catalogBusy || !newMarque.trim()} className="btn-primary min-h-11 min-w-11 px-3" aria-label="Ajouter la marque">
                  <Plus className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Add modele(s) */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Ajouter des modèles</h2>
              <div className="grid grid-cols-[1fr_8rem] gap-2">
                <div>
                  <label htmlFor="catalog-new-modele-marque" className="input-label">Marque</label>
                  <select
                    id="catalog-new-modele-marque"
                    value={newModele.marque}
                    onChange={e => { setNewModele(f => ({ ...f, marque: e.target.value })); setBulkResult(null); }}
                    className="input min-h-11"
                  >
                    <option value="">— Marque —</option>
                    {catalog.marques.map(x => <option key={x.marque} value={x.marque}>{x.marque}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="catalog-new-modele-annee" className="input-label">Année</label>
                  <input
                    id="catalog-new-modele-annee"
                    type="number"
                    inputMode="numeric"
                    min={1990}
                    max={2100}
                    value={newModele.annee}
                    onChange={e => setNewModele(f => ({ ...f, annee: e.target.value }))}
                    className="input min-h-11"
                    placeholder="Optionnel"
                    aria-describedby="catalog-annee-help"
                  />
                </div>
              </div>
              <p id="catalog-annee-help" className="mt-1 text-xs text-slate-500">Sans année, le modèle est classé en fin de liste.</p>

              <div className="flex gap-2 mt-3">
                <label htmlFor="catalog-new-modele" className="sr-only">Nom du modèle</label>
                <input
                  id="catalog-new-modele"
                  value={newModele.modele}
                  onChange={e => setNewModele(f => ({ ...f, modele: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddModele(); } }}
                  className="input flex-1 min-h-11"
                  placeholder={newModele.marque ? `Nom du modèle (sans « ${newModele.marque} »)` : 'Choisissez d\'abord la marque'}
                  disabled={!newModele.marque}
                  maxLength={80}
                  autoComplete="off"
                />
                <button type="button" onClick={handleAddModele} disabled={catalogBusy || !newModele.modele.trim() || !newModele.marque} className="btn-primary min-h-11 min-w-11 px-3" aria-label="Ajouter le modèle">
                  <Plus className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setBulkOpen(o => !o)}
                aria-expanded={bulkOpen}
                aria-controls="catalog-bulk"
                className="mt-3 inline-flex items-center gap-1.5 min-h-11 px-2 -ml-2 rounded-lg text-sm font-semibold text-brand-700 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {bulkOpen ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
                Ajout en masse
              </button>

              {bulkOpen && (
                <div id="catalog-bulk" className="mt-2 space-y-2">
                  <label htmlFor="catalog-bulk-text" className="input-label">Un modèle par ligne, du plus récent au plus ancien</label>
                  <textarea
                    id="catalog-bulk-text"
                    value={bulkText}
                    onChange={e => { setBulkText(e.target.value); setBulkResult(null); }}
                    rows={8}
                    className="input font-mono text-sm resize-y"
                    placeholder={'Galaxy S25 Ultra\nGalaxy S25+\nGalaxy S25'}
                    disabled={!newModele.marque}
                    aria-describedby="catalog-bulk-help"
                  />
                  <p id="catalog-bulk-help" className="text-xs text-slate-500">
                    {newModele.marque
                      ? <>
                          {bulkApercu.modeles.length} modèle{bulkApercu.modeles.length > 1 ? 's' : ''} {newModele.marque}
                          {anneeCatalogue() ? ` · année ${anneeCatalogue()}` : ' · sans année'}
                          {bulkApercu.tropLongs.length > 0 && <span className="text-amber-700"> · {bulkApercu.tropLongs.length} ligne{bulkApercu.tropLongs.length > 1 ? 's' : ''} de plus de 80 caractères ignorée{bulkApercu.tropLongs.length > 1 ? 's' : ''}</span>}
                          {bulkApercu.modeles.length > BULK_MAX && <span className="text-amber-700"> · {BULK_MAX} modèles maximum par envoi</span>}
                          . Doublons, lignes vides et préfixe « {newModele.marque} » retirés.
                        </>
                      : 'Choisissez d\'abord la marque.'}
                  </p>
                  <button
                    type="button"
                    onClick={handleBulkAdd}
                    disabled={catalogBusy || !newModele.marque || bulkApercu.modeles.length === 0 || bulkApercu.modeles.length > BULK_MAX}
                    className="btn-primary min-h-11"
                  >
                    {catalogBusy ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
                    Ajouter {bulkApercu.modeles.length || ''} modèle{bulkApercu.modeles.length > 1 ? 's' : ''}
                  </button>
                  {bulkResult && (
                    <p className="text-sm text-emerald-700" role="status">
                      {bulkResult.marque} : {bulkResult.ajoutes} ajouté{bulkResult.ajoutes > 1 ? 's' : ''}
                      {bulkResult.reactives > 0 && `, ${bulkResult.reactives} réactivé${bulkResult.reactives > 1 ? 's' : ''}`}
                      {bulkResult.envoyes - bulkResult.ajoutes - bulkResult.reactives > 0 && `, ${bulkResult.envoyes - bulkResult.ajoutes - bulkResult.reactives} déjà présent${bulkResult.envoyes - bulkResult.ajoutes - bulkResult.reactives > 1 ? 's' : ''}`}
                      {bulkResult.ignores > 0 && `, ${bulkResult.ignores} ignoré${bulkResult.ignores > 1 ? 's' : ''} (trop long)`}.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Catalog list */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-100 flex flex-wrap items-center gap-2">
              <span className="table-header mr-auto">Catalogue {catalogCategorie}</span>
              <div className="relative flex-1 min-w-[12rem] sm:flex-none sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" aria-hidden="true" />
                <label htmlFor="catalog-search" className="sr-only">Rechercher un modèle</label>
                <input
                  id="catalog-search"
                  type="search"
                  value={catalogSearch}
                  onChange={e => setCatalogSearch(e.target.value)}
                  className="input min-h-11 pl-9"
                  placeholder="Rechercher (ex. s24u, 15 pro)"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <label htmlFor="catalog-filtre-marque" className="sr-only">Filtrer par marque</label>
              <select
                id="catalog-filtre-marque"
                value={catalogMarqueFiltre}
                onChange={e => setCatalogMarqueFiltre(e.target.value)}
                className="input min-h-11 w-auto"
              >
                <option value="">Toutes les marques</option>
                {catalog.marques.map(x => <option key={x.marque} value={x.marque}>{x.marque}</option>)}
              </select>
            </div>

            {!catalogLoading && catalogVue.length === 0 && (
              <p className="px-5 py-6 text-sm text-slate-500">
                {catalogFiltreActif ? 'Aucun résultat pour ce filtre.' : 'Aucune marque dans cette catégorie.'}
              </p>
            )}

            <ul className="divide-y divide-slate-100">
              {catalogVue.map(({ marque, modeles, visibles }) => {
                const ouvert = catalogFiltreActif || !!catalogExpanded[marque];
                const panelId = `catalog-marque-${normKey(marque).replace(/ /g, '-') || 'x'}`;
                return (
                  <li key={marque}>
                    <div className="flex items-center gap-1 pl-3 pr-2">
                      <button
                        type="button"
                        onClick={() => setCatalogExpanded(e => ({ ...e, [marque]: !e[marque] }))}
                        aria-expanded={ouvert}
                        aria-controls={panelId}
                        disabled={catalogFiltreActif}
                        className="flex-1 min-w-0 flex items-center gap-2 min-h-11 px-2 rounded-lg text-left text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        {ouvert ? <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="w-4 h-4 shrink-0" aria-hidden="true" />}
                        <span className="truncate">{marque}</span>
                        <span className="text-xs font-normal text-slate-500 shrink-0">
                          {visibles.length !== modeles.length ? `${visibles.length} / ${modeles.length}` : modeles.length} modèle{modeles.length > 1 ? 's' : ''}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteMarque(marque, modeles.length)}
                        disabled={catalogBusy}
                        aria-label={`Supprimer la marque ${marque}`}
                        title={`Supprimer la marque ${marque}`}
                        className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                    {ouvert && (
                      <div id={panelId} className="px-5 pb-3">
                        {visibles.length === 0 ? (
                          <p className="text-xs text-slate-500 py-2">Aucun modèle — ajoutez-en via « Ajouter des modèles ».</p>
                        ) : (
                          <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                            {visibles.map(({ m, a }) => (
                              <li key={m} className="flex items-center gap-2 pl-3 rounded-lg bg-slate-50 border border-slate-100">
                                <span className="flex-1 min-w-0 truncate text-sm text-slate-800" title={m}>{m}</span>
                                {a && <span className="text-xs text-slate-500 tabular-nums shrink-0">{a}</span>}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteModele(marque, m)}
                                  disabled={catalogBusy}
                                  aria-label={`Supprimer le modèle ${marque} ${m}`}
                                  title="Supprimer"
                                  className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                                >
                                  <X className="w-4 h-4" aria-hidden="true" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* ═══ Messages tab ═══ */}
      {activeTab === 'messages' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
              <MessageCircle className="w-4 h-4" /> Messages predefinis
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              Variables disponibles : {'{prenom}'} {'{nom}'} {'{appareil}'} {'{code}'} {'{montant}'} {'{adresse}'} {'{tel_boutique}'} {'{horaires}'}
            </p>
            <div className="space-y-3">
              {msgTemplates.map((tp, i) => (
                <div key={tp.id}>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">{tp.label}</label>
                  <textarea
                    value={tp.message}
                    onChange={e => {
                      const updated = [...msgTemplates];
                      updated[i] = { ...updated[i], message: e.target.value };
                      setMsgTemplates(updated);
                    }}
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                    placeholder={tp.id === 10 ? 'Template libre (le texte sera modifiable)' : 'Message...'}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                onClick={async () => {
                  setMsgSaving(true);
                  try {
                    await sensible(() => api.saveMessageTemplates(msgTemplates));
                    toast.success('Templates sauvegardes');
                  } catch (err) { toast.error(err?.message || 'Erreur sauvegarde'); }
                  finally { setMsgSaving(false); }
                }}
                disabled={msgSaving}
                className="btn-primary"
              >
                <Save className="w-4 h-4" /> {msgSaving ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
              <button
                onClick={() => { setMsgTemplates(DEFAULT_MSG_TEMPLATES); toast.success('Templates reinitialises (sauvegarder pour appliquer)'); }}
                className="btn-ghost"
              >
                Reinitialiser
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Notifications tab ═══ */}
      {activeTab === 'notifications' && (
        <div className="space-y-5">
          <fieldset className="card p-5">
            <legend className="sr-only">Message proposé au client</legend>
            <h2 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-brand-600" aria-hidden="true" /> Message proposé au client
            </h2>
            <p className="text-xs text-slate-600 mb-4">
              Au passage à ces statuts (fiche ticket et scan comptoir), le message WhatsApp / SMS correspondant
              s’ouvre pré-rempli. Rien n’est envoyé sans un clic.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {STATUTS_MESSAGE.map(statut => {
                const actifs = statutsNotifies(config.NOTIFICATIONS_STATUTS);
                return (
                  <label key={statut} className="flex items-center gap-2.5 min-h-11 px-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={actifs.includes(statut)}
                      onChange={e => updateConfig('NOTIFICATIONS_STATUTS', basculerStatutNotifie(config.NOTIFICATIONS_STATUTS, statut, e.target.checked))}
                      className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="text-sm font-medium text-slate-700">{statut}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Discord Webhook</h2>
            <div className="space-y-4">
              <div>
                <label className="input-label" htmlFor="cfg-discord">URL du webhook</label>
                <div className="flex gap-2">
                  <SecretInput id="cfg-discord" reveal value={config.DISCORD_WEBHOOK} onChange={v => updateSecret('DISCORD_WEBHOOK', v)}
                    className="input font-mono text-xs flex-1" placeholder="https://discord.com/api/webhooks/..." />
                  <button
                    onClick={async () => {
                      setDiscordTesting(true);
                      try {
                        // Save first to make sure the URL is stored
                        if (!(await handleSaveConfig())) return;
                        await sensible(() => api.testDiscord());
                        toast.success('Webhook Discord fonctionnel !');
                      } catch (err) {
                        toast.error(err.message || 'Erreur webhook');
                      } finally {
                        setDiscordTesting(false);
                      }
                    }}
                    disabled={discordTesting}
                    className="btn-primary px-3 py-2 text-xs whitespace-nowrap"
                  >
                    {discordTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Tester'}
                  </button>
                </div>
              </div>

              <div>
                <label className="input-label mb-2">Notifications activées</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { key: 'nouveau_ticket', label: 'Nouveau ticket', desc: 'Quand un ticket est créé' },
                    { key: 'changement_statut', label: 'Changement de statut', desc: 'Quand un statut change' },
                    { key: 'reparation_terminee', label: 'Réparation terminée', desc: 'Quand une réparation est finie' },
                    { key: 'accord_client', label: 'Accord client', desc: 'Acceptation ou refus du devis' },
                    { key: 'connexion', label: 'Connexions', desc: 'Connexions / déconnexions' },
                  ].map(n => (
                    <label key={n.key} className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 cursor-pointer transition">
                      <input
                        type="checkbox"
                        checked={(config[`discord_notif_${n.key}`] || '1') !== '0'}
                        onChange={e => updateConfig(`discord_notif_${n.key}`, e.target.checked ? '1' : '0')}
                        className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 mt-0.5"
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-700">{n.label}</p>
                        <p className="text-[10px] text-slate-400">{n.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Mail className="w-4 h-4 text-brand-600" /> Email
            </h2>

            <div className="p-3 bg-brand-50 border border-brand-100 rounded-lg mb-4">
              <p className="text-xs font-semibold text-brand-700 mb-1">Resend (recommandé)</p>
              <p className="text-[10px] text-brand-600">Créez un compte gratuit sur resend.com, récupérez votre clé API. 100 emails/jour gratuits.</p>
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className="input-label" htmlFor="cfg-resend">Clé API Resend</label>
                <SecretInput id="cfg-resend" value={config.RESEND_API_KEY} onChange={v => updateSecret('RESEND_API_KEY', v)}
                  className="input font-mono text-xs" placeholder="re_xxxxxxxx..." />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="input-label">Email expéditeur</label>
                  <input value={config.SMTP_USER || ''} onChange={e => updateConfig('SMTP_USER', e.target.value)} className="input" placeholder="contact@klikphone.com" />
                  <p className="text-[10px] text-slate-400 mt-0.5">Doit correspondre au domaine vérifié sur Resend</p>
                </div>
                <div>
                  <label className="input-label">Nom affiché</label>
                  <input value={config.SMTP_NAME || ''} onChange={e => updateConfig('SMTP_NAME', e.target.value)} className="input" placeholder="Klikphone" />
                </div>
              </div>
            </div>

            <details className="group">
              <summary className="text-[10px] text-slate-400 cursor-pointer hover:text-slate-600 mb-3">SMTP avancé (fallback si Resend non configuré)</summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="input-label">Serveur SMTP</label>
                  <input value={config.SMTP_HOST || ''} onChange={e => updateConfig('SMTP_HOST', e.target.value)} className="input" placeholder="ex4.mail.ovh.net" />
                </div>
                <div>
                  <label className="input-label">Port</label>
                  <input value={config.SMTP_PORT || ''} onChange={e => updateConfig('SMTP_PORT', e.target.value)} className="input" placeholder="465" />
                </div>
                <div className="sm:col-span-2">
                  <label className="input-label" htmlFor="cfg-smtp-pwd">Mot de passe SMTP</label>
                  <SecretInput id="cfg-smtp-pwd" value={config.SMTP_PASSWORD} onChange={v => updateSecret('SMTP_PASSWORD', v)} className="input" />
                </div>
              </div>
            </details>

            <div className="mt-4 pt-4 border-t border-slate-100">
              <label className="input-label mb-1">Envoyer un email de test</label>
              <div className="flex gap-2">
                <input
                  value={smtpTestEmail}
                  onChange={e => setSmtpTestEmail(e.target.value)}
                  className="input flex-1"
                  placeholder="destinataire@email.com"
                  type="email"
                />
                <button
                  onClick={async () => {
                    if (!smtpTestEmail.trim()) { toast.error('Saisissez une adresse email de test'); return; }
                    setSmtpTesting(true);
                    try {
                      if (!(await handleSaveConfig())) return;
                      const res = await sensible(() => api.testSmtpEmail(smtpTestEmail.trim()));
                      if (res.status === 'ok') toast.success(res.message || 'Email de test envoyé !');
                      else toast.error(res.message || 'Erreur envoi');
                    } catch (err) {
                      toast.error(err.message || 'Erreur test email');
                    } finally {
                      setSmtpTesting(false);
                    }
                  }}
                  disabled={smtpTesting || !smtpTestEmail.trim()}
                  className="btn-primary px-4 text-xs whitespace-nowrap"
                >
                  {smtpTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                  Envoyer un email de test
                </button>
              </div>
            </div>
          </div>

          <SmsBrevoConfig config={config} updateConfig={updateConfig} saveParamNow={saveParamNow} />

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Chat & Assistant IA</h2>
            <div className="space-y-3">
              <div>
                <label className="input-label" htmlFor="cfg-anthropic">Cle API Anthropic</label>
                <SecretInput id="cfg-anthropic" value={config.ANTHROPIC_API_KEY} onChange={v => updateSecret('ANTHROPIC_API_KEY', v)}
                  className="input font-mono text-xs" placeholder="sk-ant-..." />
                <p className="text-[10px] text-slate-400 mt-1">Necessaire pour l'assistant IA. Obtenir sur console.anthropic.com</p>
              </div>
              <div>
                <label className="input-label">Modele Claude (optionnel)</label>
                <input value={config.ANTHROPIC_MODEL || ''} onChange={e => updateConfig('ANTHROPIC_MODEL', e.target.value)}
                  className="input text-xs" placeholder="claude-sonnet-4-5-20250929" />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSaveConfig} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {/* ═══ Fidélité & Jeu tab ═══ */}
      {activeTab === 'fidelite' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Programme de fidélité</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-800">Activer le programme fidélité</p>
                  <p className="text-xs text-slate-400 mt-0.5">Les clients cumulent des points sur chaque réparation</p>
                </div>
                <button
                  onClick={() => updateConfig('fidelite_active', (config.fidelite_active || '1') === '1' ? '0' : '1')}
                  className={`relative w-11 h-6 rounded-full transition-colors ${(config.fidelite_active || '1') === '1' ? 'bg-brand-600' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${(config.fidelite_active || '1') === '1' ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Points par euro dépensé</label>
                  <input type="number" value={config.fidelite_points_par_euro || '10'} onChange={e => updateConfig('fidelite_points_par_euro', e.target.value)}
                    className="input" min="1" />
                </div>
                <div>
                  <label className="input-label">Palier film verre trempé (pts)</label>
                  <input type="number" value={config.fidelite_palier_film || '1000'} onChange={e => updateConfig('fidelite_palier_film', e.target.value)}
                    className="input" min="100" step="100" />
                </div>
                <div>
                  <label className="input-label">Palier réduction (pts)</label>
                  <input type="number" value={config.fidelite_palier_reduction || '5000'} onChange={e => updateConfig('fidelite_palier_reduction', e.target.value)}
                    className="input" min="100" step="100" />
                </div>
                <div>
                  <label className="input-label">Montant réduction (€)</label>
                  <input type="number" value={config.fidelite_montant_reduction || '10'} onChange={e => updateConfig('fidelite_montant_reduction', e.target.value)}
                    className="input" min="1" />
                </div>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Jeu de grattage</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-800">Activer le jeu de grattage</p>
                  <p className="text-xs text-slate-400 mt-0.5">Un ticket grattable sur la page de suivi client</p>
                </div>
                <button
                  onClick={() => updateConfig('grattage_actif', (config.grattage_actif || '1') === '1' ? '0' : '1')}
                  className={`relative w-11 h-6 rounded-full transition-colors ${(config.grattage_actif || '1') === '1' ? 'bg-brand-600' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${(config.grattage_actif || '1') === '1' ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              <div>
                <label className="input-label">Fréquence de gain (1 gagnant tous les N tickets)</label>
                <input type="number" value={config.grattage_frequence || '10'} onChange={e => updateConfig('grattage_frequence', e.target.value)}
                  className="input w-40" min="2" />
                <p className="text-[10px] text-slate-400 mt-1">Ex: 10 = en moyenne 1 gagnant sur 10 tickets grattés</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSaveConfig} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {/* ═══ Caisse tab ═══ */}
      {activeTab === 'caisse' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h3 className="font-bold text-sm text-slate-800 mb-4 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-brand-600" /> Caisse Enregistreuse
            </h3>

            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input type="checkbox" checked={caisseConfig.CAISSE_ENABLED === '1'}
                onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_ENABLED: e.target.checked ? '1' : '0' }))}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 w-5 h-5" />
              <span className="text-sm font-semibold text-slate-700">Activer l'intégration Caisse Enregistreuse</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="input-label">Email de connexion</label>
                <input value={caisseConfig.CAISSE_LOGIN || ''} onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_LOGIN: e.target.value }))} className="input" />
              </div>
              <div>
                <label className="input-label" htmlFor="cfg-caisse-apikey">Token API (APIKEY)</label>
                <SecretInput id="cfg-caisse-apikey" value={caisseConfig.CAISSE_APIKEY} onChange={v => updateCaisseSecret('CAISSE_APIKEY', v)} className="input font-mono text-xs" />
              </div>
              <div>
                <label className="input-label" htmlFor="cfg-caisse-pwd">Mot de passe</label>
                <SecretInput id="cfg-caisse-pwd" value={caisseConfig.CAISSE_PASSWORD} onChange={v => updateCaisseSecret('CAISSE_PASSWORD', v)} className="input" />
              </div>
              <div>
                <label className="input-label">ID Boutique (SHOPID)</label>
                <input value={caisseConfig.CAISSE_SHOPID || ''} onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_SHOPID: e.target.value }))} className="input font-mono" />
              </div>
              <div>
                <label className="input-label">ID Carte bancaire</label>
                <input value={caisseConfig.CAISSE_CB_ID || ''} onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_CB_ID: e.target.value }))} className="input font-mono" />
              </div>
              <div>
                <label className="input-label">ID Espèces</label>
                <input value={caisseConfig.CAISSE_ESP_ID || ''} onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_ESP_ID: e.target.value }))} className="input font-mono" />
              </div>
              <div>
                <label className="input-label">ID Caisse (GENERALE)</label>
                <input value={caisseConfig.CAISSE_ID || ''} onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_ID: e.target.value }))} className="input font-mono" />
              </div>
              <div>
                <label className="input-label">ID Utilisateur</label>
                <input value={caisseConfig.CAISSE_USER_ID || ''} onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_USER_ID: e.target.value }))} className="input font-mono" />
              </div>
              <div className="sm:col-span-2">
                <label className="input-label">Rayon (pour TVA)</label>
                <div className="flex gap-2">
                  <input value={caisseConfig.CAISSE_RAYON_ID || ''} onChange={e => setCaisseConfig(c => ({ ...c, CAISSE_RAYON_ID: e.target.value }))} className="input font-mono flex-1" placeholder="ID du rayon" />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await saveCaisse();
                        const rayons = await sensible(() => api.getCaisseRayons());
                        const list = Array.isArray(rayons) ? rayons : [];
                        if (list.length === 0) { toast.error('Aucun rayon trouvé — vérifiez la config'); return; }
                        const options = list.map(r => `${r.id || r.ID} — ${r.name || r.nom || r.title || r.label || 'Sans nom'}`).join('\n');
                        const choix = prompt(`Choisissez un rayon (copiez l'ID) :\n\n${options}`);
                        if (choix && choix.trim()) {
                          const id = choix.trim().split(/\s/)[0];
                          setCaisseConfig(c => ({ ...c, CAISSE_RAYON_ID: id }));
                          toast.success(`Rayon ${id} sélectionné`);
                        }
                      } catch (err) { toast.error(err.message || 'Erreur chargement rayons'); }
                    }}
                    className="btn-ghost text-xs px-3 py-2 whitespace-nowrap border border-slate-200"
                  >
                    <Search className="w-3.5 h-3.5 inline mr-1" />Charger rayons
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Rayon avec le bon taux de TVA (ex: "Réparations" à 20%). Cliquez "Charger rayons" pour voir la liste. Sans rayon, pas de TVA.</p>
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={async () => {
                  setCaisseTesting(true);
                  try {
                    await saveCaisse();
                    const res = await sensible(() => api.testCaisseConnexion());
                    if (res.status === 'ok') toast.success(res.message || 'Connexion réussie');
                    else toast.error(res.message || 'Erreur connexion');
                  } catch (err) {
                    toast.error(err.message || 'Erreur test connexion');
                  } finally {
                    setCaisseTesting(false);
                  }
                }}
                disabled={caisseTesting}
                className="btn-secondary"
              >
                {caisseTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Tester la connexion
              </button>
              <button
                onClick={async () => {
                  setCaisseSaving(true);
                  try {
                    await saveCaisse();
                    caisseInitRef.current = { ...caisseConfig };
                    toast.success('Configuration caisse enregistrée');
                  } catch (err) {
                    toast.error(err?.message || 'Erreur sauvegarde');
                  } finally {
                    setCaisseSaving(false);
                  }
                }}
                disabled={caisseSaving}
                className="btn-primary"
              >
                {caisseSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Security tab ═══ */}
      {activeTab === 'security' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Changer le PIN d'accès</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="input-label">Espace</label>
                <select value={pinForm.target} onChange={e => setPinForm(f => ({ ...f, target: e.target.value }))} className="input">
                  <option value="accueil">Accueil</option>
                  <option value="tech">Technicien</option>
                </select>
              </div>
              <div>
                <label className="input-label">Ancien PIN</label>
                <input type="password" value={pinForm.old_pin} onChange={e => setPinForm(f => ({ ...f, old_pin: e.target.value }))}
                  className="input font-mono text-center tracking-widest" maxLength={4} placeholder="····" />
              </div>
              <div>
                <label className="input-label">Nouveau PIN</label>
                <input type="password" value={pinForm.new_pin} onChange={e => setPinForm(f => ({ ...f, new_pin: e.target.value }))}
                  className="input font-mono text-center tracking-widest" maxLength={4} placeholder="····" />
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={handleChangePin}
                disabled={pinChanging || pinForm.old_pin.length !== 4 || pinForm.new_pin.length !== 4}
                className="btn-primary">
                {pinChanging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                Changer le PIN
              </button>
            </div>
          </div>

          {/* Admin password */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
              <Shield className="w-4 h-4 text-red-500" />
              Mot de passe administrateur
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Ce mot de passe protège l'accès à la section Administration (Reporting, Avis, Community, Config).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="input-label">Ancien mot de passe</label>
                <input type="password" value={adminPwdForm.old_password}
                  onChange={e => { setAdminPwdForm(f => ({ ...f, old_password: e.target.value })); setAdminPwdError(''); }}
                  className="input" placeholder="••••••••" />
              </div>
              <div>
                <label className="input-label">Nouveau mot de passe</label>
                <input type="password" value={adminPwdForm.new_password}
                  onChange={e => { setAdminPwdForm(f => ({ ...f, new_password: e.target.value })); setAdminPwdError(''); }}
                  className="input" placeholder="••••••••" />
              </div>
              <div>
                <label className="input-label">Confirmer</label>
                <input type="password" value={adminPwdForm.confirm}
                  onChange={e => { setAdminPwdForm(f => ({ ...f, confirm: e.target.value })); setAdminPwdError(''); }}
                  className="input" placeholder="••••••••" />
              </div>
            </div>
            {adminPwdError && (
              <p className="text-xs text-red-500 mt-2">{adminPwdError}</p>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={handleChangeAdminPassword}
                disabled={adminPwdChanging || !adminPwdForm.old_password || !adminPwdForm.new_password || !adminPwdForm.confirm}
                className="btn-primary">
                {adminPwdChanging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                Changer le mot de passe
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Modules tab ═══ */}
      {activeTab === 'modules' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Modules optionnels</h2>
            <p className="text-xs text-slate-400 mb-4">Activez ou désactivez les modules pour afficher les pages correspondantes dans le menu latéral.</p>

            {/* Module Devis */}
            <div className="flex items-center justify-between py-3 border-t border-slate-100">
              <div>
                <p className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-brand-500" /> Module Devis
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Gestion complète des devis clients avec statuts, impression et conversion en ticket</p>
              </div>
              <button
                onClick={() => {
                  const newVal = config.MODULE_DEVIS_VISIBLE === 'true' ? 'false' : 'true';
                  saveParamNow('MODULE_DEVIS_VISIBLE', newVal, newVal === 'true' ? 'Module Devis activé' : 'Module Devis désactivé');
                }}
                role="switch" aria-checked={config.MODULE_DEVIS_VISIBLE === 'true'} aria-label="Module Devis"
                className={`relative w-11 h-6 rounded-full transition-colors ${config.MODULE_DEVIS_VISIBLE === 'true' ? 'bg-brand-600' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${config.MODULE_DEVIS_VISIBLE === 'true' ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            {/* Module Devis Flash */}
            <div className="flex items-center justify-between py-3 border-t border-slate-100">
              <div>
                <p className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-500" /> Module Devis Flash
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Consultation rapide des prix de réparation et catalogue de téléphones en vente</p>
              </div>
              <button
                onClick={() => {
                  const newVal = config.MODULE_DEVIS_FLASH_VISIBLE === 'true' ? 'false' : 'true';
                  saveParamNow('MODULE_DEVIS_FLASH_VISIBLE', newVal, newVal === 'true' ? 'Module Devis Flash activé' : 'Module Devis Flash désactivé');
                }}
                role="switch" aria-checked={config.MODULE_DEVIS_FLASH_VISIBLE === 'true'} aria-label="Module Devis Flash"
                className={`relative w-11 h-6 rounded-full transition-colors ${config.MODULE_DEVIS_FLASH_VISIBLE === 'true' ? 'bg-brand-600' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${config.MODULE_DEVIS_FLASH_VISIBLE === 'true' ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            <p className="text-[11px] text-slate-400 mt-4 pt-3 border-t border-slate-100">
              Rechargez la page après activation pour voir les changements dans le menu.
            </p>
          </div>
        </div>
      )}

      {/* ═══ Appearance tab ═══ */}
      {activeTab === 'appearance' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Apparence</h2>
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">Activer les animations</p>
                <p className="text-xs text-slate-400 mt-0.5">Transitions, effets de survol, apparitions progressives</p>
              </div>
              <button
                onClick={() => setAnimations(!animations)}
                className={`relative w-11 h-6 rounded-full transition-colors ${animations ? 'bg-brand-600' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${animations ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-2 pt-3 border-t border-slate-100">
              Désactivez les animations pour améliorer la fluidité sur les appareils plus lents.
            </p>

            {/* Autocomplétion toggle */}
            <div className="flex items-center justify-between py-3 mt-3 pt-3 border-t border-slate-100">
              <div>
                <p className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5 text-slate-500" /> Autocomplétion intelligente
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Suggestions dans les formulaires de modification de tickets</p>
              </div>
              <button
                onClick={() => {
                  const newVal = config.AFFICHER_AUTOCOMPLETION === 'false' ? 'true' : 'false';
                  saveParamNow('AFFICHER_AUTOCOMPLETION', newVal, newVal === 'true' ? 'Autocomplétion activée' : 'Autocomplétion désactivée');
                }}
                role="switch" aria-checked={config.AFFICHER_AUTOCOMPLETION !== 'false'} aria-label="Autocomplétion intelligente"
                className={`relative w-11 h-6 rounded-full transition-colors ${config.AFFICHER_AUTOCOMPLETION !== 'false' ? 'bg-brand-600' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${config.AFFICHER_AUTOCOMPLETION !== 'false' ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              L'apprentissage continue en arrière-plan même si l'affichage est désactivé.
            </p>
          </div>
        </div>
      )}

      {/* ═══ Backup tab ═══ */}
      {activeTab === 'backup' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Export clients</h2>
            <p className="text-sm text-slate-500 mb-3">Téléchargez la liste de tous les clients (avec nombre de tickets).</p>
            <div className="flex gap-2">
              <button onClick={handleExportCSV} className="btn-primary">
                <Download className="w-4 h-4" /> CSV
              </button>
              <button onClick={handleExportExcel} className="btn-primary">
                <Download className="w-4 h-4" /> Excel (.xlsx)
              </button>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Sauvegarde complète</h2>
            <p className="text-sm text-slate-500 mb-3">
              Téléchargez un backup JSON complet de la base de données (clients, tickets, config, équipe, catalogue).
            </p>
            <div className="flex gap-2">
              <button onClick={handleDownloadBackup} disabled={backupBusy} aria-busy={backupBusy} className="btn-primary min-h-[44px]">
                {backupBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Database className="w-4 h-4" aria-hidden="true" />}
                {backupBusy ? 'Export en cours… (peut prendre une minute)' : 'Télécharger le backup (JSON)'}
              </button>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Restaurer un backup</h2>
            <p className="text-sm text-slate-500 mb-3">
              Importez un fichier JSON de backup pour restaurer les données. Attention : cela remplacera toutes les données actuelles.
            </p>
            <label className={`btn-primary min-h-[44px] inline-flex focus-within:ring-2 focus-within:ring-brand-400 focus-within:ring-offset-2 ${importBusy ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}>
              {importBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
              {importBusy ? 'Restauration en cours…' : 'Importer un backup (.json)'}
              <input type="file" accept=".json" onChange={handleImportBackup} disabled={importBusy} className="sr-only" />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
