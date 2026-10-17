import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ListChecks, Inbox, Link2, Search, RotateCcw, Plus, Trash2, ExternalLink, Tags, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useToast } from '../components/Toast';
import { formatDateShort } from '../lib/utils';
import PropositionsPrix from '../components/PropositionsPrix';

export const ONGLETS_PRIX = [
  { cle: 'propositions', label: 'Propositions de prix', icone: Inbox },
  { cle: 'sans-prix', label: 'Modèles sans prix', icone: ListChecks },
  { cle: 'alias', label: 'Alias de modèles', icone: Tags },
];
const CATEGORIES = ['Smartphone', 'Tablette', 'PC Portable', 'Console'];
// Liste des modèles sans prix : 50 lignes par page par défaut (376 modèles sinon sur une seule page),
// 100 ou « Tout » au choix (retenu dans le navigateur, comme sur le tableau de bord).
export const PAR_PAGE_SANS_PRIX = 50;
export const TAILLES_PAGE_SANS_PRIX = [50, 100, 0]; // 0 = tout afficher
const CLE_TAILLE_PAGE = 'kp_sans_prix_page_size';
function lireTaillePage() {
  try {
    const brut = localStorage.getItem(CLE_TAILLE_PAGE);
    const v = brut === null ? NaN : Number(brut);
    return TAILLES_PAGE_SANS_PRIX.includes(v) ? v : PAR_PAGE_SANS_PRIX;
  } catch { return PAR_PAGE_SANS_PRIX; }
}

const liste = (data) => (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []);
const nom = (m) => [m?.marque, m?.modele].filter(Boolean).join(' ');

/** Tri : tickets des 12 derniers mois puis année la plus récente (ou l'inverse), puis nom. */
export function trierSansPrix(modeles, tri = 'tickets') {
  const annee = (m) => Number(m?.annee) || 0;
  const tickets = (m) => Number(m?.tickets_12_mois) || 0;
  return [...(modeles || [])].sort((a, b) => (tri === 'tickets'
    ? tickets(b) - tickets(a) || annee(b) - annee(a)
    : annee(b) - annee(a) || tickets(b) - tickets(a)) || nom(a).localeCompare(nom(b), 'fr'));
}

/** Où saisir le prix d'un modèle : grille boutique pour un iPhone, grille fournisseur sinon. */
export function lienSaisiePrix(m, basePath = '/accueil') {
  if (/iphone/i.test(`${m?.marque || ''} ${m?.modele || ''}`) && !/ipad/i.test(m?.modele || '')) return `${basePath}/tarifs-reparation`;
  return `${basePath}/tarifs?q=${encodeURIComponent(nom(m))}`;
}

function messageErreur(err, defaut) {
  if (err?.code === 'admin_cancelled') return 'Identification administrateur annulée.';
  if (err?.status === 403) return 'Réservé au gérant (compte administrateur).';
  return err?.message || defaut;
}

