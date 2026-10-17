import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, RotateCcw, Lock, AlertTriangle, ArrowRight, Inbox, ExternalLink, Undo2, Loader2, CheckCircle2 } from 'lucide-react';
import api from '../lib/api';
import { formatDateShort, formatPrix } from '../lib/utils';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useToast } from './Toast';
import { messageAnnulation } from './HistoriquePrix';

// Seuils par défaut des aperçus (services/prix.regles : variation_alerte_pct / variation_alerte_eur)
export const SEUILS_VARIATION = { pct: 25, eur: 30 };

/** Page admin qui héberge les propositions (route de ModelesSansPrixPage, onglet « propositions »). */
export const cheminPrixARevoir = (basePath = '/accueil', onglet = '') =>
  `${basePath}/prix-a-revoir${onglet ? `?onglet=${encodeURIComponent(onglet)}` : ''}`;

const nombre = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Écart d'une proposition : { eur, pct, alerte }. Alerte du serveur (alertes: ['variation'], seuils
 * réglés par le gérant) si fournie, sinon seuils par défaut (plus de 25 % ou de 30 €).
 */
export function ecartProposition(p, seuils = SEUILS_VARIATION) {
  const avant = nombre(p?.ancien_ht);
  const apres = nombre(p?.nouveau_ht);
  const eur = avant !== null && apres !== null ? Math.round((apres - avant) * 100) / 100 : null;
  const pct = eur !== null && avant > 0 ? Math.round((eur / avant) * 1000) / 10 : null;
  const calcul = (eur !== null && Math.abs(eur) > seuils.eur) || (pct !== null && Math.abs(pct) > seuils.pct);
  const alerte = typeof p?.alerte === 'boolean' ? p.alerte
    : Array.isArray(p?.alertes) && !p?.introuvable ? p.alertes.length > 0 : calcul;
  return { eur, pct, alerte };
}

/** Acceptable en lot : ni prix verrouillé, ni pièce disparue de la grille. */
const acceptable = (p) => !p?.verrou && !p?.introuvable;

/** Cochées par défaut pour l'acceptation en lot : acceptables et sans grosse variation. */
export function selectionParDefaut(liste, seuils = SEUILS_VARIATION) {
  return new Set((liste || []).filter(p => acceptable(p) && !ecartProposition(p, seuils).alerte).map(p => p.id));
}

const signe = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');
const formatEcart = (n) => `${signe(n)}${formatPrix(Math.abs(n))}`;

function messageErreur(err) {
  if (err?.code === 'admin_cancelled') return 'Identification administrateur annulée.';
  if (err?.status === 403) return 'Réservé au gérant (compte administrateur).';
  return err?.message || 'Propositions indisponibles.';
}

/**
 * Dernière acceptation (une à une ou en lot) : nombre de prix changés et annulation immédiate du lot
 * (POST /api/tarifs/historique/annuler-lot/{lot_id}, comme les autres écrans de prix).
 */
