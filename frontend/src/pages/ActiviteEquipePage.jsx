import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Download, Settings, RefreshCw, AlertTriangle, Loader2, MapPin,
} from 'lucide-react';
import api from '../lib/api';
import { useAdminElevation } from '../hooks/useAdminElevation';
import GrilleSemaine, { joursAffiches } from '../components/activite/GrilleSemaine';
import DetailJour from '../components/activite/DetailJour';
import ReglagesEquipe from '../components/activite/ReglagesEquipe';
import { IconesAppareils, PointPresence } from '../components/activite/Pastilles';
import {
  ajouterJours, heureParis, jourParis, libelleAppareil, libellePresence, libelleSemaine, lienCarte, lundiDe,
  STATUTS_PRESENCE,
} from '../lib/activiteEquipe';

/**
 * Activité de l'équipe (admin seulement, route sous <AG>) : qui est en ligne, heures d'arrivée et de
 * départ de la semaine, détail d'une journée au clic, export CSV (semaine ou un salarié : réponse à
 * une demande d'accès) et réglages dans une fenêtre. Une seule page, sans onglets.
 * Chaque lecture est tracée par le serveur : aucune actualisation automatique.
 */

const message = (err, defaut) => (err?.code === 'admin_cancelled' ? 'Code administrateur requis.' : (err?.message || defaut));

// Présence d'une journée : objet {statut, distance_m} ou champs à plat selon la réponse
function normaliserPresence(j) {
  const p = j?.presence;
  if (p && typeof p === 'object') return { statut: p.statut ?? p.geo_statut ?? null, distance_m: p.distance_m ?? p.geo_distance_m ?? null };
  if (typeof p === 'string') return { statut: p, distance_m: j.presence_distance_m ?? j.distance_m ?? null };
  return { statut: null, distance_m: null };
}

export function normaliserActivite(data) {
  const d = data && typeof data === 'object' ? data : {};
  const semaine = d.semaine || {};
  const jours = Array.isArray(semaine.jours) && semaine.jours.length
    ? semaine.jours
    : (semaine.debut ? Array.from({ length: 7 }, (_, i) => ajouterJours(semaine.debut, i)) : []);
  const salaries = (Array.isArray(d.salaries) ? d.salaries : []).map((s) => {
    const js = {};
    for (const [jour, j] of Object.entries(s?.jours || {})) {
      if (j) js[jour] = { ...j, presence: normaliserPresence(j) };
    }
    return { ...s, jours: js, total: s?.total || {} };
  });
  return {
    semaine: { debut: semaine.debut || jours[0], fin: semaine.fin || jours[6], jours, aujourdhui: semaine.aujourdhui || null },
    information_remise: Boolean(d.information_remise),
    connectes: Array.isArray(d.connectes) ? d.connectes : [],
    salaries,
  };
}

// Largeur du contenu et nombre de jours affichés (dimanche ou non) → grille complète, compacte, ou
// liste par salarié : aucun défilement horizontal, colonne des noms jamais rognée
export function modePour(largeur, nbJours = 6) {
  const septJours = nbJours > 6;
  if (largeur < (septJours ? 690 : 620)) return 'liste';
  if (largeur < (septJours ? 1060 : 1000)) return 'compact';
  return 'complet';
}

