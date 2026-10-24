import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Envois optimistes d'une grille de prix : la nouvelle valeur s'affiche tout de suite, l'envoi part derrière.
 *
 * - envoyer(ligne, fn, { avant, apres }) : met l'envoi en file. Une ligne n'a qu'un envoi à la fois,
 *   dans l'ordre des saisies (le serveur reçoit toujours la dernière valeur en dernier).
 *   `avant` / `apres` : { clé: valeur } avant et après la saisie (facultatifs).
 *   Ne rejette jamais ; rend :
 *     { ok: true, reponse, proteges }             proteges = clés de la ligne encore en file ou en cours :
 *                                                 la réponse ne doit pas les écraser à l'écran ;
 *     { ok: false, erreur, retablir, proteges }   retablir = { clé: dernière valeur confirmée } pour
 *                                                 les clés sans autre envoi en file (à remettre à l'écran).
 * - enCours(ligne, cle?) : un envoi de la ligne (ou de cette clé) n'est pas terminé (« Enregistrement… »).
 * - nombre : lignes avec un envoi en cours (garde avant de quitter la page).
 * - attendre() : attend la fin des envois en cours ; vrai si le dernier envoi de chaque ligne a réussi.
 * - monte() : le composant est encore affiché (sinon, signaler un échec par un toast global).
 *
 * Démontage pendant un envoi : l'envoi va au bout et sa promesse se résout normalement (sans mise à
 * jour d'état) ; à l'appelant de prévenir par un toast global si le résultat n'a plus d'écran.
 */
export function useEnvoisOptimistes() {
  const files = useRef(new Map()); // ligne -> promesse de la file
  const cles = useRef(new Map()); // ligne -> Map(clé -> nombre d'envois en file ou en cours)
  const confirmes = useRef(new Map()); // ligne -> Map(clé -> dernière valeur confirmée)
  const mounted = useRef(true);
  const [lignes, setLignes] = useState(() => new Map()); // ligne -> nombre d'envois
  const [cellules, setCellules] = useState(() => new Map()); // `${ligne}|${clé}` -> nombre d'envois

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const compter = useCallback((ligne, cs, delta) => {
    if (!mounted.current) return;
    const ajouter = (map, k) => {
      const n = (map.get(k) || 0) + delta;
      if (n > 0) map.set(k, n); else map.delete(k);
    };
    setLignes((prev) => { const next = new Map(prev); ajouter(next, ligne); return next; });
    if (cs.length) {
      setCellules((prev) => { const next = new Map(prev); for (const k of cs) ajouter(next, `${ligne}|${k}`); return next; });
    }
  }, []);

  const envoyer = useCallback((ligne, fn, { avant = {}, apres = {} } = {}) => {
    const parCle = cles.current.get(ligne) || new Map();
    cles.current.set(ligne, parCle);
    const base = confirmes.current.get(ligne) || new Map();
    confirmes.current.set(ligne, base);
    for (const k of Object.keys(apres)) {
      // Première saisie non confirmée de cette clé : la valeur d'avant est la dernière confirmée
      if (!parCle.get(k) && k in avant) base.set(k, avant[k]);
      parCle.set(k, (parCle.get(k) || 0) + 1);
    }
    compter(ligne, Object.keys(apres), 1);

    const precedente = files.current.get(ligne) || Promise.resolve();
    const tour = precedente.then(async () => {
      let resultat;
      try {
        const reponse = await fn();
        for (const [k, v] of Object.entries(apres)) base.set(k, v);
        resultat = { ok: true, reponse };
      } catch (erreur) {
        resultat = { ok: false, erreur };
      }
      const retablir = {};
      for (const k of Object.keys(apres)) {
        const n = (parCle.get(k) || 1) - 1;
        if (n > 0) parCle.set(k, n);
        else {
          parCle.delete(k);
          if (!resultat.ok && base.has(k)) retablir[k] = base.get(k);
        }
      }
      if (!resultat.ok) resultat.retablir = retablir;
      resultat.proteges = new Set(parCle.keys());
      compter(ligne, Object.keys(apres), -1);
      return resultat;
    });
    files.current.set(ligne, tour);
    tour.finally(() => { if (files.current.get(ligne) === tour) files.current.delete(ligne); });
    return tour;
  }, [compter]);

  const enCours = useCallback((ligne, cle) => (cle === undefined ? lignes.has(ligne) : cellules.has(`${ligne}|${cle}`)),
    [lignes, cellules]);

  const attendre = useCallback(async () => {
    const resultats = await Promise.all([...files.current.values()]);
    return resultats.every((r) => r.ok);
  }, []);

  const monte = useCallback(() => mounted.current, []);

  return { envoyer, enCours, nombre: lignes.size, attendre, monte };
}

/**
 * Tant que `actif` est vrai (envoi en cours), fermer ou recharger l'onglet demande confirmation :
 * la requête partie en arrière-plan serait coupée et son échec passerait inaperçu.
 */
export function useAvertirAvantDepart(actif) {
  useEffect(() => {
    if (!actif || typeof window === 'undefined') return undefined;
    const avantDepart = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avantDepart);
    return () => window.removeEventListener('beforeunload', avantDepart);
  }, [actif]);
}

export default useEnvoisOptimistes;
