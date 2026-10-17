/**
 * Règles de prix et ajustements globaux, toujours avec un aperçu chiffré avant d'appliquer.
 *
 * - Défaut : ReglesPrixPanel (TarifsPage) — onglet « Marges » (TARIFS_REGLES) et onglet
 *   « Ajustement global » (+x % / +x € sur une sélection de pièces ou d'iPad/MacBook) ;
 * - FenetreRecalcul : « Recalculer » de TarifsPage, aperçu avant/après obligatoire ;
 * - AjoutPiecePrix : saisie d'une pièce absente de la grille (POST /api/tarifs/ligne) ;
 * - AjustementColonne : +x % / +x € sur une colonne d'une grille boutique (lignes affichées) ;
 * - ApercuSimulation : le résultat d'une simulation (nombre de prix, effet réel, plus gros écarts) ;
 * - useVerrousBoutique : cadenas des lignes des grilles boutique (paramètre partagé, appliqué par le serveur).
 * « Appliquer » reste désactivé tant que la simulation ne correspond pas exactement aux réglages affichés,
 * et tant que les prix signalés (grosse variation, marge faible) n'ont pas été explicitement acceptés.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Calculator, CheckCircle2, History, Loader2, PackagePlus, RotateCcw, SlidersHorizontal, Undo2,
} from 'lucide-react';
import api from '../lib/api';
import { useToast } from './Toast';
import {
  FenetrePrix, REGLES_DEFAUT, SANS_ELEVATION, arrondi9, clavierOnglets, estEcran, euros, fusionnerRegles,
  messageAnnulation, messageErreurPrix, prixClientApple, prixClientPiece, variationTexte,
} from './HistoriquePrix';

export { REGLES_DEFAUT, arrondi9 };

// Valeurs par défaut stables des listes (une nouvelle liste à chaque rendu défait les useMemo)
const AUCUNE_LIGNE = Object.freeze([]);

export function nombre(valeur) {
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : NaN;
  const s = String(valeur ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!s || s === '-' || s === '+') return NaN;
  return Number(s);
}

const CHAMPS_MARGE = [
  { id: 'ecran.standard', label: 'Écran standard', aide: 'Écrans des téléphones courants' },
  { id: 'ecran.haut_de_gamme', label: 'Écran haut de gamme', aide: 'iPhone Pro, Galaxy S…' },
  { id: 'ecran.pliant', label: 'Écran pliant', aide: 'Galaxy Z Fold / Flip…' },
  { id: 'autre', label: 'Autres pièces', aide: 'Batterie, connecteur, caméra, vitre…' },
  { id: 'ipad', label: 'iPad', aide: 'Écran et batterie' },
  { id: 'macbook', label: 'MacBook', aide: 'Écran et batterie' },
];
const CHAMPS_ALERTE = [
  { id: 'seuil_marge_alerte', label: 'Marge minimale sur un écran', unite: '€', aide: 'En dessous, la ligne est signalée en rouge' },
  { id: 'variation_alerte_pct', label: 'Variation à valider au-delà de', unite: '%', aide: 'Ligne décochée par défaut dans un aperçu' },
  { id: 'variation_alerte_eur', label: 'ou au-delà de', unite: '€', aide: 'Écart en euros' },
  { id: 'jours_a_revoir', label: 'Prix « à revoir » après', unite: 'jours', aide: 'Badge orange' },
  { id: 'jours_perime', label: 'Prix « périmé » après', unite: 'jours', aide: 'Badge rouge' },
];

const lire = (obj, chemin) => chemin.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
function ecrire(obj, chemin, valeur) {
  const [a, b] = chemin.split('.');
  if (b) return { ...obj, [a]: { ...obj[a], [b]: valeur } };
  return { ...obj, [a]: valeur };
}

// Règles saisies (textes) → objet numérique, ou { erreur }
function reglesDepuisSaisie(saisie) {
  let out = fusionnerRegles(saisie);
  for (const champ of [...CHAMPS_MARGE, ...CHAMPS_ALERTE]) {
    const n = nombre(lire(saisie, champ.id));
    if (!Number.isFinite(n) || n < 0 || n > 5000) return { erreur: `« ${champ.label} » : nombre positif attendu.` };
    out = ecrire(out, champ.id, n);
  }
  if (out.jours_perime <= out.jours_a_revoir) return { erreur: 'Le délai « périmé » doit être plus long que le délai « à revoir ».' };
  return { regles: out };
}

function signeNombre(v, unite, decimales = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const signe = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${signe}${Math.abs(n).toLocaleString('fr-FR', { maximumFractionDigits: decimales })} ${unite}`;
}
const pourcent = (v) => signeNombre(v, '%');
const ecartEuros = (v) => signeNombre(v, '€', 2);
export const texteAjustement = (aj) => (aj ? signeNombre(aj.valeur, aj.type === 'pct' ? '%' : '€', 2) : '');

// Comme services/prix.ajuster(…, entier=False) : 2 décimales, arrondi au demi supérieur sur l'écriture
// décimale du nombre (Decimal(str(x)).quantize(0.01, ROUND_HALF_UP)).
function arrondiCentimes(x) {
  if (!Number.isFinite(x)) return NaN;
  const s = String(Math.abs(x));
  if (/e/i.test(s)) return Math.round(x * 100) / 100;
  const [ent, dec = ''] = s.split('.');
  let centimes = Number(ent) * 100 + Number(`${dec}00`.slice(0, 2));
  if ((dec[2] || '0') >= '5') centimes += 1;
  return (x < 0 ? -centimes : centimes) / 100;
}
export function ajusterHt(ht, ajustement) {
  const v = Number(ajustement.valeur);
  const brut = ajustement.type === 'pct' ? Number(ht) * (1 + v / 100) : Number(ht) + v;
  return arrondiCentimes(brut);
}

/**
 * Nombre de prix client qui changeraient avec un ajustement du prix d'achat (pièces, iPad/MacBook),
 * calculé comme le serveur sur les lignes sélectionnées (verrouillées et sans prix d'achat exclues).
 * null si les prix d'achat ne sont pas connus ici (masqués par le serveur sans le code admin).
 */
const htMasque = (l, champ) => !Object.prototype.hasOwnProperty.call(l, champ);
export function compterPrixClientLocal({ cible, lignes, ajustement, typePiece, regles }) {
  let n = 0;
  for (const l of lignes || []) {
    if (l.verrou_manuel || l.obsolete) continue;
    if (cible === 'tarifs') {
      if (htMasque(l, 'prix_fournisseur_ht')) return null;
      const ht = Number(l.prix_fournisseur_ht);
      if (!(ht > 0)) continue;
      const nouveau = ajusterHt(ht, ajustement);
      if (!(nouveau > 0)) continue;
      if (prixClientPiece(nouveau, l.type_piece, l.categorie, regles) !== Number(l.prix_client)) n += 1;
    } else {
      if (l.actif === false) continue;
      for (const p of ['ecran', 'batterie']) {
        if (typePiece && typePiece !== p) continue;
        if (htMasque(l, `${p}_prix_ht`)) return null;
        const ht = Number(l[`${p}_prix_ht`]);
        if (!(ht > 0)) continue;
        const nouveau = ajusterHt(ht, ajustement);
        if (!(nouveau > 0)) continue;
        if (prixClientApple(nouveau, l.categorie, regles) !== Number(l[`${p}_prix_vente`])) n += 1;
      }
    }
  }
  return n;
}

/**
 * Prix client qui changent, d'après le résultat du serveur : champ modifies_client s'il existe, sinon
 * déduit des écarts (triés du plus gros au plus petit écart de prix client) quand c'est certain.
 * → { n, exact }
 */
export function prixClientQuiChangent(resultat, estimationLocale = null) {
  const modifies = Number(resultat?.modifies) || 0;
  if (Number.isFinite(Number(resultat?.modifies_client)) && resultat?.modifies_client !== null) {
    return { n: Number(resultat.modifies_client), exact: true };
  }
  if (!modifies) return { n: 0, exact: true };
  const min = Number(resultat.variation_min);
  const max = Number(resultat.variation_max);
  if ((Number.isFinite(min) && min > 0) || (Number.isFinite(max) && max < 0)) return { n: modifies, exact: true };
  if (min === 0 && max === 0) return { n: 0, exact: true };
  const ecarts = Array.isArray(resultat.ecarts) ? resultat.ecarts : [];
  const bougent = ecarts.filter((e) => Number(e.ancien ?? 0) !== Number(e.nouveau)).length;
  if (ecarts.length >= modifies || bougent < ecarts.length) return { n: bougent, exact: true };
  if (Number.isFinite(estimationLocale)) return { n: estimationLocale, exact: true };
  return { n: bougent, exact: false };
}

