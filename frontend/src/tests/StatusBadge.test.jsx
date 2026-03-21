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

  it('applies amber classes for diagnostic status', () => {
    const { container } = render(<StatusBadge statut="En attente de diagnostic" />);
    expect(container.querySelector('span')).toHaveClass('bg-amber-50');
    cleanup();
  });

  it('applies emerald classes for finished status', () => {
    const { container } = render(<StatusBadge statut="Réparation terminée" />);
    expect(container.querySelector('span')).toHaveClass('bg-emerald-50');
    cleanup();
  });

  it('applies indigo classes for pré-enregistré', () => {
    const { container } = render(<StatusBadge statut="Pré-enregistré" />);
    expect(screen.getByText('Pré-enregistré')).toBeInTheDocument();
    expect(container.querySelector('span')).toHaveClass('bg-indigo-50');
    cleanup();
  });

  it('renders lg size variant', () => {
    const { container } = render(<StatusBadge statut="En cours de réparation" size="lg" />);
    expect(container.querySelector('span')).toHaveClass('text-sm');
    cleanup();
  });

  it('renders slate classes for clôturé', () => {
    const { container } = render(<StatusBadge statut="Clôturé" />);
    expect(container.querySelector('span')).toHaveClass('bg-slate-100');
    cleanup();
  });
});
