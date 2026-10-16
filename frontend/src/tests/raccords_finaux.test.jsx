/**
 * Raccords : fiche ticket (emplacement sur l'étagère, badge « Relance », carte « Prévenir »
 * au passage en « Réparation terminée ») et configuration (onglet Étagère, anonymisation
 * automatique dans « Mentions & RGPD »).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
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
  return { auth: { user: { target: 'accueil', utilisateur: 'Sophie' } }, apiMock };
});

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));
vi.mock('../hooks/useCatalog', () => ({
  useCatalog: () => ({ marques: [], modelesDe: () => [], loading: false }),
}));

import { ToastProvider } from '../components/Toast';
import { SettingsProvider } from '../hooks/useSettings';
import { clearCache } from '../hooks/useApi';
import TicketDetailPage from '../pages/TicketDetailPage';
import ConfigPage, {
  lirePaliersRelance, controlesEtagere, ajouterEmplacements, retirerEmplacement, valeurModifiee, normaliserParam,
  debutRetentionAuto, dateFr, dateIsoLocale, etatRetentionAuto, texteActivationAuto, PALIERS_RELANCE_DEFAUT,
} from '../pages/ConfigPage';

const SMS_ENVOYE = { id: 3, type_note: 'sms', auteur: 'Sophie', date_creation: '2026-10-16 10:30:00',
  contenu: '✅ SMS envoyé au 06 12 34 56 78 (1 SMS, Brevo)\n[Appareil pret] Bonjour Léa…' };

function ticket(overrides = {}) {
  return {
    id: 42, ticket_code: 'KP-000042', statut: 'En cours de réparation', client_id: 5,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '0612345678', client_email: '',
    categorie: 'Smartphone', marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé',
    date_depot: '2026-10-10T09:00:00', paye: 0, acompte: 0, devis_estime: 89, emplacement: null,
    telephone_pret: '', telephone_pret_imei: '', telephone_pret_rendu: false, historique: '',
    montants: { total: 89, acompte: 0, reste: 89, paye: false, lignes: [{ label: 'Écran', prix: 89 }], source: 'devis_estime' },
    ...overrides,
  };
}

let courant;
let notes;

beforeEach(() => {
  clearCache();
  localStorage.clear();
  sessionStorage.clear();
  for (const fn of Object.values(apiMock)) fn.mockReset().mockResolvedValue([]);
  courant = ticket();
  notes = [];
  apiMock.getTicket.mockImplementation(async () => ({ ...courant }));
  apiMock.getNotes.mockImplementation(async () => notes.map(n => ({ ...n })));
  apiMock.getMessageTemplates.mockResolvedValue([]);
  apiMock.getSmsEtat.mockResolvedValue({ disponible: true, active: true, cle_configuree: true });
  apiMock.markTicketRead.mockResolvedValue({ ok: true });
  apiMock.addHistory.mockResolvedValue({ ok: true });
  apiMock.hasAdminToken.mockReturnValue(false);
  apiMock.getEtagereConfig.mockResolvedValue({ emplacements: ['A1', 'B2'], delai_abandon_jours: 365, relance_paliers: [3, 10] });
  apiMock.setEmplacement.mockImplementation(async (id, emplacement) => {
    courant = { ...courant, emplacement: emplacement || null };
    return { emplacement: emplacement || null };
  });
  apiMock.updateTicket.mockImplementation(async (id, patch) => {
    courant = { ...courant, ...patch };
    return { ok: true, ticket: { ...courant } };
  });
  apiMock.changeStatus.mockImplementation(async (id, statut) => {
    courant = { ...courant, statut };
    return { ok: true, proposer_message: true };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

const changerStatut = async (statut) => {
  fireEvent.change(await screen.findByRole('combobox', { name: 'Changer le statut' }), { target: { value: statut } });
};

// ═══ Fiche : emplacement ═════════════════════════════════════════

describe('Fiche : emplacement sur l’étagère', () => {
  it('« Réparation terminée » sans emplacement : invitation à ranger, bouton rapide enregistré, étiquette en en-tête', async () => {
    courant = ticket({ statut: 'Réparation terminée' });
    renderFiche();
    const groupe = await screen.findByRole('group', { name: 'Emplacement' });
    expect(screen.getByText(/Appareil prêt : notez où il est rangé/)).toBeInTheDocument();
    expect(screen.queryByTitle('Emplacement sur l’étagère')).not.toBeInTheDocument();
    fireEvent.click(await within(groupe).findByRole('button', { name: 'B2' }));
    await waitFor(() => expect(apiMock.setEmplacement).toHaveBeenCalledWith('42', 'B2'));
    expect(await screen.findByTitle('Emplacement sur l’étagère')).toHaveTextContent('B2');
    expect(within(groupe).getByRole('button', { name: 'B2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/Appareil prêt : notez où il est rangé/)).not.toBeInTheDocument();
    expect(apiMock.updateTicket).not.toHaveBeenCalled();
  });

  it('saisie libre modifiable avant la remise (réparation en cours), sans invitation', async () => {
    courant = ticket({ emplacement: 'A1' });
    renderFiche();
    const champ = await screen.findByRole('textbox', { name: 'Emplacement' });
    expect(champ).toHaveValue('A1');
    expect(screen.queryByText(/Appareil prêt : notez où il est rangé/)).not.toBeInTheDocument();
    fireEvent.change(champ, { target: { value: 'c 4' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    await waitFor(() => expect(apiMock.setEmplacement).toHaveBeenCalledWith('42', 'C 4'));
    expect(await screen.findByTitle('Emplacement sur l’étagère')).toHaveTextContent('C 4');
  });

  it('appareil rendu : ni champ ni étiquette', async () => {
    courant = ticket({ statut: 'Rendu au client', emplacement: 'B2' });
    renderFiche();
    await screen.findByRole('combobox', { name: 'Changer le statut' });
    expect(screen.queryByRole('group', { name: 'Emplacement' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Emplacement sur l’étagère')).not.toBeInTheDocument();
  });
});

// ═══ Fiche : notes ═══════════════════════════════════════════════

describe('Fiche : badge « Relance »', () => {
  it('note de relance (appel) : badge violet à côté des badges de canal', async () => {
    notes = [
      { id: 7, type_note: 'relance', auteur: 'Sophie', contenu: 'Appel téléphonique : pas de réponse', date_creation: '2026-10-16 09:00:00' },
      { id: 8, type_note: 'sms_echec', auteur: 'Sophie', contenu: 'SMS non envoyé — crédits épuisés', date_creation: '2026-10-16 08:00:00' },
    ];
    renderFiche();
    const badge = await screen.findByText('Relance');
    expect(badge).toHaveClass('bg-violet-100', 'text-violet-800');
    expect(badge.parentElement).toHaveTextContent('Appel téléphonique : pas de réponse');
    expect(screen.getByText('SMS non envoyé')).toHaveClass('bg-red-100');
  });
});

// ═══ Fiche : carte « Prévenir » au passage en « Réparation terminée » ══

describe('Fiche : « Réparation terminée » → carte « Prévenir »', () => {
  it('SMS envoyé par le serveur en 1 clic : notes relues, modale fermée, aucune note en double', async () => {
    apiMock.envoyerSms.mockResolvedValue({ ok: true, segments: 1, destinataire: '06 12 34 56 78' });
    renderFiche();
    await changerStatut('Réparation terminée');
    const modale = await screen.findByRole('dialog', { name: 'Prévenir Léa' });
    expect(within(modale).getByText('Pas encore prévenu que l’appareil est prêt.')).toBeInTheDocument();
    const lectures = apiMock.getNotes.mock.calls.length;
    fireEvent.click(within(modale).getByRole('button', { name: 'SMS' }));
    await waitFor(() => expect(apiMock.envoyerSms).toHaveBeenCalledTimes(1));
    const [id, texte, libelle] = apiMock.envoyerSms.mock.calls[0];
    expect(id).toBe(42);
    expect(texte).toMatch(/^Bonjour Léa, votre Apple iPhone 13 est pret!.*Montant : 89\.00 EUR/);
    expect(libelle).toBe('Appareil pret');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiMock.getNotes.mock.calls.length).toBeGreaterThan(lectures);
    // SMS parti par le serveur : la note est écrite par le serveur, pas par la fiche
    expect(apiMock.logMessage).not.toHaveBeenCalled();
    expect(await screen.findByText(/SMS envoyé au 06 12 34 56 78/)).toBeInTheDocument();
  });

  it('déjà prévenu : rappel affiché, confirmation avant tout renvoi ; « Replier » ferme', async () => {
    notes = [SMS_ENVOYE];
    renderFiche();
    await changerStatut('Réparation terminée');
    const modale = await screen.findByRole('dialog', { name: 'Prévenir Léa' });
    expect(await within(modale).findByText(/^Déjà prévenu : SMS/)).toBeInTheDocument();
    fireEvent.click(within(modale).getByRole('button', { name: 'SMS' }));
    expect(within(modale).getByText(/Renvoyer par SMS \?/)).toBeInTheDocument();
    expect(apiMock.envoyerSms).not.toHaveBeenCalled();
    fireEvent.click(within(modale).getByRole('button', { name: 'Non, ne pas renvoyer' }));
    expect(within(modale).queryByText(/Renvoyer par SMS \?/)).not.toBeInTheDocument();
    fireEvent.click(within(modale).getByRole('button', { name: 'Replier' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiMock.envoyerSms).not.toHaveBeenCalled();
  });

  it('« Choisir un autre message » ouvre la grille des modèles dans la carte', async () => {
    renderFiche();
    await changerStatut('Réparation terminée');
    const modale = await screen.findByRole('dialog', { name: 'Prévenir Léa' });
    fireEvent.click(within(modale).getByRole('button', { name: 'Choisir un autre message' }));
    expect(await within(modale).findByRole('button', { name: /Message « appareil prêt »/ })).toBeInTheDocument();
    fireEvent.click(within(modale).getByRole('button', { name: /Message « appareil prêt »/ }));
    expect(within(modale).getByRole('button', { name: 'SMS' })).toBeInTheDocument();
  });

  it('Échap ferme la modale sans rien envoyer', async () => {
    renderFiche();
    await changerStatut('Réparation terminée');
    await screen.findByRole('dialog', { name: 'Prévenir Léa' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiMock.envoyerSms).not.toHaveBeenCalled();
  });

  it('SMS en cours d’envoi (Brevo) : Échap ne ferme pas la modale, fermée une fois le SMS parti', async () => {
    let finir;
    apiMock.envoyerSms.mockImplementation(() => new Promise((r) => { finir = r; }));
    renderFiche();
    await changerStatut('Réparation terminée');
    const modale = await screen.findByRole('dialog', { name: 'Prévenir Léa' });
    fireEvent.click(within(modale).getByRole('button', { name: 'SMS' }));
    await waitFor(() => expect(apiMock.envoyerSms).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Prévenir Léa' })).toBeInTheDocument();
    finir({ ok: true, segments: 1, destinataire: '06 12 34 56 78' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiMock.envoyerSms).toHaveBeenCalledTimes(1);
  });

  it('SMS refusé : la modale reste sur la carte, Échap la ferme ensuite', async () => {
    let refuser;
    apiMock.envoyerSms.mockImplementation(() => new Promise((_, r) => { refuser = r; }));
    renderFiche();
    await changerStatut('Réparation terminée');
    const modale = await screen.findByRole('dialog', { name: 'Prévenir Léa' });
    fireEvent.click(within(modale).getByRole('button', { name: 'SMS' }));
    await waitFor(() => expect(apiMock.envoyerSms).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Prévenir Léa' })).toBeInTheDocument();
    refuser(Object.assign(new Error('Numéro refusé par Brevo'), { status: 424 }));
    await waitFor(() => expect(within(modale).getByRole('button', { name: 'SMS' })).not.toBeDisabled());
    expect(screen.getByRole('dialog', { name: 'Prévenir Léa' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sans emplacement noté : « Rangé où ? » dans la modale, toujours affiché après l’enregistrement', async () => {
    renderFiche();
    await changerStatut('Réparation terminée');
    const modale = await screen.findByRole('dialog', { name: 'Prévenir Léa' });
    const ranger = within(modale).getByRole('group', { name: 'Rangé où ?' });
    fireEvent.click(await within(ranger).findByRole('button', { name: 'B2' }));
    await waitFor(() => expect(apiMock.setEmplacement).toHaveBeenCalledWith('42', 'B2'));
    await waitFor(() => expect(within(ranger).getByRole('button', { name: 'B2' })).toHaveAttribute('aria-pressed', 'true'));
    expect(within(modale).getByRole('group', { name: 'Rangé où ?' })).toBe(ranger);
    expect(await screen.findByTitle('Emplacement sur l’étagère')).toHaveTextContent('B2');
    // Carte toujours là : on range puis on prévient, dans la même modale
    expect(within(modale).getByRole('button', { name: 'SMS' })).toBeEnabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('emplacement déjà noté : pas de « Rangé où ? » dans la modale', async () => {
    courant = ticket({ emplacement: 'A1' });
    renderFiche();
    await changerStatut('Réparation terminée');
    const modale = await screen.findByRole('dialog', { name: 'Prévenir Léa' });
    expect(within(modale).queryByRole('group', { name: 'Rangé où ?' })).not.toBeInTheDocument();
    expect(within(modale).getByRole('button', { name: 'SMS' })).toBeInTheDocument();
  });
});

// ═══ Configuration : helpers ═════════════════════════════════════

describe('Configuration : règles de l’étagère', () => {
  it('paliers de relance : triés sans doublon, vide = aucune relance, valeur invalide signalée', () => {
    expect(lirePaliersRelance('30, 3;10 3')).toEqual({ paliers: [3, 10, 30], erreur: null });
    expect(lirePaliersRelance('')).toEqual({ paliers: [], erreur: null });
    expect(lirePaliersRelance(PALIERS_RELANCE_DEFAUT).paliers).toEqual([3, 10, 30, 90, 180, 330]);
    expect(lirePaliersRelance('3, dix').erreur).toMatch(/« dix »/);
    expect(lirePaliersRelance('0').erreur).toMatch(/entre 1 et 3650/);
    expect(lirePaliersRelance('4000').erreur).toMatch(/« 4000 »/);
  });

  it('délai de garde : 1 an minimum (loi du 31/12/1903), vide = défaut', () => {
    expect(controlesEtagere({}).erreurs).toEqual({});
    expect(controlesEtagere({ ETAGERE_DELAI_ABANDON_JOURS: '' }).erreurs).toEqual({});
    expect(controlesEtagere({ ETAGERE_DELAI_ABANDON_JOURS: '400' }).erreurs).toEqual({});
    expect(controlesEtagere({ ETAGERE_DELAI_ABANDON_JOURS: '90' }).erreurs.ETAGERE_DELAI_ABANDON_JOURS).toMatch(/entre 365 \(1 an, minimum légal\)/);
    expect(controlesEtagere({ ETAGERE_DELAI_ABANDON_JOURS: '365.5' }).erreurs.ETAGERE_DELAI_ABANDON_JOURS).toBeTruthy();
    expect(controlesEtagere({ ETAGERE_RELANCE_PALIERS: 'x' }).erreurs.ETAGERE_RELANCE_PALIERS).toBeTruthy();
  });

  it('emplacements : majuscules, doublons et trop longs refusés, plusieurs à la fois', () => {
    const r = ajouterEmplacements('A1, B2', 'c3, a1, ' + 'X'.repeat(21) + ',  étagère  2 ');
    expect(r.valeur).toBe('A1, B2, C3, ÉTAGÈRE 2');
    expect(r.ajoutes).toEqual(['C3', 'ÉTAGÈRE 2']);
    expect(r.refuses).toEqual(['A1 est déjà dans la liste', `« ${'X'.repeat(21)} » : 20 caractères maximum`]);
    expect(retirerEmplacement('A1, B2, C3', 'B2')).toBe('A1, C3');
    const plein = Array.from({ length: 40 }, (_, i) => `E${i}`).join(',');
    expect(ajouterEmplacements(plein, 'Z1').refuses).toEqual(['40 emplacements maximum']);
  });

  it('valeurs envoyées : paliers croissants sans doublon, délai vidé = 365 jours', () => {
    expect(normaliserParam('ETAGERE_RELANCE_PALIERS', '30, 3;10 3')).toBe('3, 10, 30');
    expect(normaliserParam('ETAGERE_RELANCE_PALIERS', '')).toBe('');
    expect(normaliserParam('ETAGERE_DELAI_ABANDON_JOURS', ' ')).toBe('365');
    expect(normaliserParam('ETAGERE_DELAI_ABANDON_JOURS', '400 ')).toBe('400');
    expect(normaliserParam('BOUTIQUE_NOM', undefined)).toBe('');
  });

  it('paliers vidés exprès ≠ paramètre absent ; ailleurs vide et absent se valent', () => {
    expect(valeurModifiee('ETAGERE_RELANCE_PALIERS', '', undefined)).toBe(true);
    expect(valeurModifiee('ETAGERE_RELANCE_PALIERS', undefined, undefined)).toBe(false);
    expect(valeurModifiee('ETAGERE_DELAI_ABANDON_JOURS', '', undefined)).toBe(false);
    expect(valeurModifiee('BOUTIQUE_NOM', 'A', 'B')).toBe(true);
  });
});

describe('Configuration : anonymisation automatique (helpers)', () => {
  it('début à J+7, dates affichées en jj/mm/aaaa', () => {
    expect(debutRetentionAuto(new Date(2026, 9, 28, 23, 59))).toBe('2026-11-04');
    expect(dateIsoLocale(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dateFr('2026-10-23')).toBe('23/10/2026');
    expect(texteActivationAuto(36, '2026-10-23')).toBe(
      'Irréversible : les clients sans activité depuis 36 mois seront anonymisés chaque jour à partir de J+7 (le 23/10/2026).',
    );
  });

  it('état : serveur (aperçu) prioritaire, sinon paramètres ; désactivée par défaut', () => {
    expect(etatRetentionAuto({}, null)).toEqual({ actif: false, debut: null, derniere: null });
    expect(etatRetentionAuto({ RGPD_RETENTION_AUTO: '1', RGPD_RETENTION_AUTO_DEBUT: '2026-10-23' }, null))
      .toEqual({ actif: true, debut: '2026-10-23', derniere: null });
    expect(etatRetentionAuto({ RGPD_RETENTION_AUTO: '1' }, { auto: false, auto_debut: null, derniere_execution: '2026-10-20' }))
      .toEqual({ actif: false, debut: null, derniere: '2026-10-20' });
    // Coupée : une ancienne date de début n'est pas affichée
    expect(etatRetentionAuto({ RGPD_RETENTION_AUTO: '0', RGPD_RETENTION_AUTO_DEBUT: '2026-10-23' }, null).debut).toBeNull();
    // Aperçu sans état (ancien serveur) : paramètres
    expect(etatRetentionAuto({ RGPD_RETENTION_AUTO: '0' }, { clients_a_anonymiser: 2 }).actif).toBe(false);
  });
});

// ═══ Configuration : écrans ══════════════════════════════════════

function renderConfig() {
  return render(
    <MemoryRouter initialEntries={['/accueil/config']}>
      <SettingsProvider>
        <ToastProvider><ConfigPage /></ToastProvider>
      </SettingsProvider>
    </MemoryRouter>,
  );
}

const params = (liste) => liste.map(([cle, valeur]) => ({ cle, valeur }));
const envoyes = (n = 0) => Object.fromEntries(apiMock.setParams.mock.calls[n][0].map(p => [p.cle, p.valeur]));

describe('Configuration : onglet Étagère', () => {
  beforeEach(() => {
    localStorage.setItem('klikphone_admin', 'true');
    apiMock.setParams.mockResolvedValue({ ok: true });
  });

  async function ouvrirEtagere(config) {
    apiMock.getConfig.mockResolvedValue(params(config));
    renderConfig();
    fireEvent.click(await screen.findByRole('button', { name: /Étagère/ }));
    await screen.findByRole('heading', { name: /Emplacements de l’étagère/ });
  }

  it('puces éditables, délai légal contrôlé, enregistrement des seules valeurs modifiées', async () => {
    await ouvrirEtagere([['ETAGERE_EMPLACEMENTS', 'A1, A2'], ['tva', '20']]);
    const liste = screen.getByRole('list', { name: 'Emplacements proposés' });
    expect(within(liste).getAllByRole('listitem').map(li => li.textContent)).toEqual(['A1', 'A2']);
    expect(screen.getByLabelText('Paliers de relance (jours)')).toHaveValue(PALIERS_RELANCE_DEFAUT);
    expect(screen.getByText(/Relance proposée à J\+3, J\+10, J\+30, J\+90, J\+180, J\+330\./)).toBeInTheDocument();
    expect(screen.getByText(/Loi du 31\/12\/1903 : 1 an minimum, vente seulement sur autorisation du juge\. Soit 1 an \(par défaut\)\./)).toBeInTheDocument();

    const ajout = screen.getByLabelText('Ajouter des emplacements');
    fireEvent.change(ajout, { target: { value: 'b1, a1' } });
    fireEvent.keyDown(ajout, { key: 'Enter' });
    expect(within(liste).getAllByRole('listitem').map(li => li.textContent)).toEqual(['A1', 'A2', 'B1']);
    expect(screen.getByText('Ajouté : B1 · A1 est déjà dans la liste.')).toHaveAttribute('role', 'status');
    expect(ajout).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Retirer A2' }));
    expect(within(liste).getAllByRole('listitem').map(li => li.textContent)).toEqual(['A1', 'B1']);
    expect(document.activeElement).toBe(ajout);

    const delai = screen.getByLabelText('Délai de garde légal (jours)');
    fireEvent.change(delai, { target: { value: '90' } });
    expect(delai).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getAllByRole('button', { name: /^Enregistrer$/ }).at(-1));
    expect(await screen.findAllByText(/Le délai de garde doit être un nombre entier de jours entre 365/)).not.toHaveLength(0);
    expect(apiMock.setParams).not.toHaveBeenCalled();

    fireEvent.change(delai, { target: { value: '400' } });
    expect(screen.getByText(/Soit 400 jours\./)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^Enregistrer$/ }).at(-1));
    await waitFor(() => expect(apiMock.setParams).toHaveBeenCalledTimes(1));
    expect(envoyes()).toEqual({ ETAGERE_EMPLACEMENTS: 'A1, B1', ETAGERE_DELAI_ABANDON_JOURS: '400' });
    // Les boutons d'emplacement de la fiche et du scan sont relus
    await waitFor(() => expect(apiMock.getEtagereConfig).toHaveBeenCalledWith({ fresh: true }));
  });

  it('paliers vidés : « aucune relance » enregistré ; paliers par défaut rétablis en un clic', async () => {
    await ouvrirEtagere([['ETAGERE_RELANCE_PALIERS', '7, 14']]);
    const champ = screen.getByLabelText('Paliers de relance (jours)');
    expect(champ).toHaveValue('7, 14');
    fireEvent.change(champ, { target: { value: '' } });
    expect(screen.getByText('Aucune relance proposée.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^Enregistrer$/ }).at(-1));
    await waitFor(() => expect(apiMock.setParams).toHaveBeenCalledTimes(1));
    expect(envoyes()).toEqual({ ETAGERE_RELANCE_PALIERS: '' });

    fireEvent.click(screen.getByRole('button', { name: /^Paliers par défaut/ }));
    expect(champ).toHaveValue(PALIERS_RELANCE_DEFAUT);
    expect(screen.queryByRole('button', { name: /^Paliers par défaut/ })).not.toBeInTheDocument();
  });

  it('paliers dans le désordre : envoyés triés sans doublon ; délai vidé : 365 jours envoyés', async () => {
    await ouvrirEtagere([['ETAGERE_DELAI_ABANDON_JOURS', '400']]);
    fireEvent.change(screen.getByLabelText('Paliers de relance (jours)'), { target: { value: '30, 3, 30' } });
    fireEvent.change(screen.getByLabelText('Délai de garde légal (jours)'), { target: { value: '' } });
    expect(screen.getByText(/Soit 1 an \(par défaut\)\./)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^Enregistrer$/ }).at(-1));
    await waitFor(() => expect(apiMock.setParams).toHaveBeenCalledTimes(1));
    expect(envoyes()).toEqual({ ETAGERE_RELANCE_PALIERS: '3, 30', ETAGERE_DELAI_ABANDON_JOURS: '365' });
  });

  it('paliers mal saisis : erreur, enregistrement bloqué ; saisie remise en ordre à la sortie du champ', async () => {
    await ouvrirEtagere([]);
    const champ = screen.getByLabelText('Paliers de relance (jours)');
    fireEvent.change(champ, { target: { value: '30, 3, dix' } });
    expect(champ).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getAllByRole('button', { name: /^Enregistrer$/ }).at(-1));
    await new Promise(r => setTimeout(r, 0));
    expect(apiMock.setParams).not.toHaveBeenCalled();
    fireEvent.change(champ, { target: { value: '30;3 10, 3' } });
    fireEvent.blur(champ);
    expect(champ).toHaveValue('3, 10, 30');
  });
});

describe('Configuration : anonymisation automatique', () => {
  // Serveur simulé : l'activation date elle-même le début, la coupure l'efface (config.py, rgpd.py)
  const DEBUT_SERVEUR = '2099-01-01';
  let serveur;
  beforeEach(() => {
    localStorage.setItem('klikphone_admin', 'true');
    serveur = { auto: false, auto_debut: null };
    apiMock.setParams.mockImplementation(async (liste) => {
      for (const p of liste) {
        if (p.cle === 'RGPD_RETENTION_AUTO') serveur = p.valeur === '1' ? { auto: true, auto_debut: DEBUT_SERVEUR } : { auto: false, auto_debut: null };
      }
      return { ok: true };
    });
    apiMock.rgpdRetentionApercu.mockImplementation(async () => ({
      clients_a_anonymiser: 4, codes_a_purger: 2, retention_mois: 36, purge_codes_jours: 30,
      ...serveur, derniere_execution: null,
    }));
  });

  async function ouvrirRgpd(config) {
    apiMock.getConfig.mockResolvedValue(params(config));
    renderConfig();
    fireEvent.click((await screen.findAllByRole('button', { name: /Mentions & RGPD/ }))[0]);
    return screen.findByRole('switch', { name: 'Anonymisation automatique' });
  }

  it('désactivée par défaut ; activation : aperçu, confirmation forte, J+7 enregistré', async () => {
    const interrupteur = await ouvrirRgpd([['RGPD_RETENTION_MOIS', '36'], ['GARANTIE_MOIS', '6']]);
    expect(interrupteur).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Désactivée : aucune anonymisation automatique.')).toBeInTheDocument();
    // Aucun appel tant que rien n'est demandé (pas d'élévation ouverte)
    expect(apiMock.rgpdRetentionApercu).not.toHaveBeenCalled();

    fireEvent.click(interrupteur);
    await waitFor(() => expect(apiMock.rgpdRetentionApercu).toHaveBeenCalledTimes(1));
    const debut = debutRetentionAuto();
    const groupe = await screen.findByRole('group', { name: 'Activer l\'anonymisation automatique ?' });
    expect(within(groupe).getByText(texteActivationAuto(36, debut))).toBeInTheDocument();
    expect(within(groupe).getByText(/cela concernerait 4 clients ; 2 codes de déverrouillage seraient effacés/)).toBeInTheDocument();
    expect(screen.getByText(/Aujourd’hui : 4 clients sans activité/)).toBeInTheDocument();
    const mot = within(groupe).getByLabelText('Tapez ANONYMISER pour confirmer');
    expect(document.activeElement).toBe(mot);
    const activer = within(groupe).getByRole('button', { name: 'Activer l\'anonymisation automatique' });
    expect(activer).toBeDisabled();
    fireEvent.change(mot, { target: { value: 'anonymis' } });
    expect(activer).toBeDisabled();
    fireEvent.change(mot, { target: { value: 'anonymiser' } });
    expect(activer).toBeEnabled();
    expect(apiMock.setParams).not.toHaveBeenCalled();
    fireEvent.click(activer);
    await waitFor(() => expect(apiMock.setParams).toHaveBeenCalledTimes(1));
    // Seul l'interrupteur est écrit : la date de début est posée par le serveur, puis relue
    expect(envoyes()).toEqual({ RGPD_RETENTION_AUTO: '1' });
    await waitFor(() => expect(interrupteur).toHaveAttribute('aria-checked', 'true'));
    await waitFor(() => expect(apiMock.rgpdRetentionApercu).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(`Activée : première exécution le ${dateFr(DEBUT_SERVEUR)}. D’ici là, rien n’est effacé.`)).toBeInTheDocument();
    expect(screen.getByText('Pas encore exécutée.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Activer l\'anonymisation automatique ?' })).not.toBeInTheDocument();

    // Désactiver : immédiat, sans confirmation
    fireEvent.click(interrupteur);
    await waitFor(() => expect(apiMock.setParams).toHaveBeenCalledTimes(2));
    expect(envoyes(1)).toEqual({ RGPD_RETENTION_AUTO: '0' });
    await waitFor(() => expect(interrupteur).toHaveAttribute('aria-checked', 'false'));
  });

  it('annuler (bouton ou Échap) : rien n’est enregistré', async () => {
    const interrupteur = await ouvrirRgpd([]);
    fireEvent.click(interrupteur);
    let groupe = await screen.findByRole('group', { name: 'Activer l\'anonymisation automatique ?' });
    fireEvent.click(within(groupe).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('group', { name: 'Activer l\'anonymisation automatique ?' })).not.toBeInTheDocument();
    fireEvent.click(interrupteur);
    groupe = await screen.findByRole('group', { name: 'Activer l\'anonymisation automatique ?' });
    fireEvent.keyDown(within(groupe).getByLabelText('Tapez ANONYMISER pour confirmer'), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Activer l\'anonymisation automatique ?' })).not.toBeInTheDocument();
    expect(apiMock.setParams).not.toHaveBeenCalled();
    expect(interrupteur).toHaveAttribute('aria-checked', 'false');
  });

  it('active depuis une date passée : début et dernière exécution lus dans les paramètres', async () => {
    const interrupteur = await ouvrirRgpd([
      ['RGPD_RETENTION_AUTO', '1'], ['RGPD_RETENTION_AUTO_DEBUT', '2020-01-01'], ['RGPD_RETENTION_DERNIERE', '2020-01-02'],
    ]);
    expect(interrupteur).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Activée depuis le 01/01/2020 : un passage par jour.')).toBeInTheDocument();
    expect(screen.getByText('Dernière exécution : 02/01/2020')).toBeInTheDocument();
  });

  it('élévation déjà ouverte : l’état réel du serveur est lu sans fenêtre d’identification', async () => {
    apiMock.hasAdminToken.mockReturnValue(true);
    apiMock.rgpdRetentionApercu.mockResolvedValue({
      clients_a_anonymiser: 1, codes_a_purger: 0, retention_mois: 36,
      auto: true, auto_debut: '2020-03-01', derniere_execution: '2020-03-05',
    });
    const interrupteur = await ouvrirRgpd([]);
    await waitFor(() => expect(interrupteur).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByText('Activée depuis le 01/03/2020 : un passage par jour.')).toBeInTheDocument();
    expect(screen.getByText('Dernière exécution : 05/03/2020')).toBeInTheDocument();
    expect(screen.getByText(/Aujourd’hui : 1 client sans activité au-delà de la durée de conservation, 0 code de déverrouillage à effacer\./))
      .toBeInTheDocument();
  });

  it('durées modifiées non enregistrées : activation impossible tant qu’elles ne le sont pas', async () => {
    const interrupteur = await ouvrirRgpd([['RGPD_RETENTION_MOIS', '36']]);
    fireEvent.change(screen.getByLabelText('Conservation des données clients (mois)'), { target: { value: '48' } });
    expect(interrupteur).toBeDisabled();
    expect(screen.getByText(/Enregistrez d'abord les nouvelles durées pour activer/)).toBeInTheDocument();
  });
});
