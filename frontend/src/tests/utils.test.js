/**
 * Tests for frontend utility functions.
 */
import { describe, it, expect } from 'vitest';
import {
  formatDate, formatDateShort, formatPrix,
  waLink, smsLink, getStatusConfig, STATUTS,
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
  it('has 8 statuses', () => {
    expect(STATUTS).toHaveLength(8);
  });

  it('starts with diagnostic and ends with closed', () => {
    expect(STATUTS[0]).toBe('En attente de diagnostic');
    expect(STATUTS[7]).toBe('Cl\u00F4tur\u00E9');
  });
});
