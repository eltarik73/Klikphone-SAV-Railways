/**
 * SMS Brevo : estimation des crédits (miroir du serveur), envoi serveur, repli sur le lien sms:
 * quand l'envoi serveur est désactivé, erreurs lisibles.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api } from '../lib/api';
import { envoyerSms, estGsm, messageSmsEnvoye, normaliserSms, smsSegments } from '../lib/sms';

const jsonRes = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: () => Promise.resolve(data),
});

beforeEach(() => {
  api.setToken('session');
  api._cache.clear();
  window.open = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('smsSegments (mêmes règles que services/sms.py)', () => {
  it('alphabet GSM : 160 caractères par SMS, 153 au-delà', () => {
    expect(smsSegments('')).toEqual({ segments: 0, unicode: false, caracteres: 0 });
    expect(smsSegments('a'.repeat(160)).segments).toBe(1);
    expect(smsSegments('a'.repeat(161)).segments).toBe(2);
    expect(smsSegments('a'.repeat(306)).segments).toBe(2);
    expect(smsSegments('a'.repeat(307)).segments).toBe(3);
    expect(smsSegments('é'.repeat(160))).toEqual({ segments: 1, unicode: false, caracteres: 160 });
  });

  it('extension GSM (€, [, ]…) compte double', () => {
    expect(smsSegments('€'.repeat(80)).segments).toBe(1);
    expect(smsSegments('€'.repeat(81)).segments).toBe(2);
  });

  it('accents hors GSM ou emojis : Unicode, 70 puis 67 caractères par SMS', () => {
    expect(smsSegments('ê'.repeat(70))).toEqual({ segments: 1, unicode: true, caracteres: 70 });
    expect(smsSegments('ê'.repeat(71)).segments).toBe(2);
    expect(smsSegments('📱'.repeat(35)).segments).toBe(1);
    expect(smsSegments('📱'.repeat(36)).segments).toBe(2);
  });

  it('ponctuation typographique ramenée à l’ASCII avant le calcul', () => {
    expect(normaliserSms('  L’appareil « prêt » — merci…\r\n ')).toBe('L\'appareil " prêt " - merci...');
    expect(estGsm('C’est réparé')).toBe(false);
    expect(smsSegments('C’est réparé à 19h').unicode).toBe(false);
  });
});

describe('messageSmsEnvoye', () => {
  it('destinataire et nombre de SMS', () => {
    expect(messageSmsEnvoye({ segments: 1, destinataire: '06 12 34 56 78' })).toBe('SMS envoyé au 06 12 34 56 78');
    expect(messageSmsEnvoye({ segments: 3, destinataire: '06 12 34 56 78' })).toBe('SMS envoyé au 06 12 34 56 78 (3 SMS)');
    expect(messageSmsEnvoye({})).toBe('SMS envoyé');
  });
});

describe('envoyerSms', () => {
  it('envoi serveur désactivé : lien sms: ouvert tout de suite, aucun appel API', async () => {
    global.fetch = vi.fn();
    const res = await envoyerSms({ serveur: false, ticketId: 42, tel: '06 12 34 56 78', message: 'Bonjour Jean' });
    expect(res).toEqual({ mode: 'lien' });
    expect(window.open).toHaveBeenCalledWith('sms:0612345678?body=Bonjour%20Jean', '_blank');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sans ticket (commande isolée) : lien sms: même si le serveur est actif', async () => {
    global.fetch = vi.fn();
    const res = await envoyerSms({ serveur: true, ticketId: null, tel: '0612345678', message: 'x' });
    expect(res.mode).toBe('lien');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('envoi serveur : POST JSON, pas de fenêtre ouverte', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonRes({
      ok: true, message_id: '15118829', segments: 2, destinataire: '06 12 34 56 78',
    }));
    const res = await envoyerSms({ serveur: true, ticketId: 42, tel: '0612345678', message: 'Votre iPhone est prêt', libelle: 'Appareil prêt' });
    expect(res).toMatchObject({ mode: 'serveur', segments: 2, destinataire: '06 12 34 56 78' });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/notifications/sms');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ ticket_id: 42, message: 'Votre iPhone est prêt', libelle: 'Appareil prêt' });
    expect(opts.headers.Authorization).toBe('Bearer session');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('serveur non configuré (409 sms_non_configure) : repli sur le lien renvoyé', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jsonRes({ detail: {
        code: 'sms_non_configure', message: 'Clé API Brevo absente du serveur', link: 'sms:0612345678?body=Bonjour',
      } }, 409))
      .mockResolvedValue(jsonRes({ cle_configuree: false, active: true, disponible: false, expediteur: 'KLIKPHONE' }));
    const res = await envoyerSms({ serveur: true, ticketId: 42, tel: '0612345678', message: 'Bonjour' });
    expect(res).toEqual({ mode: 'lien', repli: true });
    expect(window.open).toHaveBeenCalledWith('sms:0612345678?body=Bonjour', '_blank');
  });

  it.each([
    [424, { code: 'credits_epuises', message: 'Crédits SMS Brevo épuisés : rechargez le compte Brevo' }],
    [409, { code: 'sms_doublon', message: 'Ce SMS vient déjà d’être envoyé à ce numéro (il y a 12 s)' }],
    [400, { code: 'numero_fixe', message: 'Le 04 79 60 89 22 n’est pas un portable (06 ou 07) : SMS impossible' }],
  ])('refus %i : erreur lisible levée, pas de lien ouvert', async (status, detail) => {
    global.fetch = vi.fn().mockResolvedValue(jsonRes({ detail }, status));
    const err = await envoyerSms({ serveur: true, ticketId: 42, tel: '0612345678', message: 'x' })
      .then(() => null, (e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(detail.message);
    expect(err).toMatchObject({ status, code: detail.code });
    expect(window.open).not.toHaveBeenCalled();
  });
});

describe('ApiClient : état et solde', () => {
  it('getSmsEtat est mis en cache 60 s, fresh revalide', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonRes({ cle_configuree: true, active: true, disponible: true, expediteur: 'KLIKPHONE' }));
    await api.getSmsEtat();
    await api.getSmsEtat();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await api.getSmsEtat({ fresh: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toBe('/api/notifications/sms/etat');
  });

  it('getSmsCredits ne relance pas en cas d’erreur', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonRes({ detail: { code: 'brevo_indisponible', message: 'Brevo est indisponible' } }, 424));
    const err = await api.getSmsCredits().then(() => null, (e) => e);
    expect(err.message).toBe('Brevo est indisponible');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
