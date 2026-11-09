/**
 * Fondations du design V2 (polish) :
 * - index.css expose les classes partagées (boutons, badges, cartes, en-têtes, tableaux, états,
 *   modales, toasts, échelle typographique) avec les contraintes AA (plus de 11 px, plus de slate-400
 *   pour du texte, vert plein = emerald-700, focus visible au clavier) ;
 * - tailwind.config.js : action noire (brand-600 = slate-900 #0F172A depuis le 09/11/2026, l'orange reste au logo),
 *   sidebar #0F172A, ombres xs/lg ;
 * - StatusBadge : pastille + texte en liste, badge plein cerclé en fiche ; PrioriteBadge : badges du système, sans ring ;
 * - Navbar : toutes les entrées rendues, focus visible, boutons icône nommés en mode replié ;
 * - Toast / ProgressTracker / ErrorBoundary : classes du système, plus de styles inline colorés.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const { auth, toast, apiMock } = vi.hoisted(() => {
  const base = { background: (fn) => fn() };
  const apiMock = new Proxy(base, {
    get(target, cle) {
      if (!(cle in target)) target[cle] = vi.fn().mockResolvedValue([]);
      return target[cle];
    },
  });
  return {
    auth: { user: { target: 'accueil', utilisateur: 'Karim', role: 'admin' }, logout: vi.fn() },
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), important: vi.fn() },
    apiMock,
  };
});

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));
// Centre de notifications : composant hors périmètre des fondations, remplacé par un bouton neutre
vi.mock('../components/NotificationCenter', () => ({
  default: () => <button type="button" className="focus-visible:ring-2">Notifications</button>,
}));

import tailwindConfig from '../../tailwind.config.js';
import StatusBadge from '../components/StatusBadge';
import { PrioriteBadge, PrioriteSelecteur } from '../components/PrioriteBadge';
import Navbar from '../components/Navbar';
import { ToastProvider, useToast } from '../components/Toast';
import ProgressTracker from '../components/ProgressTracker';
import ErrorBoundary from '../components/ErrorBoundary';

const ici = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(ici, '../styles/index.css'), 'utf-8');

/** Corps de la (première) règle `.classe { … }` dans index.css. */
const regle = (classe) => {
  const m = css.match(new RegExp(`\\.${classe.replace(/[-.]/g, '\\$&')}\\s*(?:,[^{]*)?\\{([^}]*)\\}`));
  return m ? m[1] : null;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── index.css ────────────────────────────────────────────
describe('index.css : classes partagées du design V2', () => {
  const attendues = [
    'btn', 'btn-primary', 'btn-secondary', 'btn-ghost', 'btn-success', 'btn-danger', 'btn-danger-ghost', 'btn-whatsapp',
    'btn-sm', 'btn-lg', 'btn-icon', 'btn-block',
    'badge', 'badge-dot', 'badge-success', 'badge-warning', 'badge-danger', 'badge-danger-solid', 'badge-info',
    'badge-neutral', 'badge-brand', 'badge-lg', 'badge-sm', 'badge-count',
    'card', 'card-body', 'card-header', 'card-footer', 'card-section', 'card-interactive', 'card-selected',
    'callout', 'callout-info', 'callout-success', 'callout-warning', 'callout-danger',
    'page', 'page-header', 'page-header-title', 'page-header-subtitle', 'page-header-actions',
    'page-tabs', 'page-tab', 'page-tab-active', 'segmented', 'segmented-item', 'segmented-item-active', 'scroll-fade-x',
    'input', 'textarea', 'select', 'input-lg', 'input-label', 'input-help', 'input-error', 'input-group',
    'checkbox', 'radio', 'choice', 'choice-on', 'choice-ok', 'choice-ko', 'choice-muted',
    'table-wrap', 'table', 'table-header', 'table-row', 'table-row-selected', 'table-cell-num', 'table-cell-muted',
    'table-sticky-col', 'list-card',
    'kpi-card', 'kpi-card-sm', 'kpi-icon', 'kpi-value', 'kpi-label', 'kpi-delta',
    'empty-state', 'empty-state-icon', 'error-state', 'loading-inline',
    'skeleton', 'skeleton-line', 'skeleton-row', 'skeleton-card', 'skeleton-title',
    'modal-overlay', 'modal', 'modal-header', 'modal-body', 'modal-footer',
    'drawer', 'drawer-header', 'drawer-body', 'drawer-footer', 'toast', 'fab',
    't-display', 't-h1', 't-h2', 't-h3', 't-body', 't-body-lg', 't-small', 't-caption', 't-label', 't-overline', 't-num', 't-mono',
  ];

  // Verre « liquid glass » et serif « éditoriale » de la vitrine retirés (design épuré, nov. 2026)
  it.each(['liquid-glass', 'font-editorial'])('ne définit plus .%s', (classe) => {
    expect(regle(classe)).toBeNull();
  });

  it.each(attendues)('définit .%s', (classe) => {
    expect(regle(classe), `.${classe} absente de index.css`).not.toBeNull();
  });

  it('bornes : .depot-form garde des saisies de 16 px', () => {
    expect(css).toMatch(/\.depot-form \.input \{[^}]*font-size: 16px/);
  });

  it('en-têtes de tableau : 12 px slate-500 (plus de 11 px ni de slate-400)', () => {
    const th = regle('table-header');
    expect(th).toMatch(/text-xs/);
    expect(th).toMatch(/text-slate-500/);
    expect(th).not.toMatch(/text-\[11px\]/);
    expect(th).not.toMatch(/slate-400/);
  });

  it('vert plein = emerald-700 (AA avec du blanc), WhatsApp en texte sombre', () => {
    expect(regle('btn-success')).toMatch(/bg-emerald-700/);
    expect(regle('btn-success')).not.toMatch(/emerald-600/);
    expect(regle('btn-whatsapp')).toMatch(/text-slate-950/);
  });

  it('boutons : focus visible au clavier, 40 px, désactivé neutre (plus d’opacité) et lisible (slate-500)', () => {
    const btn = regle('btn');
    expect(btn).toMatch(/focus-visible:ring-2/);
    expect(btn).toMatch(/min-h-\[40px\]/);
    expect(btn).not.toMatch(/opacity-50/);
    expect(regle('btn-primary')).toMatch(/disabled:bg-slate-100/);
    expect(regle('btn-primary')).toMatch(/disabled:text-slate-500/);
    // slate-400 sur slate-100 = 2,4:1 : illisible au comptoir même pour un contrôle inactif
    expect(css).not.toMatch(/disabled:text-slate-400/);
    expect(css).toMatch(/@media \(pointer: coarse\)[\s\S]*\.btn[\s\S]*min-height: 44px/);
  });

  it('tactile : saisies à 44 px et 16 px quel que soit la largeur (iPad paysage 1024 compris)', () => {
    const coarse = css.match(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/);
    expect(coarse).not.toBeNull();
    expect(coarse[1]).toMatch(/\.input, \.textarea, \.select \{ min-height: 44px; font-size: 16px; \}/);
  });

  it('bornes : la règle des paragraphes est en spécificité (0,0,1) — un utilitaire sur le <p> gagne', () => {
    expect(css).toMatch(/:where\(\.depot-form\) p \{ @apply text-base text-slate-700; \}/);
    expect(css).not.toMatch(/\n\s*\.depot-form p \{/);
  });

  it('contraste : compteurs des segmented en slate-600, fondu vertical disponible', () => {
    expect(css).toMatch(/\.segmented \.text-slate-500 \{ @apply text-slate-600; \}/);
    expect(regle('scroll-fade-y')).toMatch(/mask-image: linear-gradient\(to bottom/);
  });

  it('aucune taille de texte sous 12 px, carte xl sans bordure translucide, saisies 16 px sous lg', () => {
    expect(css).not.toMatch(/text-\[(?:8|9|10|10\.5|11)px\]/);
    expect(regle('card')).toMatch(/rounded-lg/);
    expect(regle('card')).not.toMatch(/shadow/); // carte = bordure seule (design épuré, nov. 2026)
    expect(regle('card')).toMatch(/border-slate-200\b/);
    expect(regle('card')).not.toMatch(/slate-200\/60/);
    expect(regle('input')).toMatch(/text-base lg:text-sm/);
    expect(regle('input')).toMatch(/placeholder:text-slate-500/);
    expect(regle('input-label')).not.toMatch(/uppercase/);
  });

  it('badges : 24 px, coins 6 px, texte 12 px ; compteur 18 px rond ; danger plein unique', () => {
    expect(regle('badge')).toMatch(/rounded-md/);
    expect(regle('badge-count')).toMatch(/rounded-full/);
    expect(regle('badge')).toMatch(/text-xs/);
    expect(regle('badge-count')).toMatch(/min-w-\[18px\] h-\[18px\]/);
    expect(regle('badge-danger-solid')).toMatch(/bg-red-600 text-white/);
    expect(regle('badge-warning')).toMatch(/text-amber-800/);
  });

  it('mouvement : règle prefers-reduced-motion globale et squelette figé', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms !important/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.skeleton \{ animation: none/);
    expect(css).toMatch(/@media print/);
  });
});

// ─── tailwind.config.js ───────────────────────────────────
describe('tailwind.config.js : action noire, tokens ajoutés', () => {
  const t = tailwindConfig.theme.extend;
  it('action noire : brand-600 slate-900, survol slate-800, focus slate-600 ; sidebar #0F172A ; police Inter', () => {
    // Décision du gérant (09/11/2026) : plus de violet, l'orange #FF6600 reste au seul logo
    expect(t.colors.brand[600]).toBe('#0F172A');
    expect(t.colors.brand[700]).toBe('#1E293B');
    expect(t.colors.brand[500]).toBe('#475569');
    expect(Object.values(t.colors.brand).map(v => v.toUpperCase())).not.toContain('#7C3AED');
    expect(Object.values(t.colors.brand).map(v => v.toUpperCase())).not.toContain('#FF6600');
    expect(t.colors.sidebar.DEFAULT).toBe('#0F172A');
    expect(t.fontFamily.sans[0]).toBe('Inter');
    expect(t.fontFamily.display[0]).toBe('Inter');
  });
  it('ajoute boxShadow.xs / boxShadow.lg et les alias success/warning/danger/info', () => {
    expect(t.boxShadow.xs).toMatch(/^0 1px 2px/);
    expect(t.boxShadow.lg).toMatch(/32px/);
    expect(t.colors.success[700]).toBe('#047857');
    expect(t.colors.warning[800]).toBe('#92400e');
    expect(t.colors.danger[600]).toBe('#dc2626');
    expect(t.colors.info[700]).toBe('#1d4ed8');
  });
  it('ajoute le variant « short: » (écran bas ≤ 820 px) sans toucher à `screens` (min-[…]:/max-sm: restent actifs)', () => {
    expect(t.screens).toBeUndefined();
    const variants = {};
    for (const plugin of tailwindConfig.plugins) plugin({ addVariant: (nom, regle) => { variants[nom] = regle; } });
    expect(variants.short).toBe('@media (max-height: 820px)');
  });
});

// ─── Pages publiques et connexion (design épuré, nov. 2026) ────────────────────────────────
describe('LoginPage / HomePage : logotype et mise en avant', () => {
  const login = readFileSync(resolve(ici, '../pages/LoginPage.jsx'), 'utf-8');
  const home = readFileSync(resolve(ici, '../pages/HomePage.jsx'), 'utf-8');
  it('connexion : plus de signature « Propulsé par TkS∞26 », de serif italique, de carte rounded-2xl ombrée ni d’animation d’entrée', () => {
    expect(login).not.toMatch(/Propulsé par|text-pink-|font-editorial|font-display|rounded-2xl|shadow-lg|animate-fade-up|font-extrabold/);
    expect(login).toMatch(/className="card p-6 sm:p-8"/);
    expect(login).toMatch(/<h1 className="t-h1 text-center/);
  });
  it('pages publiques /suivi et /deposer : plus de signature ni de « ∞ » rose, plus d’animation d’entrée', () => {
    for (const page of ['SuiviPage.jsx', 'DeposerPage.jsx']) {
      const src = readFileSync(resolve(ici, `../pages/${page}`), 'utf-8');
      expect(src, page).not.toMatch(/Propulsé par|text-pink-|font-extrabold|animate-in|hover:scale/);
    }
  });
  it('accueil public : fond uni, logo en aplat, une seule action pleine et les autres en secondaire', () => {
    expect(home).not.toMatch(/bg-gradient|drop-shadow|linearGradient|font-editorial|font-display|font-extrabold|uppercase|shadow-lg|animate-/);
    expect(home).toMatch(/bg-slate-50 text-slate-900/);
    expect((home.match(/btn-primary/g) || []).length).toBe(1);
    expect((home.match(/btn-secondary/g) || []).length).toBe(3);
  });
});

// ─── Badges ───────────────────────────────────────────────
describe('StatusBadge / PrioriteBadge', () => {
  it('StatusBadge : pastille + texte slate-700 sans fond en liste ; badge -50/-700 cerclé, 28 px / 32 px en lg, en fiche', () => {
    const { container, rerender } = render(<StatusBadge statut="En attente de diagnostic" />);
    const b = container.querySelector('span');
    expect(b).toHaveClass('text-slate-700', 'text-xs', 'whitespace-nowrap');
    expect(b.className).not.toMatch(/bg-|ring-|rounded-full|shadow/);
    expect(b.querySelector('span[aria-hidden="true"]')).toHaveClass('w-2', 'h-2', 'rounded-full', 'border-slate-400');
    rerender(<StatusBadge statut="Réparation terminée" variant="solid" />);
    expect(container.querySelector('span')).toHaveClass('h-7', 'text-sm', 'rounded-md', 'bg-emerald-50', 'text-emerald-700', 'ring-1');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<StatusBadge statut="Réparation terminée" size="lg" />);
    expect(container.querySelector('span')).toHaveClass('h-8', 'text-sm', 'bg-emerald-50');
  });

  it('PrioriteBadge : badges du système — attente = danger teinté (jamais plein), express = warning, pro = neutre, sans ring, 12 px minimum', () => {
    const { rerender } = render(<PrioriteBadge priorite="attente" />);
    let b = screen.getByText('Client attend sur place', { selector: 'span.badge' });
    expect(b).toHaveClass('badge-danger', 'badge-sm');
    expect(b.className).not.toMatch(/bg-red-600|text-white|badge-danger-solid|rounded-full/);
    expect(b.className).not.toMatch(/ring-/);
    expect(b.className).not.toMatch(/text-\[11px\]/);
    expect(b).toHaveAttribute('title', 'Priorité : Client attend sur place');
    rerender(<PrioriteBadge priorite="express" taille="md" />);
    b = screen.getByText('Express', { selector: 'span.badge' });
    expect(b).toHaveClass('badge-warning');
    expect(b.className).not.toMatch(/badge-sm|h-8/);
    rerender(<PrioriteBadge priorite="pro" taille="lg" />);
    b = screen.getByText('Pro', { selector: 'span.badge' });
    expect(b).toHaveClass('badge-neutral', 'h-8', 'text-sm');
    expect(b.className).not.toMatch(/blue/);
  });

  it('PrioriteSelecteur : segmented neutre, 4 radios, élément actif blanc, libellé 13 px sans majuscules', () => {
    render(<PrioriteSelecteur value="attente" onChange={() => {}} />);
    const groupe = screen.getByRole('group', { name: 'Priorité atelier' });
    expect(groupe.querySelector('.segmented')).not.toBeNull();
    expect(groupe.querySelector('legend')).toHaveClass('t-label');
    expect(groupe.querySelector('legend').className).not.toMatch(/uppercase/);
    expect(within(groupe).getAllByRole('radio')).toHaveLength(4);
    const actif = groupe.querySelector('.segmented-item-active');
    expect(actif).toHaveTextContent('Client attend sur place');
    expect(actif.className).not.toMatch(/bg-red-600|shadow-md/);
    expect(groupe.querySelectorAll('.segmented-item')).toHaveLength(4);
  });
});

// ─── Navbar ───────────────────────────────────────────────
const renderNavbar = (url = '/accueil') => render(
  <MemoryRouter initialEntries={[url]}><Navbar /></MemoryRouter>,
);

describe('Navbar : entrées, états et focus', () => {
  beforeEach(() => {
    localStorage.clear();
    apiMock.getKPI.mockResolvedValue({ total_actifs: 31 });
    apiMock.getInteractions.mockResolvedValue({ total_actions: 4 });
    apiMock.getConfig.mockResolvedValue({ MODULE_DEVIS_VISIBLE: 'true', MODULE_DEVIS_FLASH_VISIBLE: 'true' });
  });

  it('rend toutes les entrées (menu, devis, tarifs, administration, beta) avec aria-current sur la page active', async () => {
    renderNavbar('/accueil/clients');
    // La rubrique Devis dépend de la configuration (lue à l'ouverture)
    // (rubrique « Devis » + entrée « Devis » : deux boutons du même nom)
    expect(await screen.findAllByRole('button', { name: /^Devis$/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^Devis Flash$/ })).toBeInTheDocument();
    for (const libelle of ['Clients', 'Commandes', 'Demandes de commande', 'Attestation', 'Suivi (vue client)',
      'Tarifs', 'Reporting', 'Avis Google',
      'Community Manager', 'Configuration', 'Site Tarifs iPhone', 'Réduire', 'Changer', 'Déconnexion']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${libelle.replace(/[()]/g, '\\$&')}`) })).toBeInTheDocument();
    }
    const clients = screen.getByRole('button', { name: /^Clients/ });
    expect(clients).toHaveAttribute('aria-current', 'page');
    // Entrée active muette : fond blanc/10 + texte blanc (la barre gauche brand-500 est la seule trace de violet)
    expect(clients.className).toMatch(/bg-white\/10 text-white/);
    expect(clients.className).not.toMatch(/bg-brand-600\/20/);
    expect(screen.getByRole('button', { name: /^Commandes/ })).not.toHaveAttribute('aria-current');
    // Rubriques : un seul style, plus de couleur par rubrique (« Tarifs » est une entrée simple, sans rubrique)
    const devis = screen.getAllByRole('button', { name: /^Devis$/ })[0];
    expect(devis).toHaveAttribute('aria-expanded', 'true');
    expect(devis.getAttribute('style')).toBeNull();
    expect(devis.querySelector('.t-overline')).not.toBeNull();
    expect(screen.getByRole('button', { name: /^Tarifs$/ })).not.toHaveAttribute('aria-expanded');
    for (const absent of ['Réparation iPhone', 'Vente iPhones', 'Vente smartphones', 'Beta', 'Mes téléphones']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${absent}`) })).not.toBeInTheDocument();
    }
  });

  it('compteurs : total slate 18 px + point rouge d’urgence sur Dashboard (plus deux badges juxtaposés)', async () => {
    renderNavbar();
    const dash = await screen.findByRole('button', { name: /^Dashboard/ });
    // 31 apparaît sur Dashboard, sur Commandes (même total) et dans la barre mobile
    expect((await screen.findAllByText('31', { selector: '.badge-count' })).length).toBeGreaterThanOrEqual(2);
    const compteurs = dash.querySelectorAll('.badge-count');
    expect(compteurs).toHaveLength(1);
    expect(compteurs[0]).toHaveTextContent('31');
    expect(compteurs[0].className).not.toMatch(/text-\[10px\]|text-\[9px\]/);
    expect(dash.querySelector('.bg-red-500.rounded-full')).not.toBeNull();
  });

  it('tous les boutons ont un focus visible et une hauteur tactile', async () => {
    renderNavbar();
    await screen.findByRole('button', { name: /^Dashboard/ });
    const boutons = screen.getAllByRole('button');
    expect(boutons.length).toBeGreaterThan(15);
    for (const b of boutons) {
      expect(b.className, b.textContent || b.getAttribute('aria-label')).toMatch(/focus-visible:ring-2/);
      expect(b.className).not.toMatch(/transition-all/);
    }
    for (const b of boutons.filter(b => /^(Clients|Commandes|Attestation|Changer|Déconnexion|Réduire)/.test(b.textContent))) {
      expect(b.className, b.textContent).toMatch(/min-h-11/);
    }
    // Aucun bouton sans nom accessible (texte ou aria-label)
    for (const b of boutons) {
      expect((b.getAttribute('aria-label') || b.textContent).trim(), b.outerHTML.slice(0, 80)).not.toBe('');
    }
  });

  it('mode replié : boutons icône 40 px nommés (changer, déconnexion, verrouiller admin, ouvrir la barre)', async () => {
    localStorage.setItem('kp_sidebar_collapsed', '1');
    localStorage.setItem('klikphone_admin', 'true');
    renderNavbar();
    const changer = await screen.findByRole('button', { name: "Changer d'utilisateur" });
    expect(changer.className).toMatch(/w-10 h-10/);
    expect(screen.getByRole('button', { name: 'Déconnexion' }).className).toMatch(/w-10 h-10/);
    const verrou = screen.getByRole('button', { name: 'Verrouiller le mode admin' });
    expect(verrou.className).toMatch(/w-10 h-10/);
    // Le toggle perd son libellé « Réduire » en mode replié : il garde un nom (= son title)
    const ouvrir = screen.getByRole('button', { name: 'Ouvrir la barre' });
    expect(ouvrir).toHaveAttribute('title', 'Ouvrir la barre');
    expect(ouvrir).toHaveAttribute('aria-expanded', 'false');
    for (const b of screen.getAllByRole('button')) {
      expect((b.getAttribute('aria-label') || b.textContent).trim(), b.outerHTML.slice(0, 80)).not.toBe('');
    }
    fireEvent.click(verrou);
    expect(localStorage.getItem('klikphone_admin')).toBeNull();
    expect(apiMock.clearAdminToken).toHaveBeenCalled();
    // Entrées de menu nommées par aria-label (le libellé n'est plus affiché)
    expect(screen.getByRole('button', { name: 'Clients' })).toBeInTheDocument();
    // Déplier : la préférence est écrite, le libellé « Réduire » revient
    fireEvent.click(ouvrir);
    expect(localStorage.getItem('kp_sidebar_collapsed')).toBe('0');
    expect(screen.getByRole('button', { name: 'Réduire' })).not.toHaveAttribute('aria-label');
  });

  it('sous lg (tiroir mobile) : la préférence « repliée » du bureau est ignorée, le tiroir est complet', async () => {
    const matchMediaOrigine = window.matchMedia;
    window.matchMedia = vi.fn((q) => ({
      matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    try {
      localStorage.setItem('kp_sidebar_collapsed', '1');
      renderNavbar();
      const clients = await screen.findByRole('button', { name: /^Clients/ });
      // Libellé visible (pas un aria-label de mode replié) et barre à pleine largeur
      expect(clients).not.toHaveAttribute('aria-label');
      expect(clients.textContent).toContain('Clients');
      expect(document.querySelector('aside').className).toMatch(/w-64/);
      expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1024px)');
    } finally {
      window.matchMedia = matchMediaOrigine;
    }
  });

  it('mode déplié : « Verrouiller » garde son libellé (test api_erreurs), 44 px, et « Mode Admin » reste lisible', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    renderNavbar();
    const verrou = await screen.findByRole('button', { name: 'Verrouiller' });
    expect(verrou.className).toMatch(/min-h-11/);
    expect(screen.getByText('Mode Admin').className).toMatch(/text-xs/);
    const sousTitre = screen.getByText('Service après-vente');
    expect(sousTitre).toHaveClass('text-xs', 'text-slate-400');
    // Écran bas : « Changer » / « Déconnexion » passent en icônes 44 px, libellé conservé pour les lecteurs d'écran
    expect(screen.getByText('Changer', { selector: 'span' })).toHaveClass('short:sr-only');
    expect(screen.getByRole('button', { name: /^Déconnexion/ }).className).toMatch(/short:w-11/);
    // La signature « Propulsé par TkS∞26 » a disparu de la barre (design épuré)
    expect(screen.queryByText(/Propulsé par/)).toBeNull();
  });
});

