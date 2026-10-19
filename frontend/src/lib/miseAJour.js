/**
 * Mise à jour automatique de l'application (bornes de dépôt et écrans du personnel).
 *
 * Après un déploiement, le serveur sert un nouvel index.html qui pointe vers un nouveau bundle
 * principal (/assets/index-XXXX.js : le nom change à chaque build). Une page restée ouverte garde
 * l'ancien code en mémoire : la borne en mode kiosque ne recharge jamais (après un dépôt elle se
 * remet à zéro sans rechargement, en boucle), l'onglet du comptoir reste ouvert des jours. On compare
 * donc le bundle chargé par la page avec celui qu'annonce le serveur.
 *
 * API
 * - extraireBundle(texte)            → '/assets/index-XXXX.js' trouvé dans un HTML ou une URL, sinon null
 * - versionActuelle()                → bundle principal chargé par cette page (null en dev : /src/main.jsx)
 * - nouvelleVersionDisponible()      → Promise<boolean> ; false en dev, en cas d'erreur réseau ou si un
 *                                      des deux bundles est introuvable ; ne lève jamais d'exception
 * - rechargerSiNouvelleVersion()     → Promise<boolean> ; recharge la page et renvoie true s'il y a une
 *                                      nouvelle version, sinon false (la page continue normalement)
 * - useVerificationVersion({...})    → écrans du personnel : vérifie au montage, à intervalle et au retour
 *                                      sur l'onglet, appelle onNouvelle() une seule fois (aucun rechargement)
 * - useRechargementAuRepos({...})    → bornes : recharge d'elle-même quand personne ne s'en sert
 * - formulaireIntact(form, initial)  → true si le formulaire est encore à ses valeurs de départ
 * - oublierTentativeReussie()        → lancée au chargement : efface la trace d'un rechargement réussi
 */
import { useEffect, useRef } from 'react';

/** Écrans du personnel : une vérification toutes les 15 min (plus le montage et le retour sur l'onglet). */
export const INTERVALLE_PERSONNEL_MS = 15 * 60 * 1000;
/** Borne au repos : une vérification toutes les 10 min au plus. */
export const INTERVALLE_BORNE_MS = 10 * 60 * 1000;
/** Borne au repos : aucun toucher / aucune frappe depuis 2 min. */
export const CALME_BORNE_MS = 2 * 60 * 1000;
/** Retour sur l'onglet : pas plus d'une vérification toutes les 30 s (bascules d'onglets répétées). */
export const ECART_MIN_VISIBILITE_MS = 30 * 1000;
/** Réseau lent : au-delà de 5 s on abandonne (la borne ne reste pas bloquée sur l'écran de fin). */
export const DELAI_RESEAU_MS = 5 * 1000;
/** Pas de la surveillance du repos (sans réseau : simple lecture d'horloge). */
const PAS_REPOS_MS = 30 * 1000;

// Anti-boucle : si un rechargement vers la version X nous laisse sur l'ancienne (cache intermédiaire
// périmé), on ne retente pas vers X avant une heure. Trace effacée au chargement suivant dès que la
// page tourne sur une autre version (rechargement réussi : voir oublierTentativeReussie).
const CLE_RECHARGE = 'kp_maj_recharge';
const PAUSE_APRES_ECHEC_MS = 60 * 60 * 1000;

