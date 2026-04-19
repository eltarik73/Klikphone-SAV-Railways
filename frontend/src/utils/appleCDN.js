/**
 * Résolution d'image pour les iPhones du stock.
 *
 * Stratégie :
 * 1. Si phone.image_url est défini → on l'utilise (override admin)
 * 2. Sinon, fallback sur les images locales servies par le backend
 *    via /api/iphones/image/{filename}, mappées par model_key.
 * 3. En dernier recours (model_key inconnu) → placeholder inline SVG.
 */

// Mapping model_key → filename côté backend/app/assets/iphone_tarifs/
const LOCAL_IMAGE_MAP = {
  "iphone-17-pro-max": "iphone_17_pro_max.jpeg",
  "iphone-17-pro": "iphone_17_pro.jpeg",
  "iphone-17": "iphone_17.jpeg",
  "iphone-16e": "iphone_16e.jpeg",
  "iphone-16-pro-max": "iphone_16_pro_max.jpeg",
  "iphone-16-pro": "iphone_16_pro.jpeg",
  "iphone-16-plus": "iphone_16_plus.jpeg",
  "iphone-16": "iphone_16.jpeg",
  "iphone-15-pro-max": "iphone_15_pro_max.jpeg",
  "iphone-15-pro": "iphone_15_pro.jpeg",
  "iphone-15-plus": "iphone_15_plus.jpeg",
  "iphone-15": "iphone_15.jpeg",
  "iphone-14-pro-max": "iphone_14_pro_max.jpeg",
  "iphone-14-pro": "iphone_14_pro.jpeg",
  "iphone-14-plus": "iphone_14_plus.jpeg",
  "iphone-14": "iphone_14.jpeg",
  "iphone-13-pro-max": "iphone_13_pro_max.jpeg",
  "iphone-13-pro": "iphone_13_pro.jpeg",
  "iphone-13-mini": "iphone_13_mini.jpeg",
  "iphone-13": "iphone_13.jpeg",
  "iphone-12-pro-max": "iphone_12_pro_max.jpeg",
  "iphone-12-pro": "iphone_12_pro.jpeg",
  "iphone-12": "iphone_12.jpeg",
  "iphone-se-2022": "iphone_se_2022.jpeg",
  "iphone-se-2020": "iphone_se_2020.jpeg",
};

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
 * @param {{model_key: string, image_url?: string}} phone
 * @returns {string}
 */
export function getIPhoneImage(phone) {
  if (!phone) return PLACEHOLDER_SVG;
  if (phone.image_url && phone.image_url.trim()) return phone.image_url;

  const filename = LOCAL_IMAGE_MAP[phone.model_key];
  if (filename) {
    // URL relative — géré par l'API backend qui sert les JPEG
    return `/api/iphones/image/${filename}`;
  }
  return PLACEHOLDER_SVG;
}

export { PLACEHOLDER_SVG };
