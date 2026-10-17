/**
 * Messages au client : modèles, variables ({prenom}, {montant}…), message proposé après un
 * changement de statut (fiche ticket, scan comptoir) et « appareil prêt » du scan comptoir.
 * Le serveur décide s'il faut proposer un message (paramètre NOTIFICATIONS_STATUTS, champ
 * `proposer_message` de PATCH /statut) ; ici on choisit le modèle à pré-remplir.
 * Rien n'est jamais envoyé sans un clic (WhatsApp, SMS, Email, « Terminé + prévenir le client »).
 */
import { versionCourteSms, smsSegments } from './sms';

// Même valeur par défaut que le serveur (api/tickets.py) quand le paramètre est absent
export const NOTIFICATIONS_STATUTS_DEFAUT = 'Réparation terminée';

const sansAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// id des modèles par défaut (MessageComposer, Config > Messages) ; mots du libellé en repli
export const MODELE_PAR_STATUT = {
  'En attente de diagnostic': { id: 2, mots: ['diagnostic'] },
  'En attente de pièce': { id: 5, mots: ['attente', 'piece'] },
  'Pièce reçue': { id: 7, mots: ['arrivee'] },
  "En attente d'accord client": { id: 12, mots: ['accord'] },
  'En cours de réparation': { id: 4, mots: ['en cours'] },
  'Réparation terminée': { id: 6, mots: ['pret'] },
};

// Statuts réglables dans Config > Notifs (ordre du parcours de réparation)
export const STATUTS_MESSAGE = Object.keys(MODELE_PAR_STATUT);

const aUnTexte = (tp) => !!String(tp?.message ?? '').trim();

/** id du modèle à pré-sélectionner pour `statut` parmi `templates`, ou null. */
export function modelePourStatut(templates, statut) {
  const regle = MODELE_PAR_STATUT[statut];
  if (!regle || !Array.isArray(templates)) return null;
  const parId = templates.find((tp) => tp?.id === regle.id && aUnTexte(tp));
  if (parId) return parId.id;
  const parLibelle = templates.find((tp) => aUnTexte(tp) && regle.mots.every((m) => sansAccents(tp.label).includes(m)));
  return parLibelle ? parLibelle.id : null;
}

