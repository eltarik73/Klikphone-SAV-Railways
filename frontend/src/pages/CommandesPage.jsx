import { useState, useEffect, useMemo, useRef, useId } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useApi, invalidateCache } from '../hooks/useApi';
import api from '../lib/api';
import { formatDateShort, formatPrix, waLink } from '../lib/utils';
import { envoyerSms, messageSmsEnvoye } from '../lib/sms';
import { useSmsServeur } from '../hooks/useSmsServeur';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { matchesQuery, formatPhone } from '../components/SearchPalette';
import { fraicheurPrix } from '../components/TarifPicker';
import {
  Search, Package, Plus, Edit3, Trash2, Save, X,
  Check, Clock, AlertTriangle, ChevronDown, ExternalLink, Calendar,
  Truck, Wrench, Archive, ShoppingCart, UserCheck,
  MessageSquare, Send, Tag,
} from 'lucide-react';

const PART_STATUTS = ['Panier', 'En attente', 'Commandée', 'Reçu', 'En réparation', 'Donné au client', 'Clôturé'];
const STATUTS_TERMINAUX = ['Donné au client', 'Clôturé'];

// ─── Prix HT payé → proposition de mise à jour de la grille ───────────────
// Seules les pièces à coût d'achat (fournisseur, iPad/MacBook) se rattachent à une commande
const SOURCES_PIECES = new Set(['tarifs', 'tarifs_apple_devices']);
// Écart au-delà duquel le serveur crée une proposition (services/prix.creer_proposition)
export const ECART_PROPOSITION = 1;
export const MESSAGE_PROPOSITION = 'Proposition de mise à jour envoyée au gérant';

