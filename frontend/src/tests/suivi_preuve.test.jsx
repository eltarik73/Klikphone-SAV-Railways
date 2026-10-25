/**
 * Page publique /suivi : l'accès à une réparation exige une preuve — le jeton `t` du QR / lien
 * envoyé, OU le numéro de ticket ET le numéro de téléphone donné au dépôt (les codes KP-000123
 * sont séquentiels : le code seul n'ouvre plus rien).
 * - formulaire à deux champs obligatoires, un seul bouton « Voir mon suivi » ;
 * - lien avec jeton : ouverture directe ; jeton refusé → formulaire prérempli, focus téléphone ;
 * - ancien lien / douchette (?ticket= sans jeton) : formulaire prérempli, focus téléphone ;
 * - la preuve est jointe à TOUS les appels (fiche, commandes, has-avis, fidélité, grattage,
 *   message, devis, avis, polling) et mémorisée dans l'onglet (sessionStorage) ;
 * - messages d'erreur : mauvais numéro (champ téléphone aria-invalid), trop d'essais, ticket inconnu ;
 * - personnel connecté : fiche ouverte sans preuve (session), QR intelligent conservé ;
 * - transport (client HTTP réel) : le numéro de téléphone part dans l'en-tête X-Suivi-Tel, jamais
 *   dans l'URL des GET — sans repli « ?tel= » (le serveur lit l'en-tête sur toutes les lectures).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const { apiMock, auth, fidelite, grattage } = vi.hoisted(() => ({
  apiMock: {
    getTicketByCode: vi.fn(), getPublicCommandes: vi.fn(), suiviHasAvis: vi.fn(), trackEvent: vi.fn(),
    suiviSendMessage: vi.fn(), suiviValiderDevis: vi.fn(), suiviLaisserAvis: vi.fn(),
    background: vi.fn((fn) => fn()),
  },
  auth: { user: null },
  fidelite: vi.fn(() => null),
  grattage: vi.fn(() => null),
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal(); // suiviProof / suiviAcces réels, client HTTP simulé
  return { ...actual, default: apiMock, api: apiMock };
});
vi.mock('../components/FideliteCard', () => ({ default: (props) => fidelite(props) }));
vi.mock('../components/ScratchCard', () => ({ default: (props) => grattage(props) }));

import SuiviPage, { TEXTES, lirePreuve } from '../pages/SuiviPage';
import * as apiLib from '../lib/api';
import { suiviProof, suiviAcces, SUIVI_TEL_HEADER } from '../lib/api';
import { lienSuivi } from '../lib/ticketCode';

const JETON = 'JetonFictif_0123456789';
const TEL = '06 12 34 56 79';

// Réponse fetch simulée pour le client HTTP réel (detail = refus { code, message } du serveur)
const reponse = (data, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: () => Promise.resolve(data),
});
const refusServeur = (code) => reponse({ detail: { code, message: code } }, 403);

function ticket(extra) {
  return {
    id: 5, ticket_code: 'KP-000005', statut: 'En cours de réparation', marque: 'Apple', modele: 'iPhone 12',
    panne: 'Batterie', date_depot: '2026-10-15T10:00:00', reparation_supp: '[]', devis_estime: 0, ...extra,
  };
}

const refus = (status, code, extra = {}) => Object.assign(new Error(code || `Erreur ${status}`), {
  status, detail: code ? { code, message: code } : null, ...extra,
});

function Ou() {
  const loc = useLocation();
  return <p data-testid="ou">{loc.pathname}</p>;
}

function monter(url = '/suivi') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/suivi" element={<SuiviPage />} />
        <Route path="*" element={<Ou />} />
      </Routes>
    </MemoryRouter>,
  );
}

const champCode = () => screen.getByLabelText('Numéro de ticket');
const champTel = () => screen.getByLabelText('Numéro de téléphone');
const bouton = () => screen.getByRole('button', { name: 'Voir mon suivi' });

function soumettre(code, tel) {
  if (code != null) fireEvent.change(champCode(), { target: { value: code } });
  if (tel != null) fireEvent.change(champTel(), { target: { value: tel } });
  fireEvent.click(bouton());
}

beforeEach(() => {
  sessionStorage.clear();
  auth.user = null;
  Object.values(apiMock).forEach((fn) => fn.mockReset?.());
  apiMock.background.mockImplementation((fn) => fn());
  fidelite.mockReset(); fidelite.mockReturnValue(null);
  grattage.mockReset(); grattage.mockReturnValue(null);
  apiMock.getTicketByCode.mockResolvedValue(ticket());
  apiMock.getPublicCommandes.mockResolvedValue([]);
  apiMock.suiviHasAvis.mockResolvedValue({ has_avis: false });
  apiMock.trackEvent.mockResolvedValue({});
  apiMock.suiviSendMessage.mockResolvedValue({ ok: true });
  apiMock.suiviValiderDevis.mockResolvedValue({ ok: true });
  apiMock.suiviLaisserAvis.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('suiviProof / suiviAcces / lienSuivi (lib)', () => {
  it('jeton d’abord, sinon numéro complet (≥ 9 chiffres) ; tel4 n’est plus accepté', () => {
    expect(suiviProof({ t: 'abc' })).toEqual({ t: 'abc' });
    expect(suiviProof({ tel: '06 12 34 56 79' })).toEqual({ tel: '0612345679' });
    expect(suiviProof({ tel: '+33 6 12 34 56 79' })).toEqual({ tel: '+33612345679' });
    expect(suiviProof({ tel: '5679' })).toEqual({});
    expect(suiviProof({ tel4: '5679' })).toEqual({});
    expect(suiviProof(null)).toEqual({});
    // Plus aucun constructeur de « ?tel= » : le numéro ne peut plus finir dans une URL
    expect(Object.keys(apiLib)).not.toContain('suiviQuery');
  });

  it('suiviAcces (lectures) : jeton dans l’adresse, numéro dans l’en-tête X-Suivi-Tel — jamais dans l’URL', () => {
    expect(suiviAcces({ t: 'a b' })).toEqual({ query: '?t=a%20b', headers: {} });
    expect(suiviAcces({ tel: '+33 6 12 34 56 79' })).toEqual({ query: '', headers: { [SUIVI_TEL_HEADER]: '+33612345679' } });
    expect(suiviAcces({ t: 'abc', tel: TEL })).toEqual({ query: '?t=abc', headers: {} });
    expect(suiviAcces({ tel: '5679' })).toEqual({ query: '', headers: {} });
    expect(suiviAcces(null)).toEqual({ query: '', headers: {} });
  });

  it('lienSuivi : jeton en premier, code en fin d’URL ; sans jeton, code seul', () => {
    expect(lienSuivi('https://sav.test/', 'KP-000042', 'Jeton-01')).toBe('https://sav.test/suivi?t=Jeton-01&ticket=KP-000042');
    expect(lienSuivi('', 'KP-000042', null)).toBe('/suivi?ticket=KP-000042');
  });
});

describe('api.suiviGet — transport de la preuve (client HTTP réel, fetch simulé)', () => {
  let client;
  const fetchInitial = global.fetch;
  beforeEach(async () => {
    client = (await vi.importActual('../lib/api')).default;
    global.fetch = vi.fn();
  });
  afterEach(() => { global.fetch = fetchInitial; });

  it('numéro complet : en-tête X-Suivi-Tel et URL sans numéro ; jeton : ?t= dans l’URL, sans en-tête', async () => {
    global.fetch.mockResolvedValue(reponse({ ok: true }));
    await client.getTicketByCode('KP-000005', { tel: TEL });
    await client.getPublicCommandes('KP-000005', { tel: '+33 6 12 34 56 79' });
    await client.suiviHasAvis('KP-000005', { t: JETON });
    await client.getFideliteByTicket('KP-000005', { t: JETON });
    await client.getGrattage('KP-000005', { tel: TEL });
    const appels = global.fetch.mock.calls;
    expect(appels.map((c) => c[0])).toEqual([
      '/api/tickets/code/KP-000005',
      '/api/parts/public/KP-000005',
      `/api/suivi/KP-000005/has-avis?t=${JETON}`,
      `/api/fidelite/ticket/KP-000005?t=${JETON}`,
      '/api/fidelite/grattage/KP-000005',
    ]);
    expect(appels[0][1].headers[SUIVI_TEL_HEADER]).toBe('0612345679');
    expect(appels[1][1].headers[SUIVI_TEL_HEADER]).toBe('+33612345679');
    expect(appels[2][1].headers[SUIVI_TEL_HEADER]).toBeUndefined();
    expect(appels[3][1].headers[SUIVI_TEL_HEADER]).toBeUndefined();
    expect(appels[4][1].headers[SUIVI_TEL_HEADER]).toBe('0612345679');
    for (const [url] of appels) expect(url).not.toMatch(/[?&]tel=/);
  });

  it('403 preuve_requise avec le numéro en en-tête : aucun repli « ?tel= », l’erreur remonte (K)', async () => {
    global.fetch.mockResolvedValue(refusServeur('preuve_requise'));
    const err = await client.getTicketByCode('KP-000005', { tel: TEL }).catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.code).toBe('preuve_requise');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // Les lectures suivantes gardent le numéro dans l'en-tête, jamais dans l'adresse
    global.fetch.mockResolvedValue(reponse({ ok: true }));
    await client.getPublicCommandes('KP-000005', { tel: TEL });
    await client.getFideliteByTicket('KP-000005', { tel: TEL });
    await client.getGrattage('KP-000005', { tel: TEL });
    await client.suiviHasAvis('KP-000005', { tel: TEL });
    const suivants = global.fetch.mock.calls.slice(1);
    expect(suivants.map((c) => c[0])).toEqual([
      '/api/parts/public/KP-000005', '/api/fidelite/ticket/KP-000005',
      '/api/fidelite/grattage/KP-000005', '/api/suivi/KP-000005/has-avis',
    ]);
    for (const [, init] of suivants) expect(init.headers[SUIVI_TEL_HEADER]).toBe('0612345679');
    // Le jeton, lui, reste dans l'adresse (c'est le lien)
    await client.suiviHasAvis('KP-000005', { t: JETON });
    expect(global.fetch.mock.calls.at(-1)[0]).toBe(`/api/suivi/KP-000005/has-avis?t=${JETON}`);
  });

  it('numéro refusé (403 verification_echouee) : aucun repli, l’erreur remonte avec son code', async () => {
    global.fetch.mockResolvedValue(refusServeur('verification_echouee'));
    const err = await client.getTicketByCode('KP-000005', { tel: TEL }).catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.code).toBe('verification_echouee');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('/api/tickets/code/KP-000005');
  });

  it('écritures : la preuve est dans le corps, jamais dans l’URL', async () => {
    global.fetch.mockResolvedValue(reponse({ ok: true }));
    await client.suiviSendMessage('KP-000005', 'Bonjour', { tel: TEL });
    await client.gratter('KP-000005', { tel: TEL });
    const appels = global.fetch.mock.calls;
    expect(appels[0][0]).toBe('/api/suivi/KP-000005/message');
    expect(JSON.parse(appels[0][1].body)).toEqual({ message: 'Bonjour', tel: '0612345679' });
    expect(appels[1][0]).toBe('/api/fidelite/grattage/KP-000005');
    expect(JSON.parse(appels[1][1].body)).toEqual({ tel: '0612345679' });
  });
});

describe('SuiviPage — formulaire à deux champs', () => {
  it('deux champs obligatoires, un seul bouton, texte d’aide, accessibilité', () => {
    monter();
    const code = champCode();
    const tel = champTel();
    expect(code).toHaveAttribute('autocomplete', 'off');
    expect(tel).toHaveAttribute('type', 'tel');
    expect(tel).toHaveAttribute('autocomplete', 'tel');
    expect(tel).toHaveAttribute('inputmode', 'tel');
    expect(tel.getAttribute('aria-describedby')).toContain('suivi-aide');
    expect(screen.getByText(TEXTES.aide)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Voir mon suivi|Rechercher/ })).toHaveLength(1);
    expect(bouton()).toHaveClass('min-h-14');
    // Plus de recherche par téléphone seul ni de champ « 4 derniers chiffres »
    expect(screen.queryByPlaceholderText(/ou 06/)).toBeNull();
    expect(screen.queryByLabelText(/4 derniers chiffres/)).toBeNull();
  });

  it('champ manquant : erreurs liées aux champs (aria-describedby), aucun appel', () => {
    monter();
    soumettre('KP-000005', '');
    expect(screen.getByText(TEXTES.telIncomplet)).toHaveAttribute('id', 'suivi-tel-erreur');
    expect(champTel()).toHaveAttribute('aria-invalid', 'true');
    expect(champTel().getAttribute('aria-describedby')).toContain('suivi-tel-erreur');
    expect(apiMock.getTicketByCode).not.toHaveBeenCalled();
    soumettre('', TEL);
    expect(screen.getByText(TEXTES.codeInvalide)).toHaveAttribute('id', 'suivi-code-erreur');
    expect(champCode()).toHaveAttribute('aria-invalid', 'true');
    expect(apiMock.getTicketByCode).not.toHaveBeenCalled();
  });

  it('code + téléphone : fiche demandée avec { tel }, preuve jointe à tous les appels et mémorisée', async () => {
    monter();
    soumettre(' kp 5 ', TEL); // minuscules / espaces tolérés → KP-000005
    expect(await screen.findByRole('heading', { name: 'KP-000005' })).toBeInTheDocument();
    const preuve = { tel: TEL };
    expect(apiMock.getTicketByCode).toHaveBeenCalledWith('KP-000005', preuve);
    expect(apiMock.getPublicCommandes).toHaveBeenCalledWith('KP-000005', preuve);
    expect(apiMock.suiviHasAvis).toHaveBeenCalledWith('KP-000005', preuve);
    await waitFor(() => expect(fidelite).toHaveBeenCalled());
    expect(fidelite.mock.calls.at(-1)[0]).toMatchObject({ ticketCode: 'KP-000005', preuve });
    expect(grattage.mock.calls.at(-1)[0]).toMatchObject({ ticketCode: 'KP-000005', preuve });
    expect(lirePreuve('KP-000005')).toEqual(preuve);
    // Le formulaire laisse la place à la fiche ; le téléphone saisi n'est pas conservé à l'écran
    expect(screen.queryByLabelText('Numéro de téléphone')).toBeNull();
  });

  it('message envoyé, devis validé et avis déposé avec la preuve ; rechargement du devis avec la preuve', async () => {
    apiMock.getTicketByCode.mockResolvedValue(ticket({
      statut: "En attente d'accord client", reparation_supp: JSON.stringify([{ label: 'Écran', prix: 120 }]),
    }));
    monter();
    soumettre('KP-000005', TEL);
    await screen.findByRole('heading', { name: 'KP-000005' });
    fireEvent.change(screen.getByLabelText("Votre message à l'équipe"), { target: { value: 'Bonjour' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le message' }));
    await waitFor(() => expect(apiMock.suiviSendMessage).toHaveBeenCalledWith('KP-000005', 'Bonjour', { tel: TEL }));
    apiMock.getTicketByCode.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /J'accepte/ }));
    await waitFor(() => expect(apiMock.suiviValiderDevis).toHaveBeenCalledWith('KP-000005', true, { tel: TEL }));
    await waitFor(() => expect(apiMock.getTicketByCode).toHaveBeenCalledWith('KP-000005', { tel: TEL }));
  });

  it('avis déposé avec la preuve', async () => {
    apiMock.getTicketByCode.mockResolvedValue(ticket({ statut: 'Rendu au client' }));
    monter();
    soumettre('KP-000005', TEL);
    await screen.findByRole('heading', { name: 'KP-000005' });
    fireEvent.click(screen.getByRole('button', { name: '5 étoiles sur 5' }));
    fireEvent.click(screen.getByRole('button', { name: /Envoyer mon avis/ }));
    await waitFor(() => expect(apiMock.suiviLaisserAvis).toHaveBeenCalledWith('KP-000005', 5, '', { tel: TEL }));
    expect(await screen.findByText('Merci pour votre avis !')).toBeInTheDocument();
  });
});

describe('SuiviPage — erreurs du serveur', () => {
  it('mauvais numéro OU code inconnu (403 verification_echouee, sans oracle) : message clair, téléphone aria-invalid, formulaire conservé, preuve oubliée', async () => {
    apiMock.getTicketByCode.mockRejectedValue(refus(403, 'verification_echouee'));
    monter();
    soumettre('KP-000005', '06 00 00 00 00');
    const alerte = await screen.findByRole('alert');
    // Sans personnel connecté, le serveur répond pareil pour un code inexistant et un mauvais
    // numéro : le message couvre les deux (constat B)
    expect(alerte).toHaveTextContent(
      'Ticket introuvable ou numéro incorrect : vérifiez le numéro de ticket et le téléphone donné au dépôt',
    );
    expect(alerte).toHaveTextContent(TEXTES.mauvaisNumero);
    expect(alerte).toHaveAttribute('id', 'suivi-erreur');
    expect(champTel().getAttribute('aria-describedby')).toContain('suivi-erreur');
    // Le serveur a refusé le numéro saisi : le champ est annoncé invalide, jusqu'à la prochaine saisie
    expect(champTel()).toHaveAttribute('aria-invalid', 'true');
    expect(champCode()).not.toHaveAttribute('aria-invalid');
    expect(champCode()).toHaveValue('KP-000005');
    expect(lirePreuve('KP-000005')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'KP-000005' })).toBeNull();
    fireEvent.change(champTel(), { target: { value: '06 12' } });
    expect(champTel()).not.toHaveAttribute('aria-invalid');
  });

  it('trop d’essais (429) : message d’attente avec Retry-After, téléphone non marqué invalide', async () => {
    apiMock.getTicketByCode.mockRejectedValue(refus(429, null, { retryAfter: 600 }));
    monter();
    soumettre('KP-000005', TEL);
    expect(await screen.findByRole('alert')).toHaveTextContent('Trop de tentatives. Réessayez dans 10 minutes.');
    expect(champTel()).not.toHaveAttribute('aria-invalid');
  });

  it('ticket inconnu (404) et code seul refusé (403 preuve_requise)', async () => {
    apiMock.getTicketByCode.mockRejectedValueOnce(refus(404));
    monter();
    soumettre('KP-000005', TEL);
    expect(await screen.findByRole('alert')).toHaveTextContent(TEXTES.introuvable);
    apiMock.getTicketByCode.mockRejectedValueOnce(refus(403, 'preuve_requise'));
    fireEvent.click(bouton());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(TEXTES.preuveRequise));
  });

  it('preuve refusée pendant une action : retour au formulaire, code prérempli, téléphone en focus', async () => {
    monter();
    soumettre('KP-000005', TEL);
    await screen.findByRole('heading', { name: 'KP-000005' });
    apiMock.suiviSendMessage.mockRejectedValue(refus(403, 'verification_echouee'));
    fireEvent.change(screen.getByLabelText("Votre message à l'équipe"), { target: { value: 'Bonjour' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le message' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(TEXTES.mauvaisNumero);
    expect(champCode()).toHaveValue('KP-000005');
    expect(champTel()).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(document.activeElement).toBe(champTel()));
    expect(lirePreuve('KP-000005')).toBeNull();
  });
});

describe('SuiviPage — liens et QR', () => {
  it('lien avec jeton : ouverture directe sans rien demander, preuve { t } partout, mémorisée', async () => {
    monter(`/suivi?t=${JETON}&ticket=KP-000005`);
    expect(screen.queryByLabelText('Numéro de téléphone')).toBeNull();
    expect(await screen.findByRole('heading', { name: 'KP-000005' })).toBeInTheDocument();
    expect(apiMock.getTicketByCode).toHaveBeenCalledWith('KP-000005', { t: JETON });
    expect(apiMock.getPublicCommandes).toHaveBeenCalledWith('KP-000005', { t: JETON });
    expect(apiMock.suiviHasAvis).toHaveBeenCalledWith('KP-000005', { t: JETON });
    expect(lirePreuve('KP-000005')).toEqual({ t: JETON });
  });

  it('jeton refusé (403 lien_invalide) : formulaire avec le code prérempli, téléphone en focus, message clair', async () => {
    apiMock.getTicketByCode.mockRejectedValueOnce(refus(403, 'lien_invalide'));
    monter(`/suivi?t=MauvaisJeton_012345678&ticket=KP-000005`);
    expect(await screen.findByRole('alert')).toHaveTextContent(TEXTES.lienInvalide);
    expect(champCode()).toHaveValue('KP-000005');
    await waitFor(() => expect(document.activeElement).toBe(champTel()));
    // Rien n'a été saisi : le champ n'est pas « invalide », l'erreur lui est liée par aria-describedby
    expect(champTel()).not.toHaveAttribute('aria-invalid');
    expect(champTel().getAttribute('aria-describedby')).toContain('suivi-erreur');
    // Le téléphone complet ouvre ensuite la fiche
    soumettre(null, TEL);
    expect(await screen.findByRole('heading', { name: 'KP-000005' })).toBeInTheDocument();
    expect(apiMock.getTicketByCode).toHaveBeenLastCalledWith('KP-000005', { tel: TEL });
  });

  it('ancien lien / douchette (?ticket= sans jeton) : rien n’est chargé, code prérempli, focus téléphone', async () => {
    monter('/suivi?ticket=kp5');
    expect(champCode()).toHaveValue('KP-000005');
    await waitFor(() => expect(document.activeElement).toBe(champTel()));
    expect(apiMock.getTicketByCode).not.toHaveBeenCalled();
  });

  it('rechargement de l’onglet (?ticket= sans jeton) : la preuve mémorisée rouvre la fiche', async () => {
    sessionStorage.setItem('kp_suivi_preuve:KP-000005', JSON.stringify({ tel: TEL }));
    monter('/suivi?ticket=KP-000005');
    expect(await screen.findByRole('heading', { name: 'KP-000005' })).toBeInTheDocument();
    expect(apiMock.getTicketByCode).toHaveBeenCalledWith('KP-000005', { tel: TEL });
  });

  it('polling : la preuve est jointe au rafraîchissement', async () => {
    vi.useFakeTimers();
    try {
      monter(`/suivi?t=${JETON}&ticket=KP-000005`);
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByRole('heading', { name: 'KP-000005' })).toBeInTheDocument();
      apiMock.getTicketByCode.mockClear();
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(apiMock.getTicketByCode).toHaveBeenCalledWith('KP-000005', { t: JETON });
    } finally {
      vi.useRealTimers();
    }
  });

  it('QR intelligent : le personnel connecté est renvoyé sur la fiche interne, sans preuve', async () => {
    auth.user = { target: 'tech', utilisateur: 'Karim' };
    monter('/suivi?ticket=KP-000005');
    expect(await screen.findByTestId('ou')).toHaveTextContent('/tech/ticket/5');
    expect(apiMock.getTicketByCode).toHaveBeenCalledWith('KP-000005', null);
  });
});