// ─── Toast ────────────────────────────────────────────────
function Declencheur({ type = 'success', message = 'Ticket enregistré' }) {
  const t = useToast();
  return <button type="button" onClick={() => t[type](message)}>Déclencher</button>;
}

describe('Toast : blanc, bordure gauche sémantique, croix 40 px', () => {
  it('rend .toast avec la variante et un bouton de fermeture nommé', () => {
    render(<ToastProvider><Declencheur type="error" message="Échec de l’envoi" /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Déclencher' }));
    const alerte = screen.getByRole('alert');
    expect(alerte).toHaveClass('toast', 'border-l-red-600');
    expect(alerte.className).not.toMatch(/bg-red-50|transition-all/);
    expect(alerte.querySelector('svg').getAttribute('class')).toMatch(/text-red-700/);
    const croix = within(alerte).getByRole('button', { name: 'Fermer la notification' });
    expect(croix).toHaveClass('btn-ghost', 'btn-icon');
  });

  it('important : fond blanc et bordure brand (plus de dégradé), se ferme à la croix', async () => {
    vi.useFakeTimers();
    render(<ToastProvider><Declencheur type="important" message="Nouveau message client" /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Déclencher' }));
    const alerte = screen.getByRole('alert');
    expect(alerte).toHaveClass('toast', 'border-l-brand-600');
    expect(alerte.className).not.toMatch(/gradient|fuchsia|shadow-2xl/);
    fireEvent.click(within(alerte).getByRole('button', { name: 'Fermer la notification' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});

// ─── ProgressTracker / ErrorBoundary ──────────────────────
describe('ProgressTracker : stepper monochrome, seule l’étape courante en couleur d’action', () => {
  it('étapes faites = coche sur slate-500, courante = brand-600 + halo (aria-current="step"), à venir = cerclée slate, libellés 12 px', () => {
    const { container } = render(<ProgressTracker statut="En cours de réparation" hasPiece={false} />);
    expect(container.querySelector('[style]')).toBeNull();
    const courante = container.querySelector('[aria-current="step"]');
    expect(courante.className).toMatch(/bg-brand-600 text-white ring-4 ring-brand-100/);
    expect(courante.parentElement).toHaveTextContent('Réparation');
    const cercles = container.querySelectorAll('.rounded-full.w-8');
    expect(cercles).toHaveLength(5);
    expect(cercles[0].className).toMatch(/bg-slate-500 text-white/);
    expect(cercles[0].querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(cercles[4].className).toMatch(/border-slate-300 text-slate-500/);
    expect(container.innerHTML).not.toMatch(/text-slate-400/);
    // La couleur d'action (noir) est réservée à l'étape courante
    expect([...cercles].filter(c => /brand/.test(c.className))).toHaveLength(1);
    expect(screen.getByText('Diagnostic').className).toMatch(/text-slate-700/);
    expect(screen.getByText('Diagnostic').className).toMatch(/text-xs/);
    expect(screen.getByText('Rendu').className).toMatch(/text-slate-500/);
  });

  it('pré-enregistré : texte conservé en brand (étape courante), icône nue sans tuile, sans style inline', () => {
    const { container } = render(<ProgressTracker statut="Pré-enregistré" />);
    expect(container.querySelector('[style]')).toBeNull();
    expect(container.innerHTML).not.toMatch(/bg-brand-50/);
    expect(screen.getByText('Pré-enregistré').className).toMatch(/text-brand-700/);
    expect(screen.getByText(/En attente de validation/).className).toMatch(/t-caption/);
  });
});

function Casse() { throw new Error('Boum de test'); }

describe('ErrorBoundary : état d’erreur du système', () => {
  it('rend la carte, le callout danger et les actions avec leurs noms accessibles', () => {
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Casse /></ErrorBoundary>);
    expect(screen.getByText('Oups, une erreur est survenue')).toHaveClass('t-h2');
    expect(screen.getByText('Boum de test').closest('.error-state')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toHaveClass('btn-secondary');
    expect(screen.getByRole('button', { name: 'Recharger la page' })).toHaveClass('btn-secondary');
    expect(screen.getByRole('button', { name: 'Retour à la page précédente' })).toHaveClass('btn-ghost');
    expect(screen.getByRole('button', { name: "Copier le détail de l'erreur" })).toHaveClass('btn-ghost');
    silence.mockRestore();
  });
});