/** Nombre saisi (virgule acceptée) ou null. */
export function montantSaisi(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/\s|€/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Suggestions de la grille → pièces rattachables à une commande (lignes obsolètes exclues). */
export function piecesCommandables(suggestions) {
  return (Array.isArray(suggestions) ? suggestions : [])
    .filter(s => s && !s.obsolete && s.id && SOURCES_PIECES.has(s.source));
}

const mots = (s) => String(s ?? '').normalize('NFKD').replace(/\p{Mn}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Pièce pressentie d'après la désignation (type et qualité) : seulement si une seule ressort nettement. */
export function piecePressentie(description, pieces) {
  const desc = new Set(mots(description));
  if (!desc.size || !pieces?.length) return null;
  let meilleur = null;
  let egalite = false;
  for (const p of pieces) {
    const type = mots(p.type_piece)[0];
    if (!type || !desc.has(type)) continue;
    const qualite = mots(p.qualite);
    const score = 2 + (qualite.length && qualite.every(m => desc.has(m)) ? 1 : 0);
    if (!meilleur || score > meilleur.score) { meilleur = { p, score }; egalite = false; }
    else if (score === meilleur.score) egalite = true;
  }
  return meilleur && !egalite ? meilleur.p : null;
}

/** Le serveur signale-t-il une proposition créée ? true / false, ou null s'il ne le dit pas. */
export function propositionSignalee(res) {
  if (!res || typeof res !== 'object') return null;
  for (const k of ['proposition_id', 'proposition', 'proposition_creee']) {
    if (k in res) return Boolean(res[k]);
  }
  return null;
}

// Option de la liste : pièce (le modèle est celui du ticket), date du prix, HT pour l'admin
function libellePiece(s, isAdmin) {
  const morceaux = [String(s.label || '').replace(/^Forfait remplacement /i, 'Remplacement ')];
  const f = fraicheurPrix(s);
  if (f) morceaux.push(f.libelle + (f.estime ? ' · estimé' : ''));
  if (isAdmin && s.cout_ht != null) morceaux.push(`HT ${formatPrix(s.cout_ht)}`);
  return morceaux.join(' — ');
}

function appareilDeLigne(p) {
  const modele = (p?.modele && p.modele !== 'Autre' ? p.modele : p?.modele_autre) || '';
  return modele ? { marque: p.marque || '', modele, categorie: p.categorie || '' } : null;
}

/**
 * Pièces de la grille pour le modèle du ticket de la commande : appareil connu (ligne de la liste)
 * ou ticket résolu depuis son code (saisi dans le formulaire). Le coût HT n'arrive qu'à l'admin.
 */
function usePiecesGrille({ actif, appareil, ticketId, ticketCode }) {
  const [etat, setEtat] = useState({ statut: 'vide', pieces: [], appareil: null });
  const cleAppareil = appareil ? `${appareil.marque}|${appareil.modele}|${appareil.categorie}` : '';
  const code = String(ticketCode || '').trim();

  useEffect(() => {
    if (!actif || (!cleAppareil && !ticketId && code.length < 3)) {
      setEtat({ statut: 'vide', pieces: [], appareil: null });
      return undefined;
    }
    let annule = false;
    setEtat(e => ({ ...e, statut: 'chargement' }));
    const timer = setTimeout(async () => {
      try {
        let app = appareil;
        if (!app) {
          let id = ticketId;
          if (!id) {
            const r = await api.resolveCode(code).catch(() => null);
            id = r?.type === 'ticket' ? r.id : null;
          }
          const t = id ? await api.getTicket(id).catch(() => null) : null;
          app = t ? appareilDeLigne(t) : null;
        }
        if (annule) return;
        if (!app) { setEtat({ statut: 'introuvable', pieces: [], appareil: null }); return; }
        const data = await api.getGrilleSuggestions({ q: '', limit: 50, marque: app.marque, modele: app.modele, categorie: app.categorie });
        if (annule) return;
        setEtat({ statut: 'pret', pieces: piecesCommandables(data?.suggestions), appareil: app });
      } catch {
        if (!annule) setEtat({ statut: 'erreur', pieces: [], appareil: null });
      }
    }, cleAppareil || ticketId ? 0 : 400);
    return () => { annule = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif, cleAppareil, ticketId, code]);

  return etat;
}

/**
 * « Prix HT payé » + pièce de la grille correspondante. HT de la grille prérempli seulement pour
 * l'admin (le serveur ne l'envoie qu'à lui) ; l'écart s'affiche alors avant l'envoi.
 */
function ChampsPrixPaye({ id, valeurs, onChange, grille, description, isAdmin, cleEnregistree = '' }) {
  const pieces = grille.pieces;
  const choisie = pieces.find(s => String(s.id) === String(valeurs.tarif_cle)) || null;
  // Pièce déjà enregistrée mais absente des suggestions (obsolète) : gardée tant que le ticket ne change pas
  const horsListe = cleEnregistree && valeurs.tarif_cle === cleEnregistree && !choisie ? cleEnregistree : '';
  const pressentieRef = useRef(false);

  // À chaque liste chargée : choix d'un autre ticket retiré, sinon pièce pressentie d'après la désignation
  useEffect(() => {
    if (grille.statut !== 'pret') {
      pressentieRef.current = false;
      // Plus de ticket (ou ticket inconnu) : la pièce choisie pour un autre ticket ne part pas
      if (grille.statut !== 'chargement' && valeurs.tarif_cle && valeurs.tarif_cle !== cleEnregistree) onChange({ tarif_cle: '' });
      return;
    }
    if (pressentieRef.current) return;
    pressentieRef.current = true;
    const cle = String(valeurs.tarif_cle || '');
    if (cle && (cle === cleEnregistree || pieces.some(s => String(s.id) === cle))) return;
    const p = piecePressentie(description, pieces);
    if (p) choisir(String(p.id));
    else if (cle) onChange({ tarif_cle: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grille.statut, pieces]);

  function choisir(cle) {
    const p = pieces.find(s => String(s.id) === cle);
    const patch = { tarif_cle: cle };
    // HT prérempli uniquement si l'admin le reçoit et que rien n'a été saisi
    if (p && isAdmin && p.cout_ht != null && montantSaisi(valeurs.prix_ht) === null) patch.prix_ht = String(p.cout_ht);
    onChange(patch);
  }

  const ht = montantSaisi(valeurs.prix_ht);
  const coutGrille = choisie && choisie.cout_ht != null ? Number(choisie.cout_ht) : null;
  const ecart = ht !== null && coutGrille !== null ? Math.round((ht - coutGrille) * 100) / 100 : null;
  const aideId = `${id}-aide`;

  return (
    <>
      <div className="col-span-2 sm:col-span-2">
        <label htmlFor={`${id}-piece`} className="input-label">Pièce de la grille</label>
        <select id={`${id}-piece`} value={valeurs.tarif_cle || ''} onChange={e => choisir(e.target.value)}
          className="select min-h-[44px]" disabled={grille.statut !== 'pret' || (pieces.length === 0 && !horsListe)} aria-describedby={aideId}>
          <option value="">{grille.statut === 'chargement' ? 'Chargement des pièces…' : 'Aucune (ne pas mettre à jour la grille)'}</option>
          {horsListe && <option value={horsListe}>Pièce enregistrée ({horsListe})</option>}
          {pieces.map(s => <option key={s.id} value={String(s.id)}>{libellePiece(s, isAdmin)}</option>)}
        </select>
        <p id={aideId} className="input-help">
          {grille.statut === 'vide' ? 'Renseignez le ticket associé pour choisir la pièce de sa grille.'
            : grille.statut === 'introuvable' ? 'Ticket introuvable : pièce de la grille non proposée.'
              : grille.statut === 'erreur' ? 'Grille indisponible pour le moment.'
                : grille.statut === 'pret' && pieces.length === 0 ? `Aucune pièce fournisseur pour ${grille.appareil?.modele || 'ce modèle'}.`
                  : grille.appareil ? `Pièces de la grille pour ${[grille.appareil.marque, grille.appareil.modele].filter(Boolean).join(' ')}.` : ''}
        </p>
      </div>
      <div>
        <label htmlFor={`${id}-ht`} className="input-label">Prix HT payé (&euro;)</label>
        <input id={`${id}-ht`} type="text" inputMode="decimal" autoComplete="off" value={valeurs.prix_ht}
          onChange={e => onChange({ prix_ht: e.target.value })} className="input min-h-[44px]" placeholder="Facture fournisseur"
          aria-describedby={`${id}-ht-aide`} />
        <p id={`${id}-ht-aide`} className="input-help min-h-[2.5em]" aria-live="polite">
          {valeurs.prix_ht && ht === null ? <span className="text-red-700 font-medium">Montant invalide</span>
            : ecart !== null && Math.abs(ecart) > ECART_PROPOSITION
              ? <span className="text-amber-900 font-medium">Écart de {ecart > 0 ? '+' : ''}{formatPrix(ecart)} avec la grille : proposition au gérant.</span>
              : ecart !== null ? 'Conforme à la grille.'
                : choisie ? 'Plus de 1 € d’écart avec la grille : le gérant reçoit une proposition.' : 'HT de la facture, hors livraison.'}
        </p>
      </div>
    </>
  );
}

/** Pièce reçue : saisie du prix HT payé (facultative) avant de prévenir le client. */
function ReceptionPrixDialog({ part, isAdmin, onEnregistrer, onPasser }) {
  const titreId = useId();
  const champsId = useId();
  const ref = useRef(null);
  const [valeurs, setValeurs] = useState({ prix_ht: '', tarif_cle: part?.tarif_cle || '' });
  const [envoi, setEnvoi] = useState(false);
  const grille = usePiecesGrille({ actif: Boolean(part), appareil: appareilDeLigne(part), ticketId: part?.ticket_id });
  useFocusTrap(ref, Boolean(part), { onEscape: () => !envoi && onPasser() });
  if (!part) return null;
  const ht = montantSaisi(valeurs.prix_ht);
  const valider = async (e) => {
    e.preventDefault();
    if (envoi || ht === null) return;
    setEnvoi(true);
    try { await onEnregistrer(valeurs, grille.pieces); } finally { setEnvoi(false); }
  };
  return (
    <div className="modal-overlay z-[110]">
      <form ref={ref} onSubmit={valider} role="dialog" aria-modal="true" aria-labelledby={titreId}
        className="modal">
        <div className="modal-header">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0" aria-hidden="true">
              <Tag className="w-5 h-5 text-emerald-700" />
            </div>
            <div className="min-w-0">
              <h3 id={titreId} className="t-h2">Pièce reçue : prix payé</h3>
              <p className="t-small truncate">{part.description}</p>
            </div>
          </div>
        </div>
        <div className="modal-body">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4">
            <ChampsPrixPaye id={champsId} valeurs={valeurs} onChange={patch => setValeurs(v => ({ ...v, ...patch }))}
              grille={grille} description={part.description} isAdmin={isAdmin} cleEnregistree={part.tarif_cle || ''} />
          </div>
          <p className="t-caption mt-3">Le prix de la grille ne change pas : le gérant valide la mise à jour.</p>
        </div>
        <div className="modal-footer flex-wrap">
          <button type="button" onClick={onPasser} disabled={envoi} className="btn-ghost">
            Passer
          </button>
          <button type="submit" disabled={envoi || ht === null} aria-busy={envoi} className="btn-primary">
            <Save aria-hidden="true" /> {envoi ? 'Enregistrement…' : 'Enregistrer le prix'}
          </button>
        </div>
      </form>
    </div>
  );
}

// Pastille de couleur du statut (select neutre, la couleur ne porte que le statut)
const COMMANDE_STATUS_CONFIG = {
  'Panier': { dot: 'bg-slate-400', icon: ShoppingCart },
  'En attente': { dot: 'bg-amber-500', icon: Clock },
  'Commandée': { dot: 'bg-blue-500', icon: Package },
  'Reçu': { dot: 'bg-emerald-500', icon: Check },
  'En réparation': { dot: 'bg-brand-500', icon: Wrench },
  'Donné au client': { dot: 'bg-emerald-700', icon: UserCheck },
  'Clôturé': { dot: 'bg-slate-500', icon: Archive },
};

const FILTER_TABS = [
  { label: 'Tous', value: 'all' },
  ...PART_STATUTS.map(s => ({ label: s, value: s })),
];

export default function CommandesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';
  const isAdmin = user?.role === 'admin';
  const formId = useId();
  const [receptionPart, setReceptionPart] = useState(null);
  const [searchParams] = useSearchParams();
  const urlQ = searchParams.get('q');
  const [search, setSearch] = useState(() => urlQ || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => (urlQ || '').trim());
  const [filterTab, setFilterTab] = useState('all');
  const searchTimer = useRef(null);
  const [showForm, setShowForm] = useState(false);
  const [editingPart, setEditingPart] = useState(null);
  const [toast, setToast] = useState(null);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [notifPart, setNotifPart] = useState(null);
  const [notifEnvoi, setNotifEnvoi] = useState(false);
  const { actif: smsServeur } = useSmsServeur();
  const [form, setForm] = useState({
    description: '', fournisseur: '', reference: '',
    prix: '', ticket_code: '', statut: 'En attente', notes: '', prix_ht: '', tarif_cle: '',
  });
  // Modification sans changer de ticket : appareil connu par la ligne et pièce enregistrée gardée.
  // Ticket changé : la pièce enregistrée (autre appareil) redevient une sélection ordinaire.
  const memeTicket = Boolean(editingPart) && String(editingPart.ticket_code || '') === String(form.ticket_code || '');
  const cleEnregistree = memeTicket ? String(editingPart.tarif_cle || '') : '';
  const grilleForm = usePiecesGrille({
    actif: showForm,
    appareil: memeTicket ? appareilDeLigne(editingPart) : null,
    ticketId: memeTicket ? editingPart.ticket_id : null,
    ticketCode: form.ticket_code,
  });

  // Debounced search (300ms)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  // Lien depuis la palette de recherche (?q=référence) alors que la page est déjà ouverte
  useEffect(() => {
    if (urlQ !== null) setSearch(urlQ);
  }, [urlQ]);

  // Toast auto-hide
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.duree || 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Une seule liste complète, filtrée localement : la recherche couvre aussi le client,
  // son téléphone, le modèle et la panne du ticket lié (champs joints par l'API).
  const { data: allPartsData, loading } = useApi(
    'commandes:all:counts',
    () => api.getParts({}),
    { tags: ['commandes'], ttl: 60_000 }
  );
  const allParts = allPartsData ?? [];

  const searchedParts = useMemo(() => {
    if (!debouncedSearch) return allParts;
    return allParts.filter(p => matchesQuery([
      p.description, p.fournisseur, p.reference, p.ticket_code, p.notes,
      p.client_prenom, p.client_nom, p.client_tel,
      p.marque, p.modele, p.modele_autre, p.panne,
    ], debouncedSearch));
  }, [allParts, debouncedSearch]);

  const parts = useMemo(
    () => (filterTab === 'all' ? searchedParts : searchedParts.filter(p => p.statut === filterTab)),
    [searchedParts, filterTab]
  );

  const statusCounts = useMemo(() => {
    const counts = { all: searchedParts.length };
    PART_STATUTS.forEach(s => { counts[s] = 0; });
    searchedParts.forEach(p => {
      if (counts[p.statut] !== undefined) counts[p.statut]++;
    });
    return counts;
  }, [searchedParts]);

  const resetForm = () => {
    setForm({ description: '', fournisseur: '', reference: '', prix: '', ticket_code: '', statut: 'En attente', notes: '', prix_ht: '', tarif_cle: '' });
    setEditingPart(null);
    setShowForm(false);
  };

  // Proposition créée par le serveur (ou, s'il ne le dit pas, écart > 1 € connu de l'admin)
  const propositionEnvoyee = (res, valeurs, pieces) => {
    const signal = propositionSignalee(res);
    if (signal !== null) return signal;
    const ht = montantSaisi(valeurs.prix_ht);
    const piece = pieces.find(s => String(s.id) === String(valeurs.tarif_cle));
    return ht !== null && piece?.cout_ht != null && Math.abs(ht - Number(piece.cout_ht)) > ECART_PROPOSITION;
  };

  const handleSubmit = async () => {
    try {
      const { prix_ht, tarif_cle: cleSaisie, ...reste } = form;
      // Seule une pièce de la grille du ticket saisi (ou celle déjà enregistrée, même ticket) part avec
      // la commande ; pendant un chargement, les pièces affichées sont encore celles de l'ancien ticket
      const tarif_cle = cleSaisie && (cleSaisie === cleEnregistree
        || (grilleForm.statut === 'pret' && grilleForm.pieces.some(s => String(s.id) === cleSaisie))) ? cleSaisie : '';
      const data = {
        ...reste,
        prix: form.prix ? parseFloat(form.prix) : null,
      };
      // Prix payé et pièce envoyés seulement s'ils changent : une proposition déjà traitée ne revient pas
      const htSaisi = montantSaisi(prix_ht);
      const htAvant = editingPart ? montantSaisi(editingPart.prix_ht) : null;
      const cleAvant = editingPart?.tarif_cle || '';
      if (!editingPart) {
        if (htSaisi !== null) data.prix_ht = htSaisi;
        if (tarif_cle) data.tarif_cle = tarif_cle;
      } else if (htSaisi !== htAvant || (tarif_cle || '') !== cleAvant) {
        // Modification : null efface le prix payé ou la pièce
        data.prix_ht = htSaisi;
        data.tarif_cle = tarif_cle || null;
      }
      const prixEnvoye = 'prix_ht' in data && 'tarif_cle' in data;
      let res;
      if (editingPart) {
        res = await api.updatePart(editingPart.id, data);
      } else {
        res = await api.createPart(data);
      }
      const base = editingPart ? 'Commande mise à jour' : 'Commande créée';
      if (prixEnvoye && propositionEnvoyee(res, { prix_ht: data.prix_ht, tarif_cle: data.tarif_cle }, grilleForm.pieces)) {
        setToast({ type: 'success', msg: `${base} — ${MESSAGE_PROPOSITION.toLowerCase()}`, duree: 6000 });
      } else {
        setToast({ type: 'success', msg: base });
      }
      resetForm();
      // Une commande pièce peut auto-changer le statut du ticket lié
      // (parts.py: "Reçu" → ticket "Pièce reçue"). Invalide donc aussi tickets + dashboard.
      invalidateCache('commandes', 'tickets', 'dashboard', 'interactions');
    } catch (err) {
      console.error(err);
      setToast({ type: 'error', msg: 'Erreur lors de la sauvegarde' });
    }
  };

  const handleEdit = (part) => {
    setEditingPart(part);
    setForm({
      description: part.description || '',
      fournisseur: part.fournisseur || '',
      reference: part.reference || '',
      prix: part.prix || '',
      ticket_code: part.ticket_code || '',
      statut: part.statut || 'En attente',
      notes: part.notes || '',
      prix_ht: part.prix_ht != null ? String(part.prix_ht) : '',
      tarif_cle: part.tarif_cle || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer cette commande ?')) return;
    try {
      await api.deletePart(id);
      // Une commande pièce peut auto-changer le statut du ticket lié
      // (parts.py: "Reçu" → ticket "Pièce reçue"). Invalide donc aussi tickets + dashboard.
      invalidateCache('commandes', 'tickets', 'dashboard', 'interactions');
      setToast({ type: 'success', msg: 'Commande supprimée' });
    } catch (err) {
      console.error(err);
    }
  };

  const handleStatusChange = async (part, newStatut) => {
    try {
      const res = await api.updatePart(part.id, { statut: newStatut });
      // Une commande pièce peut auto-changer le statut du ticket lié
      // (parts.py: "Reçu" → ticket "Pièce reçue"). Invalide donc aussi tickets + dashboard.
      invalidateCache('commandes', 'tickets', 'dashboard', 'interactions');
      // Réception d'une commande qui porte déjà son prix payé : le serveur peut en tirer une proposition
      setToast(propositionSignalee(res) === true
        ? { type: 'success', msg: `Statut → ${newStatut} — ${MESSAGE_PROPOSITION.toLowerCase()}`, duree: 6000 }
        : { type: 'success', msg: `Statut → ${newStatut}` });

      // Pièce reçue : prix HT payé d'abord (s'il manque), puis proposition de prévenir le client
      if (newStatut === 'Reçu') {
        if (part.prix_ht == null || part.prix_ht === '') setReceptionPart(part);
        else proposerNotification(part);
      }
    } catch (err) {
      console.error(err);
      setToast({ type: 'error', msg: 'Erreur changement statut' });
    }
  };

  const proposerNotification = (part) => {
    if (part?.client_tel) {
      setNotifPart(part);
      setShowNotifModal(true);
    }
  };

  const finirReception = () => {
    const part = receptionPart;
    setReceptionPart(null);
    proposerNotification(part);
  };

  const enregistrerPrixRecu = async (valeurs, pieces = []) => {
    const part = receptionPart;
    const data = { prix_ht: montantSaisi(valeurs.prix_ht) };
    if (valeurs.tarif_cle) data.tarif_cle = valeurs.tarif_cle;
    try {
      const res = await api.updatePart(part.id, data);
      invalidateCache('commandes');
      const proposee = Boolean(data.tarif_cle) && propositionEnvoyee(res, data, pieces);
      setToast(proposee
        ? { type: 'success', msg: MESSAGE_PROPOSITION, duree: 6000 }
        : { type: 'success', msg: 'Prix payé enregistré' });
      finirReception();
    } catch (err) {
      setToast({ type: 'error', msg: err?.message || 'Prix non enregistré' });
    }
  };

  // Navigation directe par id ; le code saisi à la main passe par la résolution staff authentifiée
  const handleGoToTicket = async (part) => {
    if (part.ticket_id) {
      navigate(`${basePath}/ticket/${part.ticket_id}`);
      return;
    }
    try {
      const r = await api.resolveCode(part.ticket_code);
      if (r?.type === 'ticket' && r.id) navigate(`${basePath}/ticket/${r.id}`);
      else setToast({ type: 'error', msg: `Ticket ${part.ticket_code} introuvable` });
    } catch {
      setToast({ type: 'error', msg: `Ticket ${part.ticket_code} introuvable` });
    }
  };

  const getNotifMessage = (part) => {
    const clientName = [part.client_prenom, part.client_nom].filter(Boolean).join(' ') || 'client';
    const model = [part.marque, part.modele || part.modele_autre].filter(Boolean).join(' ') || 'appareil';
    return `Bonjour ${clientName}, la pièce pour votre ${model} est arrivée ! Merci de prendre rendez-vous pour la réparation. KLIKPHONE - 04 79 60 89 22`;
  };

  const handleNotifSMS = async () => {
    if (!notifPart || notifEnvoi) return;
    const msg = getNotifMessage(notifPart);
    // Envoi par le serveur (Brevo) s'il est activé et la commande liée à un ticket, sinon app Messages
    setNotifEnvoi(true);
    let res;
    try {
      res = await envoyerSms({
        serveur: smsServeur, ticketId: notifPart.ticket_id, tel: notifPart.client_tel, message: msg, libelle: 'Pièce reçue',
      });
    } catch (err) {
      // Refus lisible : la fenêtre reste ouverte (WhatsApp reste possible)
      setToast({ type: 'error', msg: err?.message || 'SMS non envoyé' });
      return;
    } finally {
      setNotifEnvoi(false);
    }

    if (res.mode === 'serveur') {
      // Le serveur a déjà noté le SMS sur le ticket
      setToast({ type: 'success', msg: messageSmsEnvoye(res) });
    } else if (notifPart.ticket_id) {
      try {
        await api.addNote(notifPart.ticket_id, '[PIÈCE] Pièce reçue — Client notifié par SMS');
      } catch (err) {
        console.error('Erreur ajout note:', err);
      }
    }
    setShowNotifModal(false);
    setNotifPart(null);
  };

  const handleNotifWhatsApp = async () => {
    if (!notifPart) return;
    const msg = getNotifMessage(notifPart);
    const link = waLink(notifPart.client_tel, msg);
    window.open(link, '_blank');

    // Add note to ticket
    if (notifPart.ticket_id) {
      try {
        await api.addNote(notifPart.ticket_id, '[PIÈCE] Pièce reçue — Client notifié par WhatsApp');
      } catch (err) {
        console.error('Erreur ajout note:', err);
      }
    }
    setShowNotifModal(false);
    setNotifPart(null);
  };

  const handleNotifDismiss = () => {
    setShowNotifModal(false);
    setNotifPart(null);
  };

  const getStatusConf = (statut) => {
    return COMMANDE_STATUS_CONFIG[statut] || { dot: 'bg-slate-400', icon: Package };
  };

  return (
    <div className="page max-w-[1280px]">
      {/* Toast */}
      {toast && (
        <div role={toast.type === 'error' ? 'alert' : 'status'}
          className={`toast fixed top-16 right-4 lg:top-auto lg:bottom-20 lg:right-6 z-[120] animate-in font-medium
          ${toast.type === 'success' ? 'border-l-emerald-600' : 'border-l-red-600'}`}>
          {toast.type === 'success'
            ? <Check className="w-5 h-5 shrink-0 text-emerald-700" aria-hidden="true" />
            : <AlertTriangle className="w-5 h-5 shrink-0 text-red-700" aria-hidden="true" />}
          <span className="flex-1 min-w-0">{toast.msg}</span>
        </div>
      )}

      {/* Pièce reçue : prix HT payé (facultatif) avant de prévenir le client */}
      {receptionPart && (
        <ReceptionPrixDialog part={receptionPart} isAdmin={isAdmin}
          onEnregistrer={enregistrerPrixRecu} onPasser={finirReception} />
      )}

      {/* Notification modal on "Reçu" */}
      {showNotifModal && notifPart && (
        <div className="modal-overlay z-[110]">
          <div role="dialog" aria-modal="true" aria-labelledby="notif-piece-titre" className="modal sm:max-w-md">
            <div className="modal-header">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0" aria-hidden="true">
                  <Check className="w-5 h-5 text-emerald-700" />
                </div>
                <div className="min-w-0">
                  <h3 id="notif-piece-titre" className="t-h2">Pi&egrave;ce re&ccedil;ue !</h3>
                  <p className="t-small">Voulez-vous pr&eacute;venir le client ?</p>
                </div>
              </div>
            </div>
            <div className="modal-body">
              <div className="card-section t-body">
                {getNotifMessage(notifPart)}
              </div>
            </div>
            <div className="modal-footer flex-col-reverse sm:flex-row">
              <button type="button" onClick={handleNotifDismiss} disabled={notifEnvoi} className="btn-ghost w-full sm:w-auto">
                Non merci
              </button>
              <button type="button" onClick={handleNotifWhatsApp} disabled={notifEnvoi} className="btn-whatsapp w-full sm:w-auto">
                <Send aria-hidden="true" /> WhatsApp
              </button>
              <button type="button" onClick={handleNotifSMS} disabled={notifEnvoi} aria-busy={notifEnvoi}
                title={smsServeur && notifPart.ticket_id ? 'Envoyer le SMS depuis le serveur (Brevo)' : "Ouvrir l'app Messages de l'appareil"}
                className="btn-primary w-full sm:w-auto">
                <MessageSquare aria-hidden="true" /> {notifEnvoi ? 'Envoi…' : 'SMS'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Commandes de pi&egrave;ces</h1>
          <p className="page-header-subtitle">
            {allParts.filter(p => !STATUTS_TERMINAUX.includes(p.statut)).length} en cours &mdash; {allParts.filter(p => STATUTS_TERMINAUX.includes(p.statut)).length} cl&ocirc;tur&eacute;e(s)
          </p>
        </div>
        <div className="page-header-actions">
          <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary">
            <Plus aria-hidden="true" /> Nouvelle commande
          </button>
        </div>
      </div>

      {/* Search & Filter Tabs */}
      <div className="card mb-6">
        <div className="p-3 sm:p-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" aria-hidden="true" />
            <label htmlFor="commandes-search" className="sr-only">Rechercher une commande de pièce</label>
            <input id="commandes-search" type="text" placeholder="Pièce, référence, fournisseur, client, modèle, ticket..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
              className="input min-h-[44px] pl-10 pr-12"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Effacer la recherche"
                className="btn-ghost btn-icon absolute right-0.5 top-1/2 -translate-y-1/2 text-slate-500">
                <X aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <div className="p-2 sm:px-3 max-xl:scroll-fade-x">
          <div className="segmented w-full" role="group" aria-label="Filtrer par statut">
            {FILTER_TABS.map(tab => {
              const count = statusCounts[tab.value] ?? 0;
              const isActive = filterTab === tab.value;
              const conf = tab.value !== 'all' ? getStatusConf(tab.value) : null;
              const IconComp = conf?.icon;
              return (
                <button key={tab.value} type="button" onClick={() => setFilterTab(tab.value)}
                  aria-pressed={isActive}
                  className={`segmented-item ${isActive ? 'segmented-item-active' : ''}`}>
                  {IconComp && <IconComp className={`w-4 h-4 ${isActive ? 'text-brand-600' : 'text-slate-400'}`} aria-hidden="true" />}
                  {tab.label} ({count})
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="card mb-6 border-brand-300 animate-in">
          <div className="card-header">
            <h2 className="t-h2">
              {editingPart ? 'Modifier la commande' : 'Nouvelle commande'}
            </h2>
            <button type="button" onClick={resetForm} className="btn-ghost btn-icon -mr-2" aria-label="Fermer le formulaire">
              <X aria-hidden="true" />
            </button>
          </div>
          <div className="px-4 sm:px-5 pb-4 sm:pb-5 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4">
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor={`${formId}-description`} className="input-label">D&eacute;signation *</label>
              <input id={`${formId}-description`} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input" placeholder="&Eacute;cran iPhone 15..." />
            </div>
            <div>
              <label htmlFor={`${formId}-fournisseur`} className="input-label">Fournisseur</label>
              <input id={`${formId}-fournisseur`} value={form.fournisseur} onChange={e => setForm(f => ({ ...f, fournisseur: e.target.value }))} className="input" placeholder="Nom fournisseur" />
            </div>
            <div>
              <label htmlFor={`${formId}-reference`} className="input-label">R&eacute;f&eacute;rence</label>
              <input id={`${formId}-reference`} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} className="input t-mono" placeholder="REF-001" />
            </div>
            <div>
              <label htmlFor={`${formId}-prix`} className="input-label">Prix client TTC (&euro;)</label>
              <input id={`${formId}-prix`} type="number" step="0.01" min="0" inputMode="decimal" value={form.prix}
                onChange={e => setForm(f => ({ ...f, prix: e.target.value }))} className="input min-h-[44px] tabular-nums"
                aria-describedby={`${formId}-prix-aide`} />
              <p id={`${formId}-prix-aide`} className="input-help">Prix annoncé au client. La facture du fournisseur va dans « Prix HT payé ».</p>
            </div>
            <div>
              <label htmlFor={`${formId}-ticket`} className="input-label">Ticket associ&eacute;</label>
              <input id={`${formId}-ticket`} value={form.ticket_code} onChange={e => setForm(f => ({ ...f, ticket_code: e.target.value }))} className="input t-mono uppercase" placeholder="KP-000001" autoComplete="off" />
            </div>
            <div>
              <label htmlFor={`${formId}-statut`} className="input-label">Statut</label>
              <select id={`${formId}-statut`} value={form.statut} onChange={e => setForm(f => ({ ...f, statut: e.target.value }))} className="select">
                {PART_STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <ChampsPrixPaye id={formId} valeurs={form} onChange={patch => setForm(f => ({ ...f, ...patch }))}
              grille={grilleForm} description={form.description} isAdmin={isAdmin} cleEnregistree={cleEnregistree} />
            <div className="col-span-2 sm:col-span-3">
              <label htmlFor={`${formId}-notes`} className="input-label">Notes</label>
              <input id={`${formId}-notes`} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input" placeholder="Notes..." />
            </div>
          </div>
          <div className="card-footer">
            <button type="button" onClick={handleSubmit} disabled={!form.description || (form.prix_ht !== '' && montantSaisi(form.prix_ht) === null)} className="btn-primary">
              <Save aria-hidden="true" /> {editingPart ? 'Mettre à jour' : 'Créer'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="hidden xl:grid xl:grid-cols-[minmax(180px,1fr)_120px_124px_96px_120px_160px_88px] 2xl:grid-cols-[minmax(180px,1fr)_130px_130px_110px_110px_96px_120px_160px_88px] gap-3 items-center px-5 py-2.5 bg-slate-50 border-b border-slate-100">
          <span className="table-header">D&eacute;signation</span>
          <span className="table-header">Mod&egrave;le</span>
          <span className="table-header">Client</span>
          <span className="table-header hidden 2xl:block">Fournisseur</span>
          <span className="table-header hidden 2xl:block">Panne</span>
          <span className="table-header text-right" title="Prix client TTC (prix HT payé au fournisseur dessous)">Prix TTC</span>
          <span className="table-header">Dates</span>
          <span className="table-header">Statut</span>
          <span className="table-header text-right">Actions</span>
        </div>

        {loading ? (
          <div className="p-4 space-y-3" role="status">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton-row" aria-hidden="true" />)}
            <p className="sr-only">Chargement...</p>
          </div>
        ) : parts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Package aria-hidden="true" />
            </div>
            <p className="t-h2">
              {debouncedSearch ? `Aucune commande ne correspond à « ${debouncedSearch} »` : 'Aucune commande'}
            </p>
            <p className="t-body text-slate-500 max-w-sm">
              {debouncedSearch
                ? (filterTab !== 'all' && searchedParts.length > 0
                  ? `${searchedParts.length} résultat(s) avec un autre statut : choisissez l’onglet « Tous ».`
                  : 'Essayez le nom du client, le modèle, la référence ou le code du ticket.')
                : filterTab === 'all' ? 'Créez votre première commande de pièce' : `Aucune commande avec le statut "${filterTab}"`}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {parts.map((p) => {
              const conf = getStatusConf(p.statut);
              const clientFullName = [p.client_prenom, p.client_nom].filter(Boolean).join(' ');
              const modelText = [p.marque, p.modele || p.modele_autre].filter(Boolean).join(' ');
              const panneText = p.panne || '—';
              const aHt = p.prix_ht != null && p.prix_ht !== '';

              return (
                <div key={p.id}
                  className="flex flex-col gap-2 xl:grid xl:grid-cols-[minmax(180px,1fr)_120px_124px_96px_120px_160px_88px] 2xl:grid-cols-[minmax(180px,1fr)_130px_130px_110px_110px_96px_120px_160px_88px] xl:gap-3 items-stretch xl:items-center px-4 sm:px-5 py-3 xl:py-2 xl:min-h-14 hover:bg-slate-50 transition-colors duration-150"
                >
                  {/* Désignation (+ prix à droite sous xl) */}
                  <div className="min-w-0 flex items-start justify-between gap-3 xl:block">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900 truncate" title={p.description}>{p.description}</p>
                      <div className="flex flex-wrap items-center gap-x-2 min-w-0">
                        {p.ticket_code && (
                          <button type="button" onClick={() => handleGoToTicket(p)}
                            aria-label={`Ouvrir la fiche du ticket ${p.ticket_code}`}
                            className="inline-flex items-center gap-1 min-h-8 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:-my-1.5 t-mono text-brand-700 font-semibold hover:text-brand-800 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                            {p.ticket_code} <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                        {(() => {
                          // Tablette / mobile : modèle, client, fournisseur et HT payé sur une ligne
                          const resume = [modelText, clientFullName, p.fournisseur,
                            aHt ? `HT payé ${formatPrix(p.prix_ht)}` : ''].filter(Boolean).join(' · ');
                          return resume ? <p className="xl:hidden t-small truncate min-w-0 w-full sm:w-auto sm:flex-1">{resume}</p> : null;
                        })()}
                      </div>
                      {p.notes && <p className="t-caption truncate" title={p.notes}>{p.notes}</p>}
                    </div>
                    <div className="xl:hidden text-right shrink-0">
                      <p className="t-num" title="Prix client TTC">{p.prix ? formatPrix(p.prix) : '—'}</p>
                    </div>
                  </div>

                  {/* Modèle */}
                  <div className="hidden xl:block min-w-0">
                    <p className="text-sm text-slate-700 truncate" title={modelText}>{modelText || '—'}</p>
                  </div>

                  {/* Client */}
                  <div className="hidden xl:block min-w-0">
                    <p className="text-sm text-slate-700 truncate" title={clientFullName}>{clientFullName || '—'}</p>
                    {p.client_tel && <p className="t-small tabular-nums truncate">{formatPhone(p.client_tel)}</p>}
                  </div>

                  {/* Fournisseur (grands écrans) */}
                  <div className="hidden 2xl:block min-w-0">
                    <p className="text-sm text-slate-700 truncate" title={p.fournisseur || '—'}>{p.fournisseur || '—'}</p>
                  </div>

                  {/* Panne (grands écrans) */}
                  <div className="hidden 2xl:block min-w-0">
                    <p className="t-small truncate" title={panneText}>{panneText}</p>
                  </div>

                  {/* Prix */}
                  <div className="hidden xl:block text-right">
                    <p className="t-num text-sm" title="Prix client TTC">{p.prix ? formatPrix(p.prix) : '—'}</p>
                    {aHt && (
                      <p className="t-caption tabular-nums" title="Prix HT payé au fournisseur">HT {formatPrix(p.prix_ht)}</p>
                    )}
                  </div>

                  {/* Dates */}
                  <div className="hidden xl:block">
                    <p className="t-caption tabular-nums flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                      {p.date_creation ? formatDateShort(p.date_creation) : '—'}
                    </p>
                    {p.date_commande && (
                      <p className="t-caption tabular-nums">Cmd: {formatDateShort(p.date_commande)}</p>
                    )}
                    {p.date_reception && (
                      <p className="t-caption tabular-nums text-emerald-700">Re&ccedil;ue: {formatDateShort(p.date_reception)}</p>
                    )}
                  </div>

                  {/* Pied (sous xl) : statut à gauche, actions à droite */}
                  <div className="flex items-center gap-2 xl:contents">
                    {/* Status dropdown */}
                    <div className="relative flex-1 min-w-0 xl:flex-none" onClick={e => e.stopPropagation()}>
                      <span className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${conf.dot}`} aria-hidden="true" />
                      <select
                        value={p.statut}
                        onChange={e => handleStatusChange(p, e.target.value)}
                        aria-label={`Statut de la commande ${p.description || ''}`.trim()}
                        className="select min-h-11 pl-7 font-medium cursor-pointer truncate"
                      >
                        {PART_STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-0.5 shrink-0 xl:-mr-2">
                      <button type="button" onClick={() => handleEdit(p)} className="btn-ghost btn-icon" title="Modifier" aria-label={`Modifier la commande ${p.description || ''}`.trim()}>
                        <Edit3 aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => handleDelete(p.id)} className="btn-danger-ghost btn-icon" title="Supprimer" aria-label={`Supprimer la commande ${p.description || ''}`.trim()}>
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
