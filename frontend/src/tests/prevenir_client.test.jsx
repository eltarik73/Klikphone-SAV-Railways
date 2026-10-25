/**
 * « Prévenir le client » au scan comptoir : rendu du message « appareil prêt » (variables
 * partagées avec MessageComposer), choix du canal (portable → SMS, sinon e-mail), « déjà
 * prévenu » d'après les notes, enchaînement « Terminé + prévenir le client » (statut puis SMS
 * serveur ; SMS serveur inactif → carte avec le bouton SMS, sans window.open après un await).
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
    addPrivateNote: vi.fn(),
    addHistory: vi.fn(),
    restitution: vi.fn(),
    setPaye: vi.fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { ToastProvider } from '../components/Toast';
import { clearCache } from '../hooks/useApi';
import { takePendingScan } from '../components/ScanListener';
import QuickScanPanel, { indicationPrevenir, libelleDiffere, actionsTicket } from '../components/QuickScanPanel';
import MessageComposer from '../components/MessageComposer';
import {
  contexteMessage, remplirModele, remplirMessage, sansPhraseMontant, ajouterLienSuivi, messagePret, modelePret,
  DEFAULT_TEMPLATES, numeroSms, canalPrevenir, raisonSansCanal, emailValide, dernierAvisPret, texteDejaPrevenu,
  texteEchecSms, formatQuand, estAvisPret, ligneJournal, erreurEnvoi,
} from '../lib/messages';

const MONTANTS = { total: 89, acompte: 10, reste: 79, paye: false, lignes: [{ label: 'Écran', prix: 89 }] };
const ETAT_ACTIF = { cle_configuree: true, active: true, disponible: true, expediteur: 'KLIKPHONE' };
const SMS_PRET = 'Bonjour Léa, votre Apple iPhone 13 est pret! Vous pouvez venir le recuperer a la boutique. '
  + 'Montant : 79.00 EUR. Klikphone 79 Place Saint Leger, Chambery';

function ticket(overrides = {}) {
  return {
    id: 42, ticket_code: 'KP-000042', statut: 'En cours de réparation', client_id: 5,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '06 12 34 56 78', client_email: 'lea@example.test',
    marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé', date_depot: '2026-10-10T09:00:00',
    paye: 0, acompte: 10, devis_estime: 200, telephone_pret: '', telephone_pret_rendu: false,
    montants: MONTANTS, ...overrides,
  };
}

// Horodatage du serveur pour une heure locale donnée (16/10 à hh:mm sur le poste)
const leSeize = (h, min) => new Date(2026, 9, 16, h, min).toISOString();

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
  return render(<MemoryRouter initialEntries={['/tech']}><ToastProvider><QuickScanPanel /></ToastProvider></MemoryRouter>);
}

function scanner(code = 'KP-000042') {
  act(() => {
    window.dispatchEvent(new CustomEvent(SCAN_EVENT, { detail: { kind: 'ticket', code, query: code, label: code } }));
  });
}

async function terminerEtPrevenir(nom = /Terminé \+ prévenir le client/) {
  renderPanel();
  scanner();
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(await within(dialog).findByRole('button', { name: nom }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Valider maintenant' }));
  await waitFor(() => expect(apiMock.changeStatus).toHaveBeenCalledWith(42, 'Réparation terminée'));
  return dialog;
}

let open;
beforeEach(() => {
  auth.user = { target: 'tech', utilisateur: 'Karim' };
  open = vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Message « appareil prêt » ───────────────────────────────────────────────

describe('rendu du modèle : variables partagées avec MessageComposer', () => {
  it('remplace toutes les variables, montant du serveur, lien de suivi et d’avis', () => {
    const ctx = contexteMessage(ticket({ modele_autre: '' }), { lienAvis: 'https://avis.test/klik', origin: 'https://sav.test' });
    const texte = remplirModele(
      '{prenom} {nom} | {appareil} | {marque} {modele} | {code} | {montant} | {tel_boutique} | {adresse} | {horaires} | {lien_avis} | {lien_suivi} | {inconnu}',
      ctx.vars,
    );
    expect(texte).toBe('Léa Martin | Apple iPhone 13 | Apple iPhone 13 | KP-000042 | 79.00 | 04 79 60 89 22 | '
      + '79 Place Saint Leger, 73000 Chambery | Lundi-Samedi 10h-19h | https://avis.test/klik | '
      + 'https://sav.test/suivi?ticket=KP-000042 | {inconnu}');
    expect(ctx.totalTicket).toBe(89);
    // Fiche avec son jeton de suivi : le lien ouvre le suivi sans redemander le téléphone (jeton d'abord, code en fin)
    const avecJeton = contexteMessage(ticket({ suivi_token: 'Jeton_Fiche-0123456789' }), { origin: 'https://sav.test' });
    expect(avecJeton.vars.lien_suivi).toBe('https://sav.test/suivi?t=Jeton_Fiche-0123456789&ticket=KP-000042');
  });

  it('sans montants du serveur : lignes − réduction − acompte ; « $ » d’un prénom laissé tel quel', () => {
    const t = ticket({
      montants: null, client_prenom: 'A$&B', reparation_supp: JSON.stringify([{ label: 'Écran', prix: 100 }, { label: 'Vitre', prix: 20 }]),
      reduction_pourcentage: 10, acompte: 8,
    });
    const ctx = contexteMessage(t);
    expect(ctx.montant).toBe(100);
    expect(ctx.totalTicket).toBe(108);
    expect(remplirModele('{prenom} {montant}', ctx.vars)).toBe('A$&B 100.00');
    expect(ajouterLienSuivi('Coucou', t, ctx.suiviUrl)).toBe('Coucou\n\n📱 Suivez votre réparation : http://localhost:3000/suivi?ticket=KP-000042');
    expect(ajouterLienSuivi(`Voir ${ctx.suiviUrl}`, t, ctx.suiviUrl)).toBe(`Voir ${ctx.suiviUrl}`);
    expect(ligneJournal('Appareil pret', 'x'.repeat(130))).toBe(`[Appareil pret] ${'x'.repeat(120)}...`);
  });

  it('modèle « prêt » de la boutique, sinon celui par défaut ; version SMS sans lien', () => {
    expect(modelePret([]).id).toBe(6);
    expect(modelePret([{ id: 30, label: 'Avis', message: 'Laissez un avis' }]).label).toBe('Appareil pret');
    expect(modelePret([{ id: 40, label: 'Appareil prêt à récupérer', message: 'Hello {prenom}' }]).id).toBe(40);

    const m = messagePret(DEFAULT_TEMPLATES, ticket());
    expect(m.libelle).toBe('Appareil pret');
    expect(m.sms).toBe(SMS_PRET);
    expect(m.sms).not.toMatch(/suivi/);
    expect(m.segments).toMatchObject({ segments: 1, unicode: false });
    expect(m.texte).toContain('est pret ! Vous pouvez venir');
    expect(m.texte).toContain('/suivi?ticket=KP-000042');
    expect(m.montantRetire).toBe(false);
  });

  it('montant à 0 € (non payé) : la phrase du montant est retirée, le message part quand même', () => {
    const zero = messagePret(DEFAULT_TEMPLATES, ticket({ montants: { ...MONTANTS, total: 0, reste: 0 } }));
    expect(zero.montantRetire).toBe(true);
    expect(zero.sms).toBe('Bonjour Léa, votre Apple iPhone 13 est pret! Vous pouvez venir le recuperer a la boutique. Klikphone 79 Place Saint Leger, Chambery');
    expect(zero.texte).not.toMatch(/Montant|0\.00/);
    expect(zero.texte).toContain('/suivi?ticket=KP-000042');
    // Acompte qui couvre tout : reste à 0 €, même règle
    expect(messagePret(DEFAULT_TEMPLATES, ticket({ montants: { ...MONTANTS, acompte: 89, reste: 0 } })).montantRetire).toBe(true);
    // Payé : « Montant : 0.00 EUR » est juste, la phrase reste
    const paye = messagePret(DEFAULT_TEMPLATES, ticket({ paye: 1, montants: { ...MONTANTS, total: 0, reste: 0 } }));
    expect(paye.montantRetire).toBe(false);
    expect(paye.sms).toContain('Montant : 0.00 EUR');
    // Modèle sans {montant} : rien à retirer
    expect(messagePret([{ id: 6, label: 'Appareil pret', message: 'Bonjour {prenom}, c’est prêt' }], ticket({ montants: { ...MONTANTS, total: 0, reste: 0 } })))
      .toMatchObject({ montantRetire: false, sms: 'Bonjour Léa, c\'est pret' });
  });

  it('découpe en phrases (. ! ? et retours à la ligne) : seule la phrase du montant disparaît', () => {
    const ctx = contexteMessage(ticket({ montants: { ...MONTANTS, total: 0, reste: 0 } }));
    const r = (modele) => remplirMessage(modele, ctx);
    expect(r('Bonjour {prenom}, le devis pour votre {appareil} est de {montant} EUR. Merci de nous confirmer votre accord. Klikphone'))
      .toEqual({ texte: 'Merci de nous confirmer votre accord. Klikphone', montantRetire: true });
    expect(r('Bonjour {prenom}.\nMontant : {montant} €\nÀ bientôt !')).toEqual({ texte: 'Bonjour Léa.\nÀ bientôt !', montantRetire: true });
    expect(r('C’est prêt ! Montant à régler : {montant} € ? Klikphone')).toEqual({ texte: 'C’est prêt ! Klikphone', montantRetire: true });
    expect(sansPhraseMontant('Prêt. Montant : {montant} €. Merci')).toBe('Prêt. Merci');
    // Une seule phrase : rien ne serait envoyé, le modèle est gardé tel quel (montant à 0.00)
    expect(r('Coucou {prenom}, c’est prêt ({montant} €)')).toEqual({ texte: 'Coucou Léa, c’est prêt (0.00 €)', montantRetire: false });
    // Montant dû : rien n'est retiré ; remplirModele garde sa forme (texte seul)
    const du = contexteMessage(ticket());
    expect(remplirMessage('Montant : {montant} €. Merci', du)).toEqual({ texte: 'Montant : 79.00 €. Merci', montantRetire: false });
    expect(remplirModele('Montant : {montant} €', du.vars)).toBe('Montant : 79.00 €');
  });

  it('MessageComposer affiche le même texte qu’avant (substitution partagée)', async () => {
    resetApi();
    apiMock.getMessageTemplates.mockResolvedValue([
      { id: 6, label: 'Appareil pret', message: '{prenom} {nom} : {appareil} {code}, {montant} € — {lien_avis}' },
    ]);
    apiMock.getCached.mockResolvedValue([{ cle: 'GOOGLE_REVIEW_LINK', valeur: 'https://avis.test/x' }]);
    render(<ToastProvider><MessageComposer ticket={ticket()} statutPropose="Réparation terminée" integre /></ToastProvider>);
    expect(await screen.findByText(
      'Léa Martin : Apple iPhone 13 KP-000042, 79.00 € — https://avis.test/x 📱 Suivez votre réparation : http://localhost:3000/suivi?ticket=KP-000042',
      { normalizer: (s) => s.replace(/\s+/g, ' ').trim() },
    )).toBeInTheDocument();
  });
});

describe('choix du canal', () => {
  it('portable → SMS (06, 07, +33, 0033, étranger)', () => {
    expect(numeroSms('06 12 34 56 78')).toEqual({ portable: true, affichage: '06 12 34 56 78' });
    expect(numeroSms('+33 7 12 34 56 78')).toEqual({ portable: true, affichage: '07 12 34 56 78' });
    expect(numeroSms('0033612345678').portable).toBe(true);
    expect(numeroSms('+41 79 123 45 67')).toEqual({ portable: true, affichage: '+41791234567' });
    expect(canalPrevenir(ticket())).toBe('sms');
  });

  it('pas de portable + e-mail → e-mail ; rien → message clair', () => {
    expect(numeroSms('04 79 60 89 22')).toEqual({ portable: false, raison: 'le 04 79 60 89 22 n’est pas un portable' });
    expect(numeroSms('pas de tel').portable).toBe(false);
    expect(canalPrevenir(ticket({ client_tel: '04 79 60 89 22' }))).toBe('email');
    expect(canalPrevenir(ticket({ client_tel: '' }))).toBe('email');
    expect(canalPrevenir(ticket({ client_tel: '', client_email: 'lea@' }))).toBeNull();
    expect(emailValide(' lea@example.test ')).toBe(true);
    expect(raisonSansCanal(ticket({ client_tel: '', client_email: '' }))).toBe('ni portable ni e-mail sur la fiche');
    expect(raisonSansCanal(ticket({ client_tel: '04 79 60 89 22', client_email: '' })))
      .toBe('le 04 79 60 89 22 n’est pas un portable et aucun e-mail sur la fiche');
  });

  it('sous-titre du bouton et barre annulable', () => {
    expect(indicationPrevenir(ticket(), true)).toBe('SMS au 06 12 34 56 78');
    expect(indicationPrevenir(ticket(), false)).toBe('SMS au 06 12 34 56 78 · à valider dans Messages');
    expect(indicationPrevenir(ticket({ client_tel: '' }))).toBe('E-mail à lea@example.test');
    const [prevenir, seul] = actionsTicket(ticket(), 'tech');
    expect(prevenir).toMatchObject({ id: 'terminer', primary: true, prevenir: true, statut: 'Réparation terminée' });
    expect(seul).toMatchObject({ id: 'terminer_seul', sansPrevenir: true, statut: 'Réparation terminée' });
    expect(libelleDiffere(ticket(), prevenir)).toBe('« Réparation terminée » + SMS au client');
    expect(libelleDiffere(ticket(), { ...prevenir, manuel: true })).toBe('« Réparation terminée » puis SMS à envoyer depuis Messages');
    expect(libelleDiffere(ticket({ client_tel: '' }), prevenir)).toBe('« Réparation terminée » + e-mail au client');
    expect(libelleDiffere(ticket(), seul)).toBe('Passage en « Réparation terminée »');
    expect(actionsTicket(ticket(), 'accueil').map((a) => a.id)).toEqual(['terminer', 'terminer_seul', 'rendre']);
  });

  it('annoncé avant le clic : montant à 0 € (si le modèle cite {montant}), client non joignable', () => {
    const zero = ticket({ montants: { ...MONTANTS, total: 0, reste: 0 } });
    // Plus de blocage : le message part sans la phrase du montant, la mention le dit sous le bouton
    expect(indicationPrevenir(zero, true)).toBe('SMS au 06 12 34 56 78 · Montant à 0 € : phrase du montant retirée');
    expect(indicationPrevenir(zero, false)).toBe('SMS au 06 12 34 56 78 · à valider dans Messages · Montant à 0 € : phrase du montant retirée');
    expect(indicationPrevenir(ticket({ ...zero, client_tel: '' }), true)).toBe('E-mail à lea@example.test · Montant à 0 € : phrase du montant retirée');
    expect(indicationPrevenir(zero, true, [{ id: 6, label: 'Appareil pret', message: 'Bonjour {prenom}, c’est prêt' }]))
      .toBe('SMS au 06 12 34 56 78');

    const injoignable = ticket({ client_tel: '04 79 60 89 22', client_email: '' });
    expect(indicationPrevenir(injoignable)).toBe('Client non joignable : le 04 79 60 89 22 n’est pas un portable et aucun e-mail sur la fiche');
    // Personne à prévenir : un simple « Réparation terminée », sans doublon « sans prévenir »
    expect(actionsTicket(injoignable, 'tech').map((a) => [a.id, a.label])).toEqual([
      ['terminer', 'Réparation terminée'], ['rendre', 'Rendre en l’état…'],
    ]);
  });
});

describe('« déjà prévenu » d’après les notes', () => {
  const sms = { id: 3, type_note: 'sms', contenu: '✅ SMS envoyé au 06 12 34 56 78 (1 SMS, Brevo)\n[Appareil pret] Bonjour Léa…', date_creation: leSeize(12, 30) };
  const echec = { id: 4, type_note: 'sms_echec', contenu: '⚠️ SMS NON envoyé au 06 12 34 56 78 — Crédits SMS Brevo épuisés\n[Appareil pret] Bonjour', date_creation: leSeize(12, 35) };
  const recu = { id: 1, type_note: 'sms', contenu: '[Appareil recu] Bonjour Léa, votre iPhone a bien ete pris en charge', date_creation: leSeize(9, 0) };

  it('dernier « prêt » envoyé, échec signalé seulement s’il est plus récent', () => {
    expect(formatQuand(leSeize(12, 30))).toBe('le 16/10 à 12:30');
    expect(formatQuand('2026-10-16 10:30:00')).toBe(formatQuand('2026-10-16T10:30:00Z'));
    expect(dernierAvisPret([recu])).toEqual({ envoye: null, echec: null });
    const r = dernierAvisPret([echec, sms, recu]);
    expect(r.envoye).toEqual({ canal: 'sms', date: sms.date_creation });
    expect(texteDejaPrevenu(r.envoye)).toBe('Déjà prévenu : SMS le 16/10 à 12:30');
    expect(texteEchecSms(r.echec)).toBe('SMS non envoyé le 16/10 à 12:35 : Crédits SMS Brevo épuisés');
    const reussiApres = { ...sms, id: 5, type_note: 'email', date_creation: leSeize(13, 0) };
    expect(dernierAvisPret([echec, reussiApres])).toEqual({ envoye: { canal: 'email', date: reussiApres.date_creation }, echec: null });
  });

  it('libellé du modèle de la boutique ou texte « prêt » ; pas une note interne ni un « téléphone de prêt »', () => {
    expect(estAvisPret({ contenu: '[Dispo !] Venez' }, ['Dispo !'])).toBe(true);
    expect(estAvisPret({ contenu: '[Personnalise] Votre téléphone est prêt' })).toBe(true);
    expect(estAvisPret({ contenu: '[Personnalise] Rendez le téléphone de prêt' })).toBe(false);
    const notes = [
      { type_note: 'note', contenu: 'Appareil prêt sur l’étagère', date_creation: leSeize(14, 0) },
      { type_note: 'whatsapp', contenu: '[Personnalise] Rendez le téléphone de prêt', date_creation: leSeize(14, 5) },
    ];
    expect(dernierAvisPret(notes).envoye).toBeNull();
  });

  it('« prêt » le nom (votre prêt, en prêt, prêté) n’est pas un avis ; accents et majuscules gérés', () => {
    const non = [
      'Merci de rapporter votre prêt', 'Pensez à ce prêt', 'Votre téléphone en prêt est à rendre',
      'Merci de rapporter le téléphone prêté', 'La coque prêtée', 'Pouvez-vous nous prêter le chargeur ?',
      'Le prêt est à rendre demain',
    ];
    non.forEach((contenu) => expect(estAvisPret({ contenu }), contenu).toBe(false));
    const oui = [
      'Votre iPhone est prêt !', 'Votre tablette est prête.', 'Vos appareils sont prêts', 'VOTRE IPHONE EST PRÊT',
      'est pret!', 'Le téléphone de prêt est prêt aussi', 'Prêt à récupérer',
    ];
    oui.forEach((contenu) => expect(estAvisPret({ contenu }), contenu).toBe(true));
  });

  it('SMS ouvert dans Messages (lien sms:) : affiché « préparé », pas « Déjà prévenu »', () => {
    const manuel = { id: 6, type_note: 'sms', contenu: '[Appareil pret] Bonjour Léa, votre iPhone est pret', date_creation: leSeize(11, 0) };
    const r = dernierAvisPret([manuel]);
    expect(r.envoye).toEqual({ canal: 'sms', date: manuel.date_creation, manuel: true });
    expect(texteDejaPrevenu(r.envoye)).toBe('SMS préparé dans Messages le 16/10 à 11:00 (envoi non vérifié)');
    expect(dernierAvisPret([sms]).envoye.manuel).toBeUndefined();
  });

  it('aucun lookbehind « (?<! » dans le code chargé au scan (Safari / iOS avant 16.4)', () => {
    const sources = import.meta.glob(
      ['../lib/messages.js', '../lib/sms.js', '../components/PrevenirClient.jsx', '../components/QuickScanPanel.jsx', '../components/MessageComposer.jsx'],
      { query: '?raw', import: 'default', eager: true },
    );
    expect(Object.keys(sources)).toHaveLength(5);
    Object.entries(sources).forEach(([fichier, src]) => {
      // Les commentaires peuvent citer « (?<! » : seul le code compte
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
      expect(code, fichier).not.toMatch(/\(\?<[=!]/);
    });
  });

  it('erreurs d’envoi : délai dépassé et coupure réseau = envoi incertain, message lisible', () => {
    expect(erreurEnvoi(Object.assign(new Error('Connexion au serveur expirée (timeout)'), { code: 'timeout' })))
      .toEqual({ incertain: true, raison: 'le serveur n’a pas répondu à temps' });
    expect(erreurEnvoi(new TypeError('Failed to fetch'))).toEqual({ incertain: true, raison: 'serveur injoignable' });
    expect(erreurEnvoi(new TypeError('Load failed')).incertain).toBe(true);
    expect(erreurEnvoi(Object.assign(new Error('Brevo n’a pas répondu'), { code: 'delai_depasse', status: 424 })).incertain).toBe(true);
    expect(erreurEnvoi(Object.assign(new Error('Crédits SMS Brevo épuisés'), { code: 'credits_epuises' })))
      .toEqual({ incertain: false, raison: 'Crédits SMS Brevo épuisés' });
    expect(erreurEnvoi(null)).toEqual({ incertain: false, raison: 'erreur d’envoi' });
  });
});

// ─── « Terminé + prévenir le client » au scan ────────────────────────────────

describe('QuickScanPanel : « Terminé + prévenir le client »', () => {
  it('SMS serveur actif : statut d’abord, puis SMS Brevo court ; pas de note en double ni de lien sms:', async () => {
    resetApi();
    apiMock.getSmsEtat.mockResolvedValue(ETAT_ACTIF);
    apiMock.envoyerSms.mockResolvedValue({ ok: true, segments: 1, destinataire: '06 12 34 56 78' });
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    const bouton = await within(dialog).findByRole('button', { name: /Terminé \+ prévenir le client/ });
    await waitFor(() => expect(bouton).toHaveTextContent('SMS au 06 12 34 56 78'));
    expect(bouton).not.toHaveTextContent('Messages');
    fireEvent.click(bouton);
    expect(within(dialog).getByText(/« Réparation terminée » \+ SMS au client/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider maintenant' }));

    expect(await screen.findByText('KP-000042 : Terminé · SMS envoyé au 06 12 34 56 78')).toBeInTheDocument();
    expect(apiMock.changeStatus).toHaveBeenCalledTimes(1);
    expect(apiMock.envoyerSms).toHaveBeenCalledTimes(1);
    expect(apiMock.envoyerSms).toHaveBeenCalledWith(42, SMS_PRET, 'Appareil pret');
    expect(apiMock.changeStatus.mock.invocationCallOrder[0]).toBeLessThan(apiMock.envoyerSms.mock.invocationCallOrder[0]);
    expect(apiMock.logMessage).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    const carte = within(dialog).getByRole('region', { name: 'Prévenir Léa' });
    expect(within(carte).getByText('SMS envoyé au 06 12 34 56 78')).toBeInTheDocument();
    expect(within(carte).getByRole('button', { name: 'Renvoyer…' })).toHaveAttribute('aria-expanded', 'false');
    // Ticket relu : plus d'action « terminer » proposée
    await waitFor(() => expect(within(dialog).queryByRole('button', { name: /Terminé \+ prévenir/ })).not.toBeInTheDocument());
  });

  it('SMS serveur inactif : aucune ouverture de lien après l’await, la carte propose le bouton SMS', async () => {
    resetApi();
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    const bouton = await within(dialog).findByRole('button', { name: /Terminé \+ prévenir le client/ });
    expect(bouton).toHaveTextContent('SMS au 06 12 34 56 78 · à valider dans Messages');
    fireEvent.click(bouton);
    expect(within(dialog).getByText(/« Réparation terminée » puis SMS à envoyer depuis Messages/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider maintenant' }));
    await waitFor(() => expect(apiMock.changeStatus).toHaveBeenCalledWith(42, 'Réparation terminée'));
    const carte = await within(dialog).findByRole('region', { name: 'Prévenir Léa' });
    const sms = within(carte).getByRole('button', { name: 'SMS' });
    await waitFor(() => expect(document.activeElement).toBe(sms));
    expect(within(carte).getByText(/Envoi automatique des SMS désactivé.*ou sur « E-mail »/)).toBeInTheDocument();
    expect(within(carte).getByText(SMS_PRET)).toBeInTheDocument();
    expect(within(carte).getByText('1 SMS')).toBeInTheDocument();
    expect(within(carte).getByText('E-mail et WhatsApp : texte complet, avec le lien de suivi.')).toBeInTheDocument();
    expect(await screen.findByText('KP-000042 : Terminé — appuyez sur SMS pour prévenir le client')).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    expect(apiMock.envoyerSms).not.toHaveBeenCalled();

    // Clic : le lien sms: s'ouvre dans le geste, journal comme MessageComposer
    fireEvent.click(sms);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toMatch(/^sms:0612345678\?body=Bonjour%20L%C3%A9a/);
    await waitFor(() => expect(apiMock.logMessage).toHaveBeenCalledWith(42, 'Karim', expect.stringMatching(/^\[Appareil pret\] Bonjour Léa/), 'sms'));
    expect(apiMock.envoyerSms).not.toHaveBeenCalled();
    expect(await within(carte).findByText('SMS ouvert dans Messages : appuyez sur Envoyer')).toBeInTheDocument();
  });

  it('pas de portable mais un e-mail : e-mail complet (lien de suivi) et journal', async () => {
    resetApi({ client_tel: '04 79 60 89 22' });
    const dialog = await terminerEtPrevenir();
    expect(await screen.findByText('KP-000042 : Terminé · e-mail envoyé')).toBeInTheDocument();
    const [dest, sujet, corps] = apiMock.envoyerEmail.mock.calls[0];
    expect(dest).toBe('lea@example.test');
    expect(sujet).toBe('Votre Apple iPhone 13 est prêt - KP-000042');
    expect(corps).toContain('est pret ! Vous pouvez venir');
    expect(corps).toContain('/suivi?ticket=KP-000042');
    expect(apiMock.logMessage).toHaveBeenCalledWith(42, 'Karim', expect.stringMatching(/^\[Appareil pret\]/), 'email');
    expect(apiMock.envoyerSms).not.toHaveBeenCalled();
    expect(within(dialog).getByText('E-mail envoyé à lea@example.test')).toBeInTheDocument();
  });

  it('ni portable ni e-mail : « Réparation terminée » annonce « non joignable », message clair, rien n’est envoyé', async () => {
    resetApi({ client_tel: '', client_email: '' });
    renderPanel();
    scanner();
    const panneau = await screen.findByRole('dialog');
    const bouton = await within(panneau).findByRole('button', { name: /^Réparation terminée/ });
    expect(bouton).toHaveTextContent('Client non joignable : ni portable ni e-mail sur la fiche');
    expect(within(panneau).queryByRole('button', { name: /Terminé sans prévenir|Terminé \+ prévenir/ })).not.toBeInTheDocument();
    cleanup();

    const dialog = await terminerEtPrevenir(/^Réparation terminée/);
    expect(await screen.findByText('KP-000042 : Terminé — client non prévenu : ni portable ni e-mail sur la fiche')).toBeInTheDocument();
    expect(within(dialog).getByText('Client non prévenu : ni portable ni e-mail sur la fiche.')).toBeInTheDocument();
    expect(apiMock.envoyerSms).not.toHaveBeenCalled();
    expect(apiMock.envoyerEmail).not.toHaveBeenCalled();
    expect(apiMock.logMessage).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('refus de Brevo sans e-mail : ticket terminé quand même, raison affichée, réessai depuis la carte', async () => {
    resetApi({ client_email: '' });
    apiMock.getSmsEtat.mockResolvedValue(ETAT_ACTIF);
    apiMock.envoyerSms
      .mockRejectedValueOnce(Object.assign(new Error('Crédits SMS Brevo épuisés : rechargez le compte Brevo'), { status: 424, code: 'credits_epuises' }))
      .mockResolvedValueOnce({ ok: true, segments: 1, destinataire: '06 12 34 56 78' });
    const dialog = await terminerEtPrevenir();
    expect(await screen.findByText('KP-000042 : Terminé — SMS non envoyé : Crédits SMS Brevo épuisés : rechargez le compte Brevo')).toBeInTheDocument();
    const carte = within(dialog).getByRole('region', { name: 'Prévenir Léa' });
    expect(within(carte).getByText(/SMS non envoyé : Crédits SMS Brevo épuisés.*Réessayez/)).toBeInTheDocument();
    expect(apiMock.changeStatus).toHaveBeenCalledTimes(1);
    expect(apiMock.envoyerEmail).not.toHaveBeenCalled();
    // Seul canal possible : le focus va sur SMS (réessayer)
    await waitFor(() => expect(document.activeElement).toBe(within(carte).getByRole('button', { name: 'SMS' })));

    fireEvent.click(within(carte).getByRole('button', { name: 'SMS' }));
    await waitFor(() => expect(apiMock.envoyerSms).toHaveBeenCalledTimes(2));
    expect(await within(carte).findByText('SMS envoyé au 06 12 34 56 78')).toBeInTheDocument();
    expect(apiMock.changeStatus).toHaveBeenCalledTimes(1);
    expect(apiMock.logMessage).not.toHaveBeenCalled();
  });

  it('crédits Brevo épuisés et un e-mail : repli automatique sur l’e-mail', async () => {
    resetApi();
    apiMock.getSmsEtat.mockResolvedValue(ETAT_ACTIF);
    apiMock.envoyerSms.mockRejectedValue(Object.assign(new Error('Crédits SMS Brevo épuisés : rechargez le compte Brevo'), { status: 424, code: 'credits_epuises' }));
    const dialog = await terminerEtPrevenir();
    expect(await screen.findByText('KP-000042 : Terminé · SMS impossible (crédits épuisés) → e-mail envoyé à lea@example.test')).toBeInTheDocument();
    expect(apiMock.envoyerSms).toHaveBeenCalledTimes(1);
    expect(apiMock.envoyerEmail).toHaveBeenCalledTimes(1);
    expect(apiMock.envoyerEmail.mock.calls[0][1]).toBe('Votre Apple iPhone 13 est prêt - KP-000042');
    expect(apiMock.envoyerEmail.mock.calls[0][2]).toContain('/suivi?ticket=KP-000042');
    expect(apiMock.logMessage).toHaveBeenCalledWith(42, 'Karim', expect.stringMatching(/^\[Appareil pret\]/), 'email');
    const carte = within(dialog).getByRole('region', { name: 'Prévenir Léa' });
    expect(within(carte).getByText('SMS impossible (crédits épuisés) : e-mail envoyé à lea@example.test')).toBeInTheDocument();
  });

  it('refus ponctuel de Brevo avec un e-mail : pas de repli seul, « E-mail » mis en avant et focalisé', async () => {
    resetApi();
    apiMock.getSmsEtat.mockResolvedValue(ETAT_ACTIF);
    apiMock.envoyerSms.mockRejectedValue(Object.assign(new Error('Brevo est indisponible (erreur 503), réessayez plus tard'), { status: 424, code: 'brevo_indisponible' }));
    const dialog = await terminerEtPrevenir();
    expect(await screen.findByText('KP-000042 : Terminé — SMS non envoyé : Brevo est indisponible (erreur 503), réessayez plus tard')).toBeInTheDocument();
    expect(apiMock.envoyerEmail).not.toHaveBeenCalled();
    const carte = within(dialog).getByRole('region', { name: 'Prévenir Léa' });
    expect(within(carte).getByText(/Envoyez-le par e-mail ou réessayez/)).toBeInTheDocument();
    const email = within(carte).getByRole('button', { name: 'E-mail' });
    await waitFor(() => expect(document.activeElement).toBe(email));
    expect(email.className).toMatch(/bg-emerald-700/);
    expect(within(carte).getByText('Texte de l’e-mail')).toBeInTheDocument();
    fireEvent.click(email);
    await waitFor(() => expect(apiMock.envoyerEmail).toHaveBeenCalledTimes(1));
    expect(await within(carte).findByText('E-mail envoyé à lea@example.test')).toBeInTheDocument();
  });

  it('délai dépassé : envoi incertain, ni repli ni renvoi sans confirmation, notes relues', async () => {
    resetApi();
    apiMock.getSmsEtat.mockResolvedValue(ETAT_ACTIF);
    apiMock.envoyerSms.mockRejectedValue(Object.assign(new Error('Connexion au serveur expirée (timeout)'), { code: 'timeout' }));
    const dialog = await terminerEtPrevenir();
    expect(await screen.findByText('KP-000042 : Terminé — envoi du SMS incertain (le serveur n’a pas répondu à temps) : vérifiez avant de renvoyer')).toBeInTheDocument();
    expect(apiMock.envoyerEmail).not.toHaveBeenCalled();
    const carte = within(dialog).getByRole('region', { name: 'Prévenir Léa' });
    expect(within(carte).getByText(/Envoi du SMS incertain.*vérifiez les notes du ticket/)).toBeInTheDocument();
    // Notes relues après l'envoi (le serveur a pu noter le SMS)
    await waitFor(() => expect(apiMock.getNotes.mock.calls.length).toBeGreaterThanOrEqual(3));

    fireEvent.click(within(carte).getByRole('button', { name: 'SMS' }));
    fireEvent.click(within(carte).getByRole('button', { name: 'SMS' }));
    expect(within(carte).getByText('Le dernier envoi a peut-être abouti (connexion interrompue). Renvoyer par SMS ?')).toBeInTheDocument();
    expect(apiMock.envoyerSms).toHaveBeenCalledTimes(1);
  });

  it('pas de double envoi pendant la préparation : carte verrouillée avant même la relecture de la fiche', async () => {
    resetApi();
    apiMock.getSmsEtat.mockResolvedValue(ETAT_ACTIF);
    apiMock.envoyerSms.mockResolvedValue({ ok: true, segments: 1, destinataire: '06 12 34 56 78' });
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    const bouton = await within(dialog).findByRole('button', { name: /Terminé \+ prévenir le client/ });
    // Modèles de la boutique lents : l'envoi automatique attend
    const enAttente = [];
    apiMock.getMessageTemplates.mockImplementation(() => new Promise((r) => { enAttente.push(r); }));
    fireEvent.click(bouton);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider maintenant' }));
    await waitFor(() => expect(apiMock.changeStatus).toHaveBeenCalledTimes(1));
    // Fiche relue (« Rendre au client » au pied) : la carte est affichée, l'envoi pas encore parti
    await within(dialog).findByRole('button', { name: /Rendre au client/ });
    const carte = within(dialog).getByRole('region', { name: 'Prévenir Léa' });
    expect(within(carte).getByText('Préparation du message…')).toBeInTheDocument();
    ['SMS', 'E-mail', 'WhatsApp'].forEach((nom) => {
      const b = within(carte).getByRole('button', { name: nom });
      expect(b).toBeDisabled();
      fireEvent.click(b);
    });
    expect(within(carte).getByRole('button', { name: 'Choisir un autre message' })).toBeDisabled();
    expect(apiMock.envoyerSms).not.toHaveBeenCalled();
    expect(apiMock.envoyerEmail).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    await act(async () => { enAttente.forEach((r) => r([])); });
    expect(await screen.findByText('KP-000042 : Terminé · SMS envoyé au 06 12 34 56 78')).toBeInTheDocument();
    expect(apiMock.envoyerSms).toHaveBeenCalledTimes(1);
    expect(apiMock.envoyerEmail).not.toHaveBeenCalled();
  });

  it('accueil : « Terminé + prévenir le client » aussi au scan', async () => {
    resetApi();
    auth.user = { target: 'accueil', utilisateur: 'Sophie' };
    apiMock.getSmsEtat.mockResolvedValue(ETAT_ACTIF);
    apiMock.envoyerSms.mockResolvedValue({ ok: true, segments: 1, destinataire: '06 12 34 56 78' });
    await terminerEtPrevenir();
    expect(await screen.findByText('KP-000042 : Terminé · SMS envoyé au 06 12 34 56 78')).toBeInTheDocument();
    expect(apiMock.envoyerSms).toHaveBeenCalledWith(42, SMS_PRET, 'Appareil pret');
  });

  it('« Terminé sans prévenir » : aucun envoi, carte repliée', async () => {
    resetApi();
    apiMock.getSmsEtat.mockResolvedValue(ETAT_ACTIF);
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: /Terminé sans prévenir/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider maintenant' }));
    expect(await screen.findByText('KP-000042 : Réparation terminée')).toBeInTheDocument();
    const carte = await within(dialog).findByRole('region', { name: 'Prévenir Léa' });
    expect(within(carte).getByRole('button', { name: 'Prévenir…' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(carte).getByText('Pas encore prévenu que l’appareil est prêt.')).toBeInTheDocument();
    expect(apiMock.envoyerSms).not.toHaveBeenCalled();
    expect(apiMock.envoyerEmail).not.toHaveBeenCalled();
  });
});

// ─── Carte sur un ticket déjà terminé (accueil) ──────────────────────────────

describe('carte « Prévenir le client » : ticket « Réparation terminée »', () => {
  beforeEach(() => { auth.user = { target: 'accueil', utilisateur: 'Sophie' }; });

  // Simple scan d'un ticket terminé : carte repliée (remise probable) ; deplier : clic sur « Prévenir… »
  async function ouvrir({ deplier = false } = {}) {
    renderPanel();
    scanner();
    const dialog = await screen.findByRole('dialog');
    const carte = await within(dialog).findByRole('region', { name: 'Prévenir Léa' });
    if (deplier) fireEvent.click(within(carte).getByRole('button', { name: /^(Prévenir|Renvoyer)…$/ }));
    return { dialog, carte };
  }

  it('pas encore prévenu : carte repliée sur une ligne, la remise reste l’action principale', async () => {
    resetApi({ statut: 'Réparation terminée' });
    const { dialog, carte } = await ouvrir();
    expect(within(carte).getByText('Pas encore prévenu que l’appareil est prêt.')).toBeInTheDocument();
    const bascule = within(carte).getByRole('button', { name: 'Prévenir…' });
    expect(bascule).toHaveAttribute('aria-expanded', 'false');
    expect(within(carte).queryByRole('button', { name: 'SMS' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Rendre au client' }).className).toMatch(/min-h-\[56px\]/);
    fireEvent.click(bascule);
    expect(within(carte).getByRole('button', { name: 'SMS' })).toBeEnabled();
  });

  it('déjà prévenu : une ligne, puis confirmation légère avant de renvoyer (Échap l’annule)', async () => {
    resetApi({ statut: 'Réparation terminée' });
    apiMock.getNotes.mockResolvedValue([
      { id: 3, auteur: 'Karim', type_note: 'sms', contenu: '✅ SMS envoyé au 06 12 34 56 78 (1 SMS, Brevo)\n[Appareil pret] Bonjour', date_creation: leSeize(12, 30) },
    ]);
    const { dialog, carte } = await ouvrir();
    expect(within(carte).getByText('Déjà prévenu : SMS le 16/10 à 12:30')).toBeInTheDocument();
    expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: 'KP-000042' }));
    const bascule = within(carte).getByRole('button', { name: 'Renvoyer…' });
    expect(bascule).toHaveAttribute('aria-expanded', 'false');
    expect(within(carte).queryByRole('button', { name: 'E-mail' })).not.toBeInTheDocument();

    fireEvent.click(bascule);
    fireEvent.click(within(carte).getByRole('button', { name: 'E-mail' }));
    const question = within(carte).getByText('Déjà prévenu : SMS le 16/10 à 12:30. Renvoyer par e-mail ?');
    expect(question).toBeInTheDocument();
    const non = within(carte).getByRole('button', { name: 'Non, ne pas renvoyer' });
    await waitFor(() => expect(document.activeElement).toBe(non));
    fireEvent.keyDown(non, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(carte).queryByText(/Renvoyer par e-mail/)).not.toBeInTheDocument();
    expect(apiMock.envoyerEmail).not.toHaveBeenCalled();

    fireEvent.click(within(carte).getByRole('button', { name: 'E-mail' }));
    fireEvent.click(within(carte).getByRole('button', { name: 'Oui, renvoyer' }));
    await waitFor(() => expect(apiMock.logMessage).toHaveBeenCalledWith(42, 'Sophie', expect.stringMatching(/^\[Appareil pret\]/), 'email'));
    expect(apiMock.envoyerEmail).toHaveBeenCalledTimes(1);
    expect(await within(carte).findByText('E-mail envoyé à lea@example.test')).toBeInTheDocument();
  });

  it('déjà prévenu : un double clic sur le canal ne passe pas outre la confirmation', async () => {
    resetApi({ statut: 'Réparation terminée' });
    apiMock.getNotes.mockResolvedValue([
      { id: 3, auteur: 'Karim', type_note: 'email', contenu: '[Appareil pret] Bonjour', date_creation: leSeize(12, 30) },
    ]);
    const { carte } = await ouvrir({ deplier: true });
    const email = within(carte).getByRole('button', { name: 'E-mail' });
    fireEvent.click(email);
    fireEvent.click(email);
    fireEvent.click(email);
    expect(within(carte).getByText('Déjà prévenu : e-mail le 16/10 à 12:30. Renvoyer par e-mail ?')).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(apiMock.envoyerEmail).not.toHaveBeenCalled();
    expect(apiMock.logMessage).not.toHaveBeenCalled();
    fireEvent.click(within(carte).getByRole('button', { name: 'Oui, renvoyer' }));
    await waitFor(() => expect(apiMock.envoyerEmail).toHaveBeenCalledTimes(1));
    expect(apiMock.envoyerEmail.mock.calls[0][1]).toBe('Votre Apple iPhone 13 est prêt - KP-000042');
  });

  it('SMS ouvert dans Messages auparavant : « préparé (envoi non vérifié) », confirmation avant renvoi', async () => {
    resetApi({ statut: 'Réparation terminée' });
    apiMock.getNotes.mockResolvedValue([
      { id: 6, auteur: 'Sophie', type_note: 'sms', contenu: '[Appareil pret] Bonjour Léa, votre iPhone est pret', date_creation: leSeize(11, 0) },
    ]);
    const { carte } = await ouvrir({ deplier: true });
    expect(within(carte).getByText('SMS préparé dans Messages le 16/10 à 11:00 (envoi non vérifié)')).toBeInTheDocument();
    expect(within(carte).queryByText(/Déjà prévenu/)).not.toBeInTheDocument();
    fireEvent.click(within(carte).getByRole('button', { name: 'SMS' }));
    expect(within(carte).getByText('SMS préparé dans Messages le 16/10 à 11:00 (envoi non vérifié). Renvoyer par SMS ?')).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it('SMS refusé noté par le serveur : « SMS non envoyé le … », l’e-mail est mis en avant', async () => {
    resetApi({ statut: 'Réparation terminée' });
    apiMock.getNotes.mockResolvedValue([
      { id: 4, auteur: 'Karim', type_note: 'sms_echec', contenu: '⚠️ SMS NON envoyé au 06 12 34 56 78 — Numéro invalide\n[Appareil pret] Bonjour', date_creation: leSeize(12, 35) },
    ]);
    const { carte } = await ouvrir();
    expect(within(carte).getByText('SMS non envoyé le 16/10 à 12:35 : Numéro invalide')).toBeInTheDocument();
    fireEvent.click(within(carte).getByRole('button', { name: 'Prévenir…' }));
    expect(within(carte).getByRole('button', { name: 'Plus tard' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(carte).getByRole('button', { name: 'SMS' })).toBeEnabled();
    expect(within(carte).getByRole('button', { name: 'E-mail' }).className).toMatch(/bg-emerald-700/);
    expect(within(carte).getByText('Texte de l’e-mail')).toBeInTheDocument();
  });

  it('état en cache « SMS serveur actif » mais serveur désactivé : pas de lien après l’await, lien au clic suivant', async () => {
    resetApi({ statut: 'Réparation terminée' });
    apiMock.getSmsEtat.mockResolvedValue(ETAT_ACTIF);
    apiMock.envoyerSms.mockRejectedValue(Object.assign(new Error('Envoi des SMS par le serveur désactivé'), {
      status: 409, code: 'sms_non_configure', detail: { link: 'sms:0612345678?body=x' },
    }));
    const { carte } = await ouvrir({ deplier: true });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const sms = within(carte).getByRole('button', { name: 'SMS' });
    fireEvent.click(sms);
    expect(await screen.findByText(/appuyez à nouveau sur « SMS »/)).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    expect(apiMock.logMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(apiMock.getSmsEtat).toHaveBeenCalledWith({ fresh: true }));

    await waitFor(() => expect(sms).toBeEnabled());
    fireEvent.click(sms);
    // Ouvert dans le geste (avant tout await), puis noté comme MessageComposer
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toMatch(/^sms:0612345678\?body=/);
    expect(apiMock.envoyerSms).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(apiMock.logMessage).toHaveBeenCalledWith(42, 'Sophie', expect.stringMatching(/^\[Appareil pret\]/), 'sms'));
  });

  it('un seul envoi à la fois : double clic sur SMS → un seul SMS', async () => {
    resetApi({ statut: 'Réparation terminée' });
    apiMock.getSmsEtat.mockResolvedValue(ETAT_ACTIF);
    let finir;
    apiMock.envoyerSms.mockImplementation(() => new Promise((r) => { finir = r; }));
    const { carte } = await ouvrir({ deplier: true });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const sms = within(carte).getByRole('button', { name: 'SMS' });
    fireEvent.click(sms);
    fireEvent.click(sms);
    await waitFor(() => expect(sms).toBeDisabled());
    expect(within(carte).getByRole('button', { name: 'E-mail' })).toBeDisabled();
    expect(apiMock.envoyerSms).toHaveBeenCalledTimes(1);
    await act(async () => { finir({ ok: true, segments: 1, destinataire: '06 12 34 56 78' }); });
    expect(await screen.findByText('SMS envoyé au 06 12 34 56 78', { selector: '[role="status"] p' })).toBeInTheDocument();
    expect(apiMock.envoyerSms).toHaveBeenCalledTimes(1);
    expect(apiMock.logMessage).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('numéro fixe sans e-mail : SMS et e-mail désactivés avec l’explication, WhatsApp possible', async () => {
    resetApi({ statut: 'Réparation terminée', client_tel: '04 79 60 89 22', client_email: '' });
    const { carte } = await ouvrir({ deplier: true });
    const sms = within(carte).getByRole('button', { name: 'SMS' });
    expect(sms).toBeDisabled();
    expect(within(carte).getByRole('button', { name: 'E-mail' })).toBeDisabled();
    expect(within(carte).getByRole('button', { name: 'WhatsApp' })).toBeEnabled();
    const raisons = within(carte).getByText('SMS : le 04 79 60 89 22 n’est pas un portable.');
    expect(sms.getAttribute('aria-describedby')).toBe(raisons.closest('ul').id);
    expect(within(carte).getByText('E-mail : aucune adresse sur la fiche.')).toBeInTheDocument();
  });

  it('« Choisir un autre message » ouvre les modèles de MessageComposer', async () => {
    resetApi({ statut: 'Réparation terminée' });
    const { carte } = await ouvrir({ deplier: true });
    fireEvent.click(within(carte).getByRole('button', { name: 'Choisir un autre message' }));
    expect(await within(carte).findByRole('group', { name: 'Modèles de message' })).toBeInTheDocument();
    fireEvent.click(within(carte).getByRole('button', { name: /Message « appareil prêt »/ }));
    expect(within(carte).getByRole('button', { name: 'SMS' })).toBeInTheDocument();
  });
});
