/**
 * Journal des connexions de l'équipe et pointage de présence (backend/app/api/equipe.py).
 *
 * Tout l'affichage est réservé à la page admin « Activité de l'équipe » : côté salarié, rien n'est
 * montré dans l'application. L'information préalable passe par la note écrite remise par le gérant
 * (L1222-4 du Code du travail), imprimée depuis les réglages de cette page.
 *
 * Ce module fournit :
 *  - la détection de l'appareil envoyée au login / changement d'utilisateur (le serveur la
 *    recoupe avec le User-Agent et ne garde que des valeurs connues) ;
 *  - la lecture UNIQUE de position après une connexion, si le pointage est activé (jamais de
 *    watchPosition, jamais hors des heures d'ouverture, refus sans conséquence).
 * Les libellés, heures et durées de la page admin et la note d'information sont dans
 * lib/activiteEquipe.js (hors du paquet initial).
 */

// Durées de conservation (miroir de la tâche quotidienne du serveur)
export const CONSERVATION_POSITION_JOURS = 60;
export const CONSERVATION_JOURNAL_JOURS = 183;

// Heures d'ouverture pendant lesquelles une position peut être lue (heure de Paris)
export const HORAIRES = { debut: 10, fin: 19, jours: 'du lundi au samedi' };

// Options de la seule lecture de position faite par session
export const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 };

// ─── Nom du poste (« Comptoir », « Atelier ») : propre à ce navigateur ─────
export const POSTE_KEY = 'kp_poste';
export const POSTE_MAX = 60;

export function lirePoste() {
  try {
    const v = (localStorage.getItem(POSTE_KEY) || '').trim();
    return v ? v.slice(0, POSTE_MAX) : '';
  } catch {
    return '';
  }
}

export function ecrirePoste(nom) {
  const v = String(nom || '').trim().slice(0, POSTE_MAX);
  try {
    if (v) localStorage.setItem(POSTE_KEY, v);
    else localStorage.removeItem(POSTE_KEY);
  } catch { /* stockage indisponible */ }
  return v;
}

// ─── Détection de l'appareil ─────────────────────────────────────────────
export const TYPES_APPAREIL = ['ordinateur', 'iphone', 'ipad', 'smartphone', 'tablette', 'inconnu'];

// Marque déduite du code modèle Android : prudemment, null en cas de doute
const PREFIXES_MARQUE = [
  [/^(SM-|GT-|SC-|SCG|SAMSUNG|Galaxy)/i, 'Samsung'],
  [/^Pixel/i, 'Google'],
  [/^(Redmi|POCO|Mi |Mi$|MI |Xiaomi|M2\d{3}|2[0-4]\d{5}[A-Z]{1,3}\b|2[0-4]\d{3}[A-Z0-9]{4,})/i, 'Xiaomi'],
  [/^(RMX)/i, 'Realme'],
  [/^(CPH|OPPO|PG[A-Z]M)/i, 'Oppo'],
  [/^(ONEPLUS|IN20|KB20|LE21|NE22|PHB110)/i, 'OnePlus'],
  [/^(moto|motorola|XT\d{4})/i, 'Motorola'],
  [/^(Nokia|TA-\d{4})/i, 'Nokia'],
  [/^(vivo|V2\d{3})/i, 'Vivo'],
  [/^(HONOR|HNR)/i, 'Honor'],
  [/^(HUAWEI|[A-Z]{3}-(L|LX|AL|TL|NX)\d)/i, 'Huawei'],
  [/^(XQ-|SO-\d|Xperia)/i, 'Sony'],
  [/^(Lenovo|TB-[A-Z0-9])/i, 'Lenovo'],
  [/^(ASUS|ASUS_)/i, 'Asus'],
];

export function marqueDepuisModele(modele) {
  const m = String(modele || '').trim();
  if (!m) return null;
  for (const [re, marque] of PREFIXES_MARQUE) if (re.test(m)) return marque;
  return null;
}

