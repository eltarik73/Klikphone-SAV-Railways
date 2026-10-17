import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ListChecks, Inbox, Link2, Search, RotateCcw, Plus, Trash2, ExternalLink, Tags } from 'lucide-react';
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
    <form onSubmit={soumettre} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end p-3 rounded-xl bg-slate-50 border border-slate-200">
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
        <select id={`${id}-categorie`} value={v.categorie} onChange={e => setV(x => ({ ...x, categorie: e.target.value }))} className="input min-h-[44px]">
          <option value="">Toutes</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onAnnuler} className="btn-secondary min-h-[44px]">Annuler</button>
        <button type="submit" disabled={!valide || envoi} aria-busy={envoi || undefined} className="btn-primary min-h-[44px] disabled:opacity-60">
          <Link2 className="w-4 h-4" aria-hidden="true" /> {envoi ? 'Ajout…' : 'Ajouter l’alias'}
        </button>
      </div>
      <p id={`${id}-aide`} className="sm:col-span-4 text-[11px] text-slate-600">
        Nom exact tel qu’il figure dans la grille (ex. « iPhone 17 Air »). Les tickets de ce modèle recevront ses prix.
      </p>
    </form>
  );
}

function ModelesSansPrix({ basePath, sensible }) {
  const toast = useToast();
  const rechercheId = useId();
  const triId = useId();
  const [etat, setEtat] = useState({ statut: 'chargement', modeles: [], erreur: '' });
  const [essai, setEssai] = useState(0);
  const [tri, setTri] = useState('tickets');
  const [categorie, setCategorie] = useState('');
  const [q, setQ] = useState('');
  const [aliasOuvert, setAliasOuvert] = useState(null);

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
        {[1, 2, 3, 4].map(i => <li key={i} className="h-16 rounded-xl bg-slate-100 motion-safe:animate-pulse" />)}
      </ul>
    );
  }
  if (etat.statut === 'erreur') {
    return (
      <div className="card p-5 text-center space-y-3">
        <p className="text-sm text-red-700 font-medium" role="alert">{etat.erreur}</p>
        <button type="button" onClick={() => setEssai(n => n + 1)} className="btn-secondary min-h-[44px] text-xs">
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Modèles actifs du catalogue sans aucun prix de réparation. Les plus demandés d’abord : ajoutez un alias si le
        modèle existe sous un autre nom dans la grille, sinon saisissez son prix.
      </p>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <label htmlFor={rechercheId} className="sr-only">Rechercher un modèle</label>
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input id={rechercheId} type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Marque, modèle, année…"
            className="input pl-9 min-h-[44px]" style={{ fontSize: '16px' }} autoComplete="off" />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={triId} className="text-xs font-semibold text-slate-700 whitespace-nowrap">Trier par</label>
          <select id={triId} value={tri} onChange={e => setTri(e.target.value)} className="input min-h-[44px]">
            <option value="tickets">Tickets (12 mois) puis année</option>
            <option value="annee">Année puis tickets</option>
          </select>
        </div>
      </div>
      {categories.length > 1 && (
        <div role="group" aria-label="Filtrer par catégorie" className="flex flex-wrap gap-1.5">
          {['', ...categories].map(c => (
            <button key={c || 'toutes'} type="button" aria-pressed={categorie === c} onClick={() => setCategorie(c)}
              className={`min-h-[44px] px-3 rounded-lg text-xs font-bold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                categorie === c ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
              {c || 'Toutes'}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-600" role="status" aria-live="polite">
        {visibles.length} modèle{visibles.length > 1 ? 's' : ''} sans prix{visibles.length !== etat.modeles.length ? ` (sur ${etat.modeles.length})` : ''}
      </p>
      {visibles.length === 0 ? (
        <div className="card p-8 text-center">
          <ListChecks className="w-8 h-8 text-emerald-600 mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-800">{etat.modeles.length ? 'Aucun modèle ne correspond.' : 'Tous les modèles du catalogue ont un prix.'}</p>
        </div>
      ) : (
        <ul className="card divide-y divide-slate-100 overflow-hidden">
          {visibles.map((m, i) => {
            const cle = `${m.categorie}|${m.marque}|${m.modele}|${i}`;
            const ouvert = aliasOuvert === cle;
            const tickets = Number(m.tickets_12_mois) || 0;
            return (
              <li key={cle} className="p-3 sm:px-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{nom(m) || '—'}</p>
                    <p className="text-xs text-slate-600 flex flex-wrap gap-x-3">
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
                      className="btn-secondary min-h-[44px] text-xs">
                      <Link2 className="w-3.5 h-3.5" aria-hidden="true" /> Ajouter un alias
                    </button>
                    <Link to={lienSaisiePrix(m, basePath)} aria-label={`Saisir le prix de ${nom(m)}`}
                      className="btn-primary min-h-[44px] text-xs">
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Saisir le prix
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
        <p className="text-sm text-slate-600">
          Un alias relie le nom d’un modèle sur les tickets à son nom dans les grilles de prix (« iPhone Air » → « iPhone 17 Air »).
        </p>
        {!ajout && (
          <button type="button" onClick={() => setAjout(true)} className="btn-primary min-h-[44px] text-xs shrink-0">
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Nouvel alias
          </button>
        )}
      </div>
      {ajout && <FormAlias onAnnuler={() => setAjout(false)} onEnregistrer={ajouter} />}
      {etat.statut === 'chargement' ? (
        <ul className="space-y-2" aria-hidden="true">
          {[1, 2, 3].map(i => <li key={i} className="h-12 rounded-xl bg-slate-100 motion-safe:animate-pulse" />)}
        </ul>
      ) : etat.statut === 'erreur' ? (
        <div className="card p-5 text-center space-y-3">
          <p className="text-sm text-red-700 font-medium" role="alert">{etat.erreur}</p>
          <button type="button" onClick={() => setEssai(n => n + 1)} className="btn-secondary min-h-[44px] text-xs">
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Réessayer
          </button>
        </div>
      ) : etat.alias.length === 0 ? (
        <p className="card p-6 text-center text-sm text-slate-600">Aucun alias pour le moment.</p>
      ) : (
        <ul className="card divide-y divide-slate-100 overflow-hidden">
          {etat.alias.map(a => (
            <li key={a.id ?? a.alias} className="flex items-center gap-3 px-3 sm:px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-900">
                  <span className="font-semibold">{a.alias}</span>
                  <span className="text-slate-600" aria-hidden="true"> → </span>
                  <span className="sr-only"> correspond à </span>
                  <span className="font-semibold">{a.modele_canonique}</span>
                </p>
                <p className="text-[11px] text-slate-600">
                  {a.categorie || 'Toutes catégories'}{a.le ? ` · ajouté le ${formatDateShort(a.le)}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => supprimer(a)} aria-label={`Supprimer l’alias ${a.alias}`}
                className="btn-ghost p-0 min-w-[44px] min-h-[44px] justify-center text-red-700 hover:bg-red-50">
                <Trash2 className="w-4 h-4" aria-hidden="true" />
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
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl">
      <div className="mb-5">
        <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <ListChecks className="w-6 h-6 text-brand-600" aria-hidden="true" /> Prix à revoir
        </h1>
        <p className="text-sm text-slate-600 mt-0.5">
          Les vrais prix payés, les modèles sans tarif et les correspondances de noms. Rien ne change sans votre validation.
        </p>
      </div>

      <div role="tablist" aria-label="Suivi des prix" className="flex gap-1 overflow-x-auto scrollbar-none border-b border-slate-200 mb-5">
        {ONGLETS_PRIX.map(({ cle, label, icone: Icone }, i) => {
          const actif = onglet === cle;
          // Seul le panneau actif est rendu : aria-controls ne vise jamais un id absent du DOM
          return (
            <button key={cle} ref={el => { ongletsRef.current[i] = el; }} type="button" role="tab"
              id={`${baseId}-tab-${cle}`} aria-selected={actif} aria-controls={actif ? `${baseId}-panel-${cle}` : undefined}
              tabIndex={actif ? 0 : -1} onClick={() => choisir(cle)} onKeyDown={e => auClavier(e, i)}
              className={`inline-flex items-center gap-2 min-h-[44px] px-3 sm:px-4 -mb-px border-b-2 text-sm font-semibold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-t-lg ${
                actif ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
              <Icone className="w-4 h-4" aria-hidden="true" />
              {label}
              {cle === 'propositions' && nbPropositions > 0 && (
                <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-brand-600 text-white text-[11px] font-bold">
                  {nbPropositions}<span className="sr-only"> en attente</span>
                </span>
              )}
            </button>
          );
        })}
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
