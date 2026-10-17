import { Suspense, lazy, useCallback, useId, useMemo, useRef, useState } from 'react';
import api from '../lib/api';
import { useApi } from '../hooks/useApi';
import { useSmsServeur } from '../hooks/useSmsServeur';
import { formatDateShort, formatPrix } from '../lib/utils';
import { libelleJoignable, appliquerContact } from '../lib/contact';
import {
  ORDRES, SEUILS_ATTENTE, appliquerRelance, badgeAttente, compterRelancesDues, delaiAbandon, filtrerEtagere,
  formatDelai, grouperParEmplacement, groupesEtagere, libelleRelances, listeEmplacements, miseEnDemeureProposee,
  situationAbandon, trierEtagere,
} from '../lib/etagere';
import EmplacementInput, { useEtagereConfig } from './EmplacementInput';
import RelanceClient from './RelanceClient';
import ContactClient from './ContactClient';
import {
  AlertTriangle, BellRing, Clock, FileWarning, PackageCheck, RefreshCw, Search, Send, X,
} from 'lucide-react';

const PrintPreview = lazy(() => import('./PrintPreview'));

// Filtre et tri côté serveur (services/etagere.py) : terminés puis rendus non payés, plus anciens d'abord
const PARAMS = { vue: 'a_recuperer', limit: 500 };
const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';
const CLE_ORDRE = 'kp_etagere_ordre';

function lireOrdre() {
  try {
    const v = localStorage.getItem(CLE_ORDRE);
    return ORDRES.some((o) => o.id === v) ? v : 'anciens';
  } catch {
    return 'anciens';
  }
}

function appareil(t) {
  const modele = t.modele && t.modele !== 'Autre' ? t.modele : t.modele_autre;
  return [t.marque, modele].filter((v) => String(v ?? '').trim()).join(' ') || t.categorie || 'Appareil';
}

function pluriel(n, mot, motPluriel = `${mot}s`) {
  return `${n} ${n > 1 ? motPluriel : mot}`;
}