function FormAlias({ initial, verrouAlias = false, onAnnuler, onEnregistrer }) {
  const id = useId();
  const [v, setV] = useState({ alias: initial?.alias || '', modele_canonique: initial?.modele_canonique || '', categorie: initial?.categorie || '' });
  const [envoi, setEnvoi] = useState(false);
  const champRef = useRef(null);
  useEffect(() => { champRef.current?.focus(); }, []);
  const valide = v.alias.trim() && v.modele_canonique.trim() && v.alias.trim().toLowerCase() !== v.modele_canonique.trim().toLowerCase();
  const soumettre = async (e) => {
    e.preventDefault();
    if (!valide || envoi) return;
    setEnvoi(true);
    try { await onEnregistrer(v); } finally { setEnvoi(false); }
  };
  return (
    <form onSubmit={soumettre} className="card-section grid gap-x-4 gap-y-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
      <div>
        <label htmlFor={`${id}-alias`} className="input-label">Nom saisi sur les tickets</label>
        <input id={`${id}-alias`} value={v.alias} readOnly={verrouAlias} ref={verrouAlias ? undefined : champRef}
          onChange={e => setV(x => ({ ...x, alias: e.target.value }))}
          className={`input min-h-[44px] ${verrouAlias ? 'bg-slate-100 text-slate-700' : ''}`} placeholder="iPhone Air" autoComplete="off" />
      </div>
      <div>
        <label htmlFor={`${id}-canonique`} className="input-label">Nom dans la grille de prix</label>
        <input id={`${id}-canonique`} value={v.modele_canonique} ref={verrouAlias ? champRef : undefined}
          onChange={e => setV(x => ({ ...x, modele_canonique: e.target.value }))}
          className="input min-h-[44px]" placeholder="iPhone 17 Air" autoComplete="off" aria-describedby={`${id}-aide`} />
      </div>
      <div>
        <label htmlFor={`${id}-categorie`} className="input-label">Catégorie</label>
        <select id={`${id}-categorie`} value={v.categorie} onChange={e => setV(x => ({ ...x, categorie: e.target.value }))} className="select min-h-[44px]">
          <option value="">Toutes</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onAnnuler} className="btn-ghost min-h-[44px]">Annuler</button>
        <button type="submit" disabled={!valide || envoi} aria-busy={envoi || undefined} className="btn-primary min-h-[44px]">
          <Link2 aria-hidden="true" /> {envoi ? 'Ajout…' : 'Ajouter l’alias'}
        </button>
      </div>
      <p id={`${id}-aide`} className="sm:col-span-4 input-help mt-0">
        Nom exact tel qu’il figure dans la grille (ex. « iPhone 17 Air »). Les tickets de ce modèle recevront ses prix.
      </p>
    </form>
  );
}

