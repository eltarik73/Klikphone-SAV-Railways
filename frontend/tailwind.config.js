/** @type {import('tailwindcss').Config} */
import colors from 'tailwindcss/colors'

// Design V2 (polish) : la marque (brand, sidebar) ne bouge pas. On AJOUTE des alias
// sémantiques (success/warning/danger/info) qui pointent sur la palette Tailwind déjà
// utilisée (emerald/amber/red/blue) et deux ombres : `xs` (cartes, boutons) et `lg`
// (modales, panneaux, menus, toasts). Tout le reste reste Tailwind natif.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F5F3FF',
          100: '#EDE9FE',
          200: '#DDD6FE',
          300: '#C4B5FD',
          400: '#A78BFA',
          500: '#8B5CF6',
          600: '#7C3AED',
          700: '#6D28D9',
          800: '#5B21B6',
          900: '#4C1D95',
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
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        // Cartes, boutons secondaires, segment actif, badge lg
        xs: '0 1px 2px 0 rgb(15 23 42 / 0.06)',
        // Modales, drawers, palette, FAB, menus, toasts
        lg: '0 12px 32px -8px rgb(15 23 42 / 0.18), 0 2px 6px rgb(15 23 42 / 0.06)',
      },
      keyframes: {
        wiggle: {
          '0%, 100%': { transform: 'rotate(-1.5deg)' },
          '50%': { transform: 'rotate(1.5deg)' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
      },
      animation: {
        wiggle: 'wiggle 2s ease-in-out infinite',
      },
    },
  },
  plugins: [
    // Variant « short: » = écran bas (≤ 820 px : iPad paysage 768, portables 1366×768) ; la barre latérale
    // s'y compacte. Déclaré en variant (pas dans `screens` : un écran `raw` y désactiverait `min-[…]:`/`max-sm:`).
    ({ addVariant }) => addVariant('short', '@media (max-height: 820px)'),
  ],
}
