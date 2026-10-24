import { useEffect, useId, useRef, useState } from 'react';
import {
  Smartphone, Battery, Plug, Camera, Package, Volume2, Headphones, ExternalLink, Pencil, Check, X, Loader2,
  AlertTriangle, Lock,
} from 'lucide-react';
import {
  BadgeDatePrix, BoutonVerrou, SEUILS_FRAICHEUR, alertesPrix, estEcran, euros, fusionnerRegles, libelleSource,
  messageErreurPrix, prixClientApple, prixClientPiece,
} from './HistoriquePrix';
import { useToast } from './Toast';

/**
 * Ligne d'une pièce fournisseur (écran « Réparation smartphones ») : prix d'achat HT (admin), détail du
 * calcul « 42,00 × 1,2 + 60 = 110,40 → 119 € », prix client TTC, stock, fraîcheur, cadenas et, pour
 * l'admin, le volet « Mettre à jour le HT » : saisie → aperçu du nouveau prix client AVANT validation →
 * PATCH /api/tarifs/{id}/prix (source manuel / Utopya / Mobilax, référence et adresse facultatives).
 * Le prix client enregistré est TOUJOURS celui du serveur (règles de marge) ; l'aperçu reprend les
 * mêmes règles (prixClientPiece) et n'est qu'une prévisualisation.
 *
 * Fournisseurs : aucune requête automatique vers mobilax.fr ni utopya.fr. Les liens sont des adresses
 * profondes que le gérant ouvre dans SON navigateur (il y est connecté), construits ici.
 */

// ─── Libellés et icônes ───────────────────────────
const PIECE_ICONS = { ecran: Smartphone, batterie: Battery, connecteur: Plug, camera: Camera, vitre: Package, 'haut-parleur': Volume2, ecouteur: Headphones };

export function getPieceIcon(type) {
  const t = sansAccents(type);
  for (const [key, Icon] of Object.entries(PIECE_ICONS)) { if (t.includes(key)) return Icon; }
  return Package;
}

export const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Identité d'une pièce : clé du serveur (« tarifs:12 », « tarifs_apple_devices:3:ecran ») ou tarifs:id. */
export const idPiece = (piece) => piece?.cle ?? (piece?.id !== null && piece?.id !== undefined ? `tarifs:${piece.id}` : null);
export const estPieceApple = (piece) => piece?.table === 'tarifs_apple_devices';

export const nomPiece = (piece, marque = piece?.marque, modele = piece?.modele) =>
  `${[marque, modele].filter(Boolean).join(' ')} · ${piece?.type_piece || ''}${piece?.qualite ? ` ${piece.qualite}` : ''}`.trim();

// Libellé de la source d'un prix : relevés fournisseurs saisis par l'admin, sinon ceux de l'historique
export function libelleSourcePiece(source) {
  if (source === 'utopya') return 'Relevé chez Utopya';
  if (source === 'mobilax') return 'Relevé chez Mobilax';
  if (source === 'a_renseigner') return 'Prix à renseigner';
  return libelleSource(source);
}

export const SOURCES_SAISIE = Object.freeze([
  { cle: 'manuel', libelle: 'Saisie manuelle' },
  { cle: 'utopya', libelle: 'Utopya' },
  { cle: 'mobilax', libelle: 'Mobilax' },
]);

// « 42,5 » → 42.5 ; vide ou illisible → NaN
export function nombre(valeur) {
  if (valeur === null || valeur === undefined) return NaN;
  const t = String(valeur).trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return NaN;
  return Number(t);
}

const deuxDecimales = (n) => Number(n).toFixed(2).replace('.', ',');
const texteTva = (tva) => String(Number(tva) || 1.2).replace('.', ',');

/** Prix à renseigner : pièce pré-créée (HT à 0) ou sans prix client exploitable. */
export function prixARenseigner(piece) {
  if (!piece) return false;
  if (piece.a_renseigner === true) return true;
  const ht = piece.prix_fournisseur_ht;
  if (ht !== null && ht !== undefined && Number(ht) <= 0) return true;
  const client = piece.prix_client;
  return client === null || client === undefined || Number(client) <= 0;
}

