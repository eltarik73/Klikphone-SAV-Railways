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
import ReceptionCard, { resumeCourt, lireOuvert, itemsVides, TESTS, ETATS, ACCESSOIRES } from '../components/ReceptionCard';

const IMEI_OK = '490154203237518';
const CLE = 'kp_reception_ouverte:42';
// Puces : accessoires = boutons aria-pressed ; état = radiogroup par partie ; tests = boutons « Nom : état » qui cyclent
const puce = (nom) => screen.getByRole('button', { name: nom });
const radiogroupe = (nom) => screen.getByRole('radiogroup', { name: nom });
const puceTest = (nom, etat = 'non testé') => screen.getByRole('button', { name: `${nom} : ${etat}` });

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

  it('fiche vide (tout décoché) : « Aucun accessoire », jamais « non renseigné » ni « état OK » inventé', () => {
    expect(resumeCourt(itemsVides())).toBe('Aucun accessoire');
    expect(resumeCourt({})).toBe('Aucun accessoire');
    expect(resumeCourt(itemsVides())).not.toMatch(/non renseigné|état OK|non testé/);
    // Une seule partie renseignée OK : rien à signaler sur l'état (les deux autres restent inconnues)
    expect(resumeCourt({ accessoires: ['coque'], etat: { ecran: 'ok' } })).toBe('Coque');
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
    expect(screen.queryByRole('button', { name: 'Chargeur' })).not.toBeInTheDocument();
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
    expect(within(corps).getByRole('button', { name: 'Micro : non testé' })).toBeInTheDocument();
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
    expect(puce('Coque')).toHaveAttribute('aria-pressed', 'true');
    expect(puce('Chargeur')).toHaveAttribute('aria-pressed', 'false');
    expect(within(radiogroupe('Dos')).getByRole('radio', { name: 'Rayé' })).toBeChecked();
    expect(within(radiogroupe('Écran')).getByRole('radio', { name: 'OK' })).toBeChecked();
    expect(puceTest('Micro', 'KO')).toBeInTheDocument();
    expect(screen.getByLabelText('IMEI / n° de série vérifié')).toHaveValue(IMEI_OK);
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
    // Validée sans rien cocher : plus d'« état OK » d'office (écran/dos/châssis restent non renseignés)
    expect(screen.getByText('Aucun accessoire')).toBeInTheDocument();
  });

  it('« Réduire » replie sans valider et envoie ce qui est en attente', async () => {
    renderCarte();
    fireEvent.click(await attendreEnTete());
    fireEvent.click(puce('Coque'));
    fireEvent.click(screen.getByRole('button', { name: 'Réduire' }));
    expect(enTete()).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(apiMock.saveReception).toHaveBeenCalledTimes(1));
    expect(apiMock.saveReception.mock.calls[0][1]).toMatchObject({ complete: false, items: { accessoires: ['coque'] } });
    // État non renseigné : le résumé ne dit plus « état OK » (plus de valeur présélectionnée)
    expect(await screen.findByText('Coque')).toBeInTheDocument();
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

// ─── Tout décoché par défaut, puces ─────────────────────────────
describe('ReceptionCard : tout décoché, puces', () => {
  const ouvrirVide = async () => {
    renderCarte();
    fireEvent.click(await attendreEnTete());
    return screen.findByRole('button', { name: 'Valider la réception' });
  };

  it('fiche vide ouverte : aucun accessoire coché, aucun état choisi, aucun test fait, cases décochées, IMEI et notes vides', async () => {
    await ouvrirVide();
    for (const [, nom] of ACCESSOIRES) expect(puce(nom)).toHaveAttribute('aria-pressed', 'false');
    for (const [, nom] of ETATS) {
      const radios = within(radiogroupe(nom)).getAllByRole('radio');
      expect(radios).toHaveLength(4);
      expect(radios.some(r => r.getAttribute('aria-checked') === 'true')).toBe(false);
      // Clavier : une seule puce tabulable (la première), les autres par les flèches
      expect(radios.map(r => r.tabIndex)).toEqual([0, -1, -1, -1]);
    }
    for (const [, nom] of TESTS) expect(puceTest(nom)).toBeInTheDocument();
    expect(screen.getByText('12 non testés')).toBeInTheDocument();
    expect(puce('Reçu éteint')).toHaveAttribute('aria-pressed', 'false');
    expect(puce('Sauvegarde conseillée')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('IMEI / n° de série vérifié')).toHaveValue('');
    expect(screen.getByLabelText('Notes')).toHaveValue('');
    expect(screen.queryByText(/non renseigné/)).not.toBeInTheDocument();
    // « Valider » reste possible sur une fiche partielle ou vide
    expect(screen.getByRole('button', { name: 'Valider la réception' })).toBeEnabled();
  });

  it('aucun PUT tant que rien n’est modifié (ouverture, focus, flou, repli, réouverture)', async () => {
    await ouvrirVide();
    puceTest('Micro').focus();
    fireEvent.blur(screen.getByLabelText('IMEI / n° de série vérifié'));
    fireEvent.blur(screen.getByLabelText('Notes'));
    fireEvent.click(screen.getByRole('button', { name: 'Réduire' }));
    fireEvent.click(enTete());
    await new Promise((r) => setTimeout(r, 800));
    expect(apiMock.saveReception).not.toHaveBeenCalled();
    expect(screen.getByText(/Accessoires, état, tests d’entrée, IMEI/)).toBeInTheDocument();
  });

  it('puce de test : un tap cycle non testé → OK → KO → non testé ; aria-label et compteur suivent', async () => {
    await ouvrirVide();
    const tactile = puceTest('Tactile');
    expect(tactile.tagName).toBe('BUTTON');
    fireEvent.click(tactile);
    expect(puceTest('Tactile', 'OK')).toBe(tactile);
    expect(screen.getByText('1 OK · 11 non testés')).toBeInTheDocument();
    fireEvent.click(tactile);
    expect(puceTest('Tactile', 'KO')).toBe(tactile);
    expect(screen.getByText('1 KO · 11 non testés')).toBeInTheDocument();
    await waitFor(() => expect(apiMock.saveReception).toHaveBeenCalled());
    expect(apiMock.saveReception.mock.calls.at(-1)[1].items.tests.tactile).toBe(false);
    fireEvent.click(tactile);
    expect(puceTest('Tactile')).toBe(tactile);
    expect(screen.getByText('12 non testés')).toBeInTheDocument();
    await waitFor(() => expect(apiMock.saveReception.mock.calls.at(-1)[1].items.tests.tactile).toBeNull());
  });

  it('« Tout OK » des tests : les neutres passent OK, un KO constaté reste KO ; compteur « 11 OK · 1 KO »', async () => {
    await ouvrirVide();
    fireEvent.click(puceTest('Micro'));
    fireEvent.click(puceTest('Micro', 'OK'));
    fireEvent.click(screen.getByRole('button', { name: 'Tout OK : tests d’entrée' }));
    expect(puceTest('Micro', 'KO')).toBeInTheDocument();
    for (const [, nom] of TESTS.filter(([k]) => k !== 'micro')) expect(puceTest(nom, 'OK')).toBeInTheDocument();
    expect(screen.getByText('11 OK · 1 KO')).toBeInTheDocument();
    await waitFor(() => expect(apiMock.saveReception).toHaveBeenCalled());
    const tests = apiMock.saveReception.mock.calls.at(-1)[1].items.tests;
    expect(tests.micro).toBe(false);
    expect(Object.values(tests).filter(v => v === true)).toHaveLength(11);
  });

  it('« Tout OK » de l’état : OK sur écran, dos et châssis ; le résumé dit « état OK »', async () => {
    await ouvrirVide();
    fireEvent.click(screen.getByRole('button', { name: 'Tout OK : état constaté' }));
    for (const [, nom] of ETATS) expect(within(radiogroupe(nom)).getByRole('radio', { name: 'OK' })).toBeChecked();
    await waitFor(() => expect(apiMock.saveReception).toHaveBeenCalled());
    expect(apiMock.saveReception.mock.calls.at(-1)[1].items.etat).toMatchObject({ ecran: 'ok', dos: 'ok', chassis: 'ok' });
    fireEvent.click(screen.getByRole('button', { name: 'Réduire' }));
    expect(await screen.findByText('Aucun accessoire · état OK')).toBeInTheDocument();
  });

  it('état : puces exclusives par partie, flèches du clavier ; les autres parties restent sans valeur', async () => {
    await ouvrirVide();
    const ecran = radiogroupe('Écran');
    fireEvent.click(within(ecran).getByRole('radio', { name: 'Rayé' }));
    expect(within(ecran).getByRole('radio', { name: 'Rayé' })).toBeChecked();
    fireEvent.click(within(ecran).getByRole('radio', { name: 'Cassé' }));
    expect(within(ecran).getByRole('radio', { name: 'Rayé' })).not.toBeChecked();
    expect(within(ecran).getByRole('radio', { name: 'Cassé' })).toBeChecked();
    expect(within(radiogroupe('Dos')).queryByRole('radio', { checked: true })).toBeNull();
    // Flèche gauche depuis « Cassé » → « Fissuré », qui prend le focus
    fireEvent.keyDown(ecran, { key: 'ArrowLeft' });
    expect(within(ecran).getByRole('radio', { name: 'Fissuré' })).toBeChecked();
    expect(document.activeElement).toBe(within(ecran).getByRole('radio', { name: 'Fissuré' }));
    await waitFor(() => expect(apiMock.saveReception).toHaveBeenCalled());
    expect(apiMock.saveReception.mock.calls.at(-1)[1].items.etat).toMatchObject({ ecran: 'fissure', dos: null, chassis: null });
  });

  it('accessoires : puces multi (aria-pressed), « Autre » ouvre un champ ; « Reçu éteint » à bascule avec son conseil', async () => {
    await ouvrirVide();
    fireEvent.click(puce('Coque'));
    fireEvent.click(puce('Autre'));
    expect(puce('Coque')).toHaveAttribute('aria-pressed', 'true');
    expect(puce('Autre')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('Autre accessoire'), { target: { value: 'Pochette' } });
    fireEvent.click(puce('Reçu éteint'));
    expect(puce('Reçu éteint')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/reçu éteint : « non testé » si invérifiable/)).toBeInTheDocument();
    fireEvent.click(puce('Coque'));
    expect(puce('Coque')).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(apiMock.saveReception.mock.calls.at(-1)?.[1].items).toMatchObject({
      accessoires: ['autre'], accessoires_autre: 'Pochette', appareil_eteint: true,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Réduire' }));
    expect(await screen.findByText('Pochette')).toBeInTheDocument();
  });

  // ─── Retours de relecture : cibles tactiles, chevauchement, repli notes, contraste ───
  it('saisies 44 px au doigt : IMEI, « Autre » et Notes portent la variante pointer:coarse (plus de !min-h-9 seul, qui écrasait la règle d’index.css)', async () => {
    await ouvrirVide();
    fireEvent.click(puce('Autre'));
    // <input class="input"> : l'utilitaire non important suffit (même spécificité que .input, déclaré après)
    for (const champ of [screen.getByLabelText('IMEI / n° de série vérifié'), screen.getByLabelText('Autre accessoire')]) {
      expect(champ).toHaveClass('min-h-9', '[@media(pointer:coarse)]:min-h-11');
      expect(champ.className).not.toMatch(/!min-h-9/);
    }
    // <textarea class="input"> : `textarea.input` (0,1,1 : 96 px) battrait un utilitaire simple → formes importantes
    expect(screen.getByLabelText('Notes')).toHaveClass('!min-h-9', '[@media(pointer:coarse)]:!min-h-11');
  });

  it('« Tout OK » des tests ne déborde que vers le haut (-mt-1) : ses 4 px bas ne passent plus sous la première puce', async () => {
    await ouvrirVide();
    const toutOkTests = screen.getByRole('button', { name: 'Tout OK : tests d’entrée' });
    expect(toutOkTests).toHaveClass('-mt-1');
    expect(toutOkTests).not.toHaveClass('-my-1');
    // L'état constaté garde -my-1 : sa première ligne (étiquette + 4 puces) n'atteint pas le bouton
    expect(screen.getByRole('button', { name: 'Tout OK : état constaté' })).toHaveClass('-my-1');
  });

  it('notes sans field-sizing (Firefox) : la hauteur suit le texte en JS, plafonnée à 96 px, et redescend', async () => {
    vi.stubGlobal('CSS', { supports: (prop) => prop !== 'field-sizing' });
    try {
      await ouvrirVide();
      const notes = screen.getByLabelText('Notes');
      let contenu = 0; // jsdom ne rend rien : on simule scrollHeight
      Object.defineProperty(notes, 'scrollHeight', { configurable: true, get: () => contenu });
      contenu = 58;
      fireEvent.change(notes, { target: { value: 'Oxydation\nVitre arrière décollée' } });
      expect(notes.style.height).toBe('58px');
      contenu = 240;
      fireEvent.change(notes, { target: { value: Array.from({ length: 10 }, (_, i) => `ligne ${i + 1}`).join('\n') } });
      expect(notes.style.height).toBe('96px');
      contenu = 31;
      fireEvent.change(notes, { target: { value: '' } });
      expect(notes.style.height).toBe('31px');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('notes avec field-sizing : aucune hauteur forcée en ligne (le CSS fait le travail)', async () => {
    vi.stubGlobal('CSS', { supports: () => true });
    try {
      await ouvrirVide();
      const notes = screen.getByLabelText('Notes');
      Object.defineProperty(notes, 'scrollHeight', { configurable: true, get: () => 58 });
      fireEvent.change(notes, { target: { value: 'Oxydation\nVitre arrière décollée' } });
      expect(notes.style.height).toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('icône « non testé » en slate-500 (4,8:1 sur blanc, ≥ 3:1 non textuel), plus slate-400', async () => {
    await ouvrirVide();
    const icone = puceTest('Micro').querySelector('svg');
    expect(icone).toHaveClass('text-slate-500');
    expect(icone).not.toHaveClass('text-slate-400');
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