function useLargeurContenu(ref) {
  const [largeur, setLargeur] = useState(() => {
    if (typeof window === 'undefined' || !window.innerWidth) return 1200;
    const sidebar = window.innerWidth >= 1024 ? 320 : 32;
    return window.innerWidth - sidebar;
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const mesurer = () => { if (el.clientWidth) setLargeur(el.clientWidth); };
    mesurer();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return largeur;
}

function nomFichier(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'salarie';
}

// ─── En ligne maintenant ────────────────────────────────────────────────
// Une pastille par salarié (plusieurs appareils ouverts = une seule pastille), présence la plus parlante
const RANG_PRESENCE = { hors_boutique: 1, imprecise: 2, en_boutique: 3, refusee: 4, indisponible: 5, hors_horaires: 6 };

export function regrouperConnectes(connectes) {
  const parNom = new Map();
  for (const c of connectes || []) {
    const nom = c?.utilisateur || '?';
    const g = parNom.get(nom) || { utilisateur: nom, sessions: [] };
    g.sessions.push(c);
    parNom.set(nom, g);
  }
  return [...parNom.values()].map((g) => {
    const tri = [...g.sessions].sort((x, y) => String(x.debut || '').localeCompare(String(y.debut || '')));
    const parlant = g.sessions
      .filter((c) => RANG_PRESENCE[c.geo_statut])
      .sort((x, y) => RANG_PRESENCE[x.geo_statut] - RANG_PRESENCE[y.geo_statut])[0];
    const appareils = [];
    for (const c of tri) {
      const lib = libelleAppareil(c.appareil);
      if (!appareils.some((a) => libelleAppareil(a) === lib)) appareils.push(c.appareil || {});
    }
    const postes = [...new Set(tri.map((c) => c.poste).filter(Boolean))];
    return {
      utilisateur: g.utilisateur,
      depuis: tri[0]?.depuis || heureParis(tri[0]?.debut),
      appareils,
      postes,
      geo_statut: parlant?.geo_statut || null,
      geo_distance_m: parlant?.geo_distance_m ?? null,
      carte: lienCarte(parlant?.geo_lat, parlant?.geo_lng),
    };
  });
}

function EnLigne({ connectes }) {
  const groupes = regrouperConnectes(connectes);
  return (
    <section aria-labelledby="en-ligne-titre" className="flex flex-wrap items-center gap-x-3 gap-y-2 min-h-[36px]">
      <h2 id="en-ligne-titre" className="t-overline shrink-0">En ligne maintenant</h2>
      {groupes.length ? (
        <ul className="flex flex-wrap items-center gap-2">
          {groupes.map((g) => {
            const complet = [
              g.utilisateur,
              g.appareils.map(libelleAppareil).join(' / '),
              g.postes.length ? `poste ${g.postes.join(', ')}` : '',
              libellePresence(g.geo_statut, g.geo_distance_m),
              g.depuis ? `connecté depuis ${g.depuis}` : '',
            ].filter(Boolean).join(' · ');
            return (
              <li key={g.utilisateur} title={complet}
                className="inline-flex items-center gap-1.5 h-8 pl-1 pr-2.5 rounded-full bg-white border border-slate-200 text-[13px] text-slate-700">
                <span aria-hidden="true" className="grid place-items-center w-6 h-6 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold">
                  {g.utilisateur.trim().charAt(0).toUpperCase()}
                </span>
                <span aria-hidden="true" className="font-medium text-slate-900">{g.utilisateur}</span>
                <IconesAppareils appareils={g.appareils} />
                <PointPresence statut={g.geo_statut} distance={g.geo_distance_m} className="w-2.5 h-2.5" />
                {g.depuis && <span aria-hidden="true" className="text-slate-500 tabular-nums">depuis {g.depuis}</span>}
                <span className="sr-only">{complet}</span>
                {g.carte && (
                  <a href={g.carte} target="_blank" rel="noopener noreferrer"
                    className="-mr-1.5 grid place-items-center w-11 h-11 -my-1.5 rounded-full text-brand-700 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    aria-label={`Voir sur la carte où ${g.utilisateur} s’est connecté (s’ouvre dans un nouvel onglet)`}
                    title="Voir sur la carte">
                    <MapPin className="w-4 h-4" aria-hidden="true" />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[13px] text-slate-500">Personne n’est connecté</p>
      )}
    </section>
  );
}

// Légende des points de présence, sur la ligne « En ligne maintenant » (sans hauteur en plus)
const LEGENDE = [
  { statut: 'en_boutique', label: 'En boutique' },
  { statut: 'hors_boutique', label: 'Hors boutique' },
  { statut: 'imprecise', label: 'Imprécise' },
  { statut: 'refusee', label: 'Refusée / non vérifiée', title: 'Position refusée, indisponible ou hors des heures d’ouverture' },
];

function LegendePresence() {
  return (
    <ul aria-label="Légende des points de présence"
      className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-600">
      {LEGENDE.map(({ statut, label, title }) => (
        <li key={statut} className="inline-flex items-center gap-1.5 whitespace-nowrap" title={title}>
          <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${STATUTS_PRESENCE[statut].point}`} />
          {label}
        </li>
      ))}
    </ul>
  );
}

// ─── Menu d'export ──────────────────────────────────────────────────────
function MenuExport({ salaries, semaine, onExporter, occupe }) {
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef(null);
  const bouton = useRef(null);

  useEffect(() => {
    if (!ouvert) return undefined;
    const clic = (e) => { if (!zone.current?.contains(e.target)) setOuvert(false); };
    const touche = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOuvert(false); bouton.current?.focus(); }
    };
    document.addEventListener('mousedown', clic);
    document.addEventListener('keydown', touche, true);
    return () => { document.removeEventListener('mousedown', clic); document.removeEventListener('keydown', touche, true); };
  }, [ouvert]);

  const choisir = (opts) => { setOuvert(false); onExporter(opts); };

  return (
    <div className="relative" ref={zone}>
      <button ref={bouton} type="button" className="btn-secondary min-h-[44px]" aria-expanded={ouvert}
        aria-controls="menu-export" onClick={() => setOuvert((o) => !o)} disabled={occupe}>
        {occupe ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download aria-hidden="true" />}
        Exporter
      </button>
      {ouvert && (
        <div id="menu-export" className="absolute right-0 z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] card shadow-lg py-1">
          <button type="button" className="w-full min-h-[44px] px-3 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100"
            onClick={() => choisir({ depuis: semaine.debut, jusqua: semaine.fin })}>
            <span className="font-medium text-slate-900">{libelleSemaine(semaine.debut, semaine.fin)}</span>
            <span className="block text-xs text-slate-500">Toute l’équipe (CSV)</span>
          </button>
          {salaries.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-1 t-overline border-t border-slate-100 mt-1">Données d’un salarié (demande d’accès)</p>
              <ul className="max-h-60 overflow-y-auto">
                {salaries.map((s) => (
                  <li key={s.utilisateur}>
                    <button type="button" className="w-full min-h-[44px] px-3 text-left text-sm text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100"
                      onClick={() => choisir({ utilisateur: s.utilisateur })}>
                      {s.utilisateur} <span className="text-xs text-slate-500">— 6 derniers mois</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────
export default function ActiviteEquipePage() {
  const { sensible, adminPrompt } = useAdminElevation();
  const lundiCourant = lundiDe(jourParis());
  const [semaine, setSemaine] = useState(null); // null = semaine en cours (heure de Paris)
  const [etat, setEtat] = useState({ statut: 'chargement', data: null, erreur: '' });
  const [selection, setSelection] = useState(null);
  const [detail, setDetail] = useState({ statut: 'chargement', sessions: [], erreur: '' });
  const [reglages, setReglages] = useState(false);
  const [export_, setExport] = useState({ occupe: false, erreur: '' });
  const zone = useRef(null);
  const celluleRef = useRef(null);
  const selRef = useRef(null);
  const largeur = useLargeurContenu(zone);
  const demande = useRef(0);

  const charger = useCallback(() => {
    const n = ++demande.current;
    setEtat((e) => ({ ...e, statut: 'chargement', erreur: '' }));
    sensible(() => api.getActiviteEquipe(semaine || undefined))
      .then((d) => { if (n === demande.current) setEtat({ statut: 'pret', data: normaliserActivite(d), erreur: '' }); })
      .catch((err) => { if (n === demande.current) setEtat((e) => ({ ...e, statut: 'erreur', erreur: message(err, 'Activité indisponible.') })); });
  }, [semaine, sensible]);

  useEffect(() => { charger(); selRef.current = null; setSelection(null); }, [charger]);

  const chargerDetail = useCallback((sel) => {
    if (!sel) return;
    setDetail({ statut: 'chargement', sessions: [], erreur: '' });
    sensible(() => api.getSessionsEquipe(sel.utilisateur, sel.jour))
      .then((r) => {
        if (selRef.current !== sel) return;
        const sessions = Array.isArray(r) ? r : (Array.isArray(r?.sessions) ? r.sessions : []);
        setDetail({ statut: 'pret', sessions, erreur: '' });
      })
      .catch((err) => {
        if (selRef.current === sel) setDetail({ statut: 'erreur', sessions: [], erreur: message(err, 'Détail indisponible.') });
      });
  }, [sensible]);

  const choisir = (sel, el) => {
    if (selection && selection.utilisateur === sel.utilisateur && selection.jour === sel.jour) {
      fermerDetail();
      return;
    }
    celluleRef.current = el || null;
    selRef.current = sel;
    setSelection(sel);
    chargerDetail(sel);
  };

  const fermerDetail = useCallback(() => {
    selRef.current = null;
    setSelection(null);
    const el = celluleRef.current;
    if (el && document.contains(el)) el.focus({ preventScroll: true });
  }, []);

  const exporter = async (opts) => {
    setExport({ occupe: true, erreur: '' });
    const fichier = opts.utilisateur
      ? `connexions_${nomFichier(opts.utilisateur)}_${jourParis()}.csv`
      : `activite_equipe_${opts.depuis}.csv`;
    try {
      await sensible(() => api.exportActiviteEquipe(opts, fichier));
      setExport({ occupe: false, erreur: '' });
    } catch (err) {
      setExport({ occupe: false, erreur: message(err, 'Export impossible.') });
    }
  };

  const data = etat.data;
  const sem = data?.semaine?.debut ? data.semaine : {
    debut: semaine || lundiCourant, fin: ajouterJours(semaine || lundiCourant, 6),
    jours: Array.from({ length: 7 }, (_, i) => ajouterJours(semaine || lundiCourant, i)),
  };
  const lundiAffiche = semaine || sem.debut || lundiCourant;
  const estCourante = lundiAffiche >= lundiCourant;
  const libelle = libelleSemaine(sem.debut, sem.fin);
  const mode = modePour(largeur, data ? joursAffiches(data.semaine.jours, data.salaries).length : 6);

  return (
    <div className="page max-w-[1280px] lg:py-6">
      {adminPrompt}

      {data && !data.information_remise && (
        <div className="callout callout-warning items-center py-2 mb-3">
          <AlertTriangle aria-hidden="true" className="!mt-0" />
          <p className="flex-1 min-w-0">
            Pointage de présence désactivé : la remise de la note d’information aux salariés n’est pas confirmée.
          </p>
          <button type="button" className="btn-ghost btn-sm min-h-[44px] underline text-amber-900" onClick={() => setReglages(true)}>
            Ouvrir les réglages
          </button>
        </div>
      )}

      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
        <h1 className="t-h1 mr-auto">Activité de l’équipe</h1>
        <nav aria-label="Choix de la semaine" className="flex items-center gap-1">
          <button type="button" className="btn-ghost btn-icon w-11 h-11 min-w-[44px]" aria-label="Semaine précédente"
            onClick={() => setSemaine(ajouterJours(lundiAffiche, -7))}>
            <ChevronLeft aria-hidden="true" />
          </button>
          <p className="text-sm font-semibold text-slate-900 tabular-nums text-center min-w-[11.5rem]" aria-live="polite">{libelle}</p>
          <button type="button" className="btn-ghost btn-icon w-11 h-11 min-w-[44px]" aria-label="Semaine suivante"
            disabled={estCourante} onClick={() => setSemaine(ajouterJours(lundiAffiche, 7))}>
            <ChevronRight aria-hidden="true" />
          </button>
          {!estCourante && (
            <button type="button" className="btn-ghost btn-sm min-h-[44px]" onClick={() => setSemaine(null)}>Cette semaine</button>
          )}
        </nav>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost btn-icon w-11 h-11 min-w-[44px]" aria-label="Actualiser" title="Actualiser"
            onClick={charger} disabled={etat.statut === 'chargement'}>
            <RefreshCw className={etat.statut === 'chargement' ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
          </button>
          <MenuExport salaries={data?.salaries || []} semaine={sem} onExporter={exporter} occupe={export_.occupe} />
          <button type="button" className="btn-secondary btn-icon w-11 h-11 min-w-[44px]" aria-label="Réglages" title="Réglages"
            onClick={() => setReglages(true)}>
            <Settings aria-hidden="true" />
          </button>
        </div>
      </header>

      {export_.erreur && <p role="alert" className="mb-2 text-sm text-red-700">{export_.erreur}</p>}

      <div ref={zone} className="min-w-0">
        {etat.statut === 'erreur' && !data && (
          <div className="callout callout-danger items-center" role="alert">
            <p className="flex-1">{etat.erreur}</p>
            <button type="button" className="btn-secondary btn-sm min-h-[44px]" onClick={charger}>Réessayer</button>
          </div>
        )}
        {etat.statut === 'erreur' && data && <p role="alert" className="mb-2 text-sm text-red-700">{etat.erreur}</p>}

        {!data && etat.statut === 'chargement' && (
          <div aria-hidden="true">
            <div className="skeleton h-8 w-96 max-w-full mb-3" />
            <div className="skeleton h-[380px]" />
          </div>
        )}

        {data && (
          <div className={etat.statut === 'chargement' ? 'opacity-60 transition-opacity motion-reduce:transition-none' : ''}
            aria-busy={etat.statut === 'chargement'}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3">
              <EnLigne connectes={data.connectes} />
              <LegendePresence />
            </div>
            {data.salaries.length ? (
              <GrilleSemaine
                jours={data.semaine.jours}
                salaries={data.salaries}
                aujourdhui={data.semaine.aujourdhui || jourParis()}
                mode={mode}
                selection={selection}
                onChoisir={choisir}
                libelle={libelle}
              />
            ) : (
              <p className="card px-4 py-6 text-center text-sm text-slate-500">Aucun membre actif dans l’équipe.</p>
            )}
            {selection && (
              <DetailJour selection={selection} etat={detail} onFermer={fermerDetail} onReessayer={() => chargerDetail(selection)} />
            )}
          </div>
        )}
      </div>

      <ReglagesEquipe
        open={reglages}
        onFermer={() => setReglages(false)}
        sensible={sensible}
        onInformationRemise={(reglages) => setEtat((e) => (e.data ? {
          ...e,
          // État renvoyé par le serveur : la note est « remise » quand tous les salariés actifs l’ont
          data: { ...e.data, information_remise: typeof reglages?.information_remise === 'boolean' ? reglages.information_remise : true },
        } : e))}
      />
    </div>
  );
}
