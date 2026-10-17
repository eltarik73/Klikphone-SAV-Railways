import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X, Tag, AlertTriangle, RotateCcw, Package, Clock, ChevronDown } from 'lucide-react';
import api from '../lib/api';
import { formatPrix } from '../lib/utils';
import { useFocusTrap } from '../hooks/useFocusTrap';

const DELAI_RECHERCHE = 250;
const LIMITE = 20;

const SOURCES = {
  tarifs: 'Fournisseur',
  tarifs_reparation: 'Grille iPhone',
  tarifs_apple_devices: 'Grille Apple',
  iphone_tarifs: 'Vente iPhone',
  smartphones_tarifs: 'Vente smartphone',
};

// Âge d'un prix (jours) : gris avant 90 j, orange de 90 à 180 j, rouge au-delà (règles par défaut du serveur)
export const SEUILS_FRAICHEUR = { aRevoir: 90, perime: 180 };
const NIVEAUX = new Set(['ok', 'a_revoir', 'perime']);
const JOUR_MS = 86_400_000;

const TON_FRAICHEUR = {
  ok: 'bg-slate-100 text-slate-700 ring-slate-200',
  a_revoir: 'bg-amber-50 text-amber-900 ring-amber-300',
  perime: 'bg-red-50 text-red-800 ring-red-200',
};
const MOT_FRAICHEUR = { ok: '', a_revoir: 'à revoir', perime: 'périmé' };
// Prix décidés par la boutique (forfaits iPhone, grilles de vente) : jamais « estimés », seulement à revoir
const SOURCES_BOUTIQUE = new Set(['tarifs_reparation', 'iphone_tarifs', 'smartphones_tarifs']);

