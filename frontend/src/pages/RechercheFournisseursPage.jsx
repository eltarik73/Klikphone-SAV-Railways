import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, KeyRound, Loader2, PackageCheck, PackageX, Search, SearchX, Truck } from 'lucide-react';
import api from '../lib/api';
import AdminLoginModal from '../components/AdminLoginModal';
import { BadgeDatePrix, SEUILS_FRAICHEUR, euros } from '../components/HistoriquePrix';
import { FOURNISSEURS, fournisseurRetenu, getPieceIcon, prixARenseigner } from '../components/PieceFournisseurRow';

/**
 * « Recherche fournisseurs » (onglet de la rubrique Tarifs) : une recherche de tarifs pro, Mobilax et Utopya
 * côte à côte, d'après les derniers passages (synchro Mobilax, collecte Utopya) — aucune requête aux sites.
 *
 * Tapez un modèle (« Pixel 6 », « Galaxy A54 », « iPhone 13 », « iPad 9 ») : pour chaque modèle de la grille, ses
 * pièces avec le prix de CHAQUE fournisseur (HT pour le gérant, prix client qu'il donnerait, en stock ou en
 * rupture, référence, fiche, date du relevé) et le coût retenu ; puis, pour le gérant, le catalogue brut de
 * chaque fournisseur (tous les produits qui répondent à la recherche : nom tel que le fournisseur l'écrit,
 * qualité lue, prix, stock) — pour vérifier d'un coup d'œil qu'un écran « Original Refurb » n'est pas pris pour
 * l'écran officiel. GET /api/tarifs/fournisseurs/recherche?q=&type=.
 */

export const TYPES_RECHERCHE = Object.freeze([
  { cle: '', label: 'Toutes les pièces' },
  { cle: 'ecran', label: 'Écran' },
  { cle: 'batterie', label: 'Batterie' },
  { cle: 'connecteur', label: 'Connecteur' },
  { cle: 'vitre arriere', label: 'Vitre arrière' },
  { cle: 'bouton power', label: 'Bouton power' },
]);
const EXEMPLES = ['Pixel 6', 'Galaxy A54', 'iPhone 13', 'iPad 9', 'Redmi Note 12'];
const DELAI_SAISIE = 350;

const deuxDecimales = (v) => Number(v).toFixed(2).replace('.', ',');

/** Badge de stock d'un prix fournisseur : « En stock » / « Rupture » / rien quand le fournisseur ne le dit pas. */
export function BadgeStock({ enStock, fournisseur = '', className = '' }) {
  if (enStock === null || enStock === undefined) return null;
  const Icone = enStock ? PackageCheck : PackageX;
  const suffixe = fournisseur ? ` chez ${fournisseur}` : '';
  return (
    <span className={`badge badge-sm ${enStock ? 'badge-success' : 'badge-danger'} ${className}`}>
      <Icone className="w-3 h-3" aria-hidden="true" />
      {enStock ? 'En stock' : 'Rupture'}<span className="sr-only">{suffixe}</span>
    </span>
  );
}

