import { useEffect, useRef, useState } from 'react';
import { X, Printer, CheckCircle2, MapPin, Loader2, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import NoteInformation from '../NoteInformation';
import {
  CONSERVATION_JOURNAL_JOURS, CONSERVATION_POSITION_JOURS, GEO_OPTIONS, HORAIRES,
  ecrirePoste, lirePoste, POSTE_MAX,
} from '../../lib/pointage';
import { imprimerNote, parseDateServeur } from '../../lib/activiteEquipe';

const RAYON_MIN = 50;
const RAYON_MAX = 1000;

const message = (err, defaut) => (err?.code === 'admin_cancelled' ? '' : (err?.message || defaut));

function dateFr(d) {
  const date = parseDateServeur(d);
  return date
    ? date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' })
    : '';
}

/** Ligne d'état d'une remise : à jour, périmée (note modifiée depuis) ou jamais faite. */
export function etatRemise(x) {
  if (!x) return 'À remettre';
  if (x.a_jour) return `Remise le ${dateFr(x.remise_le)}${x.remise_par ? ` par ${x.remise_par}` : ''}`.trim();
  // Le serveur ne donne pas la date de modification de la note : celle de la remise situe la version
  if (x.remise_le) return `Version périmée : rayon modifié depuis la remise du ${dateFr(x.remise_le)}`;
  return 'À remettre';
}

/**
 * Fenêtre « Réglages » de la page Activité de l'équipe (admin seulement) : note d'information à
 * imprimer et à remettre, remise confirmée salarié par salarié (version en vigueur de la note),
 * interrupteur du pointage (bloqué tant que le serveur donne une raison), rayon, position de la
 * boutique, nom de ce poste, rappel des durées de conservation.
 * `sensible` : useAdminElevation (élévation redemandée si expirée).
 * `onInformationRemise(reglages)` : après chaque remise confirmée ou retirée, avec l'état renvoyé
 * par le serveur (la page parente rafraîchit son rappel).
 */
export default function ReglagesEquipe({ open, onFermer, sensible, onInformationRemise }) {
  const boite = useRef(null);
  useFocusTrap(boite, open, { onEscape: onFermer });

  const [etat, setEtat] = useState({ statut: 'chargement', r: null, erreur: '' });
  const [rayon, setRayon] = useState('');
  const [poste, setPoste] = useState(lirePoste);
  const [occupe, setOccupe] = useState('');
  const [retour, setRetour] = useState({ type: '', texte: '' });

  const charger = () => {
    setEtat((e) => ({ ...e, statut: 'chargement', erreur: '' }));
    sensible(() => api.getReglagesEquipe())
      .then((r) => {
        setEtat({ statut: 'pret', r: r || {}, erreur: '' });
        setRayon(String(r?.rayon_m ?? 150));
      })
      .catch((err) => setEtat({ statut: 'erreur', r: null, erreur: message(err, 'Réglages indisponibles.') || 'Réglages indisponibles.' }));
  };

  useEffect(() => {
    if (open) { charger(); setPoste(lirePoste()); setRetour({ type: '', texte: '' }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const r = etat.r || {};
  // Une ligne par salarié actif : { utilisateur, remise_le, remise_par, a_jour }
  const remises = Array.isArray(r.remises) ? r.remises : [];
  const manquants = remises.filter((x) => !x.a_jour);
  const perimes = manquants.filter((x) => x.remise_le);
  const noteRemise = remises.length ? manquants.length === 0 : Boolean(r.information_remise_le);
  const actif = Boolean(r.pointage_actif);
  // Pourquoi le pointage ne peut pas être activé (serveur : note non remise, position de la boutique
  // à confirmer) ; à défaut, la remise de la note seule
  const blocage = 'pointage_blocage' in r
    ? (r.pointage_blocage || '')
    : (noteRemise || remises.some((x) => x.a_jour) ? '' : 'Désactivé tant que la remise de la note d’information n’est pas confirmée.');
  const bloque = Boolean(blocage) && !actif;
  const remiseEnCours = occupe === 'remise' || occupe.startsWith('remise:');

  /** Appel « sensible » puis état renvoyé par le serveur fusionné ; `{ res }` ou null en cas d'échec.
   *  La page parente est prévenue dès que le serveur dit si la note est remise à tous (une remise,
   *  mais aussi un changement de rayon qui périme les confirmations). */
  const action = async (cle, fn, ok) => {
    setOccupe(cle);
    setRetour({ type: '', texte: '' });
    try {
      const res = await sensible(fn);
      setEtat((e) => ({ ...e, r: { ...e.r, ...(res && typeof res === 'object' ? res : {}), ...(ok?.patch || {}) } }));
      if (ok?.texte) setRetour({ type: 'ok', texte: ok.texte });
      if (typeof res?.information_remise === 'boolean') onInformationRemise?.(res);
      return { res };
    } catch (err) {
      const t = message(err, 'Enregistrement impossible.');
      if (t) setRetour({ type: 'erreur', texte: t });
      return null;
    } finally {
      setOccupe('');
    }
  };

  // Remise : mise à jour optimiste de la liste, puis état du serveur ; retour arrière en cas d'erreur
  const poserRemises = (noms, coche) => (liste) => liste.map((x) => {
    if (!noms.includes(x.utilisateur)) return x;
    return coche
      ? { ...x, a_jour: true, remise_le: x.a_jour ? x.remise_le : new Date().toISOString(), remise_par: x.a_jour ? x.remise_par : null }
      : { ...x, a_jour: false, remise_le: null, remise_par: null };
  });

  const confirmerRemise = async (nom, coche = true) => {
    const avant = etat.r;
    const noms = nom ? [nom] : remises.map((x) => x.utilisateur);
    setEtat((e) => ({ ...e, r: { ...e.r, remises: poserRemises(noms, coche)(e.r?.remises || []) } }));
    const fn = nom
      ? () => api.confirmerInformationRemise(coche ? { membres: [nom] } : { retirer: [nom] })
      : () => api.confirmerInformationRemise();
    const texte = nom
      ? (coche ? `Remise de la note à ${nom} enregistrée.` : `Remise de la note à ${nom} retirée.`)
      : 'Remise de la note enregistrée pour toute l’équipe.';
    const ok = await action(nom ? `remise:${nom}` : 'remise', fn, { texte });
    if (!ok) setEtat((e) => ({ ...e, r: avant }));
    else if (typeof ok.res?.information_remise !== 'boolean') onInformationRemise?.(null); // réponse sans état : « remise » supposée
  };

  const basculer = () => {
    if (bloque) return;
    action('actif', () => api.updateReglagesEquipe({ pointage_actif: !actif }), {
      patch: { pointage_actif: !actif },
      texte: !actif ? 'Pointage de présence activé.' : 'Pointage de présence désactivé.',
    });
  };

  const rayonNum = Number(rayon);
  const rayonValide = Number.isInteger(rayonNum) && rayonNum >= RAYON_MIN && rayonNum <= RAYON_MAX;
  const enregistrerRayon = (ev) => {
    ev.preventDefault();
    if (!rayonValide) return;
    action('rayon', () => api.updateReglagesEquipe({ rayon_m: rayonNum }), {
      patch: { rayon_m: rayonNum }, texte: `Rayon enregistré : ${rayonNum} m.`,
    });
  };

  const enregistrerBoutique = () => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : null;
    if (!geo?.getCurrentPosition) {
      setRetour({ type: 'erreur', texte: 'La position n’est pas disponible sur ce poste.' });
      return;
    }
    setOccupe('boutique');
    setRetour({ type: '', texte: '' });
    geo.getCurrentPosition(
      (p) => {
        setOccupe('');
        const precision = Math.max(0, Math.round(Number(p.coords.accuracy) || 0));
        action('boutique', () => api.enregistrerPositionBoutique(p.coords.latitude, p.coords.longitude, precision), {
          patch: { boutique_position_confirmee: true },
          texte: `Position de la boutique enregistrée (précision ± ${precision} m).`,
        });
      },
      (err) => {
        setOccupe('');
        setRetour({
          type: 'erreur',
          texte: err?.code === 1 ? 'Autorisez la position pour ce site dans le navigateur, puis recommencez.' : 'Position introuvable, réessayez.',
        });
      },
      GEO_OPTIONS,
    );
  };

  const enregistrerPoste = (ev) => {
    ev.preventDefault();
    const v = ecrirePoste(poste);
    setPoste(v);
    setRetour({ type: 'ok', texte: v ? `Ce poste s’appelle désormais « ${v} ».` : 'Nom du poste retiré.' });
  };

  return (
    <div className="modal-overlay" onClick={onFermer}>
      <div
        ref={boite}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reglages-equipe-titre"
        className="modal sm:max-w-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="reglages-equipe-titre" className="t-h3">Réglages — activité de l’équipe</h2>
          <button type="button" onClick={onFermer} className="btn-ghost btn-icon w-11 h-11 min-w-[44px]" aria-label="Fermer les réglages">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body space-y-5">
          {etat.statut === 'chargement' && (
            <p className="loading-inline" role="status"><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Chargement…</p>
          )}
          {etat.statut === 'erreur' && (
            <div className="callout callout-danger items-center" role="alert">
              <span className="flex-1">{etat.erreur}</span>
              <button type="button" className="btn-secondary btn-sm" onClick={charger}>Réessayer</button>
            </div>
          )}

          {etat.statut === 'pret' && (
            <>
              {/* 1. Note d'information : imprimer, puis cocher chaque salarié à qui elle a été remise */}
              <section aria-labelledby="reg-note" className="space-y-2">
                <h3 id="reg-note" className="t-label">1. Note d’information aux salariés</h3>
                <p className="text-[13px] text-slate-600">
                  À imprimer et remettre à chaque salarié avant toute activation (art. L1222-4 du Code du travail).
                  Cochez chaque salarié à qui la note a été remise.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn-secondary min-h-[44px]" onClick={() => imprimerNote(r.note || r.texte_note)}>
                    <Printer aria-hidden="true" /> Imprimer la note
                  </button>
                  {remises.length > 0 && (manquants.length ? (
                    <button type="button" className="btn-primary min-h-[44px]" onClick={() => confirmerRemise(null)} disabled={remiseEnCours}>
                      {occupe === 'remise' ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                      Tout confirmer
                    </button>
                  ) : (
                    <span className="badge badge-success badge-lg">
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                      Remise à {remises.length > 1 ? `tous les salariés (${remises.length})` : 'l’unique salarié'}
                    </span>
                  ))}
                </div>
                {perimes.length > 0 && (
                  <p className="callout callout-warning items-center gap-2 py-2 text-[13px]" role="status">
                    <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Le rayon a changé : réimprimez la note et remettez-la à nouveau.</span>
                  </p>
                )}
                {remises.length ? (
                  <ul aria-label="Remise de la note par salarié"
                    className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-[27.5rem] overflow-y-auto overscroll-contain">
                    {remises.map((x, i) => {
                      const id = `reg-remise-${i}`;
                      const perime = !x.a_jour && Boolean(x.remise_le);
                      return (
                        <li key={x.utilisateur} className="flex items-center gap-3 px-3 min-h-[44px]">
                          <input
                            id={id}
                            type="checkbox"
                            className="checkbox"
                            checked={Boolean(x.a_jour)}
                            disabled={occupe === 'remise' || occupe === `remise:${x.utilisateur}`}
                            onChange={(e) => confirmerRemise(x.utilisateur, e.target.checked)}
                            aria-label={`Note remise à ${x.utilisateur}`}
                            aria-describedby={`${id}-etat`}
                          />
                          <label htmlFor={id} className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-2 py-2 cursor-pointer text-[13px] leading-snug">
                            <span className="font-medium text-slate-900">{x.utilisateur}</span>
                            <span id={`${id}-etat`} className={perime ? 'text-amber-800' : x.a_jour ? 'text-slate-600' : 'text-slate-500'}>
                              {etatRemise(x)}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-[13px] text-slate-500">Aucun salarié actif dans l’équipe.</p>
                )}
                <details className="group rounded-lg border border-slate-200">
                  <summary className="cursor-pointer select-none min-h-[44px] flex items-center px-3 text-[13px] font-medium text-slate-700 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    Lire la note
                  </summary>
                  <div className="px-3 pb-3 max-h-64 overflow-y-auto">
                    <NoteInformation note={r.note} texte={r.texte_note} />
                  </div>
                </details>
              </section>

              {/* 2. Pointage de présence */}
              <section aria-labelledby="reg-pointage" className="space-y-3 border-t border-slate-100 pt-4">
                <h3 id="reg-pointage" className="t-label">2. Pointage de présence</h3>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p id="reg-pointage-label" className="text-sm font-medium text-slate-900">Vérifier la présence en boutique à la connexion</p>
                    <p id="reg-pointage-aide" className="text-[13px] text-slate-600">
                      {bloque
                        ? blocage
                        : `Une seule lecture par connexion, de ${HORAIRES.debut} h à ${HORAIRES.fin} h ${HORAIRES.jours}. Seuls le statut et la distance arrondie sont gardés.`}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={actif}
                    aria-labelledby="reg-pointage-label"
                    aria-describedby="reg-pointage-aide"
                    disabled={bloque || occupe === 'actif'}
                    onClick={basculer}
                    className="shrink-0 min-h-[44px] min-w-[52px] inline-flex items-center justify-center rounded-full
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed"
                  >
                    <span className={`relative inline-flex h-6 w-11 rounded-full transition-colors duration-150 motion-reduce:transition-none
                      ${actif ? 'bg-brand-600' : bloque ? 'bg-slate-300' : 'bg-slate-500'}`} aria-hidden="true">
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-150 motion-reduce:transition-none
                        ${actif ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                    </span>
                  </button>
                </div>

                <form className="flex flex-wrap items-end gap-2" onSubmit={enregistrerRayon}>
                  <div>
                    <label htmlFor="reg-rayon" className="input-label">Rayon autour de la boutique</label>
                    <div className="flex items-center gap-2">
                      <input id="reg-rayon" type="number" inputMode="numeric" min={RAYON_MIN} max={RAYON_MAX} step={10}
                        className="input w-28 min-h-[44px]" value={rayon} onChange={(e) => setRayon(e.target.value)}
                        aria-invalid={!rayonValide} aria-describedby="reg-rayon-aide" />
                      <span className="text-sm text-slate-600">m</span>
                    </div>
                  </div>
                  <button type="submit" className="btn-secondary min-h-[44px]" disabled={!rayonValide || occupe === 'rayon'}>Enregistrer</button>
                  <p id="reg-rayon-aide" className="basis-full text-xs text-slate-500">
                    Entre {RAYON_MIN} et {RAYON_MAX} m. Le rayon figure dans la note : le changer la rend à remettre.
                  </p>
                </form>

                <div className="flex flex-wrap items-center gap-2">
                  {r.boutique_position_confirmee
                    ? <span className="badge badge-success">Position de la boutique enregistrée</span>
                    : <span className="badge badge-warning">Position par défaut, à confirmer</span>}
                  <button type="button" className="btn-secondary min-h-[44px]" onClick={enregistrerBoutique} disabled={occupe === 'boutique'}>
                    {occupe === 'boutique' ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <MapPin aria-hidden="true" />}
                    Enregistrer la position de la boutique (depuis ce poste)
                  </button>
                </div>
              </section>

              {/* 3. Ce poste */}
              <section aria-labelledby="reg-poste" className="space-y-2 border-t border-slate-100 pt-4">
                <h3 id="reg-poste" className="t-label">3. Ce poste</h3>
                <form className="flex flex-wrap items-end gap-2" onSubmit={enregistrerPoste}>
                  <div className="flex-1 min-w-[12rem]">
                    <label htmlFor="reg-poste-nom" className="input-label">Nom de ce poste</label>
                    <input id="reg-poste-nom" className="input min-h-[44px]" value={poste} maxLength={POSTE_MAX}
                      placeholder="Comptoir, Atelier…" onChange={(e) => setPoste(e.target.value)} />
                  </div>
                  <button type="submit" className="btn-secondary min-h-[44px]">Enregistrer</button>
                </form>
                <p className="text-xs text-slate-500">Propre à ce navigateur ; repris dans le journal à chaque connexion.</p>
              </section>

              <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">
                Conservation : statut de présence {CONSERVATION_POSITION_JOURS} jours (2 mois), journal des connexions
                {' '}{CONSERVATION_JOURNAL_JOURS} jours (6 mois). La position exacte d’un salarié n’est jamais enregistrée.
                Demande d’accès d’un salarié : « Exporter » › son nom.
              </p>
            </>
          )}

          <p aria-live="polite" className={`text-sm ${retour.type === 'erreur' ? 'text-red-700' : 'text-emerald-700'} ${retour.texte ? '' : 'sr-only'}`}>
            {retour.texte}
          </p>
        </div>
      </div>
    </div>
  );
}
