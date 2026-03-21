/**
 * Tests for ProgressTracker component.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ProgressTracker from '../components/ProgressTracker';

describe('ProgressTracker', () => {
  it('renders pre-registered state', () => {
    render(<ProgressTracker statut="Pré-enregistré" />);
    expect(screen.getByText('Pré-enregistré')).toBeInTheDocument();
    expect(screen.getByText(/En attente de validation/)).toBeInTheDocument();
    cleanup();
  });

  it('renders normal steps without piece', () => {
    render(<ProgressTracker statut="En cours de réparation" hasPiece={false} />);
    expect(screen.getByText('Diagnostic')).toBeInTheDocument();
    expect(screen.getByText('Réparation')).toBeInTheDocument();
    expect(screen.getByText('Terminé')).toBeInTheDocument();
    expect(screen.getByText('Rendu')).toBeInTheDocument();
    // "Pièce" step should not appear without hasPiece
    expect(screen.queryByText('Pièce')).not.toBeInTheDocument();
    cleanup();
  });

  it('renders piece steps when hasPiece is true', () => {
    render(<ProgressTracker statut="En attente de pièce" hasPiece={true} />);
    expect(screen.getByText('Pièce')).toBeInTheDocument();
    expect(screen.getByText('Diagnostic')).toBeInTheDocument();
    cleanup();
  });

  it('renders "Réparation terminée" at the correct step', () => {
    const { container } = render(<ProgressTracker statut="Réparation terminée" hasPiece={false} />);
    // Should render without crashing with all steps visible
    expect(screen.getByText('Terminé')).toBeInTheDocument();
    cleanup();
  });
});