/** Liste des statuts du paramètre (absent : valeur par défaut du serveur ; vide : aucun). */
export function statutsNotifies(valeur) {
  const v = valeur == null ? NOTIFICATIONS_STATUTS_DEFAUT : String(valeur);
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Nouvelle valeur du paramètre après avoir coché / décoché `statut` (statuts inconnus conservés). */
export function basculerStatutNotifie(valeur, statut, actif) {
  const liste = statutsNotifies(valeur).filter((s) => s !== statut);
  if (actif) liste.push(statut);
  const connus = STATUTS_MESSAGE.filter((s) => liste.includes(s));
  const autres = liste.filter((s) => !STATUTS_MESSAGE.includes(s));
  return [...connus, ...autres].join(',');
}

// ─── Modèles et variables (MessageComposer, carte « Prévenir le client » du scan) ──

export const DEFAULT_TEMPLATES = [
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
  { id: 11, label: "Demander avis Google", message: "Bonjour {prenom},\n\nMerci d'avoir fait confiance à Klikphone pour la réparation de votre {appareil} ! 🙏\n\nSi vous êtes satisfait de nos services, nous serions très reconnaissants si vous pouviez nous laisser un avis Google :\n\n👉 {lien_avis}\n\nVotre avis nous aide énormément ! Merci et à bientôt 😊\n\nL'équipe Klikphone" },
  { id: 12, label: "Demande d'accord", message: "Bonjour {prenom}, le devis pour la réparation de votre {marque} {modele} est de {montant} €. Vous pouvez accepter ou refuser directement en cliquant ici : {lien_suivi}. Merci, l'équipe Klikphone" },
];

export const LIEN_AVIS_DEFAUT = 'https://g.page/r/Cf6adrBONrj3EAE/review';
const ADRESSE_BOUTIQUE = '79 Place Saint Leger, 73000 Chambery';
const HORAIRES_BOUTIQUE = 'Lundi-Samedi 10h-19h';
const TEL_BOUTIQUE = '04 79 60 89 22';

const num = (v) => parseFloat(v) || 0;

/**
 * Variables d'un message client pour le ticket `t` et montants associés :
 * {montant} = reste dû (montants du serveur quand la fiche les a, sinon lignes − réduction
 * > tarif final > devis estimé, moins l'acompte) ; totalTicket sert au garde-fou « tarif ».
 */
export function contexteMessage(t, { lienAvis = LIEN_AVIS_DEFAUT, origin } = {}) {
  const tk = t || {};
  const appareil = tk.modele_autre || `${tk.marque || ''} ${tk.modele || ''}`.trim() || 'appareil';
  const acompte = num(tk.acompte);
  const redPct = num(tk.reduction_pourcentage);
  const redMnt = num(tk.reduction_montant);

  let linesTotal = 0;
  try {
    const reps = tk.reparation_supp && tk.reparation_supp.startsWith('[') ? JSON.parse(tk.reparation_supp) : [];
    linesTotal = reps.reduce((s, r) => s + num(r.prix), 0);
  } catch { /* ancien format */ }

  let totalAvantAcompte;
  if (linesTotal > 0) {
    const reduction = redPct > 0 ? linesTotal * (redPct / 100) : redMnt;
    totalAvantAcompte = Math.max(0, linesTotal - reduction);
  } else if (parseFloat(tk.tarif_final) > 0) {
    totalAvantAcompte = parseFloat(tk.tarif_final);
  } else {
    const devis = num(tk.devis_estime);
    const reduction = redPct > 0 ? devis * (redPct / 100) : redMnt;
    totalAvantAcompte = Math.max(0, devis - reduction);
  }

  const serveur = tk.montants && Number.isFinite(Number(tk.montants.reste)) ? tk.montants : null;
  const montant = serveur ? Number(serveur.reste) : (tk.paye ? 0 : Math.max(0, totalAvantAcompte - acompte));
  const totalTicket = serveur ? Number(serveur.total) || 0 : totalAvantAcompte;
  const base = origin ?? (typeof window !== 'undefined' ? window.location?.origin || '' : '');
  const suiviUrl = `${base}/suivi?ticket=${tk.ticket_code || ''}`;

  return {
    montant,
    totalTicket,
    paye: !!tk.paye,
    suiviUrl,
    vars: {
      prenom: tk.client_prenom || '',
      nom: tk.client_nom || '',
      appareil,
      marque: tk.marque || '',
      modele: tk.modele_autre || tk.modele || '',
      code: tk.ticket_code || '',
      montant: montant.toFixed(2),
      adresse: ADRESSE_BOUTIQUE,
      horaires: HORAIRES_BOUTIQUE,
      tel_boutique: TEL_BOUTIQUE,
      lien_avis: lienAvis,
      lien_suivi: suiviUrl,
    },
  };
}

// Ordre historique des remplacements (MessageComposer)
const ORDRE_VARIABLES = [
  'prenom', 'nom', 'appareil', 'marque', 'modele', 'code', 'montant',
  'adresse', 'horaires', 'tel_boutique', 'lien_avis', 'lien_suivi',
];

/** Remplace {prenom}, {appareil}, {montant}… par les valeurs de `vars` (contexteMessage). */
export function remplirModele(message, vars = {}) {
  return ORDRE_VARIABLES.reduce(
    (s, cle) => s.replace(new RegExp(`\\{${cle}\\}`, 'g'), () => String(vars[cle] ?? '')),
    String(message ?? ''),
  );
}

// ─── Montant à 0 € : la phrase du montant est retirée, le message part quand même ──

/** Mention affichée (scan, carte « Prévenir », MessageComposer) quand la phrase du montant a été retirée. */
export const MENTION_MONTANT_RETIRE = 'Montant à 0 € : phrase du montant retirée';

// Phrase qui cite {montant} : du début de phrase (après . ! ? ou retour à la ligne) à sa ponctuation
// finale, comme la suppression du lien de suivi dans lib/sms.js ; les retours à la ligne qui
// l'encadrent sont capturés pour ne pas laisser de ligne vide quand elle occupait toute une ligne
const PHRASE_MONTANT = /(\n?)[^.!?\n]*\{montant\}[^.!?\n]*[.!?]?(\n?)/g;

/**
 * Le modèle cite {montant} alors que le montant est à 0 € (tarif oublié ou rien à payer) et que
 * le ticket n'est pas marqué payé : « Montant : 0.00 EUR » n'est pas envoyé. Payé : le montant à
 * 0 € est juste, la phrase reste.
 */
export function montantARetirer(modele, ctx) {
  return String(modele ?? '').includes('{montant}') && !(Number(ctx?.montant) > 0) && !ctx?.paye;
}

/** Le modèle sans la (les) phrase(s) qui cite(nt) {montant} ; inchangé s'il ne resterait rien. */
export function sansPhraseMontant(modele) {
  const src = String(modele ?? '');
  const t = src.replace(PHRASE_MONTANT, (_m, avant, apres) => (avant && apres ? '\n' : avant || apres))
    .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/ {2,}/g, ' ').trim();
  return t || src;
}