// Codes d'alerte du serveur (services/prix) → libellés
const ALERTES = { variation: 'Grosse variation', marge: 'Marge trop faible', verrou: 'Prix verrouillé' };
function texteAlerte(alerte, alertes) {
  const codes = Array.isArray(alertes) && alertes.length ? alertes : alerte ? [alerte] : [];
  return codes.map((a) => (typeof a === 'object' && a ? (a.message || a.code) : (ALERTES[a] || a))).filter(Boolean).join(', ');
}

// Phrase « effet réel » d'un ajustement : ce qui est demandé, ce que deviennent vraiment les prix client
function noteEffet({ resultat, ajustement, surAchat }) {
  const demande = Number(ajustement.valeur);
  const moyPct = Number(resultat.variation_moy_pct);
  const moyEur = Number(resultat.variation_moy);
  const ecart = ajustement.type === 'pct' ? Math.abs(moyPct - demande) : Math.abs(moyEur - demande);
  if (!(ecart > 0.5)) return null;
  if (surAchat) {
    return 'L’ajustement porte sur le prix d’achat HT ; le prix client (× TVA + marge) est ensuite arrondi au 9 : il bouge par paliers de 10 €. Beaucoup de prix client ne changent pas, d’autres prennent 10 € d’un coup.';
  }
  const effet = ajustement.type === 'pct' ? pourcent(moyPct) : ecartEuros(moyEur);
  const plus = ajustement.type === 'pct' ? Math.abs(moyPct) > Math.abs(demande) : Math.abs(moyEur) > Math.abs(demande);
  return `Arrondi au 9 : l’effet réel (${effet} en moyenne) est plus ${plus ? 'fort' : 'faible'} que la demande (${texteAjustement(ajustement)}).`;
}

// ─── Aperçu d'une simulation ───────────────────────
/**
 * props : resultat (réponse de /simuler), titre, ajustement { type, valeur } (ajustement global : affiche
 * la demande face à l'effet réel), surAchat (l'ajustement porte sur le prix d'achat HT : pièces,
 * iPad/MacBook), clientsEstimes (nombre de prix client qui changent, calculé localement).
 */