/** Le prix d'un fournisseur pour une pièce (cellule de la grille comparée). */
function CelluleFournisseur({ d, fournisseur, admin, retenu }) {
  const connu = !!d && (d.connu || (d.ht !== null && d.ht !== undefined) || (d.client !== null && d.client !== undefined));
  if (!connu) {
    return (
      <div className="text-slate-400 text-sm">
        <span>—</span>
        {d?.en_stock === false && <BadgeStock enStock={false} fournisseur={fournisseur} className="ml-2" />}
        <span className="sr-only"> pas de prix {fournisseur}</span>
      </div>
    );
  }
  const ligneDate = { prix_maj_le: d.prix_maj_le || d.vu_le, prix_source: 'import' };
  return (
    <div className="space-y-1 min-w-[150px]">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {admin && d.ht !== null && d.ht !== undefined
          ? <span className="font-semibold text-slate-900 tabular-nums">{deuxDecimales(d.ht)} € HT</span>
          : null}
        {Number(d.client) > 0 && (
          <span className={`tabular-nums ${admin ? 'text-xs text-slate-500' : 'font-semibold text-slate-900'}`}>
            {admin ? '→ client ' : ''}{euros(d.client)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <BadgeStock enStock={d.en_stock} fournisseur={fournisseur} />
        {retenu && <span className="badge badge-sm badge-brand">retenu</span>}
        {ligneDate.prix_maj_le && <BadgeDatePrix row={ligneDate} seuils={SEUILS_FRAICHEUR} court />}
      </div>
      {(d.ref || d.url) && (
        <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
          {d.ref && <span>réf. {d.ref}</span>}
          {d.url && (
            <a href={d.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 min-h-[44px] -my-[14px] px-1 -mx-1 text-brand-700 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              <ExternalLink className="w-3 h-3" aria-hidden="true" /> fiche<span className="sr-only"> {fournisseur} (nouvel onglet)</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** Un modèle de la grille : ses pièces, Mobilax et Utopya côte à côte, le coût retenu. */
function CarteModele({ m, admin }) {
  const titreId = useId();
  return (
    <section aria-labelledby={titreId} className="card overflow-hidden">
      <header className="card-header flex flex-wrap items-center gap-2">
        <h2 id={titreId} className="t-h3 text-slate-900">{m.marque} {m.modele}</h2>
        {m.categorie_apple && <span className="badge badge-sm badge-neutral">{m.categorie_apple === 'ipad' ? 'iPad' : 'Mac'}</span>}
        <span className="text-xs text-slate-500 ml-auto">{m.pieces.length} pièce{m.pieces.length > 1 ? 's' : ''}</span>
      </header>
      <div className="table-wrap">
        <table className="table table-dense">
          <thead className="table-header">
            <tr>
              <th scope="col">Pièce</th>
              {FOURNISSEURS.map((f) => <th key={f} scope="col">{f}</th>)}
              <th scope="col" className="text-right">Retenu</th>
            </tr>
          </thead>
          <tbody>
            {m.pieces.map((p) => {
              const Icone = getPieceIcon(p.type_piece);
              const retenu = fournisseurRetenu(p);
              const aRenseigner = prixARenseigner(p);
              const stockRetenu = retenu ? p.prix_fournisseurs?.[retenu]?.en_stock : undefined;
              return (
                <tr key={p.cle} className="table-row align-top">
                  <td className="table-sticky-col">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icone className="w-4 h-4 shrink-0 text-slate-400" aria-hidden="true" />
                      <div className="min-w-0">
                        <span className="font-semibold text-slate-900">{p.type_piece}</span>
                        {p.qualite && <span className="badge badge-sm badge-neutral ml-1.5">{p.qualite}</span>}
                      </div>
                    </div>
                  </td>
                  {FOURNISSEURS.map((f) => (
                    <td key={f}>
                      <CelluleFournisseur d={p.prix_fournisseurs?.[f]} fournisseur={f} admin={admin} retenu={retenu === f} />
                    </td>
                  ))}
                  <td className="text-right">
                    {aRenseigner ? (
                      <span className="badge badge-sm badge-warning">Prix à renseigner</span>
                    ) : (
                      <div className="space-y-1">
                        <div className="text-base font-semibold text-slate-900 tabular-nums">{Number(p.prix_client) > 0 ? euros(p.prix_client) : '—'}</div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs text-slate-500">
                          {retenu ? <span className="inline-flex items-center gap-1"><Truck className="w-3 h-3" aria-hidden="true" />{retenu}</span> : <span>{p.prix_source === 'manuel' ? 'saisie manuelle' : 'prix estimé'}</span>}
                          {stockRetenu === false && <BadgeStock enStock={false} fournisseur={retenu} />}
                          {admin && p.prix_fournisseur_ht !== null && p.prix_fournisseur_ht !== undefined && (
                            <span className="tabular-nums">{deuxDecimales(p.prix_fournisseur_ht)} € HT</span>
                          )}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Le catalogue brut d'un fournisseur pour la recherche (gérant) : chaque produit tel que le fournisseur l'écrit. */
function CatalogueFournisseur({ fournisseur, produits }) {
  const titreId = useId();
  return (
    <section aria-labelledby={titreId} className="card">
      <header className="card-header flex items-center gap-2">
        <Truck className="w-4 h-4 text-slate-400" aria-hidden="true" />
        <h2 id={titreId} className="t-h3 text-slate-900">Catalogue {fournisseur}</h2>
        <span className="badge badge-sm badge-neutral ml-auto">{produits.length} produit{produits.length > 1 ? 's' : ''}</span>
      </header>
      {produits.length === 0 ? (
        <p className="card-body text-sm text-slate-500">Aucun produit {fournisseur} ne répond à cette recherche dans le dernier passage.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {produits.map((p) => (
            <li key={`${p.fournisseur}:${p.ref}`} className="px-4 py-2.5 flex flex-wrap items-start gap-x-3 gap-y-1">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 break-words">{p.nom}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  {p.type_piece && <span className="badge badge-sm badge-neutral">{p.type_piece}</span>}
                  {p.qualite && <span className={`badge badge-sm ${/original/i.test(p.qualite) ? 'badge-info' : 'badge-neutral'}`}>{p.qualite}</span>}
                  <BadgeStock enStock={p.en_stock} fournisseur={fournisseur} />
                  {p.tarif_cle ? <span className="badge badge-sm badge-success">dans la grille</span> : <span className="badge badge-sm badge-warning">hors grille</span>}
                  {p.ref && <span>réf. {p.ref}</span>}
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 min-h-[44px] -my-[14px] px-1 -mx-1 text-brand-700 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                      <ExternalLink className="w-3 h-3" aria-hidden="true" /> fiche<span className="sr-only"> {fournisseur} (nouvel onglet)</span>
                    </a>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-slate-900 tabular-nums">{p.prix_ht !== null && p.prix_ht !== undefined ? `${deuxDecimales(p.prix_ht)} € HT` : 'sans prix'}</p>
                {Number(p.client) > 0 && <p className="text-xs text-slate-500 tabular-nums">→ client {euros(p.client)}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function RechercheFournisseursPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = (searchParams.get('q') || '').trim();
  const type = searchParams.get('type') || '';
  const [saisie, setSaisie] = useState(q);
  const [resultat, setResultat] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState('');
  const [showAdmin, setShowAdmin] = useState(false);
  const [vueCatalogue, setVueCatalogue] = useState('tous');
  const champId = useId();
  const requeteRef = useRef(0);
  const monteRef = useRef(true);
  useEffect(() => { monteRef.current = true; return () => { monteRef.current = false; }; }, []);

  // La saisie met l'adresse à jour (?q=…) après une courte pause : l'adresse se partage, le retour arrière marche
  useEffect(() => {
    const t = setTimeout(() => {
      const propre = saisie.trim();
      if (propre === q) return;
      const next = new URLSearchParams(searchParams);
      if (propre) next.set('q', propre); else next.delete('q');
      setSearchParams(next, { replace: true });
    }, DELAI_SAISIE);
    return () => clearTimeout(t);
  }, [saisie]); // eslint-disable-line react-hooks/exhaustive-deps

  const charger = useCallback(async () => {
    if (q.length < 2) { setResultat(null); setErreur(''); return; }
    const num = ++requeteRef.current;
    setChargement(true);
    setErreur('');
    try {
      const r = await api.rechercherFournisseurs({ q, type: type || undefined });
      if (!monteRef.current || num !== requeteRef.current) return;
      setResultat(r);
    } catch (err) {
      if (!monteRef.current || num !== requeteRef.current) return;
      setErreur(err?.message || 'Recherche impossible pour le moment');
    } finally {
      if (monteRef.current && num === requeteRef.current) setChargement(false);
    }
  }, [q, type]);

  useEffect(() => { charger(); }, [charger]);

  const choisirType = (cle) => {
    const next = new URLSearchParams(searchParams);
    if (cle) next.set('type', cle); else next.delete('type');
    setSearchParams(next, { replace: true });
  };
  const chercher = (texte) => { setSaisie(texte); };

  const admin = resultat?.admin === true;
  const modeles = resultat?.modeles || [];
  const nbPieces = useMemo(() => modeles.reduce((s, m) => s + m.pieces.length, 0), [modeles]);
  const produits = resultat?.produits || {};
  const fournisseursVus = vueCatalogue === 'tous' ? FOURNISSEURS : FOURNISSEURS.filter((f) => f === vueCatalogue);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-header-title flex items-center gap-2"><Search className="w-6 h-6 text-brand-600" aria-hidden="true" /> Recherche fournisseurs</h1>
          <p className="page-header-subtitle">
            Mobilax et Utopya côte à côte : prix d’achat, prix client, en stock ou en rupture, fiche produit — d’après la dernière synchro et la dernière collecte.
          </p>
        </div>
      </header>

      <section className="card card-body space-y-3" aria-label="Recherche">
        <div>
          <label htmlFor={champId} className="input-label">Modèle, pièce ou référence</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
            <input id={champId} type="search" value={saisie} onChange={(e) => setSaisie(e.target.value)} autoComplete="off" autoFocus
              placeholder="Pixel 6, Galaxy A54, iPhone 13, iPad 9…" className="input input-lg pl-9" aria-describedby={`${champId}-aide`} />
          </div>
          <p id={`${champId}-aide`} className="input-help">Au moins deux lettres ; chaque mot doit être dans le nom du modèle.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="segmented" role="group" aria-label="Type de pièce">
            {TYPES_RECHERCHE.map((t) => (
              <button key={t.cle || 'tous'} type="button" aria-pressed={type === t.cle} onClick={() => choisirType(t.cle)}
                className={`segmented-item ${type === t.cle ? 'segmented-item-active' : ''}`}>
                {t.label}
              </button>
            ))}
          </div>
          {chargement && (
            <span className="inline-flex items-center gap-1 text-sm text-slate-500" role="status" aria-live="polite">
              <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> Recherche…
            </span>
          )}
        </div>
        {!q && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span>Essayez :</span>
            {EXEMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => chercher(ex)} className="btn-secondary btn-sm">{ex}</button>
            ))}
          </div>
        )}
      </section>

      {erreur && <div role="alert" className="callout callout-danger mt-3">{erreur}</div>}

      {q.length >= 2 && resultat && !chargement && (
        <p className="mt-3 text-sm text-slate-600" role="status" aria-live="polite">
          {modeles.length === 0
            ? <>Aucun modèle de la grille ne contient « {resultat.q} ».</>
            : <>{modeles.length} modèle{modeles.length > 1 ? 's' : ''}, {nbPieces} pièce{nbPieces > 1 ? 's' : ''} — fournisseur retenu pour la grille : <strong>{resultat.preference}</strong>.</>}
        </p>
      )}

      {q.length >= 2 && resultat && modeles.length === 0 && !chargement && (
        <div className="empty-state mt-3">
          <SearchX className="empty-state-icon" aria-hidden="true" />
          <p className="font-medium text-slate-900">Rien dans la grille pour « {resultat.q} »</p>
          <p className="text-sm text-slate-500">Vérifiez l’orthographe du modèle, ou ajoutez-le dans « Réparation smartphones ».</p>
        </div>
      )}

      <div className="mt-3 space-y-3">
        {modeles.map((m) => <CarteModele key={`${m.marque}::${m.modele}`} m={m} admin={admin} />)}
      </div>

      {q.length >= 2 && resultat && !admin && (
        <section className="callout callout-info mt-4 flex-wrap items-center">
          <KeyRound aria-hidden="true" />
          <div className="min-w-[240px] flex-1">
            <p className="font-semibold">Prix d’achat et catalogues fournisseurs : réservés au gérant</p>
            <p className="text-xs sm:text-sm">Avec le code administrateur, la page montre les prix HT de chaque fournisseur et tous leurs produits qui répondent à la recherche.</p>
          </div>
          <button type="button" onClick={() => setShowAdmin(true)} className="btn-primary btn-sm">Saisir le code admin</button>
        </section>
      )}

      {admin && q.length >= 2 && resultat && (
        <section className="mt-6 space-y-3" aria-labelledby="catalogues-titre">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="catalogues-titre" className="t-h2 text-slate-900">Catalogues fournisseurs</h2>
            <span className="text-sm text-slate-500">
              {resultat.nb_produits} produit{resultat.nb_produits > 1 ? 's' : ''}{resultat.tronque ? ' (liste limitée : précisez la recherche)' : ''}
            </span>
            <div className="segmented ml-auto" role="group" aria-label="Catalogue affiché">
              {[{ cle: 'tous', label: 'Les deux' }, ...FOURNISSEURS.map((f) => ({ cle: f, label: f }))].map((c) => (
                <button key={c.cle} type="button" aria-pressed={vueCatalogue === c.cle} onClick={() => setVueCatalogue(c.cle)}
                  className={`segmented-item ${vueCatalogue === c.cle ? 'segmented-item-active' : ''}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className={`grid gap-3 ${fournisseursVus.length > 1 ? 'lg:grid-cols-2' : ''}`}>
            {fournisseursVus.map((f) => <CatalogueFournisseur key={f} fournisseur={f} produits={produits[f] || []} />)}
          </div>
        </section>
      )}

      <AdminLoginModal open={showAdmin} onClose={() => setShowAdmin(false)} onSuccess={() => { setShowAdmin(false); charger(); }} />
    </div>
  );
}
