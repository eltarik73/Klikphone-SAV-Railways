/**
 * Fondations du design V2 (polish) :
 * - index.css expose les classes partagées (boutons, badges, cartes, en-têtes, tableaux, états,
 *   modales, toasts, échelle typographique) avec les contraintes AA (plus de 11 px, plus de slate-400
 *   pour du texte, vert plein = emerald-700, focus visible au clavier) ;
 * - tailwind.config.js garde la marque (brand-600 #7C3AED, sidebar #0F172A) et ajoute les ombres xs/lg ;
 * - StatusBadge / PrioriteBadge : pastilles rondes sans bordure (ring) ;
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
    'liquid-glass', 'font-editorial',
  ];

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
    expect(regle('card')).toMatch(/rounded-xl/);
    expect(regle('card')).toMatch(/border-slate-200\b/);
    expect(regle('card')).not.toMatch(/slate-200\/60/);
    expect(regle('input')).toMatch(/text-base lg:text-sm/);
    expect(regle('input')).toMatch(/placeholder:text-slate-500/);
    expect(regle('input-label')).not.toMatch(/uppercase/);
  });

  it('badges : 24 px ronds, texte 12 px ; compteur 18 px ; danger plein unique', () => {
    expect(regle('badge')).toMatch(/rounded-full/);
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
describe('tailwind.config.js : marque intacte, tokens ajoutés', () => {
  const t = tailwindConfig.theme.extend;
  it('garde brand-600 #7C3AED, sidebar #0F172A et Plus Jakarta Sans', () => {
    expect(t.colors.brand[600]).toBe('#7C3AED');
    expect(t.colors.brand[700]).toBe('#6D28D9');
    expect(t.colors.sidebar.DEFAULT).toBe('#0F172A');
    expect(t.fontFamily.sans[0]).toMatch(/Plus Jakarta Sans/);
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

// ─── Pieds de page publics ────────────────────────────────
describe('LoginPage / HomePage : logotype et mise en avant', () => {
  const login = readFileSync(resolve(ici, '../pages/LoginPage.jsx'), 'utf-8');
  const home = readFileSync(resolve(ici, '../pages/HomePage.jsx'), 'utf-8');
  it('le « ∞ » du pied de page clair est en pink-700 (5,6:1 sur slate-50 ; pink-600 faisait 4,39:1)', () => {
    expect(login).toMatch(/text-pink-700">∞</);
    expect(login).not.toMatch(/text-pink-600/);
  });
  it('même « ∞ » pink-700 sur les pieds de page publics /suivi et /deposer', () => {
    for (const page of ['SuiviPage.jsx', 'DeposerPage.jsx']) {
      const src = readFileSync(resolve(ici, `../pages/${page}`), 'utf-8');
      expect(src).toMatch(/text-pink-700">∞</);
      expect(src).not.toMatch(/text-pink-600/);
    }
  });
  it('accueil public : la carte « tarifs téléphones » garde un liseré brand, sans dégradé ni seconde action pleine', () => {
    expect(home).toMatch(/const ctaHighlight = [^\n]*border-brand-400\/50/);
    expect(home).not.toMatch(/ctaHighlight = [^\n]*(gradient|bg-brand-600)/);
    expect((home.match(/className=\{ctaPrimary\}/g) || []).length).toBe(1);
  });
});

// ─── Badges ───────────────────────────────────────────────
describe('StatusBadge / PrioriteBadge : pastilles rondes sans bordure', () => {
  it('StatusBadge : rounded-full, fond -50 conservé, sans ring, 24 px / 32 px en lg', () => {
    const { container, rerender } = render(<StatusBadge statut="En attente de diagnostic" />);
    const b = container.querySelector('span');
    expect(b).toHaveClass('rounded-full', 'bg-amber-50', 'text-amber-700', 'h-6', 'text-xs', 'whitespace-nowrap');
    expect(b.className).not.toMatch(/ring-1/);
    rerender(<StatusBadge statut="Réparation terminée" size="lg" />);
    expect(container.querySelector('span')).toHaveClass('h-8', 'text-sm', 'bg-emerald-50');
  });

  it('PrioriteBadge : attente = rouge plein rond, express = ambre 50/800, pro = bleu, sans ring, 12 px minimum', () => {
    const { rerender } = render(<PrioriteBadge priorite="attente" />);
    let b = screen.getByText('Client attend sur place', { selector: 'span.rounded-full' });
    expect(b).toHaveClass('bg-red-600', 'text-white', 'text-xs');
    expect(b.className).not.toMatch(/ring-/);
    expect(b.className).not.toMatch(/text-\[11px\]/);
    rerender(<PrioriteBadge priorite="express" taille="md" />);
    b = screen.getByText('Express', { selector: 'span.rounded-full' });
    expect(b).toHaveClass('bg-amber-50', 'text-amber-800', 'h-6');
    rerender(<PrioriteBadge priorite="pro" taille="lg" />);
    b = screen.getByText('Pro', { selector: 'span.rounded-full' });
    expect(b).toHaveClass('bg-blue-50', 'text-blue-700', 'text-sm');
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
      'Réparation iPhone', 'Réparation smartphones', 'Vente iPhones', 'Vente smartphones', 'Reporting', 'Prix à revoir', 'Avis Google',
      'Community Manager', 'Configuration', 'Site Tarifs iPhone', 'Beta', 'Réduire', 'Changer', 'Déconnexion']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${libelle.replace(/[()]/g, '\\$&')}`) })).toBeInTheDocument();
    }
    const clients = screen.getByRole('button', { name: /^Clients/ });
    expect(clients).toHaveAttribute('aria-current', 'page');
    expect(clients.className).toMatch(/bg-brand-600\/20/);
    expect(screen.getByRole('button', { name: /^Commandes/ })).not.toHaveAttribute('aria-current');
    // Rubriques : un seul style, plus de couleur par rubrique
    const tarifs = screen.getByRole('button', { name: /^Tarifs$/ });
    expect(tarifs).toHaveAttribute('aria-expanded', 'true');
    expect(tarifs.getAttribute('style')).toBeNull();
    expect(tarifs.querySelector('.t-overline')).not.toBeNull();
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
    expect(screen.getByText(/Propulsé par/).className).toMatch(/short:hidden/);
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
describe('ProgressTracker : stepper monochrome brand', () => {
  it('étapes faites = coche brand, courante = cerclée (aria-current="step"), à venir = slate, libellés 12 px', () => {
    const { container } = render(<ProgressTracker statut="En cours de réparation" hasPiece={false} />);
    expect(container.querySelector('[style]')).toBeNull();
    const courante = container.querySelector('[aria-current="step"]');
    expect(courante.className).toMatch(/border-brand-600/);
    expect(courante.parentElement).toHaveTextContent('Réparation');
    const cercles = container.querySelectorAll('.rounded-full.w-8');
    expect(cercles).toHaveLength(5);
    expect(cercles[0].className).toMatch(/bg-brand-600 text-white/);
    expect(cercles[4].className).toMatch(/bg-slate-100 text-slate-400/);
    expect(screen.getByText('Diagnostic').className).toMatch(/text-xs/);
    expect(screen.getByText('Rendu').className).toMatch(/text-slate-500/);
  });

  it('pré-enregistré : texte conservé en brand, sans style inline', () => {
    const { container } = render(<ProgressTracker statut="Pré-enregistré" />);
    expect(container.querySelector('[style]')).toBeNull();
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
