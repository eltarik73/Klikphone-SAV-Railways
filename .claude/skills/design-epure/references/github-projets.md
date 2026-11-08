# Les meilleurs projets open source : tokens réels et consensus (GitHub, 8 novembre 2026)

Valeurs lues dans le code (tailwind.config, globals.css, thèmes) de ~35 dépôts : kits (shadcn/ui, Radix Themes, Geist, Tremor, Mantine, HeroUI, coss/ui, Magic UI) et applications (Twenty, Cal.com, Formbricks, Documenso, Dub, Midday, OpenStatus, Plane, PostHog, Supabase Studio, Novu, Hoppscotch, Teable, Umami, Plausible, Outline, Chatwoot, Huly, Papermark, Trigger.dev, Inbox Zero, Rallly, Maybe, Unkey, Infisical, Ghost, Mattermost, Excalidraw…). Extraits de composants exemplaires (tableau, barre latérale, badge de statut, bouton, carte KPI, état vide) avec chemins de fichiers.

# Recherche GitHub — décisions de design des meilleurs projets open source (2024‑2026)

Objectif : alimenter un « skill » de design pour Klikphone SAV (React 18 + Vite + Tailwind 3.4, sans TypeScript ni librairie UI ; dashboard, tableaux, formulaires, fiches ticket, badges de statut, barre latérale sombre `#0F172A`, marque violette `#7C3AED`, Plus Jakarta Sans).

Méthode : étoiles et activité relevées le 08/11/2026 via l'API GitHub ; fichiers de tokens et composants **lus dans le code** (raw.githubusercontent.com, branches par défaut). 45 dépôts examinés, **30 analysés en détail** (valeurs ci‑dessous), 15 écartés (voir fin de section 1). Toutes les valeurs citées sont celles du code au 08/11/2026 ; les chemins sont donnés pour chaque groupe de valeurs.

Renommages constatés : `calcom/cal.com` → `calcom/cal.diy` ; `dubinc/dub` → `dubinc/dub.link` ; Origin UI → `cosscom/ui` (« coss ui ») ; `vercel/geist` n'existe pas (seul `vercel/geist-font`, 3 745 ★, la police) ; `maybe-finance/maybe` est **archivé** depuis 07/2025 ; `midday-ai/midday` sans commit depuis 06/2026 ; `tremorlabs/tremor` sans commit depuis 10/2025.

---

## 1. Fiches par projet

### 1.1 Kits et systèmes

#### shadcn/ui — https://github.com/shadcn-ui/ui — 127 610 ★ (actif, 08/11/2026)
Pourquoi : registre de composants copiés‑collés devenu le standard de fait des apps React/Tailwind ; le style « new‑york » v4 est repris tel quel par OpenStatus, Papermark, Inbox Zero, Rallly, Teable, Documenso…

