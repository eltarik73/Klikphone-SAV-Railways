/**
 * Scan comptoir : « Réparation terminée » proposé à tous les statuts actifs (accueil et technicien,
 * confirmation légère quand on saute « En cours », jamais depuis l'accord client), message « prêt »
 * envoyé sans la phrase du montant quand le montant est à 0 €, et ligne « Client contacté »
 * (ContactClient) sous le client avec « Contacté par tél. ».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SCAN_EVENT } from '../lib/scan';

const { auth, apiMock } = vi.hoisted(() => ({
  auth: { user: { target: 'accueil', utilisateur: 'Sophie' } },
  apiMock: {
    resolveCode: vi.fn(),
    getTicket: vi.fn(),
    getNotes: vi.fn(),
    changeStatus: vi.fn(),
    updateTicket: vi.fn(),
    patchKeepalive: vi.fn(),
    getCached: vi.fn(),
    getMessageTemplates: vi.fn(),
    getSmsEtat: vi.fn(),
    envoyerSms: vi.fn(),
    envoyerEmail: vi.fn(),
    logMessage: vi.fn(),
    addPrivateNote: vi.fn(),
    addHistory: vi.fn(),
    restitution: vi.fn(),
    setPaye: vi.fn(),
    contacterClient: vi.fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { ToastProvider } from '../components/Toast';
import { clearCache } from '../hooks/useApi';
import { takePendingScan } from '../components/ScanListener';
import QuickScanPanel, { actionsTicket, indicationPrevenir, montantsTicket, ligneAChiffrer, mentionAChiffrer } from '../components/QuickScanPanel';
import { definirCatalogue } from '../lib/prestations';

const MONTANTS = { total: 89, acompte: 10, reste: 79, paye: false, lignes: [{ label: 'Remplacement écran', prix: 89 }] };
const ZERO = { total: 0, acompte: 0, reste: 0, paye: false, lignes: [] };
const ETAT_ACTIF = { cle_configuree: true, active: true, disponible: true, expediteur: 'KLIKPHONE' };
const SMS_SANS_MONTANT = 'Bonjour Léa, votre Apple iPhone 13 est pret! Vous pouvez venir le recuperer a la boutique. '
  + 'Klikphone 79 Place Saint Leger, Chambery';
const MENTION = 'Montant à 0 € : phrase du montant retirée';

function ticket(overrides = {}) {
  return {
    id: 42, ticket_code: 'KP-000042', statut: 'En attente de pièce', client_id: 5,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '06 12 34 56 78', client_email: 'lea@example.test',
    marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé', date_depot: '2026-10-10T09:00:00',
    paye: 0, acompte: 10, devis_estime: 200, telephone_pret: '', telephone_pret_rendu: false,
    montants: MONTANTS, ...overrides,
  };
}

// Horodatage ISO pour une heure locale donnée (17/10 à hh:mm sur le poste)
const leDixSept = (h, min) => new Date(2026, 9, 17, h, min).toISOString();

let fiche;

function resetApi(overrides = {}) {
  clearCache();
  takePendingScan();
  sessionStorage.clear();
  Object.values(apiMock).forEach((fn) => fn.mockReset());
  fiche = ticket(overrides);
  apiMock.resolveCode.mockResolvedValue({ type: 'ticket', id: 42, ticket_code: 'KP-000042' });
  apiMock.getTicket.mockImplementation(async () => ({ ...fiche }));
  apiMock.getNotes.mockResolvedValue([]);
  apiMock.changeStatus.mockImplementation(async (_id, statut) => {
    fiche = { ...fiche, statut };
    return { ok: true, proposer_message: true };
  });
  apiMock.updateTicket.mockResolvedValue({ ok: true });
  apiMock.patchKeepalive.mockResolvedValue(true);
  apiMock.getCached.mockResolvedValue([]);
  apiMock.getMessageTemplates.mockResolvedValue([]);
  apiMock.getSmsEtat.mockResolvedValue({ ...ETAT_ACTIF, active: false, disponible: false });
  apiMock.logMessage.mockResolvedValue({ id: 1 });
  apiMock.envoyerEmail.mockResolvedValue({ status: 'ok', message: 'envoyé' });
}

function renderPanel() {
  const role = auth.user.target;
  return render(<MemoryRouter initialEntries={[`/${role}`]}><ToastProvider><QuickScanPanel /></ToastProvider></MemoryRouter>);
}

function scanner(code = 'KP-000042') {
  act(() => {
    window.dispatchEvent(new CustomEvent(SCAN_EVENT, { detail: { kind: 'ticket', code, query: code, label: code } }));
  });
}

let open;
beforeEach(() => {
  auth.user = { target: 'accueil', utilisateur: 'Sophie' };
  open = vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Actions proposées (fonction pure) ───────────────────────────────────────

describe('actionsTicket : « Réparation terminée » à tous les statuts actifs', () => {
  const ids = (t, role) => actionsTicket(t, role).map((a) => `${a.id}${a.primary ? '*' : ''}`);
  const terminer = (t, role) => actionsTicket(t, role).find((a) => a.id === 'terminer');
  const SANS_DEMARRER = ['Pré-enregistré', 'En attente de diagnostic', 'En attente de pièce', 'Pièce reçue'];

  it('accueil comme technicien : terminer (+ sans prévenir) depuis pré-enregistré, diagnostic, pièce attendue ou reçue', () => {
    SANS_DEMARRER.forEach((statut) => {
      const t = ticket({ statut });
      const rendre = statut === 'Pré-enregistré' ? [] : ['rendre'];
      expect(ids(t, 'accueil'), statut).toEqual(['terminer', 'terminer_seul', ...rendre]);
      const tech = statut === 'Pré-enregistré' ? [] : ['demarrer*'];
      expect(ids(t, 'tech'), statut).toEqual([...tech, 'terminer', 'terminer_seul', ...rendre]);
      ['accueil', 'tech'].forEach((role) => {
        const a = terminer(t, role);
        expect(a, `${statut} ${role}`).toMatchObject({ statut: 'Réparation terminée', prevenir: true, label: 'Terminé + prévenir le client' });
        expect(a.primary, `${statut} ${role}`).toBeFalsy();
        // Confirmation légère quand on saute « En cours de réparation »
        expect(a.warn.ok).toBe('Oui, terminer');
        expect(a.warn.text).toMatch(/Passer directement en « Réparation terminée » \?$/);
        expect(actionsTicket(t, role).find((x) => x.id === 'terminer_seul').warn).toEqual(a.warn);
      });
    });
    expect(terminer(ticket({ statut: 'En attente de pièce' }), 'accueil').warn.text)
      .toBe('La pièce n’est pas encore marquée reçue. Passer directement en « Réparation terminée » ?');
    expect(terminer(ticket({ statut: 'Pièce reçue' }), 'accueil').warn.text).toBe('Passer directement en « Réparation terminée » ?');
  });

  it('en cours de réparation : terminer mis en avant, sans confirmation', () => {
    ['accueil', 'tech'].forEach((role) => {
      const t = ticket({ statut: 'En cours de réparation' });
      expect(ids(t, role)).toEqual(['terminer*', 'terminer_seul', 'rendre']);
      expect(terminer(t, role).warn).toBeUndefined();
    });
  });

  it('jamais depuis l’accord client (devis refusé pour le serveur) : une ligne renvoie à la fiche', () => {
    const t = ticket({ statut: "En attente d'accord client" });
    expect(ids(t, 'accueil')).toEqual(['accord_fiche', 'rendre']);
    expect(ids(t, 'tech')).toEqual(['demarrer*', 'accord_fiche', 'rendre']);
    const note = actionsTicket(t, 'accueil')[0];
    expect(note).toEqual({ id: 'accord_fiche', label: 'Attente d’accord : passez par la fiche', note: true });
    expect(actionsTicket(t, 'tech').find((a) => a.id === 'demarrer').warn.ok).toBe('Oui, devis accepté');
  });

  it('jamais sur terminé, rendu ou clôturé', () => {
    expect(ids(ticket({ statut: 'Réparation terminée' }), 'accueil')).toEqual(['rendre*']);
    expect(ids(ticket({ statut: 'Réparation terminée' }), 'tech')).toEqual(['rendre*']);
    expect(ids(ticket({ statut: 'Rendu au client' }), 'accueil')).toEqual(['encaisser*']);
    expect(ids(ticket({ statut: 'Clôturé', paye: 1 }), 'tech')).toEqual([]);
  });

  it('client injoignable : un seul « Réparation terminée », pas de doublon « sans prévenir »', () => {
    const t = ticket({ statut: 'En attente de diagnostic', client_tel: '04 79 60 89 22', client_email: '' });
    expect(actionsTicket(t, 'accueil').map((a) => [a.id, a.label])).toEqual([
      ['terminer', 'Réparation terminée'], ['rendre', 'Rendre en l’état…'],
    ]);
  });
});

// ─── Panneau : confirmation légère puis 5 s d'annulation ─────────────────────

describe('QuickScanPanel : « Terminé » hors « En cours de réparation »', () => {
  it('accueil, pièce attendue : confirmation (annulable), puis barre annulable, puis statut et carte « Prévenir »', async () => {
    resetApi({ statut: 'En attente de pièce' });
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    const bouton = await within(dialog).findByRole('button', { name: /Terminé \+ prévenir le client/ });
    expect(bouton).toHaveTextContent('SMS au 06 12 34 56 78 · à valider dans Messages');
    expect(within(dialog).queryByRole('button', { name: /Démarrer la réparation/ })).not.toBeInTheDocument();

    fireEvent.click(bouton);
    const groupe = within(dialog).getByRole('group', { name: 'Confirmation' });
    expect(within(groupe).getByText('La pièce n’est pas encore marquée reçue. Passer directement en « Réparation terminée » ?')).toBeInTheDocument();
    fireEvent.click(within(groupe).getByRole('button', { name: 'Annuler' }));
    expect(within(dialog).queryByRole('group', { name: 'Confirmation' })).not.toBeInTheDocument();
    expect(apiMock.changeStatus).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: /Terminé \+ prévenir le client/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Oui, terminer' }));
    // Barre annulable (5 s) conservée : rien n'est encore parti
    expect(within(dialog).getByText(/« Réparation terminée » puis SMS à envoyer depuis Messages/)).toBeInTheDocument();
    expect(apiMock.changeStatus).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider maintenant' }));
    await waitFor(() => expect(apiMock.changeStatus).toHaveBeenCalledWith(42, 'Réparation terminée'));
    expect(apiMock.changeStatus).toHaveBeenCalledTimes(1);
    const carte = await within(dialog).findByRole('region', { name: 'Prévenir Léa' });
    expect(within(carte).getByRole('button', { name: 'SMS' })).toBeEnabled();
    expect(open).not.toHaveBeenCalled();
    // Ticket relu « terminé » : l'action n'est plus proposée, la remise devient l'action principale
    await waitFor(() => expect(within(dialog).queryByRole('button', { name: /Terminé \+ prévenir/ })).not.toBeInTheDocument());
    expect(within(dialog).getByRole('button', { name: 'Rendre au client' })).toBeInTheDocument();
  });

  it('technicien, pré-enregistré : « Terminé sans prévenir » confirmé, aucun envoi', async () => {
    resetApi({ statut: 'Pré-enregistré' });
    auth.user = { target: 'tech', utilisateur: 'Karim' };
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: /Terminé sans prévenir/ }));
    expect(within(dialog).getByText('Passer directement en « Réparation terminée » ?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Oui, terminer' }));
    expect(within(dialog).getByText(/Passage en « Réparation terminée »/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider maintenant' }));
    expect(await screen.findByText('KP-000042 : Réparation terminée')).toBeInTheDocument();
    expect(apiMock.changeStatus).toHaveBeenCalledWith(42, 'Réparation terminée');
    expect(apiMock.envoyerSms).not.toHaveBeenCalled();
    expect(apiMock.envoyerEmail).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('Échap pendant la confirmation l’annule sans fermer le panneau', async () => {
    resetApi({ statut: 'En attente de diagnostic' });
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: /Terminé \+ prévenir le client/ }));
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Oui, terminer' }), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Oui, terminer' })).not.toBeInTheDocument();
    expect(apiMock.changeStatus).not.toHaveBeenCalled();
  });

  it('accord client attendu : pas de « Terminé », la ligne renvoie à la fiche', async () => {
    resetApi({ statut: "En attente d'accord client" });
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Attente d’accord : passez par la fiche')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Terminé/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Rendre en l’état/ })).toBeInTheDocument();
    cleanup();

    auth.user = { target: 'tech', utilisateur: 'Karim' };
    renderPanel();
    scanner();
    const panneau = await screen.findByRole('dialog');
    expect(await within(panneau).findByRole('button', { name: /Démarrer la réparation/ })).toBeInTheDocument();
    expect(within(panneau).getByText('Attente d’accord : passez par la fiche')).toBeInTheDocument();
    expect(within(panneau).queryByRole('button', { name: /Terminé/ })).not.toBeInTheDocument();
  });
});

// ─── Montant à 0 € : message envoyé sans la phrase du montant ────────────────

describe('QuickScanPanel : montant à 0 €', () => {
  it('mention sous le bouton, SMS serveur envoyé sans « Montant : 0.00 », mention dans la carte', async () => {
    resetApi({ statut: 'En cours de réparation', montants: ZERO });
    apiMock.getSmsEtat.mockResolvedValue(ETAT_ACTIF);
    apiMock.envoyerSms.mockResolvedValue({ ok: true, segments: 1, destinataire: '06 12 34 56 78' });
    expect(indicationPrevenir(ticket({ montants: ZERO }), true)).toBe(`SMS au 06 12 34 56 78 · ${MENTION}`);
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    const bouton = await within(dialog).findByRole('button', { name: /Terminé \+ prévenir le client/ });
    await waitFor(() => expect(bouton).toHaveTextContent(`SMS au 06 12 34 56 78 · ${MENTION}`));
    expect(bouton).not.toHaveTextContent(/renseignez le tarif/);
    fireEvent.click(bouton);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider maintenant' }));

    expect(await screen.findByText(`KP-000042 : Terminé · SMS envoyé au 06 12 34 56 78 · ${MENTION}`)).toBeInTheDocument();
    expect(apiMock.changeStatus).toHaveBeenCalledWith(42, 'Réparation terminée');
    expect(apiMock.envoyerSms).toHaveBeenCalledTimes(1);
    expect(apiMock.envoyerSms).toHaveBeenCalledWith(42, SMS_SANS_MONTANT, 'Appareil pret');
    const carte = within(dialog).getByRole('region', { name: 'Prévenir Léa' });
    expect(within(carte).getByText('SMS envoyé au 06 12 34 56 78')).toBeInTheDocument();
    expect(within(carte).getByText(MENTION)).toBeInTheDocument();
  });

  it('SMS serveur inactif : carte dépliée, texte sans montant, bouton SMS actif (plus de blocage)', async () => {
    resetApi({ statut: 'Réparation terminée', montants: ZERO });
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    const carte = await within(dialog).findByRole('region', { name: 'Prévenir Léa' });
    expect(within(carte).getByText(MENTION)).toBeInTheDocument();
    fireEvent.click(within(carte).getByRole('button', { name: 'Prévenir…' }));
    expect(within(carte).getByText(SMS_SANS_MONTANT)).toBeInTheDocument();
    expect(within(carte).queryByText(/renseignez le tarif/)).not.toBeInTheDocument();
    const sms = within(carte).getByRole('button', { name: 'SMS' });
    expect(sms).toBeEnabled();
    expect(within(carte).getByRole('button', { name: 'E-mail' })).toBeEnabled();
    fireEvent.click(sms);
    expect(open).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(open.mock.calls[0][0])).not.toMatch(/Montant|0\.00/);
    await waitFor(() => expect(apiMock.logMessage).toHaveBeenCalledWith(42, 'Sophie', expect.stringMatching(/^\[Appareil pret\] Bonjour Léa/), 'sms'));
  });

  it('payé : le montant à 0 € est juste, la phrase reste et aucune mention', async () => {
    resetApi({ statut: 'En cours de réparation', paye: 1, montants: { ...ZERO, paye: true } });
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    const bouton = await within(dialog).findByRole('button', { name: /Terminé \+ prévenir le client/ });
    await waitFor(() => expect(bouton).toHaveTextContent('SMS au 06 12 34 56 78'));
    expect(bouton).not.toHaveTextContent(MENTION);
  });
});

// ─── « Client contacté » sous le client ──────────────────────────────────────

describe('QuickScanPanel : ligne « Client contacté »', () => {
  const CONTACT = {
    depuis_statut: true,
    dernier: { canal: 'sms', date: leDixSept(14, 32), auteur: 'Léa' },
    canaux: { sms: leDixSept(14, 32), email: null, whatsapp: null, appel: null },
  };

  it('dernier contact depuis le statut, icônes allumées avec leur info-bulle', async () => {
    resetApi({ contact: CONTACT });
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    const client = within(dialog).getByRole('region', { name: 'Client' });
    expect(within(client).getByText('Contacté par SMS le 17/10 à 14:32')).toBeInTheDocument();
    expect(within(client).getByTitle('SMS envoyé le 17/10 à 14:32 par Léa')).toBeInTheDocument();
    expect(within(client).getByTitle(/Pas d'appel depuis le dernier changement de statut/)).toBeInTheDocument();
    expect(within(client).getByRole('button', { name: 'Contacté par tél.' })).toBeEnabled();
  });

  it('sans contact : « Pas encore contacté »', async () => {
    resetApi();
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    expect(within(within(dialog).getByRole('region', { name: 'Client' })).getByText('Pas encore contacté')).toBeInTheDocument();
  });

  it('« Contacté par tél. » : appel noté par la route, affichage et fiche mis à jour, toast', async () => {
    resetApi({ contact: CONTACT });
    const apres = {
      depuis_statut: true,
      dernier: { canal: 'appel', date: leDixSept(15, 5), auteur: 'Sophie' },
      canaux: { ...CONTACT.canaux, appel: leDixSept(15, 5) },
    };
    apiMock.contacterClient.mockImplementation(async () => {
      fiche = { ...fiche, contact: apres };
      return { contact: apres, note_id: 7 };
    });
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    const client = within(dialog).getByRole('region', { name: 'Client' });
    fireEvent.click(within(client).getByRole('button', { name: 'Contacté par tél.' }));
    await waitFor(() => expect(apiMock.contacterClient).toHaveBeenCalledWith(42));
    expect(await within(client).findByText('Contacté par téléphone le 17/10 à 15:05')).toBeInTheDocument();
    // Notification et annonce polie (aria-live) de la ligne
    expect((await screen.findAllByText('Appel noté')).length).toBeGreaterThanOrEqual(1);
    expect(within(client).getByTitle('Appel passé le 17/10 à 15:05 par Sophie')).toBeInTheDocument();
    // Fiche relue (la note « appel » s'ajoute aux notes du ticket)
    await waitFor(() => expect(apiMock.getTicket.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(apiMock.changeStatus).not.toHaveBeenCalled();
  });
});

// ─── Prestation à chiffrer (reprise) : mention à la place de 0.00 € ──────────

describe('QuickScanPanel : reprise « à chiffrer par la boutique »', () => {
  const REPRISE = { label: 'Reprise de l’appareil (rachat)', prix: 0, cle: 'reprise' };
  const GESTE = { label: 'Nettoyage connecteur de charge', prix: 0, cle: 'nettoyage' };
  const MENTION_PRIX = 'à chiffrer par la boutique';

  afterEach(() => { definirCatalogue(null); });

  it('montantsTicket garde la clé de prestation du serveur, sans en inventer', () => {
    const m = montantsTicket(ticket({ montants: { ...ZERO, lignes: [REPRISE, { label: 'Écran', prix: 89 }] } }));
    expect(m.lignes).toEqual([REPRISE, { label: 'Écran', prix: 89 }]);
    expect('cle' in m.lignes[1]).toBe(false);
  });

  it('ligneAChiffrer : reprise à 0 € seulement (prix saisi, autre prestation ou ligne sans clé : non)', () => {
    expect(ligneAChiffrer(REPRISE)).toBe(true);
    expect(ligneAChiffrer({ ...REPRISE, prix: 80 })).toBe(false);
    expect(ligneAChiffrer(GESTE)).toBe(false);
    expect(ligneAChiffrer({ label: 'Reprise de l’appareil (rachat)', prix: 0 })).toBe(false);
    expect(mentionAChiffrer()).toBe(MENTION_PRIX);
    // Catalogue chargé : la clé se déduit du libellé et la mention vient de la table
    definirCatalogue({
      prestations: [{ cle: 'reprise', symptome: 'Reprise téléphone', prestation: 'Reprise de l’appareil (rachat)', court: 'Reprise', alias: ['Rachat'], a_chiffrer: true }],
      mention_a_chiffrer: 'montant à fixer en boutique',
    });
    expect(ligneAChiffrer({ label: 'Reprise de l’appareil (rachat)', prix: 0 })).toBe(true);
    expect(mentionAChiffrer()).toBe('montant à fixer en boutique');
  });

  async function attendreAppareil() {
    const dialog = await screen.findByRole('dialog');
    return { dialog, appareil: within(dialog).getByRole('region', { name: 'Appareil' }) };
  }

  it('le scan affiche la mention à la place de 0.00 € sur la ligne de reprise (clé du serveur), le prix sur les autres', async () => {
    resetApi({
      statut: 'En attente de diagnostic', panne: 'Reprise téléphone', devis_estime: 0,
      montants: { ...ZERO, lignes: [REPRISE, GESTE] },
    });
    renderPanel();
    scanner();
    const { dialog, appareil } = await attendreAppareil();
    const reprise = within(appareil).getByText(REPRISE.label).closest('li');
    expect(within(reprise).getByText(MENTION_PRIX)).toHaveClass('t-caption');
    expect(within(reprise).queryByText('0.00 €')).not.toBeInTheDocument();
    const geste = within(appareil).getByText(GESTE.label).closest('li');
    expect(within(geste).getByText('0.00 €')).toBeInTheDocument();
    expect(within(geste).queryByText(MENTION_PRIX)).not.toBeInTheDocument();
    // Le passage en « terminé » reste proposé (montant à 0 € : phrase du montant retirée du message)
    expect(within(dialog).getByRole('button', { name: /Terminé \+ prévenir le client/ })).toBeInTheDocument();
  });

  it('lignes du serveur sans clé (calculer_montants) : le catalogue, lu au scan, reconnaît la reprise par son libellé', async () => {
    const { cle, ...sansCle } = REPRISE;
    resetApi({ statut: 'En attente de diagnostic', panne: 'Reprise téléphone', devis_estime: 0, montants: { ...ZERO, lignes: [sansCle] } });
    apiMock.getCached.mockImplementation(async (chemin) => (chemin === '/api/catalog/prestations'
      ? { prestations: [{ cle, symptome: 'Reprise téléphone', prestation: REPRISE.label, court: 'Reprise', alias: ['Rachat'], a_chiffrer: true }] }
      : []));
    renderPanel();
    scanner();
    const { appareil } = await attendreAppareil();
    const reprise = within(appareil).getByText(REPRISE.label).closest('li');
    expect(await within(reprise).findByText(MENTION_PRIX)).toBeInTheDocument();
    expect(within(reprise).queryByText('0.00 €')).not.toBeInTheDocument();
    expect(apiMock.getCached).toHaveBeenCalledWith('/api/catalog/prestations', expect.any(Number));
  });

  it('sans catalogue ni clé, le prix 0.00 € reste affiché (aucune invention)', async () => {
    const { cle, ...sansCle } = REPRISE;
    resetApi({ statut: 'En attente de diagnostic', montants: { ...ZERO, lignes: [sansCle] } });
    renderPanel();
    scanner();
    const { appareil } = await attendreAppareil();
    const reprise = within(appareil).getByText(REPRISE.label).closest('li');
    expect(within(reprise).getByText('0.00 €')).toBeInTheDocument();
    expect(cle).toBe('reprise');
  });
});
