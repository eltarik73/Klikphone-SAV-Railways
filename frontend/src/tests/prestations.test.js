/**
 * lib/prestations.js : mêmes règles que backend/app/services/prestations.py
 * (correspondance exacte normalisée, forfait sur la seule ligne par défaut,
 * lignes enregistrées jamais réécrites). Si Python est disponible, le test
 * compare aussi les résultats à ceux du backend sur les mêmes entrées.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normaliser, construireCatalogue, definirCatalogue, cataloguePrestations, chargerPrestations,
  clePanne, libellePrestation, libelleCourt, memeElement, lignesReparation, lignesEdition,
  indexLigneEcran, prixNombre, forfaitApplicable, lignesFiche, rattachementCommandes,
} from '../lib/prestations';
import { api } from '../lib/api';

// Réponse de GET /api/catalog/prestations (copie de catalogue_prestations())
const CATALOGUE = {
  pannes: ['Écran cassé', 'Batterie', 'Connecteur de charge', 'Caméra avant', 'Caméra arrière', 'Bouton volume', 'Bouton power', "Haut-parleur (je n'entends pas les gens ou la musique)", "Microphone (les gens ne m'entendent pas)", 'Vitre arrière', 'Désoxydation', 'Problème logiciel', 'Diagnostic', 'Autre'],
  prestations: [
    { cle: 'ecran', symptome: 'Écran cassé', prestation: 'Forfait remplacement écran', court: 'Écran', alias: ['Écran HS'] },
    { cle: 'batterie', symptome: 'Batterie', prestation: 'Forfait remplacement batterie', court: 'Batterie', alias: ['Batterie HS', 'Batterie qui gonfle', 'Batterie gonflée'] },
    { cle: 'connecteur', symptome: 'Connecteur de charge', prestation: 'Forfait remplacement connecteur de charge', court: 'Connecteur de charge', alias: ['Connecteur', 'Connecteur charge', 'Port de charge'] },
    { cle: 'camera_avant', symptome: 'Caméra avant', prestation: 'Forfait remplacement caméra avant', court: 'Caméra avant', alias: ['Caméra avant HS'] },
    { cle: 'camera_arriere', symptome: 'Caméra arrière', prestation: 'Forfait remplacement caméra arrière', court: 'Caméra arrière', alias: ['Caméra arrière HS'] },
    { cle: 'bouton_volume', symptome: 'Bouton volume', prestation: 'Forfait réparation bouton volume', court: 'Bouton volume', alias: ['Nappe volume', 'Nappe volume HS'] },
    { cle: 'bouton_power', symptome: 'Bouton power', prestation: 'Forfait réparation bouton power', court: 'Bouton power', alias: ['Bouton power HS', 'Bouton marche/arrêt', 'Nappe power'] },
    { cle: 'haut_parleur', symptome: "Haut-parleur (je n'entends pas les gens ou la musique)", prestation: 'Forfait remplacement haut-parleur', court: 'Haut-parleur', alias: ['Haut-parleur HS'] },
    { cle: 'micro', symptome: "Microphone (les gens ne m'entendent pas)", prestation: 'Forfait réparation micro', court: 'Micro', alias: ['Microphone', 'Micro HS'] },
    { cle: 'vitre_arriere', symptome: 'Vitre arrière', prestation: 'Forfait remplacement vitre arrière', court: 'Vitre arrière', alias: ['Vitre arrière cassée'] },
    { cle: 'desoxydation', symptome: 'Désoxydation', prestation: 'Forfait désoxydation', court: 'Désoxydation', alias: ['Oxydation'] },
    { cle: 'logiciel', symptome: 'Problème logiciel', prestation: 'Forfait intervention logicielle', court: 'Logiciel', alias: [] },
    { cle: 'diagnostic', symptome: 'Diagnostic', prestation: 'Diagnostic', court: 'Diagnostic', alias: [] },
    { cle: 'ecouteur', symptome: null, prestation: 'Forfait remplacement écouteur interne', court: 'Écouteur interne', alias: ['Écouteur', 'Écouteur interne HS'] },
    { cle: 'vitre_camera', symptome: null, prestation: 'Forfait remplacement vitre caméra arrière', court: 'Vitre caméra arrière', alias: ['Lentille caméra'] },
    { cle: 'face_id', symptome: null, prestation: 'Forfait réparation Face ID', court: 'Face ID', alias: ['Face ID HS'] },
  ],
};

// Mêmes cas que backend/tests/test_prestations.py
const CAS = [
  ['Écran cassé', 'Forfait remplacement écran'],
  ['Écran casse', 'Forfait remplacement écran'],
  ['ECRAN', 'Forfait remplacement écran'],
  ['Ecran', 'Forfait remplacement écran'],
  ['Batterie', 'Forfait remplacement batterie'],
  ['Batterie HS', 'Forfait remplacement batterie'],
  ['Camera arriere', 'Forfait remplacement caméra arrière'],
  ['Caméra avant HS', 'Forfait remplacement caméra avant'],
  ['Vitre arriere', 'Forfait remplacement vitre arrière'],
  ['Vitre camera arriere', 'Forfait remplacement vitre caméra arrière'],
  ['Ecouteur interne', 'Forfait remplacement écouteur interne'],
  ["Haut-parleur (je n'entends pas les gens ou la musique)", 'Forfait remplacement haut-parleur'],
  ['Haut-parleur', 'Forfait remplacement haut-parleur'],
  ["Microphone (les gens ne m'entendent pas)", 'Forfait réparation micro'],
  ['Bouton power', 'Forfait réparation bouton power'],
  ['Bouton marche/arrêt', 'Forfait réparation bouton power'],
  ['Désoxydation', 'Forfait désoxydation'],
  ['Problème logiciel', 'Forfait intervention logicielle'],
  ['Diagnostic', 'Diagnostic'],
  ['  batterie  ', 'Forfait remplacement batterie'],
  // Inconnus et sous-chaînes : jamais convertis
  ['Achat iPhone', 'Achat iPhone'],
  ['Achat Accessoire', 'Achat Accessoire'],
  ['Batterie externe', 'Batterie externe'],
  ['Écran qui clignote', 'Écran qui clignote'],
  ['Ne charge plus', 'Ne charge plus'],
  ['Écran OLED + nappe', 'Écran OLED + nappe'],
  ['Ecran (Soft OLED)', 'Ecran (Soft OLED)'],
  ['Vitre avant', 'Vitre avant'],
];

const TICKETS = [
  { panne: 'Écran casse', devis_estime: 129, statut: 'En attente de diagnostic' },
  { panne: 'Batterie', reparation_supp: JSON.stringify([{ label: 'Batterie', prix: 59 }, { label: 'Protection verre trempé', prix: 15 }]) },
  { panne: 'Écran cassé', devis_estime: 0, reparation_supp: JSON.stringify([{ label: 'Écran OLED', prix: '189' }, { label: 'Diagnostic', prix: '' }, { label: 'Nappe', prix: null }, { label: 'Film', prix: '12,5' }, { label: '', prix: 3 }]) },
  { panne: 'Batterie', devis_estime: 59, reparation_supp: "[{'label': 'x'" },
  { panne: 'Batterie', devis_estime: 59, reparation_supp: '{"label": "x"}' },
  { panne: 'Batterie', reparation_supp: '[1, 2]' },
  { panne: 'Batterie', devis_estime: 59, reparation_supp: 'Batterie', prix_supp: 10 },
  { panne: 'Batterie', devis_estime: 59, date_depot: '2026-03-01T10:00:00', statut: 'Clôturé' },
  { panne: 'Batterie', devis_estime: 59, date_depot: '2026-03-01T10:00:00', statut: 'Rendu au client' },
  { panne: 'Batterie', devis_estime: 59, date_depot: '2026-03-01T10:00:00', type_document: 'facture' },
  { panne: 'Batterie', devis_estime: 59, date_depot: '2026-03-01T10:00:00', paye: 1 },
  { panne: 'Batterie', devis_estime: 59, date_depot: '2026-03-01T10:00:00', statut: 'En cours de réparation' },
  { panne: 'Batterie', date_depot: '2026-11-02T00:00:00', statut: 'Clôturé', paye: 1 },
  { panne: 'Autre', panne_detail: 'Face ID ne marche plus', devis_estime: 80 },
  { panne: 'Pièce à commander', panne_detail: 'Écran OLED iPhone 14 Pro — fournisseur X réf 123' },
  { panne: '', devis_estime: 20 },
];

describe('prestations : table et libellés', () => {
  beforeEach(() => { definirCatalogue(CATALOGUE); });

  it('normalise accents, casse et ponctuation', () => {
    expect(normaliser('  Écran   CASSÉ ! ')).toBe('ecran casse');
    expect(normaliser("Haut-parleur (je n'entends pas)")).toBe('haut parleur je n entends pas');
    expect(normaliser(null)).toBe('');
  });

  it.each(CAS)('libellePrestation(%j) → %j', (entree, attendu) => {
    expect(libellePrestation(entree)).toBe(attendu);
  });

  it.each(CAS)('idempotence pour %j', (entree) => {
    const une = libellePrestation(entree);
    expect(libellePrestation(une)).toBe(une);
  });

  it('« Autre » : détail court, vide, long ou multiligne', () => {
    expect(libellePrestation('Autre', 'Face ID ne marche plus')).toBe('Réparation - Face ID ne marche plus');
    expect(libellePrestation('Autre', '')).toBe('Réparation');
    const long = libellePrestation('Autre', "Le téléphone redémarre\nen boucle après une chute dans l'eau de la piscine");
    expect(long).not.toContain('\n');
    expect(long.startsWith('Réparation - ')).toBe(true);
    expect(long.endsWith('...')).toBe(true);
    expect(long.length).toBeLessThanOrEqual('Réparation - '.length + 35);
  });

  it('« Pièce à commander » ne garde que le nom de la pièce (pas les notes internes)', () => {
    expect(libellePrestation('Pièce à commander', 'Écran OLED iPhone 14 Pro — fournisseur X réf 123')).toBe('Écran OLED iPhone 14 Pro');
    expect(libellePrestation('Pièce à commander', '')).toBe('Pièce à commander');
  });

  it('libellé court et même élément (commandes de pièces rattachées aux forfaits)', () => {
    expect(libelleCourt('Forfait remplacement batterie')).toBe('Batterie');
    expect(libelleCourt('Batterie externe')).toBe('Batterie externe');
    expect(memeElement('Batterie', 'Forfait remplacement batterie')).toBe(true);
    expect(memeElement('Écran OLED iPhone 14 Pro', 'Forfait remplacement écran')).toBe(false);
    expect(memeElement('Film', 'Film')).toBe(true);
    expect(memeElement('', '')).toBe(false);
  });

  it('clé inconnue → null ; sans table chargée, le symptôme reste brut', () => {
    expect(clePanne('Batterie externe')).toBe(null);
    definirCatalogue(null);
    expect(cataloguePrestations()).toBe(null);
    expect(libellePrestation('Batterie')).toBe('Batterie');
    expect(libellePrestation('Autre', 'Face ID')).toBe('Réparation - Face ID');
  });

  it('construireCatalogue refuse une réponse inattendue', () => {
    expect(construireCatalogue(null)).toBe(null);
    expect(construireCatalogue({ prestations: 'x' })).toBe(null);
  });

  it('prixNombre accepte virgule, euro, espaces et rejette le reste', () => {
    expect(prixNombre('12,5')).toBe(12.5);
    expect(prixNombre(' 189 € ')).toBe(189);
    expect(prixNombre('')).toBe(0);
    expect(prixNombre(null)).toBe(0);
    expect(prixNombre(true)).toBe(0);
    expect(prixNombre('abc')).toBe(0);
    expect(prixNombre(Infinity)).toBe(0);
  });
});

describe('prestations : lignes du ticket', () => {
  beforeEach(() => { definirCatalogue(CATALOGUE); });

  it('la ligne par défaut (sans JSON) reçoit le forfait', () => {
    expect(lignesReparation(TICKETS[0])).toEqual([{ label: 'Forfait remplacement écran', prix: 129, cle: 'ecran' }]);
  });

  it('les lignes JSON enregistrées ne sont jamais réécrites', () => {
    expect(lignesReparation(TICKETS[1]).map(l => [l.label, l.prix])).toEqual([['Batterie', 59], ['Protection verre trempé', 15]]);
  });

  it('un prix vide ne change pas la liste (même rendu que l’impression)', () => {
    expect(lignesReparation(TICKETS[2]).map(l => [l.label, l.prix])).toEqual([
      ['Écran OLED', 189], ['Diagnostic', 0], ['Nappe', 0], ['Film', 12.5],
    ]);
  });

  it('JSON invalide ou non tableau : jamais de libellé « [… »', () => {
    for (const t of TICKETS.slice(3, 6)) {
      expect(lignesReparation(t).every(l => !l.label.startsWith('[') && !l.label.startsWith('{'))).toBe(true);
    }
    expect(lignesReparation(TICKETS[5])).toEqual([]);
    expect(lignesReparation(TICKETS[4])[0].prix).toBe(59);
  });

  it('reparation_supp texte (ancien format) conservé en seconde ligne', () => {
    expect(lignesReparation(TICKETS[6]).map(l => l.label)).toEqual(['Forfait remplacement batterie', 'Batterie']);
  });

  it('un document déjà remis avant les forfaits garde le symptôme', () => {
    for (const t of TICKETS.slice(7, 11)) expect(lignesReparation(t)[0].label).toBe('Batterie');
    expect(lignesReparation(TICKETS[11])[0].label).toBe('Forfait remplacement batterie');
    expect(lignesReparation(TICKETS[12])[0].label).toBe('Forfait remplacement batterie');
    expect(forfaitApplicable({ statut: 'Clôturé', date_depot: 'n/a' })).toBe(false);
  });

  it('lignes d’édition : une ligne vide si le ticket n’en a aucune', () => {
    expect(lignesEdition(TICKETS[15])).toEqual([{ label: '', prix: 0 }]);
    expect(lignesEdition(TICKETS[0])).toEqual([{ label: 'Forfait remplacement écran', prix: 129 }]);
  });

  it('le badge type d’écran va sur la ligne écran, pas sur la première ligne', () => {
    expect(indexLigneEcran([{ label: 'Forfait remplacement batterie' }, { label: 'Forfait remplacement écran' }])).toBe(1);
    expect(indexLigneEcran([{ label: 'Batterie' }, { label: 'Écran OLED + nappe' }])).toBe(1);
    expect(indexLigneEcran([{ label: 'Batterie' }])).toBe(null);
  });
});

describe('prestations : fiche (ancien format, commandes de pièces)', () => {
  beforeEach(() => { definirCatalogue(CATALOGUE); });

  it('ancien format : le prix de tarif_final (qui fait foi) passe sur la ligne par défaut', () => {
    expect(lignesFiche({ panne: 'Batterie', devis_estime: 0, tarif_final: 79 }))
      .toEqual([{ label: 'Forfait remplacement batterie', prix: 79 }]);
    // Réduction déjà déduite de tarif_final : remise sur la ligne pour garder le même total
    expect(lignesFiche({ panne: 'Batterie', tarif_final: 69, reduction_montant: 10 })[0].prix).toBe(79);
    expect(lignesFiche({ panne: 'Batterie', tarif_final: 90, reduction_pourcentage: 10 })[0].prix).toBe(100);
    expect(lignesFiche({ panne: '', tarif_final: 25 })).toEqual([{ label: 'Réparation', prix: 25 }]);
    // Devis estimé = prix d'avant diagnostic : tarif_final le remplace
    expect(lignesFiche({ panne: 'Écran cassé', devis_estime: 100, tarif_final: 120 }))
      .toEqual([{ label: 'Forfait remplacement écran', prix: 120 }]);
    // Supplément texte (prix_supp) conservé, la ligne par défaut porte le reste
    expect(lignesFiche({ panne: 'Batterie', reparation_supp: 'Film', prix_supp: 10, tarif_final: 70 }))
      .toEqual([{ label: 'Forfait remplacement batterie', prix: 60 }, { label: 'Film', prix: 10 }]);
  });

  it('rien ne change avec des lignes JSON, sans tarif_final, ou quand le total concorde déjà', () => {
    expect(lignesFiche(TICKETS[0])).toEqual(lignesEdition(TICKETS[0]));
    expect(lignesFiche({ ...TICKETS[1], tarif_final: 74 })).toEqual(lignesEdition(TICKETS[1]));
    expect(lignesFiche({ panne: 'Batterie', reparation_supp: '[]', tarif_final: 50 })).toEqual([{ label: '', prix: 0 }]);
    const concorde = { panne: 'Écran cassé', devis_estime: 129, tarif_final: 119, reduction_montant: 10 };
    expect(lignesFiche(concorde)).toEqual(lignesEdition(concorde));
    expect(lignesFiche(TICKETS[15])).toEqual([{ label: '', prix: 0 }]);
  });

  it('commande du dépôt (nom de la pièce) rattachée à l’unique ligne', () => {
    const cmds = [{ id: 1, description: 'Écran iPhone 12' }];
    const de = rattachementCommandes([{ label: 'Forfait remplacement écran', prix: 129 }], cmds, 'Écran cassé');
    expect(de('Forfait remplacement écran')).toBe(cmds[0]);
    expect(de('')).toBe(null);
  });

  it('plusieurs lignes : la commande orpheline va à la ligne du symptôme', () => {
    const cmds = [{ id: 1, description: 'Écran iPhone 12' }, { id: 2, description: 'Batterie' }];
    const lignes = [{ label: 'Forfait remplacement batterie' }, { label: 'Forfait remplacement écran' }, { label: '' }];
    const de = rattachementCommandes(lignes, cmds, 'Écran cassé');
    expect(de('Forfait remplacement batterie')).toBe(cmds[1]);
    expect(de('Forfait remplacement écran')).toBe(cmds[0]);
    // Symptôme sans ligne correspondante : pas de rattachement deviné
    const autre = rattachementCommandes(lignes.slice(0, 2), [cmds[0]], 'Problème logiciel');
    expect(autre('Forfait remplacement batterie')).toBe(null);
    expect(autre('Forfait remplacement écran')).toBe(null);
  });

  it('sans commande orpheline, seul le libellé ou la prestation comptent', () => {
    const cmds = [{ id: 3, description: 'Batterie' }];
    const de = rattachementCommandes([{ label: 'Forfait remplacement batterie' }, { label: 'Film' }], cmds, 'Batterie');
    expect(de('Forfait remplacement batterie')).toBe(cmds[0]);
    expect(de('Film')).toBe(null);
    expect(rattachementCommandes([{ label: 'Film' }], [], 'Batterie')('Film')).toBe(null);
  });
});

describe('prestations : chargement via l’ApiClient', () => {
  it('charge /api/catalog/prestations une fois puis sert le cache', async () => {
    definirCatalogue(null);
    api._cache.clear();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(CATALOGUE),
    });
    const a = await chargerPrestations();
    const b = await chargerPrestations();
    expect(a).toBe(b);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/api/catalog/prestations');
    expect(libellePrestation('Batterie')).toBe('Forfait remplacement batterie');
  });

  it('ne rejette jamais : null si le serveur est indisponible', async () => {
    definirCatalogue(null);
    api._cache.clear();
    global.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('down'), { name: 'TypeError' }));
    await expect(chargerPrestations()).resolves.toBe(null);
  });
});

// ─── Parité avec le backend (Python), si disponible sur le poste ─────────
// vitest tourne depuis frontend/
const BACKEND = resolve(process.cwd(), '..', 'backend');
const SCRIPT = `
import json, sys
from datetime import datetime
from app.services.prestations import catalogue_prestations, libelle_prestation, lignes_reparation, libelle_court
from app.services.montants import calculer_montants
data = json.load(sys.stdin)
def conv(t):
    t = dict(t)
    if isinstance(t.get('date_depot'), str):
        t['date_depot'] = datetime.fromisoformat(t['date_depot'])
    return t
print(json.dumps({
    'catalogue': catalogue_prestations(),
    'libelles': [libelle_prestation(p, d) for p, d in data['libelles']],
    'courts': [libelle_court(x) for x in data['courts']],
    'lignes': [lignes_reparation(conv(t)) for t in data['tickets']],
    'totaux': [calculer_montants(conv(t))['total'] for t in data['anciens']],
}, ensure_ascii=False))
`;

function backendPython(entrees) {
  if (!existsSync(resolve(BACKEND, 'app', 'services', 'prestations.py'))) return null;
  for (const exe of [process.env.PYTHON, 'python3', 'python'].filter(Boolean)) {
    try {
      const out = execFileSync(exe, ['-c', SCRIPT], { cwd: BACKEND, input: JSON.stringify(entrees), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 15000 });
      return JSON.parse(out);
    } catch { /* interpréteur suivant */ }
  }
  return null;
}

