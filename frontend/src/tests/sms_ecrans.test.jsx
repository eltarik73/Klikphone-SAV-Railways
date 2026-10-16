/**
 * SMS Brevo dans les écrans : le bouton SMS de MessageComposer envoie par le serveur quand
 * c'est activé (toast, pas de double note), garde le lien sms: sinon ; réglages Brevo de la
 * configuration (clé absente, interrupteur, solde de crédits).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

const { auth, toast, apiMock } = vi.hoisted(() => ({
  auth: { user: { target: 'accueil', utilisateur: 'Sophie' } },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  apiMock: {
    getMessageTemplates: vi.fn(),
    getConfig: vi.fn(),
    getCached: vi.fn(),
    getSmsEtat: vi.fn(),
    getSmsCredits: vi.fn(),
    envoyerSms: vi.fn(),
    logMessage: vi.fn(),
    addPrivateNote: vi.fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../components/Toast', () => ({ useToast: () => toast }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import MessageComposer from '../components/MessageComposer';
import SmsBrevoConfig from '../components/SmsBrevoConfig';

const TICKET = {
  id: 42, ticket_code: 'KP-000042', client_prenom: 'Jean', client_nom: 'Fictif',
  client_tel: '06 12 34 56 78', marque: 'Apple', modele: 'iPhone 13', paye: false,
};
const ETAT_ACTIF = { cle_configuree: true, active: true, disponible: true, expediteur: 'KLIKPHONE' };

beforeEach(() => {
  vi.clearAllMocks();
  window.open = vi.fn();
  apiMock.getMessageTemplates.mockResolvedValue([]);
  apiMock.getConfig.mockResolvedValue([]);
  apiMock.getCached.mockResolvedValue([]);
  apiMock.logMessage.mockResolvedValue({ id: 1 });
});

afterEach(() => cleanup());

async function envoyerSmsDepuisComposer(onMessageSent = vi.fn()) {
  render(<MessageComposer ticket={TICKET} onMessageSent={onMessageSent} />);
  // L'état de l'envoi serveur arrive avant le clic
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  fireEvent.click(screen.getByRole('button', { name: /Personnalis/ }));
  fireEvent.change(screen.getByPlaceholderText('Tapez votre message...'), { target: { value: 'Votre iPhone est prêt' } });
  fireEvent.click(screen.getByRole('button', { name: /^SMS$/ }));
  return onMessageSent;
}

describe('MessageComposer : bouton SMS', () => {
  it('envoi serveur activé : POST Brevo, toast « SMS envoyé », pas de logMessage', async () => {
    apiMock.getSmsEtat.mockResolvedValue(ETAT_ACTIF);
    apiMock.envoyerSms.mockResolvedValue({ ok: true, segments: 1, destinataire: '06 12 34 56 78' });
    const onMessageSent = await envoyerSmsDepuisComposer();
    await waitFor(() => expect(apiMock.envoyerSms).toHaveBeenCalled());
    const [ticketId, message] = apiMock.envoyerSms.mock.calls[0];
    expect(ticketId).toBe(42);
    expect(message).toContain('Votre iPhone est prêt');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('SMS envoyé au 06 12 34 56 78'));
    expect(apiMock.logMessage).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    expect(onMessageSent).toHaveBeenCalled();
  });

  it('envoi serveur désactivé : lien sms: et journal comme avant', async () => {
    apiMock.getSmsEtat.mockResolvedValue({ ...ETAT_ACTIF, active: false, disponible: false });
    await envoyerSmsDepuisComposer();
    await waitFor(() => expect(apiMock.logMessage).toHaveBeenCalled());
    expect(window.open).toHaveBeenCalledWith(expect.stringMatching(/^sms:0612345678\?body=Votre%20iPhone/), '_blank');
    expect(apiMock.envoyerSms).not.toHaveBeenCalled();
    expect(apiMock.logMessage.mock.calls[0][3]).toBe('sms');
  });

  it.each([
    ['rejet', () => apiMock.getSmsEtat.mockRejectedValue(new Error('réseau'))],
    ['erreur synchrone', () => apiMock.getSmsEtat.mockImplementation(() => { throw new TypeError('absent'); })],
  ])('état illisible (%s) : repli sur le lien sms:', async (_, panne) => {
    panne();
    await envoyerSmsDepuisComposer();
    await waitFor(() => expect(window.open).toHaveBeenCalled());
    expect(apiMock.envoyerSms).not.toHaveBeenCalled();
  });

  it('refus de Brevo : message lisible, notes rafraîchies, pas de journal', async () => {
    apiMock.getSmsEtat.mockResolvedValue(ETAT_ACTIF);
    const err = Object.assign(new Error('Crédits SMS Brevo épuisés : rechargez le compte Brevo'), { status: 424, code: 'credits_epuises' });
    apiMock.envoyerSms.mockRejectedValue(err);
    const onMessageSent = await envoyerSmsDepuisComposer();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Crédits SMS Brevo épuisés : rechargez le compte Brevo'));
    expect(onMessageSent).toHaveBeenCalled();
    expect(apiMock.logMessage).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('SmsBrevoConfig', () => {
  const props = (config = {}) => ({ config, updateConfig: vi.fn(), saveParamNow: vi.fn().mockResolvedValue(undefined) });

  it('clé absente : consigne Railway, interrupteur bloqué, jamais de lecture du solde', async () => {
    apiMock.getSmsEtat.mockResolvedValue({ cle_configuree: false, active: false, disponible: false, expediteur: 'KLIKPHONE' });
    render(<SmsBrevoConfig {...props()} />);
    expect(await screen.findByText(/Clé API Brevo absente du serveur/)).toBeInTheDocument();
    expect(screen.getByText('BREVO_API_KEY')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Envoyer les SMS depuis le serveur/ })).toBeDisabled();
    expect(apiMock.getSmsCredits).not.toHaveBeenCalled();
  });

  it('clé présente : solde affiché, interrupteur enregistré tout de suite', async () => {
    apiMock.getSmsEtat.mockResolvedValue({ cle_configuree: true, active: false, disponible: false, expediteur: 'KLIKPHONE' });
    apiMock.getSmsCredits.mockResolvedValue({ credits: 42.5 });
    const p = props({ SMS_BREVO_ACTIF: '0' });
    render(<SmsBrevoConfig {...p} />);
    expect(await screen.findByText('42,5 crédits')).toBeInTheDocument();
    expect(screen.getByText(/Clé API Brevo présente/)).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: /Envoyer les SMS depuis le serveur/ });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    await waitFor(() => expect(p.saveParamNow).toHaveBeenCalledWith('SMS_BREVO_ACTIF', '1', expect.any(String)));
    await waitFor(() => expect(apiMock.getSmsEtat).toHaveBeenCalledTimes(2));
  });

  it('expéditeur : lettres et chiffres seulement, 11 au plus', async () => {
    apiMock.getSmsEtat.mockResolvedValue({ cle_configuree: true, active: true, disponible: true, expediteur: 'KLIKPHONE' });
    apiMock.getSmsCredits.mockResolvedValue({ credits: 3 });
    const p = props({ SMS_SENDER: '' });
    render(<SmsBrevoConfig {...p} />);
    await screen.findByText('3 crédits');
    fireEvent.change(screen.getByLabelText('Expéditeur'), { target: { value: 'Klik Phoné SAV 73' } });
    expect(p.updateConfig).toHaveBeenCalledWith('SMS_SENDER', 'KlikPhonSAV');
  });

  it('solde illisible : message d’erreur et bouton Actualiser', async () => {
    apiMock.getSmsEtat.mockResolvedValue({ cle_configuree: true, active: true, disponible: true, expediteur: 'KLIKPHONE' });
    apiMock.getSmsCredits
      .mockRejectedValueOnce(new Error('Clé API Brevo refusée (invalide ou désactivée)'))
      .mockResolvedValueOnce({ credits: 12 });
    render(<SmsBrevoConfig {...props()} />);
    expect(await screen.findByText(/Clé API Brevo refusée/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
    expect(await screen.findByText('12 crédits')).toBeInTheDocument();
  });
});
