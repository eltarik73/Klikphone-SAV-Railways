/**
 * Tests for ApiClient (token management, auth headers, 401 handling).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Must import after setup.js mocks localStorage
import { api } from '../lib/api';

describe('ApiClient', () => {
  beforeEach(() => {
    localStorage.clear();
    api.token = null;
  });

  describe('setToken', () => {
    it('stores token in localStorage', () => {
      api.setToken('abc123');
      expect(api.token).toBe('abc123');
      expect(localStorage.getItem('kp_token')).toBe('abc123');
    });

    it('removes token from localStorage when null', () => {
      api.setToken('abc123');
      api.setToken(null);
      expect(api.token).toBeNull();
      expect(localStorage.getItem('kp_token')).toBeNull();
    });
  });

  describe('request', () => {
    it('adds Authorization header when token is set', async () => {
      api.setToken('mytoken');
      let capturedHeaders;
      global.fetch = vi.fn().mockImplementation((url, opts) => {
        capturedHeaders = opts.headers;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ ok: true }),
        });
      });

      await api.request('/api/test');
      expect(capturedHeaders['Authorization']).toBe('Bearer mytoken');
    });

    it('clears token and redirects on 401', async () => {
      api.setToken('expired');
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers(),
      });

      await expect(api.request('/api/test')).rejects.toThrow('Non authentifi\u00E9');
      expect(api.token).toBeNull();
      expect(localStorage.getItem('kp_token')).toBeNull();
    });
  });
});
