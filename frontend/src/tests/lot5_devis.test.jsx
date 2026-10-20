/**
 * Lot 5 (check-up) — Devis Flash → devis (prix TTC de la grille convertis en HT), modification d'un
 * devis à TVA 0 %, erreurs d'enregistrement affichées, grille KPI sans saut, téléphones en vente,
 * message WhatsApp de l'attestation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { auth, apiMock } = vi.hoisted(() => ({
  auth: { user: { target: 'accueil', utilisateur: 'Léa' } },
  apiMock: {
    getDevis: vi.fn(),
    getDevisStats: vi.fn(),
    getDevisById: vi.fn(),
    createDevis: vi.fn(),
    updateDevis: vi.fn(),
    getClients: vi.fn(),
    devisFlashSearch: vi.fn(),
    getTelephonesVente: vi.fn(),
    getTelephonesVenteStats: vi.fn(),
    getTelephonesVenteMarques: vi.fn(),
    createTelephoneVente: vi.fn(),
    updateTelephoneVente: vi.fn(),
    deleteTelephoneVente: vi.fn(),
    getPublicConfig: vi.fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { ToastProvider } from '../components/Toast';
import { clearCache } from '../hooks/useApi';
import DevisPage from '../pages/DevisPage';
import DevisFlashPage, { lignesDevisHT } from '../pages/DevisFlashPage';
import { messageWhatsApp } from '../pages/AttestationPage';

const wrap = (ui, entries = ['/accueil/devis']) => (
  <MemoryRouter initialEntries={entries}>
    <ToastProvider>{ui}</ToastProvider>
  </MemoryRouter>
);

// Total TTC du devis tel que le serveur le calcule (devis._calc_totals)
const ttcDevis = (lignes, tva) => {
  const ht = Math.round(lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0) * 100) / 100;
  return Math.round(ht * (1 + tva / 100) * 100) / 100;
};

beforeEach(() => {
  clearCache();
  sessionStorage.clear();
  Object.values(apiMock).forEach((fn) => fn.mockReset?.());
  apiMock.getDevis.mockResolvedValue([]);
  apiMock.getDevisStats.mockResolvedValue({ total: 3, acceptes: 1, envoyes: 1, ca_accepte: 12345.67 });
  apiMock.getClients.mockResolvedValue([]);
  apiMock.getPublicConfig.mockResolvedValue({ BOUTIQUE_NOM: 'Boutique Test', BOUTIQUE_TEL: '04 00 00 00 00' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Devis Flash → devis : prix TTC de la grille convertis en HT', () => {
  it('79 € TTC donne une ligne à 65,83 € HT, soit 79,00 € TTC', () => {
    const lignes = lignesDevisHT([{ composant: 'Batterie', qualite: null, prix_vente: 79 }], 20);
    expect(lignes).toEqual([{ description: 'Batterie', quantite: 1, prix_unitaire: 65.83 }]);
    expect(ttcDevis(lignes, 20)).toBe(79);
  });

  it('plusieurs lignes : la dernière absorbe l’arrondi, le TTC retombe juste', () => {
    for (const prix of [[79, 89, 109], [69, 69, 69], [19.99, 0.01], [129.9, 49.9, 19.2]]) {
      const reps = prix.map((p, i) => ({ composant: `P${i}`, prix_vente: p }));
      const total = Math.round(prix.reduce((a, b) => a + b, 0) * 100) / 100;
      for (const tva of [20, 10, 5.5]) {
        expect(ttcDevis(lignesDevisHT(reps, tva), tva)).toBe(total);
      }
    }
  });

  it('TVA 0 % : HT = TTC', () => {
    expect(lignesDevisHT([{ composant: 'Écran', qualite: 'OLED', prix_vente: 139 }], 0))
      .toEqual([{ description: 'Écran (OLED)', quantite: 1, prix_unitaire: 139 }]);
  });

  it('« Créer un devis » depuis Devis Flash : le devis affiche 79,00 € TTC', async () => {
    apiMock.devisFlashSearch.mockResolvedValue([{
      marque: 'Apple', modele: 'iPhone 13', tva: 20,
      reparations: [{ composant: 'Batterie', qualite: null, prix_vente: 79, en_stock: true }],
    }]);
    const { unmount } = render(wrap(<DevisFlashPage />, ['/accueil/devis-flash']));
    fireEvent.change(screen.getByLabelText('Rechercher un modèle'), { target: { value: 'iPhone 13' } });
    fireEvent.click(await screen.findByRole('button', { name: /Apple iPhone 13/ }));
    fireEvent.click(screen.getByRole('button', { name: /Batterie/ }));
    fireEvent.click(screen.getByRole('button', { name: /Créer un devis/ }));
    const prefill = JSON.parse(sessionStorage.getItem('kp_devis_prefill'));
    expect(prefill).toMatchObject({ appareil: 'Apple iPhone 13', tva: 20 });
    expect(prefill.lignes[0].prix_unitaire).toBe(65.83);
    unmount();

    render(wrap(<DevisPage />, ['/accueil/devis?create=1']));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Prix unitaire HT de la ligne 1')).toHaveValue(65.83);
    const ttc = within(dialog).getByText('Total TTC').parentElement;
    expect(ttc).toHaveTextContent('79,00 €');
  });
});

describe('Devis : modification et enregistrement', () => {
  const devisTva0 = {
    id: 5, numero: 'DEV-202610-0005', client_id: null, client_nom: 'Fictif', client_prenom: '', client_tel: '',
    client_email: '', appareil: 'iPhone 13', description: '', tva: 0, remise: 0, notes: '', validite_jours: 30,
    statut: 'Brouillon', total_ht: 130.1, total_ttc: 130.1,
    lignes: [{ description: 'Écran', quantite: 1, prix_unitaire: '130.10', total: '130.10' }],
  };

  it('un devis à TVA 0 % reste à 0 % une fois rouvert et enregistré', async () => {
    apiMock.getDevis.mockResolvedValue([devisTva0]);
    apiMock.getDevisById.mockResolvedValue(devisTva0);
    apiMock.updateDevis.mockResolvedValue({ ok: true });
    render(wrap(<DevisPage />));
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier le devis DEV-202610-0005' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('TVA (%)')).toHaveValue(0);
    expect(within(dialog).getByText('Total TTC').parentElement).toHaveTextContent('130,10 €');
    fireEvent.click(within(dialog).getByRole('button', { name: /Enregistrer/ }));
    await waitFor(() => expect(apiMock.updateDevis).toHaveBeenCalled());
    expect(apiMock.updateDevis.mock.calls[0][1]).toMatchObject({ tva: 0, remise: 0, validite_jours: 30 });
  });

  it('une erreur d’enregistrement s’affiche à l’écran', async () => {
    apiMock.createDevis.mockRejectedValue(new Error('tva : doit être ≤ 30'));
    render(wrap(<DevisPage />));
    fireEvent.click(await screen.findByRole('button', { name: /Nouveau devis/ }));
    const dialog = await screen.findByRole('dialog');
    const nouveau = within(dialog).queryByRole('button', { name: /Nouveau client/ });
    if (nouveau) fireEvent.click(nouveau);
    fireEvent.change(within(dialog).getByLabelText(/^Nom/), { target: { value: 'Fictif' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Créer le devis/ }));
    expect(await screen.findByText(/Devis non enregistré : tva : doit être ≤ 30/)).toBeInTheDocument();
  });

  it('les cartes KPI sont là avant les statistiques (pas de saut de la liste)', async () => {
    let resoudre;
    apiMock.getDevisStats.mockReturnValue(new Promise((r) => { resoudre = r; }));
    const { container } = render(wrap(<DevisPage />));
    expect(container.querySelectorAll('.kpi-card')).toHaveLength(4);
    expect(screen.getByText('CA Accepté')).toBeInTheDocument();
    resoudre({ total: 3, acceptes: 1, envoyes: 1, ca_accepte: 12345.67 });
    expect(await screen.findByText('12345,67 €')).toHaveClass('text-xl');
    expect(container.querySelectorAll('.kpi-card')).toHaveLength(4);
  });
});

describe('Téléphones en vente : erreurs affichées', () => {
  it('un refus du serveur (422) s’affiche au lieu d’être avalé', async () => {
    apiMock.getTelephonesVente.mockResolvedValue([]);
    apiMock.getTelephonesVenteStats.mockResolvedValue({ total: 0, en_stock: 0, valeur_stock: 0, nb_marques: 0 });
    apiMock.getTelephonesVenteMarques.mockResolvedValue([]);
    apiMock.createTelephoneVente.mockRejectedValue(new Error('prix_vente : nombre attendu'));
    render(wrap(<DevisFlashPage />, ['/accueil/devis-flash']));
    fireEvent.click(screen.getByRole('button', { name: /Téléphones en vente/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Ajouter/ }));
    fireEvent.change(screen.getByLabelText('Marque *'), { target: { value: 'Apple' } });
    fireEvent.change(screen.getByLabelText('Modèle *'), { target: { value: 'iPhone 12' } });
    const boutons = screen.getAllByRole('button', { name: /^Ajouter$/ });
    fireEvent.click(boutons[boutons.length - 1]);
    expect(await screen.findByText(/Téléphone non enregistré : prix_vente : nombre attendu/)).toBeInTheDocument();
  });
});

describe('Attestation : message WhatsApp', () => {
  it('signé avec l’identité configurée, sans « pièce jointe »', () => {
    const msg = messageWhatsApp({ prenom: 'Emma', marque: 'Apple', modele: 'iPhone 13' },
      { BOUTIQUE_NOM: 'Boutique Test', BOUTIQUE_TEL: '04 00 00 00 00' });
    expect(msg).toMatch(/^Bonjour Emma,/);
    expect(msg).toContain('Apple iPhone 13');
    expect(msg).toContain('Boutique Test - 04 00 00 00 00');
    expect(msg).not.toMatch(/ci-joint|pièce jointe|KLIKPHONE|04 79 60 89 22/i);
  });

  it('sans prénom ni configuration : pas de trou dans le message', () => {
    const msg = messageWhatsApp({ prenom: '', marque: 'Samsung', modele: '' }, {});
    expect(msg).toMatch(/^Bonjour,/);
    expect(msg).toMatch(/Cordialement,$/);
  });
});