const simplifier = (s) => String(s ?? '').normalize('NFKD').replace(/\p{Mn}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export function libelleSource(source) {
  return SOURCES[source] || String(source || 'Grille');
}

/** Couleur du stock fournisseur (texte libre côté serveur : « En stock », « Rupture », « Sur commande »…). */
export function tonStock(stock) {
  const s = String(stock ?? '').trim();
  if (!s) return null;
  if (/rupture|hors|indispon|[ée]puis|^non\b|^0$/i.test(s)) return 'bg-red-50 text-red-800 ring-red-200';
  if (/commande|d[ée]lai/i.test(s)) return 'bg-amber-50 text-amber-900 ring-amber-200';
  if (/stock|dispo|^oui\b|^\d+$/i.test(s)) return 'bg-emerald-50 text-emerald-800 ring-emerald-200';
  return 'bg-slate-100 text-slate-700 ring-slate-200';
}

function prixValide(v) {
  // null / vide : inconnu (Number(null) vaudrait 0 : « Achat HT 0.00 € » sur un forfait boutique)
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dateValide(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « févr. 2026 » */
export function moisAnnee(date) {
  const d = dateValide(date);
  return d ? d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }) : '';
}

/**
 * Fraîcheur d'un prix de la grille : { niveau, libelle, mot, estime, boutique, jours, description } ou null
 * (date inconnue). Le serveur fournit fraicheur / age_jours / prix_maj_le / estime ; à défaut, calcul local.
 * Mêmes couleurs et seuils pour tous ; le texte dépend de la source : un prix fournisseur ancien est
 * « à vérifier avant de l'annoncer », un prix fixé par la boutique est seulement « non revu depuis N j ».
 */
export function fraicheurPrix(s, maintenant = Date.now()) {
  if (!s) return null;
  const date = dateValide(s.prix_maj_le);
  const age = Number(s.age_jours);
  let jours = s.age_jours !== null && s.age_jours !== undefined && s.age_jours !== '' && Number.isFinite(age) ? Math.max(0, Math.floor(age)) : null;
  if (jours === null && date) jours = Math.max(0, Math.floor((maintenant - date.getTime()) / JOUR_MS));
  const estime = s.estime === true || /^estimation/i.test(String(s.prix_source || ''));
  let niveau = NIVEAUX.has(s.fraicheur) ? s.fraicheur : null;
  if (!niveau && jours !== null) {
    niveau = jours > SEUILS_FRAICHEUR.perime ? 'perime' : jours >= SEUILS_FRAICHEUR.aRevoir ? 'a_revoir' : 'ok';
  }
  if (!niveau && !estime) return null;
  niveau = niveau || 'ok';
  const boutique = SOURCES_BOUTIQUE.has(s.source);
  const mois = date ? moisAnnee(date) : '';
  let libelle;
  let mot;
  if (boutique) {
    libelle = mois ? `grille revue en ${mois}` : jours !== null ? `grille revue il y a ${jours} j` : 'date de la grille inconnue';
    mot = niveau === 'ok' ? '' : jours !== null ? `non revue depuis ${jours} j` : 'à revoir';
  } else {
    // Élision : « prix d’avr. 2026 », « prix d’oct. 2026 », « prix de févr. 2026 »
    libelle = mois ? `prix ${/^[aeiouyéè]/i.test(mois) ? 'd’' : 'de '}${mois}`
      : jours !== null ? `prix d’il y a ${jours} j` : 'date du prix inconnue';
    mot = MOT_FRAICHEUR[niveau];
  }
  const morceaux = [libelle];
  if (estime) morceaux.push('estimé');
  if (mot) morceaux.push(mot);
  return { niveau, libelle, mot, estime, boutique, jours, description: morceaux.join(', ') };
}

/** Infobulle du badge : un prix boutique ancien est à revoir par le gérant, pas « à vérifier ». */
function titreFraicheur({ niveau, estime, boutique, jours }) {
  const connu = jours !== null && jours !== undefined;
  const pluriel = jours > 1 ? 's' : '';
  if (boutique) {
    return [
      'Prix fixé par la boutique',
      connu ? `grille revue il y a ${jours} jour${pluriel}` : 'date de la grille inconnue',
      niveau !== 'ok' ? 'le gérant peut la revoir' : '',
    ].filter(Boolean).join(' — ');
  }
  return [
    connu ? `Prix mis à jour il y a ${jours} jour${pluriel}` : 'Date du prix inconnue',
    estime ? 'estimation jamais confirmée par une facture' : '',
    niveau === 'perime' ? 'à vérifier avant de l’annoncer' : niveau === 'a_revoir' ? 'à revoir' : '',
  ].filter(Boolean).join(' — ');
}

/** Badge « prix de févr. 2026 · estimé » (gris, orange ou rouge, icône en plus de la couleur). */
export function BadgeFraicheur({ fraicheur, className = '' }) {
  if (!fraicheur) return null;
  const { niveau, libelle, estime } = fraicheur;
  const mot = fraicheur.mot ?? MOT_FRAICHEUR[niveau];
  const Icone = niveau === 'perime' ? AlertTriangle : niveau === 'a_revoir' ? Clock : null;
  return (
    <span title={titreFraicheur(fraicheur)}
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded ring-1 font-semibold ${TON_FRAICHEUR[niveau] || TON_FRAICHEUR.ok} ${className}`}>
      {Icone && <Icone className="w-3 h-3" aria-hidden="true" />}
      {libelle}{estime ? ' · estimé' : ''}
      {mot && <span className="sr-only"> ({mot})</span>}
    </span>
  );
}

/**
 * Répartition des suggestions : grille boutique d'abord, pièces fournisseur repliées dessous quand
 * l'iPhone est couvert par la grille boutique (groupe fourni par le serveur), ventes à part.
 * Sans champ `groupe` (ancien serveur) : une seule liste, dans l'ordre reçu.
 */
export function grouperSuggestions(liste) {
  const boutique = [];
  const fournisseur = [];
  const vente = [];
  for (const s of liste || []) {
    if (!s || s.obsolete) continue;
    if (s.groupe === 'fournisseur') fournisseur.push(s);
    else if (s.groupe === 'vente') vente.push(s);
    else boutique.push(s);
  }
  const replie = fournisseur.length > 0 && boutique.some(s => s.groupe === 'boutique');
  return { boutique, fournisseur, vente, replie };
}

/**
 * Suggestion de la grille → ligne de réparation du ticket { label, prix, source, tarif_id, qualite }.
 * Le serveur conserve source / tarif_id / qualite ; les montants ne lisent que label et prix.
 */
export function ligneDepuisSuggestion(s) {
  const ligne = { label: String(s?.label ?? '').trim(), prix: prixValide(s?.prix) ?? 0 };
  if (s?.source) ligne.source = String(s.source);
  if (s?.id !== undefined && s?.id !== null && s?.id !== '') ligne.tarif_id = String(s.id);
  if (s?.qualite) ligne.qualite = String(s.qualite);
  return ligne;
}

// Clés de pièces à coût d'achat (format de grille.py, validé par parts.py : une clé invalide refuse la commande)
const CLE_PIECE = /^(?:tarifs:[1-9]\d*|tarifs_apple_devices:[1-9]\d*:[a-z_]+)$/;

/**
 * Ligne de réparation du ticket → tarif_cle de la commande de pièce (« tarifs:123 »), ou null.
 * Seules les pièces fournisseur et iPad / MacBook ont un coût d'achat à rapprocher du HT payé.
 */
export function cleCommandeDepuisLigne(ligne) {
  const source = String(ligne?.source || '');
  const cle = String(ligne?.tarif_id || '').trim();
  if (source !== 'tarifs' && source !== 'tarifs_apple_devices') return null;
  return cle.startsWith(`${source}:`) && CLE_PIECE.test(cle) ? cle : null;
}

function LigneSuggestion({ s, modele, isAdmin, onChoisir }) {
  const prix = prixValide(s.prix);
  const ton = tonStock(s.stock);
  const cout = isAdmin ? prixValide(s.cout_ht) : null;
  const fraicheur = fraicheurPrix(s);
  // Recherche libre : le modèle de la ligne n'est pas forcément celui du ticket
  const autreModele = s.modele && simplifier(s.modele) !== simplifier(modele) ? String(s.modele) : '';
  return (
    <li>
      <button
        type="button"
        onClick={() => onChoisir(s)}
        className="w-full min-h-14 flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/50 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        aria-label={`Ajouter ${s.label}${autreModele ? ` (${autreModele})` : ''}${s.stock ? `, ${s.stock}` : ''}, ${prix != null ? formatPrix(prix) : 'prix non renseigné'}${fraicheur ? `, ${fraicheur.description}` : ''}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">{s.label}</span>
          {autreModele && <span className="block text-xs font-medium text-slate-700">{autreModele}</span>}
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            {s.type_piece && <span className="text-slate-600">{s.type_piece}</span>}
            {s.qualite && <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-800 font-semibold">{s.qualite}</span>}
            {ton && (
              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded ring-1 font-semibold ${ton}`}>
                <Package className="w-3 h-3" aria-hidden="true" />{s.stock}
              </span>
            )}
            <BadgeFraicheur fraicheur={fraicheur} />
            <span className="text-slate-600">{libelleSource(s.source)}</span>
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-base font-extrabold text-slate-900">{prix != null ? formatPrix(prix) : '—'}</span>
          {cout != null && <span className="block text-[11px] text-slate-600">Achat HT {formatPrix(cout)}</span>}
        </span>
      </button>
    </li>
  );
}

function ListeSuggestions({ liste, ...props }) {
  return (
    <ul className="space-y-1.5">
      {liste.map((s, i) => <LigneSuggestion key={`${s.source}-${s.id ?? i}`} s={s} {...props} />)}
    </ul>
  );
}

/**
 * Choix d'une ligne dans les grilles tarifaires (GET /api/grille/suggestions), filtré par défaut
 * sur l'appareil du ticket. Le prix d'achat (cout_ht) ne s'affiche qu'à un administrateur.
 * Chaque prix porte sa date (badge de fraîcheur) ; pour un iPhone couvert par la grille boutique,
 * les pièces fournisseur du même type sont repliées sous « Autres pièces (fournisseur) ».
 */
export default function TarifPicker({ open, onClose, onChoisir, marque = '', modele = '', categorie = '', isAdmin = false }) {
  const titreId = useId();
  const rechercheId = useId();
  const fournisseurId = useId();
  const panneauRef = useRef(null);
  const seqRef = useRef(0);
  const appareil = `${marque || ''} ${modele || ''}`.trim();
  const [q, setQ] = useState('');
  const [surAppareil, setSurAppareil] = useState(true);
  const [qualite, setQualite] = useState('');
  const [voirFournisseur, setVoirFournisseur] = useState(false);
  const [etat, setEtat] = useState({ chargement: false, erreur: null, modeleTrouve: true, suggestions: [] });
  const [essai, setEssai] = useState(0);

  useFocusTrap(panneauRef, open, { onEscape: () => onClose?.(), initialFocus: 'input[type="search"]' });

  useEffect(() => {
    if (!open) return undefined;
    setQ('');
    setQualite('');
    setSurAppareil(true);
    setVoirFournisseur(false);
  }, [open]);

  const filtreAppareil = surAppareil && !!appareil;

  useEffect(() => {
    if (!open) return undefined;
    const seq = ++seqRef.current;
    setEtat(e => ({ ...e, chargement: true, erreur: null }));
    const timer = setTimeout(() => {
      const params = { q: q.trim(), limit: LIMITE };
      if (filtreAppareil) Object.assign(params, { marque, modele, categorie });
      api.getGrilleSuggestions(params)
        .then((data) => {
          if (seq !== seqRef.current) return;
          // Lignes obsolètes (absentes du dernier fichier fournisseur) : jamais proposées
          const suggestions = Array.isArray(data?.suggestions)
            ? data.suggestions.filter(s => s && !s.obsolete && String(s.label ?? '').trim())
            : [];
          setEtat({ chargement: false, erreur: null, modeleTrouve: data?.modele_trouve !== false, suggestions });
        })
        .catch((err) => {
          if (seq !== seqRef.current) return;
          setEtat(e => ({ ...e, chargement: false, erreur: err?.message || 'Grille indisponible', suggestions: [] }));
        });
    }, q ? DELAI_RECHERCHE : 0);
    return () => clearTimeout(timer);
  }, [open, q, filtreAppareil, marque, modele, categorie, essai]);

  const qualites = useMemo(() => {
    const vues = new Set();
    for (const s of etat.suggestions) if (s.qualite) vues.add(String(s.qualite));
    return [...vues];
  }, [etat.suggestions]);

  useEffect(() => {
    if (qualite && !qualites.includes(qualite)) setQualite('');
  }, [qualite, qualites]);

  if (!open) return null;

  const visibles = qualite ? etat.suggestions.filter(s => String(s.qualite || '') === qualite) : etat.suggestions;
  const groupes = grouperSuggestions(visibles);

  const choisir = (s) => {
    onChoisir?.(ligneDepuisSuggestion(s), s);
    onClose?.();
  };
  const propsLigne = { modele, isAdmin, onChoisir: choisir };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" aria-hidden="true" onClick={() => onClose?.()} />
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pointer-events-none">
        <div
          ref={panneauRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titreId}
          tabIndex={-1}
          className="pointer-events-auto bg-white w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-2xl focus:outline-none"
        >
          <div className="flex items-start gap-3 p-4 sm:p-5 border-b border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
              <Tag className="w-5 h-5 text-emerald-700" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id={titreId} className="text-base font-display font-bold text-slate-900">Ajouter depuis la grille</h2>
              <p className="text-xs text-slate-600 truncate">{appareil ? `Appareil du ticket : ${appareil}` : 'Appareil non renseigné : recherche dans toutes les grilles'}</p>
            </div>
            <button type="button" onClick={() => onClose?.()} className="btn-ghost p-0 min-w-11 min-h-11 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" aria-label="Fermer la grille">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <div className="p-4 sm:p-5 space-y-3 border-b border-slate-100">
            <div className="relative">
              <label htmlFor={rechercheId} className="sr-only">Rechercher dans la grille</label>
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                id={rechercheId}
                type="search"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Écran, batterie, OLED, connecteur…"
                className="input pl-9 min-h-11"
                style={{ fontSize: '16px' }}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {appareil && (
                <label className="inline-flex items-center gap-2 min-h-11 px-3 rounded-lg border border-slate-200 text-sm font-medium text-slate-800 cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={surAppareil} onChange={e => setSurAppareil(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                  {appareil} uniquement
                </label>
              )}
              {qualites.length > 1 && (
                <div role="group" aria-label="Filtrer par qualité" className="flex flex-wrap gap-1.5">
                  {['', ...qualites].map(v => (
                    <button
                      key={v || 'toutes'}
                      type="button"
                      aria-pressed={qualite === v}
                      onClick={() => setQualite(v)}
                      className={`min-h-11 px-3 rounded-lg text-xs font-bold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                        qualite === v ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                    >
                      {v || 'Toutes qualités'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {filtreAppareil && !etat.modeleTrouve && !etat.chargement && !etat.erreur && (
              <p className="flex items-start gap-1.5 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                <span>« {appareil} » n’est pas reconnu dans les grilles : résultats approchants. Décochez le filtre pour chercher partout.</span>
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2 sm:p-3" aria-busy={etat.chargement || undefined}>
            <p role="status" aria-live="polite" className="sr-only">
              {etat.chargement ? 'Recherche…' : etat.erreur ? '' : `${visibles.length} résultat${visibles.length > 1 ? 's' : ''}`}
            </p>
            {etat.erreur ? (
              <div className="p-4 text-center space-y-2">
                <p className="text-sm text-red-700 font-medium" role="alert">Grille indisponible : {etat.erreur}</p>
                <button type="button" onClick={() => setEssai(n => n + 1)} className="btn-secondary min-h-11 text-xs">
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Réessayer
                </button>
              </div>
            ) : etat.chargement && etat.suggestions.length === 0 ? (
              <ul className="space-y-2 p-1" aria-hidden="true">
                {[1, 2, 3].map(i => <li key={i} className="h-14 rounded-xl bg-slate-100 motion-safe:animate-pulse" />)}
              </ul>
            ) : visibles.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-600">
                Aucun tarif trouvé{q.trim() ? ` pour « ${q.trim()} »` : ''}. Saisie libre possible avec « Ajouter ».
              </p>
            ) : groupes.replie ? (
              <div className="space-y-3">
                <section aria-label="Grille boutique">
                  <h3 className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">Grille boutique</h3>
                  <ListeSuggestions liste={groupes.boutique} {...propsLigne} />
                </section>
                <section>
                  <button
                    type="button"
                    aria-expanded={voirFournisseur}
                    aria-controls={fournisseurId}
                    onClick={() => setVoirFournisseur(v => !v)}
                    className="w-full min-h-11 flex items-center justify-between gap-2 px-3 rounded-xl border border-dashed border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    <span>Autres pièces (fournisseur) · {groupes.fournisseur.length}</span>
                    <ChevronDown className={`w-4 h-4 shrink-0 motion-safe:transition-transform ${voirFournisseur ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                  <div id={fournisseurId} hidden={!voirFournisseur} className="pt-1.5">
                    {voirFournisseur && <ListeSuggestions liste={groupes.fournisseur} {...propsLigne} />}
                  </div>
                </section>
                {groupes.vente.length > 0 && (
                  <section aria-label="Téléphones à la vente">
                    <h3 className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">Téléphones à la vente</h3>
                    <ListeSuggestions liste={groupes.vente} {...propsLigne} />
                  </section>
                )}
              </div>
            ) : (
              <ListeSuggestions liste={visibles} {...propsLigne} />
            )}
          </div>

          <div className="p-3 sm:p-4 border-t border-slate-100 flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-600">Prix client TTC. La ligne reste modifiable après l’ajout.</p>
            <button type="button" onClick={() => onClose?.()} className="btn-secondary min-h-11 shrink-0">Fermer</button>
          </div>
        </div>
      </div>
    </>
  );
}
