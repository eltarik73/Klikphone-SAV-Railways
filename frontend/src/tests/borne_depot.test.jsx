/**
 * Borne de dépôt en 4 étapes (/client, /depot), dépôt à distance (/deposer) et second numéro
 * « pour vous joindre si différent » : parcours complet avec API simulée (même payload que
 * l'ancienne borne + tel_contact), code / schéma / pas de code (ChoixCodeAcces, PatternGrid),
 * et numéro joignable (lib/contact.js) repris par les écrans staff.
 */
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { auth, apiMock } = vi.hoisted(() => ({
  auth: { user: { target: 'accueil', utilisateur: 'Sophie' } },
  apiMock: {
    getPublicConfig: vi.fn(), getConfidentialite: vi.fn(), getCategories: vi.fn(), getPannes: vi.fn(),
    createOrGetClient: vi.fn(), createTicket: vi.fn(), createPartAuto: vi.fn(), learnTerm: vi.fn(),
    createDepotDistance: vi.fn(), getClient: vi.fn(), getMessageRelance: vi.fn(),
    getDashboard: vi.fn(), getActiveTeam: vi.fn(), getInteractions: vi.fn(), getClients: vi.fn(), getParts: vi.fn(),
    getMessageTemplates: vi.fn(), getCached: vi.fn(), getSmsEtat: vi.fn(),
    background: (fn) => fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));
vi.mock('../hooks/useCatalog', () => ({
  useCatalog: () => ({ marques: [], modelesDe: () => [], loading: false }),
}));

import { ToastProvider } from '../components/Toast';
import { SettingsProvider } from '../hooks/useSettings';
import { clearCache } from '../hooks/useApi';
import { _oublierConfigPublique } from '../pages/ConfidentialitePage';
import ClientFormPage from '../pages/ClientFormPage';
import DepotPage from '../pages/DepotPage';
import DeposerPage from '../pages/DeposerPage';
import DashboardPage from '../pages/DashboardPage';
import ChoixCodeAcces, { modeAcces, resumeAcces, erreurAcces } from '../components/ChoixCodeAcces';
import PatternGrid, { parsePattern, pointIntermediaire, ajouterPoint } from '../components/PatternGrid';
import { indicationPrevenir } from '../components/QuickScanPanel';
import { isValidPhone, isValidEmail, TuilesPannes, iconePanne } from '../components/DepotEtapes';
import RelanceClient from '../components/RelanceClient';
import {
  telJoignable, telFiche, estAutreNumero, formatTel, libelleJoignable, avecTelJoignable,
} from '../lib/contact';

function resetApi() {
  clearCache();
  _oublierConfigPublique();
  sessionStorage.clear();
  localStorage.clear();
  Object.values(apiMock).forEach((fn) => fn.mockReset?.());
  apiMock.getPublicConfig.mockResolvedValue({
    BOUTIQUE_NOM: 'Klikphone Chambéry', RGPD_CONTACT_EMAIL: 'rgpd@klikphone.test',
    RGPD_RETENTION_MOIS: '24', PURGE_CODES_JOURS: '15',
  });
  apiMock.getConfidentialite.mockResolvedValue({ titre: 'Politique de confidentialité', sections: [] });
  apiMock.getCategories.mockResolvedValue(['Smartphone', 'Commande']);
  apiMock.getPannes.mockResolvedValue(['Écran cassé', 'Batterie']);
  // Borne sans session : POST /api/clients ne rend qu'une référence signée, le ticket son jeton de suivi
  apiMock.createOrGetClient.mockResolvedValue({ client_ref: 'RefClientSignee' });
  apiMock.createTicket.mockResolvedValue({ id: 70, ticket_code: 'KP-000070', suivi_token: 'JetonSuivi70' });
  apiMock.createDepotDistance.mockResolvedValue({ ticket_code: 'KP-000071' });
  apiMock.learnTerm.mockResolvedValue({});
  apiMock.getMessageRelance.mockResolvedValue({ message: 'Bonjour, votre appareil vous attend.', jours: 12 });
  apiMock.getSmsEtat.mockResolvedValue({ disponible: false });
}

beforeEach(resetApi);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const wrap = (ui, entries = ['/']) => (
  <MemoryRouter initialEntries={entries}>
    <SettingsProvider>
      <ToastProvider>{ui}</ToastProvider>
    </SettingsProvider>
  </MemoryRouter>
);

const suivant = () => fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));

