/**
 * Page admin « Activité de l'équipe » : libellés d'appareil et de présence, heures et durées
 * (heure de Paris), note d'information aux salariés et son impression.
 * Séparé de lib/pointage.js (chargé à la connexion) pour rester hors du paquet initial.
 */
import { CONSERVATION_JOURNAL_JOURS, CONSERVATION_POSITION_JOURS, HORAIRES, TYPES_APPAREIL } from './pointage';

export const BOUTIQUE_IDENTITE = 'Klikphone, 79 Place Saint-Léger, 73000 Chambéry';

// Quelques noms commerciaux sûrs (préfixe du code → nom) ; sinon le code reste affiché seul
const NOMS_COMMERCIAUX = [
  [/^SM-S928/i, 'Galaxy S24 Ultra'], [/^SM-S926/i, 'Galaxy S24+'], [/^SM-S921/i, 'Galaxy S24'],
  [/^SM-S918/i, 'Galaxy S23 Ultra'], [/^SM-S916/i, 'Galaxy S23+'], [/^SM-S911/i, 'Galaxy S23'],
  [/^SM-S908/i, 'Galaxy S22 Ultra'], [/^SM-S906/i, 'Galaxy S22+'], [/^SM-S901/i, 'Galaxy S22'],
  [/^SM-A556/i, 'Galaxy A55'], [/^SM-A546/i, 'Galaxy A54'], [/^SM-A536/i, 'Galaxy A53'],
  [/^SM-A356/i, 'Galaxy A35'], [/^SM-A346/i, 'Galaxy A34'], [/^SM-A256/i, 'Galaxy A25'],
  [/^SM-A156/i, 'Galaxy A15 5G'], [/^SM-A155/i, 'Galaxy A15'],
];

export function nomCommercial(modele) {
  const m = String(modele || '').trim();
  if (!m) return null;
  for (const [re, nom] of NOMS_COMMERCIAUX) if (re.test(m)) return nom;
  return null;
}

// ─── Libellés d'appareil ────────────────────────────────────────────────
const LIBELLES_TYPE = {
  ordinateur: 'Ordinateur', iphone: 'iPhone', ipad: 'iPad',
  smartphone: 'Smartphone', tablette: 'Tablette', inconnu: 'Appareil inconnu',
};

export function libelleType(type) {
  return LIBELLES_TYPE[type] || LIBELLES_TYPE.inconnu;
}

// Famille d'icône : 'ordinateur' | 'mobile' | 'tablette' | 'inconnu'
export function familleAppareil(type) {
  if (type === 'ordinateur') return 'ordinateur';
  if (type === 'iphone' || type === 'smartphone') return 'mobile';
  if (type === 'ipad' || type === 'tablette') return 'tablette';
  return 'inconnu';
}

/**
 * « iPhone · Apple · iOS 18 », « Smartphone · Samsung SM-S918B (Galaxy S23 Ultra) · Android 14 »,
 * « Ordinateur · PC Windows · Chrome », « Ordinateur · Apple Mac · Safari ».
 */
export function libelleAppareil(a) {
  const app = a && typeof a === 'object' ? a : {};
  const type = TYPES_APPAREIL.includes(app.type) ? app.type : 'inconnu';
  const parts = [libelleType(type)];
  const nom = nomCommercial(app.modele);
  const modele = app.modele ? `${app.modele}${nom ? ` (${nom})` : ''}` : '';
  if (type === 'ordinateur') {
    let qui;
    if (app.marque === 'Apple') qui = 'Apple Mac';
    else if (app.marque) qui = [app.marque, modele].filter(Boolean).join(' ');
    // « Windows », « Windows 11 »… (même règle que presence.libelle_appareil côté serveur)
    else if (String(app.systeme || '').startsWith('Windows')) qui = 'PC Windows';
    else if (String(app.systeme || '').startsWith('ChromeOS')) qui = 'Chromebook';
    else if (String(app.systeme || '').startsWith('Linux')) qui = 'PC Linux';
    if (qui) parts.push(qui);
    if (app.navigateur) parts.push(app.navigateur);
    else if (app.systeme && !qui) parts.push(app.systeme);
  } else {
    const qui = [app.marque, modele].filter(Boolean).join(' ');
    if (qui) parts.push(qui);
    if (app.systeme) parts.push(app.systeme);
    else if (app.navigateur) parts.push(app.navigateur);
  }
  return parts.join(' · ');
}

