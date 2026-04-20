/**
 * Résolution d'image pour les iPhones du stock.
 *
 * Stratégie :
 * 1. Si phone.image_url est défini → on l'utilise (URL pngimg.com ou upload admin)
 * 2. Sinon → placeholder SVG stylisé (silhouette iPhone propre)
 *
 * Les JPEG locaux avec fond studio ne sont PAS utilisés ici (Tarik préfère
 * les PNG transparents). L'admin peut coller une URL via la modal d'édition.
 */

// Placeholder SVG data URI — rectangle sombre arrondi (utilisé quand rien trouvé)
const PLACEHOLDER_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 600" width="300" height="600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a2a35"/>
      <stop offset="1" stop-color="#0f0f14"/>
    </linearGradient>
  </defs>
  <rect x="20" y="10" width="260" height="580" rx="42" fill="url(#g)" stroke="#3a3a45" stroke-width="2"/>
  <rect x="110" y="30" width="80" height="16" rx="8" fill="#0a0a0e"/>
  <text x="150" y="320" text-anchor="middle" fill="#6a6a78" font-family="sans-serif" font-size="22" font-weight="700">iPhone</text>
</svg>`,
  );

/**
 * Retourne l'URL de l'image pour un iPhone.
 * @param {{image_url?: string}} phone
 * @returns {string}
 */
export function getIPhoneImage(phone) {
  if (!phone) return PLACEHOLDER_SVG;
  if (phone.image_url && phone.image_url.trim()) return phone.image_url;
  return PLACEHOLDER_SVG;
}

export { PLACEHOLDER_SVG };
