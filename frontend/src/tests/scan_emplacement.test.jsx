/**
 * Emplacement au scan comptoir : « Rangé où ? » proposé une fois « Réparation terminée »
 * enregistrée (sans voler le focus d'une action en cours), « Rangé en B3 » en très gros en tête
 * d'un ticket terminé (et pendant la remise), « Pas d'emplacement noté » + saisie, et douchette
 * toujours utilisable pendant la saisie de l'emplacement.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SCAN_EVENT } from '../lib/scan';

const { auth, apiMock } = vi.hoisted(() => ({
  auth: { user: { target: 'tech', utilisateur: 'Karim' } },
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
    addHistory: vi.fn(),
    restitution: vi.fn(),
    setPaye: vi.fn(),
    getEtagereConfig: vi.fn(),
    setEmplacement: vi.fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { ToastProvider } from '../components/Toast';
import { clearCache } from '../hooks/useApi';
import ScanListener, { takePendingScan } from '../components/ScanListener';
import QuickScanPanel, {
  TICKET_UPDATED_EVENT, emplacementAffiche, rangementVisible,
} from '../components/QuickScanPanel';

const MONTANTS = { total: 89, acompte: 10, reste: 79, paye: false, lignes: [{ label: 'Écran', prix: 89 }] };
const ETAT_ACTIF = { cle_configuree: true, active: true, disponible: true, expediteur: 'KLIKPHONE' };
const CONFIG = { emplacements: ['A1', 'b3', 'C2', 'A1'], delai_abandon_jours: 365, relance_paliers: [3, 10], mise_en_demeure_jours: 90 };

function ticket(overrides = {}) {
  return {
    id: 42, ticket_code: 'KP-000042', statut: 'En cours de réparation', client_id: 5,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '06 12 34 56 78', client_email: 'lea@example.test',
    marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé', date_depot: '2026-10-10T09:00:00',
    paye: 0, acompte: 10, devis_estime: 200, telephone_pret: '', telephone_pret_rendu: false,
    emplacement: null, montants: MONTANTS, ...overrides,
  };
}

let fiches;

function resetApi(overrides = {}, autres = {}) {
  clearCache();
  takePendingScan();
  sessionStorage.clear();
  Object.values(apiMock).forEach((fn) => fn.mockReset());
  fiches = { 42: ticket(overrides), ...autres };
  apiMock.resolveCode.mockImplementation(async (q) => {
    const id = Number(String(q).replace(/\D/g, ''));
    if (!fiches[id]) throw Object.assign(new Error('Aucun ticket'), { status: 404 });
    return { type: 'ticket', id, ticket_code: fiches[id].ticket_code };
  });
  apiMock.getTicket.mockImplementation(async (id) => ({ ...fiches[id] }));
  apiMock.getNotes.mockResolvedValue([]);
  apiMock.changeStatus.mockImplementation(async (id, statut) => {
    fiches[id] = { ...fiches[id], statut };
    return { ok: true, proposer_message: true };
  });
  apiMock.updateTicket.mockResolvedValue({ ok: true });
  apiMock.patchKeepalive.mockResolvedValue(true);
  apiMock.getCached.mockResolvedValue([]);
  apiMock.getMessageTemplates.mockResolvedValue([]);
  apiMock.getSmsEtat.mockResolvedValue({ ...ETAT_ACTIF, active: false, disponible: false });
  apiMock.logMessage.mockResolvedValue({ id: 1 });
  apiMock.envoyerEmail.mockResolvedValue({ status: 'ok', message: 'envoyé' });
  apiMock.getEtagereConfig.mockResolvedValue(CONFIG);
  apiMock.setEmplacement.mockImplementation(async (id, emplacement) => {
    fiches[id] = { ...fiches[id], emplacement };
    return { emplacement };
  });
}

function renderPanel({ listener = false, path = '/tech' } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        {listener && <ScanListener />}
        <QuickScanPanel />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function scanner(code = 'KP-000042') {
  act(() => {
    window.dispatchEvent(new CustomEvent(SCAN_EVENT, { detail: { kind: 'ticket', code, query: code, label: code } }));
  });
}

// Douchette en émulation clavier : touches enchaînées sur l'élément focalisé (le navigateur
// n'écrit dans le champ que les touches que ScanListener n'a pas bloquées)
function press(key) {
  const el = document.activeElement || document.body;
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(ev); });
  if (!ev.defaultPrevented && key.length === 1 && el.tagName === 'INPUT') {
    act(() => {
      el.setRangeText(key, el.selectionStart, el.selectionEnd, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  return ev;
}

function douchette(code) {
  for (const ch of code) press(ch);
  return press('Enter');
}

const champRange = (dialog) => within(dialog).queryByRole('textbox', { name: 'Rangé où ?' });

async function terminer(nom, { valider = true } = {}) {
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(await within(dialog).findByRole('button', { name: nom }));
  if (valider) {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider maintenant' }));
    await waitFor(() => expect(apiMock.changeStatus).toHaveBeenCalledWith(42, 'Réparation terminée'));
  }
  return dialog;
}

const matchMediaOrigine = window.matchMedia;

beforeEach(() => {
  auth.user = { target: 'tech', utilisateur: 'Karim' };
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.matchMedia = matchMediaOrigine;
});

describe('règles d’affichage', () => {
  it('emplacement saisi dans le panneau prioritaire sur la fiche relue ; rien une fois rendu', () => {
    expect(emplacementAffiche({ emplacement: ' b3 ' })).toBe('B3');
    expect(emplacementAffiche({ emplacement: null }, 'C2')).toBe('C2');
    // Retiré depuis le panneau : une relecture partie avant ne le fait pas réapparaître
    expect(emplacementAffiche({ emplacement: 'B3' }, null)).toBeNull();

    expect(rangementVisible({ statut: 'Réparation terminée' })).toBe(true);
    expect(rangementVisible({ statut: 'En attente de pièce' }, { emplacement: 'A1' })).toBe(true);
    expect(rangementVisible({ statut: 'En attente de pièce' })).toBe(false);
    expect(rangementVisible({ statut: 'En cours de réparation' }, { edition: true })).toBe(true);
    expect(rangementVisible({ statut: 'Rendu au client' }, { emplacement: 'B3' })).toBe(false);
    expect(rangementVisible({ statut: 'Réparation terminée' }, { emplacement: 'B3', rendu: true })).toBe(false);
  });
});

describe('« Rangé où ? » après « Terminé »', () => {
  it('« Terminé sans prévenir » : proposé une fois le statut enregistré, focus dans le champ, B3 en un geste', async () => {
    resetApi({}, { 43: ticket({ id: 43, ticket_code: 'KP-000043', statut: 'Réparation terminée', emplacement: 'C2' }) });
    const maj = vi.fn();
    window.addEventListener(TICKET_UPDATED_EVENT, maj);
    renderPanel();
    scanner();
    const dialog = await terminer(/Terminé sans prévenir/, { valider: false });
    // Pendant les 5 s annulables : rien n'est proposé, le focus reste sur « Annuler »
    expect(within(dialog).getByText(/dans 5 s/)).toBeInTheDocument();
    expect(champRange(dialog)).not.toBeInTheDocument();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Annuler' }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider maintenant' }));
    const champ = await within(dialog).findByRole('textbox', { name: 'Rangé où ?' });
    await waitFor(() => expect(document.activeElement).toBe(champ));
    expect(await screen.findByText('KP-000042 : Réparation terminée')).toBeInTheDocument();

    // Boutons des emplacements configurés (normalisés, sans doublon), cibles de 44 px
    const proposes = within(dialog).getByRole('group', { name: 'Emplacements proposés' });
    expect(within(proposes).getAllByRole('button').map((b) => b.textContent)).toEqual(['A1', 'B3', 'C2']);
    within(proposes).getAllByRole('button').forEach((b) => expect(b.className).toMatch(/min-h-\[44px\]/));
    expect(within(dialog).getByRole('button', { name: 'Ranger l’appareil plus tard' }).className).toMatch(/min-h-\[44px\]/);

    fireEvent.click(within(proposes).getByRole('button', { name: 'B3' }));
    await waitFor(() => expect(apiMock.setEmplacement).toHaveBeenCalledWith(42, 'B3'));
    const modifier = await within(dialog).findByRole('button', { name: 'Modifier l’emplacement' });
    expect(champRange(dialog)).not.toBeInTheDocument();
    expect(within(dialog).getByText('Rangé en').closest('p')).toHaveTextContent('Rangé en B3');
    expect(within(dialog).getByText('B3').className).toMatch(/text-5xl/);
    // Annonce discrète (polite), focus rendu sur « Modifier », panneau décrit avec l'emplacement
    const annonce = within(dialog).getAllByRole('status').find((s) => s.textContent === 'Rangé en B3');
    expect(annonce).toHaveAttribute('aria-live', 'polite');
    await waitFor(() => expect(document.activeElement).toBe(modifier));
    expect(dialog).toHaveAccessibleDescription(/Rangé en B3/);
    expect(maj).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ id: 42 }) }));
    expect(apiMock.setEmplacement).toHaveBeenCalledTimes(1);

    // Relecture de la fiche, scan suivant : emplacements lus une seule fois pour la session
    scanner('KP-000043');
    expect(await screen.findByRole('heading', { name: 'KP-000043' })).toBeInTheDocument();
    expect(screen.getByText('Rangé en').closest('p')).toHaveTextContent('Rangé en C2');
    expect(apiMock.getEtagereConfig).toHaveBeenCalledTimes(1);
    window.removeEventListener(TICKET_UPDATED_EVENT, maj);
  });

  it('annulé pendant les 5 s : rien d’enregistré, aucune proposition de rangement', async () => {
    resetApi();
    renderPanel();
    scanner();
    const dialog = await terminer(/Terminé sans prévenir/, { valider: false });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(await screen.findByText('KP-000042 : action annulée.')).toBeInTheDocument();
    expect(apiMock.changeStatus).not.toHaveBeenCalled();
    expect(champRange(dialog)).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Pas d’emplacement noté')).not.toBeInTheDocument();
  });

  it('page quittée pendant les 5 s : statut envoyé en keepalive, rien d’autre', async () => {
    resetApi();
    renderPanel();
    scanner();
    const dialog = await terminer(/Terminé sans prévenir/, { valider: false });
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(apiMock.patchKeepalive).toHaveBeenCalledWith('/api/tickets/42/statut', { statut: 'Réparation terminée' });
    expect(apiMock.changeStatus).not.toHaveBeenCalled();
    expect(champRange(dialog)).not.toBeInTheDocument();
  });

  it('« Terminé + prévenir », SMS à valider dans Messages : le focus reste sur « SMS », le rangement attend', async () => {
    resetApi();
    renderPanel();
    scanner();
    const dialog = await terminer(/Terminé \+ prévenir le client/);
    const carte = await within(dialog).findByRole('region', { name: 'Prévenir Léa' });
    const sms = await within(carte).findByRole('button', { name: 'SMS' });
    await waitFor(() => expect(document.activeElement).toBe(sms));
    const champ = within(dialog).getByRole('textbox', { name: 'Rangé où ?' });
    await act(async () => { await new Promise((r) => { setTimeout(r, 50); }); });
    expect(document.activeElement).toBe(sms);
    expect(champ).not.toBe(document.activeElement);
    expect(apiMock.envoyerSms).not.toHaveBeenCalled();
  });

  it('« Terminé + prévenir », SMS envoyé par le serveur : un seul envoi, puis focus sur « Rangé où ? »', async () => {
    resetApi();
    apiMock.getSmsEtat.mockResolvedValue(ETAT_ACTIF);
    apiMock.envoyerSms.mockResolvedValue({ ok: true, segments: 1, destinataire: '06 12 34 56 78' });
    renderPanel();
    scanner();
    const dialog = await terminer(/Terminé \+ prévenir le client/);
    expect(await screen.findByText('KP-000042 : Terminé · SMS envoyé au 06 12 34 56 78')).toBeInTheDocument();
    const champ = within(dialog).getByRole('textbox', { name: 'Rangé où ?' });
    await waitFor(() => expect(document.activeElement).toBe(champ));
    expect(apiMock.envoyerSms).toHaveBeenCalledTimes(1);
    expect(apiMock.changeStatus).toHaveBeenCalledTimes(1);
    const carte = within(dialog).getByRole('region', { name: 'Prévenir Léa' });
    expect(within(carte).getByText('SMS envoyé au 06 12 34 56 78')).toBeInTheDocument();

    // Saisie libre : Entrée enregistre, en majuscules
    fireEvent.change(champ, { target: { value: 'etagere 2' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    await waitFor(() => expect(apiMock.setEmplacement).toHaveBeenCalledWith(42, 'ETAGERE 2'));
    expect(await within(dialog).findByText('ETAGERE 2')).toBeInTheDocument();
  });

  it('accueil : même proposition ; « Plus tard » la referme sans rien enregistrer', async () => {
    resetApi();
    auth.user = { target: 'accueil', utilisateur: 'Sophie' };
    renderPanel({ path: '/accueil' });
    scanner();
    const dialog = await terminer(/Terminé sans prévenir/);
    await within(dialog).findByRole('textbox', { name: 'Rangé où ?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ranger l’appareil plus tard' }));
    expect(champRange(dialog)).not.toBeInTheDocument();
    expect(within(dialog).getByText('Pas d’emplacement noté')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Noter l’emplacement' })));
    expect(apiMock.setEmplacement).not.toHaveBeenCalled();
    // Facultatif : la remise reste proposée
    expect(within(dialog).getByRole('button', { name: 'Rendre au client' })).toBeEnabled();
  });

  it('tablette (pointeur tactile) : pas de focus automatique (clavier virtuel), boutons à toucher', async () => {
    window.matchMedia = vi.fn((q) => ({
      matches: q === '(pointer: coarse)', media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
    }));
    resetApi();
    renderPanel();
    scanner();
    const dialog = await terminer(/Terminé sans prévenir/);
    const champ = await within(dialog).findByRole('textbox', { name: 'Rangé où ?' });
    await within(dialog).findByRole('button', { name: 'B3' });
    await act(async () => { await new Promise((r) => { setTimeout(r, 30); }); });
    expect(document.activeElement).not.toBe(champ);
    expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: 'KP-000042' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'B3' }));
    await waitFor(() => expect(apiMock.setEmplacement).toHaveBeenCalledWith(42, 'B3'));
  });

  it('emplacements illisibles : simple champ, rien de bloquant', async () => {
    resetApi();
    apiMock.getEtagereConfig.mockRejectedValue(new Error('Erreur serveur'));
    renderPanel();
    scanner();
    const dialog = await terminer(/Terminé sans prévenir/);
    const champ = await within(dialog).findByRole('textbox', { name: 'Rangé où ?' });
    expect(within(dialog).queryByRole('group', { name: 'Emplacements proposés' })).not.toBeInTheDocument();
    fireEvent.change(champ, { target: { value: 'b1' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    await waitFor(() => expect(apiMock.setEmplacement).toHaveBeenCalledWith(42, 'B1'));
  });
});

describe('ticket « Réparation terminée » scanné (client qui vient chercher)', () => {
  const PAYE = { ...MONTANTS, reste: 0, paye: true };

  it('« Rangé en B3 » en très gros en haut, lu avec le résumé ; visible pendant la remise, plus rien après', async () => {
    resetApi({ statut: 'Réparation terminée', emplacement: 'b3', paye: 1, montants: PAYE });
    auth.user = { target: 'accueil', utilisateur: 'Sophie' };
    apiMock.restitution.mockImplementation(async () => ({
      ok: true, deja_rendu: false,
      ticket: ticket({ statut: 'Rendu au client', emplacement: null, paye: 1, montants: PAYE, date_rendu: '2026-10-16 15:00:00', rendu_par: 'Sophie' }),
    }));
    renderPanel({ path: '/accueil' });
    scanner();
    const dialog = await screen.findByRole('dialog');
    const titre = within(dialog).getByRole('heading', { name: 'KP-000042' });
    const bloc = within(dialog).getByText('Rangé en').closest('p');
    expect(bloc).toHaveTextContent('Rangé en B3');
    expect(bloc.closest('header')).not.toBeNull();
    expect(within(bloc).getByText('B3').className).toMatch(/text-5xl/);
    expect(dialog).toHaveAccessibleDescription(/Rangé en B3/);
    // Le focus reste sur le code du ticket : rien n'est saisi d'office
    expect(document.activeElement).toBe(titre);
    expect(champRange(dialog)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Modifier l’emplacement' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Rendre au client' }));
    expect(within(dialog).getByRole('heading', { name: /Remise au client/ })).toBeInTheDocument();
    expect(within(dialog).getByText('Rangé en').closest('p')).toHaveTextContent('Rangé en B3');
    expect(within(dialog).queryByRole('button', { name: 'Modifier l’emplacement' })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmer la remise/ }));
    await waitFor(() => expect(apiMock.restitution).toHaveBeenCalledTimes(1));
    expect(await within(dialog).findByText('Rendu au client', { selector: 'p' })).toBeInTheDocument();
    expect(within(dialog).queryByText('Rangé en')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Pas d’emplacement noté')).not.toBeInTheDocument();
    expect(apiMock.setEmplacement).not.toHaveBeenCalled();
  });

  it('pas d’emplacement : « Pas d’emplacement noté », saisie au clic puis « Rangé en C2 »', async () => {
    resetApi({ statut: 'Réparation terminée' });
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Pas d’emplacement noté')).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription(/Pas d’emplacement noté/);
    const noter = within(dialog).getByRole('button', { name: 'Noter l’emplacement' });
    expect(noter.className).toMatch(/min-h-\[44px\]/);
    fireEvent.click(noter);
    const champ = within(dialog).getByRole('textbox', { name: 'Rangé où ?' });
    await waitFor(() => expect(document.activeElement).toBe(champ));

    // Fermer sans rien enregistrer, puis rouvrir et saisir
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fermer la saisie de l’emplacement' }));
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Noter l’emplacement' })));
    expect(apiMock.setEmplacement).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Noter l’emplacement' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'C2' }));
    await waitFor(() => expect(apiMock.setEmplacement).toHaveBeenCalledWith(42, 'C2'));
    expect(await within(dialog).findByRole('button', { name: 'Modifier l’emplacement' })).toBeInTheDocument();
    expect(within(dialog).getByText('Rangé en').closest('p')).toHaveTextContent('Rangé en C2');
  });

  it('enregistrement refusé : l’erreur reste affichée dans la saisie, la remise reste possible', async () => {
    resetApi({ statut: 'Réparation terminée' });
    apiMock.setEmplacement.mockRejectedValue(new Error('Serveur injoignable'));
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Noter l’emplacement' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'A1' }));
    expect(await within(dialog).findByText('Non enregistré : Serveur injoignable')).toBeInTheDocument();
    expect(champRange(dialog)).toBeInTheDocument();
    expect(within(dialog).queryByText('Rangé en')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Rendre au client' })).toBeEnabled();
  });
});

describe('douchette pendant la saisie « Rangé où ? »', () => {
  it('le scan suivant ouvre l’autre ticket, le code ne finit pas dans le champ, la saisie tapée est gardée', async () => {
    resetApi({}, { 43: ticket({ id: 43, ticket_code: 'KP-000043', statut: 'Réparation terminée', emplacement: 'A1' }) });
    renderPanel({ listener: true });
    scanner();
    const dialog = await terminer(/Terminé sans prévenir/);
    const champ = await within(dialog).findByRole('textbox', { name: 'Rangé où ?' });
    await waitFor(() => expect(document.activeElement).toBe(champ));

    // Le technicien tape « D4 » sans valider, puis scanne l'appareil suivant
    fireEvent.change(champ, { target: { value: 'D4' } });
    const entree = douchette('KP-000043');
    expect(entree.defaultPrevented).toBe(true);

    expect(await screen.findByRole('heading', { name: 'KP-000043' })).toBeInTheDocument();
    expect(apiMock.resolveCode).toHaveBeenLastCalledWith('KP-000043');
    await waitFor(() => expect(apiMock.setEmplacement).toHaveBeenCalledWith(42, 'D4'));
    expect(apiMock.setEmplacement).toHaveBeenCalledTimes(1);
    expect(apiMock.setEmplacement.mock.calls.flat().join(' ')).not.toMatch(/KP/);
    expect(screen.getByText('Rangé en').closest('p')).toHaveTextContent('Rangé en A1');
  });

  it('champ vide focalisé : le scan passe, aucun emplacement enregistré', async () => {
    resetApi({}, { 43: ticket({ id: 43, ticket_code: 'KP-000043', statut: 'Réparation terminée' }) });
    renderPanel({ listener: true });
    scanner();
    const dialog = await terminer(/Terminé sans prévenir/);
    const champ = await within(dialog).findByRole('textbox', { name: 'Rangé où ?' });
    await waitFor(() => expect(document.activeElement).toBe(champ));
    douchette('KP-000043');
    expect(await screen.findByRole('heading', { name: 'KP-000043' })).toBeInTheDocument();
    expect(screen.getByText('Pas d’emplacement noté')).toBeInTheDocument();
    await act(async () => { await new Promise((r) => { setTimeout(r, 20); }); });
    expect(apiMock.setEmplacement).not.toHaveBeenCalled();
  });
});
