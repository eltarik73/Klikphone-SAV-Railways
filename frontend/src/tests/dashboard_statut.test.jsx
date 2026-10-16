/**
 * Vague C2 : le dashboard ne contourne plus la restitution. « Rendu au client » / « Clôturé »
 * d'un ticket pas encore rendu ouvrent le panneau d'action rapide ; le changement groupé ne
 * traite que les tickets déjà rendus et réglés, avec un compte rendu.
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
    changeStatus: vi.fn(),
    updateTicket: vi.fn(),
    resolveCode: vi.fn(),
    getTicket: vi.fn(),
    getNotes: vi.fn(),
    getCached: vi.fn(),
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
import { openQuickScan, takePendingScan } from '../components/ScanListener';
import QuickScanPanel, { actionsTicket } from '../components/QuickScanPanel';
import DashboardPage, {
  STATUTS_REMISE, actionStatutLigne, planStatutGroupe, executerStatutGroupe, resumeStatutGroupe,
} from '../pages/DashboardPage';

const conflit = (message, reste = 20) => Object.assign(new Error(message), {
  status: 409, code: 'utiliser_restitution', detail: { code: 'utiliser_restitution', message, reste },
});

function ligne(id, statut, extra = {}) {
  return {
    id, statut, ticket_code: `KP-${String(id).padStart(6, '0')}`,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '0612345678',
    marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé', date_depot: '2026-10-10 09:00:00',
    ...extra,
  };
}

const LIGNES = [
  ligne(1, 'Réparation terminée'),
  ligne(2, 'Rendu au client'),
  ligne(3, 'Rendu au client'),
  ligne(4, 'En cours de réparation'),
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Règles pures ────────────────────────────────────────────────────────────

describe('dashboard : règles du changement de statut', () => {
  it('une ligne pas encore rendue passe par le panneau pour « Rendu au client » / « Clôturé »', () => {
    expect(STATUTS_REMISE).toEqual(['Rendu au client', 'Clôturé']);
    expect(actionStatutLigne({ statut: 'Réparation terminée' }, 'Rendu au client')).toBe('panneau');
    expect(actionStatutLigne({ statut: 'En cours de réparation' }, 'Clôturé')).toBe('panneau');
    expect(actionStatutLigne({ statut: 'Rendu au client' }, 'Clôturé')).toBe('serveur');
    expect(actionStatutLigne({ statut: 'Clôturé' }, 'Rendu au client')).toBe('serveur');
    expect(actionStatutLigne({ statut: 'Clôturé' }, 'En cours de réparation')).toBe('serveur');
    expect(actionStatutLigne({ statut: 'Pièce reçue' }, 'Pièce reçue')).toBe('aucun');
    expect(actionStatutLigne({ statut: 'Pièce reçue' }, '')).toBe('aucun');
  });

  it('plan groupé : seuls les tickets déjà rendus partent au serveur ; statut inconnu → un par un', () => {
    const plan = planStatutGroupe([...LIGNES, ligne(5, 'Clôturé'), { id: 99 }], 'Clôturé');
    expect(plan.envoyer.map((t) => t.id)).toEqual([2, 3]);
    expect(plan.aTraiter.map((t) => t.id)).toEqual([1, 4, 99]);
    expect(plan.inchanges.map((t) => t.id)).toEqual([5]);
    expect(plan.aTraiter.find((t) => t.id === 99).ticket_code).toBe('#99');

    const autre = planStatutGroupe([...LIGNES, { id: 99 }], 'Pièce reçue');
    expect(autre.envoyer.map((t) => t.id)).toEqual([1, 2, 3, 4, 99]);
    expect(autre.aTraiter).toEqual([]);
  });

  it('exécution : 409 utiliser_restitution → à traiter un par un, autre erreur → échec, au plus 4 à la fois', async () => {
    let enVol = 0;
    let max = 0;
    const changeStatus = vi.fn(async (id) => {
      enVol += 1;
      max = Math.max(max, enVol);
      await new Promise((r) => setTimeout(r, 5));
      enVol -= 1;
      if (id === 3) throw conflit('Ticket non payé (reste 20,00 €) : passez par la restitution.');
      if (id === 6) throw Object.assign(new Error('Ticket non trouvé'), { status: 404 });
    });
    const tickets = [2, 3, 5, 6, 7, 8, 9].map((id) => ligne(id, 'Rendu au client'));
    const res = await executerStatutGroupe(planStatutGroupe([ligne(1, 'Réparation terminée'), ...tickets], 'Clôturé'), 'Clôturé', changeStatus);
    expect(changeStatus).toHaveBeenCalledTimes(7);
    expect(max).toBeLessThanOrEqual(4);
    expect(res.faits.map((t) => t.id).sort()).toEqual([2, 5, 7, 8, 9]);
    expect(res.aTraiter.map((t) => t.id)).toEqual([1, 3]);
    expect(res.aTraiter[1].raison).toMatch(/non payé/);
    expect(res.erreurs).toEqual([expect.objectContaining({ id: 6, message: 'Ticket non trouvé' })]);
    expect(resumeStatutGroupe(res)).toBe('5 clôturés · 2 à traiter un par un · 1 en échec');
  });

  it('compte rendu lisible', () => {
    const r = (statut, faits, aTraiter = 0, erreurs = 0, inchanges = 0) => resumeStatutGroupe({
      statut, faits: Array(faits).fill({}), aTraiter: Array(aTraiter).fill({}), erreurs: Array(erreurs).fill({}), inchanges,
    });
    expect(r('Rendu au client', 1, 2)).toBe('1 rendu · 2 à traiter un par un');
    expect(r('Rendu au client', 0, 3)).toBe('Aucun ticket rendu · 3 à traiter un par un');
    expect(r('Clôturé', 0, 0, 0, 2)).toBe('Aucun ticket clôturé · 2 déjà « Clôturé »');
    expect(r('Pièce reçue', 3)).toBe('3 tickets en « Pièce reçue »');
    expect(r('Pièce reçue', 0, 0, 1)).toBe('Aucun ticket modifié · 1 en échec');
  });
});

// ─── Page ────────────────────────────────────────────────────────────────────

// Recherche (vue « tous ») : tickets en cours et déjà rendus dans la même liste
function renderDashboard({ withPanel = false, url = '/accueil?q=Martin' } = {}) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <DashboardPage />
        {withPanel && <QuickScanPanel />}
      </ToastProvider>
    </MemoryRouter>,
  );
}

function ecouterScans() {
  const recus = [];
  const onScan = (e) => recus.push(e.detail);
  window.addEventListener(SCAN_EVENT, onScan);
  return { recus, stop: () => window.removeEventListener(SCAN_EVENT, onScan) };
}

const selectStatut = (code) => screen.getByRole('combobox', { name: `Statut du ticket ${code}` });
const menuGroupe = () => within(screen.getByRole('group', { name: 'Nouveau statut des tickets sélectionnés' }));

describe('DashboardPage : statut en ligne', () => {
  beforeEach(() => {
    clearCache();
    takePendingScan();
    sessionStorage.clear();
    auth.user = { target: 'accueil', utilisateur: 'Sophie' };
    Object.values(apiMock).forEach((fn) => fn.mockReset?.());
    apiMock.getDashboard.mockResolvedValue({ tickets: LIGNES, total: LIGNES.length, kpi: {} });
    apiMock.getActiveTeam.mockResolvedValue([]);
    apiMock.getInteractions.mockResolvedValue({});
    apiMock.getClients.mockResolvedValue([]);
    apiMock.changeStatus.mockResolvedValue({ ok: true });
    apiMock.getNotes.mockResolvedValue([]);
    apiMock.getCached.mockResolvedValue([]);
  });

  it('« Rendu au client » d’un ticket terminé : panneau ouvert, aucun PATCH /statut', async () => {
    const scans = ecouterScans();
    renderDashboard();
    fireEvent.change(await screen.findByRole('combobox', { name: 'Statut du ticket KP-000001' }), { target: { value: 'Rendu au client' } });
    expect(apiMock.changeStatus).not.toHaveBeenCalled();
    expect(scans.recus).toEqual([expect.objectContaining({ ticketId: 1, code: 'KP-000001', source: 'manuel' })]);
    expect(selectStatut('KP-000001')).toHaveValue('Réparation terminée');

    fireEvent.change(selectStatut('KP-000004'), { target: { value: 'Clôturé' } });
    expect(apiMock.changeStatus).not.toHaveBeenCalled();
    expect(scans.recus[1]).toMatchObject({ ticketId: 4 });
    scans.stop();
  });

  it('le panneau s’ouvre sur le ticket sans résoudre le code ni le marquer vérifié', async () => {
    apiMock.getTicket.mockResolvedValue({
      ...ligne(1, 'Réparation terminée'), paye: 0,
      montants: { total: 89, acompte: 0, reste: 89, paye: false, lignes: [{ label: 'Écran', prix: 89 }] },
    });
    renderDashboard({ withPanel: true });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Statut du ticket KP-000001' }), { target: { value: 'Clôturé' } });
    const dialog = await screen.findByRole('dialog');
    expect(apiMock.resolveCode).not.toHaveBeenCalled();
    expect(apiMock.getTicket).toHaveBeenCalledWith(1);
    expect(within(dialog).getByRole('heading', { name: 'KP-000001' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Rendre au client/ })).toBeInTheDocument();
    expect(within(dialog).queryByText('2e scan identique')).not.toBeInTheDocument();
    expect(apiMock.changeStatus).not.toHaveBeenCalled();
  });

  it('ticket déjà rendu → « Clôturé » : PATCH ; 409 utiliser_restitution → message + panneau', async () => {
    const scans = ecouterScans();
    renderDashboard();
    fireEvent.change(await screen.findByRole('combobox', { name: 'Statut du ticket KP-000002' }), { target: { value: 'Clôturé' } });
    await waitFor(() => expect(apiMock.changeStatus).toHaveBeenCalledWith(2, 'Clôturé'));
    expect(scans.recus).toEqual([]);

    apiMock.changeStatus.mockRejectedValueOnce(conflit('Ticket non payé (reste 20,00 €) : passez par la restitution.'));
    fireEvent.change(selectStatut('KP-000003'), { target: { value: 'Clôturé' } });
    expect(await screen.findByText('KP-000003 : Ticket non payé (reste 20,00 €) : passez par la restitution.')).toBeInTheDocument();
    expect(scans.recus).toEqual([expect.objectContaining({ ticketId: 3 })]);
    scans.stop();
  });

  it('déjà rendu et réglé, prêt dehors : 409 → panneau qui propose « Prêt récupéré »', async () => {
    const pret = 'Téléphone de prêt non restitué (Galaxy S9) : passez par la restitution.';
    apiMock.changeStatus.mockRejectedValueOnce(conflit(pret, null));
    apiMock.getTicket.mockResolvedValue({
      ...ligne(2, 'Rendu au client'), paye: 1, telephone_pret: 'Galaxy S9', telephone_pret_rendu: false,
      montants: { total: 89, acompte: 0, reste: 0, paye: true, lignes: [{ label: 'Écran', prix: 89 }] },
    });
    apiMock.updateTicket.mockResolvedValue({ ok: true, ticket: null });
    apiMock.addHistory.mockResolvedValue({ ok: true });
    renderDashboard({ withPanel: true });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Statut du ticket KP-000002' }), { target: { value: 'Clôturé' } });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Téléphone de prêt à récupérer : Galaxy S9/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Prêt récupéré/ }));
    expect(within(dialog).getByText('Le téléphone de prêt (Galaxy S9) est-il bien récupéré et vérifié ?')).toBeInTheDocument();
    expect(apiMock.updateTicket).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Oui, prêt récupéré' }));
    await waitFor(() => expect(apiMock.updateTicket).toHaveBeenCalledWith(2, { telephone_pret_rendu: 1 }));
    await waitFor(() => expect(apiMock.addHistory).toHaveBeenCalledWith(2, 'Téléphone de prêt restitué — par Sophie'));
    expect(await screen.findByText('KP-000002 : téléphone de prêt récupéré')).toBeInTheDocument();
    expect(apiMock.changeStatus).toHaveBeenCalledTimes(1);
  });

  it('autre refus : message lisible du serveur, pas de panneau', async () => {
    const scans = ecouterScans();
    apiMock.changeStatus.mockRejectedValueOnce(Object.assign(new Error('Statut invalide'), { status: 400 }));
    renderDashboard();
    fireEvent.change(await screen.findByRole('combobox', { name: 'Statut du ticket KP-000004' }), { target: { value: 'Pièce reçue' } });
    expect(await screen.findByText('KP-000004 : Statut invalide')).toBeInTheDocument();
    expect(scans.recus).toEqual([]);
    scans.stop();
  });
});

describe('DashboardPage : changement groupé', () => {
  beforeEach(() => {
    clearCache();
    takePendingScan();
    sessionStorage.clear();
    Object.values(apiMock).forEach((fn) => fn.mockReset?.());
    apiMock.getDashboard.mockResolvedValue({ tickets: LIGNES, total: LIGNES.length, kpi: {} });
    apiMock.getActiveTeam.mockResolvedValue([]);
    apiMock.getInteractions.mockResolvedValue({});
    apiMock.getClients.mockResolvedValue([]);
    apiMock.changeStatus.mockResolvedValue({ ok: true });
  });

  async function selectionnerTout() {
    await screen.findByRole('combobox', { name: 'Statut du ticket KP-000001' });
    for (const code of ['KP-000001', 'KP-000002', 'KP-000003', 'KP-000004']) {
      fireEvent.click(screen.getByRole('button', { name: `Sélectionner ${code}` }));
    }
    fireEvent.click(screen.getByRole('button', { name: /Changer statut/ }));
  }

  it('« Clôturé » : déjà rendus et réglés seulement, compte rendu et tickets à rendre un par un', async () => {
    apiMock.changeStatus.mockImplementation(async (id) => {
      if (id === 3) throw conflit('Ticket non payé (reste 20,00 €) : passez par la restitution.');
      return { ok: true };
    });
    const scans = ecouterScans();
    renderDashboard();
    await selectionnerTout();
    expect(menuGroupe().getAllByText('Tickets déjà rendus et réglés ; remise un par un')).toHaveLength(2);
    fireEvent.click(menuGroupe().getByRole('button', { name: /^Clôturé/ }));

    const rapport = await screen.findByText('1 clôturé · 3 à traiter un par un');
    expect(apiMock.changeStatus.mock.calls.map((c) => c[0]).sort()).toEqual([2, 3]);
    const bandeau = rapport.closest('[role="status"]');
    const boutons = within(bandeau).getAllByRole('button', { name: /^KP-/ });
    expect(boutons.map((b) => b.textContent)).toEqual(['KP-000001', 'KP-000004', 'KP-000003']);

    fireEvent.click(boutons[0]);
    expect(scans.recus).toEqual([expect.objectContaining({ ticketId: 1, source: 'manuel' })]);
    fireEvent.click(within(bandeau).getByRole('button', { name: 'Fermer le compte rendu' }));
    expect(screen.queryByText('1 clôturé · 3 à traiter un par un')).not.toBeInTheDocument();
    scans.stop();
  });

  it('menu : relié au bouton (aria-controls), focus sur le premier statut, Échap le rend au bouton', async () => {
    renderDashboard();
    await selectionnerTout();
    const bouton = screen.getByRole('button', { name: /Changer statut/ });
    const menu = screen.getByRole('group', { name: 'Nouveau statut des tickets sélectionnés' });
    expect(bouton).toHaveAttribute('aria-expanded', 'true');
    expect(bouton.getAttribute('aria-controls')).toBe(menu.id);
    await waitFor(() => expect(document.activeElement).toBe(within(menu).getAllByRole('button')[0]));
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Nouveau statut des tickets sélectionnés' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(bouton);
    expect(bouton).not.toHaveAttribute('aria-controls');
  });

  it('« Rendu au client » sur des tickets pas encore rendus : rien n’est envoyé', async () => {
    apiMock.getDashboard.mockResolvedValue({ tickets: [LIGNES[0], LIGNES[3]], total: 2, kpi: {} });
    renderDashboard();
    await screen.findByRole('combobox', { name: 'Statut du ticket KP-000001' });
    fireEvent.click(screen.getByRole('button', { name: 'Sélectionner KP-000001' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sélectionner KP-000004' }));
    fireEvent.click(screen.getByRole('button', { name: /Changer statut/ }));
    fireEvent.click(menuGroupe().getByRole('button', { name: /^Rendu au client/ }));
    expect(await screen.findByText('Aucun ticket rendu · 2 à traiter un par un')).toBeInTheDocument();
    expect(apiMock.changeStatus).not.toHaveBeenCalled();
  });

  it('autre statut : envoyé pour tous, succès annoncé, échec listé avec le message du serveur', async () => {
    apiMock.changeStatus.mockImplementation(async (id) => {
      if (id === 4) throw Object.assign(new Error('Ticket non trouvé'), { status: 404 });
      return { ok: true };
    });
    renderDashboard();
    await selectionnerTout();
    fireEvent.click(menuGroupe().getByRole('button', { name: /^Pièce reçue/ }));
    expect(await screen.findByText('3 tickets en « Pièce reçue » · 1 en échec')).toBeInTheDocument();
    expect(apiMock.changeStatus).toHaveBeenCalledTimes(4);
    expect(screen.getByText(': Ticket non trouvé', { exact: false })).toBeInTheDocument();
  });

  it('tout réussi : simple confirmation, sélection vidée', async () => {
    renderDashboard();
    await selectionnerTout();
    await act(async () => {
      fireEvent.click(menuGroupe().getByRole('button', { name: /^En attente de pièce/ }));
    });
    expect(await screen.findByText('4 tickets en « En attente de pièce »')).toBeInTheDocument();
    expect(screen.queryByText(/sélectionné\(s\)/)).not.toBeInTheDocument();
  });
});

describe('panneau : téléphone de prêt sur un ticket déjà rendu', () => {
  it('« Prêt récupéré » proposé seulement si le ticket est rendu et le prêt encore dehors', () => {
    const ids = (t) => actionsTicket(t, 'accueil').map((a) => `${a.id}${a.primary ? '*' : ''}`);
    const paye = { paye: 1, montants: { total: 89, acompte: 0, reste: 0, paye: true, lignes: [] } };
    expect(ids({ ...ligne(1, 'Clôturé'), ...paye, telephone_pret: 'Galaxy S9' })).toEqual(['pret*']);
    expect(ids({ ...ligne(1, 'Rendu au client'), ...paye, telephone_pret: 'Galaxy S9', telephone_pret_rendu: 1 })).toEqual([]);
    expect(ids({ ...ligne(1, 'Rendu au client'), paye: 0, telephone_pret: 'Galaxy S9',
      montants: { total: 89, acompte: 0, reste: 89, paye: false, lignes: [] } })).toEqual(['encaisser*', 'pret']);
    // Pas encore rendu : la remise (étape « prêt récupéré ») s'en charge
    expect(ids({ ...ligne(1, 'Réparation terminée'), ...paye, telephone_pret: 'Galaxy S9' })).toEqual(['rendre*']);
  });
});

describe('openQuickScan', () => {
  it('sans panneau chargé : l’ouverture attend (même file que la douchette)', () => {
    takePendingScan();
    openQuickScan({ id: 7, code: 'KP-000007' });
    expect(takePendingScan()).toMatchObject({ ticketId: 7, query: 'KP-000007', kind: 'ticket' });
    openQuickScan({ id: null });
    expect(takePendingScan()).toBeNull();
  });

  it('panneau déjà ouvert sur ce ticket : simple rechargement, jamais « 2e scan identique »', async () => {
    takePendingScan();
    Object.values(apiMock).forEach((fn) => fn.mockReset?.());
    apiMock.getTicket.mockResolvedValue({ ...ligne(8, 'Réparation terminée'), paye: 1 });
    apiMock.getNotes.mockResolvedValue([]);
    apiMock.getCached.mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={['/accueil']}>
        <ToastProvider><QuickScanPanel /></ToastProvider>
      </MemoryRouter>,
    );
    act(() => openQuickScan({ id: 8, code: 'KP-000008' }));
    const dialog = await screen.findByRole('dialog');
    act(() => openQuickScan({ id: 8, code: 'KP-000008' }));
    await waitFor(() => expect(apiMock.getTicket).toHaveBeenCalledTimes(2));
    expect(within(dialog).queryByText('2e scan identique')).not.toBeInTheDocument();
    expect(apiMock.resolveCode).not.toHaveBeenCalled();
  });
});