// Même règle que le serveur : [A-Za-z0-9 ._+-], 40 caractères
export function nettoyerModele(v) {
  const s = String(v || '').replace(/[^A-Za-z0-9 ._+-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  // User-Agent réduit de Chrome (« Android 10; K ») : aucun modèle réel
  if (!s || s.length < 2 || /^(K|Mobile|wv|Linux|U)$/i.test(s)) return null;
  return s;
}

function majeure(version) {
  const n = String(version || '').match(/^(\d+)/);
  return n ? n[1] : '';
}

/**
 * Analyse synchrone : User-Agent + indices client (navigator.userAgentData.getHighEntropyValues).
 * → { type, marque, modele, systeme, navigateur } (valeurs null quand non détectables).
 */
export function analyserAppareil(userAgent = '', indices = null, { maxTouchPoints = 0 } = {}) {
  const ua = String(userAgent || '');
  const h = indices && typeof indices === 'object' ? indices : {};
  const plateforme = String(h.platform || '');

  let type = 'inconnu';
  let marque = null;
  let modele = null;
  let systeme = null;

  const estIPhone = /iPhone|iPod/.test(ua);
  const estIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && Number(maxTouchPoints) > 1);
  const estAndroid = /Android/i.test(ua) || /^Android$/i.test(plateforme);

  if (estIPhone || estIPad) {
    type = estIPhone ? 'iphone' : 'ipad';
    marque = 'Apple';
    const v = ua.match(/OS (\d+)[._]\d/) || ua.match(/Version\/(\d+)/);
    systeme = v ? `iOS ${v[1]}` : 'iOS';
  } else if (estAndroid) {
    const mobile = typeof h.mobile === 'boolean' ? h.mobile : /Mobile/.test(ua);
    type = mobile ? 'smartphone' : 'tablette';
    const vh = majeure(h.platformVersion);
    const vu = ua.match(/Android (\d+)/i);
    // User-Agent réduit : « Android 10 » figé, l'indice client fait foi
    systeme = vh ? `Android ${vh}` : (vu ? `Android ${vu[1]}` : 'Android');
    const brut = h.model || (ua.match(/Android [^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?\)/i) || [])[1];
    modele = nettoyerModele(brut);
    marque = marqueDepuisModele(modele);
    if (!marque && /SamsungBrowser/.test(ua)) marque = 'Samsung';
  } else if (/Windows NT|^Windows$/i.test(ua) || /^Windows$/i.test(plateforme)) {
    type = 'ordinateur';
    systeme = 'Windows';
  } else if (/Macintosh|Mac OS X/.test(ua) || /^macOS$/i.test(plateforme)) {
    type = 'ordinateur';
    marque = 'Apple';
    systeme = 'macOS';
  } else if (/CrOS/.test(ua) || /^Chrome OS$/i.test(plateforme)) {
    type = 'ordinateur';
    systeme = 'ChromeOS';
  } else if (/Linux|X11/.test(ua) || /^Linux$/i.test(plateforme)) {
    type = 'ordinateur';
    systeme = 'Linux';
  }

  let navigateur = null;
  if (/SamsungBrowser\//.test(ua)) navigateur = 'Samsung Internet';
  else if (/Edg(A|iOS)?\//.test(ua)) navigateur = 'Edge';
  else if (/(Firefox|FxiOS)\//.test(ua)) navigateur = 'Firefox';
  else if (/(Chrome|CriOS|Chromium)\//.test(ua) && !/OPR\//.test(ua)) navigateur = 'Chrome';
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) navigateur = 'Safari';
  else if ((estIPhone || estIPad) && /AppleWebKit/.test(ua)) navigateur = 'Safari';

  return { type, marque, modele, systeme, navigateur };
}

/** Détection complète (asynchrone : indices à haute entropie de Chromium quand disponibles). */
export async function detecterAppareil(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  let indices = null;
  try {
    const uad = nav?.userAgentData;
    if (uad && typeof uad.getHighEntropyValues === 'function') {
      indices = await uad.getHighEntropyValues(['model', 'platform', 'platformVersion', 'mobile']);
    }
  } catch {
    indices = null;
  }
  return analyserAppareil(nav?.userAgent || '', indices, { maxTouchPoints: nav?.maxTouchPoints || 0 });
}

// Détection lancée une fois ; la connexion ne l'attend jamais plus de `delaiMs`
let appareilEnCours = null;
export function appareilClient({ delaiMs = 400, nav } = {}) {
  const n = nav || (typeof navigator !== 'undefined' ? navigator : {});
  const repli = () => analyserAppareil(n?.userAgent || '', null, { maxTouchPoints: n?.maxTouchPoints || 0 });
  if (!appareilEnCours || nav) appareilEnCours = detecterAppareil(n).catch(repli);
  return Promise.race([
    appareilEnCours,
    new Promise((resolve) => { setTimeout(() => resolve(repli()), delaiMs); }),
  ]);
}

// ─── Lecture unique de position après une connexion ─────────────────────
const TZ = 'Europe/Paris';

export function dansHorairesParis(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, weekday: 'short', hour: '2-digit', hour12: false,
    }).formatToParts(date);
    const jour = parts.find((p) => p.type === 'weekday')?.value;
    const heure = Number(parts.find((p) => p.type === 'hour')?.value);
    if (jour === 'Sun' || !Number.isFinite(heure)) return false;
    return heure >= HORAIRES.debut && heure < HORAIRES.fin;
  } catch {
    return false;
  }
}

// Session = ligne du journal (cx, nouvelle à chaque connexion et changement d'utilisateur), à défaut
// lignée (sid) + membre du jeton : marqueur sessionStorage pour ne jamais redemander
function revendications(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const octets = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(octets));
  } catch {
    return null;
  }
}