// ─── Numéro joignable ────────────────────────────────────────────
describe('contact.js : où joindre le client', () => {
  it('second numéro du ticket avant celui de la fiche, libellé « (autre numéro) »', () => {
    const t = { client_tel: '0612345679', tel_contact: '0698765431' };
    expect(telJoignable(t)).toBe('0698765431');
    expect(telFiche(t)).toBe('0612345679');
    expect(estAutreNumero(t)).toBe(true);
    expect(libelleJoignable(t)).toBe('06 98 76 54 31 (autre numéro)');
    expect(avecTelJoignable(t)).toEqual({ ...t, client_tel: '0698765431' });
  });

  it('sans second numéro : la fiche telle quelle ; même numéro écrit autrement : pas « autre »', () => {
    const t = { client_tel: '06 12 34 56 79', tel_contact: null };
    expect(telJoignable(t)).toBe('06 12 34 56 79');
    expect(libelleJoignable(t)).toBe('06 12 34 56 79');
    expect(avecTelJoignable(t)).toBe(t);
    expect(estAutreNumero({ client_tel: '06 12 34 56 79', tel_contact: '0612345679' })).toBe(false);
    expect(telJoignable({ client: { telephone: '0611111111' } })).toBe('0611111111');
    expect(telJoignable({})).toBe('');
    expect(libelleJoignable({})).toBe('');
    expect(formatTel('+41791234567')).toBe('+41791234567');
    expect(formatTel(' 0612345679 ')).toBe('06 12 34 56 79');
  });
});

// ─── Validation partagée (/client, /depot, /deposer) ─────────────
describe('DepotEtapes : validation partagée des trois pages', () => {
  it('numéro : mêmes caractères plausibles que le serveur, 10 à 15 chiffres', () => {
    expect(isValidPhone('06 12 34 56 79')).toBe(true);
    expect(isValidPhone('+33 6 12 34 56 79')).toBe(true);
    expect(isValidPhone('+41 79 123 45 67')).toBe(true);
    expect(isValidPhone('(04) 79 12 34 56')).toBe(true);
    expect(isValidPhone('12')).toBe(false);
    expect(isValidPhone('06 12 34 56 7a')).toBe(false);
    expect(isValidPhone('0612345679901234')).toBe(false);
    expect(isValidEmail('')).toBe(true);
    expect(isValidEmail('claude@exemple.fr')).toBe(true);
    expect(isValidEmail('claude@exemple')).toBe(false);
  });
});

// ─── Tuiles de panne (icône + libellé exact du kiosque) ──────────
describe('DepotEtapes : tuiles de panne', () => {
  it('« Ne s’allume plus », « Virus », « Reprise téléphone » avec leurs icônes ; libellé inconnu sans icône', () => {
    const onChoisir = vi.fn();
    render(<TuilesPannes pannes={["Ne s'allume plus", 'Virus', 'Reprise téléphone', 'Écran cassé', 'Panne inconnue']}
      valeur="Virus" onChoisir={onChoisir} />);
    const tuileDe = (nom) => screen.getByRole('button', { name: nom });
    expect(tuileDe("Ne s'allume plus").querySelector('svg.lucide-power-off')).toBeInTheDocument();
    expect(tuileDe('Virus').querySelector('svg.lucide-bug')).toBeInTheDocument();
    expect(tuileDe('Reprise téléphone').querySelector('svg.lucide-refresh-cw')).toBeInTheDocument();
    expect(tuileDe('Écran cassé').querySelector('svg.lucide-smartphone')).toBeInTheDocument();
    expect(tuileDe('Panne inconnue').querySelector('svg')).toBeNull();
    expect(tuileDe('Virus')).toHaveAttribute('aria-pressed', 'true');
    expect(tuileDe('Virus')).toHaveClass('min-h-14');
    // Grille : 1 colonne sur téléphone (libellés longs lisibles), 2 colonnes dès 640 px
    expect(tuileDe('Virus').parentElement).toHaveClass('grid', 'grid-cols-1', 'sm:grid-cols-2');
    fireEvent.click(tuileDe('Reprise téléphone'));
    expect(onChoisir).toHaveBeenCalledWith('Reprise téléphone');
    // Libellé normalisé (casse, accents, apostrophe typographique) ; inconnu → pas d'icône
    expect(iconePanne('  ne s’allume PLUS ')).not.toBeNull();
    expect(iconePanne('Désoxydation')).not.toBeNull();
    expect(iconePanne('Panne inconnue')).toBeNull();
  });
});