function ModelesSansPrix({ basePath, sensible }) {
  const toast = useToast();
  const rechercheId = useId();
  const triId = useId();
  const tailleId = useId();
  const [etat, setEtat] = useState({ statut: 'chargement', modeles: [], erreur: '' });
  const [essai, setEssai] = useState(0);
  const [tri, setTri] = useState('tickets');
  const [categorie, setCategorie] = useState('');
  const [q, setQ] = useState('');
  const [aliasOuvert, setAliasOuvert] = useState(null);
  const [page, setPage] = useState(0);
  const [parPage, setParPage] = useState(lireTaillePage);

  useEffect(() => {
    let annule = false;
    setEtat(e => ({ ...e, statut: 'chargement', erreur: '' }));
    sensible(() => api.getModelesSansPrix())
      .then((data) => { if (!annule) setEtat({ statut: 'pret', modeles: liste(data), erreur: '' }); })
      .catch((err) => { if (!annule) setEtat({ statut: 'erreur', modeles: [], erreur: messageErreur(err, 'Liste indisponible.') }); });
    return () => { annule = true; };
  }, [sensible, essai]);

  const categories = useMemo(() => [...new Set(etat.modeles.map(m => m.categorie).filter(Boolean))], [etat.modeles]);
  const visibles = useMemo(() => {
    const mots = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return trierSansPrix(etat.modeles.filter(m => (!categorie || m.categorie === categorie)
      && mots.every(w => `${nom(m)} ${m.annee || ''}`.toLowerCase().includes(w))), tri);
  }, [etat.modeles, categorie, q, tri]);

  // Nouveau filtre, tri ou recherche : retour à la première page
  useEffect(() => { setPage(0); }, [categorie, q, tri, etat.modeles]);
  const taille = parPage || Math.max(1, visibles.length); // « Tout » = une seule page
  const nbPages = Math.max(1, Math.ceil(visibles.length / taille));
  const pageCourante = Math.min(page, nbPages - 1);
  const debut = pageCourante * taille;
  const pageVisibles = visibles.slice(debut, debut + taille);
  const changerTaille = (v) => {
    setParPage(v);
    setPage(0);
    try { localStorage.setItem(CLE_TAILLE_PAGE, String(v)); } catch { /* stockage indisponible */ }
  };

  const ajouterAlias = async (m, v) => {
    try {
      await sensible(() => api.ajouterAliasModele(v));
      toast.success(`Alias ajouté : ${v.alias} → ${v.modele_canonique}`);
      setAliasOuvert(null);
      setEssai(n => n + 1);
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(messageErreur(err, 'Alias non ajouté'));
    }
  };

  if (etat.statut === 'chargement') {
    return (
      <ul className="space-y-2" aria-hidden="true">
        {[1, 2, 3, 4].map(i => <li key={i} className="skeleton-row" />)}
      </ul>
    );
  }
  if (etat.statut === 'erreur') {
    return (
      <div className="error-state flex-wrap items-center">
        <AlertTriangle aria-hidden="true" />
        <p className="font-medium flex-1" role="alert">{etat.erreur}</p>
        <button type="button" onClick={() => setEssai(n => n + 1)} className="btn-secondary btn-sm">
          <RotateCcw aria-hidden="true" /> Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="t-body">
        Modèles actifs du catalogue sans aucun prix de réparation. Les plus demandés d’abord : ajoutez un alias si le
        modèle existe sous un autre nom dans la grille, sinon saisissez son prix.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <label htmlFor={rechercheId} className="sr-only">Rechercher un modèle</label>
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          <input id={rechercheId} type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Marque, modèle, année…"
            className="input pl-9 min-h-11" autoComplete="off" />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={triId} className="t-label whitespace-nowrap">Trier par</label>
          <select id={triId} value={tri} onChange={e => setTri(e.target.value)} className="select min-h-11 sm:w-auto">
            <option value="tickets">Tickets (12 mois) puis année</option>
            <option value="annee">Année puis tickets</option>
          </select>
        </div>
      </div>
      {categories.length > 1 && (
        <div className="max-sm:scroll-fade-x">
          <div role="group" aria-label="Filtrer par catégorie" className="segmented">
            {['', ...categories].map(c => (
              <button key={c || 'toutes'} type="button" aria-pressed={categorie === c} onClick={() => setCategorie(c)}
                className={`segmented-item ${categorie === c ? 'segmented-item-active' : ''}`}>
                {c || 'Toutes'}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="t-caption" role="status" aria-live="polite">
        {visibles.length} modèle{visibles.length > 1 ? 's' : ''} sans prix{visibles.length !== etat.modeles.length ? ` (sur ${etat.modeles.length})` : ''}
      </p>
      {visibles.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon bg-emerald-50 text-emerald-700"><ListChecks aria-hidden="true" /></div>
          <p className="t-h2">{etat.modeles.length ? 'Aucun modèle ne correspond.' : 'Tous les modèles du catalogue ont un prix.'}</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {pageVisibles.map((m, i) => {
              const cle = `${m.categorie}|${m.marque}|${m.modele}|${debut + i}`;
              const ouvert = aliasOuvert === cle;
              const tickets = Number(m.tickets_12_mois) || 0;
              return (
                <li key={cle} className="px-3 sm:px-4 py-2 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 min-h-10">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">{nom(m) || '—'}</p>
                      <p className="t-caption flex flex-wrap gap-x-3">
                        {m.categorie && <span>{m.categorie}</span>}
                        <span>{m.annee ? `Sortie ${m.annee}` : 'Année inconnue'}</span>
                        <span className={tickets ? 'font-semibold text-slate-800' : ''}>
                          {tickets} ticket{tickets > 1 ? 's' : ''} sur 12 mois
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setAliasOuvert(ouvert ? null : cle)} aria-expanded={ouvert}
                        aria-label={`Ajouter un alias pour ${nom(m)}`}
                        className="btn-ghost btn-sm">
                        <Link2 aria-hidden="true" /> Ajouter un alias
                      </button>
                      <Link to={lienSaisiePrix(m, basePath)} aria-label={`Saisir le prix de ${nom(m)}`}
                        className="btn-secondary btn-sm">
                        <ExternalLink aria-hidden="true" /> Saisir le prix
                      </Link>
                    </div>
                  </div>
                  {ouvert && (
                    <FormAlias verrouAlias initial={{ alias: m.modele, categorie: m.categorie || '' }}
                      onAnnuler={() => setAliasOuvert(null)} onEnregistrer={v => ajouterAlias(m, v)} />
                  )}
                </li>
              );
            })}
          </ul>
          {visibles.length > PAR_PAGE_SANS_PRIX && (
            <nav className="card-footer flex-wrap justify-between gap-2 px-3" aria-label="Pagination des modèles sans prix">
              <div className="flex items-center gap-2">
                <span className="t-caption tabular-nums whitespace-nowrap">
                  {debut + 1}–{Math.min(debut + taille, visibles.length)} sur {visibles.length}
                </span>
                <label htmlFor={tailleId} className="sr-only">Modèles par page</label>
                <select id={tailleId} value={parPage} onChange={e => changerTaille(Number(e.target.value))} className="select w-auto min-h-9 py-1">
                  {TAILLES_PAGE_SANS_PRIX.map(n => (
                    <option key={n} value={n}>{n ? `${n} / page` : 'Tout'}</option>
                  ))}
                </select>
              </div>
              {nbPages > 1 && (
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={pageCourante === 0} className="btn-ghost btn-sm">
                    <ChevronLeft aria-hidden="true" /> Précédent
                  </button>
                  <span className="t-caption whitespace-nowrap">Page {pageCourante + 1} / {nbPages}</span>
                  <button type="button" onClick={() => setPage(p => Math.min(nbPages - 1, p + 1))} disabled={pageCourante >= nbPages - 1} className="btn-ghost btn-sm">
                    Suivant <ChevronRight aria-hidden="true" />
                  </button>
                </div>
              )}
            </nav>
          )}
        </div>
      )}
    </div>
  );
}

function AliasModeles({ sensible }) {
  const toast = useToast();
  const [etat, setEtat] = useState({ statut: 'chargement', alias: [], erreur: '' });
  const [essai, setEssai] = useState(0);
  const [ajout, setAjout] = useState(false);

  useEffect(() => {
    let annule = false;
    setEtat(e => ({ ...e, statut: 'chargement', erreur: '' }));
    sensible(() => api.getAliasModeles())
      .then((data) => { if (!annule) setEtat({ statut: 'pret', alias: liste(data), erreur: '' }); })
      .catch((err) => { if (!annule) setEtat({ statut: 'erreur', alias: [], erreur: messageErreur(err, 'Alias indisponibles.') }); });
    return () => { annule = true; };
  }, [sensible, essai]);

  const ajouter = async (v) => {
    try {
      await sensible(() => api.ajouterAliasModele(v));
      toast.success(`Alias ajouté : ${v.alias} → ${v.modele_canonique}`);
      setAjout(false);
      setEssai(n => n + 1);
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(messageErreur(err, 'Alias non ajouté'));
    }
  };

  const supprimer = async (a) => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function'
      && !window.confirm(`Supprimer l’alias « ${a.alias} » → « ${a.modele_canonique} » ?`)) return;
    try {
      await sensible(() => api.supprimerAliasModele(a.id));
      setEtat(e => ({ ...e, alias: e.alias.filter(x => x.id !== a.id) }));
      toast.success('Alias supprimé');
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(messageErreur(err, 'Alias non supprimé'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="t-body">
          Un alias relie le nom d’un modèle sur les tickets à son nom dans les grilles de prix (« iPhone Air » → « iPhone 17 Air »).
        </p>
        {!ajout && (
          <button type="button" onClick={() => setAjout(true)} className="btn-primary shrink-0">
            <Plus aria-hidden="true" /> Nouvel alias
          </button>
        )}
      </div>
      {ajout && <FormAlias onAnnuler={() => setAjout(false)} onEnregistrer={ajouter} />}
      {etat.statut === 'chargement' ? (
        <ul className="space-y-2" aria-hidden="true">
          {[1, 2, 3].map(i => <li key={i} className="skeleton h-12" />)}
        </ul>
      ) : etat.statut === 'erreur' ? (
        <div className="error-state flex-wrap items-center">
          <AlertTriangle aria-hidden="true" />
          <p className="font-medium flex-1" role="alert">{etat.erreur}</p>
          <button type="button" onClick={() => setEssai(n => n + 1)} className="btn-secondary btn-sm">
            <RotateCcw aria-hidden="true" /> Réessayer
          </button>
        </div>
      ) : etat.alias.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon"><Tags aria-hidden="true" /></div>
          <p className="t-body text-slate-500">Aucun alias pour le moment.</p>
        </div>
      ) : (
        <ul className="card divide-y divide-slate-100 overflow-hidden">
          {etat.alias.map(a => (
            <li key={a.id ?? a.alias} className="flex items-center gap-3 px-3 sm:px-4 py-1.5 min-h-12">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-900">
                  <span className="font-semibold">{a.alias}</span>
                  <span className="text-slate-500" aria-hidden="true"> → </span>
                  <span className="sr-only"> correspond à </span>
                  <span className="font-semibold">{a.modele_canonique}</span>
                </p>
                <p className="t-caption">
                  {a.categorie || 'Toutes catégories'}{a.le ? ` · ajouté le ${formatDateShort(a.le)}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => supprimer(a)} aria-label={`Supprimer l’alias ${a.alias}`}
                className="btn-danger-ghost btn-icon -mr-2">
                <Trash2 aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Page admin « Prix à revoir » : propositions de prix issues des commandes, modèles du catalogue
 * sans prix (alias ou saisie), alias de modèles. Onglet choisi par ?onglet=propositions|sans-prix|alias.
 */
export default function ModelesSansPrixPage() {
  const { user } = useAuth();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';
  const [params, setParams] = useSearchParams();
  const demande = params.get('onglet');
  const onglet = ONGLETS_PRIX.some(o => o.cle === demande) ? demande : 'sans-prix';
  const { sensible, adminPrompt } = useAdminElevation();
  const [nbPropositions, setNbPropositions] = useState(null);
  const baseId = useId();
  const ongletsRef = useRef([]);

  // Compteur du badge, même si l'onglet des propositions n'est pas ouvert
  useEffect(() => {
    if (onglet === 'propositions') return undefined;
    let annule = false;
    Promise.resolve().then(() => api.getPropositionsPrix({ statut: 'en_attente' }))
      .then((d) => { if (!annule) setNbPropositions(liste(d).length); })
      .catch(() => {});
    return () => { annule = true; };
  }, [onglet]);

  const choisir = (cle) => {
    const p = new URLSearchParams(params);
    p.set('onglet', cle);
    setParams(p, { replace: true });
  };

  const auClavier = (e, i) => {
    const n = ONGLETS_PRIX.length;
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % n;
    else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    if (j === null) return;
    e.preventDefault();
    choisir(ONGLETS_PRIX[j].cle);
    ongletsRef.current[j]?.focus();
  };

  return (
    <div className="page max-w-[1280px]">
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Prix à revoir</h1>
          <p className="page-header-subtitle">
            Les vrais prix payés, les modèles sans tarif et les correspondances de noms. Rien ne change sans votre validation.
          </p>
        </div>
      </div>

      <div className="max-sm:scroll-fade-x mb-6">
        <div role="tablist" aria-label="Suivi des prix" className="page-tabs">
          {ONGLETS_PRIX.map(({ cle, label, icone: Icone }, i) => {
            const actif = onglet === cle;
            // Seul le panneau actif est rendu : aria-controls ne vise jamais un id absent du DOM
            return (
              <button key={cle} ref={el => { ongletsRef.current[i] = el; }} type="button" role="tab"
                id={`${baseId}-tab-${cle}`} aria-selected={actif} aria-controls={actif ? `${baseId}-panel-${cle}` : undefined}
                tabIndex={actif ? 0 : -1} onClick={() => choisir(cle)} onKeyDown={e => auClavier(e, i)}
                className={`page-tab ${actif ? 'page-tab-active' : ''}`}>
                <Icone className="w-4 h-4" aria-hidden="true" />
                {label}
                {cle === 'propositions' && nbPropositions > 0 && (
                  <span className="badge-count badge-count-brand">
                    {nbPropositions}<span className="sr-only"> en attente</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel" id={`${baseId}-panel-${onglet}`} aria-labelledby={`${baseId}-tab-${onglet}`} tabIndex={0}
        className="focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-lg">
        {onglet === 'propositions' && (
          <PropositionsPrix basePath={basePath} sensible={sensible} onCompte={setNbPropositions} />
        )}
        {onglet === 'sans-prix' && <ModelesSansPrix basePath={basePath} sensible={sensible} />}
        {onglet === 'alias' && <AliasModeles sensible={sensible} />}
      </div>
      {adminPrompt}
    </div>
  );
}
