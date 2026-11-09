/**
 * Tests for StatusBadge component.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import StatusBadge from '../components/StatusBadge';

describe('StatusBadge', () => {
  it('renders the status text', () => {
    render(<StatusBadge statut="En attente de diagnostic" />);
    expect(screen.getByText('En attente de diagnostic')).toBeInTheDocument();
    cleanup();
  });

  it('liste (dot) : pastille violette pour le diagnostic, texte slate-700, aucun fond ni anneau', () => {
    const { container } = render(<StatusBadge statut="En attente de diagnostic" />);
    const badge = container.querySelector('span');
    expect(badge).toHaveClass('text-slate-700', 'text-xs', 'font-medium', 'whitespace-nowrap');
    expect(badge.className).not.toMatch(/bg-|ring-|shadow/);
    const pastille = badge.querySelector('span[aria-hidden="true"]');
    // Couleurs franches (gérant, 09/11/2026) : diagnostic en violet
    expect(pastille).toHaveClass('w-2', 'h-2', 'rounded-full', 'bg-violet-600');
    expect(pastille.className).not.toMatch(/border-dashed/);
    cleanup();
  });

  it('fiche (solid) : fond émeraude 50, texte 700, anneau et icône 14 px pour la réparation terminée', () => {
    const { container } = render(<StatusBadge statut="Réparation terminée" variant="solid" />);
    const badge = container.querySelector('span');
    expect(badge).toHaveClass('bg-emerald-50', 'text-emerald-700', 'ring-1', 'ring-emerald-200/80', 'rounded-md', 'h-7', 'text-sm');
    expect(badge.className).not.toMatch(/shadow/);
    const icone = badge.querySelector('svg');
    expect(icone).not.toBeNull();
    expect(icone).toHaveAttribute('aria-hidden', 'true');
    expect(icone).toHaveClass('w-3.5', 'h-3.5');
    cleanup();
  });

  it('pré-enregistré : cercle vide en pointillé, neutre', () => {
    const { container } = render(<StatusBadge statut="Pré-enregistré" />);
    expect(screen.getByText('Pré-enregistré')).toBeInTheDocument();
    const pastille = container.querySelector('span[aria-hidden="true"]');
    expect(pastille).toHaveClass('bg-transparent', 'border-2', 'border-dashed', 'border-slate-400');
    cleanup();
  });

  it('size="lg" : variante solid de 32 px (compatibilité)', () => {
    const { container } = render(<StatusBadge statut="En cours de réparation" size="lg" />);
    const badge = container.querySelector('span');
    expect(badge).toHaveClass('h-8', 'text-sm', 'bg-blue-50', 'text-blue-700', 'ring-1');
    cleanup();
  });

  it('clôturé : pastille slate-300 et texte slate-500 en liste, blanc cerclé slate-200 en fiche', () => {
    const { container, rerender } = render(<StatusBadge statut="Clôturé" />);
    expect(container.querySelector('span')).toHaveClass('text-slate-500');
    expect(container.querySelector('span[aria-hidden="true"]')).toHaveClass('bg-slate-300');
    rerender(<StatusBadge statut="Clôturé" variant="solid" />);
    expect(container.querySelector('span')).toHaveClass('bg-white', 'text-slate-500', 'ring-slate-200/80');
    cleanup();
  });

  it('aucun statut en rouge (réservé au retard, au refus, à l’impayé), ni orange ou gray', () => {
    for (const statut of ['Pré-enregistré', 'En attente de diagnostic', 'En attente de pièce', 'Pièce reçue',
      "En attente d'accord client", 'En cours de réparation', 'Réparation terminée', 'Rendu au client', 'Clôturé']) {
      const { container } = render(<StatusBadge statut={statut} variant="solid" />);
      expect(container.innerHTML, statut).not.toMatch(/red-|orange-|gray-/);
      cleanup();
    }
  });
});
