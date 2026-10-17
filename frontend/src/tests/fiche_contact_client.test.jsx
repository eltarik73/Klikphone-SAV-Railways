/**
 * Fiche ticket : rubrique « Client contacté » sous l'en-tête (icônes allumées selon ticket.contact,
 * « Contacté par tél. » → POST /api/tickets/{id}/contact puis note « appel » relue) et mention
 * « à chiffrer par la boutique » sur une ligne de reprise encore à 0 € dans « Réparation & Tarifs ».
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
  return { auth: { user: { target: 'accueil', utilisateur: 'Sophie', role: '' } }, apiMock };
});

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { ToastProvider } from '../components/Toast';
import { clearCache } from '../hooks/useApi';
import TicketDetailPage from '../pages/TicketDetailPage';
import { definirCatalogue } from '../lib/prestations';

// Horodatages naïfs du serveur (UTC), affichés en heure locale comme à l'écran
const SMS = '2026-10-17T12:32:00';
const APPEL = '2026-10-17T13:05:00';
const APPEL_2 = '2026-10-17T15:40:00';
const heure = (iso) => {
  const d = new Date(`${iso}Z`);
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

const CONTACT_SMS_APPEL = {
  depuis_statut: true,
  dernier: { canal: 'appel', date: APPEL, auteur: 'Léa' },
  canaux: { sms: SMS, email: null, whatsapp: null, appel: APPEL },
};
const CONTACT_SMS = {
  depuis_statut: true,
  dernier: { canal: 'sms', date: SMS, auteur: 'Léa' },
  canaux: { sms: SMS, email: null, whatsapp: null, appel: null },
};
const NOTE_APPEL = {
  id: 77, type_note: 'appel', auteur: 'Sophie', date_creation: APPEL_2,
  contenu: 'Appel téléphonique — client contacté', important: 0,
};

// Extrait de GET /api/catalog/prestations (backend/app/services/prestations.py)
const MENTION = 'à chiffrer par la boutique';
const REPRISE = "Reprise de l'appareil (rachat)";
const CATALOGUE = {
  pannes: ['Écran cassé', 'Reprise téléphone', 'Nettoyage'],
  prestations: [
    { cle: 'ecran', symptome: 'Écran cassé', prestation: 'Forfait remplacement écran', court: 'Écran', alias: ['Écran HS'], a_chiffrer: false },
    { cle: 'reprise', symptome: 'Reprise téléphone', prestation: REPRISE, court: 'Reprise', alias: ['Rachat'], a_chiffrer: true },
    { cle: 'nettoyage', symptome: 'Nettoyage', prestation: 'Nettoyage connecteur de charge', court: 'Nettoyage', alias: [], a_chiffrer: false },
  ],
  mention_a_chiffrer: MENTION,
};

function ticket(overrides = {}) {
  return {
    id: 42, ticket_code: 'KP-000042', statut: 'Réparation terminée', client_id: 5,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '0612345678', client_email: '',
    tel_contact: null, contact: null,
    categorie: 'Smartphone', marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé', imei: '',
    date_depot: '2026-10-10T09:00:00', paye: 0, acompte: 0, devis_estime: 0, priorite: 'normal',
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

const boutonAppel = () => screen.findByRole('button', { name: 'Contacté par tél.' });
// La rubrique entière : le conteneur du bouton « Contacté par tél. »
const rubrique = async () => (await boutonAppel()).parentElement;
const carteReparation = () => screen.getByRole('heading', { name: 'Réparation & Tarifs' }).closest('section');
const ligneDe = (label) => within(carteReparation()).getByText(label, { selector: 'span' }).closest('.flex.justify-between');

let courant;
let notes;

beforeEach(() => {
  clearCache();
  definirCatalogue(null);
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* stockage indisponible */ }
  auth.user = { target: 'accueil', utilisateur: 'Sophie', role: '' };
  for (const fn of Object.values(apiMock)) fn.mockReset().mockResolvedValue([]);
  courant = ticket();
  notes = [];
  apiMock.getTicket.mockImplementation(async () => ({ ...courant }));
  apiMock.getNotes.mockImplementation(async () => notes.map((n) => ({ ...n })));
  apiMock.markTicketRead.mockResolvedValue({ ok: true });
  apiMock.addHistory.mockResolvedValue({ ok: true });
  apiMock.updateTicket.mockImplementation(async (id, patch) => {
    courant = { ...courant, ...patch };
    return { ok: true, ticket: { ...courant } };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Fiche ticket — rubrique « Client contacté »', () => {
  it('icônes allumées selon contact.canaux, dernier contact en clair, bouton 44 px', async () => {
    courant = ticket({ contact: CONTACT_SMS_APPEL });
    renderFiche();
    const r = await rubrique();
    expect(within(r).getByText(`Contacté par téléphone le ${heure(APPEL)}`)).toBeInTheDocument();
    // SMS et appel allumés (info-bulle datée), e-mail et WhatsApp éteints
    expect(within(r).getByTitle(`SMS envoyé le ${heure(SMS)}`)).toBeInTheDocument();
    expect(within(r).getByTitle(`Appel passé le ${heure(APPEL)} par Léa`)).toBeInTheDocument();
    expect(within(r).getByTitle("Pas d'e-mail depuis le dernier changement de statut")).toBeInTheDocument();
    expect(within(r).getByTitle('Pas de WhatsApp depuis le dernier changement de statut')).toBeInTheDocument();
    const bouton = within(r).getByRole('button', { name: 'Contacté par tél.' });
    expect(bouton).toBeEnabled();
    expect(bouton.className).toContain('min-h-11');
    // Une seule rubrique dans la fiche, placée avant les cartes (sous l'en-tête)
    expect(screen.getAllByRole('button', { name: 'Contacté par tél.' })).toHaveLength(1);
    const enTete = screen.getByRole('heading', { level: 1, name: 'KP-000042' });
    expect(enTete.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(r.compareDocumentPosition(carteReparation()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sans contact depuis le dernier statut : « Pas encore contacté », aucune icône allumée', async () => {
    renderFiche();
    const r = await rubrique();
    expect(within(r).getByText('Pas encore contacté')).toBeInTheDocument();
    expect(within(r).queryByTitle(/envoyé le|passé le/)).toBeNull();
    expect(within(r).getAllByTitle(/depuis le dernier changement de statut/)).toHaveLength(4);
  });

  it('« Contacté par tél. » → api.contacterClient(42), « Contacté par téléphone le … » et note « appel » relue dans les notes', async () => {
    courant = ticket({ contact: CONTACT_SMS });
    const apres = {
      depuis_statut: true,
      dernier: { canal: 'appel', date: APPEL_2, auteur: 'Sophie' },
      canaux: { ...CONTACT_SMS.canaux, appel: APPEL_2 },
    };
    apiMock.contacterClient.mockImplementation(async () => {
      courant = { ...courant, contact: apres };
      notes = [NOTE_APPEL];
      return { contact: apres, note_id: NOTE_APPEL.id };
    });
    renderFiche();
    const r = await rubrique();
    expect(within(r).getByText(`Contacté par SMS le ${heure(SMS)}`)).toBeInTheDocument();
    expect(screen.queryByText('Appel téléphonique — client contacté')).toBeNull();
    const notesAvant = apiMock.getNotes.mock.calls.length;

    fireEvent.click(within(r).getByRole('button', { name: 'Contacté par tél.' }));
    await waitFor(() => expect(apiMock.contacterClient).toHaveBeenCalledWith(42));
    expect(apiMock.contacterClient).toHaveBeenCalledTimes(1);
    expect(await within(r).findByText(`Contacté par téléphone le ${heure(APPEL_2)}`)).toBeInTheDocument();
    // Contact du serveur fusionné dans le ticket : l'appel est allumé avec son auteur, le SMS reste allumé
    expect(within(r).getByTitle(`Appel passé le ${heure(APPEL_2)} par Sophie`)).toBeInTheDocument();
    expect(within(r).getByTitle(`SMS envoyé le ${heure(SMS)}`)).toBeInTheDocument();
    // Notes relues (loadNotes) : la note « Appel téléphonique — client contacté » apparaît dans Notes internes
    await waitFor(() => expect(apiMock.getNotes.mock.calls.length).toBeGreaterThan(notesAvant));
    const notesCarte = screen.getByRole('heading', { name: 'Notes internes' }).closest('section');
    expect(await within(notesCarte).findByText('Appel téléphonique — client contacté')).toBeInTheDocument();
    // Annonce / toast « Appel noté », aucun changement de statut ni relecture forcée du ticket
    expect((await screen.findAllByText('Appel noté')).length).toBeGreaterThanOrEqual(1);
    expect(apiMock.changeStatus).not.toHaveBeenCalled();
  });

  it('erreur du serveur : le contact affiché ne change pas', async () => {
    courant = ticket({ contact: CONTACT_SMS });
    apiMock.contacterClient.mockRejectedValue(new Error('Serveur indisponible'));
    renderFiche();
    const r = await rubrique();
    fireEvent.click(within(r).getByRole('button', { name: 'Contacté par tél.' }));
    await waitFor(() => expect(apiMock.contacterClient).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Serveur indisponible')).toBeInTheDocument();
    expect(within(r).getByText(`Contacté par SMS le ${heure(SMS)}`)).toBeInTheDocument();
    expect(within(r).queryByTitle(/Appel passé/)).toBeNull();
  });
});

describe('Fiche ticket — reprise « à chiffrer par la boutique »', () => {
  it('ligne de reprise à 0 € : badge neutre à côté du prix ; autres lignes sans badge', async () => {
    definirCatalogue(CATALOGUE);
    courant = ticket({
      panne: 'Reprise téléphone', devis_estime: 0,
      reparation_supp: JSON.stringify([
        { label: REPRISE, prix: 0 },
        { label: 'Nettoyage connecteur de charge', prix: 0 },
        { label: 'Forfait remplacement écran', prix: 89 },
      ]),
    });
    renderFiche();
    await boutonAppel();
    const reprise = ligneDe(REPRISE);
    const badge = within(reprise).getByText(MENTION);
    expect(badge).toHaveClass('badge', 'badge-neutral');
    expect(badge.className).toContain('badge-sm');
    // Le prix reste affiché (les montants ne changent pas) : 0.00 € à côté du badge, 89.00 € au total
    expect(within(reprise).getByText('0.00 €')).toBeInTheDocument();
    expect(badge.parentElement).toContainElement(within(reprise).getByText('0.00 €'));
    const nettoyage = ligneDe('Nettoyage connecteur de charge');
    expect(within(nettoyage).queryByText(MENTION)).toBeNull();
    expect(within(nettoyage).getByText('0.00 €')).toBeInTheDocument();
    const ecran = ligneDe('Forfait remplacement écran');
    expect(within(ecran).queryByText(MENTION)).toBeNull();
    expect(within(ecran).getByText('89.00 €')).toBeInTheDocument();
    expect(within(carteReparation()).getAllByText(MENTION)).toHaveLength(1);
  });

  it('reprise déjà chiffrée (prix > 0) : pas de badge', async () => {
    definirCatalogue(CATALOGUE);
    courant = ticket({
      panne: 'Reprise téléphone',
      reparation_supp: JSON.stringify([{ label: REPRISE, prix: 80 }]),
    });
    renderFiche();
    await boutonAppel();
    const reprise = ligneDe(REPRISE);
    expect(within(reprise).getByText('80.00 €')).toBeInTheDocument();
    expect(screen.queryByText(MENTION)).toBeNull();
  });

  it('ligne par défaut du symptôme « Reprise téléphone » (sans lignes JSON) : badge aussi, et « Sur devis » conservé', async () => {
    definirCatalogue(CATALOGUE);
    courant = ticket({ panne: 'Reprise téléphone', devis_estime: 0, reparation_supp: '' });
    renderFiche();
    await boutonAppel();
    const reprise = ligneDe(REPRISE);
    expect(within(reprise).getByText(MENTION)).toHaveClass('badge-neutral');
    expect(within(reprise).getByText('Sur devis')).toBeInTheDocument();
  });

  it('sans catalogue chargé ou pour une autre prestation à 0 € : aucune mention', async () => {
    courant = ticket({
      reparation_supp: JSON.stringify([{ label: REPRISE, prix: 0 }, { label: 'Forfait remplacement écran', prix: 0 }]),
    });
    renderFiche();
    await boutonAppel();
    expect(screen.queryByText(MENTION)).toBeNull();
  });
});