/**
 * Modèle rempli pour le ticket : { texte, montantRetire }. Montant à 0 € (non payé) : la phrase du
 * montant est retirée avant le remplissage et montantRetire vaut true (mention à afficher) ;
 * plus aucun blocage « renseignez le tarif ».
 */
export function remplirMessage(modele, ctx) {
  const retirer = montantARetirer(modele, ctx);
  const base = retirer ? sansPhraseMontant(modele) : String(modele ?? '');
  return { texte: remplirModele(base, ctx?.vars), montantRetire: retirer && base !== String(modele ?? '') };
}

/** Lien de suivi ajouté aux messages WhatsApp / e-mail (jamais en double). */
export function ajouterLienSuivi(message, t, suiviUrl) {
  if (!t?.ticket_code || message.includes(suiviUrl)) return message;
  return `${message}\n\n📱 Suivez votre réparation : ${suiviUrl}`;
}

/** Texte de la note « message envoyé » (POST /message-log). */
export function ligneJournal(libelle, texte) {
  const s = String(texte ?? '');
  return `[${libelle}] ${s.substring(0, 120)}${s.length > 120 ? '...' : ''}`;
}

const MODELE_PRET_DEFAUT = DEFAULT_TEMPLATES.find((tp) => tp.id === MODELE_PAR_STATUT['Réparation terminée'].id);

/** Modèle « appareil prêt » de la boutique (Config > Messages), sinon celui par défaut. */
export function modelePret(templates) {
  const liste = Array.isArray(templates) && templates.length ? templates : DEFAULT_TEMPLATES;
  const id = modelePourStatut(liste, 'Réparation terminée');
  return (id != null && liste.find((tp) => tp.id === id)) || MODELE_PRET_DEFAUT;
}

/**
 * Message « appareil prêt » du ticket : texte complet (e-mail, WhatsApp : avec le lien de
 * suivi), version SMS courte (sans lien, alphabet GSM) et nombre de SMS facturés.
 * montantRetire : le modèle cite {montant} alors que le montant est à 0 € (non payé) — la phrase
 * du montant a été retirée, le message part quand même (mention MENTION_MONTANT_RETIRE).
 */
export function messagePret(templates, t, opts) {
  const modele = modelePret(templates);
  const ctx = contexteMessage(t, opts);
  const { texte: brut, montantRetire } = remplirMessage(modele.message, ctx);
  const sms = versionCourteSms(brut);
  return {
    libelle: modele.label || 'Message',
    texte: ajouterLienSuivi(brut, t, ctx.suiviUrl),
    sms,
    segments: smsSegments(sms),
    // Objet de l'e-mail : parlant pour le client (MessageComposer garde « Klikphone SAV - KP-… »)
    sujet: `Votre ${ctx.vars.appareil} est prêt - ${t?.ticket_code || 'Klikphone'}`,
    montantRetire,
  };
}

// ─── Erreurs d'envoi ────────────────────────────────────────────────────────

/** Refus de Brevo qui se répéteront au prochain essai : le SMS est impossible pour l'instant. */
export const SMS_IMPOSSIBLE = {
  credits_epuises: 'crédits épuisés',
  cle_refusee: 'clé Brevo refusée',
  ip_non_autorisee: 'IP du serveur bloquée par Brevo',
};

/**
 * Erreur d'envoi lisible. incertain : la requête a pu aboutir (délai dépassé, coupure réseau),
 * le message est peut-être parti : on ne le renvoie pas sans vérifier.
 */