const ENTREES = {
  libelles: [
    ...CAS.map(([e]) => [e, '']),
    ['Autre', 'Face ID ne marche plus'], ['Autre', ''],
    ['Autre', "Le téléphone redémarre\nen boucle après une chute dans l'eau de la piscine"],
    ['Pièce à commander', 'Écran OLED iPhone 14 Pro — fournisseur X réf 123'], ['Pièce à commander', ''],
  ],
  courts: ['Forfait remplacement batterie', 'Batterie externe', 'Lentille caméra', 'Écran'],
  tickets: TICKETS,
  anciens: [],
};
// Ancien format (prix seulement dans tarif_final) : total serveur avant, puis après le premier
// enregistrement des lignes de la fiche (JSON) — les deux doivent être égaux
const ANCIENS = [
  { panne: 'Batterie', devis_estime: 0, tarif_final: 79 },
  { panne: 'Écran cassé', tarif_final: 69, reduction_montant: 10 },
  { panne: 'Batterie', tarif_final: 90, reduction_pourcentage: 10 },
  { panne: 'Autre', panne_detail: 'Bouton home', tarif_final: 45.5, reduction_pourcentage: 15 },
  { panne: 'Écran cassé', devis_estime: 100, tarif_final: 120 },
  { panne: 'Batterie', reparation_supp: 'Film', prix_supp: 10, devis_estime: 50, tarif_final: 70, reduction_montant: 5 },
];
definirCatalogue(CATALOGUE);
ENTREES.anciens = [
  ...ANCIENS,
  ...ANCIENS.map(t => ({ ...t, reparation_supp: JSON.stringify(lignesFiche(t)), tarif_final: 0 })),
];
const PY = backendPython(ENTREES);

