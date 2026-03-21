/**
 * Tests for frontend utility functions.
 */
import { describe, it, expect } from 'vitest';
import {
  formatDate, formatDateShort, formatPrix,
  waLink, smsLink, getStatusConfig, getStatusStyle,
  STATUTS, MESSAGE_TEMPLATES,
} from '../lib/utils';

describe('formatDate', () => {
  it('returns dash for null/undefined', () => {
    expect(formatDate(null)).toBe('\u2014');
    expect(formatDate(undefined)).toBe('\u2014');
  });

  it('formats a valid ISO date', () => {
    const result = formatDate('2024-06-15T14:30:00');
    expect(result).toContain('15');
    expect(result).toContain('06');
    expect(result).toContain('2024');
  });
});

describe('formatDateShort', () => {
  it('returns dash for empty input', () => {
    expect(formatDateShort(null)).toBe('\u2014');
  });

  it('formats date without time', () => {
    const result = formatDateShort('2024-01-20');
    expect(result).toContain('20');
    expect(result).toContain('01');
    expect(result).toContain('2024');
  });
});

describe('formatPrix', () => {
  it('returns dash for null', () => {
    expect(formatPrix(null)).toBe('\u2014');
    expect(formatPrix(undefined)).toBe('\u2014');
  });

  it('formats number with 2 decimals and euro sign', () => {
    expect(formatPrix(49.9)).toBe('49.90 \u20AC');
    expect(formatPrix(100)).toBe('100.00 \u20AC');
    expect(formatPrix(0)).toBe('0.00 \u20AC');
  });
});

describe('waLink', () => {
  it('converts French number to international format', () => {
    const link = waLink('0612345678', 'Bonjour');
    expect(link).toContain('33612345678');
    expect(link).toContain('wa.me');
    expect(link).toContain('Bonjour');
  });

  it('encodes message in URL', () => {
    const link = waLink('0600000000', 'Hello World');
    expect(link).toContain(encodeURIComponent('Hello World'));
  });
});

describe('smsLink', () => {
  it('creates sms link with body', () => {
    const link = smsLink('0612345678', 'Test SMS');
    expect(link).toMatch(/^sms:0612345678/);
    expect(link).toContain(encodeURIComponent('Test SMS'));
  });
});

describe('getStatusConfig', () => {
  it('returns config for known status', () => {
    const config = getStatusConfig('En attente de diagnostic');
    expect(config).toHaveProperty('bg');
    expect(config).toHaveProperty('text');
    expect(config).toHaveProperty('dot');
    expect(config).toHaveProperty('color');
    expect(config.bg).toContain('amber');
  });

  it('returns default config for unknown status', () => {
    const config = getStatusConfig('Statut Inconnu');
    expect(config).toHaveProperty('bg');
    expect(config.bg).toContain('slate');
  });
});

describe('STATUTS', () => {
  it('has 9 statuses', () => {
    expect(STATUTS).toHaveLength(9);
  });

  it('starts with pré-enregistré and ends with clôturé', () => {
    expect(STATUTS[0]).toBe('Pré-enregistré');
    expect(STATUTS[STATUTS.length - 1]).toBe('Clôturé');
  });

  it('contains all expected statuses in order', () => {
    expect(STATUTS).toContain('En attente de diagnostic');
    expect(STATUTS).toContain('En attente de pièce');
    expect(STATUTS).toContain('En cours de réparation');
    expect(STATUTS).toContain('Réparation terminée');
    expect(STATUTS).toContain('Rendu au client');
    expect(STATUTS.indexOf('En attente de diagnostic'))
      .toBeLessThan(STATUTS.indexOf('En cours de réparation'));
  });
});

describe('getStatusConfig - all statuses', () => {
  it('returns indigo config for Pré-enregistré', () => {
    const config = getStatusConfig('Pré-enregistré');
    expect(config.bg).toContain('indigo');
  });

  it('returns config with all required keys for every status', () => {
    STATUTS.forEach(s => {
      const config = getStatusConfig(s);
      expect(config).toHaveProperty('bg');
      expect(config).toHaveProperty('text');
      expect(config).toHaveProperty('dot');
      expect(config).toHaveProperty('color');
      // Should not be the default slate config
      expect(config.color).not.toBe('#94A3B8');
    });
  });
});

describe('getStatusStyle', () => {
  it('returns a string with bg and text classes', () => {
    const style = getStatusStyle('En attente de diagnostic');
    expect(style).toContain('bg-amber-50');
    expect(style).toContain('text-amber-700');
    expect(style).toContain('ring-1');
  });
});

describe('MESSAGE_TEMPLATES', () => {
  it('has at least 5 templates', () => {
    expect(MESSAGE_TEMPLATES.length).toBeGreaterThanOrEqual(5);
  });

  it('each template has key and label', () => {
    MESSAGE_TEMPLATES.forEach(t => {
      expect(t).toHaveProperty('key');
      expect(t).toHaveProperty('label');
      expect(t.key).toBeTruthy();
      expect(t.label).toBeTruthy();
    });
  });

  it('contains appareil_pret template', () => {
    expect(MESSAGE_TEMPLATES.find(t => t.key === 'appareil_pret')).toBeDefined();
  });
});
