/**
 * Synchro automatique des tarifs Mobilax : tuile « Synchro Mobilax » de la santé des prix,
 * bloc SynchroFournisseur (état, connexion en une étape, « Synchroniser maintenant »).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';

const { apiMock } = vi.hoisted(() => {
  const base = {};
  const apiMock = new Proxy(base, {
    get(target, cle) {
      if (!(cle in target)) target[cle] = vi.fn().mockResolvedValue({});
      return target[cle];
    },
  });
  return { apiMock };
});

vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { ToastProvider } from '../components/Toast';
import { tuilesSante } from '../components/SantePrixWidget';
import SynchroFournisseur, { decrireMobilax, decrireUtopya, COMMANDE_CONSOLE, DiagnosticMobilax } from '../components/SynchroFournisseur';

const MAINTENANT = new Date('2026-11-04T12:00:00').getTime();
const UTOPYA = { disponible: false, raison: 'Utopya : prix sous connexion, Cloudflare.' };
const RESUME_OK = { ok: true, modifies: 12, confirmes: 300, propositions: 3, verrouillees: 2, produits: 1450, modeles: 210 };
const CONNECTE = {
  configure: true, connexion: 'ok', active: true, en_cours: false, debut: null,
  derniere_synchro: '2026-11-04T05:10:00', ok: true, resume: RESUME_OK, erreur: null, message: null, compte: true,
};
const NON_CONNECTE = {
  configure: false, connexion: 'absente', active: true, en_cours: false, debut: null,
  derniere_synchro: null, ok: null, resume: null, erreur: null, message: null, compte: false,
};

function resetApi() {
  for (const fn of Object.values(apiMock)) {
    if (typeof fn?.mockReset === 'function') fn.mockReset().mockResolvedValue({});
  }
}

beforeEach(() => { resetApi(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const rendre = (props = {}) => render(<ToastProvider><SynchroFournisseur intervalle={10} {...props} /></ToastProvider>);

describe('tuile « Synchro Mobilax » de la santé des prix', () => {
  const tuile = (mobilax) => Object.fromEntries(tuilesSante({ fournisseurs: { mobilax } }, '/accueil', MAINTENANT).map(x => [x.cle, x])).mobilax;

  it('à connecter, expirée, échouée, à jour, ancienne, en cours', () => {
    expect(tuile(NON_CONNECTE)).toMatchObject({ valeur: '—', ton: 'orange', detail: 'à connecter (une seule fois)', lien: '/accueil/tarifs' });
    expect(tuile({ ...CONNECTE, connexion: 'expiree' })).toMatchObject({ ton: 'rouge', detail: 'connexion expirée' });
    expect(tuile({ ...CONNECTE, ok: false, derniere_synchro: '2026-11-03T05:10:00' })).toMatchObject({ ton: 'rouge', valeur: '1 j', detail: '03/11/2026 · échouée' });
    expect(tuile({ ...CONNECTE, modifies: 12 })).toMatchObject({ ton: 'neutre', valeur: 'Auj.', detail: '04/11/2026 · 12 prix mis à jour', titre: 'Synchro Mobilax' });
    expect(tuile({ ...CONNECTE, derniere_synchro: '2026-10-30T05:10:00', modifies: 0 })).toMatchObject({ ton: 'orange', valeur: '5 j' });
    expect(tuile({ ...CONNECTE, en_cours: true })).toMatchObject({ ton: 'marque', detail: 'synchronisation en cours…' });
    expect(tuile({ ...CONNECTE, derniere_synchro: null, ok: null })).toMatchObject({ valeur: '—', ton: 'neutre', detail: 'première synchro à venir' });
    // Sans la clé (ancien serveur) : jamais de plantage
    expect(Object.fromEntries(tuilesSante({}, '/tech').map(x => [x.cle, x])).mobilax).toMatchObject({ ton: 'orange', valeur: '—' });
  });

  it('huit tuiles, la tuile Mobilax après LCD-Phone', () => {
    const cles = tuilesSante({}, '/accueil').map(x => x.cle);
    expect(cles).toEqual(['estimes', 'a_revoir', 'perimes', 'marges', 'appliques', 'sans_prix', 'lcdphone', 'mobilax']);
  });
});

describe('decrireMobilax', () => {
  it('phrases selon l’état', () => {
    expect(decrireMobilax(null).ton).toBe('neutre');
    expect(decrireMobilax(NON_CONNECTE)).toMatchObject({ ton: 'attention', titre: 'Mobilax : pas encore connecté' });
    expect(decrireMobilax({ ...CONNECTE, connexion: 'expiree' })).toMatchObject({ ton: 'danger', titre: 'Connexion Mobilax expirée' });
    expect(decrireMobilax({ ...CONNECTE, en_cours: true, debut: '2026-11-04T11:58:00' }).titre).toBe('Synchronisation Mobilax en cours…');
    const ok = decrireMobilax(CONNECTE);
    expect(ok.ton).toBe('ok');
    expect(ok.titre).toMatch(/^Dernière synchro Mobilax : 04\/11\/2026/);
    expect(ok.detail).toBe('12 prix mis à jour · 300 confirmés · 3 à valider (Propositions) · 2 verrouillés — 1450 produits lus pour 210 modèles.');
    expect(decrireMobilax({ ...CONNECTE, ok: false, erreur: 'Mobilax indisponible (HTTP 503)' })).toMatchObject({ ton: 'danger', detail: 'Mobilax indisponible (HTTP 503)' });
    // Prix estimés / périmés remplacés sans validation, propositions réglées, pièces sans prix
    const riche = decrireMobilax({ ...CONNECTE, resume: { ...RESUME_OK, remplaces: 250, propositions_fermees: 300, sans_prix: 412 } });
    expect(riche.detail).toBe('12 prix mis à jour · 300 confirmés · dont 250 prix estimés ou périmés remplacés sans validation · 3 à valider (Propositions) · 300 propositions réglées · 2 verrouillés · 412 pièces de la grille sans prix Mobilax — 1450 produits lus pour 210 modèles.');
    expect(decrireMobilax({ ...CONNECTE, resume: { ...RESUME_OK, remplaces: 1, sans_prix: 1, propositions_fermees: 1 } }).detail).toContain('dont 1 prix estimé ou périmé remplacé sans validation · 3 à valider (Propositions) · 1 proposition réglée · 2 verrouillés · 1 pièce de la grille sans prix Mobilax');
    expect(decrireMobilax({ ...CONNECTE, resume: { ...RESUME_OK, autre_fournisseur_choisi: 2 } }).detail).toContain('2 laissées à Utopya (fournisseur retenu)');
    expect(decrireMobilax({ ...CONNECTE, ok: null, derniere_synchro: null, resume: null })).toMatchObject({ ton: 'neutre', titre: 'Mobilax connecté' });
    expect(decrireMobilax({ ...CONNECTE, ok: null, derniere_synchro: null, resume: null, active: false }).detail).toBe('Synchro quotidienne coupée.');
  });
});

describe('pièces sans prix Mobilax (DiagnosticMobilax)', () => {
  const DIAG = {
    le: '2026-11-04T12:46:27', n: 3, tronque: false,
    par_raison: { non_reconnue: 1, piece_absente: 1, aucun_produit: 1, non_cherchee: 0 },
    raisons: { non_reconnue: 'Des produits Mobilax ressemblent, sans être rattachés à la pièce (nom à vérifier)', piece_absente: 'Mobilax a des produits pour ce modèle, mais pas cette pièce', aucun_produit: 'Mobilax ne renvoie aucun produit pour ce modèle', non_cherchee: 'Modèle non cherché (passage incomplet)' },
    pieces: [
      { cle: 'tarifs:2', marque: 'Google', modele: 'Pixel 7', type_piece: 'Batterie', qualite: null, raison: 'non_reconnue', candidats: [{ nom: 'Batterie Google Pixel 7 GTF8P', prix_ht: 12.5 }] },
      { cle: 'tarifs:3', marque: 'Google', modele: 'Pixel 7', type_piece: 'Connecteur de charge', qualite: null, raison: 'piece_absente', candidats: [] },
      { cle: 'tarifs:4', marque: 'Oppo', modele: 'Reno 10', type_piece: 'Ecran', qualite: 'OLED', raison: 'aucun_produit', candidats: [] },
    ],
  };

  it('rien à afficher quand toutes les pièces ont un prix', () => {
    const { container } = render(<DiagnosticMobilax nombre={0} estAdmin />);
    expect(container).toBeEmptyDOMElement();
  });

  it('admin : liste par raison avec les prix des candidats ; le diagnostic n’est lu qu’à l’ouverture', async () => {
    apiMock.getDiagnosticMobilax.mockResolvedValue(DIAG);
    render(<DiagnosticMobilax nombre={3} estAdmin />);
    const bouton = screen.getByRole('button', { name: /3 pièces sans prix Mobilax/ });
    expect(bouton).toHaveAttribute('aria-expanded', 'false');
    expect(apiMock.getDiagnosticMobilax).not.toHaveBeenCalled();
    fireEvent.click(bouton);
    expect(await screen.findByText('Google Pixel 7 — Batterie')).toBeInTheDocument();
    expect(screen.getByText(/Batterie Google Pixel 7 GTF8P \(12,50 € HT\)/)).toBeInTheDocument();
    expect(screen.getByText('Google Pixel 7 — Connecteur de charge')).toBeInTheDocument();
    expect(screen.getByText('Oppo Reno 10 — Ecran OLED')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Des produits Mobilax ressemblent.*\(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /aucun produit pour ce modèle.*\(1\)/ })).toBeInTheDocument();
    expect(apiMock.getDiagnosticMobilax).toHaveBeenCalledTimes(1);
    fireEvent.click(bouton);
    expect(screen.queryByText('Google Pixel 7 — Batterie')).not.toBeInTheDocument();
  });

  it('personnel : les candidats sans prix ; erreur de lecture affichée', async () => {
    apiMock.getDiagnosticMobilax.mockResolvedValue({ ...DIAG, pieces: DIAG.pieces.map((p) => ({ ...p, candidats: p.candidats.map((c) => ({ nom: c.nom })) })) });
    render(<DiagnosticMobilax nombre={1} estAdmin={false} />);
    fireEvent.click(screen.getByRole('button', { name: /1 pièce sans prix Mobilax/ }));
    expect(await screen.findByText(/Batterie Google Pixel 7 GTF8P/)).toBeInTheDocument();
    expect(screen.queryByText(/€ HT/)).not.toBeInTheDocument();
    cleanup();
    apiMock.getDiagnosticMobilax.mockRejectedValue(new Error('500'));
    render(<DiagnosticMobilax nombre={2} />);
    fireEvent.click(screen.getByRole('button', { name: /2 pièces sans prix Mobilax/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('500');
  });

  it('produit vu sans prix (rupture) : sa propre raison, en tête, candidats marqués', async () => {
    apiMock.getDiagnosticMobilax.mockResolvedValue({
      ...DIAG, n: 2, par_raison: { sans_prix_fournisseur: 1, non_reconnue: 1 },
      raisons: { ...DIAG.raisons, sans_prix_fournisseur: 'Mobilax a la pièce, mais sans prix pour votre compte (rupture ou produit retiré)' },
      pieces: [
        { cle: 'tarifs:9', marque: 'Apple', modele: 'iPhone 11', type_piece: 'Bouton power', qualite: null, raison: 'sans_prix_fournisseur',
          candidats: [{ nom: 'Nappe Power On/Off Apple iPhone 11 (Flash)', prix_ht: null, sans_prix: true, en_stock: false }] },
        DIAG.pieces[0],
      ],
    });
    render(<DiagnosticMobilax nombre={2} estAdmin />);
    fireEvent.click(screen.getByRole('button', { name: /2 pièces sans prix Mobilax/ }));
    const titres = await screen.findAllByRole('heading');
    expect(titres[0]).toHaveTextContent(/Mobilax a la pièce, mais sans prix pour votre compte.*\(1\)/);
    expect(screen.getByText('Apple iPhone 11 — Bouton power')).toBeInTheDocument();
    expect(screen.getByText(/Nappe Power On\/Off Apple iPhone 11 \(Flash\) \(sans prix, rupture\)/)).toBeInTheDocument();
  });

  it('bloc de synchro : le bouton apparaît après un passage réussi avec des pièces sans prix', async () => {
    apiMock.getEtatFournisseurs.mockResolvedValue({ mobilax: { ...CONNECTE, resume: { ...RESUME_OK, sans_prix: 412 } }, utopya: UTOPYA });
    rendre({ estAdmin: false });
    expect(await screen.findByRole('button', { name: /412 pièces sans prix Mobilax/ })).toBeInTheDocument();
  });
});

describe('bloc SynchroFournisseur', () => {
  it('personnel : état seul, sans bouton ; mention Utopya', async () => {
    apiMock.getEtatFournisseurs.mockResolvedValue({ mobilax: CONNECTE, utopya: UTOPYA });
    rendre({ estAdmin: false });
    expect(await screen.findByText(/Dernière synchro Mobilax : 04\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByText('Utopya : collecte indisponible')).toBeInTheDocument();
    expect(screen.getByText('Utopya : prix sous connexion, Cloudflare.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Synchroniser maintenant/ })).not.toBeInTheDocument();
  });

  it('admin non connecté : « Synchroniser maintenant » bloqué, connexion en une étape', async () => {
    apiMock.getEtatFournisseurs.mockResolvedValue({ mobilax: NON_CONNECTE, utopya: UTOPYA });
    apiMock.connecterMobilax.mockResolvedValue({ mobilax: { ...CONNECTE, ok: null, derniere_synchro: null, resume: null }, utopya: UTOPYA });
    rendre({ estAdmin: true });
    expect(await screen.findByText('Mobilax : pas encore connecté')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Synchroniser maintenant/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Connecter Mobilax' }));
    expect(screen.getByText(COMMANDE_CONSOLE)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /mobilax\.fr/ })).toHaveAttribute('target', '_blank');
    const zone = screen.getByLabelText('Texte copié depuis mobilax.fr');
    const enregistrer = screen.getByRole('button', { name: 'Enregistrer la connexion' });
    expect(enregistrer).toBeDisabled();
    fireEvent.change(zone, { target: { value: '{"web_mobi_refresh_token":"abc"}' } });
    fireEvent.click(enregistrer);
    await waitFor(() => expect(apiMock.connecterMobilax).toHaveBeenCalledWith('{"web_mobi_refresh_token":"abc"}'));
    expect(await screen.findByText('Mobilax connecté')).toBeInTheDocument();
    expect(screen.queryByLabelText('Texte copié depuis mobilax.fr')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Synchroniser maintenant/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reconnecter Mobilax' })).toBeInTheDocument();
  });

  it('connexion refusée : message d’erreur, jetons jamais affichés', async () => {
    apiMock.getEtatFournisseurs.mockResolvedValue({ mobilax: NON_CONNECTE, utopya: UTOPYA });
    apiMock.connecterMobilax.mockRejectedValue(Object.assign(new Error('Jeton Mobilax refusé ou expiré'), { status: 422 }));
    rendre({ estAdmin: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Connecter Mobilax' }));
    fireEvent.change(screen.getByLabelText('Texte copié depuis mobilax.fr'), { target: { value: 'secret-jeton-xyz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la connexion' }));
    expect(await screen.findByText(/Connexion Mobilax refusée : Jeton Mobilax refusé ou expiré/)).toBeInTheDocument();
    // Le texte collé reste dans la zone (pour corriger), jamais dans l'état affiché
    expect(screen.getByLabelText('Texte copié depuis mobilax.fr')).toHaveValue('secret-jeton-xyz');
    expect(screen.getAllByRole('status')[0]).not.toHaveTextContent('secret-jeton-xyz');
  });

  it('admin connecté : « Synchroniser maintenant » lance puis suit jusqu’à la fin', async () => {
    apiMock.getEtatFournisseurs
      .mockResolvedValueOnce({ mobilax: CONNECTE, utopya: UTOPYA })
      .mockResolvedValueOnce({ mobilax: { ...CONNECTE, en_cours: true }, utopya: UTOPYA })
      .mockResolvedValue({ mobilax: { ...CONNECTE, resume: { ...RESUME_OK, modifies: 7, propositions: 0 } }, utopya: UTOPYA });
    apiMock.syncMobilax.mockResolvedValue({ lance: true, message: 'Synchronisation lancée : quelques minutes.' });
    rendre({ estAdmin: true });
    const bouton = await screen.findByRole('button', { name: 'Synchroniser maintenant' });
    fireEvent.click(bouton);
    await waitFor(() => expect(apiMock.syncMobilax).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Synchronisation Mobilax en cours…')).toBeInTheDocument();
    expect(await screen.findByText(/Synchronisation Mobilax terminée : 7 prix mis à jour/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Synchroniser maintenant' })).toBeEnabled());
    expect(apiMock.getEtatFournisseurs.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('admin : synchro quotidienne coupée ou remise, connexion oubliée', async () => {
    apiMock.getEtatFournisseurs.mockResolvedValue({ mobilax: CONNECTE, utopya: UTOPYA });
    apiMock.reglerSynchroMobilax.mockResolvedValue({ mobilax: { ...CONNECTE, active: false }, utopya: UTOPYA });
    apiMock.deconnecterMobilax.mockResolvedValue({ mobilax: NON_CONNECTE, utopya: UTOPYA });
    rendre({ estAdmin: true });
    const chaqueJour = await screen.findByRole('checkbox', { name: 'Chaque jour' });
    expect(chaqueJour).toBeChecked();
    fireEvent.click(chaqueJour);
    await waitFor(() => expect(apiMock.reglerSynchroMobilax).toHaveBeenCalledWith(false));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Chaque jour' })).not.toBeChecked());
    fireEvent.click(screen.getByRole('button', { name: 'Oublier la connexion' }));
    await waitFor(() => expect(apiMock.deconnecterMobilax).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Mobilax : pas encore connecté')).toBeInTheDocument();
  });

  it('état indisponible : phrase neutre, pas de plantage', async () => {
    apiMock.getEtatFournisseurs.mockRejectedValue(new Error('500'));
    rendre({ estAdmin: true });
    expect(await screen.findByText('Synchro Mobilax : état indisponible pour le moment')).toBeInTheDocument();
  });
});

describe('fournisseur retenu pour la grille (jamais « le moins cher »)', () => {
  it('admin : Mobilax par défaut ; « Utopya » enregistre et aligne les prix (tâche de fond)', async () => {
    apiMock.getEtatFournisseurs.mockResolvedValue({ mobilax: CONNECTE, utopya: UTOPYA, preference: 'Mobilax', preference_defaut: true, preference_en_cours: false, preference_resultat: null });
    apiMock.setPreferenceFournisseur.mockResolvedValue({ preference: 'Utopya', lance: true, etat: { mobilax: CONNECTE, utopya: UTOPYA, preference: 'Utopya', preference_defaut: false, preference_en_cours: true, preference_resultat: null } });
    rendre({ estAdmin: true });
    expect(await screen.findByText('Fournisseur retenu pour la grille : Mobilax (par défaut)')).toBeInTheDocument();
    expect(screen.getByText('Ses prix deviennent les coûts retenus, sans validation ni comparaison de prix ; une pièce qu’il n’a pas garde l’autre fournisseur.')).toBeInTheDocument();
    const groupe = screen.getByRole('group', { name: 'Fournisseur retenu pour la grille' });
    expect(within(groupe).getAllByRole('button').map((b) => b.textContent)).toEqual(['Mobilax', 'Utopya']);
    expect(within(groupe).getByRole('button', { name: 'Mobilax' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(groupe).queryByRole('button', { name: /moins cher/i })).not.toBeInTheDocument();
    // Après le clic, le suivi relit l'état : l'alignement est en cours (sinon la relecture effacerait le message aussitôt)
    apiMock.getEtatFournisseurs.mockResolvedValue({ mobilax: CONNECTE, utopya: UTOPYA, preference: 'Utopya', preference_defaut: false, preference_en_cours: true, preference_resultat: null });
    fireEvent.click(within(groupe).getByRole('button', { name: 'Utopya' }));
    await waitFor(() => expect(apiMock.setPreferenceFournisseur).toHaveBeenCalledWith('Utopya'));
    expect(await screen.findByText('Fournisseur retenu pour la grille : Utopya')).toBeInTheDocument();
    expect(screen.getByText('Alignement des prix en cours…')).toBeInTheDocument();
    expect(within(groupe).getByRole('button', { name: 'Utopya' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(groupe).getByRole('button', { name: 'Mobilax' })).toBeDisabled();
  });

  it('résultat du dernier alignement ; personnel : rien', async () => {
    apiMock.getEtatFournisseurs.mockResolvedValue({ mobilax: CONNECTE, utopya: UTOPYA, preference: 'Mobilax', preference_defaut: false, preference_en_cours: false,
      preference_resultat: { modifies: 40, inchangees: 700, verrouillees: 2, sans_prix: 10 } });
    rendre({ estAdmin: true });
    expect(await screen.findByText('Fournisseur retenu pour la grille : Mobilax')).toBeInTheDocument();
    expect(screen.getByText('Dernier alignement : 40 prix changés, 700 inchangés, 2 verrouillés.')).toBeInTheDocument();
    cleanup();
    rendre({ estAdmin: false });
    await screen.findByText(/Dernière synchro Mobilax/);
    expect(screen.queryByText(/Fournisseur retenu pour la grille/)).not.toBeInTheDocument();
  });

  it('phrases : grosses variations appliquées sans validation', () => {
    expect(decrireMobilax({ ...CONNECTE, resume: { ...RESUME_OK, propositions: 0, variations_appliquees: 4 } }).detail).toContain('dont 4 grosses variations appliquées');
  });
});

describe('collecte Utopya (favori dans le navigateur du gérant)', () => {
  const UTO_OK = {
    disponible: true, configure: true, en_cours: false, debut: null, derniere_collecte: '2026-11-04T18:00:00', ok: true, erreur: null, message: null,
    resume: { modifies: 40, remplaces: 30, propositions: 2, complements: 15, autre_fournisseur_choisi: 4, purge: { supprimes: 3 }, sans_prix: 120, produits: 9000, pages_lues: 260, pages_total: 266, erreurs_pages: 0, interrompu: false },
  };
  const UTO_VIDE = { disponible: true, configure: false, en_cours: false, debut: null, derniere_collecte: null, ok: null, resume: null, erreur: null, message: null };

  it('decrireUtopya : indisponible, à installer, installé, en cours, réussie, échouée', () => {
    expect(decrireUtopya(null).ton).toBe('neutre');
    expect(decrireUtopya({ disponible: false, raison: 'Cloudflare' })).toMatchObject({ ton: 'neutre', titre: 'Utopya : collecte indisponible', detail: 'Cloudflare' });
    expect(decrireUtopya(UTO_VIDE)).toMatchObject({ ton: 'attention', titre: 'Utopya : collecteur à installer' });
    expect(decrireUtopya({ ...UTO_VIDE, configure: true })).toMatchObject({ ton: 'neutre', titre: 'Collecteur Utopya installé' });
    expect(decrireUtopya({ ...UTO_OK, en_cours: true }).titre).toBe('Collecte Utopya en cours…');
    const ok = decrireUtopya(UTO_OK);
    expect(ok.ton).toBe('ok');
    expect(ok.titre).toMatch(/^Dernière collecte Utopya : 04\/11\/2026/);
    expect(ok.detail).toContain('40 prix mis à jour');
    expect(ok.detail).toContain('dont 30 prix estimés ou périmés remplacés');
    expect(ok.detail).toContain('2 à valider (Propositions)');
    expect(ok.detail).toContain('15 pièces que Mobilax n’a pas (complétées par Utopya)');
    expect(ok.detail).toContain('4 laissées à Mobilax (fournisseur retenu)');
    expect(ok.detail).toContain('3 prix retirés (reconditionné ou compatible pris pour un original)');
    expect(ok.detail).not.toMatch(/moins cher/);
    expect(ok.detail).toContain('120 pièces de la grille sans prix Utopya');
    expect(ok.detail).toContain('9000 produits lus sur 260 pages');
    expect(decrireUtopya({ ...UTO_OK, resume: { ...UTO_OK.resume, interrompu: true } }).detail).toContain('collecte arrêtée avant la fin');
    expect(decrireUtopya({ ...UTO_OK, ok: false, erreur: 'connectez-vous' })).toMatchObject({ ton: 'danger', detail: 'connectez-vous' });
    // Mobilax : pièces qu'Utopya n'a pas, complétées par Mobilax ; jamais de « moins cher »
    expect(decrireMobilax({ ...CONNECTE, resume: { ...RESUME_OK, complements: 3 } }).detail).toContain('3 pièces qu’Utopya n’a pas (complétées par Mobilax)');
    expect(decrireMobilax({ ...CONNECTE, resume: { ...RESUME_OK, purge: { supprimes: 1 } } }).detail).toContain('1 prix retiré (reconditionné ou compatible pris pour un original)');
  });

  it('personnel : état de la collecte, diagnostic Utopya, aucun bouton', async () => {
    apiMock.getEtatFournisseurs.mockResolvedValue({ mobilax: CONNECTE, utopya: UTO_OK });
    apiMock.getDiagnosticUtopya.mockResolvedValue({ n: 1, raisons: {}, pieces: [{ cle: 'tarifs:1', marque: 'Apple', modele: 'iPhone 13', type_piece: 'Ecran', qualite: 'Original', raison: 'non_reconnue', candidats: [{ nom: 'Ecran Complet iPhone 13 (ReLife)' }] }] });
    rendre();
    expect(await screen.findByText(/^Dernière collecte Utopya : 04\/11\/2026/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /collecteur/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /120 pièces sans prix Utopya/ }));
    await waitFor(() => expect(apiMock.getDiagnosticUtopya).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Des produits Utopya ressemblent/)).toBeInTheDocument();
    expect(screen.getByText(/Utopya : Ecran Complet iPhone 13 \(ReLife\)/)).toBeInTheDocument();
  });

  it('admin : installer le collecteur → favori (adresse javascript:), copie, nouvelle clé', async () => {
    apiMock.getEtatFournisseurs.mockResolvedValue({ mobilax: CONNECTE, utopya: UTO_VIDE });
    apiMock.getCollecteurUtopya.mockResolvedValue({ url: 'javascript:void(1)', version: '1', site: 'https://www.utopya.fr/', api: 'https://kp.example' });
    apiMock.regenererCollecteurUtopya.mockResolvedValue({ url: 'javascript:void(2)', version: '1', site: 'https://www.utopya.fr/', api: 'https://kp.example' });
    rendre({ estAdmin: true });
    expect(await screen.findByText('Utopya : collecteur à installer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Installer le collecteur' }));
    await waitFor(() => expect(apiMock.getCollecteurUtopya).toHaveBeenCalledTimes(1));
    const lien = await screen.findByRole('link', { name: 'Collecte Utopya' });
    await waitFor(() => expect(lien.getAttribute('href')).toBe('javascript:void(1)'));
    expect(lien).toHaveAttribute('draggable', 'true');
    // Un clic ici ne lance rien (le favori se clique sur utopya.fr)
    fireEvent.click(lien);
    expect(await screen.findByText(/glissez ce bouton dans la barre des favoris/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /utopya\.fr/ })).toHaveAttribute('href', 'https://www.utopya.fr/');
    expect(screen.getByRole('button', { name: 'Réinstaller le collecteur' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Nouvelle clé/ }));
    await waitFor(() => expect(apiMock.regenererCollecteurUtopya).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Collecte Utopya' }).getAttribute('href')).toBe('javascript:void(2)'));
    expect(screen.getByRole('link', { name: 'Collecte Utopya' })).not.toHaveTextContent('kp.example');
  });

  it('collecte en cours : suivie jusqu’à la fin', async () => {
    apiMock.getEtatFournisseurs
      .mockResolvedValueOnce({ mobilax: CONNECTE, utopya: { ...UTO_OK, en_cours: true, ok: null } })
      .mockResolvedValue({ mobilax: CONNECTE, utopya: UTO_OK });
    rendre();
    expect(await screen.findByText('Collecte Utopya en cours…')).toBeInTheDocument();
    expect(await screen.findByText(/^Dernière collecte Utopya : 04\/11\/2026/)).toBeInTheDocument();
    expect(apiMock.getEtatFournisseurs.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