describe.skipIf(!PY)('prestations : parité avec backend/app/services/prestations.py', () => {
  beforeEach(() => { definirCatalogue(PY.catalogue); });

  it('la copie de la table servie par l’API est à jour', () => {
    expect(PY.catalogue).toEqual(CATALOGUE);
  });

  it('mêmes libellés de prestation', () => {
    expect(ENTREES.libelles.map(([p, d]) => libellePrestation(p, d))).toEqual(PY.libelles);
  });

  it('mêmes libellés courts', () => {
    expect(ENTREES.courts.map(x => libelleCourt(x))).toEqual(PY.courts);
  });

  it('mêmes lignes imprimées', () => {
    expect(TICKETS.map(t => lignesReparation(t))).toEqual(PY.lignes);
  });

  it('ancien format : même total sur la fiche, avant et après le premier enregistrement', () => {
    const n = ANCIENS.length;
    expect(PY.totaux.slice(n)).toEqual(PY.totaux.slice(0, n));
    ANCIENS.forEach((t, i) => {
      const base = lignesFiche(t).reduce((s, l) => s + prixNombre(l.prix), 0);
      const pct = prixNombre(t.reduction_pourcentage);
      const reduction = pct > 0 ? Math.round(base * pct) / 100 : prixNombre(t.reduction_montant);
      expect(Math.round((base - reduction) * 100) / 100).toBe(PY.totaux[i]);
    });
  });
});