Tokens (`apps/v4/app/globals.css`) :
- Police : variables `--font-sans`, `--font-heading`, `--font-mono` injectées par next/font (Geist sur le site). Corps UI = `text-sm` (14 px) ; champs `text-base md:text-sm` (16 px sur mobile pour éviter le zoom iOS, 14 px desktop).
- Neutre : **gris pur en oklch (chroma 0)** — `--background oklch(1 0 0)`, `--foreground oklch(0 0 0)`, `--muted/--secondary/--accent oklch(0.97 0 0)`, `--muted-foreground oklch(0.556 0 0)`, `--border/--input oklch(0.922 0 0)` (≈ #e5e5e5), `--ring oklch(0.708 0 0)`. Dark : `--background 0.145`, `--card/--popover 0.205`, `--border oklch(1 0 0 / 10%)`, `--input 15%`, `--ring 0.556`.
- Accent : **aucun** par défaut — `--primary` est noir, seul `--destructive` est chromatique (`oklch(0.577 0.245 27)`). La couleur n'apparaît que dans les charts (bleus) et `--sidebar-primary` en dark (`oklch(0.488 0.243 264)`).
- Rayons : `--radius: 0.625rem` (10 px) ; sm = ×0.6 (6 px), md = ×0.8 (8 px), lg = 10, xl = ×1.4 (14), 2xl ×1.8, 3xl ×2.2.
- Base : `* { @apply border-border outline-ring/50 }`, `a:active, button:active { opacity-60 md:opacity-100 }` (retour tactile mobile), `font-synthesis-weight: none; text-rendering: optimizeLegibility`.

Composants (`apps/v4/registry/new-york-v4/ui/`) :
- `button.tsx` : base `rounded-md text-sm font-medium transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 [&_svg]:size-4` ; tailles **xs h‑6 (24), sm h‑8 (32), default h‑9 (36) px‑4, lg h‑10 (40) px‑6**, icon `size-9` ; outline = `border bg-background shadow-xs hover:bg-accent` ; primary `bg-primary hover:bg-primary/90`.
- `input.tsx` : `h-9 rounded-md border border-input bg-transparent px-3 py-1 shadow-xs transition-[color,box-shadow]`, même anneau 3 px/50 %, `aria-invalid:border-destructive aria-invalid:ring-destructive/20`, `dark:bg-input/30`.
- `table.tsx` : `text-sm` ; `TableHead h-10 px-2 font-medium text-foreground whitespace-nowrap` ; `TableCell p-2` ; `TableRow border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted` ; footer `bg-muted/50`.
- `card.tsx` : `flex flex-col gap-6 rounded-xl border bg-card py-6 shadow-sm`, header `px-6`, titre `leading-none font-semibold`, description `text-sm text-muted-foreground`.
- `badge.tsx` : `rounded-full border border-transparent px-2 py-0.5 text-xs font-medium gap-1 [&>svg]:size-3` ; variantes default (plein), secondary, destructive, outline (`border-border text-foreground`), ghost, link.
- `sidebar.tsx` : `SIDEBAR_WIDTH 16rem` (256 px), mobile 18rem, icône 3rem (48 px) ; **claire** (`--sidebar oklch(0.985 0 0)`) ; item `h-8 rounded-md p-2 text-sm gap-2`, actif `bg-sidebar-accent font-medium`, libellé de groupe `h-8 text-xs font-medium text-sidebar-foreground/70` ; transition `duration-200 ease-linear`.
- `dialog.tsx` : `rounded-lg border p-6 shadow-lg duration-200` + `fade-in-0 zoom-in-95`, `sm:max-w-lg`.
- `skeleton.tsx` : `animate-pulse rounded-md bg-accent`.
- `empty.tsx` : `flex flex-col items-center gap-6 rounded-lg border-dashed p-6 md:p-12 text-center text-balance` ; icône dans tuile `size-10 rounded-lg bg-muted` (svg 24) ; titre `text-lg font-medium tracking-tight` ; en‑tête `max-w-sm`.
- Bloc dashboard‑01 (`blocks/dashboard-01/components/section-cards.tsx`) : carte KPI = `CardDescription` (libellé 14 px gris) + `CardTitle text-2xl font-semibold tabular-nums` + `Badge variant="outline"` pour la variation + footer `text-sm` ; grille `gap-4`, `shadow-xs`, fond `bg-gradient-to-t from-primary/5 to-card` (seul dégradé, à 5 %).

#### Radix Themes — https://github.com/radix-ui/themes — 8 825 ★ (dernier commit 04/2026)
Pourquoi : système de tokens le plus rigoureux du lot (échelles de 9, couleurs à 12 pas + alpha), référence de Twenty, Chatwoot, Supabase.

`packages/radix-ui-themes/src/styles/tokens/` :
- `typography.css` : tailles **12/14/16/18/20/24/28/35/60**, interlignes **16/20/24/26/28/30/36/40/60**, letter‑spacing `0.0025em → −0.025em` (resserré au‑delà de 18 px), graisses 300/400/500/700, police système (`-apple-system, Segoe UI, Roboto, Helvetica Neue, Open Sans`), taille par défaut 16.
- `space.css` : 4/8/12/16/24/32/40/48/64.
- `radius.css` : 3/4/6/8/12/16 px × facteur (small 0.75, **medium 1**, large 1.5).
- `shadow.css` : 6 niveaux, tous à base d'alpha gris + **ring 1 px** : `--shadow-2` (cartes) = `0 0 0 1px gray-a3, 0 0 0 0.5px black-a1, 0 1px 1px gray-a2, 0 2px 1px -1px black-a1, 0 1px 3px black-a1` ; `--shadow-3` (popovers) = `0 0 0 1px gray-a3, 0 2px 3px -2px gray-a3, 0 3px 12px -4px black-a2, 0 4px 16px -8px black-a2` ; `--shadow-1` = inset (champs).
`src/components/` :
- `_internal/base-button.css` : hauteurs size 1‑4 = `space-5/6/7/8` = **24/32/40/48 px**, rayons radius‑1/2/3/4 (3/4/6/8 px).
- `text-field.css` : hauteurs 24/32/40, focus `outline: 2px solid var(--text-field-focus-color); outline-offset: -1px` (anneau intérieur).
- `table.css` : cellule min‑height **36 px** (size 1, padding 8), **44 px** (size 2, padding 12), 48 px (size 3, padding 12/16) ; texte 14/20 ; ligne `box-shadow: inset 0 -1px var(--gray-a5)` ; cadre `1px solid var(--gray-a5)` + radius‑3/4.
- `badge.css` : `font-weight 500; line-height 1` ; size 1 = 12 px, padding 2/6 ; size 2 padding 4/8 ; 4 variantes : solid (`accent-9` + contraste), **soft (`accent-a3` fond + `accent-a11` texte)**, surface (`accent-surface` + `inset 0 0 0 1px accent-a6`), outline (`inset 1px accent-a8`).
- `card.css` : padding 12/16/24/32/48, rayons 8/8/12/12/16, bordure 1 px.

#### Tremor — https://github.com/tremorlabs/tremor — 3 692 ★ (dernier commit 10/2025, peu maintenu)
Pourquoi : référence « dashboard » Tailwind, copiée par Papermark ; recettes de focus explicites.
`src/utils/focusRing.ts`, `focusInput.ts`, `hasErrorInput.ts` : bouton `outline outline-offset-2 outline-0 focus-visible:outline-2 outline-blue-500` ; champ `focus:ring-2 focus:ring-blue-200 focus:border-blue-500` ; erreur `ring-2 ring-red-200 border-red-500`.
`src/components/` : `Button.tsx` `rounded-md border px-3 py-2 text-sm font-medium shadow-xs transition-all duration-100 ease-in-out` (≈ 36 px), primary `bg-blue-500 hover:bg-blue-600`, secondary `border-gray-300 bg-white hover:bg-gray-50`, light `bg-gray-200`, ghost ; `Input.tsx` `rounded-md border border-gray-300 px-2.5 py-2 shadow-xs sm:text-sm placeholder-gray-400` ; `Card.tsx` `rounded-lg border border-gray-200 p-6 shadow-xs bg-white` ; `Table.tsx` th `px-4 py-3.5 text-sm font-semibold text-gray-900 border-b border-gray-200`, td `p-4 text-sm text-gray-600`, corps `divide-y divide-gray-200`, pas de hover ; `Badge.tsx` **`rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset`** : neutral `bg-gray-50 text-gray-900 ring-gray-500/30`, success `bg-emerald-50 text-emerald-900 ring-emerald-600/30`, error `bg-red-50 text-red-900 ring-red-600/20`, warning `bg-yellow-50 text-yellow-900 ring-yellow-600/30` ; dark `bg-x-400/10 text-x-400 ring-x-400/20`. Neutre = Tailwind `gray`.

#### Mantine — https://github.com/mantinedev/mantine — 31 920 ★ (actif)
`packages/@mantine/core/src/core/MantineProvider/default-theme.ts` : police système ; fontSizes 12/14/16/18/20 ; lineHeights 1.4–1.65 ; headings 700 (34/26/22/18/16/14) ; **fontWeights medium = 600** ; radius xs 2 / sm 4 / **md 8 (défaut)** / lg 16 / xl 32 ; spacing 10/12/16/20/32 ; shadows xs `0 1px 3px rgba(0,0,0,.05), 0 1px 2px rgba(0,0,0,.1)`, sm `0 1px 3px .05, 0 10px 15px -5px .05, 0 7px 7px -5px .04` ; primaryShade light 6 / dark 8.
`components/Button/Button.module.css` : hauteurs xs 30 / **sm 36 (défaut)** / md 42 / lg 50 / xl 60, compact 22/26/30/34/40, padding‑x 14/18/22/26/32. `Input.module.css` : 30/36/42/50/60, padding = hauteur/3, bordure gray‑4, focus = bordure couleur primaire (pas d'anneau). `Badge.module.css` : hauteurs 16/18/20/26/32, tailles 9/10/11/13/16 px, `radius 1000px`, **UPPERCASE bold letter‑spacing .25px**. `Table.module.css` : fz sm, hover gray‑1, striped gray‑0, bordure gray‑3.

#### Origin UI / coss ui — https://github.com/cosscom/ui — 10 797 ★ (actif ; base du nouveau Cal.com)
`packages/ui/src/styles/globals.css` : radius 0.625rem (sm −4, md −2, xl +4) ; neutre Tailwind `neutral` ; `--foreground/--primary neutral-800` (pas noir) ; `--muted black/4%`, **`--border black/8%`, `--input black/10%`** (bordures en alpha) ; ring neutral‑400 ; sidebar neutral‑50, `--sidebar-border black/6%`.
`apps/ui/registry/default/ui/button.tsx` : `rounded-lg border font-medium text-base sm:text-sm transition-shadow focus-visible:ring-2 ring-ring ring-offset-1 disabled:opacity-64 [&_svg]:opacity-80` ; **default `h-9 sm:h-8` (36 mobile / 32 desktop)**, sm `h-8 sm:h-7`, lg `h-10 sm:h-9` ; `pointer-coarse:after:min-h-11` (cible tactile 44 px invisible). `input.tsx` : `h-8.5 sm:h-7.5` (30 px desktop). `badge.tsx` : `rounded-sm border-transparent font-medium h-5.5 sm:h-4.5 text-sm sm:text-xs`, soft `bg-destructive/8`, `bg-info/8`. `table.tsx` : th `h-10 px-2.5 text-muted-foreground leading-none`, hover `color-mix(background, black 2%)`, sélection 4 %, variante carte `rounded-xl shadow-xs/5`.

#### Magic UI — https://github.com/magicuidesign/magicui — 23 140 ★ (contre‑exemple « look IA », voir § 5)
`apps/www/styles/globals.css` : tokens shadcn copiés (Geist, radius 0.625rem, oklch neutre) + `--color-1..5` arc‑en‑ciel (`oklch(66.2% .225 25.9)`, `60.4% .26 302`, `69.6% .165 251`, `80.2% .134 225`, `90.7% .231 133`) et animations `gradient 8s`, `meteor 5s`, `marquee`, `shimmer-slide`, `shine`, `orbit`, `ripple`, `rainbow`. `registry/magicui/shimmer-button.tsx` : `conic-gradient` tournant, `shadow-[inset_0_-8px_10px_#ffffff1f]`, `rounded-2xl`, `transition-all duration-300` ; `bento-grid.tsx` : `rounded-xl [box-shadow:0_0_0_1px_rgba(0,0,0,.03),0_2px_4px_rgba(0,0,0,.05),0_12px_24px_rgba(0,0,0,.05)]`, hover `-translate-y-10`, icône 48 px `scale-75`, `duration-300` ; `magic-card.tsx` : spotlight 200 px suivant la souris ; `shine-border.tsx` 14 s ; `border-beam.tsx` 6 s.

### 1.2 Applications complètes

#### Twenty (CRM) — https://github.com/twentyhq/twenty — 60 631 ★ (actif)
Pourquoi : CRM open source à l'interface la plus citée (type Notion/Linear), tokens générés depuis Figma (`design-tokens`).
`packages/twenty-ui/src/theme/constants/ThemeLight.ts`, `ThemeCommon.ts`, `GrayScaleLight.ts`, `Animation.ts` :
- Police **`Inter, sans-serif`** ; tailles xxs .625rem, xs .85rem (13.6), sm .92rem (14.7), md 1rem, lg 1.23rem, xl 1.54rem, xxl 1.85rem ; graisses 400/500/600 ; interlignes lg 1.5 / md 1.1 ; icônes 14/16/20/24, trait 1.6/2/2.5.
- Gris 12 pas display‑p3 (gray1 1 → gray12 0.2) ; fonds primary #fff, secondary .988, tertiary .945, quaternary .922 ; texte primary **.2 (≈ #333, pas noir)**, secondary .4, tertiary .6, light .702 ; `transparent.light black/3.9%`, `medium black/7.8%`, `strong black/16%`.
- Bordures : strong .839 (≈ #d6d6d6), **medium .922 (≈ #ebebeb)**, light .945 ; `transparentStrong black/7%`.
- Rayons : xs 2, sm 4, **md 8**, lg 16, xl 20, pill 999.
- Ombres : light `0 2px 4px black/3.9%, 0 0 4px black/7.8%` ; strong `2px 4px 16px black/16%, 0 2px 4px black/7.8%` ; sidebar `-4px 4px 4px rgba(0,0,0,.005)` ; superHeavy 3 couches.
- Animation : instant .075 s, **fast .15 s**, normal .3 s, slow 1.5 s ; `clickableElementBackgroundTransition: background 0.1s ease`.
- Table : `horizontalCellPadding 8px`, colonne case 32 px ; `spacingMultiplicator 4` ; `betweenSiblingsGap 2px` ; panneau latéral 500 px ; modales 300/360/400/1200 px.
- Tags : 30 teintes Radix, fond accent‑3 (ex. gray `.976`) + texte accent‑11 (ex. blue `color(display-p3 .256 .354 .755)`) ; snackbar success `#00a43319` (fond à 10 %), erreur `#f3000d14`.

#### Cal.com — https://github.com/calcom/cal.diy — 49 793 ★ (actif ; Tailwind v4 + coss‑ui)
`packages/config/theme/tokens.css` (lignes 242‑350) :
- Tokens sémantiques HSL : `--cal-bg #fff`, `--cal-bg-muted hsl(210 20% 97%)`, `--cal-bg-subtle hsl(220 14% 94%)`, `--cal-bg-emphasis hsl(220 13% 91%)`, `--cal-bg-inverted hsl(210 30% 4%)` ; **bordure `hsl(216 12% 84%)` (gray‑300), subtle `(220 13% 91%)` (gray‑200), muted 94 %, emphasis 65 %** ; texte emphasis `(210 30% 4%)`, default `(220 6% 25%)`, subtle `(220 9% 46%)`, muted 65 % ; brand `hsl(221 39% 11%)` = quasi noir. Neutre = Tailwind **gray** (teinte 220).
- Sémantiques : info/success/attention/error en paire *subtle* (L 92‑97 %) + *emphasis* (L 24‑38 %).
- Rayons legacy : sm .125rem, default .25, md .375, lg .5, xl .75, 2xl 1.
- Ombres de boutons : `--shadow-outline-gray-rested: 0 2px 3px rgba(0,0,0,.03), 0 2px 2px -1px .03` ; `--shadow-outline-gray-focused: 0 0 0 1px rgba(255,255,255,.2), 0 0 0 2px rgba(0,0,0,.1)` ; active `0 2px 1px rgba(0,0,0,.05) inset` ; primaire **relief 5 couches** `--shadow-button-solid-brand-default: 0 2px 3px rgba(0,0,0,.06), 0 1px 1px .08, 1px 4px 8px .12, inset 0 2px .4px rgba(255,255,255,.12), inset 0 -3px 2px rgba(0,0,0,.04)`.
`packages/ui/components/button/Button.tsx` : base `text-sm font-medium rounded-[10px] transition gap-1` ; xs `h-6 text-xs rounded-md`, sm `h-7`, **base `px-2.5 py-2 leading-none` (≈ 32 px)**, lg `px-3 py-2.5` ; **pas de ring** : focus = ombre ci‑dessus ; `transition-shadow duration-200` (100 sur primary).
`badge/Badge.tsx` : `font-medium rounded-[4px] gap-x-1` ; sm `px-1 py-1 text-[10px] leading-none`, md `py-1 px-1.5 text-xs leading-none`, lg `text-sm rounded-lg` ; fond teinté + texte foncé (`bg-attention text-attention`, `bg-cal-success text-success`, `bg-error text-error`, gray `bg-emphasis text-emphasis`).
`table/TableNew.tsx` : `border-muted border text-sm`, th **`h-12 px-2 font-medium text-default`**, td `px-2 py-2.5`, ligne `hover:bg-cal-muted data-[state=selected]:bg-subtle border-b transition`. `form/inputs/TextField.tsx` : `h-9`. `apps/web/styles/globals.css` : `input:focus { --tw-ring-color: var(--brand-color); border-color: var(--brand-color) }`. `empty-screen/EmptyScreen.tsx` : icône 40 px `stroke-[1.3px]` dans cercle 72 px, texte `text-sm leading-6`, `max-w-[420px]`. `skeleton/Skeleton.tsx` : `bg-emphasis animate-pulse rounded-md`.

#### Formbricks — https://github.com/formbricks/formbricks — 13 225 ★ (actif ; Tailwind v4)
`apps/web/modules/ui/globals.css` : neutre **slate** ; `--color-primary #0f172a` (slate‑900) ; marque `#00e6ca` / `#038178` (teal), `--color-focus #1982fc` ; ombres de cartes bleutées `--shadow-card-sm: 0 .5px 12px -5px rgba(30,41,59,.2)`, md `0 1px 25px -10px .3`, lg `0 2px 51px -19px .4` ; animations 0.2 s ease‑out (accordion, fadeIn).
`modules/ui/components/button/index.tsx` : `rounded-md text-sm font-medium transition-colors focus-visible:ring-1 ring-ring disabled:opacity-50` ; default **h‑9 px‑4**, sm h‑8 text‑xs, lg h‑10, icon h‑9 ; secondary avec `border border-primary/5`. `input/index.tsx` : **h‑10** `rounded-md border-slate-300 bg-transparent px-3 py-2 text-base sm:text-sm placeholder:text-slate-500 focus:border-brand-dark focus:ring-2 focus:ring-slate-400 focus:ring-offset-2`. `badge/index.tsx` : fond 50/100 + bordure 200 + texte 800 (`bg-amber-100 border-amber-200 text-amber-800`, `bg-green-50 border-green-600 text-green-800`, `bg-red-100 border-red-200 text-red-800`, gray `bg-slate-100 border-slate-200 text-slate-600`) ; tailles `px-1.5 py-0.5 / px-2.5 py-0.5 / px-3.5 py-1`, text‑xs. `card/index.tsx` : `rounded-xl border border-slate-200 bg-white shadow-xs`, p‑6. `empty-state/index.tsx` : `rounded-xl border border-slate-100 bg-white p-4 shadow-2xs` + blocs fantômes `h-16 rounded-lg bg-slate-50`.

#### Documenso — https://github.com/documenso/documenso — 15 686 ★ (actif)
`packages/ui/styles/theme.css` : HSL slate (foreground `222.2 47.4% 11.2%`, muted `210 40% 96.1%`, muted‑fg `215.4 16.3% 46.9%`, border/input `214.3 31.8% 91.4%`), **primary vert citron `95 71% 67%`** (seule touche de marque, boutons + ring), `--radius .5rem`. `packages/tailwind-config/index.cjs` : rayons DEFAULT −3 px, sm −4, md −2, lg 8, xl +2, 2xl +4 ; police `var(--font-sans)` + pile Tailwind (Inter).
`packages/ui/primitives/button.tsx` : `rounded-md text-sm font-medium transition-colors focus-visible:ring-2 ring-ring ring-offset-2` ; default **h‑10 px‑4**, sm h‑9, lg h‑11. `input.tsx` : h‑10 `rounded-md border-input bg-background px-3 py-2 text-base md:text-sm placeholder:text-muted-foreground/40` + ring‑2 offset‑2. `badge.tsx` : **`rounded-md text-xs font-medium ring-1 ring-inset`** — neutral `bg-gray-50 text-gray-600 ring-gray-500/10`, destructive `bg-red-50 text-red-700 ring-red-600/10`, warning `bg-yellow-50 text-yellow-800 ring-yellow-600/20`, success `bg-green-50 text-green-700 ring-green-600/20`, info `bg-blue-50 text-blue-700 ring-blue-700/10` ; small `px-1.5 py-0.5`, default `px-2 py-1.5`, large `px-3 py-2 text-sm`. `table.tsx` : th **h‑12 px‑4 text-muted-foreground**, td `p-4`, ligne `border-b hover:bg-muted/50`. `card.tsx` : `rounded-lg border-2 bg-background` (bordure 2 px distinctive), p‑6, titre `text-lg`. `skeleton.tsx` : `animate-pulse rounded-md bg-muted`.

#### Dub — https://github.com/dubinc/dub.link — 25 136 ★ (actif)
Pourquoi : UI « noir et blanc » très copiée (Papermark reprend son StatusBadge à l'identique).
`packages/tailwind-config/tailwind.config.ts`, `themes.css` : polices **display Satoshi, default Inter, mono Geist Mono** ; neutre Tailwind **neutral** (+ `neutral-150 #ededed`) ; tokens RGB : `--bg-default 255`, `--bg-muted 250`, `--bg-subtle 245`, `--bg-emphasis 229`, `--bg-inverted 23` ; **`--border-subtle 229` (neutral‑200), `--border-default 212` (neutral‑300), `--border-emphasis 163`** ; `--content-emphasis 23` (neutral‑900), `--content-default 64` (neutral‑700), `--content-subtle 115`, `--content-muted 163` ; sémantiques fond 100 (`219 234 254` info…) / texte 600 ; animation modale `scale-in 0.2s cubic-bezier(0.16,1,0.3,1)`.
`packages/ui/src/button.tsx` : `h-10 rounded-lg border px-3 text-sm transition-all` ; primary `border-black bg-black text-white hover:bg-inverted **hover:ring-4 hover:ring-border-subtle**` (anneau de 4 px au survol, pas seulement au focus) ; secondary `border-border-subtle bg-bg-default hover:bg-bg-muted` ; success `bg-blue-500 hover:ring-4 ring-blue-100` ; raccourci `rounded px-2 py-0.5 text-xs font-light bg-neutral-100 text-neutral-400`.
`badge.tsx` : `rounded-full border px-2 py-px text-xs font-medium` ; **neutral = contour seul `border-neutral-400 text-neutral-500`**, gray `border-neutral-200 bg-neutral-100 text-neutral-800`, green `border-green-200 bg-green-100 text-green-900`.
`status-badge.tsx` : **`rounded-md px-2 py-1 text-xs font-medium gap-1.5` + icône `h-3 w-3`** ; neutral `bg-neutral-500/[.15] text-neutral-600`, success `bg-bg-success text-content-success`, pending/warning/error idem ; sm `px-1.5 py-0.5`.
`input.tsx` : `rounded-md border border-neutral-300 placeholder-neutral-400 focus:border-neutral-500 focus:ring-neutral-500 sm:text-sm`, read‑only `bg-neutral-100`. `table/table.tsx` : conteneur **`rounded-xl border border-border-subtle bg-bg-default`**, `border-separate border-spacing-0`, cellule `py-2.5 px-4 text-sm leading-6 border-l border-b border-border-subtle`, en‑tête `text-content-emphasis font-medium`, ligne cliquable `group-hover/row:bg-bg-muted transition-colors duration-75`, pagination `sticky bottom-0 border-t px-4 py-3.5`, vide `h-96 text-sm text-content-subtle`. `empty-state.tsx` : icône 24 px dans `size-16 rounded-2xl border border-neutral-200 bg-neutral-50`, titre `text-base font-medium text-neutral-950`, description `text-sm text-neutral-500 max-w-sm text-balance`.
`apps/web/ui/layout/sidebar/sidebar-nav.tsx` : **304 px = rail 64 + zone 240** ; zone `rounded-xl bg-neutral-100` dans page blanche ; item `h-8 rounded-lg p-2 text-sm leading-none transition-[background-color,color,font-weight] duration-75` ; rail `size-11 rounded-lg` ; pastille `size-3.5 rounded-full bg-blue-600 text-[0.625rem] font-semibold`.

#### Midday — https://github.com/midday-ai/midday — 15 116 ★ (dernier commit 06/2026)
`packages/ui/src/globals.css`, `tailwind.config.ts` : police **Hedvig Letters Sans** ; HSL `--foreground 0 0% 7%`, `--card 45 18% 96%` (beige), `--muted/--secondary 40 11% 89%`, `--border 45 5% 85%`, `--muted-foreground 0 0% 38%` ; **rayon 0 partout** (aucune classe `rounded` sur button/input/card ; badge `rounded-none`). `components/button.tsx` : h‑9 px‑4 text‑sm font‑medium, sm h‑8 text‑xs, lg h‑10, `focus-visible:outline-none` sans anneau (défaut a11y). `input.tsx` : `h-9 border bg-transparent px-3 py-1 text-sm`. `table.tsx` : th **h‑12 px‑4 text-[#666666] font-medium `border-r`**, td `px-4 py-2 border-r` (grille complète). `badge.tsx` tag `text-[#878787] bg-[#F2F1EF] text-[10px] font-normal rounded-none`. `card.tsx` : `border bg-background` sans ombre ; footer `border-t text-xs text-[#606060]`. `skeleton.tsx` : shimmer `bg-gradient-to-r from-transparent via-primary/10 to-transparent`. `apps/dashboard/src/components/sidebar.tsx` : **240 px / 70 px repliée**, `bg-background border-r`, en‑tête 70 px, item 40 px, `duration-200 cubic-bezier(0.4,0,0.2,1)`.

#### OpenStatus — https://github.com/openstatusHQ/openstatus — 9 250 ★ (actif)
`packages/ui/src/globals.css` : shadcn v4 verbatim (oklch neutre, `--radius .625rem`, `--radius-xs ×0.2`) + **`--success oklch(0.72 0.19 150)`, `--warning oklch(0.77 0.16 70)`, `--info oklch(0.62 0.19 260)`**. `components/ui/` : button h‑9/h‑8/h‑10 + ring 3 px ; input h‑9 ; table th `h-10 px-2`, td `p-2`, hover `bg-muted/50` ; card `rounded-xl border py-6 gap-6 shadow-sm` ; **badge `rounded-md`** (pas pilule) `border px-2 py-0.5 text-xs font-medium` ; sidebar 16rem.

#### PostHog — https://github.com/PostHog/posthog — 40 698 ★ (actif ; Lemon UI, SCSS)
`frontend/src/styles/base.scss` (l. 658‑905) : police `-apple-system, 'Inter', …` (+ emoji RoundHog) ; **`--radius .375rem` (6 px)**, sm .25rem, lg .625rem ; `--opacity-disabled .65` ; graisses medium 500, semibold 600 ; neutre chaud « 3000 » : texte `#111`, muted `rgb(17 17 17 / 60%)`, **bordure `#dadbd2`**, bold `#c1c2b9`, glass `#e4e5deb3` ; génériques `--border rgb(0 0 0 / 15%)`, light 8 %, bold 24 % ; marque `#f54e01` (orange) ; danger `#db3707`, warning `#f7a501`, success `#388600` (+ highlight 10 %) ; `--shadow-elevation-3000: 0 3px 0 var(--border-3000-light)` (ombre dure 3 px) ; échelle z‑index documentée (modal 1100, popover 1200, tooltip 99999…).
`lib/lemon-ui/LemonButton/LemonButton.scss` : hauteurs xsmall 1.25rem (20), small 1.625rem (26), **medium 2.0625rem (33)**, large 3.0625rem (49) ; padding‑x .25/.375/.5/.75rem ; `--lemon-button-chrome-depth .1875rem` (relief 3 px), hover −0.5 px, press +0.5 px ; `transition: opacity 200ms ease, transform 200ms ease`. `LemonInput.scss` : hauteur `calc(2.125rem + 3px)` (37 px), padding .25/.5rem, bordure 1 px, radius 6, focus = `border-secondary` (pas d'anneau). `LemonTable.scss` : **13 px**, cadre `1px solid border-primary` + `border-radius var(--radius)`, cellule `padding .5rem`, `--row-horizontal-padding .5rem`, en‑tête `text-transform: none; letter-spacing: normal`, bandeau de ligne coloré. `LemonTag.scss` : `padding .125rem .25rem; font-size .6875rem (11 px); font-weight 500; line-height 1rem; border 1px; radius 6px` ; **variantes = bordure colorée + texte coloré, fond transparent**. `LemonBadge.scss` : rond, 700, 12 px, transitions 150 ms ease‑out. `layout/navigation-3000/Navigation.scss` : panneau 300 px, settings nav 16rem, `--sidebar-row-height 3rem`, fond `--color-bg-primary` (clair), `border-right 1px`.

#### Supabase Studio — https://github.com/supabase/supabase — 114 655 ★ (actif ; Tailwind v4 CSS)
`packages/config/css/theme.css`, `shadows.css`, `utilities.css`, `ui/build/css/themes/light.css` : police `Circular, custom-font, Helvetica Neue…`, mono Source Code Pro ; couleurs Radix + marque `hsl(152.9 60% 52.9%)` (vert), destructive `hsl(10.2 77.9% 53.9%)` ; `--radius-panel 6px`, `--radius-item radius-md − 2px` ; **ombre « floating » 6 couches + ring** : `0 18px 47px black/3%, 0 7.5px 19px .02, 0 4px 10.5px .03, 0 2.3px 5.8px .03, 0 1.2px 3.1px .03, 0 .5px 1.3px .02, 0 0 0 1px black/5%` (dark ×5, ring white/18 %) ; `@utility focus-ring { outline-hidden focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background }` ; `focus-inset { outline: 2px solid; outline-offset: -2px }` pour les `<tr>` (« box‑shadow sur tr peu fiable, surtout Safari »).
`packages/ui/src/lib/constants.ts`, `raised-control-surface.ts`, `components/Button/Button.tsx` : tiny `h-[26px] px-2.5 py-1 text-xs`, **small `h-[34px] px-3 py-2 text-sm leading-4` (défaut)**, medium `h-[38px] px-4`, large `h-[42px]`, xlarge `h-[50px] px-6 py-3` ; icônes 14/18/20/20/24 ; rayon proportionnel `calc(radius-md × (1 + (h/26 − 1) × 0.35))`. `shadcn/ui/badge.tsx` : **micro‑pilule capitale** `rounded-full uppercase tracking-[0.07em] text-[9px] font-medium px-[5.5px] py-[3px]`, default `bg-surface-75 text-foreground-light border border-strong`, warning `bg-warning/10 text-warning-600 border-warning-500`, success `bg-brand-default/10 text-brand-600 border-brand-500`. `input.tsx` : `h-10 rounded-md border-control bg-field px-3 py-2 text-sm hover:border-control-hover transition-colors duration-200`, invalid `bg-destructive-200 border-destructive-400`. `table.tsx` : th `h-10 px-4 heading-meta text-foreground-lighter` (petites capitales), thead `bg-200`, hover `bg-surface-200`. `card.tsx` : `rounded-lg border bg-surface-100 shadow-xs`, sections `py-4 px-(--card-padding-x) border-b`.

#### Novu dashboard — https://github.com/novuhq/novu — 40 302 ★ (branche `next`, actif)
Pourquoi : design system complet (dérivé d'AlignUI) avec échelle typographique nommée et badges de statut à point.
`apps/dashboard/src/index.css`, `tailwind.config.ts` : police **Inter** ; échelle `label-xl 24/32, lg 18/24, md 16/24, sm 14/20, xs 12/16, 2xs 10/14` (+ `paragraph-*` identiques, `code-2xs 10/15 −0.0125em`) ; neutre HSL légèrement bleuté : 50 `0 0% 98%`, 100 `210 30% 96%`, 200 `220 18% 90%`, 300 `219 15% 82%`, 400 `220 11% 64%`, 500 `221 8% 48%`, 600 `222 11% 36%`, 700 `221 16% 20%`, 900 `226 21% 12%`, 950 `222 32% 8%` ; sémantique **bg‑weak 50 / soft 200 / sub 300 / surface 800 / strong 950 ; text‑strong 950 / sub 600 / soft 400 / disabled 300 ; stroke‑weak 100 / soft 200 / sub 300 / strong 950** ; marque `--novu-500` (rose), information blue‑500 ; rayons 4/6/8/10/12/16/20/24/999 ; ombres `xs 0 1px 2px rgba(10,13,20,.03)`, `sm 0 1px 2px #1018280F, 0 1px 3px #1018281A`, `md 0 16px 32px -12px rgba(14,18,27,.1)`, `box-xs 0 0 0 1px rgba(25,28,33,.04), 0 1px 2px rgba(25,28,33,.06)`, focus bouton `0 0 0 2px white, 0 0 0 4px primary-alpha-10` (double anneau).
`components/primitives/button.tsx` : lg `h-10 rounded-10 px-3.5 text-label-sm`, **md `h-9 rounded-lg px-3`**, sm `h-8 rounded-lg text-label-xs`, 2xs `h-7` ; `transition duration-200 ease-out` ; primary filled = `bg-gradient-to-b from-primary/90 to-primary` + `shadow-[inset_0_-4px_2px_-2px_primary, inset_0_0_0_1px_rgba(255,255,255,.16), 0_0_0_1px_primary, 0_1px_2px_#0E121B3D]` ; secondary `bg-bg-white text-text-sub shadow-xs ring-stroke-soft`. `badge.tsx` : `rounded-full leading-none transition duration-200` ; sm `h-4 px-2`, md `h-5 px-2 text-label-xs` ; filled / light (`bg-x-light text-x-dark`) / lighter / stroke (`ring-1 ring-inset ring-current`), point `before:size-1 rounded-full bg-current`. **`status-badge.tsx` : `h-6 rounded-md px-2 text-label-xs gap-2`, light = `bg-bg-white text-text-sub ring-1 ring-inset ring-stroke-soft` + point/icône coloré (`text-success-base`, `size-1.5`)**. `tag.tsx` : `h-6 rounded-md px-2 text-label-xs text-text-sub ring-1 ring-inset ring-stroke-soft`. `input.tsx` : wrapper `bg-bg-white shadow-xs` + `has-[input:focus]:ring-[3px] ring-stroke-soft/50 border-stroke-soft`, `hover:bg-bg-weak`. `table.tsx` : conteneur `rounded-lg border border-neutral-alpha-200 shadow-xs`, `border-separate border-spacing-0 text-sm`, th `h-10 px-6 py-2 text-foreground-600 font-medium`, td `border-b neutral-alpha-100`, squelette `h-8 rounded-md bg-neutral-100`. `card.tsx` : `rounded-xl border border-neutral-200 bg-white shadow`, en‑tête `bg-neutral-50 p-4 text-sm font-medium`. `analytics-card.tsx` (KPI) : `bg-bg-white rounded-xl p-2.5 shadow-box-xs`, libellé `font-code text-[12px] uppercase text-text-sub` + icône `size-4`, valeur `text-title-h5 font-semibold text-text-strong`, tendance `size-2` + `text-subheading-2xs uppercase`. `side-navigation.tsx` : **275 px**, claire.

#### Teable — https://github.com/teableio/teable — 21 957 ★ (actif ; shadcn stock)
`packages/ui-lib/src/shadcn/ui/` : button `rounded-md text-sm transition-colors focus-visible:ring-1` ; default h‑9 px‑3, sm `h-8 text-[13px]`, lg `h-10 rounded-lg`, xs `h-7 text-xs` ; **input `h-8 text-sm` (sm h‑7)** `rounded-md border-border hover:border-primary/30 focus-visible:border-primary` (bordure colorée, pas d'anneau) ; badge `rounded-md border px-2.5 py-0.5 text-xs font-semibold` ; table th `h-10 px-2 text-muted-foreground`, td `p-2`, hover `bg-primary/5`.

#### Plausible — https://github.com/plausible/analytics — 29 793 ★ (actif ; Tailwind v4)
`assets/css/app.css` : **gray = zinc** (+ `gray-75 rgb(247 247 248)`, 150, `750 rgb(50 50 54)`, 825, `850 rgb(34 34 38)`), yellow → amber, green → emerald ; accent **indigo‑600** (bouton), `--default-ring-width 2px; --default-ring-color indigo-500` ; focus `ring-2 ring-indigo-500 ring-offset-2` ; boutons `h-8 px-2 / h-9 px-3 / h-10 px-3.5`, secondary `border-gray-300 bg-white` ; champs `text-sm text-gray-900` h‑9/h‑10 ; menus `rounded-md ring-1 shadow-md text-[0.8125rem]/5 px-2.5 py-1.5` ; `animate-pulse 1.5s`.

#### Outline — https://github.com/outline/outline — 41 202 ★ (actif ; styled‑components)
`shared/styles/theme.ts`, `globals.ts` : police `-apple-system, BlinkMacSystemFont, Inter, Segoe UI, Roboto` ; corps 16 px / 1.5 ; titres 500 / 1.25 ; graisses 400/500/600 ; couleurs : `almostBlack #111319`, `slate #66778F` (tertiaire), `slateDark #394351` (secondaire), **`slateLight #DAE1E9` (divider, inputBorder)**, `smoke #F4F7FA`, `warmGrey hsl(212 31% 95%)` (fond secondaire) ; accent `#0366d6` ; danger `#ed2651`, warning `#f08a24`, success `#3ad984` ; ombre `rgba(0,0,0,.2)` ; **sidebar 260 px** (min 240, max 500, repliée 16). `app/components/Button.tsx` : `height 32px; border-radius 6px; font-size 14px; font-weight 500; box-shadow rgba(0,0,0,.2) 0 1px 2px; transition background 200ms ease-out` ; mobile 44 px pilule ; neutre `rgba(0,0,0,.07) 0 1px 2px` + `inset 0 0 0 1px inputBorderFocused` au focus. `Input.tsx` : `height 30px; font-size 15px; padding 8px 12px`, bordure sur le wrapper. `Table.tsx` : `HEADER_HEIGHT 40`, 14 px, tag 24 px radius 4.

#### Chatwoot (service client — cas le plus proche d'un SAV) — https://github.com/chatwoot/chatwoot — 39 082 ★ (actif ; Vue + Tailwind)
`tailwind.config.js`, `theme/colors.js`, `app/javascript/dashboard/assets/scss/_next-colors.scss`, `_typography.scss`, `_woot.scss` :
- Police **Inter** (+ InterDisplay), graisses variables 420/440/460/520 ; typographie nommée : **body‑main 14 px / lh 21 / ls −0.28 px / 420**, heading‑1 18/24/520, heading‑2 16/24/500, heading‑3 14/21/500, label 14/21/500, label‑small 12/16/440 (ls −0.24).
- Neutre **Radix slate** : slate‑1 `252 252 253` … slate‑3 `240 240 243`, slate‑6 `217 217 224`, slate‑9 `139 141 152`, slate‑11 `96 100 108`, slate‑12 `28 32 36` ; `--background-color 247 247 247` ; **`--border-weak 234 234 234`, `--border-strong 226 227 231`, `--border-container 236 236 236`** ; `--solid-1/2/3 #fff` ; dark background `28 29 32`, solid‑2 `29 30 36`, border‑weak `31 31 37`.
- Marque `#2781F6` (blue‑9) ; palettes Radix iris/blue/ruby/amber/teal.
`components-next/button/Button.vue` : base **`inline-flex min-w-0 gap-2 transition-all duration-100 ease-out border-0 rounded-lg outline-1 outline disabled:opacity-50`** + `active:enabled:scale-[0.97]` (xs/sm) / `0.98` (md/lg) ; tailles **xs h‑6 px‑2, sm h‑8 px‑3, md h‑10 px‑4, lg h‑12 px‑5** ; variantes solid (`bg-n-brand text-white hover:brightness-110`), faded (`bg-n-brand/10 text-n-blue-11`), outline (`outline-n-brand`), ghost (`hover:bg-n-alpha-2`), link ; couleurs blue/ruby/amber/slate/teal.
`input/Input.vue` : bordure = **`outline outline-1 outline-n-weak hover:outline-n-slate-6 focus:outline-n-brand`** ; sm `h-8 px-3 py-2`, md `h-10 px-3 py-2.5` ; libellé `text-heading-3 text-n-slate-12`.
`label/Label.vue` (étiquette) : `rounded-lg outline outline-1 -outline-offset-1` + **pastille `size-2 rounded-sm` colorée + texte `text-label font-420`** (point coloré, texte neutre, bordure).
`table/BaseTable.vue`, `BaseTableCell.vue` : `min-w-full table-auto divide-y divide-n-weak` ; th `py-4 pr-4 text-heading-3 text-n-slate-12 capitalize` ; td `py-3 pr-4 text-body-main` ; corps `text-n-slate-11` ; vide `py-20 text-center text-base text-n-slate-11`.
`sidebar/Sidebar.vue`, `SidebarGroupLeaf.vue` : `bg-n-background border-r border-n-weak`, 200 px mobile / ≈ 240 desktop ; item **`h-8 px-2 py-1 rounded-lg text-sm`** hover `bg-gradient-to-r from-transparent via-n-slate-3/70 to-n-slate-3/70`, icône `size-4`. Tooltip `bg-n-solid-2 text-n-slate-12 py-1 px-2 text-xs rounded-md`. `EmptyStateLayout.vue` : aperçu fantôme (`opacity-50 pointer-events-none`, `max-h-[28rem]`) derrière un contenu centré `gap-6`.

#### Huly — https://github.com/hcengineering/platform — 28 072 ★ (actif ; Svelte, SCSS)
`packages/theme/styles/_vars.scss`, `_colors.scss`, `global.scss`, `button.scss`, `tables.scss`, `common.scss` : police **IBM Plex Sans**, corps `.875rem`, échelle 10/11/12/13/14/16/18/20 ; espacement 0.125 → 7.5rem ; tailles UI min 16 / xs 24 / **small 32 / medium 40** / large 48 / xl 56 / max 64 ; rayons min 2 / xs 4 / small 6 / **medium 8** / large 16 (+ variantes « focus » +2 px) ; thème clair : `--theme-bg-color #F1F1F4`, navpanel `#FBFBFC`, comp‑header `#FBFBFC`, divider `rgba(0,0,0,.06)`, bg‑divider `#E3E3E5`, table border `rgba(0,0,0,.1)`, table header `#EFEFF2`, row `#F4F4F6`, texte content `rgba(0,0,0,.8)`, dark .6, half .5, caption `#000`, bouton default `rgba(0,0,0,.02)` / bordure `.09` ; dark : bg `#161719`, navpanel `#0E0F10`, divider white/6 %, table header `#1A1C20`, content white/80 % ; boutons large 48 / medium 40 / small 32 / xs 24, rayons 8/8/6/4, focus `outline 2px solid --global-focus-BorderColor; outline-offset 2px` ; bouton « attention » = dégradé **`#7C3AED → #A855F7`**, ombre `0 8px 24px rgba(124,58,237,.4)`, focus `0 0 0 3px rgba(124,58,237,.3)` (seul usage d'un dégradé, réservé à une action d'alerte) ; tables : cadre `1px divider` + rayon 16, en‑têtes 12 px / 500 / lh 1rem.

#### Papermark — https://github.com/papermark/papermark — 9 311 ★ (dernier commit 08/2026)
`styles/globals.css` : HSL Tailwind **gray** commenté (`--foreground 224 71.4% 4.1% /* gray-950 */`, muted gray‑100, muted‑fg gray‑500, **border gray‑200, input gray‑300**, primary gray‑900, ring gray‑400, radius .5rem, sidebar `0 0% 98%`). `components/ui/button.tsx` : default **h‑10** px‑4, sm h‑9, lg h‑11, `ring-2 ring-offset-2`, svg `size-5`. `badge.tsx` : `rounded-full border px-2.5 py-0.5 text-xs font-semibold` + `bg-amber-50 text-amber-700` (dark `bg-amber-900/30 text-amber-400`). `status-badge.tsx` : copie Dub `rounded-md px-2 py-1 text-xs font-medium`, `bg-gray-500/[.15] text-gray-600`, `bg-green-500/[.15] text-green-600`, `bg-orange-500/[.15] text-orange-600`. `table.tsx` : th h‑12 px‑4, td p‑4, hover `bg-gray-100`. `tailwind.config.js` : ombres Tremor `tremor-card 0 1px 3px rgb(0 0 0/.1), 0 1px 2px -1px .1`, `tremor-input 0 1px 2px .05` ; rayons 6/8/9999. Sidebar 16rem.

#### Trigger.dev — https://github.com/triggerdotdev/trigger.dev — 16 730 ★ (actif ; Tailwind v4, dark‑first)
`apps/webapp/app/tailwind.css` : police **Geist Variable** / Geist Mono ; palette « charcoal » custom bleutée : 100 `#e8e9ec`, 200 `#d7d9dd`, 300 `#b5b8c0`, 400 `#878c99`, 500 `#5f6570`, 600 `#3b3e45`, 650 `#2c3034`, 700 `#272a2e`, 750 `#212327`, 800 `#1a1b1f`, 850 `#15171a`, 900 `#121317`, 950 `#0d0e12` ; sémantique dark : text‑bright 200 / dimmed 400 / faint 500 ; background deep 900 / dimmed 850 / bright 800 / hover 750 / raised 700 ; border bright 600 / brighter 550 / brightest 500 ; **clair : deep `#f1f2f4`, dimmed `#fbfbfc`, bright `#fff`, hover `#f2f3f5`, raised `#e9eaee`, border‑bright `#d2d5db`, brighter `#b9bdc7`** ; accent lavender‑400 (liens), success mint, warning amber, error rose ; `@utility focus-custom { outline: 1px solid var(--color-text-link) }` ; animations 0.2 s ease‑out.
`components/primitives/Buttons.tsx` : `$all: font-normal transition duration-150 **rounded-[3px]** select-none focus-custom` ; extra‑small `h-6 px-2.5 text-xs`, **small `h-8 px-3 text-sm`**, medium `h-10 px-2 text-base font-medium`, large `h-12`. `Input.tsx` : medium `h-10 rounded-[3px] border border-border-bright/50 shadow-xs bg-input-bg hover:bg-background-raised`, small `h-8`, tiny `h-6`, `has-focus:ring-1 ring-ring`. `Badge.tsx` : `rounded-full px-2 h-5 tracking-wider text-xxs uppercase bg-background-hover text-text-bright` ; small `border border-border-bright rounded-sm px-1 h-5 text-xs text-blue-500`. `Table.tsx` : headerCell `px-3 py-2.5 pb-3 text-sm`, cell `px-3 py-3 text-xs`, hover `bg-background-hover`, cellules sticky. `Paragraph.tsx` : base `text-base font-medium`, small `text-sm`, extra‑small `text-xs`, extra‑extra‑small `uppercase tracking-wider text-xs text-text-dimmed` ; `Headers.tsx` h1 `text-2xl font-semibold tracking-tight`, h2 `text-base`, h3 `text-sm`. `PulsingDot.tsx` : `size-2 rounded-full bg-blue-500` + `animate-ping border`. `navigation/SideMenu.tsx` : **224 px** (repliée 44, max 400), `border-r bg-background-bright`.

#### Inbox Zero — https://github.com/elie222/inbox-zero — 12 942 ★ (actif)
`apps/web/styles/globals.css` : HSL slate (`--foreground 222.2 47.4% 11.2%`, muted `210 40% 96.1%`, muted‑fg `215.4 16.3% 46.9%`, **`--border 214.3 31.8% 91.4%` + `--border-strong 212.7 26.8% 83.9%`**, ring slate‑400, radius .5rem, sidebar `0 0% 98%`) ; dark custom `#26282C` / card `#2D2F34` / border `#35373B` / sidebar `#212326`. `components/ui/button.tsx` : default **h‑10 px‑4**, xs `h-6 rounded-sm text-xs`, xs‑2 h‑7, sm h‑9, lg h‑11, icônes 10/8/7/6, `ring-2 ring-offset-2`. `input.tsx` : `h-10 rounded-md border-input px-3 py-2 text-base md:text-sm focus-visible:border-ring focus-visible:ring-[3px] ring-ring/50`. `components/Badge.tsx` : **Tailwind UI `rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset`**, 9 couleurs `bg-x-50 text-x-700 ring-x-600/10` (dark `bg-x-400/10 text-x-400 ring-x-400/20`). `ui/table.tsx` : en‑tête sticky `[&_th]:bg-card [&_th]:shadow-[inset_0_-1px_0_hsl(var(--border))]`, th h‑12 px‑4 text‑muted‑foreground, hover `bg-slate-100/50`. `ui/empty.tsx` : shadcn v4. Sidebar 16rem.

#### Rallly — https://github.com/lukevella/rallly — 5 357 ★ (actif ; petit mais très soigné)
`packages/tailwind-config/shared-styles.css` : Inter ; **gray = zinc (`--gray-hue 286.033`)** ; `--radius .625rem` ; primary indigo‑600 (dark indigo‑500) ; border gray‑200, border‑muted gray‑100, ring gray‑500 ; card white + border gray‑200 + `--card-accent rgba(0,0,0,.02)` ; sidebar gray‑50 ; courbes `--ease-out-expo cubic-bezier(.19,1,.22,1)`, `--ease-out-ui cubic-bezier(.23,1,.32,1)`, switch 350 ms. `packages/ui/src/ease.ts` : `EASE_OUT [0.16,1,0.3,1]`, `EASE_IN_OUT [0.77,0,0.175,1]`, `EASE_DRAWER [0.32,0.72,0,1]`, ressorts press 500/30/.6, panel 420/40/.5, layout 360/32/.6. `button-variants.ts` : `font-normal tracking-tight transition-[background-color,color,transform] ease-out` ; default **h‑9 px‑4 text‑sm**, xs h‑6, sm h‑7, lg h‑10, xl h‑12 text‑base ; **forme pilule par défaut** (`rounded-full`, alt `rounded-xl`) ; primary `ring-1 ring-button-outline ring-inset active:scale-[.98] motion-reduce:active:scale-100`. `input.tsx` : `h-9 rounded-xl px-2.5 text-sm bg-background/80 focus-visible:border-ring ring-[3px] ring-ring/50` (lg h‑12 text‑base). `badge.tsx` : `rounded-lg font-normal` ; default `bg-gray-100 text-muted-foreground`, green `bg-green-400/10 text-green-600`, amber `bg-amber-400/10 text-amber-700`, destructive `bg-rose-600/10 text-rose-600`, secondary `bg-primary/10 text-primary`. `card.tsx` : `rounded-2xl border border-card-border bg-card shadow-2xs`, p‑3 sm:p‑4, titre `text-base font-medium`. `skeleton.tsx` : `animate-pulse rounded-md bg-foreground/10`. Sidebar 16rem gray‑50.

#### Maybe Finance — https://github.com/maybe-finance/maybe — 54 197 ★ (**archivé 07/2025**, Rails + Tailwind v4)
`app/assets/tailwind/maybe-design-system.css` : police **Geist** / Geist Mono ; gris neutre custom : 25 `#FAFAFA`, 50 `#F7F7F7`, 100 `#F0F0F0`, 200 `#E7E7E7`, 300 `#CFCFCF`, 400 `#9E9E9E`, 500 `#737373`, 600 `#5C5C5C`, 700 `#363636`, 800 `#242424`, 900 `#171717` ; `alpha-black-25…900` 3 → 85 % ; success `#10A861`, warning `#DC6803`, destructive `#EC2222` (palette Untitled UI) ; **ombres toutes à 6 %** : xs `0 1px 2px black/6%`, sm `0 1px 6px`, md `0 4px 8px -2px`, lg `0 12px 16px -4px`, xl `0 20px 24px -4px` (dark white/8 %) ; `--border-radius-md 8px`, `lg 10px` ; champ `rounded-md border bg-container border-secondary shadow-xs focus-within:ring-4 ring-alpha-black-200 transition-all duration-300`, libellé `text-xs text-secondary`. `app/components/DS/buttonish.rb` : sm `px-2 py-1 rounded-md text-sm` (icône 32), **md `px-3 py-2 rounded-lg text-sm` (icône 36)**, lg `px-4 py-3 rounded-xl text-base` (icône 40) ; primary `bg-inverse text-inverse` (noir), secondary `bg-gray-50 hover:bg-gray-100`, outline `border border-secondary`.

#### Ghost « Shade » (nouvel admin) — https://github.com/TryGhost/Ghost — 55 707 ★ (`apps/shade`, actif)
`apps/shade/tailwind.theme.css`, `theme-variables.css`, `styles.css` : **Inter** avec `font-feature-settings 'dlig','zero','ss01','ss02','cv10','cv06'` ; html 62.5 % → **`--text-base 1.3rem` = 13 px** (control 13, lg 14, xs 11, sm 12, md 14) ; tracking tight −0.01em, tighter −0.025em ; gris oklch teinte 255 : 50 99 %, 100 97.83 %, 200 94.47 %, 300 90.78 %, 400 86.68 %, 500 77.55 %, 600 70.33 %, 700 62.98 %, 800 52.97 %, 900 36.77 %, 950 25.95 % ; black `oklch(16% .002 255)` ; sémantique : border gray‑200, **border‑default = `color-mix(gray-200, gray-300)`**, border‑strong gray‑500, muted gray‑100, muted‑fg gray‑700, accent gray‑100, **ring/focus gray‑600**, button‑hover gray‑100, `--table-row-hover oklch(98.3%)`, sidebar gray‑50 / border gray‑100 ; rayons base **0.4rem = 4 px**, xs 3, sm 4, md 6, lg 8, xl 12, 2xl 16, **rôles : control = md (6), field = control, card = xl (12), menu = md, menu‑item = xs, surface = lg, badge/pill = full** ; **`--control-height 32px`, lg 40px** ; ombres `--shadow 0 0 1px rgba(0,0,0,.05), 0 5px 18px .08`, xs `0 0 1px .04, 0 1px 3px .03, 0 8px 10px -12px .1`, sm `0 0 1px .12, 0 1px 6px .03, 0 8px 10px -8px .1`, md + `0 24px 37px -21px .05`.
`src/components/ui/button-variants.ts` : `gap-1.5 text-control transition-colors focus-visible:ring-1 ring-focus-ring [&_svg]:size-4 [&_svg]:stroke-[1.5px]` ; default `h-(--control-height) px-2.5 py-2` (32), sm h‑7, lg `h-11 text-md font-semibold`, icon size‑9 ; `rounded-control` (6) ou pilule ; primary `font-semibold`, outline `border-control-border hover:bg-button-hover`. `badge-variants.ts` : `border font-semibold` ; default `h-4.5 px-1.5 text-xs`, sm `h-5 px-2 text-sm`, md `h-6 px-2.5` ; `rounded-xs` (3 px) ou pilule ; success `bg-green/20 text-green`, destructive `bg-destructive/20 text-destructive`, secondary `bg-secondary text-secondary-foreground/70`. `card-variants.ts` : outline `rounded-card border border-border-default transition-all hover:shadow-xs`, plain, ruled (`border-t`). `table.tsx` : `text-base` (13 px) ; th `h-(--control-height) px-2 text-sm font-medium tracking-wide text-text-secondary` (uppercase pour colonnes alignées à droite) ; td `p-2.5 group-hover:bg-table-row-hover`. `input.tsx` : `h-(--control-height) px-3 py-1`. `empty-indicator.tsx` : cercle `size-12 rounded-full bg-muted` + svg 16 px muted, `gap-3`.

#### Excalidraw — https://github.com/excalidraw/excalidraw — 135 320 ★ (outil canvas ; retenu pour la palette)
`packages/excalidraw/css/theme.scss`, `variables.module.scss` : violet `--color-primary #6965db`, darker `#5b57d1`, light `#e3e2fe`, hover `#5753d0` ; gris 10 `#f5f5f5`, 20 `#ebebeb`, 30 `#d6d6d6`, 40 `#b8b8b8`, 50 `#999`, 60 `#7a7a7a`, 70 `#5c5c5c`, 80 `#3d3d3d`, 85 `#242424` ; Open Color (`$color-gray-4 #ced4da` bordure de champ, `$color-blue-2 #a5d8ff` focus) ; `--shadow-island 0 0 1px rgba(0,0,0,.17), …` ; `--space-factor .25rem`.

#### Mattermost — https://github.com/mattermost/mattermost — 39 558 ★ (retenu pour l'échelle d'élévation)
`webapp/channels/src/sass/base/_css_variables.scss` : `--elevation-1 0 2px 3px rgba(0,0,0,.08)`, `-2 0 4px 6px .12`, `-3 0 6px 14px .12`, `-4 0 8px 24px .12` ; sidebar **sombre colorée** `#145dbf` (texte blanc, hover `#4578bf`) ; `--center-channel-color #3d3c40`.

#### Infisical — https://github.com/Infisical/infisical — 30 353 ★ (dark‑only, Tailwind v4)
`frontend/src/index.css` : IBM Plex Sans / JetBrains Mono ; page `oklch(17.3%)`, background 21.5 %, border 29.4 %, muted 54.9 %, neutral/label 75 % ; `--text-2xs .7rem` ; échelle body‑sm 14/20, body‑md 16/24, label 12/16, heading‑sm 18/24 ; **rayons par rôle** `--radius-control: md`, `--radius-card: lg`, `--radius-popover: md`, `--radius-dialog: lg` ; ombres `floating 0 8px 32px black/60%`, light `0 4px 12px black/8%`.

### 1.3 Écartés (et pourquoi)
- **Hoppscotch** (80 766 ★) : tokens dans la config Tailwind introuvable sous `packages/hoppscotch-common` ; UI dense « dev‑tool » sombre peu transposable.
- **Plane** (62 140 ★) : `packages/tailwind-config/index.css` ne contient que des couleurs d'éditeur et une barre de progression ; `packages/ui` absent de la branche `preview`.
- **Umami** (39 983 ★) : délègue tout à `@umami/react-zen` (`--zen-*`) ; seul `src/app/global.css` lu (Inter, corps 14 px, primaire `oklch(62.3% .214 259.8)`).
- **HeroUI** (31 154 ★, v3), **Saas UI** (Chakra), **NocoDB** (Ant Design), **AppFlowy** (Flutter), **Invoice Ninja** (PHP, UI séparée), **erxes** (4 113 ★), **Lago** (163 ★ front, MUI), **Unkey** (arborescence déplacée, `apps/` absent), **Geist** (pas de dépôt), listes *awesome‑** (annuaires, pas de code).

---

## 2. Tableau comparatif des tokens

| Projet | Police | Neutre | Rayon bouton | Rayon carte | Ombre carte | Bordure | Focus | H. bouton md | H. champ md | Ligne tableau (th / cellule) | Sidebar | Badge de statut | Transition |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| shadcn/ui v4 | var (Geist) 14 px | gris pur oklch | 8 (md) | 14 (xl) | shadow‑sm | oklch .922 (#e5e5e5) | ring 3 px ring/50 + border‑ring | 36 | 36 | 40 / p‑8 | 256 claire | pilule fond plein ou outline | all 150 ; sidebar 200 linear |
| Radix Themes | système 14‑16 | gray/slate 12 pas + alpha | 4 (size 2) / 6 (size 3) | 8‑12 | 5 couches + ring 1 px | gray‑a5 | outline 2 px offset −1 | 32 (size 2) / 40 | 32 / 40 | 36‑44 / 8‑12 | — | soft accent‑a3/a11, surface ring | — |
| Tremor | Inter/Geist 14 | gray | 6 (md) | 8 (lg) | shadow‑xs | gray‑200/300 | outline 2 px offset 2 blue | ≈ 36 | ≈ 36 | py‑3.5 / p‑4 | — | fond 50 + texte 900 + ring 30 % | all 100 ease‑in‑out |
| Mantine | système 14 | gray | 8 (md) | 8 | 0 1px 3px .05 + 0 1px 2px .1 | gray‑3/4 | ring auto | 36 (sm) | 36 | — / xs 10 | — | pilule UPPERCASE bold | — |
| Origin UI | var 14 (16 mobile) | neutral + alpha | 8 (lg) | 14 | shadow‑xs/5 | black/8 % | ring 2 px offset 1 | 32 desk / 36 mob | 30 / 34 | 40 / px‑2.5 | neutral‑50 claire | rounded‑sm soft 8 % | shadow |
| Twenty | Inter 13.6‑14.7 | gray p3 (pur) | 8 (md) | 8 | 0 2px 4px 4 %, 0 0 4px 8 % | .922 (#ebebeb) | — (Emotion) | — | — | — / 8 px | claire + ombre .005 | fond accent‑3 + texte accent‑11 | bg 100 ms ; fast 150 |
| Cal.com | var 14 | gray (220) | 10 | 10‑14 | ombre relief 5 couches (boutons) | hsl(216 12% 84%) | ombre 1 px blanc + 2 px noir/10 | ≈ 32 | 36 | 48 / py‑2.5 | — | rounded‑[4px] fond teinté + texte foncé | shadow 200 |
| Formbricks | Inter 14 | slate | 6 | 12 | 0 .5px 12px −5px slate/20 | slate‑200/300 | ring 1 (btn) ; ring 2 offset 2 (input) | 36 | 40 | — | — | fond 100 + bordure 200 + texte 800 | colors ; 0.2 s ease‑out |
| Documenso | Inter 14 | slate | 6 | 8, bordure 2 px | aucune | slate‑200 | ring 2 offset 2 | 40 | 40 | 48 / p‑4 | — | rounded‑md 50/700 ring 10 % | colors |
| Dub | Inter 14 | neutral | 8 (lg) | 14 (xl) | aucune (bordure) | neutral‑200 ; input 300 | hover ring 4 ; focus border‑emphasis | 40 | ≈ 40 | ≈ 44 / py‑2.5 px‑4 | 304 (64+240) claire | rounded‑md fond 15 % + texte 600 + icône 12 | 75 ms ; modal 200 |
| Midday | Hedvig Sans 14 | gris + beige | 0 | 0 | aucune | hsl(45 5% 85%) | aucun (!) | 36 | 36 | 48 / py‑2 px‑4 | 240 / 70 claire | rounded‑none gris | 200 |
| OpenStatus | var 14 | gris pur oklch | 8 | 14 | shadow‑sm | .922 | ring 3 px/50 | 36 | 36 | 40 / p‑2 | 256 claire | rounded‑md | all |
| PostHog | Inter/système 14 (13 tables) | chaud #dadbd2 | 6 | 6 | 0 3px 0 border (dure) | black/15 % | border‑secondary | 33 | 37 | — / 8 px | 300 claire | bordure colorée + texte, fond ∅ | 200 opacity/transform |
| Supabase | Circular 14 | Radix gray | 6‑8 proportionnel | 8 | shadow‑xs ; floating 6 couches | hsl semantic | ring 2 offset 2 ; tr outline inset | 34 (small) / 38 | 40 | 40 / px‑4 | claire | pilule 9 px UPPERCASE + bordure | colors 200 |
| Novu | Inter 14/20 | HSL 220 bleuté | 8 (md) / 10 (lg) | 12 | shadow (16px 32px −12 10 %) | neutral‑alpha‑200 | ring 3 px/50 (input) ; double anneau 2+4 (btn) | 36 | — | 40 / px‑6 | 275 claire | **point coloré + texte neutre + ring neutre, rounded‑md h‑6** | 200 ease‑out |
| Teable | var 14 | slate shadcn | 6 | 8 | — | border | border‑primary | 36 | 32 | 40 / p‑2 | — | rounded‑md | colors |
| Plausible | Inter 14 | zinc | 6 | 8 | shadow‑md menus | gray‑300 | ring 2 indigo offset 2 | 36 | 36‑40 | — | — | — | — |
| Outline | Inter/système 16 | slate custom | 6 | — | rgba(0,0,0,.2) 0 1px 2px | #DAE1E9 | inset 1 px | 32 | 30 | 40 / — | 260 claire | tag 24 px r 4 | 200 ease‑out |
| Chatwoot | Inter 14/21 | Radix slate | 8 (lg) | 8‑12 | — | 234 / 226 | outline brand (input) ; brightness (btn) | 40 (sm 32) | 40 (sm 32) | py‑4 / py‑3 | ≈ 240 claire | **pastille 8 px + texte neutre + outline 1 px, rounded‑lg** | all 100 ease‑out + scale .98 |
| Huly | IBM Plex 14 | gris froid #F1F1F4 | 8 (md) / 6 (small) | 16 | popover blur 12 | black/6‑10 % | outline 2 px offset 2 | 40 (small 32) | — | 64 min / 16 px | #FBFBFC claire | — | — |
| Papermark | Inter 14 | gray | 6 | 8 | tremor‑card | gray‑200 ; input 300 | ring 2 offset 2 | 40 | 40 | 48 / p‑4 | 256 claire | rounded‑md fond 15 % + texte 600 | colors |
| Trigger.dev | Geist 14 | charcoal | **3** | 4‑8 | shadow‑xs | #d2d5db (clair) | outline 1 px lavender | 32 (small) / 40 | 40 (small 32) | py‑2.5 / py‑3 | 224 | pilule 10 px UPPERCASE | 150 |
| Inbox Zero | Inter 14 | slate | 6 | 8 | — | slate‑200 (+ strong 300) | ring 2 offset 2 (btn) ; ring 3/50 (input) | 40 | 40 | 48 / — | 256 claire | rounded‑md 50/700 ring 10 % | colors |
| Rallly | Inter 14 | zinc (hue 286) | pilule | 16 (2xl) | shadow‑2xs | zinc‑200 | ring 3 px/50 | 36 | 36 | — | 256 gray‑50 | rounded‑lg fond 10 % + texte 600 | ease‑out expo ; scale .98 |
| Maybe | Geist 14 | gris custom #171717… | 8 (lg) | 10 | 0 1px 2px black/6 % | gray‑200 | ring 4 black/10 % | ≈ 36 | ≈ 36 | — | — | — | all 300 |
| Ghost Shade | Inter 13 | oklch 255 | 6 (control) | 12 (card) | hover shadow‑xs | mix gray‑200/300 | ring 1 gray‑600 | 32 | 32 | 32 / p‑2.5 | gray‑50 claire | rounded‑xs h‑4.5 fond 20 % | colors |

---

## 3. Consensus

### Ce sur quoi les meilleurs projets convergent
1. **Corps de texte 14 px** (`text-sm`) pour toute l'UI dense — boutons, champs desktop, tableaux, cartes (shadcn, Twenty, Cal, Dub, Novu, Chatwoot, Trigger, Huly, Radix size‑2…) ; **13 px** pour les tableaux denses (PostHog, Ghost, Teable sm) ; **16 px seulement sur mobile pour les champs** (`text-base md:text-sm`, shadcn/Documenso/Inbox Zero/Origin). Interligne 20 px (1.43) ou 21 px (Chatwoot). Titres de page 18‑24 px semibold `tracking-tight` ; libellés de section 11‑12 px `uppercase tracking-wide` gris (Ghost, Supabase `heading-meta`, Trigger, Novu KPI).
2. **Graisses** : 500 pour boutons, libellés, en‑têtes de colonnes ; 600 pour titres et valeurs KPI ; 400 pour le corps. Jamais 700 sauf Mantine/Trigger badges. Police : **Inter** (10 projets), Geist (4), IBM Plex (2), système (3) — toutes des grotesques neutres à chasse régulière ; Plus Jakarta Sans est dans la même famille (garder `tabular-nums` pour les chiffres).
3. **Neutre quasi achromatique** : gris pur (shadcn oklch chroma 0, Twenty, Dub neutral, Maybe, Origin) ou **très légèrement froid** (slate/zinc, Chatwoot Radix slate, Novu HSL 220, Ghost oklch 255, Trigger charcoal) — chroma ≤ 0.006. Texte principal **jamais noir pur** : #171717–#262626 / slate‑900 / `0.2` chez Twenty ; secondaire ≈ 46‑48 % L (slate‑500, neutral‑500, Novu 600) ; placeholder/muted ≈ 64 % L (neutral‑400). Fond de page blanc ou gris 97‑99 % (#F1F1F4 Huly, 247 Chatwoot, #f1f2f4 Trigger clair, neutral‑100 Dub) avec cartes blanches.
4. **La couleur de marque est rare** : 11 projets sur 30 ont un bouton primaire **noir/gris‑900** (shadcn, Dub, Cal, Maybe, Midday, Papermark, Inbox Zero, Formbricks, Origin, Ghost, OpenStatus). La couleur sert au focus, aux liens, à l'état actif, à un seul CTA, aux badges « info » et aux graphiques. Quand le primaire est coloré (Tremor bleu, Plausible/Rallly indigo, Chatwoot bleu, Supabase vert), c'est l'unique surface colorée de l'écran.
5. **Bordures 1 px gris‑200** (≈ #e5e5e5 / oklch .922 / `214 32% 91%` / Chatwoot 234 / Twenty .922) ; champs un cran plus foncé (gray‑300 : Tremor, Formbricks, Dub, Papermark, Cal 84 %) ; variantes alpha `black/6‑10 %` (Origin, Twenty, Huly, Radix gray‑a5). Dark : `white/10 %`.
6. **Rayons** : boutons et champs **6‑8 px** (6 : Tremor, Documenso, Formbricks, Papermark, Inbox Zero, PostHog, Ghost, Outline, Radix size‑3 ; 8 : shadcn v4, Dub, Chatwoot, Novu, Origin, Huly, Maybe, Twenty) ; cartes **8‑12 px** (médiane 12 : Formbricks, Novu, Ghost, Dub tables ; 14 shadcn xl) ; modales 10‑12 ; badges de **statut 4‑6 px**, tags/compteurs pilule. Rayon de carte = rayon de contrôle + 4 à 6 px.
7. **Ombres minimales** : `0 1px 2px rgba(0,0,0,.05)` (shadow‑xs) sur boutons outline et champs ; cartes **sans ombre ou shadow‑xs/sm** (Dub, Midday, Twenty, Documenso, Ghost : bordure seule, ombre au survol au plus) ; popovers/menus 2‑3 couches à 3‑8 % **toujours accompagnées d'un ring 1 px** (`0 0 0 1px` gray‑a3 / black 4‑5 %) ; alpha ≤ 10 % partout (Maybe 6 %, Twenty 3.9/7.8 %, Novu 3‑10 %, Ghost 3‑8 %).
8. **Focus** : toujours `focus-visible`, jamais `focus`. Deux recettes dominantes : **ring 3 px à 50 % + bordure colorée, sans offset** (shadcn v4, OpenStatus, Inbox Zero, Rallly, Novu) ou **ring 2 px + offset 2 px** (Documenso, Papermark, Supabase, Plausible, Tremor, Formbricks). Couleur neutre (ring gray‑400/500/600) ou marque. Pour les lignes de tableau : `outline` inset (Supabase), pas de box‑shadow.
9. **Hauteurs** : bouton/champ par défaut **36 px** (shadcn, Formbricks, Midday, OpenStatus, Teable, Rallly, Novu md, Mantine, Tremor, Plausible, Maybe) ; **32 px** dans les tableaux, barres d'outils et sidebars (Cal, Ghost, Outline, Origin desktop, Chatwoot sm, Huly small, Radix size‑2, Trigger small, shadcn sm, items de menu h‑8 partout) ; **40 px** pour les actions principales et le mobile (Documenso, Papermark, Inbox Zero, Dub, Chatwoot md, Trigger medium, Novu lg, Formbricks input) ; xs 24, sm 28‑32, icon = carré de la même hauteur ; cible tactile 44 px garantie par pseudo‑élément (Origin `pointer-coarse:after:min-h-11`, Outline 44 mobile).
10. **Tableaux** : en‑tête **40 px** (`h-10`, 8 projets) ou 48 px (`h-12`, 5 projets), `font-medium`, texte gris (`text-muted-foreground`) ou foncé ; cellules padding **8 px** (dense) à **12 px** (confortable), 16 px chez les plus aérés ; lignes 40‑44 px ; **séparateurs horizontaux seuls** (`border-b`), pas de zébrage ; survol `bg-muted/50` (2‑5 % de noir) ; conteneur arrondi 8‑12 px + bordure 1 px (Dub, Novu, PostHog, Radix, Huly, Origin variante carte) ; en‑tête sticky (Inbox Zero `inset 0 -1px` ombre, Outline) ; pagination collante en bas (Dub).
11. **Sidebar** : **240‑260 px** (shadcn 256 ; Outline 260 ; Midday/Dub zone 240 ; Trigger 224 ; Novu 275), repliée 44‑70 px ; **claire dans 26 projets sur 28** (gray‑50/neutral‑100/#FBFBFC) séparée par `border-r 1px` ; items **h‑8, rounded‑md/lg, px‑2, text‑sm, icône 16 px** ; actif = fond gris‑100/200 + `font-medium`, sans couleur de marque ; groupes en 11‑12 px gris. Sidebars sombres : Mattermost (bleu marque), Trigger (dark‑first), Huly dark.
12. **Badges de statut** : taille **20‑24 px (h‑5/h‑6), 12 px (ou 11), `font-medium`**, rayon 4‑6 px ; quatre patrons : (A) fond 50/100 + texte 700‑900 ± ring 10‑30 % (Tremor, Documenso, Inbox Zero, Formbricks, Cal) ; (B) **fond blanc + bordure neutre + point coloré 6‑8 px + texte neutre** (Novu, Chatwoot, Trigger dot) ; (C) fond alpha 10‑20 % de la couleur + texte 600 sans bordure (Dub, Papermark, Rallly, Twenty, Ghost) ; (D) micro‑pilule capitale 9‑11 px (Supabase, Mantine, Trigger). Jamais de fond saturé plein pour un statut (réservé au compteur/pastille).
13. **Mouvement** : **100‑200 ms**, `transition-colors` par défaut, `ease-out` ; 75‑100 ms pour les survols (Dub, Twenty, Chatwoot, Tremor), 150 ms boutons, 200 ms panneaux/modales (`cubic-bezier(0.16,1,0.3,1)` Dub/Rallly, fade + zoom 95 % shadcn), accordéons 0.2 s ease‑out ; appui `scale(.97‑.98)` avec `motion-reduce` (Chatwoot, Rallly) ; skeleton `animate-pulse` 1.5‑2 s. Aucune animation décorative permanente.
14. **États vides** : icône 16‑24 px dans une tuile 40‑64 px (`rounded-lg bg-muted` shadcn, cercle `size-12` Ghost, `size-16 rounded-2xl border` Dub), titre 16‑18 px medium, description 14 px gris `max-w-sm text-balance`, une action ; conteneur `border-dashed rounded-lg p-6 md:p-12` ou aperçu fantôme flouté (Chatwoot). **Squelettes** : `animate-pulse rounded-md bg-muted` aux dimensions réelles du contenu.
15. **Espacement** sur grille de 4 px (Twenty `spacingMultiplicator 4`, Radix, Huly 0.5rem), padding de carte 16‑24 px, gap entre cartes 16 px.

### Là où ils divergent
- **Teinte du neutre** : pur (shadcn, Twenty, Dub) vs froid (slate/zinc/Novu/Chatwoot) vs chaud (PostHog #dadbd2, Midday beige) — choix d'identité, pas de qualité.
- **Rayon** : 0 (Midday), 3 px (Trigger), 6‑8 (majorité), 10 (Cal), pilule (Rallly, Supabase prop). Le rayon « 0 » ou « 3 » signe un produit technique/financier ; 6‑8 est le choix neutre.
- **Bouton primaire** : plat (shadcn, Dub) vs relief subtil (Cal 5 couches, Novu dégradé vertical 90→100 % + inset, PostHog 3 px dur). Le relief reste ≤ 10 % d'alpha et vertical.
- **Hauteur par défaut** : 32 (produits denses : Ghost, Cal, Outline, Origin) vs 36 (shadcn & co) vs 40 (Documenso, Papermark, Dub, Chatwoot). Les apps mobiles‑first montent à 40‑44.
- **Focus** : anneau externe (majorité) vs outline interne (Radix, Supabase tr, Trigger 1 px) vs ombre (Cal). Midday n'en a aucun (à ne pas imiter).
- **En‑tête de tableau** : gris (`text-muted-foreground`, 9 projets) vs foncé (`text-foreground`, shadcn v4, Cal, Chatwoot, Tremor semibold) ; capitales (Ghost, Supabase, Mantine) vs normal (PostHog l'interdit explicitement).
- **Badge** : pilule vs coins 4‑6 px ; avec ring vs sans ; point coloré vs fond teinté.
- **Sidebar** : zone encadrée dans la page (Dub `rounded-xl bg-neutral-100`) vs colonne pleine hauteur avec `border-r` (le reste).

---

## 4. Extraits exemplaires

### 4.1 Tableau — shadcn/ui v4 (`apps/v4/registry/new-york-v4/ui/table.tsx`)
Permalien : https://github.com/shadcn-ui/ui/blob/8ab27715521cbd4f87ae6886cd989cbb678f6de7/apps/v4/registry/new-york-v4/ui/table.tsx#L52-L90
```tsx
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}
function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}
function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td data-slot="table-cell"
      className={cn("p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]", className)}
      {...props} />
  )
}
```
Variante « conteneur arrondi » (Dub, `packages/ui/src/table/table.tsx`, l. 43‑49 et 491) : cellules `py-2.5 text-left text-sm leading-6 whitespace-nowrap border-border-subtle border-l border-b px-4`, survol `group-hover/row:bg-bg-muted transition-colors duration-75`, cadre `border-border-subtle bg-bg-default relative z-0 rounded-xl border` — https://github.com/dubinc/dub.link/blob/6b463b4bdd9ed2fd9aa416f67b5b77d317b1471e/packages/ui/src/table/table.tsx#L43-L49

### 4.2 Barre latérale — shadcn/ui v4 (`apps/v4/registry/new-york-v4/ui/sidebar.tsx`)
Permalien : https://github.com/shadcn-ui/ui/blob/8ab27715521cbd4f87ae6886cd989cbb678f6de7/apps/v4/registry/new-york-v4/ui/sidebar.tsx#L28-L33 et #L476-L496
```tsx
const SIDEBAR_WIDTH = "16rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"
// …
const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline: "bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)
```
Tokens associés (`apps/v4/app/globals.css`) : clair `--sidebar oklch(0.985 0 0)`, `--sidebar-accent oklch(0.97 0 0)`, `--sidebar-border oklch(0.922 0 0)` ; sombre `--sidebar oklch(0.205 0 0)`, `--sidebar-accent oklch(0.269 0 0)`, `--sidebar-border oklch(1 0 0 / 10%)` — c'est la recette à appliquer sur `#0F172A` : accent = fond + ~6 % de blanc, bordure = blanc à 10 %, texte actif blanc, inactif blanc à 70 %.
Variante Chatwoot (`components-next/sidebar/SidebarGroupLeaf.vue`, l. 47) : `flex h-8 items-center gap-2 px-2 py-1 rounded-lg hover:bg-gradient-to-r from-transparent via-n-slate-3/70 to-n-slate-3/70` — https://github.com/chatwoot/chatwoot/blob/625d5964e3cb3f1d917b43c3b8332219e525a4b8/app/javascript/dashboard/components-next/sidebar/SidebarGroupLeaf.vue#L47

### 4.3 Badge de statut — Novu (`apps/dashboard/src/components/primitives/status-badge.tsx`)
Permalien : https://github.com/novuhq/novu/blob/7a4782717db9e5deed31889e28d40aaa372b0594/apps/dashboard/src/components/primitives/status-badge.tsx#L14-L57
```tsx
const statusBadgeVariants = tv({
  slots: {
    root: [
      'inline-flex h-6 items-center justify-center gap-2 whitespace-nowrap rounded-md px-2 text-label-xs',
      'has-[>.dot]:gap-1.5',
    ],
    icon: '-mx-1 size-4',
    dot: [
      'dot -mx-1 flex size-4 items-center justify-center',
      'before:size-1.5 before:rounded-full before:bg-current',
    ],
  },
  variants: {
    variant: {
      light: { root: 'bg-bg-white text-text-sub ring-1 ring-inset ring-stroke-soft' },
    },
    status: {
      completed: { icon: 'text-success-base', dot: 'text-success-base' },
      pending:   { icon: 'text-warning-base', dot: 'text-warning-base' },
      failed:    { icon: 'text-error-base',   dot: 'text-error-base' },
      disabled:  { icon: 'text-faded-base',   dot: 'text-faded-base' },
    },
  },
  defaultVariants: { variant: 'light', status: 'completed' },
});
```
Patron « fond teinté » (Tremor, `src/components/Badge/Badge.tsx`) : `inline-flex items-center gap-x-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset` + `bg-emerald-50 text-emerald-900 ring-emerald-600/30` (success), `bg-red-50 text-red-900 ring-red-600/20` (error), `bg-yellow-50 text-yellow-900 ring-yellow-600/30` (warning), `bg-gray-50 text-gray-900 ring-gray-500/30` (neutral) — https://github.com/tremorlabs/tremor/blob/ca4d588f47820ff3d514d37fa4ee08a4222dec11/src/components/Badge/Badge.tsx#L8-L36
Patron « alpha » (Dub, `packages/ui/src/status-badge.tsx`, l. 14‑27) : `flex gap-1.5 items-center max-w-fit rounded-md px-2 py-1 text-xs font-medium`, `neutral: bg-neutral-500/[.15] text-neutral-600`, icône `h-3 w-3` — https://github.com/dubinc/dub.link/blob/6b463b4bdd9ed2fd9aa416f67b5b77d317b1471e/packages/ui/src/status-badge.tsx#L14-L27
Pour les 8 statuts Klikphone : patron B (point coloré + texte neutre + ring neutre) pour les listes denses, patron A/C pour la fiche ticket.

### 4.4 Bouton — Chatwoot (`components-next/button/Button.vue`) + ombres Cal.com
Permalien : https://github.com/chatwoot/chatwoot/blob/625d5964e3cb3f1d917b43c3b8332219e525a4b8/app/javascript/dashboard/components-next/button/Button.vue#L158-L195
```js
const STYLE_CONFIG = {
  colors: {
    blue: {
      solid:  'bg-n-brand text-white hover:enabled:brightness-110 focus-visible:brightness-110 outline-transparent',
      faded:  'bg-n-brand/10 text-n-blue-11 hover:enabled:bg-n-brand/20 focus-visible:bg-n-brand/20 outline-transparent',
      outline:'text-n-blue-11 outline-n-brand',
      ghost:  'text-n-blue-11 hover:enabled:bg-n-alpha-2 focus-visible:bg-n-alpha-2 outline-transparent',
      link:   'text-n-blue-11 hover:enabled:underline focus-visible:underline outline-transparent',
    },
    slate: {
      solid:  'bg-n-button-color hover:enabled:bg-n-alpha-2 text-n-slate-12 outline-n-container',
      outline:'text-n-slate-11 outline-n-strong hover:enabled:bg-n-slate-9/10',
      ghost:  'text-n-slate-12 hover:enabled:bg-n-alpha-2 outline-transparent',
    },
  },
  sizes: {
    default: { xs: 'h-6 px-2', sm: 'h-8 px-3', md: 'h-10 px-4', lg: 'h-12 px-5' },
    iconOnly:{ xs: 'h-6 w-6 p-0', sm: 'h-8 w-8 p-0', md: 'h-10 w-10 p-0', lg: 'h-12 w-12 p-0' },
  },
  fontSize: { xs: 'text-xs', sm: 'text-sm', md: 'text-sm', lg: 'text-base' },
  clickAnimation: { xs: 'active:enabled:scale-[0.97]', sm: 'active:enabled:scale-[0.97]', md: 'active:enabled:scale-[0.98]', lg: 'active:enabled:scale-[0.98]' },
  base: 'inline-flex items-center min-w-0 gap-2 transition-all duration-100 ease-out border-0 rounded-lg outline-1 outline disabled:opacity-50',
};
```
Ombres de bouton Cal.com (`packages/config/theme/tokens.css`, l. 342‑350) — https://github.com/calcom/cal.diy/blob/2eb48eccd8aca8a0c0ffabf28cf92e298b33ecee/packages/config/theme/tokens.css#L342-L350
```css
--shadow-outline-gray-rested: 0px 2px 3px 0px rgba(0, 0, 0, 0.03), 0px 2px 2px -1px rgba(0, 0, 0, 0.03);
--shadow-outline-gray-active: 0px 2px 1px 0px rgba(0, 0, 0, 0.05) inset;
--shadow-outline-gray-focused: 0px 0px 0px 1px rgba(255, 255, 255, 0.20), 0px 0px 0px 2px rgba(0, 0, 0, 0.10);
--shadow-button-solid-brand-default: 0px 2px 3px 0px rgba(0, 0, 0, 0.06), 0px 1px 1px 0px rgba(0, 0, 0, 0.08),
  1px 4px 8px 0px rgba(0, 0, 0, 0.12), 0px 2px 0.4px 0px rgba(255, 255, 255, 0.12) inset, 0px -3px 2px 0px rgba(0, 0, 0, 0.04) inset;
```
Référence plate (shadcn v4 `button.tsx`) : `rounded-md text-sm font-medium transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50`, tailles `h-6 / h-8 / h-9 px-4 / h-10 px-6`, outline `border bg-background shadow-xs hover:bg-accent` — https://github.com/shadcn-ui/ui/blob/8ab27715521cbd4f87ae6886cd989cbb678f6de7/apps/v4/registry/new-york-v4/ui/button.tsx#L7-L37

### 4.5 Carte KPI — shadcn dashboard‑01 (`blocks/dashboard-01/components/section-cards.tsx`) et Novu `analytics-card.tsx`
Permalien : https://github.com/shadcn-ui/ui/blob/8ab27715521cbd4f87ae6886cd989cbb678f6de7/apps/v4/registry/new-york-v4/blocks/dashboard-01/components/section-cards.tsx#L15-L37
```tsx
<div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
  <Card className="@container/card">
    <CardHeader>
      <CardDescription>Total Revenue</CardDescription>
      <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
        $1,250.00
      </CardTitle>
      <CardAction>
        <Badge variant="outline">
          <IconTrendingUp />
          +12.5%
        </Badge>
      </CardAction>
    </CardHeader>
    <CardFooter className="flex-col items-start gap-1.5 text-sm">
      <div className="line-clamp-1 flex gap-2 font-medium">
        Trending up this month <IconTrendingUp className="size-4" />
      </div>
      <div className="text-muted-foreground">Visitors for the last 6 months</div>
    </CardFooter>
  </Card>
</div>
```
Structure à retenir : libellé 14 px gris **au‑dessus** de la valeur, valeur `text-2xl font-semibold tabular-nums`, variation en badge *outline* (pas de pastille colorée), pied 14 px, carte `rounded-xl border shadow-xs py-6 gap-6`, aucune icône décorative. Novu fait la même chose en plus compact (`apps/dashboard/src/components/primitives/analytics-card.tsx`, l. 116‑143 : `bg-bg-white rounded-xl p-2.5 shadow-box-xs`, libellé `text-[12px] uppercase text-text-sub` + icône 16 px, valeur `text-title-h5 font-semibold`, tendance `size-2` + `text-subheading-2xs uppercase`) — https://github.com/novuhq/novu/blob/7a4782717db9e5deed31889e28d40aaa372b0594/apps/dashboard/src/components/primitives/analytics-card.tsx#L116-L143

### 4.6 Bonus — état vide (Dub, `packages/ui/src/empty-state.tsx`, l. 18‑33)
https://github.com/dubinc/dub.link/blob/6b463b4bdd9ed2fd9aa416f67b5b77d317b1471e/packages/ui/src/empty-state.tsx#L18-L33 : `flex flex-col items-center gap-y-4` → tuile `size-16 rounded-2xl border border-neutral-200 bg-neutral-50` avec icône `size-6 text-neutral-800` → titre `text-base font-medium text-neutral-950` → description `max-w-sm text-balance text-sm text-neutral-500` → lien `underline underline-offset-2`.

---

## 5. À éviter — ce que le « look IA » fait différemment

Comparaison Magic UI (et gabarits génériques) ↔ les 25 applications ci‑dessus :

| Signature « IA » (Magic UI / templates) | Ce que font les apps réputées |
|---|---|
| Dégradés animés : `conic-gradient` tournant (`shimmer-button`), `--color-1..5` arc‑en‑ciel, `animate-gradient 8s`, `shine-border 14s`, `border-beam 6s`, `meteor`, `marquee`, `orbit` | **Aucune animation permanente**. Seuls dégradés tolérés : relief vertical ≤ 10 % sur le bouton primaire (Cal, Novu `from-primary/90 to-primary`), `from-primary/5` sur une carte KPI (shadcn), ou un bouton « attention » isolé (Huly) |
| Ombres larges multi‑couches sur toutes les cartes : bento `0 2px 4px .05, 0 12px 24px .05`, `shadow-xl/2xl`, glow inset dark `0 -20px 80px -20px #ffffff1f inset` | Cartes **à bordure 1 px sans ombre** (Dub, Midday, Twenty, Documenso, Ghost) ou `shadow-xs` (`0 1px 2px .05`) ; les ombres ≥ 3 couches sont réservées aux popovers/modales et incluent un ring 1 px |
| Survols spectaculaires : `group-hover:-translate-y-10`, `scale-75` d'icône 48 px, spotlight suivant la souris (`magic-card` 200 px), `duration-300` partout | Survol = changement de fond de 2‑5 % (`bg-muted/50`, `color-mix(black 2%)`) en **75‑150 ms** ; appui `scale(.98)` au plus, avec `motion-reduce` |
| Grands arrondis : `rounded-2xl` sur boutons, `rounded-3xl` sur cartes, pilules partout | Boutons/champs **6‑8 px**, cartes 8‑12 px, pilule réservée aux tags/compteurs |
| Icônes 48 px décoratives dans des pastilles colorées (`bg-purple-100 text-purple-600 rounded-full p-3`) en tête de chaque carte | Icônes **16 px** (`size-4`), trait 1.5‑2 px, couleur du texte ; pas d'icône dans les KPI (shadcn dashboard‑01) ou 16 px grise (Novu) |
| Glassmorphism (`backdrop-blur`, bordures `white/10` sur fond sombre dégradé), héros violet → rose | Fonds **opaques** blanc / gris 97‑99 %, bordures gris‑200 ; `backdrop-blur` limité à un overlay de modale (Documenso `backdrop-blur-[2px]`) |
| Couleur de marque en fond de section, de sidebar, de titres (`bg-gradient-to-r from-violet-600 to-pink-600 bg-clip-text`) | Marque sur **≤ 3 surfaces** : bouton primaire (souvent noir à la place), focus, état actif/lien ; le texte n'est jamais coloré ni dégradé ; la hiérarchie se fait par le gris (900/500/400) et la graisse (500/600) |
| Texte noir pur `#000` sur blanc pur, titres 32‑48 px dans l'app | Texte **#171717‑#262626 / slate‑900**, titres d'écran 18‑24 px semibold `tracking-tight`, sections en 11‑12 px capitales grises |
| Badges saturés pleins (`bg-green-500 text-white`) et `font-bold` | Statuts en **fond 50/100 ou alpha 10‑20 % + texte 600‑900, ou point coloré + texte neutre**, `font-medium`, 12 px, coins 4‑6 px |
| Boutons 48‑56 px, `px-8 py-4`, `text-lg`, `shadow-lg`, `uppercase tracking-widest` | **32‑40 px**, `text-sm font-medium`, `px-3/px-4`, `shadow-xs` ou rien |
| Cartes imbriquées dans des cartes, chaque bloc encadré, bannières empilées | Une seule bordure par niveau ; listes et tableaux **à séparateurs horizontaux** dans un conteneur arrondi unique (Dub, Novu, PostHog) ; sections séparées par un `border-t` ou de l'espace (Ghost `ruled`) |
| Emoji et illustrations génériques dans les états vides | Icône 16‑24 px dans tuile neutre + 2 lignes de texte + une action (shadcn `empty.tsx`, Dub, Ghost `empty-indicator`) |
| Dark mode par inversion brute (`#000` + `#fff`) | Dark = fond 14‑20 % L, cartes +4‑6 % L, bordures `white/10 %`, texte 98 % L, ombres remplacées par ring blanc 10‑18 % (shadcn, Supabase, Trigger) |

Règle de pouce issue du corpus : si une propriété dépasse **10 % d'alpha** pour une ombre, **300 ms** pour une transition, **12 px** de rayon pour un contrôle, **1 couleur** chromatique par écran hors statuts, ou **16 px** pour une icône d'interface, elle sort du consensus des applications étudiées.