// Le nom de bundle de Vite/Rollup : lettres, chiffres, « _ » et « - ».
const RE_BUNDLE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;
const RE_SCRIPT_MODULE = /<script\b[^>]*\bsrc=["']([^"']*\/assets\/index-[A-Za-z0-9_-]+\.js)[^"']*["'][^>]*>/i;

const AUCUNE = Object.freeze({ nouvelle: false, cible: null });

/** Chemin du bundle principal dans un HTML (balise <script src> en priorité) ou dans une URL. */
export function extraireBundle(texte) {
  if (typeof texte !== 'string' || !texte) return null;
  const balise = texte.match(RE_SCRIPT_MODULE);
  const m = (balise ? balise[1] : texte).match(RE_BUNDLE);
  return m ? m[0] : null;
}

/** Bundle principal chargé par cette page (« /assets/index-XXXX.js »), null en dev ou hors navigateur. */
export function versionActuelle() {
  try {
    if (typeof document === 'undefined') return null;
    const script = document.querySelector('script[type="module"][src*="/assets/index-"]');
    return extraireBundle(script?.getAttribute('src') || '');
  } catch {
    return null;
  }
}

/** Interroge le serveur : { nouvelle, cible } (cible = bundle annoncé par le serveur). Jamais d'exception. */
export async function verifierVersion({ timeoutMs = DELAI_RESEAU_MS } = {}) {
  const actuelle = versionActuelle();
  if (!actuelle || typeof fetch !== 'function') return AUCUNE;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const minuteur = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const rep = await fetch('/', { cache: 'no-store', ...(ctrl ? { signal: ctrl.signal } : {}) });
    if (!rep || !rep.ok) return AUCUNE;
    const cible = extraireBundle(await rep.text());
    if (!cible) return AUCUNE;
    return { nouvelle: cible !== actuelle, cible };
  } catch {
    return AUCUNE;
  } finally {
    if (minuteur) clearTimeout(minuteur);
  }
}

/** true si le serveur annonce un autre bundle que celui chargé ; false en dev / hors ligne / doute. */
export async function nouvelleVersionDisponible(options) {
  const { nouvelle } = await verifierVersion(options);
  return nouvelle;
}

function lireTentative() {
  try {
    return JSON.parse(window.sessionStorage.getItem(CLE_RECHARGE) || 'null');
  } catch {
    return null;
  }
}

function dejaTente(cible, actuelle) {
  const t = lireTentative();
  return Boolean(t && t.cible === cible && t.depuis === actuelle && Date.now() - Number(t.at || 0) < PAUSE_APRES_ECHEC_MS);
}

/**
 * Appelée au chargement du module (chaque chargement de page : le module est dans le bundle principal
 * via App.jsx). La tentative enregistrée ne sert qu'à repérer un ÉCHEC : la page rechargée est restée
 * sur la version d'où elle partait (`depuis`). Si elle tourne sur une autre version (la cible : le
 * rechargement a réussi), on l'oublie ; sinon un retour sur l'ancienne version puis un redéploiement
 * de la même cible dans l'heure seraient bloqués à tort. Renvoie true si l'enregistrement a été effacé.
 */
export function oublierTentativeReussie() {
  try {
    const t = lireTentative();
    const actuelle = versionActuelle();
    if (!t || !actuelle || actuelle === t.depuis) return false;
    window.sessionStorage.removeItem(CLE_RECHARGE);
    return true;
  } catch {
    return false;
  }
}
oublierTentativeReussie();

