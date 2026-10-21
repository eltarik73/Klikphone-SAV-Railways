import { describe, it, expect } from 'vitest';
import { estTelephoneFictif, MESSAGE_TEL_FICTIF } from '../components/DepotEtapes';

// Même règle que le serveur (backend/app/api/clients.py : telephone_fictif)
describe('estTelephoneFictif (borne, dépôt comptoir, dépôt à distance)', () => {
  it.each(['06 00 00 00 00', '0611111111', '+33 6 00 00 00 00', '06 12 34 56 78', '0798765432', '07 77 77 77 77'])(
    '%s : numéro de remplissage refusé', (tel) => {
      expect(estTelephoneFictif(tel)).toBe(true);
    },
  );

  it.each(['06 12 34 56 79', '0611223344', '06 00 00 01 23', '0600009950', '+41 79 123 45 67', '06 12', ''])(
    '%s : accepté (ou incomplet, laissé à la validation du format)', (tel) => {
      expect(estTelephoneFictif(tel)).toBe(false);
    },
  );

  it('message clair pour le client', () => {
    expect(MESSAGE_TEL_FICTIF).toMatch(/vrai numéro/);
  });
});