// ─── Schéma ──────────────────────────────────────────────────────
describe('PatternGrid', () => {
  it('analyse, point traversé en ligne droite, ajout sans doublon', () => {
    expect(parsePattern('1-5-9')).toEqual([1, 5, 9]);
    expect(parsePattern('')).toEqual([]);
    expect(parsePattern('0-12-x-3')).toEqual([3]);
    expect(pointIntermediaire(1, 3)).toBe(2);
    expect(pointIntermediaire(1, 9)).toBe(5);
    expect(pointIntermediaire(3, 7)).toBe(5);
    expect(pointIntermediaire(2, 8)).toBe(5);
    expect(pointIntermediaire(1, 6)).toBeNull();
    expect(pointIntermediaire(1, 2)).toBeNull();
    expect(ajouterPoint([1], 3)).toEqual([1, 2, 3]);
    expect(ajouterPoint([2, 1], 3)).toEqual([2, 1, 3]);
    expect(ajouterPoint([1, 2], 2)).toEqual([1, 2]);
  });

  it('tracé au clic / clavier, aperçu, Effacer, valeur pilotée par le parent', () => {
    const onChange = vi.fn();
    const { rerender } = render(<PatternGrid value="" onChange={onChange} size={264} />);
    expect(screen.getByRole('group', { name: 'Schéma de déverrouillage' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Point 1' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Point 9' }), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('1-5-9');
    expect(screen.getByRole('status')).toHaveTextContent('Tracé : 1 → 5 → 9');
    expect(screen.getByRole('button', { name: 'Point 5, 2ᵉ du tracé' })).toHaveAttribute('aria-pressed', 'true');
    rerender(<PatternGrid value="1-5-9" onChange={onChange} size={264} />);
    expect(screen.getByRole('status')).toHaveTextContent('Tracé : 1 → 5 → 9');
    // Le parent vide la valeur (changement de tuile) : la grille suit
    rerender(<PatternGrid value="" onChange={onChange} size={264} />);
    expect(screen.getByRole('status')).toHaveTextContent('Aucun point tracé');
    expect(screen.getByRole('button', { name: 'Effacer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Effacer' })).toHaveClass('min-h-11'); // 44 px au doigt
    fireEvent.click(screen.getByRole('button', { name: 'Point 2' }));
    expect(screen.getByRole('button', { name: 'Effacer' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Effacer' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('lecture seule : image nommée par le tracé, aucun bouton', () => {
    render(<PatternGrid value="1-2-3" readOnly size={120} />);
    expect(screen.getByRole('img', { name: 'Schéma de déverrouillage : 1 → 2 → 3' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

// ─── Code ou schéma ──────────────────────────────────────────────
describe('ChoixCodeAcces', () => {
  function Hote({ onChange }) {
    const [v, setV] = useState({ pin: '', pattern: '', mode: null });
    return <ChoixCodeAcces {...v} onChange={(n) => { setV(n); onChange?.(n); }} purgeJours={15} />;
  }

  it('trois tuiles exclusives, une seule saisie visible, l’autre valeur vidée', () => {
    const onChange = vi.fn();
    render(<Hote onChange={onChange} />);
    const groupe = screen.getByRole('radiogroup', { name: /Pour déverrouiller votre appareil/ });
    expect(within(groupe).getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByText(/Il est effacé 15 jours après la remise/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Votre code')).not.toBeInTheDocument();

    fireEvent.click(within(groupe).getByRole('radio', { name: /Code à chiffres/ }));
    const champ = screen.getByLabelText('Votre code');
    expect(champ).toHaveAttribute('type', 'password');
    expect(champ).toHaveAttribute('inputmode', 'numeric');
    fireEvent.change(champ, { target: { value: '2580' } });
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'code', pin: '2580', pattern: '' });
    fireEvent.click(screen.getByRole('button', { name: 'Afficher le code' }));
    expect(screen.getByLabelText('Votre code')).toHaveAttribute('type', 'text');

    // Schéma : le code est vidé, la grille apparaît avec sa consigne
    fireEvent.click(within(groupe).getByRole('radio', { name: /^Schéma/ }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'schema', pin: '', pattern: '' });
    expect(screen.queryByLabelText('Votre code')).not.toBeInTheDocument();
    expect(screen.getByText('Tracez votre schéma comme sur votre téléphone')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Point 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Point 9' }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'schema', pin: '', pattern: '1-5-9' });
    expect(screen.getByRole('button', { name: 'Effacer' })).toBeEnabled();

    // Pas de code : tout est vidé
    fireEvent.click(within(groupe).getByRole('radio', { name: /Pas de code/ }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'aucun', pin: '', pattern: '' });
    expect(within(groupe).getByRole('radio', { name: /Pas de code/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(groupe).getByRole('radio', { name: /^Schéma/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText("Rien à saisir : votre appareil s'ouvre sans code.")).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Schéma de déverrouillage' })).not.toBeInTheDocument();
  });

  it('aides : mode déduit, résumé jamais en clair, erreurs avant de passer', () => {
    expect(modeAcces({ pin: '12' })).toBe('code');
    expect(modeAcces({ pattern: '1-2' })).toBe('schema');
    expect(modeAcces({ acces_mode: 'aucun' })).toBe('aucun');
    expect(modeAcces({})).toBeNull();
    expect(resumeAcces({ pin: '2580', acces_mode: 'code' })).toBe('Code de 4 caractères (masqué)');
    expect(resumeAcces({ pattern: '1-5-9' })).toBe('Schéma de 3 points');
    expect(resumeAcces({ acces_mode: 'aucun' })).toMatch(/^Pas de code/);
    expect(resumeAcces({})).toBe('Non renseigné');
    expect(erreurAcces({})).toMatch(/code, schéma ou pas de code/);
    expect(erreurAcces({ acces_mode: 'code' })).toMatch(/Saisissez votre code/);
    expect(erreurAcces({ acces_mode: 'schema' })).toMatch(/Tracez votre schéma/);
    expect(erreurAcces({ acces_mode: 'aucun' })).toBeNull();
    expect(erreurAcces({ pin: '1', acces_mode: 'code' })).toBeNull();
  });
});

// ─── Borne /client ───────────────────────────────────────────────
describe('Borne /client en 4 étapes', () => {
  function etape1({ telContact = '06 98 76 54 31' } = {}) {
    render(wrap(<ClientFormPage />, ['/client']));
    expect(screen.getByText('Étape 1 sur 4 — Vous')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Étapes du dépôt' })).getAllByRole('listitem')).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Nom *'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Prénom'), { target: { value: 'Claude' } });
    fireEvent.change(screen.getByLabelText('Votre numéro de téléphone (obligatoire)'), { target: { value: '06 12 34 56 79' } });
    if (telContact !== null) {
      fireEvent.change(screen.getByLabelText('Numéro pour vous joindre si différent (facultatif)'), { target: { value: telContact } });
    }
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'claude@exemple.fr' } });
  }

  async function etape2() {
    expect(await screen.findByText('Étape 2 sur 4 — Votre appareil')).toBeInTheDocument();
    // Marque et modèle n'apparaissent qu'après le type d'appareil, sur le même écran
    expect(screen.queryByLabelText('Marque *')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Smartphone' }));
    fireEvent.change(screen.getByLabelText('Marque *'), { target: { value: 'Autre' } });
    fireEvent.change(screen.getByLabelText(/Préciser marque/), { target: { value: 'Fairphone 5' } });
  }

  it('parcours complet : même payload qu’avant + tel_contact, code masqué, récapitulatif modifiable', async () => {
    etape1();
    expect(screen.getByText(/Si votre téléphone reste chez nous/)).toBeInTheDocument();
    suivant();
    await etape2();
    suivant();

    // Étape 3 : le problème puis l'accès ; sans choix d'accès on ne passe pas
    expect(await screen.findByText("Étape 3 sur 4 — Le problème et l'accès")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Écran cassé' }));
    fireEvent.change(screen.getByLabelText('Détails supplémentaires'), { target: { value: 'Vitre fissurée' } });
    suivant();
    expect(screen.getByRole('alert')).toHaveTextContent('Dites-nous comment s’ouvre votre appareil');
    expect(screen.getByText("Étape 3 sur 4 — Le problème et l'accès")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Code à chiffres/ }));
    suivant();
    expect(screen.getByRole('alert')).toHaveTextContent('Saisissez votre code');
    fireEvent.change(screen.getByLabelText('Votre code'), { target: { value: '2580' } });
    suivant();

    // Étape 4 : récapitulatif lisible, code jamais en clair, RGPD et cases ici
    expect(await screen.findByRole('heading', { name: 'Vérification' })).toBeInTheDocument();
    const vous = screen.getByRole('region', { name: 'Vous' });
    expect(vous).toHaveTextContent('Claude Martin');
    expect(vous).toHaveTextContent(/Téléphone\s*06 12 34 56 79/);
    expect(vous).toHaveTextContent(/Pour vous joindre\s*06 98 76 54 31/);
    expect(screen.getByRole('region', { name: 'Votre appareil' })).toHaveTextContent(/Smartphone.*Fairphone 5/);
    const probleme = screen.getByRole('region', { name: "Le problème et l'accès" });
    expect(probleme).toHaveTextContent('Écran cassé');
    expect(probleme).toHaveTextContent('Vitre fissurée');
    expect(probleme).toHaveTextContent('Code de 4 caractères (masqué)');
    expect(probleme).not.toHaveTextContent('2580');
    expect(screen.getByRole('region', { name: 'Vos données personnelles' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /J'accepte de recevoir/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Je patiente en boutique/ })).not.toBeChecked();

    // « Modifier » renvoie à l'étape 1 avec les valeurs ; retour à la vérification en 3 « Suivant »
    expect(screen.getByRole('button', { name: 'Modifier : Vous' })).toHaveClass('min-h-11'); // 44 px au doigt
    fireEvent.click(screen.getByRole('button', { name: 'Modifier : Vous' }));
    expect(screen.getByText('Étape 1 sur 4 — Vous')).toBeInTheDocument();
    expect(screen.getByLabelText('Nom *')).toHaveValue('Martin');
    expect(screen.getByLabelText('Numéro pour vous joindre si différent (facultatif)')).toHaveValue('06 98 76 54 31');
    fireEvent.change(screen.getByLabelText('Société'), { target: { value: 'ACME' } });
    suivant();
    expect(await screen.findByLabelText(/Préciser marque/)).toHaveValue('Fairphone 5');
    suivant();
    expect(await screen.findByRole('radio', { name: /Code à chiffres/ })).toHaveAttribute('aria-checked', 'true');
    suivant();
    expect(await screen.findByRole('heading', { name: 'Vérification' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Vous' })).toHaveTextContent('ACME');

    fireEvent.click(screen.getByRole('button', { name: "Déposer l'appareil" }));
    await screen.findByText('KP-000070');
    expect(apiMock.createOrGetClient).toHaveBeenCalledWith({
      nom: 'Martin', prenom: 'Claude', telephone: '06 12 34 56 79', email: 'claude@exemple.fr', societe: 'ACME',
      carte_camby: 0, rgpd_informe: true, consentement_marketing: false,
    }, { asStaff: false });
    expect(apiMock.createTicket).toHaveBeenCalledTimes(1);
    expect(apiMock.createTicket).toHaveBeenCalledWith({
      client_ref: 'RefClientSignee', categorie: 'Smartphone', marque: 'Autre', modele: '', modele_autre: 'Fairphone 5',
      panne: 'Écran cassé', panne_detail: 'Vitre fissurée', pin: '2580', pattern: '', notes_client: '',
      commande_piece: 0, tel_contact: '06 98 76 54 31',
    }, { asStaff: false });
    expect(apiMock.createPartAuto).not.toHaveBeenCalled();
  });

  it('second numéro facultatif : invalide → erreur à l’étape 1 ; vide → null dans le payload', async () => {
    etape1({ telContact: '12' });
    suivant();
    expect(screen.getByRole('alert')).toHaveTextContent('Numéro invalide');
    expect(screen.getByLabelText('Numéro pour vous joindre si différent (facultatif)')).toHaveAttribute('aria-invalid', 'true');
    // L'aide « Si votre téléphone reste chez nous… » reste annoncée avec l'erreur
    expect(screen.getByLabelText('Numéro pour vous joindre si différent (facultatif)'))
      .toHaveAttribute('aria-describedby', 'depot-tel_contact-erreur depot-tel_contact-aide');
    expect(screen.getByText('Étape 1 sur 4 — Vous')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Numéro pour vous joindre si différent (facultatif)'), { target: { value: '' } });
    suivant();
    await etape2();
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Batterie' }));
    fireEvent.click(screen.getByRole('radio', { name: /Pas de code/ }));
    suivant();
    expect(await screen.findByRole('region', { name: "Le problème et l'accès" })).toHaveTextContent('Pas de code');
    fireEvent.click(screen.getByRole('checkbox', { name: /Je patiente en boutique/ }));
    fireEvent.click(screen.getByRole('button', { name: "Déposer l'appareil" }));
    await screen.findByText('KP-000070');
    expect(apiMock.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      panne: 'Batterie', pin: '', pattern: '', tel_contact: null, priorite: 'attente',
    }), { asStaff: false });
  });

  it('commande de pièce : étape 3 « Votre commande », sans bloc d’accès, pièce créée', async () => {
    etape1({ telContact: null });
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Commande' }));
    expect(screen.queryByLabelText('Marque *')).not.toBeInTheDocument();
    suivant();
    expect(await screen.findByText('Étape 3 sur 4 — Votre commande')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Pièce à commander *'), { target: { value: 'Écran OLED' } });
    suivant();
    expect(await screen.findByRole('region', { name: 'Votre commande' })).toHaveTextContent('Écran OLED');
    expect(screen.queryByRole('checkbox', { name: /Je patiente en boutique/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Valider la commande' }));
    await screen.findByText('KP-000070');
    expect(apiMock.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      categorie: 'Commande', panne: 'Pièce à commander', panne_detail: 'Écran OLED', commande_piece: 1, tel_contact: null,
    }), { asStaff: false });
    // Pièce commandée sans session : preuve de suivi du ticket tout juste créé (t = suivi_token)
    expect(apiMock.createPartAuto).toHaveBeenCalledWith(
      expect.objectContaining({ ticket_id: 70, description: 'Écran OLED', t: 'JetonSuivi70' }), { asStaff: false },
    );
  });
});

// ─── Dépôt comptoir /depot ───────────────────────────────────────
describe('Dépôt comptoir /depot : mêmes 4 étapes, schéma tracé', () => {
  it('schéma envoyé dans pattern (points traversés compris), tel_contact null, carte Camby', async () => {
    render(wrap(<DepotPage />, ['/depot']));
    expect(screen.getByText('Étape 1 / 4')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nom *'), { target: { value: 'Durand' } });
    fireEvent.change(screen.getByLabelText('Votre numéro de téléphone (obligatoire)'), { target: { value: '0612345679' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /carte Camby/ }));
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Smartphone' }));
    fireEvent.change(screen.getByLabelText('Marque *'), { target: { value: 'Autre' } });
    fireEvent.change(screen.getByLabelText(/Préciser marque/), { target: { value: 'Fairphone 5' } });
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Écran cassé' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Schéma/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Point 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Point 9' }));
    fireEvent.click(screen.getByRole('button', { name: 'Point 6' }));
    suivant();
    expect(await screen.findByRole('heading', { name: 'Vérification' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: "Le problème et l'accès" })).toHaveTextContent('Schéma de 4 points');
    expect(screen.getByRole('region', { name: 'Vous' })).toHaveTextContent(/Carte Camby\s*Oui/);
    fireEvent.click(screen.getByRole('button', { name: "Déposer l'appareil" }));
    expect(await screen.findByRole('heading', { name: 'Demande enregistrée !' })).toBeInTheDocument();
    expect(apiMock.createOrGetClient).toHaveBeenCalledWith(expect.objectContaining({ nom: 'Durand', carte_camby: 1 }));
    expect(apiMock.createTicket).toHaveBeenCalledWith({
      client_ref: 'RefClientSignee', categorie: 'Smartphone', marque: 'Autre', modele: '', modele_autre: 'Fairphone 5',
      panne: 'Écran cassé', panne_detail: '', pin: '', pattern: '1-5-9-6', notes_client: '', tel_contact: null,
    }, { asStaff: false });
  });
});

// ─── Dépôt à distance /deposer ───────────────────────────────────
describe('Dépôt à distance /deposer', () => {
  it('second numéro et code facultatif envoyés au pré-enregistrement, mention RGPD sur les codes', async () => {
    render(wrap(<DeposerPage />, ['/deposer']));
    expect(screen.getByRole('region', { name: 'Vos données personnelles' })).toHaveTextContent(/codes de déverrouillage/);
    fireEvent.change(screen.getByLabelText('Nom *'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Votre numéro de téléphone (obligatoire)'), { target: { value: '06 12 34 56 79' } });
    fireEvent.change(screen.getByLabelText('Numéro pour vous joindre si différent (facultatif)'), { target: { value: '06 98 76 54 31' } });
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Smartphone' }));
    fireEvent.change(screen.getByLabelText('Marque *'), { target: { value: 'Autre' } });
    fireEvent.change(screen.getByLabelText(/Préciser marque/), { target: { value: 'Fairphone 5' } });
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Écran cassé' }));
    // Facultatif ici : une tuile choisie sans valeur est signalée, rien choisi passe
    fireEvent.click(screen.getByRole('radio', { name: /Code à chiffres/ }));
    fireEvent.click(screen.getByRole('button', { name: /Envoyer ma demande/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Saisissez votre code');
    fireEvent.change(screen.getByLabelText('Votre code'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: /Envoyer ma demande/ }));
    await screen.findByText('KP-000071');
    expect(apiMock.createDepotDistance).toHaveBeenCalledWith(expect.objectContaining({
      telephone: '06 12 34 56 79', tel_contact: '06 98 76 54 31', pin: '1234', pattern: '', modele_autre: 'Fairphone 5',
    }));
  });
});

// ─── Écrans staff : second numéro ────────────────────────────────
describe('Écrans staff : le second numéro est celui qu’on appelle', () => {
  const MONTANTS = { total: 89, acompte: 10, reste: 79, paye: false, lignes: [{ label: 'Écran', prix: 89 }] };
  const ticket = (extra = {}) => ({
    id: 42, ticket_code: 'KP-000042', statut: 'En cours de réparation', client_id: 5, categorie: 'Smartphone',
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '04 79 60 89 22', client_email: '',
    tel_contact: '06 98 76 54 31', marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé',
    date_depot: '2026-10-10T09:00:00', paye: 0, acompte: 10, devis_estime: 89, montants: MONTANTS,
    jours_attente: 12, ...extra,
  });

  it('scan comptoir : « SMS au 06 … (autre numéro) » alors que la fiche n’a qu’un fixe', () => {
    expect(indicationPrevenir(ticket(), true)).toBe('SMS au 06 98 76 54 31 (autre numéro)');
    expect(indicationPrevenir(ticket({ tel_contact: null }))).toMatch(/^Client non joignable/);
    expect(indicationPrevenir(ticket({ client_tel: '06 12 34 56 79', tel_contact: '0612345679' }), true)).toBe('SMS au 06 12 34 56 79');
  });

  it('relance depuis l’étagère : lien d’appel vers le second numéro', async () => {
    render(wrap(<RelanceClient id="r1" ticket={ticket()} onDone={() => {}} onCancel={() => {}} />));
    const lien = await screen.findByRole('link', { name: /06 98 76 54 31 \(autre numéro\)/ });
    expect(lien).toHaveAttribute('href', 'tel:0698765431');
  });

  it('dashboard : icônes SMS et WhatsApp vers le second numéro', async () => {
    apiMock.getDashboard.mockResolvedValue({
      kpi: {}, total: 1,
      tickets: [{
        id: 1, ticket_code: 'KP-000001', statut: 'En attente de diagnostic', categorie: 'Smartphone',
        client_nom: 'Client1', client_prenom: '', client_tel: '0612345679', tel_contact: '0698765431',
        marque: 'Apple', modele: 'iPhone 13', panne: 'Écran', date_depot: '2026-10-11 09:00:00',
        priorite: 'normal', reception_complete: true,
      }],
    });
    apiMock.getActiveTeam.mockResolvedValue([]);
    apiMock.getInteractions.mockResolvedValue({});
    apiMock.getClients.mockResolvedValue([]);
    apiMock.getParts.mockResolvedValue([]);
    render(wrap(<DashboardPage />, ['/accueil']));
    await screen.findByText('KP-000001');
    // La ligne dit qu'un autre numéro existe (c'est lui que visent les icônes)
    expect(screen.getByText(/joignable 06 98 76 54 31/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^SMS à/ })).toHaveAttribute('href', expect.stringMatching(/^sms:0698765431\?/));
    expect(screen.getByRole('link', { name: /^WhatsApp à/ })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/wa\.me\/33698765431\?/));
  });
});