export function ApercuSimulation({ resultat, titre = 'Aperçu avant application', ajustement = null, surAchat = false, clientsEstimes = null }) {
  if (!resultat) return null;
  const ecarts = Array.isArray(resultat.ecarts) ? resultat.ecarts : [];
  const modifies = Number(resultat.modifies) || 0;
  const ignores = Number(resultat.ignores) || 0;
  const alertes = Number(resultat.alertes) || 0;
  const avecHt = ecarts.some((e) => e.ancien_ht != null || e.nouveau_ht != null);
  const verrouillesListe = Array.isArray(resultat.verrouilles_liste) ? resultat.verrouilles_liste : [];
  const client = surAchat ? prixClientQuiChangent(resultat, clientsEstimes) : { n: modifies, exact: true };
  const detailAlertes = alertes > 0 ? `${alertes} à vérifier` : null;
  const detailIgnores = ignores ? `${ignores} sans prix (ignoré${ignores > 1 ? 's' : ''})` : null;
  // variation_moy / min / max : en euros de prix client ; variation_moy_pct : en %
  const tuiles = surAchat
    ? [
      { label: 'Prix client qui changent', valeur: client.exact ? client.n : `${client.n} ou plus`, ton: client.n ? 'text-violet-800' : 'text-slate-800',
        detail: `sur ${modifies} prix d’achat mis à jour` },
      { label: 'Prix d’achat mis à jour', valeur: modifies, ton: 'text-slate-800', detail: detailAlertes },
      { label: 'Verrouillés (ne bougent pas)', valeur: resultat.verrouilles ?? 0, ton: 'text-amber-800' },
      { label: 'Inchangés', valeur: resultat.inchanges ?? '—', ton: 'text-slate-800', detail: detailIgnores },
    ]
    : [
      { label: 'Prix qui changeraient', valeur: modifies, ton: modifies ? 'text-violet-800' : 'text-slate-800', detail: detailAlertes },
      { label: 'Inchangés', valeur: resultat.inchanges ?? '—', ton: 'text-slate-800', detail: detailIgnores },
      { label: 'Verrouillés (ne bougent pas)', valeur: resultat.verrouilles ?? 0, ton: 'text-amber-800' },
      { label: 'Variation moyenne', valeur: modifies ? ecartEuros(resultat.variation_moy) : '—', ton: 'text-slate-800',
        detail: modifies
          ? [resultat.variation_moy_pct != null ? pourcent(resultat.variation_moy_pct) : null,
             resultat.variation_min != null ? `de ${ecartEuros(resultat.variation_min)} à ${ecartEuros(resultat.variation_max)}` : null]
            .filter(Boolean).join(' · ')
          : null },
    ];
  const note = ajustement && modifies ? noteEffet({ resultat, ajustement, surAchat }) : null;
  return (
    <section aria-label={titre} className="mt-4">
      <h3 className="text-sm font-bold text-slate-800 mb-2">{titre}</h3>
      {ajustement && modifies > 0 && (
        <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-violet-950" role="status">
          <p className="text-base font-bold">
            Vous demandez {texteAjustement(ajustement)}{surAchat ? ' sur le prix d’achat HT' : ''}. Effet réel sur le prix
            client : {pourcent(resultat.variation_moy_pct)} en moyenne ({ecartEuros(resultat.variation_moy)}),
            de {ecartEuros(resultat.variation_min)} à {ecartEuros(resultat.variation_max)}.
          </p>
          {note && <p className="mt-0.5 text-sm">{note}</p>}
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" role="status">
        {tuiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">{t.label}</div>
            <div className={`text-xl font-extrabold tabular-nums ${t.ton}`}>{t.valeur}</div>
            {t.detail && <div className="text-xs text-slate-600">{t.detail}</div>}
          </div>
        ))}
      </div>
      {modifies === 0 ? (
        <p className="mt-3 text-sm text-slate-700">Aucun prix ne changerait avec ces réglages.</p>
      ) : ecarts.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <caption className="text-left text-xs font-semibold text-slate-600 px-3 py-2 bg-white">
              Les {ecarts.length} plus gros écarts de prix client
            </caption>
            <thead className="bg-slate-50 text-xs uppercase text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">Prix</th>
                {avecHt && <th scope="col" className="px-3 py-2 text-right">Achat HT</th>}
                <th scope="col" className="px-3 py-2 text-right">Prix client avant</th>
                <th scope="col" className="px-3 py-2 text-right">Après</th>
                <th scope="col" className="px-3 py-2 text-right">Écart</th>
              </tr>
            </thead>
            <tbody>
              {ecarts.map((e, i) => {
                const alerte = texteAlerte(e.alerte, e.alertes);
                return (
                  <tr key={e.cle || i} className={`border-t border-slate-100 ${alerte ? 'bg-amber-50' : ''}`}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{e.label || e.cle}</span>
                      {alerte && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-amber-400 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
                          <AlertTriangle className="w-3 h-3" aria-hidden="true" /> {alerte}
                        </span>
                      )}
                    </td>
                    {avecHt && (
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-slate-700">
                        {e.ancien_ht != null && e.nouveau_ht != null && Number(e.ancien_ht) !== Number(e.nouveau_ht)
                          ? <>{euros(e.ancien_ht)} → {euros(e.nouveau_ht)}</>
                          : euros(e.nouveau_ht ?? e.ancien_ht)}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{euros(e.ancien)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{euros(e.nouveau)}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {Number(e.ancien ?? 0) === Number(e.nouveau) ? 'inchangé' : variationTexte(e.ancien, e.nouveau)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {verrouillesListe.length > 0 && (
        <details className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <summary className="cursor-pointer min-h-[44px] flex items-center font-semibold">
            Voir les {resultat.verrouilles} prix verrouillés (non modifiés)
          </summary>
          <ul className="mt-1 columns-1 sm:columns-2 gap-4">
            {verrouillesListe.map((v) => <li key={v.cle} className="py-0.5 break-inside-avoid">{v.label || v.cle}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

// Bandeau après application : nombre de prix changés et annulation immédiate du lot
export function ResultatApplication({ resultat, sensible, onAnnule }) {
  const toast = useToast();
  const [annulation, setAnnulation] = useState(false);
  const [annule, setAnnule] = useState(null); // message de l'annulation ({ ton, texte }) une fois faite
  if (!resultat) return null;
  const n = Number(resultat.modifies) || 0;
  // Lignes laissées telles quelles par le serveur (cadenas, y compris posé sur un autre poste depuis l'aperçu)
  const verrouillesListe = Array.isArray(resultat.verrouilles_liste) ? resultat.verrouilles_liste : [];
  async function annuler() {
    setAnnulation(true);
    try {
      const res = await sensible(() => api.annulerLotPrix(resultat.lot_id));
      // Lignes verrouillées (cadenas) distinguées des prix modifiés depuis
      const m = messageAnnulation(res);
      setAnnule(m);
      if (m.ton === 'warning') toast.warning(m.texte); else toast.success(m.texte);
      onAnnule?.();
    } catch (e) {
      const msg = messageErreurPrix(e, 'Annulation impossible');
      if (msg) toast.error(msg);
    } finally {
      setAnnulation(false);
    }
  }
  return (
    <div role="status" className={`mt-4 rounded-xl border p-3 text-sm ${annule?.ton === 'warning' ? 'border-amber-400 bg-amber-50 text-amber-950' : annule ? 'border-slate-300 bg-slate-50 text-slate-800' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
      <p className="font-semibold flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
        {annule ? (annule.ton === 'warning' ? annule.texte : 'Changement annulé.') : `${n} prix mis à jour.`}
        {!annule && Number(resultat.verrouilles) > 0 && ` ${resultat.verrouilles} prix verrouillés n’ont pas bougé.`}
      </p>
      {!annule && verrouillesListe.length > 0 && (
        <details className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1 text-amber-950">
          <summary className="cursor-pointer min-h-[44px] flex items-center font-semibold">
            {`Lignes verrouillées, non modifiées (${Math.max(verrouillesListe.length, Number(resultat.verrouilles) || 0)})`}
          </summary>
          <ul className="mb-2 columns-1 sm:columns-2 gap-4">
            {verrouillesListe.map((v) => <li key={v.cle || v.label} className="py-0.5 break-inside-avoid">{v.label || v.cle}</li>)}
          </ul>
        </details>
      )}
      {!annule && resultat.lot_id && (
        <button
          type="button"
          onClick={annuler}
          disabled={annulation}
          className="mt-2 min-h-[44px] px-3 rounded-lg border border-emerald-400 bg-white font-semibold text-emerald-900 hover:bg-emerald-100 inline-flex items-center gap-2 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
        >
          {annulation ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <Undo2 className="w-4 h-4" aria-hidden="true" />}
          Annuler ce changement
        </button>
      )}
    </div>
  );
}

// Simuler → Appliquer : l'aperçu n'est valable que pour la charge exacte simulée
function useSimulation({ sensible, onApplique }) {
  const toast = useToast();
  const [simulation, setSimulation] = useState(null); // { cle, resultat }
  const [application, setApplication] = useState(null);
  const [occupe, setOccupe] = useState(null); // 'simuler' | 'appliquer'
  // Prix signalés (grosse variation, marge faible) acceptés explicitement pour CETTE simulation
  const [confirme, setConfirme] = useState(false);

  const reinitialiser = useCallback(() => { setSimulation(null); setApplication(null); setConfirme(false); }, []);

  const simuler = useCallback(async (charge) => {
    setOccupe('simuler');
    setApplication(null);
    setConfirme(false);
    try {
      const resultat = await sensible(() => api.simulerPrix(charge));
      setSimulation({ cle: JSON.stringify(charge), resultat });
    } catch (e) {
      setSimulation(null);
      const msg = messageErreurPrix(e, 'Simulation impossible');
      if (msg) toast.error(msg);
    } finally {
      setOccupe(null);
    }
  }, [sensible, toast]);

  const appliquer = useCallback(async (charge) => {
    setOccupe('appliquer');
    try {
      const resultat = await sensible(() => api.appliquerPrix(charge));
      setApplication(resultat || {});
      setSimulation(null);
      setConfirme(false);
      toast.success(`${Number(resultat?.modifies) || 0} prix mis à jour.`);
      onApplique?.(resultat);
    } catch (e) {
      const msg = messageErreurPrix(e, 'Application impossible');
      if (msg) toast.error(msg);
    } finally {
      setOccupe(null);
    }
  }, [sensible, toast, onApplique]);

  return { simulation, application, occupe, simuler, appliquer, reinitialiser, confirme, setConfirme };
}

// Case à cocher obligatoire quand l'aperçu signale des prix (variation > seuil, marge trop faible)
function ConfirmationAlertes({ alertes, confirme, onConfirme }) {
  const id = useId();
  if (!(alertes > 0)) return null;
  return (
    <label htmlFor={id} className="flex items-start gap-3 min-h-[44px] rounded-xl border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950 cursor-pointer">
      <input
        id={id}
        type="checkbox"
        checked={!!confirme}
        onChange={(e) => onConfirme(e.target.checked)}
        className="mt-0.5 w-5 h-5 shrink-0 accent-amber-700"
      />
      <span>
        <strong>{alertes} prix signalé{alertes > 1 ? 's' : ''}</strong> (grosse variation ou marge trop faible, surlignés dans l’aperçu) :
        je les ai vérifiés, je les applique aussi.
      </span>
    </label>
  );
}

function BoutonsSimulation({ pret, simulationValide, occupe, onSimuler, onAppliquer, erreur, libelleAppliquer, alertes = 0, confirme, onConfirme, rien = false }) {
  const idAide = useId();
  const aConfirmer = simulationValide && alertes > 0;
  const bloque = !simulationValide || !!occupe || !pret || rien || (aConfirmer && !confirme);
  let aide = null;
  if (!simulationValide) aide = 'Disponible après une simulation';
  else if (rien) aide = 'Aucun prix ne changerait';
  else if (aConfirmer && !confirme) aide = 'Cochez d’abord la vérification des prix signalés';
  return (
    <div className="space-y-2">
      {aConfirmer && <ConfirmationAlertes alertes={alertes} confirme={confirme} onConfirme={onConfirme} />}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        {erreur && <p role="alert" className="text-sm font-semibold text-red-700 sm:mr-auto">{erreur}</p>}
        {!erreur && !simulationValide && <p className="text-sm text-slate-600 sm:mr-auto">Simulez d’abord : rien n’est modifié tant que vous n’appliquez pas.</p>}
        {!erreur && simulationValide && <p className="text-sm text-slate-700 sm:mr-auto">{rien ? 'Rien à appliquer.' : 'Vérifiez l’aperçu, puis appliquez.'}</p>}
        <div className="flex gap-2 sm:ml-auto">
          <button
            type="button"
            onClick={onSimuler}
            disabled={!pret || !!occupe}
            className="flex-1 sm:flex-none min-h-[44px] px-4 rounded-lg border border-violet-300 bg-white text-violet-800 font-semibold hover:bg-violet-50 inline-flex items-center justify-center gap-2 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            {occupe === 'simuler' ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <Calculator className="w-4 h-4" aria-hidden="true" />}
            Simuler
          </button>
          <button
            type="button"
            onClick={onAppliquer}
            disabled={bloque}
            aria-describedby={aide ? idAide : undefined}
            className="flex-1 sm:flex-none min-h-[44px] px-4 py-1.5 rounded-lg bg-violet-700 text-white font-semibold text-center hover:bg-violet-800 inline-flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
          >
            {occupe === 'appliquer' && <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />}
            {simulationValide && libelleAppliquer ? libelleAppliquer : 'Appliquer'}
          </button>
          {aide && <span id={idAide} className="sr-only">{aide}</span>}
        </div>
      </div>
    </div>
  );
}

// Libellé du bouton Appliquer d'après l'aperçu (prix client et prix d'achat comptés à part)
function libelleApplication(resultat, { surAchat = false, clientsEstimes = null } = {}) {
  if (!resultat) return null;
  const modifies = Number(resultat.modifies) || 0;
  if (!surAchat) return `Appliquer (${modifies} prix)`;
  const client = prixClientQuiChangent(resultat, clientsEstimes);
  return `Appliquer (${client.exact ? client.n : `${client.n}+`} prix client, ${modifies} prix d’achat)`;
}

// Saisie d'un ajustement : + % / + €, valeur (négative = baisse)
function ChampAjustement({ type, valeur, onType, onValeur, idBase, surAchat = false }) {
  const raccourcis = [-5, 5, 10];
  return (
    <fieldset className="rounded-xl border border-slate-200 p-3">
      <legend className="px-1 text-sm font-bold text-slate-800">Ajustement</legend>
      <div className="flex flex-wrap items-end gap-3">
        <div role="radiogroup" aria-label="Type d’ajustement" className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
          {[['pct', 'En %'], ['eur', 'En €']].map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={type === v}
              onClick={() => onType(v)}
              className={`min-h-[44px] px-4 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${type === v ? 'bg-violet-700 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor={`${idBase}-valeur`} className="block text-xs font-semibold text-slate-700 mb-1">
            Valeur ({type === 'pct' ? '%' : '€'}, négative pour baisser)
          </label>
          <input
            id={`${idBase}-valeur`}
            type="text"
            inputMode="decimal"
            value={valeur}
            onChange={(e) => onValeur(e.target.value)}
            placeholder={type === 'pct' ? 'ex. 5' : 'ex. 10'}
            className="w-32 min-h-[44px] rounded-lg border border-slate-300 px-3 text-base font-semibold tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          />
        </div>
        <div className="flex gap-1.5" aria-label="Raccourcis">
          {raccourcis.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onValeur(String(r))}
              className="min-h-[44px] min-w-[52px] px-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              {r > 0 ? '+' : '−'}{Math.abs(r)} {type === 'pct' ? '%' : '€'}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-600">
        {surAchat
          ? 'Le prix d’achat HT est ajusté, puis le prix client est recalculé (× TVA + marge) et arrondi au 9 : il bouge par paliers de 10 €.'
          : 'Les prix affichés sont arrondis au 9 : au-dessus pour une hausse (99 € + 5 % → 109 €), en dessous pour une baisse.'}
      </p>
    </fieldset>
  );
}

function valeurAjustement(type, saisie) {
  const v = nombre(saisie);
  if (!Number.isFinite(v) || v === 0) return { erreur: 'Saisissez une valeur différente de 0.' };
  if (type === 'pct' && (v <= -90 || v > 200)) return { erreur: 'Pourcentage entre −90 % et +200 %.' };
  if (type === 'eur' && Math.abs(v) > 1000) return { erreur: 'Montant entre −1 000 € et +1 000 €.' };
  return { valeur: v };
}

// ─── Onglet « Marges » ─────────────────────────────
function OngletMarges({ sensible, onApplique }) {
  const toast = useToast();
  const [enregistrees, setEnregistrees] = useState(null);
  const [saisie, setSaisie] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState('');
  // Règles appliquées = règles enregistrées côté serveur (TARIFS_REGLES)
  const saisieCourante = useRef(null);
  const sim = useSimulation({ sensible, onApplique: (r) => { setEnregistrees(saisieCourante.current); onApplique?.(r); } });

  const charger = useCallback(async () => {
    setChargement(true);
    setErreurChargement('');
    try {
      const r = fusionnerRegles(await sensible(() => api.getReglesPrix()));
      setEnregistrees(r);
      setSaisie(r);
    } catch (e) {
      const msg = messageErreurPrix(e, 'Lecture des règles impossible');
      setErreurChargement(msg || 'Identification administrateur annulée.');
    } finally {
      setChargement(false);
    }
  }, [sensible]);
  useEffect(() => { charger(); }, [charger]);

  const verif = useMemo(() => (saisie ? reglesDepuisSaisie(saisie) : { erreur: '' }), [saisie]);
  saisieCourante.current = verif.regles || null;
  const charge = verif.regles ? { regles: verif.regles } : null;
  const simulationValide = !!charge && sim.simulation?.cle === JSON.stringify(charge);
  const modifiees = !!(verif.regles && enregistrees) && JSON.stringify(verif.regles) !== JSON.stringify(fusionnerRegles(enregistrees));
  const resultat = simulationValide ? sim.simulation.resultat : null;

  // Exemple chiffré de la formule, recalculé à chaque saisie
  const exemple = useMemo(() => {
    const r = verif.regles || REGLES_DEFAUT;
    const brut = 45 * r.tva + r.ecran.standard;
    return `Exemple : écran standard acheté 45 € HT → 45 × ${String(r.tva).replace('.', ',')} + ${r.ecran.standard} = ${brut.toFixed(2).replace('.', ',').replace(',00', '')} € → ${arrondi9(brut)} €`;
  }, [verif.regles]);

  // Relecture après une application ou une annulation : le formulaire (et son bilan) reste affiché
  if (chargement && !saisie) {
    return <p className="py-10 text-center text-sm text-slate-600 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />Chargement des règles…</p>;
  }
  if (erreurChargement && !saisie) {
    return (
      <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 flex flex-wrap items-center gap-2">
        <span className="flex-1">{erreurChargement}</span>
        <button type="button" onClick={charger} className="min-h-[44px] px-3 rounded-lg font-semibold hover:bg-red-100">Réessayer</button>
      </div>
    );
  }

  const champ = (c, unite = '€') => {
    const id = `regle-${c.id.replace('.', '-')}`;
    return (
      <div key={c.id}>
        <label htmlFor={id} className="block text-sm font-semibold text-slate-800">{c.label}</label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id={id}
            type="text"
            inputMode="decimal"
            value={String(lire(saisie, c.id) ?? '')}
            onChange={(e) => { setSaisie((s) => ecrire(s, c.id, e.target.value)); }}
            aria-describedby={`${id}-aide`}
            className="w-28 min-h-[44px] rounded-lg border border-slate-300 px-3 text-base font-semibold tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          />
          <span className="text-sm text-slate-600">{c.unite || unite}</span>
        </div>
        <p id={`${id}-aide`} className="mt-0.5 text-xs text-slate-600">{c.aide}</p>
      </div>
    );
  };

  return (
    <div>
      <div className="rounded-xl bg-violet-50 border border-violet-200 px-3 py-2 text-sm text-violet-950">
        <p className="font-semibold">Prix client = prix d’achat HT × {String((verif.regles || REGLES_DEFAUT).tva).replace('.', ',')} (TVA) + marge, arrondi au 9 supérieur.</p>
        <p className="mt-0.5">{exemple}</p>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-bold text-slate-900 mb-2">Marge ajoutée (main-d’œuvre comprise)</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CHAMPS_MARGE.map((c) => champ(c))}
        </div>
      </fieldset>

      <details className="mt-4 rounded-xl border border-slate-200 p-3">
        <summary className="cursor-pointer min-h-[44px] flex items-center text-sm font-bold text-slate-900">Seuils d’alerte</summary>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CHAMPS_ALERTE.map((c) => champ(c, c.unite))}
        </div>
      </details>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => { setSaisie(fusionnerRegles(enregistrees)); sim.reinitialiser(); }}
          disabled={!modifiees}
          className="min-h-[44px] px-3 rounded-lg border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <RotateCcw className="w-4 h-4" aria-hidden="true" /> Revenir aux règles enregistrées
        </button>
        <button
          type="button"
          onClick={() => { setSaisie(fusionnerRegles(REGLES_DEFAUT)); sim.reinitialiser(); toast.info('Valeurs d’origine remises : simulez pour voir l’effet.'); }}
          className="min-h-[44px] px-3 rounded-lg border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          Valeurs d’origine
        </button>
      </div>

      <div className="mt-4">
        <BoutonsSimulation
          pret={!!charge}
          simulationValide={simulationValide}
          occupe={sim.occupe}
          erreur={verif.erreur}
          libelleAppliquer={libelleApplication(resultat)}
          alertes={Number(resultat?.alertes) || 0}
          confirme={sim.confirme}
          onConfirme={sim.setConfirme}
          rien={!!resultat && !(Number(resultat.modifies) > 0)}
          onSimuler={() => charge && sim.simuler(charge)}
          onAppliquer={() => charge && sim.appliquer(charge)}
        />
      </div>
      {resultat && <ApercuSimulation resultat={resultat} />}
      <ResultatApplication resultat={sim.application} sensible={sensible} onAnnule={() => { charger(); onApplique?.(); }} />
    </div>
  );
}

// ─── Onglet « Ajustement global » ─────────────────
const TYPES_PIECE_COURANTS = ['Ecran', 'Batterie', 'Connecteur de charge', 'Camera arriere', 'Vitre arriere'];

function OngletAjustement({ sensible, onApplique, tarifs = AUCUNE_LIGNE, appleDevices = AUCUNE_LIGNE }) {
  const [cible, setCible] = useState('tarifs');
  const [marque, setMarque] = useState('');
  const [modele, setModele] = useState('');
  const [typePiece, setTypePiece] = useState('');
  const [type, setType] = useState('pct');
  const [valeur, setValeur] = useState('');
  const [regles, setRegles] = useState(null);
  const sim = useSimulation({ sensible, onApplique });

  // Règles en vigueur : comptage des prix client qui changent (le serveur fait foi pour le reste)
  useEffect(() => {
    let actif = true;
    sensible(() => api.getReglesPrix())
      .then((r) => { if (actif) setRegles(fusionnerRegles(r)); })
      .catch(() => { /* sans règles : comptage déduit de l'aperçu du serveur */ });
    return () => { actif = false; };
  }, [sensible]);

  const lignesCible = cible === 'tarifs' ? tarifs : appleDevices;
  const marques = useMemo(() => [...new Set(tarifs.map((t) => t.marque).filter(Boolean))].sort(), [tarifs]);
  const modeles = useMemo(() => {
    const src = cible === 'tarifs' ? tarifs.filter((t) => !marque || t.marque === marque) : appleDevices;
    return [...new Set(src.map((t) => t.modele).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
  }, [cible, tarifs, appleDevices, marque]);
  const typesPiece = useMemo(() => {
    if (cible !== 'tarifs') return [['ecran', 'Écran'], ['batterie', 'Batterie']];
    const vus = [...new Set(tarifs.map((t) => t.type_piece).filter(Boolean))];
    const tries = [...TYPES_PIECE_COURANTS.filter((t) => vus.includes(t)), ...vus.filter((t) => !TYPES_PIECE_COURANTS.includes(t)).sort()];
    return tries.map((t) => [t, t]);
  }, [cible, tarifs]);

  // Estimation locale du nombre de prix concernés (le serveur fait foi dans l'aperçu)
  const concernes = useMemo(() => lignesCible.filter((t) => {
    if (t.obsolete) return false;
    if (cible === 'tarifs' && marque && t.marque !== marque) return false;
    if (modele && t.modele !== modele) return false;
    if (cible === 'tarifs' && typePiece && t.type_piece !== typePiece) return false;
    return true;
  }), [lignesCible, cible, marque, modele, typePiece]);
  const nbVerrouilles = concernes.filter((t) => t.verrou_manuel).length;

  const verif = valeurAjustement(type, valeur);
  // Sélection exacte : les identifiants des lignes choisies (le serveur compare le modèle par « contient »)
  const filtre = {};
  if (marque || modele || (cible === 'tarifs' && typePiece)) filtre.ids = concernes.map((t) => t.id);
  if (cible !== 'tarifs' && typePiece) filtre.type_piece = typePiece;
  const charge = verif.valeur != null && (!filtre.ids || filtre.ids.length)
    ? { cible, filtre, ajustement: { type, valeur: verif.valeur } }
    : null;
  const simulationValide = !!charge && sim.simulation?.cle === JSON.stringify(charge);
  const resultat = simulationValide ? sim.simulation.resultat : null;
  const clientsEstimes = useMemo(() => {
    if (!resultat || !regles || !charge) return null;
    return compterPrixClientLocal({ cible, lignes: concernes, ajustement: charge.ajustement, typePiece, regles });
  }, [resultat, regles, cible, concernes, typePiece]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectClasses = 'w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500';

  return (
    <div>
      <p className="text-sm text-slate-700">
        Pour suivre une hausse ou une baisse générale du fournisseur : l’ajustement s’applique au prix d’achat HT,
        puis le prix client est recalculé avec vos marges. Les prix verrouillés ne bougent jamais.
      </p>

      <fieldset className="mt-4 rounded-xl border border-slate-200 p-3">
        <legend className="px-1 text-sm font-bold text-slate-800">Prix concernés</legend>
        <div role="radiogroup" aria-label="Catalogue" className="inline-flex rounded-lg border border-slate-300 overflow-hidden mb-3">
          {[['tarifs', 'Pièces téléphones'], ['tarifs_apple_devices', 'iPad / MacBook']].map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={cible === v}
              onClick={() => { setCible(v); setMarque(''); setModele(''); setTypePiece(''); }}
              className={`min-h-[44px] px-4 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${cible === v ? 'bg-violet-700 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {cible === 'tarifs' && (
            <div>
              <label htmlFor="ajust-marque" className="block text-xs font-semibold text-slate-700 mb-1">Marque</label>
              <select id="ajust-marque" value={marque} onChange={(e) => { setMarque(e.target.value); setModele(''); }} className={selectClasses}>
                <option value="">Toutes les marques</option>
                {marques.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="ajust-modele" className="block text-xs font-semibold text-slate-700 mb-1">Modèle</label>
            <select id="ajust-modele" value={modele} onChange={(e) => setModele(e.target.value)} className={selectClasses}>
              <option value="">Tous les modèles</option>
              {modeles.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ajust-type" className="block text-xs font-semibold text-slate-700 mb-1">Pièce</label>
            <select id="ajust-type" value={typePiece} onChange={(e) => setTypePiece(e.target.value)} className={selectClasses}>
              <option value="">Toutes les pièces</option>
              {typesPiece.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-700" aria-live="polite">
          Environ <strong>{concernes.length}</strong> prix sélectionné{concernes.length > 1 ? 's' : ''}
          {nbVerrouilles > 0 && <>, dont <strong>{nbVerrouilles}</strong> verrouillé{nbVerrouilles > 1 ? 's' : ''} (exclus)</>}.
        </p>
      </fieldset>

      <div className="mt-4">
        <ChampAjustement type={type} valeur={valeur} onType={setType} onValeur={setValeur} idBase="ajust-global" surAchat />
      </div>

      <div className="mt-4">
        <BoutonsSimulation
          pret={!!charge}
          simulationValide={simulationValide}
          occupe={sim.occupe}
          erreur={filtre.ids && !filtre.ids.length ? 'Aucun prix ne correspond à cette sélection.' : (valeur.trim() ? verif.erreur : '')}
          libelleAppliquer={libelleApplication(resultat, { surAchat: true, clientsEstimes })}
          alertes={Number(resultat?.alertes) || 0}
          confirme={sim.confirme}
          onConfirme={sim.setConfirme}
          rien={!!resultat && !(Number(resultat.modifies) > 0)}
          onSimuler={() => charge && sim.simuler(charge)}
          onAppliquer={() => charge && sim.appliquer(charge)}
        />
      </div>
      {resultat && (
        <ApercuSimulation resultat={resultat} ajustement={charge.ajustement} surAchat clientsEstimes={clientsEstimes} />
      )}
      <ResultatApplication resultat={sim.application} sensible={sensible} onAnnule={() => onApplique?.()} />
    </div>
  );
}

/**
 * Fenêtre « Règles de prix » de TarifsPage.
 * props : open, onClose, sensible, tarifs, appleDevices, onApplique() (relecture des prix).
 */
export default function ReglesPrixPanel({ open, onClose, sensible = SANS_ELEVATION, tarifs = AUCUNE_LIGNE, appleDevices = AUCUNE_LIGNE, onApplique }) {
  const [onglet, setOnglet] = useState('marges');
  const onglets = [['marges', 'Marges'], ['ajustement', 'Ajustement global']];
  return (
    <FenetrePrix
      open={open}
      onClose={onClose}
      titre="Règles de prix"
      sousTitre="Rien n’est modifié sans aperçu « avant → après » ; les prix verrouillés ne bougent pas."
      icone={SlidersHorizontal}
      largeur="max-w-5xl"
    >
      <div role="tablist" aria-label="Règles de prix" className="flex gap-1 border-b border-slate-200 mb-4">
        {onglets.map(([v, l]) => (
          <button
            key={v}
            type="button"
            role="tab"
            id={`onglet-${v}`}
            aria-selected={onglet === v}
            aria-controls={`panneau-${v}`}
            tabIndex={onglet === v ? 0 : -1}
            onClick={() => setOnglet(v)}
            onKeyDown={(e) => clavierOnglets(e, onglets.map(([c]) => c), onglet, setOnglet)}
            className={`min-h-[44px] px-4 text-sm font-semibold border-b-2 -mb-px focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${onglet === v ? 'border-violet-700 text-violet-800' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
          >
            {l}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panneau-${onglet}`} aria-labelledby={`onglet-${onglet}`}>
        {onglet === 'marges'
          ? <OngletMarges sensible={sensible} onApplique={onApplique} />
          : <OngletAjustement sensible={sensible} onApplique={onApplique} tarifs={tarifs} appleDevices={appleDevices} />}
      </div>
    </FenetrePrix>
  );
}

// ─── Recalculer (TarifsPage) ──────────────────────
/**
 * « Recalculer les prix client » : aperçu du serveur (/simuler {}) à l'ouverture, puis
 * « Recalculer (N prix) » (POST /recalculate), désactivé sans aperçu ou quand rien ne change ; bilan et
 * annulation du lot. props : open, onClose, sensible, onApplique() (relecture des prix).
 */
export function FenetreRecalcul({ open, onClose, sensible = SANS_ELEVATION, onApplique }) {
  const toast = useToast();
  const [apercu, setApercu] = useState({ chargement: false, resultat: null, erreur: '' });
  const [confirme, setConfirme] = useState(false);
  const [execution, setExecution] = useState({ enCours: false, resultat: null, annule: false });

  const simuler = useCallback(async () => {
    setApercu({ chargement: true, resultat: null, erreur: '' });
    setConfirme(false);
    try {
      const resultat = await sensible(() => api.simulerPrix({}));
      setApercu({ chargement: false, resultat: resultat || {}, erreur: '' });
    } catch (e) {
      const msg = messageErreurPrix(e, 'Aperçu impossible');
      setApercu({ chargement: false, resultat: null, erreur: msg || 'Identification administrateur annulée : aucun aperçu.' });
    }
  }, [sensible]);

  useEffect(() => {
    if (!open) return;
    setExecution({ enCours: false, resultat: null, annule: false });
    simuler();
  }, [open, simuler]);

  const resultat = apercu.resultat;
  const modifies = Number(resultat?.modifies) || 0;
  const alertes = Number(resultat?.alertes) || 0;
  const pretARecalculer = !!resultat && modifies > 0 && !apercu.chargement && !execution.enCours && (alertes === 0 || confirme);

  async function recalculer() {
    setExecution({ enCours: true, resultat: null, annule: false });
    try {
      const res = await sensible(() => api.recalculerTarifs());
      setExecution({ enCours: false, resultat: res || {}, annule: false });
      const n = Number(res?.modifies) || 0;
      toast.success(n ? `${n} prix client recalculé${n > 1 ? 's' : ''}.` : 'Recalcul terminé : aucun prix n’a changé.');
      onApplique?.(res);
    } catch (e) {
      setExecution({ enCours: false, resultat: null, annule: false });
      const msg = messageErreurPrix(e, 'Recalcul impossible');
      if (msg) toast.error(msg);
    }
  }

  async function annulerRecalcul() {
    const lot = execution.resultat?.lot_id;
    if (!lot) return;
    setExecution((x) => ({ ...x, enCours: true }));
    try {
      const res = await sensible(() => api.annulerLotPrix(lot));
      const m = messageAnnulation(res, { sujet: 'Recalcul annulé' });
      setExecution((x) => ({ ...x, enCours: false, annule: m }));
      if (m.ton === 'warning') toast.warning(m.texte); else toast.success(m.texte);
      onApplique?.();
    } catch (e) {
      setExecution((x) => ({ ...x, enCours: false }));
      const msg = messageErreurPrix(e, 'Annulation impossible');
      if (msg) toast.error(msg);
    }
  }

  const fait = execution.resultat;
  const pied = fait ? (
    <div className="flex justify-end">
      <button type="button" onClick={onClose} disabled={execution.enCours} className="min-h-[44px] px-4 rounded-lg bg-violet-700 text-white font-semibold hover:bg-violet-800 disabled:opacity-60">Fermer</button>
    </div>
  ) : (
    <div className="space-y-2">
      {resultat && alertes > 0 && modifies > 0 && <ConfirmationAlertes alertes={alertes} confirme={confirme} onConfirme={setConfirme} />}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onClose} disabled={execution.enCours} className="min-h-[44px] px-4 rounded-lg border border-slate-300 bg-white font-semibold hover:bg-slate-50">Annuler</button>
        <button
          type="button"
          onClick={recalculer}
          disabled={!pretARecalculer}
          className="min-h-[44px] px-4 rounded-lg bg-violet-700 text-white font-semibold hover:bg-violet-800 inline-flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:text-slate-600"
        >
          {execution.enCours && <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />}
          {resultat ? (modifies > 0 ? `Recalculer (${modifies} prix)` : 'Rien à recalculer') : 'Recalculer'}
        </button>
      </div>
    </div>
  );

  return (
    <FenetrePrix
      open={open}
      onClose={onClose}
      titre="Recalculer les prix client"
      sousTitre="À partir des prix d’achat HT et des règles de prix actuelles. Aperçu avant tout changement."
      icone={Calculator}
      largeur="max-w-4xl"
      bloquer={execution.enCours}
      pied={pied}
    >
      {fait ? (
        <div role="status" className={`rounded-xl border p-3 text-sm ${execution.annule?.ton === 'warning' ? 'border-amber-400 bg-amber-50 text-amber-950' : execution.annule ? 'border-slate-300 bg-slate-50 text-slate-900' : 'border-emerald-300 bg-emerald-50 text-emerald-950'}`}>
          <p className="font-semibold">{execution.annule ? (execution.annule.ton === 'warning' ? execution.annule.texte : 'Recalcul annulé.') : 'Recalcul terminé.'}</p>
          {!execution.annule && (
            <ul className="mt-1 space-y-0.5">
              <li><strong>{Number(fait.modifies) || 0}</strong> prix modifiés</li>
              <li><strong>{Number(fait.inchanges) || 0}</strong> inchangés</li>
              {Number(fait.verrouilles) > 0 && <li><strong>{fait.verrouilles}</strong> verrouillés, non modifiés</li>}
              {Number(fait.sans_prix_achat ?? (fait.verrouilles == null ? fait.ignores : 0)) > 0 && (
                <li><strong>{fait.sans_prix_achat ?? fait.ignores}</strong> sans prix d’achat, ignorés</li>
              )}
            </ul>
          )}
          {!execution.annule && fait.lot_id && (
            <button type="button" onClick={annulerRecalcul} disabled={execution.enCours}
              className="mt-2 min-h-[44px] px-3 rounded-lg border border-emerald-400 bg-white font-semibold text-emerald-900 hover:bg-emerald-100 inline-flex items-center gap-2 disabled:opacity-60">
              {execution.enCours ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <History className="w-4 h-4" aria-hidden="true" />}
              Annuler ce recalcul
            </button>
          )}
        </div>
      ) : (
        <div>
          <ul className="text-sm text-slate-800 space-y-1 list-disc pl-5">
            <li>Prix client = prix d’achat HT × TVA + marge, arrondi au 9.</li>
            <li>Les prix verrouillés et les pièces sans prix d’achat ne bougent pas ; les tickets déjà créés gardent leur prix.</li>
          </ul>
          {apercu.chargement && (
            <p role="status" className="mt-4 py-6 text-center text-sm text-slate-600 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> Calcul de l’aperçu…
            </p>
          )}
          {apercu.erreur && (
            <div role="alert" className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 flex flex-wrap items-center gap-2">
              <span className="flex-1">{apercu.erreur}</span>
              <button type="button" onClick={simuler} className="min-h-[44px] px-3 rounded-lg font-semibold hover:bg-red-100">Réessayer</button>
            </div>
          )}
          {resultat && <ApercuSimulation resultat={resultat} titre="Ce que le recalcul changerait" />}
          {resultat && modifies === 0 && (
            <p className="mt-2 text-sm font-semibold text-emerald-900">Tous les prix client suivent déjà les règles : rien à recalculer.</p>
          )}
        </div>
      )}
    </FenetrePrix>
  );
}

// ─── Ajouter une pièce (TarifsPage) ───────────────
const TYPES_PIECE_SAISIE = ['Ecran', 'Batterie', 'Connecteur de charge', 'Camera arriere', 'Vitre arriere', 'Haut-parleur', 'Ecouteur interne', 'Vitre camera arriere'];
const QUALITES_SAISIE = ['Original', 'Soft OLED', 'OLED', 'Incell', 'LCD', 'Reconditionnee', 'Compatible'];
const CATEGORIES_ECRAN = [['standard', 'Standard'], ['haut_de_gamme', 'Haut de gamme'], ['pliant', 'Pliant']];

/**
 * Saisie d'une pièce absente de la grille (source « manuel ») : HT → prix client calculé par les règles,
 * ou prix client fixé à la main (la pièce est alors verrouillée).
 * props : open, onClose, sensible, regles, catalogue (pièces existantes), initial { marque, modele }, onAjoute(ligne).
 */
const formulaireAjout = (initial) => ({
  marque: initial?.marque || '', modele: initial?.modele || '', type_piece: 'Ecran', qualite: '', categorie: 'standard', mode: 'ht', prix: '',
});

export function AjoutPiecePrix({ open, onClose, sensible = SANS_ELEVATION, regles = null, catalogue = AUCUNE_LIGNE, initial = null, onAjoute }) {
  const toast = useToast();
  const idBase = useId();
  // Préremplie dès le premier affichage (marque et modèle de la recherche) : jamais un formulaire vide
  // rempli un instant plus tard par un effet (saisie perdue, lecture d'un champ vide)
  const [form, setForm] = useState(() => formulaireAjout(initial));
  const ouverte = useRef(open);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');
  const [existante, setExistante] = useState(null);
  const [reglesLues, setReglesLues] = useState(null);

  // Règles en vigueur pour l'aperçu du prix client (lues avec le code admin si la page ne les a pas)
  useEffect(() => {
    if (!open || regles) return undefined;
    let actif = true;
    sensible(() => api.getReglesPrix()).then((r) => { if (actif) setReglesLues(r); }).catch(() => {});
    return () => { actif = false; };
  }, [open, regles, sensible]);

  // Réouverture (fermée puis rouverte) : on repart de la recherche du moment
  useEffect(() => {
    const rouverte = open && !ouverte.current;
    ouverte.current = open;
    if (!rouverte) return;
    setForm(formulaireAjout(initial));
    setErreur('');
    setExistante(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const marques = useMemo(() => [...new Set(catalogue.map((t) => t.marque).filter(Boolean))].sort(), [catalogue]);
  const types = useMemo(() => [...new Set([...TYPES_PIECE_SAISIE, ...catalogue.map((t) => t.type_piece).filter(Boolean)])], [catalogue]);
  const ecran = estEcran(form.type_piece);
  const montant = nombre(form.prix);
  const reglesConnues = !!(regles || reglesLues);
  const r = fusionnerRegles(regles || reglesLues);

  let erreurSaisie = '';
  if (!form.marque.trim() || !form.modele.trim() || !form.type_piece.trim()) erreurSaisie = 'Marque, modèle et pièce sont obligatoires.';
  else if (!Number.isFinite(montant) || montant <= 0) erreurSaisie = form.mode === 'ht' ? 'Saisissez le prix d’achat HT.' : 'Saisissez le prix client.';
  else if (form.mode === 'ht' && montant > 5000) erreurSaisie = 'Prix d’achat HT : 5 000 € au maximum.';
  else if (form.mode === 'client' && (!Number.isInteger(montant) || montant > 100000)) erreurSaisie = 'Prix client : un nombre entier d’euros.';

  const prixCalcule = reglesConnues && form.mode === 'ht' && Number.isFinite(montant) && montant > 0
    ? prixClientPiece(montant, form.type_piece, form.categorie, r) : null;
  const ipad = /ipad|macbook/i.test(form.modele);
  const maj = (champ) => (e) => { setForm((f) => ({ ...f, [champ]: e.target.value })); setErreur(''); setExistante(null); };

  async function enregistrer(e) {
    e?.preventDefault();
    if (erreurSaisie || envoi) return;
    setEnvoi(true);
    setErreur('');
    try {
      const corps = {
        marque: form.marque.trim(),
        modele: form.modele.trim(),
        type_piece: form.type_piece.trim(),
        qualite: form.qualite.trim() || null,
        categorie: ecran ? form.categorie : 'standard',
        ...(form.mode === 'ht' ? { prix_fournisseur_ht: montant } : { prix_client: montant }),
      };
      const ligne = await sensible(() => api.creerLignePrix(corps));
      const prixClient = ligne?.prix_client ?? (form.mode === 'ht' ? prixCalcule : montant);
      toast.success(`Pièce ajoutée : ${corps.marque} ${corps.modele} · ${corps.type_piece}${corps.qualite ? ` ${corps.qualite}` : ''} à ${prixClient} €.`);
      onAjoute?.(ligne || corps);
    } catch (err) {
      if (err?.status === 409 && (err?.code === 'piece_existante' || err?.detail?.code === 'piece_existante')) {
        setExistante({ marque: form.marque.trim(), modele: form.modele.trim() });
        setErreur('Cette pièce existe déjà dans la grille.');
      } else {
        const msg = messageErreurPrix(err, 'Pièce non ajoutée');
        if (msg) { setErreur(msg); toast.error(msg); }
      }
    } finally {
      setEnvoi(false);
    }
  }

  const champ = 'mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500';
  const pied = (
    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
      <button type="button" onClick={onClose} disabled={envoi} className="min-h-[44px] px-4 rounded-lg border border-slate-300 bg-white font-semibold hover:bg-slate-50">Annuler</button>
      <button
        type="button"
        onClick={enregistrer}
        disabled={!!erreurSaisie || envoi}
        className="min-h-[44px] px-4 rounded-lg bg-violet-700 text-white font-semibold hover:bg-violet-800 inline-flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:text-slate-600"
      >
        {envoi && <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />}
        Ajouter la pièce
      </button>
    </div>
  );

  return (
    <FenetrePrix
      open={open}
      onClose={onClose}
      titre="Ajouter une pièce"
      sousTitre="Pour un modèle absent de la grille : la pièce sera proposée sur les tickets."
      icone={PackagePlus}
      largeur="max-w-2xl"
      bloquer={envoi}
      pied={pied}
    >
      <form id={`${idBase}-form`} onSubmit={enregistrer} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor={`${idBase}-marque`} className="block text-sm font-semibold text-slate-800">Marque</label>
            <input id={`${idBase}-marque`} type="text" list={`${idBase}-marques`} value={form.marque} onChange={maj('marque')} maxLength={50} className={champ} autoComplete="off" />
            <datalist id={`${idBase}-marques`}>{marques.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
          <div>
            <label htmlFor={`${idBase}-modele`} className="block text-sm font-semibold text-slate-800">Modèle</label>
            <input id={`${idBase}-modele`} type="text" value={form.modele} onChange={maj('modele')} maxLength={100} placeholder="ex. Galaxy A12" className={champ} autoComplete="off" />
          </div>
          <div>
            <label htmlFor={`${idBase}-type`} className="block text-sm font-semibold text-slate-800">Pièce</label>
            <input id={`${idBase}-type`} type="text" list={`${idBase}-types`} value={form.type_piece} onChange={maj('type_piece')} maxLength={50} className={champ} autoComplete="off" />
            <datalist id={`${idBase}-types`}>{types.map((t) => <option key={t} value={t} />)}</datalist>
          </div>
          <div>
            <label htmlFor={`${idBase}-qualite`} className="block text-sm font-semibold text-slate-800">Qualité <span className="font-normal text-slate-600">(facultatif)</span></label>
            <input id={`${idBase}-qualite`} type="text" list={`${idBase}-qualites`} value={form.qualite} onChange={maj('qualite')} maxLength={50} className={champ} autoComplete="off" />
            <datalist id={`${idBase}-qualites`}>{QUALITES_SAISIE.map((q) => <option key={q} value={q} />)}</datalist>
          </div>
          {ecran && (
            <div>
              <label htmlFor={`${idBase}-categorie`} className="block text-sm font-semibold text-slate-800">Catégorie d’écran</label>
              <select id={`${idBase}-categorie`} value={form.categorie} onChange={maj('categorie')} className={champ}>
                {CATEGORIES_ECRAN.map(([v, l]) => <option key={v} value={v}>{reglesConnues ? `${l} (marge ${r.ecran[v]} €)` : l}</option>)}
              </select>
            </div>
          )}
        </div>

        <fieldset className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-sm font-bold text-slate-800">Prix</legend>
          <div className="flex flex-wrap gap-2">
            {[['ht', 'Prix d’achat HT (prix client calculé)'], ['client', 'Prix client fixé à la main']].map(([v, l]) => (
              <label key={v} className={`min-h-[44px] px-3 rounded-lg border inline-flex items-center gap-2 text-sm font-semibold cursor-pointer ${form.mode === v ? 'border-violet-600 bg-violet-50 text-violet-900' : 'border-slate-300 bg-white text-slate-800'}`}>
                <input type="radio" name={`${idBase}-mode`} value={v} checked={form.mode === v} onChange={maj('mode')} className="w-4 h-4 accent-violet-700" />
                {l}
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor={`${idBase}-prix`} className="block text-xs font-semibold text-slate-700">{form.mode === 'ht' ? 'Prix d’achat HT (€)' : 'Prix client (€)'}</label>
              <input id={`${idBase}-prix`} type="text" inputMode="decimal" value={form.prix} onChange={maj('prix')}
                className="mt-1 w-36 min-h-[44px] rounded-lg border border-slate-300 px-3 text-base font-semibold tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500" />
            </div>
            <p className="text-sm text-slate-800 pb-2" aria-live="polite">
              {form.mode === 'ht'
                ? (prixCalcule != null
                  ? <>Prix client : <strong className="text-lg">{prixCalcule} €</strong> ({String(montant).replace('.', ',')} × {String(r.tva).replace('.', ',')} + {ecran ? r.ecran[form.categorie] ?? r.ecran.standard : r.autre} €, arrondi au 9)</>
                  : 'Le prix client sera calculé avec vos marges.')
                : 'Prix fixé à la main : la pièce sera verrouillée (jamais modifiée par un import ou les règles).'}
            </p>
          </div>
        </fieldset>

        {ipad && (
          <p className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800">
            Les iPad et MacBook ont leur propre grille : pour eux, utilisez « Importer une liste de prix » (pièces iPad / MacBook).
          </p>
        )}
        {erreur && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 flex flex-wrap items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{erreur}</span>
            {existante && (
              <button type="button" onClick={() => onAjoute?.(existante)} className="min-h-[44px] px-3 rounded-lg border border-red-300 bg-white font-semibold hover:bg-red-100">
                Voir la pièce
              </button>
            )}
          </div>
        )}
        {!erreur && erreurSaisie && (form.prix || form.modele) && <p className="text-sm text-slate-600">{erreurSaisie}</p>}
        {/* Entrée dans un champ = « Ajouter la pièce » (le bouton visible est dans le pied de fenêtre) */}
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">Ajouter</button>
      </form>
    </FenetrePrix>
  );
}

/**
 * Ajustement d'une colonne d'une grille boutique (tarifs_reparation, iphone_tarifs, smartphones_tarifs).
 * props : open, onClose, sensible, cible, colonnes [{ key, label }], lignes [{ id, label, valeurs }] (lignes
 * affichées ; valeurs = { colonne: prix } : une case vide ou à 0 n'est jamais ajustée), verrouilles (Set d'ids exclus),
 * aEnregistrer { nombre, enregistrer() } (modifications pas encore enregistrées : l'ajustement relit la grille,
 * il reste bloqué tant qu'elles ne sont pas enregistrées), onApplique().
 */
export function AjustementColonne({ open, onClose, sensible = SANS_ELEVATION, cible, colonnes = AUCUNE_LIGNE, lignes = AUCUNE_LIGNE, verrouilles, titre, aEnregistrer = null, onApplique }) {
  const [colonne, setColonne] = useState(colonnes[0]?.key || '');
  const [type, setType] = useState('pct');
  const [valeur, setValeur] = useState('');
  const [enregistrement, setEnregistrement] = useState(false);
  const sim = useSimulation({ sensible, onApplique });

  useEffect(() => { if (open) { sim.reinitialiser(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!colonnes.some((c) => c.key === colonne)) setColonne(colonnes[0]?.key || ''); }, [colonnes, colonne]);

  const nonEnregistrees = Number(aEnregistrer?.nombre) || 0;
  const exclues = verrouilles instanceof Set ? verrouilles : new Set(verrouilles || []);
  const avecPrix = lignes.filter((l) => !l.valeurs || Number(l.valeurs[colonne]) > 0);
  const ids = avecPrix.map((l) => l.id).filter((id) => !exclues.has(id));
  const nbExclues = avecPrix.length - ids.length;
  const nbSansPrix = lignes.length - avecPrix.length;
  const verif = valeurAjustement(type, valeur);
  const charge = verif.valeur != null && colonne && ids.length && !nonEnregistrees
    ? { cible, filtre: { ids, colonne }, ajustement: { type, valeur: verif.valeur } }
    : null;
  const simulationValide = !!charge && sim.simulation?.cle === JSON.stringify(charge);
  const resultat = simulationValide ? sim.simulation.resultat : null;
  const libelleColonne = colonnes.find((c) => c.key === colonne)?.label || colonne;

  async function enregistrerAvant() {
    if (!aEnregistrer?.enregistrer) return;
    setEnregistrement(true);
    try { await aEnregistrer.enregistrer(); } finally { setEnregistrement(false); }
  }

  let erreur = '';
  if (nonEnregistrees) erreur = 'Enregistrez d’abord les modifications en cours.';
  else if (!ids.length) erreur = 'Aucune ligne à ajuster (toutes verrouillées ou filtrées).';
  else if (valeur.trim()) erreur = verif.erreur || '';

  return (
    <FenetrePrix
      open={open}
      onClose={onClose}
      titre={titre || 'Ajuster une colonne de prix'}
      sousTitre="Par exemple +5 % sur toutes les batteries. Aperçu obligatoire avant d’appliquer."
      icone={SlidersHorizontal}
    >
      {nonEnregistrees > 0 && (
        <div role="alert" className="mb-4 rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            {nonEnregistrees} ligne{nonEnregistrees > 1 ? 's' : ''} modifiée{nonEnregistrees > 1 ? 's' : ''} pas encore enregistrée{nonEnregistrees > 1 ? 's' : ''}.
          </p>
          <p className="mt-1">L’ajustement relit la grille : ces modifications seraient perdues. Enregistrez-les d’abord.</p>
          {aEnregistrer?.enregistrer && (
            <button
              type="button"
              onClick={enregistrerAvant}
              disabled={enregistrement}
              className="mt-2 min-h-[44px] px-4 rounded-lg bg-amber-700 text-white font-semibold hover:bg-amber-800 inline-flex items-center gap-2 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-800 focus-visible:ring-offset-2"
            >
              {enregistrement && <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />}
              Enregistrer {nonEnregistrees > 1 ? `les ${nonEnregistrees} modifications` : 'la modification'}
            </button>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="ajust-colonne" className="block text-sm font-semibold text-slate-800 mb-1">Colonne</label>
          <select
            id="ajust-colonne"
            value={colonne}
            onChange={(e) => setColonne(e.target.value)}
            className="w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            {colonnes.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div className="text-sm text-slate-700 sm:pt-6" aria-live="polite">
          <strong>{ids.length}</strong> ligne{ids.length > 1 ? 's' : ''} concernée{ids.length > 1 ? 's' : ''} (les lignes affichées)
          {nbExclues > 0 && <>, <strong>{nbExclues}</strong> verrouillée{nbExclues > 1 ? 's' : ''} exclue{nbExclues > 1 ? 's' : ''}</>}
          {nbSansPrix > 0 && <>, <strong>{nbSansPrix}</strong> sans prix dans cette colonne (ignorée{nbSansPrix > 1 ? 's' : ''})</>}.
        </div>
      </div>
      <div className="mt-4">
        <ChampAjustement type={type} valeur={valeur} onType={setType} onValeur={setValeur} idBase="ajust-colonne" />
      </div>
      <div className="mt-4">
        <BoutonsSimulation
          pret={!!charge}
          simulationValide={simulationValide}
          occupe={sim.occupe}
          erreur={erreur}
          libelleAppliquer={libelleApplication(resultat)}
          alertes={Number(resultat?.alertes) || 0}
          confirme={sim.confirme}
          onConfirme={sim.setConfirme}
          rien={!!resultat && !(Number(resultat.modifies) > 0)}
          onSimuler={() => charge && sim.simuler(charge)}
          onAppliquer={() => charge && sim.appliquer(charge)}
        />
      </div>
      {resultat && <ApercuSimulation resultat={resultat} titre={`Aperçu — ${libelleColonne}`} ajustement={charge.ajustement} />}
      <ResultatApplication resultat={sim.application} sensible={sensible} onAnnule={() => onApplique?.()} />
    </FenetrePrix>
  );
}

// ─── Cadenas des grilles boutique ─────────────────
// Les grilles boutique n'ont pas de colonne verrou : le cadenas est le paramètre partagé
// PRIX_LIGNES_VERROUILLEES ({ table: [ids] }), appliqué par le serveur (services/prix) : une ligne
// cadenassée est exclue des ajustements en %, des mises à jour en masse (/bulk) et des annulations
// d'historique (listée « verrouillée »). Le serveur accepte encore une saisie explicite sur la ligne ;
// ces écrans la bloquent tant que le cadenas est fermé (comme la suppression de la ligne).
export const PARAM_VERROUS_BOUTIQUE = 'PRIX_LIGNES_VERROUILLEES';
export const AIDE_VERROU_BOUTIQUE = {
  oui: 'Ligne protégée : prix exclus des ajustements en %, des mises à jour en masse et des annulations d’historique. Ouvrez le cadenas pour saisir un prix ou supprimer la ligne.',
  non: 'Protéger cette ligne : prix exclus des ajustements en %, des mises à jour en masse et des annulations d’historique ; saisie et suppression bloquées ici tant que le cadenas est fermé.',
  note: 'Cadenas = ligne protégée des ajustements en %, des mises à jour en masse et des annulations ; ouvrez-le pour saisir un prix sur la ligne.',
};

async function lireVerrous() {
  const params = await api.getConfig();
  const brut = Array.isArray(params) ? params.find((p) => p.cle === PARAM_VERROUS_BOUTIQUE)?.valeur : null;
  try {
    const v = JSON.parse(brut || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function useVerrousBoutique(table, sensible = SANS_ELEVATION) {
  const toast = useToast();
  const [verrouilles, setVerrouilles] = useState(() => new Set());
  const [enCours, setEnCours] = useState(null);

  useEffect(() => {
    let actif = true;
    lireVerrous()
      .then((tout) => { if (actif) setVerrouilles(new Set((tout[table] || []).map(Number))); })
      .catch(() => { /* lecture impossible : aucune ligne verrouillée affichée */ });
    return () => { actif = false; };
  }, [table]);

  const basculer = useCallback(async (id, nom) => {
    setEnCours(id);
    try {
      // Relecture juste avant l'écriture : un autre poste a pu verrouiller d'autres lignes
      const tout = await lireVerrous();
      const liste = new Set((tout[table] || []).map(Number));
      const verrouiller = !liste.has(Number(id));
      if (verrouiller) liste.add(Number(id)); else liste.delete(Number(id));
      const suivant = { ...tout, [table]: [...liste].sort((a, b) => a - b) };
      await sensible(() => api.setParam(PARAM_VERROUS_BOUTIQUE, JSON.stringify(suivant)));
      setVerrouilles(liste);
      toast.success(verrouiller
        ? `${nom || 'Ligne'} protégée : exclue des ajustements en %, des mises à jour en masse et des annulations.`
        : `${nom || 'Ligne'} n’est plus protégée : ses prix suivent de nouveau les ajustements et les mises à jour.`);
    } catch (e) {
      const msg = messageErreurPrix(e, 'Cadenas non enregistré');
      if (msg) toast.error(msg);
    } finally {
      setEnCours(null);
    }
  }, [table, sensible, toast]);

  return { verrouilles, basculer, enCours };
}
