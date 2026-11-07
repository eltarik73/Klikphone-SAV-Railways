/**
 * Community Manager : comptes connectés (Late / Zernio), photo obligatoire pour Instagram,
 * envoi d'une photo, génération IA suivie en tâche de fond, retour de connexion.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

const { apiMock } = vi.hoisted(() => {
  const base = {};
  const apiMock = new Proxy(base, {
    get(target, cle) {
      if (!(cle in target)) target[cle] = vi.fn().mockResolvedValue({});
      return target[cle];
    },
  });
  return { apiMock };
});

vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { ToastProvider } from '../components/Toast';
import { clearCache } from '../hooks/useApi';
import CommunityManager from '../pages/CommunityManager';

const COMPTES = [{ id: 'acc_ig', platform: 'instagram', plateforme: 'instagram', username: 'klikphone', isActive: true }];
const BROUILLON_IG = {
  id: 11, titre: 'Batterie gonflée', contenu: 'Votre batterie gonfle ?', plateforme: 'instagram',
  statut: 'brouillon', image_url: null, hashtags: ['#Klikphone', 'Chambery'], created_at: '2026-11-07T10:00:00',
};
const BROUILLON_LI = { ...BROUILLON_IG, id: 12, titre: 'Recrutement', plateforme: 'linkedin' };

function resetApi() {
  for (const fn of Object.values(apiMock)) {
    if (typeof fn?.mockReset === 'function') fn.mockReset().mockResolvedValue({});
  }
  apiMock.getMarketingPosts.mockResolvedValue([BROUILLON_IG, BROUILLON_LI]);
  apiMock.getComptesReseaux.mockResolvedValue(COMPTES);
}

// setup.js remplace window.location par un objet simple : on y pose ce que la page lit
const poserAdresse = (search = '') => {
  window.location = { href: `http://localhost:3000/tech/community${search}`, origin: 'http://localhost:3000',
    pathname: '/tech/community', search, assign: vi.fn() };
};

beforeEach(() => {
  clearCache();
  resetApi();
  poserAdresse();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const rendre = () => render(<ToastProvider><CommunityManager /></ToastProvider>);

describe('Community Manager — publication Instagram', () => {
  it('liste les comptes connectés et propose de connecter les autres réseaux', async () => {
    rendre();
    expect(await screen.findByText('· @klikphone')).toBeTruthy();
    expect(screen.getByText('Connecté')).toBeTruthy();
    expect(screen.getByText('Facebook non connecté')).toBeTruthy();
    expect(screen.getByText('LinkedIn non connecté')).toBeTruthy();
  });

  it('connecter un réseau ouvre l’autorisation Zernio avec la page de retour', async () => {
    apiMock.getLienConnexionReseau.mockResolvedValue({ url: 'https://zernio.com/oauth/facebook' });
    rendre();
    await screen.findByText('Facebook non connecté');
    fireEvent.click(screen.getAllByRole('button', { name: /^Connecter$/ })[0]);
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://zernio.com/oauth/facebook'));
    expect(apiMock.getLienConnexionReseau).toHaveBeenCalledWith('facebook', '/tech/community');
  });

  it('un brouillon Instagram sans photo ne peut pas partir ; la photo ajoutée est enregistrée', async () => {
    apiMock.envoyerPhotoMarketing.mockResolvedValue({ image_url: 'https://kp/api/marketing/images/abc.jpg' });
    apiMock.updateMarketingPost.mockResolvedValue({});
    rendre();
    expect(await screen.findByText('Photo obligatoire pour Instagram')).toBeTruthy();
    const publierIg = screen.getByRole('button', { name: /Publier sur Instagram/ });
    expect(publierIg.disabled).toBe(true);
    // LinkedIn : publiable sans photo
    expect(screen.getByRole('button', { name: /Publier sur LinkedIn/ }).disabled).toBe(false);
    // Hashtags affichés sans double dièse
    expect(screen.getAllByText('#Klikphone').length).toBeGreaterThan(0);
    expect(screen.queryByText('##Klikphone')).toBeNull();

    const fichier = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], 'photo.jpg', { type: 'image/jpeg' });
    const champ = screen.getAllByLabelText('Ajouter une photo', { selector: 'input' })[0];
    fireEvent.change(champ, { target: { files: [fichier] } });
    await waitFor(() => expect(apiMock.updateMarketingPost).toHaveBeenCalledWith(11, { image_url: 'https://kp/api/marketing/images/abc.jpg' }));
    expect(apiMock.envoyerPhotoMarketing).toHaveBeenCalledWith(fichier);
  });

  it('publie sur le réseau du post et affiche le résultat', async () => {
    apiMock.publierPost.mockResolvedValue({ platforms_published: ['linkedin'] });
    rendre();
    fireEvent.click(await screen.findByRole('button', { name: /Publier sur LinkedIn/ }));
    expect(await screen.findByText('Publié sur LinkedIn')).toBeTruthy();
    expect(apiMock.publierPost).toHaveBeenCalledWith(12);
  });

  it('erreur de publication : message de Late affiché', async () => {
    apiMock.publierPost.mockRejectedValue(Object.assign(new Error('Instagram est déconnecté de Late : cliquez « Reconnecter »'), { status: 409 }));
    rendre();
    fireEvent.click(await screen.findByRole('button', { name: /Publier sur LinkedIn/ }));
    expect(await screen.findByText(/Reconnecter/, { selector: 'span' })).toBeTruthy();
  });

  it('génération IA suivie jusqu’à l’image', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiMock.genererImage.mockResolvedValue({ job_id: 'job1', statut: 'en_cours' });
    apiMock.suiviGenerationImage
      .mockResolvedValueOnce({ statut: 'en_cours', secondes: 4 })
      .mockResolvedValueOnce({ statut: 'termine', image_url: 'https://kp/api/marketing/images/ia.jpg' });
    rendre();
    fireEvent.change(await screen.findByLabelText('Description de l’image à générer'.replace('’', "'")), { target: { value: 'un iPhone' } });
    fireEvent.click(screen.getByRole('button', { name: /Générer l'image avec l'IA/ }));
    await waitFor(() => expect(apiMock.genererImage).toHaveBeenCalledWith({ prompt: 'un iPhone' }));
    expect(await screen.findByText(/Génération IA/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(8500); });
    const apercu = await screen.findByAltText("Aperçu de l'image du post");
    expect(apercu.getAttribute('src')).toBe('https://kp/api/marketing/images/ia.jpg');
    expect(apiMock.suiviGenerationImage).toHaveBeenCalledWith('job1');
  });

  it('retour de Zernio : connexion confirmée et adresse nettoyée', async () => {
    poserAdresse('?connexion=late&connected=instagram&username=klikphone');
    const nettoyer = vi.spyOn(window.history, 'replaceState');
    rendre();
    expect(await screen.findByText('Instagram connecté (@klikphone)')).toBeTruthy();
    expect(nettoyer).toHaveBeenCalledWith(window.history.state, '', '/tech/community');
    nettoyer.mockRestore();
  });

  it('retour de Zernio en erreur : message affiché', async () => {
    poserAdresse('?connexion=late&error=access_denied&platform=instagram');
    rendre();
    expect(await screen.findByText('Connexion Instagram non aboutie : access_denied')).toBeTruthy();
  });

  it('calendrier : les rendez-vous de l’API (date_evenement) s’affichent au bon jour, triés par heure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-11-10T00:30:00')); // juste après minuit : le jour UTC serait la veille
    apiMock.getCalendrierMarketing.mockResolvedValue([
      { id: 2, titre: 'Reel · Écran explosé', date_evenement: '2026-11-10', heure: '18:00', type: 'post', couleur: '#7C3AED' },
      { id: 1, titre: 'Story du matin', date_evenement: '2026-11-10', heure: '09:00', type: 'story' },
      { id: 3, titre: 'Carrousel · Klikphone', date_evenement: '2026-11-12', heure: '12:30', type: 'post' },
    ]);
    rendre();
    fireEvent.click(await screen.findByRole('tab', { name: /Calendrier/ }));
    await waitFor(() => expect(apiMock.getCalendrierMarketing).toHaveBeenCalledWith({ date_debut: '2026-11-09', date_fin: '2026-11-15' }));
    const titres = await screen.findAllByText('Reel · Écran explosé');
    expect(titres.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Carrousel · Klikphone').length).toBeGreaterThan(0);
    // Même jour : 09:00 avant 18:00
    const colonne = titres[0].closest('div.rounded-lg')?.parentElement;
    const ordre = [...(colonne?.querySelectorAll('.font-semibold') || [])].map((n) => n.textContent);
    expect(ordre.indexOf('Story du matin')).toBeLessThan(ordre.indexOf('Reel · Écran explosé'));
  });
});