// ─── Méthode de calcul (mêmes règles que services/prix.py, via prixClientPiece) ───
/** Détail du calcul d'un prix client : { ht, tva, marge, brut, arrondi } ou null si le HT est inconnu. */
export function detailCalcul(ht, typePiece, categorie, regles) {
  const h = Number(ht);
  if (ht === null || ht === undefined || ht === '' || !Number.isFinite(h) || h <= 0) return null;
  const r = fusionnerRegles(regles);
  const cat = String(categorie || 'standard').toLowerCase();
  // iPad / MacBook (tarifs_apple_devices) : marge de l'appareil, écran ou batterie
  const apple = cat === 'ipad' || cat === 'macbook';
  const marge = apple ? r[cat] : estEcran(typePiece) ? (r.ecran[cat] ?? r.ecran.standard) : r.autre;
  const brut = Math.round((h * r.tva + marge) * 100) / 100;
  const arrondi = apple ? prixClientApple(h, cat, r) : prixClientPiece(h, typePiece, cat, r);
  return { ht: h, tva: r.tva, marge, brut, arrondi };
}

/** « 42,00 × 1,2 + 60 = 110,40 → 119 € » */
export function texteCalcul(calcul) {
  if (!calcul || calcul.ht === null || calcul.ht === undefined) return '';
  const brut = calcul.brut ?? Math.round((Number(calcul.ht) * Number(calcul.tva) + Number(calcul.marge)) * 100) / 100;
  return `${deuxDecimales(calcul.ht)} × ${texteTva(calcul.tva)} + ${Number(calcul.marge)} = ${deuxDecimales(brut)} → ${calcul.arrondi} €`;
}

// Calcul d'une pièce : celui du serveur quand il est là, sinon le même calcul avec les règles connues
export function calculPiece(piece, regles) {
  if (piece?.calcul && piece.calcul.arrondi !== null && piece.calcul.arrondi !== undefined) return piece.calcul;
  return detailCalcul(piece?.prix_fournisseur_ht, piece?.type_piece, piece?.categorie, regles);
}

// ─── Liens profonds fournisseurs (contrat de faisabilité, aucune requête depuis l'app) ───
export const slugModele = (modele) => sansAccents(modele).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const requeteFournisseur = (parties) => new URLSearchParams({ q: parties.filter(Boolean).join(' ').trim() }).toString();

export function lienUtopya({ marque, modele, typePiece } = {}) {
  const q = [marque, modele, typePiece ? sansAccents(typePiece) : ''].filter(Boolean).join(' ').trim();
  if (!q) return 'https://www.utopya.fr/';
  return `https://www.utopya.fr/catalogsearch/result/?${requeteFournisseur([q])}`;
}

// Page catégorie Mobilax quand marque + modèle sont connus (mêmes motifs que _mobilax_urls du serveur),
// sinon la recherche du site (le modèle seul suffit : « galaxy a54 ecran »)
export function lienMobilax({ marque, modele, typePiece } = {}) {
  const brand = sansAccents(marque).trim();
  const slug = slugModele(modele);
  const base = 'https://www.mobilax.fr';
  if (slug) {
    if (brand === 'apple' && slug.includes('iphone')) return `${base}/pieces-detachees/telephonie/apple/iphone/${slug}`;
    if (brand === 'samsung') {
      for (const serie of ['galaxy-a', 'galaxy-s', 'galaxy-z', 'galaxy-m']) {
        if (slug.includes(serie)) return `${base}/pieces-detachees/telephonie/samsung/${serie}/${slug}`;
      }
    }
    if (brand === 'xiaomi') {
      const serie = slug.includes('redmi-note') ? 'redmi-note-series' : slug.includes('redmi') ? 'redmi-series' : slug.includes('poco') ? 'poco-series' : 'mi-series';
      return `${base}/marques/xiaomi/telephonie/${serie}/${slug}`;
    }
    if (brand === 'huawei') {
      const serie = /^(p-smart|p20|p30|p40|p50)/.test(slug) ? 'series-p' : slug.startsWith('nova') ? 'series-nova' : 'series-y';
      return `${base}/marques/huawei/telephonie/${serie}/${slug}`;
    }
    if (brand === 'honor') {
      const serie = slug.startsWith('x') ? 'series-x' : slug.includes('magic') ? 'series-magic' : 'series-70-90-200';
      return `${base}/marques/honor/telephonie/${serie}/${slug}`;
    }
    if (brand === 'oneplus') return `${base}/marques/oneplus/telephonie/${slug.includes('nord') ? 'series-nord' : 'series-9-10-11-12-13'}/${slug}`;
    if (brand === 'oppo') return `${base}/marques/oppo/telephonie/${slug.startsWith('find') ? 'series-find' : slug.startsWith('reno') ? 'series-reno' : 'series-a'}/${slug}`;
    if (brand === 'google') return `${base}/marques/google/telephonie/pixel/${slug}`;
    if (brand === 'motorola') return `${base}/marques/motorola/telephonie/${slug.includes('edge') ? 'edge' : slug.includes('moto-e') ? 'moto-e' : 'moto-g'}/${slug}`;
  }
  const q = [modele, typePiece ? sansAccents(typePiece) : ''].filter(Boolean).join(' ').trim();
  return q ? `${base}/recherche?${requeteFournisseur([q])}` : `${base}/`;
}

