/** @type {import('tailwindcss').Config} */
import colors from 'tailwindcss/colors'

// Design épuré (nov. 2026, skill `design-epure`). `brand` = la couleur d'ACTION, pas la marque : depuis le
// 09/11/2026 (décision du gérant) elle est noire (rampe slate, 600 = slate-900) ; l'orange #FF6600 reste au
// seul logo officiel (LogoK.jsx). Le nom du jeton est gardé pour ne pas toucher aux 250 usages. Alias
// sémantiques (success/warning/danger/info) sur la palette Tailwind (emerald/amber/red/blue) et trois
// ombres : `xs` (boutons secondaires), `md` (menus), `lg` (modales, drawers, toasts). Aucune animation
// décorative déclarée ici (wiggle/shimmer retirés). Tout le reste reste Tailwind natif.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F1F5F9',  // slate-100 : fond d'un élément sélectionné (lisible sur blanc)
          100: '#E2E8F0', // slate-200
          200: '#CBD5E1', // slate-300
          300: '#94A3B8', // slate-400 : bordure d'un élément sélectionné
          400: '#64748B', // slate-500
          500: '#475569', // slate-600 : anneau de focus (7,6:1 sur blanc)
          600: '#0F172A', // slate-900 : bouton primaire, onglet actif, case cochée (17,9:1)
          700: '#1E293B', // slate-800 : survol du primaire, texte d'action
          800: '#020617', // slate-950 : bouton pressé
          900: '#020617',
        },
        sidebar: {
          DEFAULT: '#0F172A',
          light: '#1E293B',
          lighter: '#334155',
        },
        // Alias sémantiques (vert = ok/payé, ambre = attention, rouge = danger, bleu = information)
        success: colors.emerald,
        warning: colors.amber,
        danger: colors.red,
        info: colors.blue,
      },
      fontFamily: {
        // Inter variable (axe opsz) : les titres se distinguent par la taille, la graisse 600 et l'interlettrage,
        // pas par une seconde famille — `display` reste un alias de `sans` pour les anciennes classes `font-display`.
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        // Boutons secondaires, segment actif (les cartes n'ont pas d'ombre : bordure seule)
        xs: '0 1px 2px 0 rgb(15 23 42 / 0.06)',
        // Menus, popovers, listes déroulantes
        md: '0 4px 12px -2px rgb(15 23 42 / 0.10), 0 2px 4px rgb(15 23 42 / 0.06)',
        // Modales, drawers, palette, FAB, toasts
        lg: '0 12px 32px -8px rgb(15 23 42 / 0.18), 0 2px 6px rgb(15 23 42 / 0.06)',
      },
    },
  },
  plugins: [
    // Variant « short: » = écran bas (≤ 820 px : iPad paysage 768, portables 1366×768) ; la barre latérale
    // s'y compacte. Déclaré en variant (pas dans `screens` : un écran `raw` y désactiverait `min-[…]:`/`max-sm:`).
    ({ addVariant }) => addVariant('short', '@media (max-height: 820px)'),
  ],
}
