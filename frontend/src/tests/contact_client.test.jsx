/**
 * « Client contacté » — une vérité, partout : aides de lib/contact.js (libellés, dates, mise à jour
 * locale), composant ContactClient (icônes, dernier contact, « Contacté par tél. » →
 * POST /api/tickets/{id}/contact), colonne CONTACT du dashboard (icônes allumées selon
 * contact.canaux, appel noté après confirmation légère) et file atelier.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { auth, toast, apiMock } = vi.hoisted(() => ({
  auth: { user: { target: 'accueil', utilisateur: 'Sophie' } },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), important: vi.fn() },
  apiMock: {
    contacterClient: vi.fn(),
    getDashboard: vi.fn(),
    getActiveTeam: vi.fn(),
    getInteractions: vi.fn(),
    getClients: vi.fn(),
    getParts: vi.fn(),
    getRepairQueue: vi.fn(),
    background: (fn) => fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));
vi.mock('../components/Toast', () => ({ useToast: () => toast, ToastProvider: ({ children }) => children }));

import { clearCache } from '../hooks/useApi';
import ContactClient, { IconesContact } from '../components/ContactClient';
import RepairQueue from '../components/RepairQueue';
import DashboardPage from '../pages/DashboardPage';
import {
  CANAUX_CONTACT, appliquerContact, canalLibelle, formatDateHeure, libelleContact, normaliserContact, titreCanal,
} from '../lib/contact';

const SMS = '2026-10-17T12:32:00';
const CONTACT_SMS = {
  depuis_statut: true,
  dernier: { canal: 'sms', date: SMS, auteur: 'Léa' },
  canaux: { sms: SMS, email: null, whatsapp: null, appel: null },
};
const APPEL = '2026-10-16T08:05:00Z';
const REPONSE_APPEL = {
  note_id: 7,
  contact: {
    depuis_statut: true,
    dernier: { canal: 'appel', date: APPEL, auteur: 'Sophie' },
    canaux: { sms: null, email: null, whatsapp: null, appel: APPEL },
  },
};

// Heure locale de la machine (comme l'écran) : « 17/10 à 14:32 » à Paris
const heure = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};
const H_SMS = heure(`${SMS}Z`);
const H_APPEL = heure(APPEL);

beforeEach(() => {
  clearCache();
  vi.clearAllMocks();
  apiMock.contacterClient.mockResolvedValue(structuredClone(REPONSE_APPEL));
});
afterEach(() => cleanup());

// ─── Aides ───────────────────────────────────────────────────────────────────

describe('lib/contact.js : client contacté', () => {
  it('libellés des canaux et dates « 17/10 à 14:32 » (horodatage naïf du serveur = UTC)', () => {
    expect(CANAUX_CONTACT).toEqual(['sms', 'email', 'whatsapp', 'appel']);
    expect(canalLibelle('sms')).toBe('SMS');
    expect(canalLibelle('email')).toBe('e-mail');
    expect(canalLibelle('whatsapp')).toBe('WhatsApp');
    expect(canalLibelle('appel')).toBe('téléphone');
    expect(formatDateHeure(SMS)).toBe(H_SMS);
    expect(formatDateHeure(`${SMS}Z`)).toBe(H_SMS);
    expect(formatDateHeure('2026-10-17 12:32:00')).toBe(H_SMS);
    expect(formatDateHeure(APPEL)).toBe(H_APPEL);
    expect(formatDateHeure(null)).toBe('');
    expect(formatDateHeure('n/a')).toBe('');
  });

  it('contact normalisé : 4 canaux, dernier déduit si absent, vide sinon', () => {
    expect(normaliserContact(null)).toEqual({
      depuis_statut: false, dernier: null, canaux: { sms: null, email: null, whatsapp: null, appel: null },
    });
    expect(normaliserContact(CONTACT_SMS)).toEqual(CONTACT_SMS);
    const deduit = normaliserContact({ canaux: { sms: '2026-10-17T12:00:00', appel: '2026-10-17T13:00:00' } });
    expect(deduit.depuis_statut).toBe(true);
    expect(deduit.dernier).toEqual({ canal: 'appel', date: '2026-10-17T13:00:00', auteur: null });
  });

  it('« Contacté par SMS le … » / « Pas encore contacté », info-bulle avec auteur du dernier contact', () => {
    expect(libelleContact(CONTACT_SMS)).toBe(`Contacté par SMS le ${H_SMS}`);
    expect(libelleContact(undefined)).toBe('Pas encore contacté');
    expect(titreCanal(CONTACT_SMS, 'sms')).toBe(`SMS envoyé le ${H_SMS} par Léa`);
    expect(titreCanal(CONTACT_SMS, 'appel')).toBe("Pas d'appel depuis le dernier changement de statut");
    expect(titreCanal(CONTACT_SMS, 'email')).toBe("Pas d'e-mail depuis le dernier changement de statut");
    expect(titreCanal(CONTACT_SMS, 'whatsapp')).toBe('Pas de WhatsApp depuis le dernier changement de statut');
    expect(titreCanal(REPONSE_APPEL.contact, 'appel')).toBe(`Appel passé le ${H_APPEL} par Sophie`);
  });

  it('mise à jour locale après un envoi ou un appel : canal daté, dernier remplacé, canal inconnu ignoré', () => {
    const c = appliquerContact(CONTACT_SMS, 'appel', APPEL, 'Sophie');
    expect(c).toEqual({
      depuis_statut: true,
      dernier: { canal: 'appel', date: APPEL, auteur: 'Sophie' },
      canaux: { sms: SMS, email: null, whatsapp: null, appel: APPEL },
    });
    expect(appliquerContact(null, 'whatsapp').dernier.canal).toBe('whatsapp');
    expect(appliquerContact(CONTACT_SMS, 'pigeon')).toEqual(CONTACT_SMS);
  });
});

// ─── ContactClient ───────────────────────────────────────────────────────────

const ticket = (extra = {}) => ({ id: 42, ticket_code: 'KP-000042', client_prenom: 'Léa', client_nom: 'Martin', ...extra });

describe('ContactClient', () => {
  it('ligne : icônes éteintes et « Pas encore contacté » sans contact depuis le dernier statut', () => {
    render(<ContactClient ticket={ticket({ contact: null })} />);
    expect(screen.getByText('Pas encore contacté')).toBeInTheDocument();
    // Icônes éteintes : info-bulle seulement, rien de lu en plus du texte visible
    expect(screen.getByTitle("Pas d'appel depuis le dernier changement de statut")).toBeInTheDocument();
    expect(screen.getByTitle('Pas de SMS depuis le dernier changement de statut')).toBeInTheDocument();
    expect(screen.queryByText(/^Pas d/)).not.toBeInTheDocument();
    const bouton = screen.getByRole('button', { name: 'Contacté par tél.' });
    expect(bouton).toHaveClass('min-h-11'); // 44 px au doigt
  });

  it('icônes allumées par canal, dernier contact en clair, info-bulle avec date, heure et auteur', () => {
    const { container } = render(<ContactClient ticket={ticket({ contact: CONTACT_SMS })} taille="carte" />);
    expect(screen.getByText(`Contacté par SMS le ${H_SMS}`)).toBeInTheDocument();
    expect(screen.getByTitle(`SMS envoyé le ${H_SMS} par Léa`)).toBeInTheDocument();
    // Icône allumée : lue aussi (sr-only) ; éteinte : info-bulle seule
    expect(screen.getByText(`SMS envoyé le ${H_SMS} par Léa`)).toHaveClass('sr-only');
    expect(screen.queryByText(/^Pas d/)).not.toBeInTheDocument();
    const svgs = container.querySelectorAll('svg.lucide');
    // SMS (1ʳᵉ icône) allumée, les trois autres éteintes
    expect(svgs[0]).toHaveClass('text-emerald-600');
    expect(svgs[1]).toHaveClass('text-slate-300');
    expect(svgs[2]).toHaveClass('text-slate-300');
    expect(svgs[3]).toHaveClass('text-slate-300');
    // Taille « carte » : 44 px au doigt aussi, sans que l'hôte (scan, fiche) ait à le forcer
    expect(screen.getByRole('button', { name: 'Contacté par tél.' })).toHaveClass('btn-secondary', 'min-h-11');
  });

  it('« Contacté par tél. » note l’appel, met l’affichage à jour, prévient (toast + aria-live) et remonte le contact', async () => {
    const onContacte = vi.fn();
    render(<ContactClient ticket={ticket({ contact: CONTACT_SMS })} onContacte={onContacte} />);
    fireEvent.click(screen.getByRole('button', { name: 'Contacté par tél.' }));
    await waitFor(() => expect(apiMock.contacterClient).toHaveBeenCalledWith(42));
    expect(await screen.findByText(`Contacté par téléphone le ${H_APPEL}`)).toBeInTheDocument();
    expect(screen.getByTitle(`Appel passé le ${H_APPEL} par Sophie`)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Appel noté');
    expect(screen.getByRole('status')).toHaveTextContent('Appel noté');
    expect(onContacte).toHaveBeenCalledWith(REPONSE_APPEL.contact);
    expect(screen.getByRole('button', { name: 'Contacté par tél.' })).toBeEnabled();
  });

  it('en StrictMode (double montage du dev) : l’appel est bien noté — affichage, toast, aria-live, onContacte', async () => {
    // main.jsx monte l'app en <React.StrictMode> : en dev, les effets sont montés, nettoyés puis remontés.
    // Le garde « composant encore vivant » ne doit pas rester bloqué à faux après ce nettoyage de répétition.
    const onContacte = vi.fn();
    render(<StrictMode><ContactClient ticket={ticket({ contact: null })} onContacte={onContacte} taille="carte" /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: 'Contacté par tél.' }));
    await waitFor(() => expect(apiMock.contacterClient).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(`Contacté par téléphone le ${H_APPEL}`)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Appel noté');
    expect(screen.getByRole('status')).toHaveTextContent('Appel noté');
    expect(onContacte).toHaveBeenCalledWith(REPONSE_APPEL.contact);
    expect(screen.getByRole('button', { name: 'Contacté par tél.' })).toBeEnabled();
    expect(screen.queryByText('Pas encore contacté')).not.toBeInTheDocument();
  });

  it('serveur sans objet contact : mise à jour locale signée du membre connecté', async () => {
    apiMock.contacterClient.mockResolvedValue({ note_id: 8 });
    render(<ContactClient ticket={ticket({ contact: null })} auteur="Sophie" />);
    fireEvent.click(screen.getByRole('button', { name: 'Contacté par tél.' }));
    expect(await screen.findByText(/^Contacté par téléphone le /)).toBeInTheDocument();
    expect(screen.getByTitle(/^Appel passé le .* par Sophie$/)).toBeInTheDocument();
  });

  it('erreur du serveur : rien ne change, le bouton redevient actif', async () => {
    apiMock.contacterClient.mockRejectedValue(new Error('Ticket non trouvé'));
    render(<ContactClient ticket={ticket({ contact: null })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Contacté par tél.' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Ticket non trouvé'));
    expect(screen.getByText('Pas encore contacté')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contacté par tél.' })).toBeEnabled();
  });

  it('le ticket rafraîchi par le parent fait foi ; icônes décoratives sans texte lu', () => {
    const { rerender, container } = render(<ContactClient ticket={ticket({ contact: null })} />);
    rerender(<ContactClient ticket={ticket({ contact: CONTACT_SMS })} />);
    expect(screen.getByText(`Contacté par SMS le ${H_SMS}`)).toBeInTheDocument();
    cleanup();
    render(<IconesContact contact={CONTACT_SMS} decoratif />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(document.querySelector('span[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.queryByText(/SMS envoyé/)).not.toBeInTheDocument();
  });
});

// ─── Dashboard ───────────────────────────────────────────────────────────────

const wrap = (ui, entries = ['/accueil']) => <MemoryRouter initialEntries={entries}>{ui}</MemoryRouter>;

function ligne(id, extra = {}) {
  return {
    id, ticket_code: `KP-00000${id}`, statut: 'En attente de diagnostic', categorie: 'Smartphone',
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '0612345678', client_email: 'lea@example.test',
    marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé', date_depot: '2026-10-11 09:00:00',
    priorite: 'normal', reception_complete: true, ...extra,
  };
}

describe('Dashboard : colonne CONTACT', () => {
  beforeEach(() => {
    apiMock.getDashboard.mockResolvedValue({
      kpi: {}, total: 2,
      tickets: [
        ligne(1, { contact: CONTACT_SMS }),
        ligne(2, { client_prenom: 'Hugo', client_nom: 'Bernard', contact: null }),
      ],
    });
    apiMock.getActiveTeam.mockResolvedValue([]);
    apiMock.getInteractions.mockResolvedValue({});
    apiMock.getClients.mockResolvedValue([]);
    apiMock.getParts.mockResolvedValue([]);
  });

  it('les liens d’envoi s’allument selon contact.canaux (date, heure, auteur en info-bulle)', async () => {
    render(wrap(<DashboardPage />));
    await screen.findByText('KP-000001');
    const sms1 = screen.getByRole('link', { name: `SMS à Léa Martin (SMS envoyé le ${H_SMS} par Léa)` });
    expect(sms1).toHaveAttribute('title', `SMS envoyé le ${H_SMS} par Léa`);
    expect(sms1.querySelector('svg')).toHaveClass('text-emerald-600');
    expect(sms1).toHaveAttribute('href', expect.stringMatching(/^sms:0612345678\?/));
    const wa1 = screen.getByRole('link', { name: 'WhatsApp à Léa Martin' });
    expect(wa1).toHaveAttribute('title', 'WhatsApp');
    expect(wa1.querySelector('svg')).toHaveClass('text-slate-500');
    expect(screen.getByRole('link', { name: 'SMS à Hugo Bernard' }).querySelector('svg')).toHaveClass('text-slate-500');
    expect(screen.getByRole('button', { name: 'Contacté par téléphone : Hugo Bernard' })).toHaveAttribute('title', 'Contacté par tél.');
  });

  it('téléphone : confirmation légère sous la rangée, puis appel noté et icône allumée sans recharger', async () => {
    render(wrap(<DashboardPage />));
    await screen.findByText('KP-000002');
    const lectures = apiMock.getDashboard.mock.calls.length; // liste + compteur d'archives
    fireEvent.click(screen.getByRole('button', { name: 'Contacté par téléphone : Hugo Bernard' }));
    const groupe = screen.getByRole('group', { name: 'Noter un appel téléphonique à Hugo Bernard' });
    expect(groupe).toHaveTextContent('Hugo Bernard (KP-000002) a été appelé ?');
    expect(screen.getByRole('button', { name: 'Contacté par téléphone : Hugo Bernard' })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(within(groupe).getByRole('button', { name: "Oui, noter l'appel" }));
    await waitFor(() => expect(apiMock.contacterClient).toHaveBeenCalledWith(2));
    const tel = await screen.findByRole('button', { name: `Contacté par téléphone : Hugo Bernard (Appel passé le ${H_APPEL} par Sophie)` });
    expect(tel.querySelector('svg')).toHaveClass('text-emerald-600');
    expect(tel).toHaveAttribute('title', `Appel passé le ${H_APPEL} par Sophie`);
    expect(screen.queryByRole('group', { name: /Noter un appel/ })).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Appel noté');
    expect(apiMock.getDashboard).toHaveBeenCalledTimes(lectures); // mise à jour locale, pas de relecture
  });

  it('« Non » ou Échap referment la confirmation sans rien noter', async () => {
    render(wrap(<DashboardPage />));
    await screen.findByText('KP-000001');
    const tel = screen.getByRole('button', { name: /^Contacté par téléphone : Léa Martin/ });
    fireEvent.click(tel);
    expect(screen.getByRole('button', { name: "Oui, noter l'appel" })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Non' }));
    expect(screen.queryByRole('group', { name: /Noter un appel/ })).not.toBeInTheDocument();
    // Le focus revient sur l'icône téléphone de la ligne
    await waitFor(() => expect(tel).toHaveFocus());
    fireEvent.click(tel);
    fireEvent.keyDown(screen.getByRole('group', { name: /Noter un appel/ }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: /Noter un appel/ })).not.toBeInTheDocument();
    expect(apiMock.contacterClient).not.toHaveBeenCalled();
  });
});

// ─── File atelier ────────────────────────────────────────────────────────────

describe('File atelier : contact depuis le dernier statut', () => {
  it('ligne contactée : icônes + dernier contact ; rien sur une ligne sans contact', async () => {
    apiMock.getRepairQueue.mockResolvedValue([
      { id: 1, ticket_code: 'KP-1', statut: 'En attente de diagnostic', client_nom: 'Martin', priorite: 'normal', contact: CONTACT_SMS },
      { id: 2, ticket_code: 'KP-2', statut: 'En attente de diagnostic', client_nom: 'Bernard', priorite: 'normal', contact: normaliserContact(null) },
    ]);
    render(wrap(<RepairQueue open inline basePath="/accueil" user={auth.user} onClose={() => {}} />));
    const items = await screen.findAllByRole('button', { name: /KP-/ });
    expect(items[0]).toHaveTextContent(`Contacté par SMS le ${H_SMS}`);
    expect(items[0]).not.toHaveTextContent('SMS envoyé');
    expect(items[1]).not.toHaveTextContent('contacté');
  });
});
