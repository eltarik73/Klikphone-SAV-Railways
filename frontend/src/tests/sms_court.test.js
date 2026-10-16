import { describe, it, expect } from 'vitest';
import { versionCourteSms, smsSegments, estGsm } from '../lib/sms';

const URL_SUIVI = 'https://klikphone-sav-v2-production.up.railway.app/suivi?ticket=KP-002301';

describe('versionCourteSms', () => {
  it('retire le lien de suivi ajouté en fin de message', () => {
    const court = versionCourteSms(`Bonjour Jean, votre Apple iPhone 13 est prêt !\n\n📱 Suivez votre réparation : ${URL_SUIVI}`);
    expect(court).toBe('Bonjour Jean, votre Apple iPhone 13 est pret!');
    expect(smsSegments(court)).toMatchObject({ segments: 1, unicode: false });
  });

  it("remplace le lien d'accord par le téléphone de la boutique sans perdre la fin du message", () => {
    const court = versionCourteSms(
      `Bonjour Jean, le devis pour la réparation de votre Apple iPhone 13 est de 129.00 €. Vous pouvez accepter ou refuser directement en cliquant ici : ${URL_SUIVI}. Merci, l'équipe Klikphone`,
    );
    expect(court).not.toMatch(/suivi|https?:/);
    expect(court).toContain("Merci, l'équipe Klikphone");
    expect(court).toContain('accord au 04 79 60 89 22');
    expect(smsSegments(court).unicode).toBe(false);
    expect(smsSegments(court).segments).toBeLessThanOrEqual(2);
  });

  it('garde le lien avis Google mais retire emojis et lignes vides', () => {
    const avis = "Bonjour Jean,\n\nMerci d'avoir fait confiance à Klikphone ! 🙏\n\n👉 https://g.page/r/Cf6adrBONrj3EAE/review\n\nMerci et à bientôt 😊";
    const court = versionCourteSms(avis);
    expect(court).toContain('https://g.page/r/Cf6adrBONrj3EAE/review');
    expect(court).not.toMatch(/\n/);
    expect(estGsm(court)).toBe(true);
    expect(smsSegments(avis).unicode).toBe(true);
    expect(smsSegments(court).unicode).toBe(false);
  });

  it("ramène les lettres hors alphabet GSM et l'apostrophe typographique", () => {
    expect(versionCourteSms('Ça coûte l’intérêt d’être prêt')).toBe("Ça coute l'intéret d'etre pret");
    expect(estGsm(versionCourteSms('élève à côté où Ç'))).toBe(true);
  });

  it('laisse un message déjà court intact', () => {
    const msg = 'Bonjour Jean, la piece pour votre iPhone 13 est arrivee. Klikphone 04 79 60 89 22';
    expect(versionCourteSms(msg)).toBe(msg);
  });
});