export function erreurEnvoi(err) {
  const msg = String(err?.message ?? '').trim();
  if (err?.code === 'timeout' || err?.name === 'AbortError') {
    return { incertain: true, raison: 'le serveur n’a pas répondu à temps' };
  }
  if (err?.code === 'delai_depasse') return { incertain: true, raison: 'Brevo n’a pas répondu à temps' };
  // fetch : « Failed to fetch » (Chrome), « Load failed » (Safari), « NetworkError… » (Firefox)
  if (/failed to fetch|load failed|networkerror|network request failed/i.test(msg)) {
    return { incertain: true, raison: 'serveur injoignable' };
  }
  return { incertain: false, raison: msg || 'erreur d’envoi' };
}

/** Lien WhatsApp (même normalisation que MessageComposer : 06… → 336…). */
export function lienWhatsApp(telephone, message) {
  let tel = String(telephone ?? '').replace(/[\s\-.]/g, '');
  if (tel.startsWith('0')) tel = `33${tel.substring(1)}`;
  if (!tel.startsWith('+') && !tel.startsWith('33')) tel = `33${tel}`;
  tel = tel.replace('+', '');
  return `https://wa.me/${tel}?text=${encodeURIComponent(message)}`;
}

// ─── Canal pour prévenir le client ──────────────────────────────────────────

// Forme nationale française (miroir de phone_national, backend/app/services/search.py)
function telNational(d) {
  let reste = null;
  if (d.startsWith('0033')) reste = d.slice(4);
  else if (d.startsWith('33') && (d.length === 11 || d.length === 12)) reste = d.slice(2);
  if (reste !== null) return `0${reste.replace(/^0+/, '')}`;
  if (d.length === 9 && !d.startsWith('0')) return `0${d}`;
  return d;
}

/**
 * Le numéro peut-il recevoir un SMS ? Mêmes règles que POST /api/notifications/sms :
 * portable français (06, 07, aussi +33 6… / 0033 6…) ou numéro étranger complet ; un fixe
 * français est refusé. → { portable, affichage } ou { portable: false, raison }.
 */
export function numeroSms(tel) {
  const s = String(tel ?? '').trim();
  if (!s) return { portable: false, raison: 'pas de numéro sur la fiche' };
  const d = s.replace(/\D/g, '');
  const inutilisable = { portable: false, raison: `numéro « ${s} » inutilisable pour un SMS` };
  if (!/^\+?[\d\s.\-()/]+$/.test(s) || d.length < 9 || d.length > 15) return inutilisable;
  let intl = null;
  if (s.startsWith('+')) intl = d;
  else if (d.startsWith('00')) intl = d.slice(2);
  let national;
  if (intl === null) national = telNational(d);
  else if (intl.startsWith('33') && (intl.length === 11 || intl.length === 12)) national = telNational(`0033${intl.slice(2)}`);
  else return { portable: true, affichage: `+${intl}` };
  const affichage = national.replace(/(\d{2})(?=\d)/g, '$1 ');
  if (/^0[67]\d{8}$/.test(national)) return { portable: true, affichage };
  if (/^0[1-9]\d{8}$/.test(national)) return { portable: false, raison: `le ${affichage} n’est pas un portable` };
  return inutilisable;
}

export function emailValide(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? '').trim());
}

/** Canal pour prévenir le client : 'sms' (portable), sinon 'email', sinon null. */
export function canalPrevenir(t) {
  if (numeroSms(t?.client_tel).portable) return 'sms';
  if (emailValide(t?.client_email)) return 'email';
  return null;
}

/** Pourquoi le client ne peut être prévenu ni par SMS ni par e-mail. */
export function raisonSansCanal(t) {
  if (!String(t?.client_tel ?? '').trim()) return 'ni portable ni e-mail sur la fiche';
  return `${numeroSms(t.client_tel).raison} et aucun e-mail sur la fiche`;
}

// ─── « Déjà prévenu » d'après les notes du ticket ───────────────────────────