function BandeauLot({ lot, sensible, onAnnule, onFermer }) {
  const toast = useToast();
  const [annulation, setAnnulation] = useState(false);
  const [annule, setAnnule] = useState(null); // message de l'annulation ({ ton, texte }) une fois faite
  const annuler = async () => {
    if (annulation || annule) return;
    setAnnulation(true);
    try {
      const res = await sensible(() => api.annulerLotPrix(lot.lot_id));
      // Lignes verrouillées et prix modifiés depuis comptés à part ; propositions remises en attente ou annulées
      const m = messageAnnulation(res);
      setAnnule(m);
      if (m.ton === 'warning') toast.warning(m.texte); else toast.success(m.texte);
      onAnnule?.();
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(`Annulation impossible : ${err?.message || 'erreur inconnue'}`);
    } finally {
      setAnnulation(false);
    }
  };
  const n = lot.modifies;
  return (
    <div className={`sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm ${
      annule?.ton === 'warning' ? 'border-amber-400 bg-amber-50 text-amber-950'
        : annule ? 'border-slate-300 bg-slate-50 text-slate-800' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
      {annule?.ton === 'warning'
        ? <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
        : <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />}
      <p className="font-semibold flex-1 min-w-[12rem]">
        {annule ? annule.texte : `${n} prix mis à jour${lot.libelle ? ` : ${lot.libelle}` : ''}.`}
      </p>
      {!annule && (
        <button type="button" onClick={annuler} disabled={annulation} aria-busy={annulation || undefined}
          className="min-h-[44px] px-3 rounded-lg border border-emerald-400 bg-white font-semibold text-emerald-900 hover:bg-emerald-100 inline-flex items-center gap-2 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700">
          {annulation ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <Undo2 className="w-4 h-4" aria-hidden="true" />}
          Annuler ce changement
        </button>
      )}
      <button type="button" onClick={onFermer} aria-label="Masquer ce message"
        className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function AvantApres({ titre, avant, apres }) {
  const a = nombre(avant);
  const b = nombre(apres);
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">{titre}</p>
      <p className="text-sm text-slate-900 flex flex-wrap items-center gap-1">
        <span className="text-slate-600 line-through decoration-slate-400">{a !== null ? formatPrix(a) : '—'}</span>
        <ArrowRight className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
        <span className="sr-only">devient</span>
        <span className="font-bold">{b !== null ? formatPrix(b) : '—'}</span>
      </p>
    </div>
  );
}

/**
 * Propositions de mise à jour des prix nées des commandes de pièces (prix HT réellement payé) :
 * accepter ou refuser une à une ou en lot, avec l'ancien et le nouveau prix client.
 * `sensible` : partage l'identification admin de la page hôte (sinon celle du composant).
 */
export default function PropositionsPrix({ basePath = '/accueil', sensible: sensibleHote, onCompte, seuils = SEUILS_VARIATION }) {
  const titreId = useId();
  const toast = useToast();
  const propre = useAdminElevation();
  const sensible = sensibleHote || propre.sensible;
  const [etat, setEtat] = useState({ statut: 'chargement', liste: [], erreur: '' });
  const [coches, setCoches] = useState(() => new Set());
  const [occupe, setOccupe] = useState(() => new Set());
  const [lot, setLot] = useState(false);
  const [essai, setEssai] = useState(0);
  // Dernier lot accepté, annulable : { lot_id, modifies, libelle, n° (clé de remise à zéro du bandeau) }
  const [dernierLot, setDernierLot] = useState(null);

  // Compteur publié à l'hôte (badge d'onglet) sans recharger la liste à chaque rendu de l'hôte
  const onCompteRef = useRef(onCompte);
  onCompteRef.current = onCompte;

  useEffect(() => {
    let annule = false;
    setEtat(e => ({ ...e, statut: 'chargement', erreur: '' }));
    sensible(() => api.getPropositionsPrix({ statut: 'en_attente' }))
      .then((data) => {
        if (annule) return;
        const liste = (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []).filter(p => p && p.id != null);
        setEtat({ statut: 'pret', liste, erreur: '' });
        setCoches(selectionParDefaut(liste, seuils));
      })
      .catch((err) => {
        if (!annule) setEtat({ statut: 'erreur', liste: [], erreur: messageErreur(err) });
      });
    return () => { annule = true; };
  }, [sensible, essai, seuils]);

  useEffect(() => {
    if (etat.statut === 'pret') onCompteRef.current?.(etat.liste.length);
  }, [etat.statut, etat.liste.length]);

  const retirer = (ids) => {
    const set = new Set(ids);
    setEtat(e => ({ ...e, liste: e.liste.filter(p => !set.has(p.id)) }));
    setCoches(c => new Set([...c].filter(id => !set.has(id))));
  };

  const marquer = (ids, actif) => setOccupe(o => {
    const n = new Set(o);
    ids.forEach(id => (actif ? n.add(id) : n.delete(id)));
    return n;
  });

  const traiterUne = async (p, accepter) => {
    if (occupe.has(p.id)) return;
    marquer([p.id], true);
    try {
      const res = await sensible(() => (accepter ? api.accepterPropositionPrix(p.id) : api.refuserPropositionPrix(p.id)));
      retirer([p.id]);
      toast.success(accepter ? `Prix mis à jour : ${p.label || p.tarif_cle}` : 'Proposition refusée, prix inchangé');
      // Prix réellement changé (ecrit) : annulable depuis le bandeau
      if (accepter && res?.lot_id && res.ecrit !== false) {
        setDernierLot(l => ({ lot_id: res.lot_id, modifies: 1, libelle: p.label || p.tarif_cle || '', n: (l?.n || 0) + 1 }));
      }
    } catch (err) {
      if (err?.code === 'deja_traitee') {
        // Traitée depuis un autre poste : elle quitte la liste
        retirer([p.id]);
        toast.info(err.message || 'Proposition déjà traitée');
      } else if (err?.code !== 'admin_cancelled') {
        toast.error(messageErreur(err));
      }
    } finally {
      marquer([p.id], false);
    }
  };

  const ids = useMemo(() => etat.liste.filter(p => coches.has(p.id)).map(p => p.id), [etat.liste, coches]);

  const accepterLot = async () => {
    if (!ids.length || lot) return;
    setLot(true);
    try {
      const res = await sensible(() => api.accepterPropositionsPrix(ids));
      // Le serveur peut écarter des lignes (verrouillées, déjà traitées…) : seules les acceptées disparaissent
      const acceptees = Array.isArray(res?.acceptees) ? res.acceptees : ids;
      const verrouillees = Array.isArray(res?.verrouillees) ? res.verrouillees.length : 0;
      const ecartees = ids.length - acceptees.length;
      retirer(acceptees);
      const modifies = res?.modifies !== undefined && res?.modifies !== null && Number.isFinite(Number(res.modifies))
        ? Number(res.modifies) : acceptees.length;
      if (res?.lot_id && modifies > 0) {
        setDernierLot(l => ({ lot_id: res.lot_id, modifies, libelle: '', n: (l?.n || 0) + 1 }));
      }
      const detail = ecartees > 0
        ? ` · ${ecartees} non appliqué${ecartees > 1 ? 's' : ''}${verrouillees ? ` (dont ${verrouillees} verrouillé${verrouillees > 1 ? 's' : ''})` : ''}`
        : '';
      toast.success(`${acceptees.length} prix mis à jour${detail}`);
      // Lignes écartées : liste relue pour refléter l'état du serveur
      if (ecartees > 0) setEssai(n => n + 1);
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(messageErreur(err));
    } finally {
      setLot(false);
    }
  };

  const refuserLot = async () => {
    if (!ids.length || lot) return;
    if (typeof window !== 'undefined' && typeof window.confirm === 'function'
      && !window.confirm(`Refuser ${ids.length} proposition${ids.length > 1 ? 's' : ''} ? Les prix restent inchangés.`)) return;
    setLot(true);
    const faits = [];
    try {
      for (const id of ids) {
        await sensible(() => api.refuserPropositionPrix(id));
        faits.push(id);
      }
      toast.success(`${faits.length} proposition${faits.length > 1 ? 's' : ''} refusée${faits.length > 1 ? 's' : ''}`);
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(messageErreur(err));
    } finally {
      retirer(faits);
      setLot(false);
    }
  };

  const basculer = (id) => setCoches(c => {
    const n = new Set(c);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const { statut, liste, erreur } = etat;
  const nbAlertes = liste.filter(p => ecartProposition(p, seuils).alerte).length;

  return (
    <section aria-labelledby={titreId} className="space-y-4">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3">
        <div>
          <h2 id={titreId} className="text-lg font-display font-bold text-slate-900">
            Propositions de prix
            {statut === 'pret' && liste.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-brand-600 text-white text-xs font-bold align-middle">
                {liste.length}<span className="sr-only"> en attente</span>
              </span>
            )}
          </h2>
          <p className="text-sm text-slate-600">
            Nées du prix HT payé lors des commandes de pièces. Aucun prix ne change sans votre accord.
          </p>
        </div>
        {statut === 'pret' && liste.length > 0 && (
          <div className="flex flex-wrap gap-2 shrink-0">
            <button type="button" onClick={() => setCoches(selectionParDefaut(liste, seuils))}
              className="btn-secondary min-h-[44px] text-xs">
              Cocher hors alertes
            </button>
            <button type="button" onClick={refuserLot} disabled={!ids.length || lot}
              className="btn-secondary min-h-[44px] text-xs disabled:opacity-60">
              <X className="w-3.5 h-3.5" aria-hidden="true" /> Refuser la sélection ({ids.length})
            </button>
            <button type="button" onClick={accepterLot} disabled={!ids.length || lot} aria-busy={lot || undefined}
              className="btn-primary min-h-[44px] text-xs disabled:opacity-60">
              <Check className="w-3.5 h-3.5" aria-hidden="true" /> {lot ? 'Envoi…' : `Accepter la sélection (${ids.length})`}
            </button>
          </div>
        )}
      </div>

      {dernierLot && (
        <BandeauLot key={dernierLot.n} lot={dernierLot} sensible={sensible}
          onAnnule={() => setEssai(n => n + 1)} onFermer={() => setDernierLot(null)} />
      )}

      <div aria-live="polite" className="sr-only">
        {statut === 'chargement' ? 'Chargement des propositions…' : statut === 'pret' ? `${liste.length} proposition${liste.length > 1 ? 's' : ''} en attente` : ''}
      </div>

      {statut === 'chargement' ? (
        <ul className="space-y-2" aria-hidden="true">
          {[1, 2, 3].map(i => <li key={i} className="h-24 rounded-xl bg-slate-100 motion-safe:animate-pulse" />)}
        </ul>
      ) : statut === 'erreur' ? (
        <div className="card p-5 text-center space-y-3">
          <p className="text-sm text-red-700 font-medium" role="alert">{erreur}</p>
          <button type="button" onClick={() => setEssai(n => n + 1)} className="btn-secondary min-h-[44px] text-xs">
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Réessayer
          </button>
        </div>
      ) : liste.length === 0 ? (
        <div className="card p-8 text-center">
          <Inbox className="w-8 h-8 text-slate-400 mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-800">Aucune proposition en attente</p>
          <p className="text-xs text-slate-600 mt-1">Saisissez le prix HT payé à la création ou à la réception d’une commande de pièce.</p>
        </div>
      ) : (
        <>
          {nbAlertes > 0 && (
            <p className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{nbAlertes} grosse{nbAlertes > 1 ? 's' : ''} variation{nbAlertes > 1 ? 's' : ''} (plus de {seuils.pct} % ou {seuils.eur} €) : non cochée{nbAlertes > 1 ? 's' : ''} par défaut, à vérifier sur la facture.</span>
            </p>
          )}
          <ul className="space-y-2">
            {liste.map((p) => {
              const { eur, pct, alerte } = ecartProposition(p, seuils);
              const enCours = occupe.has(p.id) || lot;
              const caseId = `${titreId}-p${p.id}`;
              const raisonId = `${titreId}-r${p.id}`;
              const libelle = p.label || p.tarif_cle || `Proposition ${p.id}`;
              return (
                <li key={p.id}
                  className={`card p-3 sm:p-4 grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto] gap-x-2 gap-y-3 sm:items-center ${alerte ? 'border-amber-300 bg-amber-50/40' : ''}`}>
                  <label htmlFor={caseId} className="flex items-center justify-center w-11 h-11 -ml-1 cursor-pointer self-start sm:self-center">
                    <input id={caseId} type="checkbox" checked={coches.has(p.id)} onChange={() => basculer(p.id)}
                      disabled={!acceptable(p) || enCours}
                      aria-label={`Sélectionner ${libelle}${p.verrou ? ' (prix verrouillé)' : p.introuvable ? ' (pièce introuvable)' : ''}`}
                      aria-describedby={!acceptable(p) ? raisonId : undefined}
                      className="w-5 h-5 rounded border-slate-400 text-brand-600 focus:ring-brand-500 disabled:opacity-50" />
                  </label>
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 min-h-[44px] sm:min-h-0">
                      <p className="text-sm font-semibold text-slate-900">{libelle}</p>
                      {alerte && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[11px] font-bold">
                          <AlertTriangle className="w-3 h-3" aria-hidden="true" /> Grosse variation
                        </span>
                      )}
                      {p.verrou && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 text-[11px] font-bold">
                          <Lock className="w-3 h-3" aria-hidden="true" /> Prix verrouillé
                        </span>
                      )}
                      {p.introuvable && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-[11px] font-bold">
                          <AlertTriangle className="w-3 h-3" aria-hidden="true" /> Pièce introuvable
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-x-4 gap-y-2">
                      <AvantApres titre="Achat HT" avant={p.ancien_ht} apres={p.nouveau_ht} />
                      <AvantApres titre="Prix client" avant={p.ancien_client} apres={p.nouveau_client} />
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Écart HT</p>
                        <p className={`text-sm font-bold ${alerte ? 'text-amber-900' : 'text-slate-900'}`}>
                          {eur !== null ? formatEcart(eur) : '—'}
                          {pct !== null && <span className="whitespace-nowrap">{` (${signe(pct)}${Math.abs(pct).toLocaleString('fr-FR')} %)`}</span>}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Origine</p>
                        <p className="text-sm text-slate-800 truncate">
                          {p.ticket_code ? (
                            <Link to={`${basePath}/commandes?q=${encodeURIComponent(p.ticket_code)}`}
                              className="inline-flex items-center gap-1 min-h-[32px] font-mono text-brand-700 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                              {p.ticket_code} <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            </Link>
                          ) : (p.source === 'commande' || p.commande_id ? `Commande n° ${p.commande_id ?? '—'}` : (p.source || '—'))}
                          {p.le ? <span className="text-slate-600"> · {formatDateShort(p.le)}</span> : null}
                        </p>
                      </div>
                    </div>
                    {p.verrou && !p.introuvable && (
                      <p id={raisonId} className="text-xs text-slate-700">Prix fixé à la main : il n’est pas modifié automatiquement. Déverrouillez-le dans la grille pour appliquer ce prix.</p>
                    )}
                    {p.introuvable && (
                      <p id={raisonId} className="text-xs text-red-800">Cette pièce n’existe plus dans la grille : refusez la proposition.</p>
                    )}
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex sm:flex-col gap-2">
                    <button type="button" onClick={() => traiterUne(p, true)} disabled={enCours || !acceptable(p)}
                      aria-label={`Accepter le nouveau prix pour ${libelle}`}
                      aria-describedby={!acceptable(p) ? raisonId : undefined}
                      title={p.verrou ? 'Prix verrouillé : déverrouillez la pièce dans la grille' : p.introuvable ? 'Pièce introuvable dans la grille' : undefined}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1">
                      <Check className="w-4 h-4" aria-hidden="true" /> Accepter
                    </button>
                    <button type="button" onClick={() => traiterUne(p, false)} disabled={enCours}
                      aria-label={`Refuser la proposition pour ${libelle}`}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-slate-100 text-slate-800 text-sm font-semibold hover:bg-slate-200 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                      <X className="w-4 h-4" aria-hidden="true" /> Refuser
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {!sensibleHote && propre.adminPrompt}
    </section>
  );
}