/** Recharge vers `cible` (sauf tentative identique récente restée sans effet). true si le rechargement part. */
function recharger(cible) {
  const actuelle = versionActuelle();
  if (typeof window === 'undefined' || typeof window.location?.reload !== 'function') return false;
  if (dejaTente(cible, actuelle)) return false;
  try {
    window.sessionStorage.setItem(CLE_RECHARGE, JSON.stringify({ cible, depuis: actuelle, at: Date.now() }));
  } catch { /* stockage indisponible (navigation privée) : on recharge quand même */ }
  try {
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

/**
 * S'il y a une nouvelle version : recharge la page et renvoie true (ne rien remettre à zéro, la page
 * repart avec le nouveau code). Sinon renvoie false et la page continue. Ne lève jamais d'exception.
 */
export async function rechargerSiNouvelleVersion(options) {
  const { nouvelle, cible } = await verifierVersion(options);
  if (!nouvelle) return false;
  return recharger(cible);
}

/** true si chaque champ de `form` vaut encore sa valeur de départ (`initial`). */
export function formulaireIntact(form, initial) {
  if (!form || !initial) return false;
  return Object.keys(initial).every((k) => form[k] === initial[k])
    && Object.keys(form).every((k) => k in initial || form[k] === '' || form[k] == null || form[k] === false);
}

/**
 * Écrans du personnel : vérifie au montage, puis toutes les `intervalleMs`, et au retour sur l'onglet
 * (visibilitychange, 30 s mini entre deux). Appelle `onNouvelle()` une seule fois, puis s'arrête.
 * Ne recharge jamais : c'est l'écran qui propose (aucune saisie perdue).
 */
export function useVerificationVersion({ intervalleMs = INTERVALLE_PERSONNEL_MS, actif = true, onNouvelle } = {}) {
  const rappel = useRef(onNouvelle);
  rappel.current = onNouvelle;
  const signale = useRef(false);

  useEffect(() => {
    if (!actif || signale.current) return undefined;
    let annule = false;
    let enCours = false;
    let derniere = 0;
    let minuteur = null;

    const verifier = async () => {
      if (annule || enCours || signale.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      enCours = true;
      derniere = Date.now();
      try {
        const nouvelle = await nouvelleVersionDisponible();
        if (nouvelle && !annule && !signale.current) {
          signale.current = true;
          if (minuteur) clearInterval(minuteur);
          try { rappel.current?.(); } catch { /* le bandeau ne doit pas casser la page */ }
        }
      } finally {
        enCours = false;
      }
    };
    const auRetour = () => {
      if (document.visibilityState === 'visible' && Date.now() - derniere >= ECART_MIN_VISIBILITE_MS) verifier();
    };

    minuteur = setInterval(verifier, intervalleMs);
    document.addEventListener('visibilitychange', auRetour);
    verifier();
    return () => {
      annule = true;
      clearInterval(minuteur);
      document.removeEventListener('visibilitychange', auRetour);
    };
  }, [actif, intervalleMs]);
}

const EVENEMENTS_ACTIVITE = ['pointerdown', 'touchstart', 'keydown', 'input', 'wheel'];

/**
 * Bornes (/client, /depot) : quand la borne est au repos (`auRepos` : étape 1, formulaire vide, calculé
 * par la page) et que personne n'a touché l'écran depuis `calmeMs`, vérifie au plus toutes les
 * `intervalleMs` et recharge s'il y a une nouvelle version. Jamais pendant une saisie : tout toucher ou
 * toute frappe relance le délai de calme, et l'état est revérifié après la réponse du serveur.
 */
export function useRechargementAuRepos({ auRepos, intervalleMs = INTERVALLE_BORNE_MS, calmeMs = CALME_BORNE_MS } = {}) {
  const repos = useRef(Boolean(auRepos));
  repos.current = Boolean(auRepos);
  const derniereActivite = useRef(Date.now());

  // Toucher, frappe, saisie : la borne est utilisée
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const marquer = () => { derniereActivite.current = Date.now(); };
    EVENEMENTS_ACTIVITE.forEach((e) => document.addEventListener(e, marquer, { capture: true, passive: true }));
    return () => EVENEMENTS_ACTIVITE.forEach((e) => document.removeEventListener(e, marquer, { capture: true }));
  }, []);

  // Entrée ou sortie du repos (début de saisie, remise à zéro) : le délai de calme repart
  useEffect(() => { derniereActivite.current = Date.now(); }, [auRepos]);

  useEffect(() => {
    let annule = false;
    let enCours = false;
    let derniereVerif = Date.now();
    const pret = () => repos.current && Date.now() - derniereActivite.current >= calmeMs;

    const tic = async () => {
      if (annule || enCours || Date.now() - derniereVerif < intervalleMs || !pret()) return;
      enCours = true;
      derniereVerif = Date.now();
      try {
        const { nouvelle, cible } = await verifierVersion();
        // Revérifié après la réponse : quelqu'un a pu commencer à saisir entre-temps
        if (!annule && nouvelle && pret()) recharger(cible);
      } finally {
        enCours = false;
      }
    };
    const minuteur = setInterval(tic, Math.min(PAS_REPOS_MS, intervalleMs));
    return () => {
      annule = true;
      clearInterval(minuteur);
    };
  }, [intervalleMs, calmeMs]);
}