// ─── Présence ───────────────────────────────────────────────────────────
// `point` : pastille colorée (contraste ≥ 3:1 sur blanc pour les statuts parlants)
export const STATUTS_PRESENCE = {
  en_boutique: { label: 'En boutique', point: 'bg-emerald-600' },
  hors_boutique: { label: 'Hors boutique', point: 'bg-orange-600' },
  imprecise: { label: 'Position imprécise', point: 'bg-blue-600' },
  refusee: { label: 'Position refusée', point: 'bg-white ring-2 ring-inset ring-slate-500' },
  indisponible: { label: 'Position indisponible', point: 'bg-white ring-2 ring-inset ring-slate-400' },
  hors_horaires: { label: 'Hors horaires d’ouverture', point: 'bg-white ring-2 ring-inset ring-slate-400' },
};

export function statutPresence(code) {
  return STATUTS_PRESENCE[code] || null;
}

// Distance (déjà arrondie à 50 m côté serveur) : « 350 m », « 2,3 km »
export function formatDistance(m) {
  if (m === null || m === undefined || m === '') return '';
  const n = Number(m);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1000) return `${Math.round(n)} m`;
  const km = n / 1000;
  return `${km.toLocaleString('fr-FR', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

// « En boutique », « Hors boutique, à 2,3 km », « Pointage non fait »
export function libellePresence(code, distanceM) {
  const s = statutPresence(code);
  if (!s) return 'Pointage non fait';
  if (code === 'hors_boutique') {
    const d = formatDistance(distanceM);
    return d ? `${s.label}, à ${d}` : s.label;
  }
  return s.label;
}

export const MOTIFS_FIN = {
  deconnexion: 'Déconnexion',
  changement: 'Changement d’utilisateur',
  expiree: 'Expirée (inactivité)',
};

// ─── Heures, jours, durées (heure de Paris) ─────────────────────────────
const TZ = 'Europe/Paris';

// Horodatage du serveur sans fuseau = UTC (même convention que lib/utils.parseUTC)
export function parseDateServeur(d) {
  if (!d) return null;
  const s = String(d).trim();
  if (!s) return null;
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const avecFuseau = /(Z|[+-]\d{2}:?\d{2})$/.test(iso);
  const date = new Date(avecFuseau ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// « 10:02 » : une heure déjà au format HH:MM est gardée telle quelle
export function heureParis(d) {
  if (!d) return '';
  if (/^\d{1,2}:\d{2}$/.test(String(d).trim())) return String(d).trim().padStart(5, '0');
  const date = d instanceof Date ? d : parseDateServeur(d);
  if (!date) return '';
  return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

// Date du jour à Paris : « AAAA-MM-JJ »
export function jourParis(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date);
  const v = (t) => p.find((x) => x.type === t)?.value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

// Jours calendaires purs (« AAAA-MM-JJ ») : calculs en UTC pour échapper aux changements d'heure
export function dateIso(jour) {
  const [y, m, j] = String(jour || '').split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, j || 1));
}

export function isoDepuisDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export function ajouterJours(jour, n) {
  const d = dateIso(jour);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDepuisDate(d);
}

export function lundiDe(jour) {
  const d = dateIso(jour);
  const decal = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - decal);
  return isoDepuisDate(d);
}

const fmt = (opts) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...opts });

// En-tête de colonne : { court: 'lun.', num: '19' }
export function enteteJour(jour) {
  const d = dateIso(jour);
  return {
    court: fmt({ weekday: 'short' }).format(d),
    long: fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(d),
    num: String(d.getUTCDate()),
  };
}

// « Semaine du 19 au 25 oct. », « Semaine du 27 oct. au 2 nov. », « … au 3 janv. 2027 »
export function libelleSemaine(debut, fin) {
  const a = dateIso(debut);
  const b = dateIso(fin || ajouterJours(debut, 6));
  const memeMois = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  const anneeCourante = new Date().getFullYear();
  const finTxt = fmt({ day: 'numeric', month: 'short', ...(b.getUTCFullYear() !== anneeCourante ? { year: 'numeric' } : {}) }).format(b);
  const debutTxt = memeMois ? String(a.getUTCDate()) : fmt({ day: 'numeric', month: 'short' }).format(a);
  return `Semaine du ${debutTxt} au ${finTxt}`;
}

// 525 → « 8 h 45 », 45 → « 45 min », 0 → « 0 min »
export function formatMinutes(min) {
  const n = Math.max(0, Math.round(Number(min) || 0));
  if (n < 60) return `${n} min`;
  return `${Math.floor(n / 60)} h ${String(n % 60).padStart(2, '0')}`;
}

// ─── Note d'information (art. 13 RGPD, L1222-4 du Code du travail) ─────
export const NOTE_INFORMATION = {
  titre: 'Note d’information aux salariés — Journal des connexions et pointage de présence',
  sections: [
    {
      titre: 'Responsable du traitement',
      texte: `${BOUTIQUE_IDENTITE}, représentée par son gérant.`,
    },
    {
      titre: 'Finalités',
      texte: 'Sécurité des accès à l’application de gestion du SAV et vérification de la présence en boutique au moment de la connexion. Ces données ne servent à aucune autre fin et ne déclenchent aucune sanction automatique.',
    },
    {
      titre: 'Données enregistrées',
      liste: [
        'Votre nom, l’espace utilisé (accueil ou atelier) et le nom du poste.',
        'Le type d’appareil (ordinateur, iPhone, smartphone, tablette…), sa marque et son modèle quand le navigateur les indique, le système et le navigateur.',
        'Une empreinte non réversible de l’adresse réseau (jamais l’adresse elle-même).',
        'Les heures de connexion, de dernière activité et de déconnexion, et le nombre d’enregistrements effectués.',
        'Si le pointage de présence est activé : uniquement un statut (« en boutique », « hors boutique », « position imprécise », « refusée », « indisponible ») et la distance à la boutique arrondie à 50 m. Votre position exacte n’est jamais enregistrée.',
      ],
    },
    {
      titre: 'Fonctionnement du pointage',
      liste: [
        'Une seule vérification, au moment de la connexion : aucun suivi en continu, rien en dehors de l’application.',
        `Uniquement pendant les heures d’ouverture (${HORAIRES.debut} h – ${HORAIRES.fin} h, ${HORAIRES.jours}).`,
        'Vous pouvez refuser la demande de position dans votre navigateur : l’application fonctionne normalement, seul le refus est noté, sans aucune conséquence.',
      ],
    },
    {
      titre: 'Base légale',
      texte: 'Intérêt légitime de l’employeur à sécuriser l’accès aux données des clients et à organiser la présence en boutique (article 6.1.f du RGPD), dans le respect de l’article L1121-1 du Code du travail (mesure justifiée et proportionnée au but recherché).',
    },
    {
      titre: 'Destinataire',
      texte: 'Le gérant uniquement (accès protégé par un code administrateur ; chaque consultation est tracée). Aucune donnée n’est transmise à un tiers.',
    },
    {
      titre: 'Durées de conservation',
      liste: [
        `Statut de présence et distance : ${CONSERVATION_POSITION_JOURS} jours (2 mois), puis effacés.`,
        `Journal des connexions : ${CONSERVATION_JOURNAL_JOURS} jours (6 mois), puis supprimé.`,
      ],
    },
    {
      titre: 'Vos droits',
      texte: 'Vous disposez des droits d’accès, de rectification, d’effacement, d’opposition et de limitation sur ces données. Il suffit d’en faire la demande au gérant, qui vous remet l’extrait de vos enregistrements. Vous pouvez aussi adresser une réclamation à la CNIL (www.cnil.fr).',
    },
    {
      titre: 'Représentants du personnel',
      texte: 'Si l’entreprise atteint 11 salariés, le comité social et économique (CSE) sera informé et consulté avant toute mise en œuvre ou modification de ce dispositif (article L2312-38 du Code du travail).',
    },
  ],
};

// Version texte (paragraphes séparés par une ligne vide)
export function noteInformationTexte(note = NOTE_INFORMATION) {
  const lignes = [note.titre, ''];
  for (const s of note.sections) {
    lignes.push(s.titre);
    if (s.texte) lignes.push(s.texte);
    for (const l of s.liste || []) lignes.push(`- ${l}`);
    lignes.push('');
  }
  return lignes.join('\n').trim();
}

const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// Note structurée valide ({ titre, sections:[{titre, texte?, liste?}], remise? }), sinon null
export function noteStructuree(note) {
  if (!note || typeof note !== 'object' || !Array.isArray(note.sections) || !note.sections.length) return null;
  return note;
}

// Page d'impression autonome. `source` : note structurée du serveur (identité de la boutique à jour),
// texte brut, ou rien (note par défaut).
export function noteInformationHtml(source) {
  let corps;
  let remise = null;
  const n = noteStructuree(source) || (typeof source === 'string' && source.trim() ? null : NOTE_INFORMATION);
  if (n) {
    corps = `<h1>${echapper(n.titre)}</h1>\n${n.sections.map((s) => `<h2>${echapper(s.titre)}</h2>${
      s.texte ? `<p>${echapper(s.texte)}</p>` : ''}${
      Array.isArray(s.liste) && s.liste.length ? `<ul>${s.liste.map((l) => `<li>${echapper(l)}</li>`).join('')}</ul>` : ''}`).join('\n')}`;
    if (typeof n.remise === 'string' && n.remise.trim()) remise = n.remise.trim();
  } else {
    corps = source.trim().split(/\n{2,}/).map((bloc) => {
      const l = bloc.split('\n');
      const puces = l.filter((x) => /^\s*[-•]\s+/.test(x));
      if (puces.length === l.length) return `<ul>${l.map((x) => `<li>${echapper(x.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
      return `<p>${l.map(echapper).join('<br>')}</p>`;
    }).join('\n');
    remise = '';
  }
  const blocRemise = remise === ''
    ? ''
    : remise
      ? `<section class="remise">${remise.split('\n').map((l) => `<p>${echapper(l)}</p>`).join('')}</section>`
      : `<section class="remise"><strong>Remise de la note</strong> — Je reconnais avoir reçu cette note d’information.
<div><span>Nom du salarié :</span><span>Date et signature :</span></div></section>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Note d’information — Klikphone</title>
<style>
  @page { margin: 18mm; }
  body { font: 11pt/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; max-width: 170mm; margin: 0 auto; }
  h1 { font-size: 15pt; margin: 0 0 10pt; }
  h2 { font-size: 11.5pt; margin: 12pt 0 3pt; }
  p, ul { margin: 0 0 6pt; } ul { padding-left: 16pt; }
  .remise { margin-top: 22pt; border-top: 1px solid #cbd5e1; padding-top: 10pt; font-size: 10pt; }
  .remise p { margin: 0 0 14pt; }
  .remise div { display: flex; gap: 24pt; margin-top: 18pt; } .remise span { flex: 1; border-bottom: 1px solid #94a3b8; padding-bottom: 18pt; }
</style></head><body>
${corps}
${blocRemise}
</body></html>`;
}

/** Imprime la note dans un cadre caché (pas de fenêtre surgissante bloquée). */
export function imprimerNote(source) {
  if (typeof document === 'undefined') return null;
  const cadre = document.createElement('iframe');
  cadre.setAttribute('title', 'Impression de la note d’information');
  cadre.setAttribute('aria-hidden', 'true');
  cadre.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  cadre.setAttribute('data-note-impression', '');
  document.body.appendChild(cadre);
  const doc = cadre.contentDocument || cadre.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(noteInformationHtml(source));
    doc.close();
  }
  const retirer = () => setTimeout(() => cadre.remove(), 1000);
  try {
    cadre.contentWindow?.addEventListener?.('afterprint', retirer);
    cadre.contentWindow?.focus?.();
    cadre.contentWindow?.print?.();
  } catch { /* impression indisponible (aperçu, test) */ }
  setTimeout(() => cadre.isConnected && cadre.remove(), 60_000);
  return cadre;
}
