/**
 * Sauvegarde (gérant, 11/11/2026 : « que je puisse faire des sauvegardes de tout de temps en temps ») :
 * rappel de la dernière sauvegarde, fichier complet et classeur lisible téléchargés tels quels.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EtatSauvegarde } from '../pages/ConfigPage';
import api from '../lib/api';

afterEach(() => vi.restoreAllMocks());

describe('EtatSauvegarde', () => {
  it('rien tant que l’état n’est pas connu', () => {
    const { container } = render(<EtatSauvegarde etat={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('jamais sauvegardé : rappel en ambre', () => {
    render(<EtatSauvegarde etat={{ derniere: null, jours: null, erreurs: [] }} />);
    expect(screen.getByText("Aucune sauvegarde téléchargée pour l'instant.")).toHaveClass('text-amber-800');
  });

  it('sauvegarde récente : date en français, sans alerte', () => {
    render(<EtatSauvegarde etat={{ derniere: '2026-11-11T09:00:00', jours: 0, erreurs: [] }} />);
    const p = screen.getByText(/Dernière sauvegarde/);
    expect(p).toHaveTextContent("Dernière sauvegarde : 11 novembre 2026 (aujourd'hui)");
    expect(p).toHaveClass('text-slate-600');
  });

  it('plus de 30 jours : rappel, et tables non sauvées signalées', () => {
    render(<EtatSauvegarde etat={{ derniere: '2026-09-01T09:00:00', jours: 71, erreurs: ['tickets', 'devis'] }} />);
    expect(screen.getByText(/il y a 71 jours/)).toHaveTextContent('pensez à en refaire une');
    expect(screen.getByText(/Tables non sauvées la dernière fois : tickets, devis/)).toHaveClass('text-red-700');
  });
});

describe('api : fichiers de sauvegarde téléchargés tels quels', () => {
  it('fichier complet et classeur lisible passent par exportFile (jeton admin compris)', async () => {
    const exp = vi.spyOn(api, 'exportFile').mockResolvedValue(undefined);
    await api.exportBackup();
    await api.exportBackupLisible();
    expect(exp.mock.calls[0][0]).toBe('/api/config/backup');
    expect(exp.mock.calls[0][1]).toMatch(/^klikphone_sauvegarde_\d{4}-\d{2}-\d{2}\.json$/);
    expect(exp.mock.calls[1][0]).toBe('/api/config/backup/lisible');
    expect(exp.mock.calls[1][1]).toMatch(/^klikphone_clients_reparations_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