export function liensFournisseur(params) {
  return { utopya: lienUtopya(params), mobilax: lienMobilax(params) };
}

export function LiensFournisseur({ liens, compact = false, className = '' }) {
  if (!liens) return null;
  const cls = compact ? 'btn-ghost btn-sm' : 'btn-secondary btn-sm';
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      {liens.utopya && (
        <a href={liens.utopya} target="_blank" rel="noopener noreferrer" className={cls}>
          <ExternalLink aria-hidden="true" /> Chercher chez Utopya<span className="sr-only"> (nouvel onglet)</span>
        </a>
      )}
      {liens.mobilax && (
        <a href={liens.mobilax} target="_blank" rel="noopener noreferrer" className={cls}>
          <ExternalLink aria-hidden="true" /> Chercher chez Mobilax<span className="sr-only"> (nouvel onglet)</span>
        </a>
      )}
    </span>
  );
}

// ─── Volet « Mettre à jour le HT » ────────────────
// `brouillon` : saisie d'un envoi qui a échoué ({ ht, source, ref, url, erreur }), reprise telle quelle.
function EditeurHt({ piece, nom, regles, liens, onEnregistrer, onFermer, brouillon = null }) {
  const idBase = useId();
  const champRef = useRef(null);
  const [ht, setHt] = useState(() => brouillon?.ht ?? (Number(piece.prix_fournisseur_ht) > 0 ? deuxDecimales(piece.prix_fournisseur_ht) : ''));
  const [source, setSource] = useState(brouillon?.source ?? 'manuel');
  const [ref, setRef] = useState(brouillon?.ref ?? (piece.ref_fournisseur || ''));
  const [url, setUrl] = useState(brouillon?.url ?? (piece.url_fournisseur || ''));
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(brouillon?.erreur || '');

  useEffect(() => { champRef.current?.focus(); }, []);

  const montant = nombre(ht);
  const apercu = Number.isFinite(montant) && montant > 0 ? detailCalcul(montant, piece.type_piece, piece.categorie, regles) : null;
  const verrou = !!(piece.verrou ?? piece.verrou_manuel);
  const ancien = Number(piece.prix_fournisseur_ht) > 0 ? Number(piece.prix_fournisseur_ht) : null;
  const alertes = apercu && !verrou
    ? alertesPrix({ ancienHt: ancien, nouveauHt: montant, client: apercu.arrondi, ecran: estEcran(piece.type_piece) }, regles)
    : [];
  let erreurSaisie = '';
  if (!ht.trim()) erreurSaisie = 'Saisissez le nouveau prix d’achat HT.';
  else if (!Number.isFinite(montant) || montant <= 0) erreurSaisie = 'Prix d’achat HT : un montant en euros, supérieur à 0.';
  else if (montant > 5000) erreurSaisie = 'Prix d’achat HT : 5 000 € au maximum.';
  else if (url.trim() && !/^https?:\/\//i.test(url.trim())) erreurSaisie = 'Adresse fournisseur : elle commence par https://';

  async function valider(e) {
    e?.preventDefault();
    if (erreurSaisie || envoi) { setErreur(erreurSaisie); return; }
    setEnvoi(true);
    setErreur('');
    const corps = { prix_fournisseur_ht: Math.round(montant * 100) / 100, source };
    if (ref.trim()) corps.ref_fournisseur = ref.trim();
    if (avecUrl && url.trim()) corps.url_fournisseur = url.trim();
    // Optimiste : la ligne affiche le nouveau prix et le volet se ferme sans attendre le serveur ;
    // un échec rouvre le volet avec la saisie et le message (la ligne garde ses anciennes valeurs)
    onEnregistrer(corps, { prixClientPrevu: apercu && !verrou ? apercu.arrondi : null, saisie: { ht, source, ref, url } });
    onFermer();
  }

  const fournisseurChoisi = source !== 'manuel';
  const avecUrl = !estPieceApple(piece);
  return (
    <form onSubmit={valider} aria-label={`Mettre à jour le prix d’achat HT de ${nom}`}
      className="card-section border border-brand-200 bg-brand-50/40 space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,180px)_1fr] sm:items-end">
        <div>
          <label htmlFor={`${idBase}-ht`} className="input-label">Nouveau prix d’achat HT (€)</label>
          <input ref={champRef} id={`${idBase}-ht`} type="text" inputMode="decimal" value={ht} autoComplete="off"
            onChange={(e) => { setHt(e.target.value); setErreur(''); }}
            aria-describedby={`${idBase}-apercu`} className="input tabular-nums" placeholder="42,00" />
        </div>
        <div>
          <span id={`${idBase}-source`} className="input-label">Source du prix</span>
          <div className="segmented" role="group" aria-labelledby={`${idBase}-source`}>
            {SOURCES_SAISIE.map((s) => (
              <button key={s.cle} type="button" aria-pressed={source === s.cle} onClick={() => setSource(s.cle)}
                className={`segmented-item ${source === s.cle ? 'segmented-item-active' : ''}`}>
                {s.libelle}
              </button>
            ))}
          </div>
        </div>
      </div>

      {fournisseurChoisi && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${idBase}-ref`} className="input-label">Référence fournisseur (facultatif)</label>
            <input id={`${idBase}-ref`} type="text" value={ref} maxLength={120} onChange={(e) => setRef(e.target.value)} className="input" />
          </div>
          {avecUrl && (
            <div>
              <label htmlFor={`${idBase}-url`} className="input-label">Adresse de la fiche (facultatif)</label>
              <input id={`${idBase}-url`} type="url" value={url} maxLength={500} onChange={(e) => { setUrl(e.target.value); setErreur(''); }}
                className="input" placeholder="https://…" />
            </div>
          )}
        </div>
      )}

      {/* Aperçu : le nouveau prix client AVANT validation, mêmes règles que le serveur */}
      <div id={`${idBase}-apercu`} aria-live="polite" className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm">
        {apercu ? (
          <>
            <p className="font-medium text-slate-900 tabular-nums">
              Calcul : {texteCalcul(apercu)}
            </p>
            <p className="text-slate-700 tabular-nums">
              {verrou
                ? <>Prix client verrouillé : reste à <strong>{euros(piece.prix_client)}</strong> (cadenas).</>
                : Number(piece.prix_client) === apercu.arrondi
                  ? <>Prix client inchangé : <strong>{euros(apercu.arrondi)}</strong></>
                  : <>Prix client : {Number(piece.prix_client) > 0 ? <>{euros(piece.prix_client)} → </> : null}<strong>{euros(apercu.arrondi)}</strong></>}
            </p>
            {alertes.includes('variation') && (
              <p className="inline-flex items-center gap-1 text-amber-800 mt-1"><AlertTriangle className="w-4 h-4" aria-hidden="true" /> Grosse variation par rapport au prix d’achat actuel ({euros(ancien)} HT).</p>
            )}
            {alertes.includes('marge') && (
              <p className="inline-flex items-center gap-1 text-amber-800 mt-1"><AlertTriangle className="w-4 h-4" aria-hidden="true" /> Marge faible sur cet écran avec ce prix client.</p>
            )}
          </>
        ) : (
          <p className="text-slate-500">Saisissez le prix d’achat HT : le prix client calculé s’affiche ici avant d’enregistrer.</p>
        )}
      </div>

      {erreur && <p role="alert" className="input-error">{erreur}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={envoi || !!erreurSaisie} className="btn-primary btn-sm">
          {envoi ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
          {envoi ? 'Enregistrement…' : apercu && !verrou ? `Valider : ${euros(apercu.arrondi)}` : 'Valider'}
        </button>
        <button type="button" onClick={onFermer} disabled={envoi} className="btn-secondary btn-sm">
          <X aria-hidden="true" /> Annuler
        </button>
        <LiensFournisseur liens={liens} compact className="sm:ml-auto" />
      </div>
    </form>
  );
}

// ─── Ligne ────────────────────────────────────────
/**
 * Props : piece, marque, modele, regles, seuils, isAdmin (édition), htVisible (prix d'achat reçus),
 * onEnregistrer(piece, corps) → Promise, onVerrou(piece), onStock(piece), enCours (id en cours d'écriture :
 * verrou… la ligne attend), envoiEnCours(id) (prix HT parti en arrière-plan : « Enregistrement… », la saisie
 * suivante reste possible, elle part après dans la file de la ligne),
 * marge (texte sous le prix, filtre « marges faibles »), nbColonnes (colSpan du volet).
 */
export default function PieceFournisseurRow({
  piece, marque, modele, regles = null, seuils = SEUILS_FRAICHEUR, isAdmin = false, htVisible = false,
  onEnregistrer, onVerrou, onStock, enCours = null, envoiEnCours = null, marge = null, nbColonnes = 6,
}) {
  const toast = useToast();
  const [edition, setEdition] = useState(false);
  const [brouillon, setBrouillon] = useState(null); // saisie d'un envoi échoué, reprise à la réouverture
  const montes = useRef(true);
  useEffect(() => { montes.current = true; return () => { montes.current = false; }; }, []);
  const Icone = getPieceIcon(piece.type_piece);
  const nom = nomPiece(piece, marque, modele);
  const aRenseigner = prixARenseigner(piece);
  const calcul = htVisible && !aRenseigner ? calculPiece(piece, regles) : null;
  const verrou = !!(piece.verrou ?? piece.verrou_manuel);
  const stockConnu = piece.en_stock !== null && piece.en_stock !== undefined;
  const enStock = piece.en_stock !== false;
  const ident = idPiece(piece);
  const occupe = enCours !== null && enCours !== undefined && ident !== null && enCours === ident;
  const envoi = ident !== null && typeof envoiEnCours === 'function' && !!envoiEnCours(ident);
  // Pièce fournisseur (tarifs) ou écran / batterie d'un iPad / MacBook (tarifs_apple_devices, device_id)
  const editable = isAdmin && (!piece.table || piece.table === 'tarifs' || (estPieceApple(piece) && piece.device_id !== null && piece.device_id !== undefined));
  const liens = piece.liens?.utopya || piece.liens?.mobilax ? piece.liens : liensFournisseur({ marque, modele, typePiece: piece.type_piece });
  const htConnu = piece.prix_fournisseur_ht !== null && piece.prix_fournisseur_ht !== undefined;
  const classeLigne = `table-row ${!enStock ? 'opacity-80' : ''}`;

  // Envoi en arrière-plan (volet déjà fermé) : un échec rouvre le volet avec la saisie et l'erreur
  function enregistrer(corps, { prixClientPrevu = null, saisie = null } = {}) {
    Promise.resolve()
      .then(() => onEnregistrer(piece, corps, { prixClientPrevu }))
      .catch((err) => {
        const msg = messageErreurPrix(err, 'Prix non enregistré');
        // Identification admin annulée (pas de message) : rien n'est rouvert, la ligne est rétablie
        if (!msg) return;
        // Ligne plus affichée (page quittée, filtre changé) : notification globale, rien à rouvrir
        if (!montes.current) { toast.error(msg); return; }
        setBrouillon({ ...(saisie || {}), erreur: msg });
        setEdition(true);
      });
  }

  return (
    <>
      <tr className={classeLigne} data-piece-id={ident || undefined} aria-busy={occupe || envoi || undefined}>
        <td className="table-sticky-col">
          <div className="flex items-center gap-2 min-w-0">
            <Icone className="w-4 h-4 shrink-0 text-slate-400" aria-hidden="true" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-slate-900">{piece.type_piece}</span>
                {piece.qualite && <span className="badge badge-sm badge-neutral">{piece.qualite}</span>}
                {aRenseigner && (
                  <span className="badge badge-sm badge-warning"><AlertTriangle className="w-3 h-3" aria-hidden="true" /> Prix à renseigner</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                {!stockConnu ? null : isAdmin && onStock && !estPieceApple(piece) ? (
                  <button type="button" onClick={() => onStock(piece)} aria-pressed={!enStock}
                    aria-label={`${nom} : ${enStock ? 'en stock' : 'en rupture'}. Changer`}
                    className="inline-flex items-center justify-center min-h-[44px] -my-2 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    <span className={`badge badge-sm ${enStock ? 'badge-success' : 'badge-danger'}`}>{enStock ? 'En stock' : 'Rupture'}</span>
                  </button>
                ) : (
                  <span className={`badge badge-sm ${enStock ? 'badge-success' : 'badge-danger'}`}>{enStock ? 'En stock' : 'Rupture'}</span>
                )}
                {isAdmin && onVerrou
                  ? <BoutonVerrou verrouille={verrou} onClick={() => onVerrou(piece)} disabled={occupe || envoi} nom={`le prix de ${nom}`} />
                  : <BoutonVerrou verrouille={verrou} lectureSeule nom={nom} />}
              </div>
            </div>
          </div>
        </td>

        {htVisible && (
          <td className="tabular-nums align-top">
            {aRenseigner ? (
              // Pièce pré-créée sans prix : rien à dater ni à sourcer (le badge « Prix à renseigner » est
              // déjà sur la ligne), seulement la saisie
              editable ? (
                <button type="button" onClick={() => setEdition((v) => !v)} aria-expanded={edition} disabled={occupe}
                  aria-label={`Saisir le prix d’achat HT de ${nom}`} className="btn-ghost btn-sm -my-1 -ml-3 text-amber-800">
                  <Pencil aria-hidden="true" /> Saisir le HT
                </button>
              ) : (
                <span className="text-slate-400">—</span>
              )
            ) : (
              <>
                {htConnu && editable ? (
                  // Éditable au clic : le montant ouvre le volet « Mettre à jour le HT »
                  <button type="button" onClick={() => setEdition((v) => !v)} aria-expanded={edition} disabled={occupe}
                    aria-label={`Modifier le prix d’achat HT de ${nom}`}
                    className="font-medium text-slate-900 underline decoration-dotted decoration-slate-400 underline-offset-4 hover:text-brand-700 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 min-h-[44px] -my-2">
                    {deuxDecimales(piece.prix_fournisseur_ht)} € HT
                  </button>
                ) : htConnu ? (
                  <span className="font-medium text-slate-900">{deuxDecimales(piece.prix_fournisseur_ht)} € HT</span>
                ) : (
                  <span className="text-slate-400" title="Masqué sans le code administrateur"><Lock className="w-4 h-4 inline" aria-hidden="true" /><span className="sr-only">Prix d’achat masqué</span></span>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                  {(occupe || envoi) && (
                    <span role="status" className="inline-flex items-center gap-1 font-medium text-slate-600">
                      <Loader2 className="w-3 h-3 motion-safe:animate-spin" aria-hidden="true" /> Enregistrement…
                    </span>
                  )}
                  <BadgeDatePrix row={piece} seuils={seuils} court />
                  <span>{libelleSourcePiece(piece.prix_source)}</span>
                  {piece.ref_fournisseur && <span>· réf. {piece.ref_fournisseur}</span>}
                  {piece.url_fournisseur && (
                    // Cible tactile de 44 px sans écarter la ligne de 16 px (marges négatives)
                    <a href={piece.url_fournisseur} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 min-h-[44px] -my-[14px] px-1 -mx-1 text-brand-700 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                      <ExternalLink className="w-3 h-3" aria-hidden="true" /> fiche<span className="sr-only"> fournisseur (nouvel onglet)</span>
                    </a>
                  )}
                </div>
              </>
            )}
          </td>
        )}

        {htVisible && (
          <td className="text-xs text-slate-500 tabular-nums align-top">
            {calcul ? <span className="whitespace-nowrap">{texteCalcul(calcul)}</span> : <span aria-hidden="true">—</span>}
            {calcul && verrou && <div className="text-amber-800">Prix client fixé à la main</div>}
          </td>
        )}

        <td className="table-cell-num align-top">
          {aRenseigner || !(Number(piece.prix_client) > 0) ? <span className="text-slate-400 font-normal">—</span> : <span className="text-base">{euros(piece.prix_client)}</span>}
          {marge && <div className="text-xs mt-1 font-semibold text-red-700 tabular-nums">{marge}</div>}
        </td>

        {!htVisible && (
          <td className="align-top">
            {aRenseigner ? <span className="text-slate-400">—</span> : <BadgeDatePrix row={piece} seuils={seuils} court />}
          </td>
        )}

        {isAdmin && (
          <td className="align-top">
            {editable ? (
              <button type="button" onClick={() => setEdition((v) => !v)} aria-expanded={edition} disabled={occupe}
                aria-label={`Mettre à jour le HT — ${piece.type_piece}${piece.qualite ? ` ${piece.qualite}` : ''}`}
                title="Mettre à jour le prix d’achat HT" className="btn-secondary btn-sm whitespace-nowrap">
                {occupe || envoi ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Pencil aria-hidden="true" />}
                <span className="hidden 2xl:inline">Mettre à jour le HT</span><span className="2xl:hidden">HT</span>
              </button>
            ) : (
              <span className="table-cell-muted">Par import</span>
            )}
          </td>
        )}
      </tr>

      {edition && editable && (
        <tr>
          {/* Le volet occupe la largeur VISIBLE du tableau (100cqw : le .table-wrap est un conteneur de taille)
              et reste collé à gauche quand le tableau défile sur téléphone ; sans cqw, il prend la ligne entière */}
          <td colSpan={nbColonnes} className="bg-slate-50/60 !px-0">
            <div className="sticky left-4 w-[calc(100cqw-2rem)] max-w-full mx-4">
              <EditeurHt piece={piece} nom={nom} regles={regles} liens={liens} brouillon={brouillon}
                onEnregistrer={enregistrer} onFermer={() => { setEdition(false); setBrouillon(null); }} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Tableau d'un modèle ──────────────────────────
/**
 * Tableau des pièces d'un modèle : une ligne par pièce (type, qualité). Colonnes HT et Calcul seulement
 * quand les prix d'achat sont reçus (admin avec le code saisi) ; actions pour l'admin.
 */
export function TableauPieces({
  pieces, marque, modele, regles, seuils, isAdmin, htVisible, onEnregistrer, onVerrou, onStock, enCours, envoiEnCours, margeDe, dense = false,
}) {
  const colonnes = 2 + (htVisible ? 2 : 1) + (isAdmin ? 1 : 0);
  // `relative` : les textes « sr-only » (en-tête « Actions », liens) sont en position absolue ; sans ancêtre
  // positionné dans le conteneur défilant, ils échappent au rognage et élargissent la page de toute la
  // largeur du tableau. `container-type` : le volet « Mettre à jour le HT » se dimensionne en 100cqw.
  return (
    <div className={`table-wrap relative [container-type:inline-size] ${dense ? 'table-dense' : ''}`}>
      <table className="table">
        <thead>
          <tr className="table-header border-b border-slate-200 bg-slate-50">
            <th scope="col" className="table-sticky-col bg-slate-50">Pièce</th>
            {htVisible && <th scope="col">Prix fournisseur HT</th>}
            {htVisible && <th scope="col">Calcul</th>}
            <th scope="col" className="text-right">Prix client TTC</th>
            {!htVisible && <th scope="col">Prix du</th>}
            {isAdmin && <th scope="col"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {pieces.map((p) => (
            <PieceFournisseurRow key={idPiece(p) ?? `${p.type_piece}-${p.qualite || ''}`} piece={p} marque={marque} modele={modele}
              regles={regles} seuils={seuils} isAdmin={isAdmin} htVisible={htVisible} onEnregistrer={onEnregistrer}
              onVerrou={onVerrou} onStock={onStock} enCours={enCours} envoiEnCours={envoiEnCours} marge={margeDe ? margeDe(p) : null} nbColonnes={colonnes} />
          ))}
        </tbody>
      </table>
      {htVisible && <p className="sm:hidden t-caption px-4 py-2 border-t border-slate-100">Faites défiler le tableau vers la droite pour le calcul et le prix client.</p>}
    </div>
  );
}
