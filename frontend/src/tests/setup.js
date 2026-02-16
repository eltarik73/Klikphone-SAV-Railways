/**
 * Vitest setup: mock browser globals.
 */
import '@testing-library/jest-dom';

// Mock localStorage
const store = {};
global.localStorage = {
  getItem: (key) => store[key] ?? null,
  setItem: (key, val) => { store[key] = String(val); },
  removeItem: (key) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

// Mock window.location
delete window.location;
window.location = { href: '', origin: 'http://localhost:3000' };
