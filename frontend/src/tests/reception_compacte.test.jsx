/**
 * Fiche de réception compacte : carte déroulante FERMÉE par défaut (la réception est facultative),
 * en-tête d'une ligne avec badge + résumé, état déplié mémorisé par ticket dans la session,
 * le bouton « Réception à compléter » du haut de la fiche l'ouvre et y fait défiler.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { auth, apiMock } = vi.hoisted(() => {
  const base = {};
  // Toute méthode non préparée par un test répond une liste vide (équipe, notes, pièces…)
  const apiMock = new Proxy(base, {
    get(target, cle) {
      if (!(cle in target)) target[cle] = vi.fn().mockResolvedValue([]);
      return target[cle];
    },
  });
  return { auth: { user: { target: 'accueil', utilisateur: 'Sophie', role: '' } }, apiMock };
});

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { ToastProvider } from '../components/Toast';
import { clearCache } from '../hooks/useApi';
import TicketDetailPage from '../pages/TicketDetailPage';
import ReceptionCard, { resumeCourt, lireOuvert } from '../components/ReceptionCard';

const IMEI_OK = '490154203237518';
const CLE = 'kp_reception_ouverte:42';

function ticket(overrides = {}) {
  return {
    id: 42, ticket_code: 'KP-000042', statut: 'En attente de diagnostic', client_id: 5,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '0612345678', client_email: '',
    categorie: 'Smartphone', marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé', imei: '',
    date_depot: new Date().toISOString(), paye: 0, acompte: 0, devis_estime: 0, priorite: 'normal',
    reparation_supp: '[]', tarif_final: 0, historique: '',
    ...overrides,
  };
}

function renderFiche() {
  return render(
    <MemoryRouter initialEntries={['/accueil/ticket/42']}>
      <ToastProvider>
        <Routes>
          <Route path="/accueil/ticket/:id" element={<TicketDetailPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const renderCarte = (props = {}) => render(<ReceptionCard ticketId="42" {...props} />);
const enTete = () => screen.getByRole('button', { name: 'Réception' });
const attendreEnTete = () => screen.findByRole('button', { name: 'Réception' });

let courant;
let reception;

beforeEach(() => {
  clearCache();
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* stockage indisponible */ }
  auth.user = { target: 'accueil', utilisateur: 'Sophie', role: '' };
  for (const fn of Object.values(apiMock)) fn.mockReset().mockResolvedValue([]);
  courant = ticket();
  reception = { items: null, complete: false, auteur: null, date_maj: null };
  apiMock.getTicket.mockImplementation(async () => ({ ...courant }));
  apiMock.markTicketRead.mockResolvedValue({ ok: true });
  apiMock.addHistory.mockResolvedValue({ ok: true });
  apiMock.updateTicket.mockImplementation(async (id, patch) => {
    courant = { ...courant, ...patch };
    return { ok: true, ticket: { ...courant } };
  });
  apiMock.getReception.mockImplementation(async () => ({ ...reception }));
  apiMock.saveReception.mockImplementation(async (id, data) => {
    reception = { ...data, auteur: 'Sophie', date_maj: '2026-10-16T10:00:00' };
    return { ...reception };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Résumé d'une ligne ─────────────────────────────────────────
describe('resumeCourt', () => {
  it('accessoires, défauts, tests KO, IMEI, notes — séparés par « · », première lettre en majuscule', () => {
    expect(resumeCourt({
      accessoires: ['coque', 'chargeur'], etat: { ecran: 'raye', dos: 'ok', chassis: 'ok' },
      tests: { micro: false, charge: false, wifi: false, allume: true },
    })).toBe('Coque, chargeur · écran rayé · 3 tests KO');
    expect(resumeCourt({
      accessoires: [], etat: { ecran: 'ok', dos: 'ok', chassis: 'ok', notes: ' Oxydation ' }, tests: { micro: false }, imei_verifie: IMEI_OK,
    })).toBe('Aucun accessoire · état OK · 1 test KO · IMEI vérifié · Oxydation');
  });

  it('rien sur les tests tant qu’aucun n’est fait ; « tests OK » quand tout est testé ; sinon le nombre restant', () => {
    // Sans `etat` (fiche d'un autre poste) : faces non renseignées → ni « OK » ni défaut inventé
    expect(resumeCourt({ accessoires: ['cable'] })).toBe('Câble');
    const tous = Object.fromEntries(['allume', 'tactile', 'face_touch_id', 'camera_avant', 'camera_arriere', 'micro',
      'haut_parleur', 'ecouteur', 'charge', 'wifi', 'reseau', 'boutons'].map(k => [k, true]));
    expect(resumeCourt({ accessoires: ['cable'], tests: tous })).toBe('Câble · tests OK');
    expect(resumeCourt({ accessoires: [], tests: { allume: true, tactile: true, micro: true } })).toBe('Aucun accessoire · 9 non testés');
    expect(resumeCourt({ accessoires: ['autre'], accessoires_autre: 'Pochette', etat: { ecran: 'fissure' } })).toBe('Pochette · écran fissuré');
    expect(resumeCourt({ accessoires: [], etat: { ecran: 'ok', dos: 'ok', chassis: 'ok' } })).toBe('Aucun accessoire · état OK');
  });
});

// ─── Carte seule ────────────────────────────────────────────────
describe('ReceptionCard compacte', () => {
  it('fermée par défaut : en-tête d’une ligne (badge, « facultatif », contenu), aucun formulaire, rien envoyé', async () => {
    const onEtat = vi.fn();
    renderCarte({ onEtat });
    const bouton = await attendreEnTete();
    await screen.findByText('Réception à compléter');
    expect(bouton).toHaveAttribute('aria-expanded', 'false');
    expect(bouton).not.toHaveAttribute('aria-controls');
    expect(screen.getAllByText('facultatif').length).toBeGreaterThan(0);
    expect(screen.getByText(/Accessoires, état, tests d’entrée, IMEI/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Valider la réception' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Chargeur' })).not.toBeInTheDocument();
    await waitFor(() => expect(onEtat).toHaveBeenLastCalledWith({ charge: 'ok', complete: false }));
    await new Promise((r) => setTimeout(r, 700));
    expect(apiMock.saveReception).not.toHaveBeenCalled();
    expect(lireOuvert('42')).toBe(false);
  });

  it('l’en-tête déplie (aria-expanded, aria-controls vers le formulaire) et replie ; le nom accessible reste « Réception »', async () => {
    renderCarte();
    const bouton = await attendreEnTete();
    await screen.findByText('Réception à compléter');
    fireEvent.click(bouton);
    expect(bouton).toHaveAttribute('aria-expanded', 'true');
    const corps = document.getElementById(bouton.getAttribute('aria-controls'));
    expect(corps).not.toBeNull();
    expect(within(corps).getByRole('button', { name: 'Valider la réception' })).toBeInTheDocument();
    expect(within(corps).getByRole('group', { name: 'Micro' })).toBeInTheDocument();
    // La description du bouton = badge + résumé (lus après le nom par un lecteur d'écran)
    const ids = bouton.getAttribute('aria-describedby').split(' ');
    expect(ids.map(id => document.getElementById(id)?.textContent).join(' ')).toMatch(/Réception à compléter.*Accessoires, état/);
    fireEvent.click(bouton);
    expect(bouton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Valider la réception' })).not.toBeInTheDocument();
  });

  it('fiche remplie : résumé compact dans l’en-tête, badge « Validée », formulaire pré-rempli à l’ouverture', async () => {
    reception = {
      items: { accessoires: ['coque'], etat: { ecran: 'ok', dos: 'raye', chassis: 'ok', notes: '' }, tests: { micro: false }, imei_verifie: IMEI_OK },
      complete: true, auteur: 'Karim', date_maj: '2026-10-15T08:30:00',
    };
    renderCarte();
    expect(await screen.findByText('Coque · dos rayé · 1 test KO · IMEI vérifié')).toBeInTheDocument();
    expect(screen.getByText('Validée')).toBeInTheDocument();
    expect(screen.queryByText(/Validée par Karim/)).not.toBeInTheDocument();
    fireEvent.click(enTete());
    expect(screen.getByRole('checkbox', { name: 'Coque' })).toBeChecked();
    expect(within(screen.getByRole('group', { name: 'Dos' })).getByRole('radio', { name: 'Rayé' })).toBeChecked();
    expect(screen.getByText(/Validée par Karim/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repasser « à compléter »' })).toBeInTheDocument();
  });

  it('état déplié mémorisé dans la session : un remontage garde la fiche ouverte ; « Valider » la referme et l’oublie', async () => {
    const { unmount } = renderCarte();
    fireEvent.click(await attendreEnTete());
    expect(await screen.findByRole('button', { name: 'Valider la réception' })).toBeInTheDocument();
    expect(sessionStorage.getItem(CLE)).toBe('1');
    unmount();

    renderCarte();
    expect(await screen.findByRole('button', { name: 'Valider la réception' })).toBeInTheDocument();
    expect(enTete()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Valider la réception' }));
    await waitFor(() => expect(enTete()).toHaveAttribute('aria-expanded', 'false'));
    expect(sessionStorage.getItem(CLE)).toBeNull();
    expect(await screen.findByText('Validée')).toBeInTheDocument();
    expect(screen.getByText('Aucun accessoire · état OK')).toBeInTheDocument();
  });

  it('« Réduire » replie sans valider et envoie ce qui est en attente', async () => {
    renderCarte();
    fireEvent.click(await attendreEnTete());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Coque' }));
    fireEvent.click(screen.getByRole('button', { name: 'Réduire' }));
    expect(enTete()).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(apiMock.saveReception).toHaveBeenCalledTimes(1));
    expect(apiMock.saveReception.mock.calls[0][1]).toMatchObject({ complete: false, items: { accessoires: ['coque'] } });
    expect(await screen.findByText('Coque · état OK')).toBeInTheDocument();
    expect(screen.getByText('Réception à compléter')).toBeInTheDocument();
  });

  it('stockage de session indisponible : la carte fonctionne quand même', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqué'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqué'); });
    renderCarte();
    const bouton = await attendreEnTete();
    expect(bouton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(bouton);
    expect(await screen.findByRole('button', { name: 'Valider la réception' })).toBeInTheDocument();
  });

  it('appareil déjà rendu sans fiche : badge neutre « Non validée », pas d’alerte', async () => {
    renderCarte({ remis: true });
    await attendreEnTete();
    expect(await screen.findByText('Non validée')).toBeInTheDocument();
    expect(screen.queryByText('Réception à compléter')).not.toBeInTheDocument();
  });

  it('controleRef.ouvrir() déplie et mémorise ; un clic pendant le chargement ouvre dès l’arrivée des données', async () => {
    let repondre;
    apiMock.getReception.mockImplementation(() => new Promise((r) => { repondre = r; }));
    const ref = { current: null };
    renderCarte({ controleRef: ref });
    const bouton = enTete();
    expect(screen.getByText(/Chargement…/)).toBeInTheDocument();
    fireEvent.click(bouton);
    expect(bouton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('button', { name: 'Valider la réception' })).not.toBeInTheDocument();
    await act(async () => { repondre({ items: null, complete: false }); });
    expect(await screen.findByRole('button', { name: 'Valider la réception' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Réduire' }));
    expect(lireOuvert('42')).toBe(false);
    act(() => ref.current.ouvrir());
    expect(bouton).toHaveAttribute('aria-expanded', 'true');
    expect(lireOuvert('42')).toBe(true);
  });

  it('serveur indisponible : « Indisponible » dans l’en-tête, message et « Réessayer » ; la carte reste fermée après', async () => {
    apiMock.getReception.mockRejectedValueOnce(new Error('Erreur 500'));
    renderCarte();
    expect(await screen.findByText('Fiche de réception indisponible.')).toBeInTheDocument();
    expect(screen.getByText(/Indisponible/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Réception à compléter')).toBeInTheDocument();
    expect(enTete()).toHaveAttribute('aria-expanded', 'false');
  });
});

// ─── Dans la fiche ticket ───────────────────────────────────────
describe('Fiche : réception compacte', () => {
  it('fermée par défaut même en attente de diagnostic, déposé à l’instant ; le bouton du haut l’ouvre et y fait défiler', async () => {
    const defiler = vi.fn();
    Element.prototype.scrollIntoView = defiler;
    renderFiche();
    const haut = await screen.findByRole('button', { name: 'Réception à compléter' });
    expect(screen.getByRole('heading', { name: 'Réception' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Valider la réception' })).not.toBeInTheDocument();
    expect(enTete()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(haut);
    expect(await screen.findByRole('button', { name: 'Valider la réception' })).toBeInTheDocument();
    expect(defiler).toHaveBeenCalled();
    expect(document.activeElement?.id).toMatch(/-reception$/);
    // Le badge du haut reste tant que la réception n'est pas validée
    expect(screen.getByRole('button', { name: 'Réception à compléter' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Valider la réception' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Réception à compléter' })).not.toBeInTheDocument());
    expect(enTete()).toHaveAttribute('aria-expanded', 'false');
  });

  it('ticket rendu : ni bouton en haut ni alerte, badge « Non validée »', async () => {
    courant = ticket({ statut: 'Rendu au client', paye: 1 });
    renderFiche();
    expect(await screen.findByText('Non validée')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réception à compléter' })).not.toBeInTheDocument();
    expect(screen.queryByText('Réception à compléter')).not.toBeInTheDocument();
  });

  it('un seul en-tête « Réception » : le résumé de l’en-tête n’est pas un titre', async () => {
    reception = { items: { accessoires: ['chargeur'], etat: { ecran: 'ok', dos: 'ok', chassis: 'ok' } }, complete: false };
    renderFiche();
    expect(await screen.findByText('Chargeur · état OK')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: /Réception/ })).toHaveLength(1);
  });
});
