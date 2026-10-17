/**
 * Gains rapides : étagère « À récupérer » (dashboard), message « prêt » proposé après un
 * changement de statut (MessageComposer, scan comptoir), règles du paramètre NOTIFICATIONS_STATUTS.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SCAN_EVENT } from '../lib/scan';

const { auth, apiMock } = vi.hoisted(() => ({
  auth: { user: { target: 'accueil', utilisateur: 'Sophie' } },
  apiMock: {
    getDashboard: vi.fn(),
    getActiveTeam: vi.fn(),
    getInteractions: vi.fn(),
    getClients: vi.fn(),
    getMessageTemplates: vi.fn(),
    getCached: vi.fn(),
    logMessage: vi.fn(),
    addPrivateNote: vi.fn(),
    envoyerEmail: vi.fn(),
    resolveCode: vi.fn(),
    getTicket: vi.fn(),
    getNotes: vi.fn(),
    changeStatus: vi.fn(),
    updateTicket: vi.fn(),
    restitution: vi.fn(),
    setPaye: vi.fn(),
    addHistory: vi.fn(),
    patchKeepalive: vi.fn(),
    background: (fn) => fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { ToastProvider } from '../components/Toast';
import { clearCache } from '../hooks/useApi';
import { takePendingScan } from '../components/ScanListener';
import QuickScanPanel from '../components/QuickScanPanel';
import MessageComposer from '../components/MessageComposer';
import DashboardPage from '../pages/DashboardPage';
import { badgeAttente, formatDelai, situationAbandon, groupesEtagere } from '../lib/etagere';
import {
  modelePourStatut, statutsNotifies, basculerStatutNotifie, STATUTS_MESSAGE,
} from '../lib/messages';

const MONTANTS = { total: 89, acompte: 10, reste: 79, paye: false, lignes: [{ label: 'Écran', prix: 89 }] };

function ticket(overrides = {}) {
  return {
    id: 42, ticket_code: 'KP-000042', statut: 'Réparation terminée', client_id: 5,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '06 12 34 56 78', client_email: '',
    marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé', date_depot: '2026-10-10T09:00:00',
    paye: 0, acompte: 10, devis_estime: 200, telephone_pret: '', telephone_pret_rendu: false,
    montants: MONTANTS, ...overrides,
  };
}

function resetApi() {
  clearCache();
  takePendingScan();
  sessionStorage.clear();
  Object.values(apiMock).forEach((fn) => fn.mockReset?.());
  apiMock.getActiveTeam.mockResolvedValue([]);
  apiMock.getInteractions.mockResolvedValue({});
  apiMock.getClients.mockResolvedValue([]);
  apiMock.getMessageTemplates.mockResolvedValue([]);
  apiMock.getCached.mockResolvedValue([]);
  apiMock.getNotes.mockResolvedValue([]);
  apiMock.logMessage.mockResolvedValue({ id: 1 });
  apiMock.updateTicket.mockResolvedValue({ ok: true });
  apiMock.patchKeepalive.mockResolvedValue(true);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Règles pures ────────────────────────────────────────────────────────────

describe('étagère : badge J+N et délai d’abandon', () => {
  it('neutre puis coloré à partir de J+3, J+10 et J+30', () => {
    expect([0, 2, 3, 9, 10, 29, 30, 120].map((j) => badgeAttente(j).niveau)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(badgeAttente(12)).toMatchObject({ label: 'J+12', jours: 12 });
    expect(badgeAttente(30).classe).toMatch(/bg-red-100 text-red-800/);
    expect(badgeAttente(-2).label).toBe('J+0');
    expect(badgeAttente(null)).toBeNull();
    expect(badgeAttente(undefined)).toBeNull();
    expect(badgeAttente('abc')).toBeNull();
  });

  it('délai d’abandon des conditions du ticket (3 mois)', () => {
    expect(formatDelai(90)).toBe('3 mois');
    expect(formatDelai(45)).toBe('45 jours');
    // Repli : délai légal d'un an (loi du 31 décembre 1903), voir etagere_chantier.test.jsx
    expect(formatDelai(undefined)).toBe('1 an');
    expect(situationAbandon(90, 90)).toEqual({ atteint: true, restant: 0 });
    expect(situationAbandon(60, 90)).toEqual({ atteint: false, restant: 30 });
    expect(situationAbandon(null, 90)).toBeNull();
  });

  it('sépare les appareils en boutique des rendus non payés, ordre du serveur gardé', () => {
    const g = groupesEtagere([
      { id: 1, statut: 'Réparation terminée' }, { id: 2, statut: 'Rendu au client' }, { id: 3, statut: 'Réparation terminée' },
    ]);
    expect(g.enBoutique.map((t) => t.id)).toEqual([1, 3]);
    expect(g.impayes.map((t) => t.id)).toEqual([2]);
    expect(groupesEtagere(null)).toEqual({ enBoutique: [], impayes: [] });
  });
});

describe('message proposé : modèle par statut et paramètre NOTIFICATIONS_STATUTS', () => {
  const DEFAUTS = [
    { id: 4, label: 'En cours de reparation', message: 'a' },
    { id: 5, label: 'Attente piece', message: 'b' },
    { id: 6, label: 'Appareil pret', message: 'c' },
  ];

  it('modèle par défaut (id), sinon par libellé ; jamais un modèle vide', () => {
    expect(modelePourStatut(DEFAUTS, 'Réparation terminée')).toBe(6);
    expect(modelePourStatut(DEFAUTS, 'En attente de pièce')).toBe(5);
    expect(modelePourStatut(DEFAUTS, 'En cours de réparation')).toBe(4);
    expect(modelePourStatut([{ id: 40, label: 'Appareil prêt à récupérer', message: 'x' }], 'Réparation terminée')).toBe(40);
    expect(modelePourStatut([{ id: 6, label: 'Appareil pret', message: '  ' }], 'Réparation terminée')).toBeNull();
    expect(modelePourStatut(DEFAUTS, 'Clôturé')).toBeNull();
    expect(modelePourStatut(null, 'Réparation terminée')).toBeNull();
  });

  it('lecture du paramètre : absent = « Réparation terminée », vide = aucun', () => {
    expect(statutsNotifies(undefined)).toEqual(['Réparation terminée']);
    expect(statutsNotifies('')).toEqual([]);
    expect(statutsNotifies('Réparation terminée, En attente de pièce ,')).toEqual(['Réparation terminée', 'En attente de pièce']);
  });

  it('cocher / décocher : ordre du parcours, statuts inconnus conservés', () => {
    expect(STATUTS_MESSAGE.at(-1)).toBe('Réparation terminée');
    const seed = 'Réparation terminée,En attente de pièce,En cours de réparation';
    expect(basculerStatutNotifie(seed, 'En cours de réparation', false)).toBe('En attente de pièce,Réparation terminée');
    expect(basculerStatutNotifie('Réparation terminée', 'Pièce reçue', true)).toBe('Pièce reçue,Réparation terminée');
    expect(basculerStatutNotifie('Rendu au client,Réparation terminée', 'Réparation terminée', false)).toBe('Rendu au client');
    expect(basculerStatutNotifie(undefined, 'Réparation terminée', false)).toBe('');
  });
});

// ─── MessageComposer pré-rempli ──────────────────────────────────────────────

describe('MessageComposer : proposition après « Réparation terminée »', () => {
  beforeEach(resetApi);

  const renderComposer = (props) => render(
    <ToastProvider><MessageComposer ticket={ticket()} statutPropose="Réparation terminée" integre {...props} /></ToastProvider>,
  );

  it('« Appareil prêt » pré-sélectionné avec le reste dû du serveur ; rien ne part sans clic', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const envoye = vi.fn();
    renderComposer({ onMessageSent: envoye });
    expect(screen.getByText(/votre Apple iPhone 13 est pret !.*Montant : 79\.00 EUR/)).toBeInTheDocument();
    await waitFor(() => expect(apiMock.getMessageTemplates).toHaveBeenCalled());
    expect(open).not.toHaveBeenCalled();
    expect(apiMock.logMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));
    await waitFor(() => expect(envoye).toHaveBeenCalled());
    expect(open.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\/33612345678\?text=/);
    expect(decodeURIComponent(open.mock.calls[0][0])).toContain('Montant : 79.00 EUR');
    expect(apiMock.logMessage).toHaveBeenCalledWith(42, 'Sophie', expect.stringMatching(/^\[Appareil pret\]/), 'whatsapp');
  });

  it('modèle « prêt » enregistré par la boutique repris à son arrivée', async () => {
    apiMock.getMessageTemplates.mockResolvedValue([
      { id: 4, label: 'En cours de reparation', message: 'En cours' },
      { id: 6, label: 'Appareil pret', message: 'Coucou {prenom}, c’est prêt ({montant} €)' },
    ]);
    renderComposer();
    expect(await screen.findByText(/Coucou Léa, c’est prêt \(79\.00 €\)/)).toBeInTheDocument();
  });

  it('montant à 0 € (acompte qui couvre tout) : phrase du montant retirée, mention affichée, envoi possible', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <ToastProvider>
        <MessageComposer ticket={ticket({ montants: { ...MONTANTS, acompte: 89, reste: 0 } })} statutPropose="Réparation terminée" integre />
      </ToastProvider>,
    );
    expect(screen.getByText('Montant à 0 € : phrase du montant retirée')).toBeInTheDocument();
    expect(screen.queryByText(/Montant : 0\.00/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'SMS' }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    const sms = decodeURIComponent(open.mock.calls[0][0]);
    expect(sms).toContain('Vous pouvez venir le recuperer a la boutique. Klikphone 79 Place');
    expect(sms).not.toMatch(/Montant/);
    await waitFor(() => expect(apiMock.logMessage).toHaveBeenCalledWith(42, 'Sophie', expect.stringMatching(/^\[Appareil pret\]/), 'sms'));
  });

  it('tarif à 0 € sans acompte : plus de blocage « renseigne un tarif », le message part sans la phrase du montant', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <ToastProvider>
        <MessageComposer ticket={ticket({ montants: { ...MONTANTS, total: 0, acompte: 0, reste: 0 } })} statutPropose="Réparation terminée" integre />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(decodeURIComponent(open.mock.calls[0][0])).not.toMatch(/Montant|0\.00/);
    expect(screen.queryByText(/Renseigne un tarif/)).not.toBeInTheDocument();
  });
});

// ─── Dashboard : carte et étagère ────────────────────────────────────────────

function ligne(id, statut, extra = {}) {
  return {
    id, statut, ticket_code: `KP-${String(id).padStart(6, '0')}`,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '0612345678',
    marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé', date_depot: '2026-06-10 09:00:00', ...extra,
  };
}

const ETAGERE = {
  kpi: { a_recuperer: 3 },
  total: 3,
  delai_abandon_jours: 90,
  tickets: [
    ligne(11, 'Réparation terminée', { jours_attente: 95, fin_reparation: '2026-07-13T10:00:00', reste_du: 89 }),
    ligne(12, 'Réparation terminée', { jours_attente: 4, fin_reparation: '2026-10-12T10:00:00', reste_du: 0 }),
    ligne(13, 'Rendu au client', { jours_attente: 12, fin_reparation: '2026-10-04T10:00:00', reste_du: 40 }),
  ],
};

describe('DashboardPage : carte « À récupérer »', () => {
  beforeEach(() => {
    resetApi();
    apiMock.getDashboard.mockImplementation(async (p) => (p?.vue === 'a_recuperer'
      ? ETAGERE
      : { tickets: [ligne(1, 'En cours de réparation')], total: 1, kpi: { a_recuperer: 3 } }));
  });

  it('ouvre l’étagère filtrée et triée par le serveur, badges J+N et délai d’abandon', async () => {
    const scans = [];
    const onScan = (e) => scans.push(e.detail);
    window.addEventListener(SCAN_EVENT, onScan);
    render(<MemoryRouter initialEntries={['/accueil']}><ToastProvider><DashboardPage /></ToastProvider></MemoryRouter>);

    const carte = await screen.findByRole('button', { name: /À récupérer/ });
    await waitFor(() => expect(within(carte).getByText('3')).toBeInTheDocument());
    expect(carte).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(carte);

    const etagere = await screen.findByRole('region', { name: 'À récupérer' });
    expect(carte).toHaveAttribute('aria-expanded', 'true');
    expect(carte).toHaveAttribute('aria-controls', etagere.id);
    expect(apiMock.getDashboard).toHaveBeenCalledWith({ vue: 'a_recuperer', limit: 500 });
    expect(await within(etagere).findByText(/2 appareils réparés en boutique · 1 rendu non payé/)).toBeInTheDocument();
    expect(within(etagere).getByText(/Délai d’abandon : 3 mois après la fin de réparation/)).toBeInTheDocument();

    const enBoutique = within(etagere).getByRole('region', { name: /En boutique/ });
    const codes = within(enBoutique).getAllByRole('listitem').map((li) => within(li).getByRole('link').textContent);
    expect(codes).toEqual(['KP-000011', 'KP-000012']);
    expect(within(enBoutique).getByText('J+95').parentElement.className).toMatch(/bg-red-100/);
    expect(within(enBoutique).getByText('J+4').parentElement.className).toMatch(/bg-amber-100/);
    expect(within(enBoutique).getByText('Réparation terminée depuis 95 jours')).toBeInTheDocument();
    expect(within(enBoutique).getAllByText('Délai d’abandon atteint')).toHaveLength(1);

    const impayes = within(etagere).getByRole('region', { name: /Rendus non payés/ });
    expect(within(impayes).getByText('Reste 40.00 €')).toBeInTheDocument();
    expect(within(impayes).getByText('J+12').parentElement.className).toMatch(/bg-orange-100/);

    // Remettre / encaisser : panneau d'action rapide (remise contrôlée par le serveur)
    fireEvent.click(within(enBoutique).getByRole('button', { name: 'Remettre KP-000011' }));
    fireEvent.click(within(impayes).getByRole('button', { name: 'Encaisser KP-000013' }));
    expect(scans).toEqual([
      expect.objectContaining({ ticketId: 11, code: 'KP-000011' }),
      expect.objectContaining({ ticketId: 13, code: 'KP-000013' }),
    ]);
    window.removeEventListener(SCAN_EVENT, onScan);

    fireEvent.click(within(etagere).getByRole('button', { name: 'Fermer l’étagère À récupérer' }));
    expect(screen.queryByRole('region', { name: 'À récupérer' })).not.toBeInTheDocument();
    expect(carte).toHaveAttribute('aria-expanded', 'false');
  });

  it('étagère vide : message explicite', async () => {
    apiMock.getDashboard.mockImplementation(async (p) => (p?.vue === 'a_recuperer'
      ? { kpi: { a_recuperer: 0 }, total: 0, delai_abandon_jours: 90, tickets: [] }
      : { tickets: [], total: 0, kpi: { a_recuperer: 0 } }));
    render(<MemoryRouter initialEntries={['/accueil']}><ToastProvider><DashboardPage /></ToastProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /À récupérer/ }));
    expect(await screen.findByText(/Rien à récupérer/)).toBeInTheDocument();
  });
});

// ─── Scan comptoir : proposition dans le panneau ─────────────────────────────

function renderPanel() {
  return render(<MemoryRouter initialEntries={['/tech']}><ToastProvider><QuickScanPanel /></ToastProvider></MemoryRouter>);
}

function scanner(code = 'KP-000042') {
  act(() => {
    window.dispatchEvent(new CustomEvent(SCAN_EVENT, { detail: { kind: 'ticket', code, query: code, label: code } }));
  });
}

describe('QuickScanPanel : message « prêt » proposé après la fin de réparation', () => {
  beforeEach(() => {
    resetApi();
    auth.user = { target: 'tech', utilisateur: 'Karim' };
    apiMock.resolveCode.mockResolvedValue({ type: 'ticket', id: 42, ticket_code: 'KP-000042' });
    apiMock.getTicket.mockResolvedValue(ticket({ statut: 'En cours de réparation' }));
  });
  afterEach(() => { auth.user = { target: 'accueil', utilisateur: 'Sophie' }; });

  // « Terminé + prévenir le client » (SMS serveur non configuré ici) : détail dans prevenir_client.test.jsx
  it('panneau ouvert : la carte « Prévenir » s’affiche avec le SMS prêt, « Plus tard » la replie', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    apiMock.changeStatus.mockResolvedValue({ ok: true, proposer_message: true });
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Terminé \+ prévenir le client/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider maintenant' }));
    await waitFor(() => expect(apiMock.changeStatus).toHaveBeenCalledWith(42, 'Réparation terminée'));

    const carte = await within(dialog).findByRole('region', { name: 'Prévenir Léa' });
    expect(await within(carte).findByText(/est pret!/)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(within(carte).getByRole('button', { name: 'SMS' })));
    expect(apiMock.logMessage).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(within(carte).getByRole('button', { name: 'Plus tard' }));
    expect(within(carte).getByRole('button', { name: 'Prévenir…' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(carte).queryByRole('button', { name: 'SMS' })).not.toBeInTheDocument();
  });

  it('« Terminé sans prévenir » : aucune proposition, même si le serveur en propose une', async () => {
    apiMock.changeStatus.mockResolvedValue({ ok: true, proposer_message: true });
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Terminé sans prévenir/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider maintenant' }));
    expect(await screen.findByText('KP-000042 : Réparation terminée')).toBeInTheDocument();
    expect(within(dialog).queryByRole('region', { name: /Prévenir/ })).not.toBeInTheDocument();
    expect(apiMock.logMessage).not.toHaveBeenCalled();
  });

  it('autre statut hors NOTIFICATIONS_STATUTS (démarrer) : aucune proposition', async () => {
    apiMock.getTicket.mockResolvedValue(ticket({ statut: 'Pièce reçue', technicien_assigne: 'Karim' }));
    apiMock.changeStatus.mockResolvedValue({ ok: true, proposer_message: false });
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Démarrer la réparation/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider maintenant' }));
    expect(await screen.findByText('KP-000042 : En cours de réparation')).toBeInTheDocument();
    expect(within(dialog).queryByRole('region', { name: /Prévenir/ })).not.toBeInTheDocument();
    expect(apiMock.logMessage).not.toHaveBeenCalled();
  });

  it('autre statut dans NOTIFICATIONS_STATUTS (démarrer) : message pré-rempli proposé, rien ne part seul', async () => {
    apiMock.getTicket.mockResolvedValue(ticket({ statut: 'Pièce reçue', technicien_assigne: 'Karim' }));
    apiMock.changeStatus.mockResolvedValue({ ok: true, proposer_message: true });
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Démarrer la réparation/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider maintenant' }));
    const proposition = await within(dialog).findByRole('region', { name: 'Prévenir Léa ?' });
    // Aperçu complet et version SMS courte
    expect(await within(proposition).findAllByText(/la reparation de votre Apple iPhone 13 est en cours/)).toHaveLength(2);
    expect(apiMock.logMessage).not.toHaveBeenCalled();
  });

  it('panneau fermé avant l’envoi : la notification le rouvre sur la carte', async () => {
    apiMock.changeStatus.mockResolvedValue({ ok: true, proposer_message: true });
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Terminé \+ prévenir le client/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fermer le panneau' }));
    const notif = await screen.findByText('KP-000042 : Terminé — prévenir le client ?');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(notif);
    const rouvert = await screen.findByRole('dialog');
    expect(await within(rouvert).findByRole('region', { name: 'Prévenir Léa' })).toBeInTheDocument();
  });
});