export const CANAUX_MESSAGE = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'e-mail' };
const TYPES_MESSAGE = ['sms', 'sms_echec', 'whatsapp', 'email'];
// Sans lookbehind « (?<! » : non pris en charge par Safari / iOS avant 16.4 (erreur de syntaxe
// au chargement du module, donc plus de scan comptoir ni de messages). `\b` ignore les lettres
// accentuées : les bornes de mot sont écrites à la main.
const LETTRE = 'a-zà-ÿ';
// Le nom « prêt » (« téléphone de prêt », « votre prêt », « en prêt »…) : pas un appareil prêt
const NOM_PRET = new RegExp(`(^|[^${LETTRE}])(?:de|du|un|le|ce|votre|en|au|mon|son|notre|leur)\\s+pr[eê]ts?(?![${LETTRE}])`, 'gi');
// « est prêt », « prête », « prêts »… mais pas « prêté », « prêter »
const MOT_PRET = new RegExp(`(?:^|[^${LETTRE}])pr[eê]te?s?(?![${LETTRE}])`, 'i');
// Note d'un SMS parti par le serveur (POST /api/notifications/sms) ; sinon lien sms: (Messages)
const SMS_SERVEUR = /^✅\s*SMS envoy/;

/** Horodatage du serveur (UTC sans fuseau, comme parseUTC de lib/utils). */
export function dateServeur(d) {
  const s = String(d ?? '').trim();
  if (!s) return null;
  const date = new Date(/(?:z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** « le 16/10 à 12:30 » (heure locale du poste). */
export function formatQuand(d) {
  const date = dateServeur(d);
  if (!date) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `le ${p(date.getDate())}/${p(date.getMonth() + 1)} à ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** Message « appareil prêt » : libellé du modèle ([Appareil pret] …) d'abord, sinon texte qui dit « prêt ». */
export function estAvisPret(note, libelles = []) {
  const c = String(note?.contenu ?? '');
  if (libelles.some((l) => l && c.includes(`[${l}]`))) return true;
  return MOT_PRET.test(c.replace(NOM_PRET, '$1'));
}

function raisonEchec(contenu) {
  const ligne = String(contenu ?? '').split('\n')[0];
  const i = ligne.indexOf(' — ');
  return i >= 0 ? ligne.slice(i + 3).trim() : '';
}

/**
 * Dernier « appareil prêt » envoyé (SMS, WhatsApp, e-mail) et dernier SMS refusé s'il est
 * plus récent : { envoye: { canal, date, manuel? } | null, echec: { date, raison } | null }.
 * manuel : SMS ouvert dans l'app Messages (lien sms:), son envoi n'a pas pu être vérifié.
 */
export function dernierAvisPret(notes, libelles = [MODELE_PRET_DEFAUT.label]) {
  const liste = (Array.isArray(notes) ? notes : [])
    .filter((n) => TYPES_MESSAGE.includes(n?.type_note) && estAvisPret(n, libelles))
    .map((n) => ({ n, ts: dateServeur(n.date_creation)?.getTime() ?? 0 }))
    .sort((a, b) => b.ts - a.ts);
  const ok = liste.find((x) => x.n.type_note !== 'sms_echec');
  const ko = liste.find((x) => x.n.type_note === 'sms_echec');
  const manuel = ok?.n.type_note === 'sms' && !SMS_SERVEUR.test(String(ok.n.contenu ?? '').trim());
  return {
    envoye: ok ? { canal: ok.n.type_note, date: ok.n.date_creation, ...(manuel ? { manuel: true } : {}) } : null,
    echec: ko && (!ok || ko.ts > ok.ts) ? { date: ko.n.date_creation, raison: raisonEchec(ko.n.contenu) } : null,
  };
}

/** « Déjà prévenu : SMS le 16/10 à 12:30 » ; SMS ouvert dans Messages : envoi non vérifié. */
export function texteDejaPrevenu(envoye) {
  if (!envoye) return '';
  const quand = formatQuand(envoye.date);
  if (envoye.manuel) return `SMS préparé dans Messages${quand ? ` ${quand}` : ''} (envoi non vérifié)`;
  return `Déjà prévenu : ${CANAUX_MESSAGE[envoye.canal] || envoye.canal}${quand ? ` ${quand}` : ''}`;
}

/** « SMS non envoyé le 16/10 à 12:35 : crédits épuisés » */
export function texteEchecSms(echec) {
  if (!echec) return '';
  const quand = formatQuand(echec.date);
  return `SMS non envoyé${quand ? ` ${quand}` : ''}${echec.raison ? ` : ${echec.raison}` : ''}`;
}