export function clePointage(token) {
  const c = revendications(token);
  if (Number.isInteger(c?.cx)) return `kp_pointage:cx:${c.cx}`;
  if (c?.sid) return `kp_pointage:${c.sid}:${c.sub || ''}`;
  const t = String(token || '');
  return t ? `kp_pointage:${t.slice(-24)}` : '';
}

function marque(cle) {
  try { return sessionStorage.getItem(cle) === '1'; } catch { return false; }
}

function marquer(cle) {
  try { sessionStorage.setItem(cle, '1'); } catch { /* stockage indisponible */ }
}

const enVol = new Set();

function lirePosition(geo) {
  return new Promise((resolve) => {
    let fini = false;
    const finir = (v) => { if (!fini) { fini = true; resolve(v); } };
    // Filet si le navigateur ne rappelle jamais (demande d'autorisation laissée ouverte)
    const filet = setTimeout(() => finir({ indisponible: true }), GEO_OPTIONS.timeout + 5_000);
    try {
      geo.getCurrentPosition(
        (p) => {
          clearTimeout(filet);
          const c = p?.coords || {};
          if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return finir({ indisponible: true });
          finir({ lat: c.latitude, lng: c.longitude, precision_m: Math.max(0, Math.round(Number(c.accuracy) || 0)) });
        },
        (err) => {
          clearTimeout(filet);
          finir(err?.code === 1 ? { refus: true } : { indisponible: true });
        },
        GEO_OPTIONS,
      );
    } catch {
      clearTimeout(filet);
      finir({ indisponible: true });
    }
  });
}

// Jeton exposé par le client (ApiClient : chaîne, ou null après déconnexion) ; undefined s'il n'en
// expose pas
function jetonDuClient(client) {
  const t = client?.token;
  return typeof t === 'string' || t === null ? t : undefined;
}

/**
 * Après une connexion réussie (login ou changement d'utilisateur), en arrière-plan :
 * si le pointage est actif, UNE lecture de position pour cette session, puis envoi au serveur
 * qui n'en garde que le statut. Inactif : aucun appel à l'API de géolocalisation.
 * Les deux appels portent le jeton de CETTE session ; si un autre salarié a pris le poste (ou si
 * la session a été fermée) pendant la lecture, rien n'est envoyé : la lecture est oubliée.
 * Renvoie le résultat ('inactif' | 'deja' | 'envoye' | 'change' | 'erreur'),
 * jamais d'exception.
 */
export async function lancerPointage(client, token, { geolocation } = {}) {
  const cle = clePointage(token);
  if (!cle || !client || marque(cle) || enVol.has(cle)) return 'deja';
  const courante = () => {
    const t = jetonDuClient(client);
    return t === undefined || t === token;
  };
  enVol.add(cle);
  try {
    let cfg;
    try {
      cfg = await client.getPositionConfig(token);
    } catch {
      return 'erreur';
    }
    if (!cfg || cfg.actif !== true) return 'inactif';
    if (!courante()) return 'change';
    marquer(cle);
    // À chaque connexion, quelle que soit l'heure (le serveur décide via cfg.actif)
    const geo = geolocation !== undefined
      ? geolocation
      : (typeof navigator !== 'undefined' ? navigator.geolocation : null);
    const payload = geo && typeof geo.getCurrentPosition === 'function'
      ? await lirePosition(geo)
      : { indisponible: true };
    // Changement d'utilisateur ou déconnexion pendant la lecture (demande d'autorisation restée
    // ouverte) : la session qui l'a demandée est close, la lecture n'est envoyée à personne
    if (!courante()) return 'change';
    await client.envoyerPosition(payload, token).catch(() => null);
    return 'envoye';
  } finally {
    enVol.delete(cle);
  }
}
