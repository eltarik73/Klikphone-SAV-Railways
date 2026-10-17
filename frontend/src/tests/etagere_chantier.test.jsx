/**
 * Chantier étagère : emplacement physique (EmplacementInput), relances graduées depuis
 * l'étagère (RelanceClient : SMS, WhatsApp, e-mail, « J'ai appelé »), délai légal d'un an
 * et courrier de mise en demeure à partir de J+90. « Client contacté » sur chaque ligne
 * (ContactClient, POST /api/tickets/{id}/contact pour l'appel).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';

const { toast, apiMock } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  apiMock: {
    getDashboard: vi.fn(),
    getEtagereConfig: vi.fn(),
    getSmsEtat: vi.fn(),
    setEmplacement: vi.fn(),
    logRelance: vi.fn(),
    getMessageRelance: vi.fn(),
    envoyerSms: vi.fn(),
    envoyerEmail: vi.fn(),
    getMiseEnDemeureHtml: vi.fn(),
    contacterClient: vi.fn(),
  },
}));

vi.mock('../components/Toast', () => ({ useToast: () => toast }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { clearCache } from '../hooks/useApi';
import EtagereARecuperer from '../components/EtagereARecuperer';
import EmplacementInput from '../components/EmplacementInput';
import {
  DELAI_ABANDON_JOURS, appliquerRelance, compterRelancesDues, contenuRelance, delaiAbandon, filtrerEtagere,
  formatDelai, grouperParEmplacement, libelleRelances, listeEmplacements, messageRelanceSecours,
  miseEnDemeureProposee, normaliserEmplacement, trierEtagere,
} from '../lib/etagere';
import { versionCourteSms } from '../lib/sms';

// ─── Règles pures ────────────────────────────────────────────────────────────

describe('délai légal d’abandon', () => {
  it('un an par défaut (loi du 31 décembre 1903), affiché en années, mois ou jours', () => {
    expect(DELAI_ABANDON_JOURS).toBe(365);
    expect(formatDelai(365)).toBe('1 an');
    expect(formatDelai(730)).toBe('2 ans');
    expect(formatDelai(90)).toBe('3 mois');
    expect(formatDelai(45)).toBe('45 jours');
    expect(formatDelai(undefined)).toBe('1 an');
  });

  it('délai de la vue, sinon de la configuration, sinon un an', () => {
    expect(delaiAbandon({ delai_abandon_jours: 400 }, { delai_abandon_jours: 200 })).toBe(400);
    expect(delaiAbandon({}, { delai_abandon_jours: 200 })).toBe(200);
    expect(delaiAbandon(null, null)).toBe(365);
    expect(delaiAbandon({ delai_abandon_jours: 0 }, { delai_abandon_jours: 'abc' })).toBe(365);
  });
});

describe('emplacement', () => {
  it('normalisé comme le serveur : rogné, majuscules, 20 caractères, null si vide', () => {
    expect(normaliserEmplacement('  b3 ')).toBe('B3');
    expect(normaliserEmplacement('étagère   2')).toBe('ÉTAGÈRE 2');
    expect(normaliserEmplacement('   ')).toBeNull();
    expect(normaliserEmplacement(null)).toBeNull();
    expect(normaliserEmplacement('x'.repeat(30))).toHaveLength(20);
  });

  it('emplacements proposés : liste ou texte séparé par des virgules, sans doublon', () => {
    expect(listeEmplacements({ emplacements: ['b1', ' B1', 'A2', ''] })).toEqual(['B1', 'A2']);
    expect(listeEmplacements({ emplacements: 'A1, a2,,B3' })).toEqual(['A1', 'A2', 'B3']);
    expect(listeEmplacements(null)).toEqual([]);
  });

  it('groupes dans l’ordre naturel (A2 avant A10), sans emplacement en dernier', () => {
    const g = grouperParEmplacement([
      { id: 1, emplacement: 'A10' }, { id: 2, emplacement: null }, { id: 3, emplacement: 'a2' },
      { id: 4, emplacement: 'B1' }, { id: 5, emplacement: 'A2' },
    ]);
    expect(g.map((x) => x.emplacement)).toEqual(['A2', 'A10', 'B1', null]);
    expect(g[0].tickets.map((t) => t.id)).toEqual([3, 5]);
  });
});

describe('recherche, tri et relances', () => {
  const LISTE = [
    { id: 1, emplacement: 'B3', client_prenom: 'Léa', client_nom: 'Martin', client_tel: '06 12 34 56 78', relance_due: false },
    { id: 2, emplacement: 'A1', client_prenom: 'Hugo', client_nom: 'Bernard', ticket_code: 'KP-000002', relance_due: true },
    { id: 3, emplacement: null, client_prenom: 'Zoé', client_nom: 'Petit', marque: 'Samsung', relance_due: true },
  ];

  it('recherche par emplacement, client sans accent, ticket, appareil ou téléphone', () => {
    expect(filtrerEtagere(LISTE, 'b3').map((t) => t.id)).toEqual([1]);
    expect(filtrerEtagere(LISTE, 'lea martin').map((t) => t.id)).toEqual([1]);
    expect(filtrerEtagere(LISTE, 'KP-000002').map((t) => t.id)).toEqual([2]);
    expect(filtrerEtagere(LISTE, 'samsung').map((t) => t.id)).toEqual([3]);
    expect(filtrerEtagere(LISTE, '3456').map((t) => t.id)).toEqual([1]);
    expect(filtrerEtagere(LISTE, '  ')).toHaveLength(3);
  });

  it('relances à faire d’abord, ordre du serveur gardé de chaque côté', () => {
    expect(trierEtagere(LISTE, 'relances').map((t) => t.id)).toEqual([2, 3, 1]);
    expect(trierEtagere(LISTE, 'anciens').map((t) => t.id)).toEqual([1, 2, 3]);
    expect(compterRelancesDues(LISTE)).toBe(2);
  });

  it('ligne après relance : réponse du serveur, ou compteur + 1 pour un SMS déjà noté par le serveur', () => {
    const t = { id: 2, nb_relances: 1, derniere_relance: '2026-10-01T09:00:00', relance_due: true };
    expect(appliquerRelance(t, { nb_relances: 2, derniere_relance: '2026-10-16T08:00:00' }))
      .toMatchObject({ nb_relances: 2, derniere_relance: '2026-10-16T08:00:00', relance_due: false });
    const maintenant = new Date('2026-10-16T10:00:00Z');
    expect(appliquerRelance(t, null, maintenant))
      .toMatchObject({ nb_relances: 2, derniere_relance: maintenant.toISOString(), relance_due: false });
    expect(appliquerRelance({ id: 3 }, null, maintenant).nb_relances).toBe(1);
  });

  it('libellés des relances, mise en demeure à partir de J+90 en boutique, contenu tracé court', () => {
    const f = () => '12/10/2026';
    expect(libelleRelances(undefined, null, f)).toBeNull();
    expect(libelleRelances(0, null, f)).toBe('Aucune relance');
    expect(libelleRelances(1, 'x', f)).toBe('1 relance le 12/10/2026');
    expect(libelleRelances(3, 'x', f)).toBe('3 relances, dernière le 12/10/2026');
    expect(miseEnDemeureProposee({ statut: 'Réparation terminée', jours_attente: 89 })).toBe(false);
    expect(miseEnDemeureProposee({ statut: 'Réparation terminée', jours_attente: 90 })).toBe(true);
    expect(miseEnDemeureProposee({ statut: 'Rendu au client', jours_attente: 200 })).toBe(false);
    expect(miseEnDemeureProposee({ statut: 'Réparation terminée', jours_attente: 60 }, 60)).toBe(true);
    const c = contenuRelance('a'.repeat(500), 12);
    expect(c.startsWith('[Relance J+12] ')).toBe(true);
    expect(c.length).toBeLessThanOrEqual(215);
    expect(messageRelanceSecours({ client_prenom: 'Léa', marque: 'Apple', modele: 'iPhone 13', jours_attente: 12 }))
      .toMatch(/^Bonjour Léa, votre Apple iPhone 13 est réparé et vous attend chez Klikphone depuis 12 jours\./);
  });
});

// ─── Étagère ─────────────────────────────────────────────────────────────────

function ligne(id, statut, extra = {}) {
  return {
    id, statut, ticket_code: `KP-${String(id).padStart(6, '0')}`,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '0612345678', client_email: '',
    marque: 'Apple', modele: 'iPhone 13', date_depot: '2026-06-10 09:00:00', ...extra,
  };
}

const VUE = {
  kpi: { a_recuperer: 4 },
  total: 4,
  delai_abandon_jours: 365,
  tickets: [
    ligne(21, 'Réparation terminée', {
      jours_attente: 95, fin_reparation: '2026-07-13T10:00:00', emplacement: 'B3',
      nb_relances: 2, derniere_relance: '2026-10-12T09:00:00', relance_due: false,
      contact: {
        depuis_statut: true, dernier: { canal: 'sms', date: '2026-10-12T09:00:00', auteur: 'Léa' },
        canaux: { sms: '2026-10-12T09:00:00', email: null, whatsapp: '2026-10-01T09:00:00', appel: null },
      },
    }),
    ligne(22, 'Réparation terminée', {
      jours_attente: 40, fin_reparation: '2026-09-06T10:00:00', emplacement: null,
      nb_relances: 1, derniere_relance: '2026-09-20T09:00:00', relance_due: true, client_email: 'lea@example.test',
    }),
    ligne(23, 'Réparation terminée', {
      jours_attente: 4, fin_reparation: '2026-10-12T10:00:00', emplacement: 'A1', nb_relances: 0,
      derniere_relance: null, relance_due: true, client_prenom: 'Hugo', client_nom: 'Bernard',
    }),
    ligne(24, 'Rendu au client', { jours_attente: 12, fin_reparation: '2026-10-04T10:00:00', reste_du: 40, nb_relances: 0 }),
  ],
};

const MESSAGE = 'Bonjour Léa, votre Apple iPhone 13 vous attend chez Klikphone depuis 40 jours. Lundi-Samedi 10h-19h';

function rendre() {
  return render(
    <EtagereARecuperer id="etagere" basePath="/accueil" onOpenTicket={vi.fn()} onRemettre={vi.fn()} onClose={vi.fn()} />,
  );
}

async function etagere() {
  rendre();
  const region = await screen.findByRole('region', { name: 'À récupérer' });
  await within(region).findByText('KP-000021');
  // Config et état SMS (promesses résolues) arrivés avant les clics
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return region;
}

function enBoutique(region) {
  return within(region).getByRole('region', { name: /En boutique/ });
}

function rangee(region, code) {
  return within(region).getByRole('link', { name: code }).closest('li');
}

beforeEach(() => {
  clearCache();
  vi.clearAllMocks();
  localStorage.clear();
  window.open = vi.fn();
  apiMock.getDashboard.mockResolvedValue(structuredClone(VUE));
  apiMock.getEtagereConfig.mockResolvedValue({ emplacements: ['A1', 'B3', 'C1'], delai_abandon_jours: 365, relance_paliers: [3, 10, 30, 90, 180, 330] });
  apiMock.getSmsEtat.mockResolvedValue({ disponible: false });
  apiMock.getMessageRelance.mockResolvedValue({ message: MESSAGE, jours: 40 });
  apiMock.logRelance.mockResolvedValue({ nb_relances: 2, derniere_relance: '2026-10-16T08:00:00' });
  apiMock.contacterClient.mockImplementation(async () => ({
    note_id: 99,
    contact: {
      depuis_statut: true, dernier: { canal: 'appel', date: '2026-10-16T08:05:00Z', auteur: 'Sophie' },
      canaux: { sms: null, email: null, whatsapp: null, appel: '2026-10-16T08:05:00Z' },
    },
  }));
  apiMock.setEmplacement.mockImplementation(async (_id, e) => ({ emplacement: e }));
});

afterEach(() => cleanup());

describe('EtagereARecuperer : lignes', () => {
  it('emplacement en gros, J+N, relances, badge « Relance à faire », délai légal réel', async () => {
    const region = await etagere();
    expect(within(region).getByText(/Délai d’abandon : 1 an après la fin de réparation, puis vente seulement sur autorisation du juge/)).toBeInTheDocument();
    expect(within(region).queryByText(/3 mois/)).not.toBeInTheDocument();
    expect(within(region).getByText('2 relances à faire.')).toBeInTheDocument();

    const r21 = rangee(region, 'KP-000021');
    expect(within(r21).getByRole('button', { name: 'Emplacement B3, modifier' })).toHaveTextContent('B3');
    expect(within(r21).getByText('J+95')).toBeInTheDocument();
    expect(within(r21).getByText('2 relances, dernière le 12/10/2026')).toBeInTheDocument();
    expect(within(r21).queryByText('Relance à faire')).not.toBeInTheDocument();
    // 95 jours < 1 an : délai d'abandon pas encore atteint, mais courrier proposé dès J+90
    expect(within(r21).queryByText('Délai d’abandon atteint')).not.toBeInTheDocument();
    expect(within(r21).getByRole('button', { name: 'Courrier de mise en demeure KP-000021' })).toBeInTheDocument();

    const r22 = rangee(region, 'KP-000022');
    expect(within(r22).getByRole('button', { name: 'Emplacement non renseigné, ranger l’appareil' })).toHaveTextContent('Ranger');
    expect(within(r22).getByText('Relance à faire')).toBeInTheDocument();
    expect(within(r22).getByText('1 relance le 20/09/2026')).toBeInTheDocument();
    expect(within(r22).queryByRole('button', { name: /mise en demeure/i })).not.toBeInTheDocument();

    // Rendus non payés : ni emplacement ni relance d'appareil à récupérer
    const impayes = within(region).getByRole('region', { name: /Rendus non payés/ });
    expect(within(impayes).queryByRole('button', { name: /Relancer/ })).not.toBeInTheDocument();
    expect(within(impayes).queryByRole('button', { name: /Emplacement/ })).not.toBeInTheDocument();
    expect(within(impayes).getByText('Aucune relance')).toBeInTheDocument();
  });

  it('ordre « Relances à faire d’abord » mémorisé, groupement et recherche par emplacement', async () => {
    const region = await etagere();
    const codes = () => within(enBoutique(region)).getAllByRole('link').map((a) => a.textContent);
    expect(codes()).toEqual(['KP-000021', 'KP-000022', 'KP-000023']);

    fireEvent.click(within(region).getByRole('button', { name: 'Relances à faire d’abord (2)' }));
    expect(codes()).toEqual(['KP-000022', 'KP-000023', 'KP-000021']);
    expect(localStorage.getItem('kp_etagere_ordre')).toBe('relances');

    fireEvent.click(within(region).getByRole('button', { name: 'Par emplacement' }));
    const groupes = within(enBoutique(region)).getAllByRole('group', { name: /emplacement/i });
    expect(groupes.map((g) => g.getAttribute('aria-label'))).toEqual(['Emplacement A1', 'Emplacement B3', 'Sans emplacement']);
    expect(within(groupes[0]).getByText('KP-000023')).toBeInTheDocument();

    fireEvent.change(within(region).getByRole('searchbox', { name: 'Chercher dans l’étagère' }), { target: { value: 'b3' } });
    expect(codes()).toEqual(['KP-000021']);
    expect(within(region).queryByRole('region', { name: /Rendus non payés/ })).not.toBeInTheDocument();
    fireEvent.change(within(region).getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(within(region).getByText('Aucun appareil ne correspond à « zzz ».')).toBeInTheDocument();
  });
});

async function ouvrirRelance(region, code) {
  const r = rangee(region, code);
  fireEvent.click(within(r).getByRole('button', { name: `Relancer ${code}` }));
  const panneau = within(r).getByRole('group', { name: `Relancer le client du ticket ${code}` });
  await within(panneau).findByDisplayValue(MESSAGE);
  return { r, panneau };
}

describe('EtagereARecuperer : relancer en deux clics', () => {
  it('WhatsApp : message du palier, wa.me ouvert, relance tracée, ligne mise à jour sans recharger', async () => {
    const region = await etagere();
    const { r, panneau } = await ouvrirRelance(region, 'KP-000022');
    expect(apiMock.getMessageRelance).toHaveBeenCalledWith(22);
    expect(within(r).getByRole('button', { name: 'Relancer KP-000022' })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(within(panneau).getByRole('button', { name: /WhatsApp/ }));
    expect(window.open).toHaveBeenCalledWith(`https://wa.me/33612345678?text=${encodeURIComponent(MESSAGE)}`, '_blank', 'noopener');
    await waitFor(() => expect(apiMock.logRelance).toHaveBeenCalledWith(22, 'whatsapp', `[Relance J+40] ${MESSAGE}`));

    await waitFor(() => expect(within(r).getByText('2 relances, dernière le 16/10/2026')).toBeInTheDocument());
    expect(within(r).queryByText('Relance à faire')).not.toBeInTheDocument();
    expect(within(r).queryByRole('group', { name: /Relancer le client/ })).not.toBeInTheDocument();
    expect(within(region).getByText('1 relance à faire.')).toBeInTheDocument();
    expect(apiMock.getDashboard).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Relance WhatsApp notée');
  });

  it('SMS envoyé par le serveur : version courte, déjà noté par le serveur (pas de double trace)', async () => {
    apiMock.getSmsEtat.mockResolvedValue({ disponible: true });
    apiMock.envoyerSms.mockResolvedValue({ ok: true, segments: 1, destinataire: '06 12 34 56 78' });
    const region = await etagere();
    const { r, panneau } = await ouvrirRelance(region, 'KP-000022');
    fireEvent.click(within(panneau).getByRole('button', { name: /^SMS$/ }));
    await waitFor(() => expect(apiMock.envoyerSms).toHaveBeenCalledWith(22, versionCourteSms(MESSAGE), 'Relance'));
    expect(apiMock.logRelance).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    await waitFor(() => expect(within(r).getByText(/^2 relances, dernière le /)).toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith('SMS envoyé au 06 12 34 56 78');
  });

  it('SMS sans envoi serveur : lien sms: puis relance tracée en « sms »', async () => {
    const region = await etagere();
    const { panneau } = await ouvrirRelance(region, 'KP-000022');
    fireEvent.click(within(panneau).getByRole('button', { name: /^SMS$/ }));
    expect(window.open.mock.calls[0][0]).toMatch(/^sms:0612345678\?body=/);
    await waitFor(() => expect(apiMock.logRelance).toHaveBeenCalledWith(22, 'sms', `[Relance J+40] ${versionCourteSms(MESSAGE)}`));
    expect(apiMock.envoyerSms).not.toHaveBeenCalled();
  });

  it('e-mail envoyé par l’app puis tracé ; bouton indisponible sans adresse', async () => {
    apiMock.envoyerEmail.mockResolvedValue({ status: 'ok' });
    const region = await etagere();
    const { panneau } = await ouvrirRelance(region, 'KP-000022');
    fireEvent.click(within(panneau).getByRole('button', { name: /E-mail/ }));
    await waitFor(() => expect(apiMock.envoyerEmail).toHaveBeenCalledWith(
      'lea@example.test', 'Klikphone - Votre appareil vous attend (KP-000022)', MESSAGE,
    ));
    await waitFor(() => expect(apiMock.logRelance).toHaveBeenCalledWith(22, 'email', `[Relance J+40] ${MESSAGE}`));

    const { panneau: p23 } = await ouvrirRelance(region, 'KP-000023');
    expect(within(p23).getByRole('button', { name: /E-mail/ })).toBeDisabled();
    expect(within(p23).getByText('Pas d’adresse e-mail.')).toBeInTheDocument();
  });

  it('e-mail refusé : rien n’est tracé, la ligne ne bouge pas', async () => {
    apiMock.envoyerEmail.mockResolvedValue({ status: 'error', message: 'SMTP non configuré' });
    const region = await etagere();
    const { r, panneau } = await ouvrirRelance(region, 'KP-000022');
    fireEvent.click(within(panneau).getByRole('button', { name: /E-mail/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('SMTP non configuré'));
    expect(apiMock.logRelance).not.toHaveBeenCalled();
    expect(within(r).getByText('Relance à faire')).toBeInTheDocument();
  });

  it('« J’ai appelé » avec la note d’appel, Échap referme le panneau', async () => {
    const region = await etagere();
    const { r, panneau } = await ouvrirRelance(region, 'KP-000022');
    fireEvent.change(within(panneau).getByLabelText('Note d’appel (facultatif)'), { target: { value: 'passe samedi' } });
    fireEvent.click(within(panneau).getByRole('button', { name: /J’ai appelé/ }));
    // Même note 'appel' que « Contacté par tél. » partout ailleurs (POST /api/tickets/{id}/contact)
    await waitFor(() => expect(apiMock.contacterClient).toHaveBeenCalledWith(22, 'passe samedi'));
    expect(apiMock.logRelance).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Appel noté'));
    // L'appel compte comme une relance et allume l'icône téléphone de la ligne
    await waitFor(() => expect(within(r).getByText(/^2 relances, dernière le /)).toBeInTheDocument());
    expect(within(r).getByText(/^Contacté par téléphone le /)).toBeInTheDocument();

    const { panneau: p2 } = await ouvrirRelance(region, 'KP-000023');
    fireEvent.keyDown(within(p2).getByRole('textbox', { name: /Message de relance/ }), { key: 'Escape' });
    expect(within(rangee(region, 'KP-000023')).queryByRole('group', { name: /Relancer le client/ })).not.toBeInTheDocument();
    expect(r).toBeInTheDocument();
  });

  it('modèle indisponible : texte de secours modifiable', async () => {
    apiMock.getMessageRelance.mockRejectedValue(new Error('404'));
    const region = await etagere();
    const r = rangee(region, 'KP-000022');
    fireEvent.click(within(r).getByRole('button', { name: 'Relancer KP-000022' }));
    expect(await within(r).findByText(/Modèle indisponible, texte de secours/)).toBeInTheDocument();
    expect(within(r).getByRole('textbox', { name: /Message de relance/ }).value).toMatch(/^Bonjour Léa, votre Apple iPhone 13 est réparé/);
  });
});

describe('EtagereARecuperer : client contacté sur chaque ligne', () => {
  it('icônes allumées selon le contact depuis la fin de réparation, dernier contact en clair', async () => {
    const region = await etagere();
    const r21 = rangee(region, 'KP-000021');
    expect(within(r21).getByText(/^Contacté par SMS le 12\/10 à /)).toBeInTheDocument();
    expect(within(r21).getByText(/^SMS envoyé le 12\/10 à .* par Léa$/)).toBeInTheDocument();
    expect(within(r21).getByText(/^WhatsApp envoyé le 01\/10 à /)).toBeInTheDocument();
    expect(within(r21).getByTitle("Pas d'appel depuis le dernier changement de statut")).toBeInTheDocument();
    expect(within(rangee(region, 'KP-000023')).getByText('Pas encore contacté')).toBeInTheDocument();
  });

  it('« Contacté par tél. » note l’appel, met la ligne à jour sans recharger et compte une relance', async () => {
    const region = await etagere();
    const r23 = rangee(region, 'KP-000023');
    expect(within(r23).getByText('Relance à faire')).toBeInTheDocument();
    fireEvent.click(within(r23).getByRole('button', { name: 'Contacté par tél.' }));
    await waitFor(() => expect(apiMock.contacterClient).toHaveBeenCalledWith(23));
    await waitFor(() => expect(within(r23).getByText(/^Contacté par téléphone le 16\/10 à /)).toBeInTheDocument());
    expect(within(r23).getByText(/^Appel passé le 16\/10 à .* par Sophie$/)).toBeInTheDocument();
    expect(within(r23).getByText(/^1 relance le /)).toBeInTheDocument();
    expect(within(r23).queryByText('Relance à faire')).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Appel noté');
    expect(apiMock.getDashboard).toHaveBeenCalledTimes(1);
    // Une relance WhatsApp tracée allume aussi son icône
    const { panneau } = await ouvrirRelance(region, 'KP-000022');
    fireEvent.click(within(panneau).getByRole('button', { name: /WhatsApp/ }));
    await waitFor(() => expect(within(rangee(region, 'KP-000022')).getByText(/^Contacté par WhatsApp le /)).toBeInTheDocument());
  });
});

describe('EtagereARecuperer : emplacement et mise en demeure', () => {
  it('emplacement rangé sur place : bouton proposé ou saisie, ligne mise à jour', async () => {
    const region = await etagere();
    const r = rangee(region, 'KP-000022');
    fireEvent.click(within(r).getByRole('button', { name: 'Emplacement non renseigné, ranger l’appareil' }));
    const editeur = within(r).getByRole('dialog', { name: 'Emplacement de l’appareil' });
    expect(within(editeur).getAllByRole('button').map((b) => b.textContent)).toEqual(expect.arrayContaining(['A1', 'B3', 'C1']));
    fireEvent.click(within(editeur).getByRole('button', { name: 'C1' }));
    await waitFor(() => expect(apiMock.setEmplacement).toHaveBeenCalledWith(22, 'C1'));
    await waitFor(() => expect(within(r).getByRole('button', { name: 'Emplacement C1, modifier' })).toBeInTheDocument());
    expect(within(r).queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(within(r).getByRole('button', { name: 'Emplacement C1, modifier' }));
    const champ = within(r).getByRole('textbox', { name: 'Emplacement' });
    fireEvent.change(champ, { target: { value: ' étagère 2 ' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    await waitFor(() => expect(apiMock.setEmplacement).toHaveBeenLastCalledWith(22, 'ÉTAGÈRE 2'));
    await waitFor(() => expect(within(r).getByRole('button', { name: 'Emplacement ÉTAGÈRE 2, modifier' })).toBeInTheDocument());
    expect(apiMock.getDashboard).toHaveBeenCalledTimes(1);
  });

  it('mise en demeure : aperçu imprimable du courrier A4', async () => {
    apiMock.getMiseEnDemeureHtml.mockResolvedValue('<html><body>Mise en demeure</body></html>');
    const region = await etagere();
    fireEvent.click(within(rangee(region, 'KP-000021')).getByRole('button', { name: 'Courrier de mise en demeure KP-000021' }));
    expect(await screen.findByRole('dialog', { name: /Mise en demeure/ })).toBeInTheDocument();
    await waitFor(() => expect(apiMock.getMiseEnDemeureHtml).toHaveBeenCalledWith(21, expect.objectContaining({ signal: expect.anything() })));
  });
});

describe('EmplacementInput (fiche, scan « Terminé »)', () => {
  it('champ court : enregistré à la sortie du champ, boutons proposés, retrait', async () => {
    const onSaved = vi.fn();
    const { rerender } = render(<EmplacementInput ticketId={7} value={null} onSaved={onSaved} />);
    const champ = screen.getByRole('textbox', { name: 'Emplacement' });
    await screen.findByRole('button', { name: 'B3' });
    fireEvent.change(champ, { target: { value: 'd4' } });
    expect(champ.value).toBe('D4');
    fireEvent.blur(champ);
    await waitFor(() => expect(apiMock.setEmplacement).toHaveBeenCalledWith(7, 'D4'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('D4'));
    expect(await screen.findByText('Rangé en D4')).toBeInTheDocument();

    rerender(<EmplacementInput ticketId={7} value="D4" onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer l’emplacement D4' }));
    await waitFor(() => expect(apiMock.setEmplacement).toHaveBeenLastCalledWith(7, null));
    expect(await screen.findByText('Emplacement retiré')).toBeInTheDocument();
  });

  it('Safari : bouton proposé cliqué pendant la saisie, une seule écriture (celle du bouton)', async () => {
    render(<EmplacementInput ticketId={9} value={null} emplacements={['A2', 'B3']} />);
    const champ = screen.getByRole('textbox', { name: 'Emplacement' });
    const a2 = screen.getByRole('button', { name: 'A2' });
    champ.focus();
    fireEvent.change(champ, { target: { value: 'b' } });
    // Le champ garde le focus : pas de sortie sans relatedTarget avant le clic
    expect(fireEvent.mouseDown(a2)).toBe(false);
    expect(document.activeElement).toBe(champ);
    fireEvent.click(a2);
    expect(champ.value).toBe('A2');
    fireEvent.blur(champ);
    await waitFor(() => expect(apiMock.setEmplacement).toHaveBeenCalledWith(9, 'A2'));
    expect(await screen.findByText('Rangé en A2')).toBeInTheDocument();
    expect(apiMock.setEmplacement).toHaveBeenCalledTimes(1);
  });

  it('clavier : saisie gardée en passant sur les boutons, enregistrée à la sortie du bloc', async () => {
    render(
      <>
        <EmplacementInput ticketId={10} value="A1" emplacements={['B3']} />
        <button type="button">Après</button>
      </>,
    );
    const champ = screen.getByRole('textbox', { name: 'Emplacement' });
    const b3 = screen.getByRole('button', { name: 'B3' });
    fireEvent.change(champ, { target: { value: 'c7' } });
    fireEvent.blur(champ, { relatedTarget: b3 });
    expect(apiMock.setEmplacement).not.toHaveBeenCalled();
    fireEvent.blur(b3, { relatedTarget: screen.getByRole('button', { name: 'Après' }) });
    await waitFor(() => expect(apiMock.setEmplacement).toHaveBeenCalledWith(10, 'C7'));
    expect(apiMock.setEmplacement).toHaveBeenCalledTimes(1);
    // Mouvement de souris sans focus dans le bloc : le bouton reçoit le focus normalement
    champ.blur();
    expect(fireEvent.mouseDown(b3)).toBe(true);
  });

  it('erreur du serveur affichée, Échap annule la saisie', async () => {
    apiMock.setEmplacement.mockRejectedValue(new Error('Ticket introuvable'));
    render(<EmplacementInput ticketId={8} value="A1" emplacements={[]} />);
    const champ = screen.getByRole('textbox', { name: 'Emplacement' });
    fireEvent.change(champ, { target: { value: 'Z9' } });
    fireEvent.keyDown(champ, { key: 'Escape' });
    expect(champ.value).toBe('A1');
    fireEvent.change(champ, { target: { value: 'Z9' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    expect(await screen.findByText('Non enregistré : Ticket introuvable')).toBeInTheDocument();
    expect(champ).toHaveAttribute('aria-invalid', 'true');
    expect(apiMock.getEtagereConfig).not.toHaveBeenCalled();
  });
});