function Ligne({
  t, impaye, delai, seuilCourrier, basePath, onOpenTicket, onRemettre, emplacements, smsServeur,
  relanceOuverte, onOuvrirRelance, onRelance, onContacte, onEmplacement, onMiseEnDemeure,
}) {
  const panneauId = useId();
  const boutonRef = useRef(null);
  const badge = badgeAttente(t.jours_attente);
  const abandon = impaye ? null : situationAbandon(t.jours_attente, delai);
  const client = `${t.client_prenom || ''} ${t.client_nom || ''}`.trim() || 'Client';
  const code = t.ticket_code || `#${t.id}`;
  const reste = Number(t.reste_du) || 0;
  const action = impaye ? (reste > 0 ? 'Encaisser' : 'Ouvrir') : 'Remettre';
  const relances = libelleRelances(t.nb_relances, t.derniere_relance, formatDateShort);
  const aRelancer = !impaye && Boolean(t.relance_due);
  // « 06 12 34 56 78 (autre numéro) » quand le client se joint sur son second numéro
  const tel = libelleJoignable(t);

  const fermerRelance = () => {
    onOuvrirRelance(null);
    requestAnimationFrame(() => boutonRef.current?.focus());
  };

  return (
    <li className="px-4 sm:px-5 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 sm:items-center">
        {/* Étiquette d'étagère : emplacement en gros, ancienneté dessous (J+N : fonds -100 conservés) */}
        <div className="flex min-w-[4.5rem] max-w-[7.5rem] shrink-0 flex-col items-stretch gap-1.5">
          {!impaye && (
            <EmplacementInput compact ticketId={t.id} value={t.emplacement} emplacements={emplacements}
              onSaved={(v) => onEmplacement(t.id, v)} />
          )}
          {badge ? (
            <span className={`inline-flex items-center justify-center rounded-lg px-2 py-1 t-mono text-sm font-bold ${badge.classe}`}>
              <span aria-hidden="true">{badge.label}</span>
              <span className="sr-only">Réparation terminée depuis {pluriel(badge.jours, 'jour')}</span>
            </span>
          ) : (
            <span className="inline-flex items-center justify-center rounded-lg bg-slate-100 px-2 py-1 t-mono text-sm text-slate-700">
              <span aria-hidden="true">J+?</span><span className="sr-only">Date de fin de réparation inconnue</span>
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 basis-40 flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="min-w-0 flex-1 basis-48">
            <p className="flex flex-wrap items-center gap-x-2 text-sm">
              <a href={`${basePath}/ticket/${t.id}`}
                onClick={(e) => {
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  onOpenTicket(t.id);
                }}
                className={`-my-1.5 inline-flex min-h-[44px] items-center rounded t-mono font-bold text-brand-700 hover:underline ${FOCUS_RING}`}>
                {code}
              </a>
              <span className="min-w-0 truncate font-semibold text-slate-900">{client}</span>
              {tel && <span className="t-small tabular-nums">{tel}</span>}
            </p>
            <p className="truncate t-small">
              {appareil(t)}{t.fin_reparation ? ` · terminé le ${formatDateShort(t.fin_reparation)}` : ''}
            </p>
            {relances && (
              <p className="mt-0.5 flex items-center gap-1 t-caption text-slate-600">
                <BellRing className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                <span>{relances}</span>
              </p>
            )}
            {/* Client contacté depuis la fin de réparation (même vérité que le dashboard et le scan) */}
            <ContactClient ticket={t} taille="ligne" className="mt-0.5 -mb-1.5"
              onContacte={(contact) => onContacte(t.id, contact)} />
          </div>
          {(aRelancer || impaye || abandon?.atteint || reste > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {aRelancer && (
                <span className="badge badge-brand">
                  <BellRing className="h-3.5 w-3.5" aria-hidden="true" /> Relance à faire
                </span>
              )}
              {impaye ? (
                <span className={`text-sm font-bold tabular-nums ${reste > 0 ? 'text-red-700' : 'text-slate-600'}`}>
                  {reste > 0 ? `Reste ${formatPrix(reste)}` : 'Rien à payer'}
                </span>
              ) : abandon?.atteint ? (
                <span className="badge badge-danger">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Délai d’abandon atteint
                </span>
              ) : null}
              {!impaye && reste > 0 && (
                <span className="text-sm font-bold tabular-nums text-red-700">Reste {formatPrix(reste)}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {!impaye && (
            <button ref={boutonRef} type="button"
              onClick={() => (relanceOuverte ? fermerRelance() : onOuvrirRelance(t.id))}
              aria-expanded={relanceOuverte}
              aria-controls={relanceOuverte ? panneauId : undefined}
              aria-label={`Relancer ${code}`}
              className={`btn-secondary flex-1 sm:flex-none ${
                relanceOuverte ? 'border-brand-300 bg-brand-50 text-brand-700 hover:border-brand-300 hover:bg-brand-50' : ''
              }`}>
              <Send aria-hidden="true" /> Relancer
            </button>
          )}
          {!impaye && miseEnDemeureProposee(t, seuilCourrier) && (
            <button type="button" onClick={() => onMiseEnDemeure(t)}
              aria-label={`Courrier de mise en demeure ${code}`}
              className="btn-secondary flex-1 sm:flex-none text-red-700 hover:border-red-200 hover:bg-red-50">
              <FileWarning aria-hidden="true" />
              <span className="sm:hidden">Courrier</span>
              <span className="hidden sm:inline">Mise en demeure</span>
            </button>
          )}
          <button type="button" onClick={() => onRemettre(t)}
            aria-label={`${action} ${code}`}
            className={`flex-1 sm:flex-none ${action === 'Ouvrir' ? 'btn-secondary' : 'btn-success'}`}>
            {action}
          </button>
        </div>
      </div>
      {relanceOuverte && (
        <RelanceClient id={panneauId} ticket={t} smsServeur={smsServeur}
          onCancel={fermerRelance}
          onDone={(res, canal, contact) => { onRelance(t.id, res, canal, contact); fermerRelance(); }} />
      )}
    </li>
  );
}

function Liste({ tickets, ligne }) {
  return (
    <ul className="divide-y divide-slate-100">
      {tickets.map((t) => ligne(t))}
    </ul>
  );
}

function Groupe({ titre, aide, tickets, parEmplacement = false, ligne }) {
  const titreId = useId();
  if (!tickets.length) return null;
  return (
    <section aria-labelledby={titreId}>
      <h3 id={titreId} className="sticky top-0 z-[1] bg-slate-50 px-4 sm:px-5 py-2 text-[13px] font-semibold text-slate-700 border-b border-slate-100">
        {titre} <span className="font-normal text-slate-500">— {aide}</span>
      </h3>
      {parEmplacement ? grouperParEmplacement(tickets).map((g) => (
        <div key={g.emplacement ?? '∅'} role="group"
          aria-label={g.emplacement ? `Emplacement ${g.emplacement}` : 'Sans emplacement'}>
          <p className="flex items-center gap-2 border-t border-slate-100 bg-white px-4 sm:px-5 pt-2 text-xs font-semibold text-slate-700">
            {g.emplacement
              ? <span className="rounded-lg bg-slate-900 px-2 py-0.5 t-mono text-xs text-white">{g.emplacement}</span>
              : <span>Sans emplacement</span>}
            <span className="font-normal text-slate-500">{pluriel(g.tickets.length, 'appareil')}</span>
          </p>
          <Liste tickets={g.tickets} ligne={ligne} />
        </div>
      )) : <Liste tickets={tickets} ligne={ligne} />}
    </section>
  );
}

/** Étagère « À récupérer » : ouverte par la carte KPI du dashboard. */
export default function EtagereARecuperer({ id, basePath, onOpenTicket, onRemettre, onClose }) {
  const titreId = useId();
  const rechercheId = useId();
  const { data, error, loading, isRevalidating, mutate } = useApi(
    'dashboard:a_recuperer',
    () => api.getDashboard(PARAMS),
    { tags: ['dashboard', 'tickets'], ttl: 45_000 },
  );
  const config = useEtagereConfig();
  const { actif: smsServeur } = useSmsServeur();
  const [ordre, setOrdre] = useState(lireOrdre);
  const [recherche, setRecherche] = useState('');
  const [relanceOuverte, setRelanceOuverte] = useState(null);
  const [courrier, setCourrier] = useState(null);

  const delai = delaiAbandon(data, config);
  const emplacements = useMemo(() => listeEmplacements(config), [config]);
  const { enBoutique, impayes } = groupesEtagere(data?.tickets);
  const recus = data?.tickets?.length || 0;
  const total = typeof data?.total === 'number' ? data.total : recus;
  const aRelancer = compterRelancesDues(enBoutique);
  const enBoutiqueVus = trierEtagere(filtrerEtagere(enBoutique, recherche), ordre);
  const impayesVus = filtrerEtagere(impayes, recherche);
  const filtre = recherche.trim() !== '';

  const choisirOrdre = (v) => {
    setOrdre(v);
    try { localStorage.setItem(CLE_ORDRE, v); } catch { /* stockage indisponible */ }
  };

  // Mise à jour d'une seule ligne, sans recharger l'étagère
  const majTicket = useCallback((ticketId, maj) => {
    mutate((prev) => (prev?.tickets
      ? { ...prev, tickets: prev.tickets.map((x) => (x.id === ticketId ? maj(x) : x)) }
      : prev));
  }, [mutate]);
  // Relance tracée : compteur et date, plus le contact du canal (le serveur a noté la même chose)
  const onRelance = useCallback((ticketId, res, canal, contact) => majTicket(ticketId, (x) => ({
    ...appliquerRelance(x, res),
    contact: contact || (canal ? appliquerContact(x.contact, canal) : x.contact),
  })), [majTicket]);
  // « Contacté par tél. » depuis la ligne : un appel compte comme une relance sur l'étagère
  const onContacte = useCallback((ticketId, contact) => majTicket(ticketId, (x) => ({
    ...appliquerRelance(x, null), contact,
  })), [majTicket]);
  const onEmplacement = useCallback((ticketId, v) => majTicket(ticketId, (x) => ({ ...x, emplacement: v })), [majTicket]);

  const documents = useMemo(() => (courrier ? [{
    id: 'mise_en_demeure',
    label: 'Mise en demeure',
    desc: 'Courrier A4 au client',
    icon: FileWarning,
    formats: {
      a4: {
        paper: 'a4',
        label: 'A4',
        load: (signal) => api.getMiseEnDemeureHtml(courrier.id, { signal }).then((html) => ({ kind: 'html', html })),
      },
    },
  }] : []), [courrier]);

  const props = {
    delai, seuilCourrier: config?.mise_en_demeure_jours, basePath, onOpenTicket, onRemettre, emplacements, smsServeur,
    onOuvrirRelance: setRelanceOuverte, onRelance, onContacte, onEmplacement, onMiseEnDemeure: setCourrier,
  };
  const ligne = (impaye) => (t) => (
    <Ligne key={t.id} t={t} impaye={impaye} relanceOuverte={relanceOuverte === t.id} {...props} />
  );

  return (
    <section id={id} aria-labelledby={titreId} aria-busy={loading || isRevalidating}
      className="card mb-6 overflow-hidden motion-safe:animate-in">
      <div className="border-b border-slate-100 px-4 sm:px-5 py-3 sm:py-4">
        <div className="flex items-center gap-3">
          <div className="kpi-icon bg-emerald-50 text-emerald-700" aria-hidden="true">
            <PackageCheck />
          </div>
          <h2 id={titreId} className="min-w-0 flex-1 t-h2">À récupérer</h2>
          <button type="button" onClick={() => mutate()} aria-label="Rafraîchir l’étagère" className="btn-ghost btn-icon">
            <RefreshCw className={isRevalidating ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
          </button>
          <button type="button" onClick={onClose} aria-label="Fermer l’étagère À récupérer" className="btn-ghost btn-icon">
            <X aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          {data
            ? `${pluriel(enBoutique.length, 'appareil réparé', 'appareils réparés')} en boutique · `
              + `${pluriel(impayes.length, 'rendu non payé', 'rendus non payés')}`
              + `${total > recus ? ` (${recus} premiers sur ${total})` : ''}`
              + ' — du plus ancien au plus récent depuis la fin de réparation.'
            : 'Chargement…'}
          {data && aRelancer > 0 && ' '}
          {data && aRelancer > 0 && (
            <strong className="font-semibold text-brand-700">
              {pluriel(aRelancer, 'relance à faire', 'relances à faire')}.
            </strong>
          )}
        </p>
        <p className="mt-1 flex items-start gap-1.5 t-caption">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Délai d’abandon : {formatDelai(delai)} après la fin de réparation, puis vente seulement sur
            autorisation du juge (loi du 31 décembre 1903). Couleurs à partir de {SEUILS_ATTENTE.map((s) => `J+${s}`).join(', ')}.
          </span>
        </p>

        <p role="status" className="sr-only">
          {filtre ? pluriel(enBoutiqueVus.length + impayesVus.length, 'appareil trouvé', 'appareils trouvés') : ''}
        </p>
        {recus > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-56">
              <label htmlFor={rechercheId} className="sr-only">Chercher dans l’étagère</label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              <input id={rechercheId} type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)}
                placeholder="Emplacement, client, ticket…" autoComplete="off"
                onKeyDown={(e) => { if (e.key === 'Escape' && recherche) { e.stopPropagation(); setRecherche(''); } }}
                className="input min-h-11 pl-9" />
            </div>
            <div role="group" aria-label="Ordre de l’étagère" className="segmented">
              {ORDRES.map((o) => (
                <button key={o.id} type="button" aria-pressed={ordre === o.id} onClick={() => choisirOrdre(o.id)}
                  className={`segmented-item shrink-0 ${ordre === o.id ? 'segmented-item-active' : ''}`}>
                  {o.label}{o.id === 'relances' && aRelancer > 0 ? ` (${aRelancer})` : ''}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {!data && loading ? (
        <div className="divide-y divide-slate-100" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 sm:px-5 py-3">
              <div className="skeleton h-12 w-16" />
              <div className="flex-1 space-y-1.5">
                <div className="skeleton-line w-40" />
                <div className="skeleton h-3 w-56" />
              </div>
            </div>
          ))}
        </div>
      ) : error && !data ? (
        <div role="alert" className="p-4 sm:p-5">
          <div className="callout callout-danger items-center flex-wrap">
            <AlertTriangle aria-hidden="true" />
            <span className="flex-1">Étagère indisponible : {error.message || 'erreur réseau'}</span>
            <button type="button" onClick={() => mutate()} className="btn-secondary btn-sm">
              Réessayer
            </button>
          </div>
        </div>
      ) : recus === 0 ? (
        <p role="status" className="px-4 sm:px-5 py-8 text-center text-sm text-slate-500">
          Rien à récupérer : aucun appareil terminé ni rendu non payé.
        </p>
      ) : filtre && !enBoutiqueVus.length && !impayesVus.length ? (
        <p role="status" className="px-4 sm:px-5 py-8 text-center text-sm text-slate-500">
          Aucun appareil ne correspond à « {recherche.trim()} ».
        </p>
      ) : (
        <div className="max-h-[36rem] overflow-y-auto overscroll-contain">
          <Groupe titre="En boutique" aide="réparation terminée, client à prévenir ou à relancer"
            tickets={enBoutiqueVus} parEmplacement={ordre === 'emplacement'} ligne={ligne(false)} />
          <Groupe titre="Rendus non payés" aide="appareil rendu, reste à encaisser"
            tickets={impayesVus} ligne={ligne(true)} />
        </div>
      )}

      {courrier && (
        <Suspense fallback={null}>
          <PrintPreview open onClose={() => setCourrier(null)} title="Mise en demeure"
            subtitle={`${courrier.ticket_code || `#${courrier.id}`} · ${`${courrier.client_prenom || ''} ${courrier.client_nom || ''}`.trim() || 'Client'}`}
            documents={documents} />
        </Suspense>
      )}
    </section>
  );
}
