# Sources : ce qui a été appris, et où (8 novembre 2026)

Recherche menée en parallèle par neuf agents (WebSearch/WebFetch, API d'archive Reddit, dépôts GitHub)
et par la session principale dans Chrome (vidéos, mesures en direct, production). Les fichiers de ce
dossier en sont la synthèse ; chaque règle y garde son URL.

## Reddit — 47 fils lus (→ `reddit.md`)
- Accès : reddit.com bloqué pour les outils ; fils lus via l'archive publique Arctic Shift (commentaires
  complets avec scores) et le miroir reddit.sentinel-team.org. Grands fils « anti-IA » repérés grâce au
  dépôt JCarterJohnson/vibecoded-design-tells (3,2 M de posts scannés).
- Subreddits : r/web_design, r/UI_Design, r/UXDesign, r/webdev, r/Frontend, r/SaaS, r/ClaudeAI,
  r/ClaudeCode, r/vibecoding, r/cursor, r/graphic_design, r/ProductManagement, r/Notion.
- Enseignements majeurs : le tell n° 1 est le kit par défaut non modifié + « AI purple » + dégradés ;
  « the urge to put a box around everything » ; critère n° 1 d'amateurisme = ne pas laisser respirer ;
  « one font, two colors, three clicks » ; les pros d'outils métier veulent des tableaux denses et des
  filtres ; apps admirées = Linear (vitesse, calme, clavier), Stripe (n° 1 UX SaaS), Raycast (palette),
  Things 3, Craft, Notion ; processus qui marche = `DESIGN.md` + tokens + passe « audit slop » + contenu réel.

## Articles et design systems — 78 pages lues (→ `regles-sourcees.md`, `anti-ia-sources.md`)
- Anti-look IA : Anthony Hobday (28 règles sûres), 925Studios, Capital & Compute, Alan West (indigo-500),
  Robots on Payroll, 21st.dev, aismells (bento), pixelslop (catalogue de 26 + 16 motifs), Oleh
  Volostnykh, LogRocket (Linear design), Brainy Papers (SaaS 2026).
- Refactoring UI (Wathan/Schoger) : deux synthèses détaillées.
- Design systems : Vercel Geist (+ `vercel.com/design.md`, Web Interface Guidelines), Linear (refonte
  2024), Shopify Polaris (10 fichiers de tokens), Atlassian (8 pages), GitHub Primer (5), IBM Carbon (4),
  Stripe (couleurs accessibles), Apple HIG via Erik Kennedy + WCAG 2.2, Material 3 via tokens.
- Outils internes : NN/g (tables, formulaires, confirmations, squelettes, états vides, dashboards),
  Andrew Coyle, Laws of UX.
- Craft : Emil Kowalski (4 articles + son dépôt `skills`), Rauno Freiberg, Erik Kennedy, Adham Dannaway
  (Practical UI), tendances 2025–2026 (daisyUI, setproduct).

## Mouvement et états — 67 pages lues (→ `motion-etats.md`)
Emil Kowalski (animations, Sonner, Vaul), Rauno (interaction design, novelty, depth), Linear, Apple HIG
(Motion, Alerts, Feedback, Keyboards), Material 3 (easing, snackbar, dialogs, side sheets), NN/g (9
articles), Aza Raskin (undo), Smashing (optimistic UI), Josh Comeau, web.dev, WCAG 2.3.3 / 2.4.13,
Sara Soueidan, Tailwind, Radix/shadcn, cmdk, Carbon, Primer, Atlassian, Stripe Apps, Grafana, SaaSUI,
Pencil & Paper.

## Métier SAV / service desk / back-office — 62 pages lues (→ `metier-sav.md`)
RepairDesk, RepairShopr/Syncro, Fixably, Orderry, RepairQ, CellStore, MyRepairApp, Shopmonkey,
Tekmetric, Omnique ; Linear, Zendesk, Intercom, Front, Help Scout, Chatwoot, Freshdesk, Jira, Plain ;
Shopify Polaris (index/details), Stripe, Square, Qonto, Pennylane/Planity/Doctolib (peu documentés).
Avis Capterra/G2 lus en extraits seulement (sites bloqués).

## Créateurs design et conventions françaises — 52 pages lues (→ `conventions-fr.md`)
Erik Kennedy (6 articles), Malewicz/Hype4 (4), Dannaway, Refactoring UI (3), Vitaly Friedman (6), Adrian
Bece, Cloud Four (rayons imbriqués), Mizko ; DSFR (dépôt GouvernementFR/dsfr : fondamentaux + 12
composants), RGAA 4.1.2, GOV.UK, OQLF, Wikipédia (conventions typographiques), Microsoft French Style
Guide, Canada.ca, Debian, Blender. Showalter, Juxtopposed, Sajid, Geoco, Femke, Flux : aucun écrit
exploitable, rien ne leur est attribué.

## Vidéos de créateurs (YouTube, via Chrome — substitut aux réels Instagram) (→ `references-mesurees.md`)
- Instagram : mur de connexion sur l'exploration et sur tous les profils ; aucune saisie d'identifiants,
  donc aucune lecture. Les mêmes créateurs publient sur YouTube.
- Lues intégralement : « Your Vibe-Coded App Looks AI-Made. Fix It With These 26 Tricks » (Short, 8 nov.
  2026) ; Jesse Showalter « Amateur vs Pro UI Design » (281 k vues). Repérées (titres, chapitres,
  résumés) : Kole Jain « 7 UI/UX mistakes that scream beginner », « Dashboard UI in 8 minutes », « The secret
  behind weirdly perfect UI » ; Sajid « The 80 % of UI Design – Typography » ; Mobbin « I studied 2 108
  dashboards » ; Chainlift « The Secret Science of Perfect Spacing » ; Juxtopposed « world's shortest UI/UX
  design course » — transcriptions bloquées par les publicités.

## Mesures en direct (Chrome, `getComputedStyle`) (→ `references-mesurees.md`)
Vercel (dashboard connecté), Linear (variables CSS du produit), GitHub (Primer en production), Stripe
(connexion), Supabase (connexion), Plausible (dashboard public), shadcn/ui (exemple Dashboard).
Production Klikphone : Tableau de bord, fiche ticket, Clients, Tarifs (captures du 8 nov. 2026).

## Audit du code Klikphone (→ `audit-2026-11.md`)
106 fichiers, 53 258 lignes ; lecture intégrale de 25 fichiers clés, ~35 métriques par grep, 4 écrans
décrits, 24 « tells » classés, 15 chantiers S/M/L.

## Navigation et mise en page — ~100 pages lues (→ `gabarits.md`)
Polaris (docs + tokens CSS), Atlassian (navigation system, side-nav, modal, drawer, page header, empty
state, Atlaskit), Material 3 (drawer, rail, dialogs, side sheets, tabs, window size classes,
list-detail), Primer (PageLayout, Dialog, PageHeader, Timeline, RelativeTime), Carbon (UI shell, data
table, 2x grid), Apple HIG (layout, sidebars, claviers, gestes), WCAG 2.5.8, NN/g (16 articles),
Smashing / Vitaly Friedman (7), Linear (parts I & II), Laws of UX, Refactoring UI, A List Apart
(zébrage), Pencil & Paper, UXmatters, CSS-Tricks (zoom iOS).

## Typographie, couleur, icônes — 62 pages lues + mesures locales (→ `typo-couleur.md`)
Polices des produits de référence (Linear, Vercel, Stripe, Raycast, Attio, Supabase, Qonto…), débats
« Inter / Plus Jakarta Sans = tell IA ? », Radix Colors (mauve), Linear « neutral and timeless », OneSignal,
Refactoring UI, Stripe (couleurs accessibles), WCAG 1.4.1 / 1.4.3 / 1.4.11, APCA, NN/g (dark mode),
Shopify (retour à la navigation sombre, sept. 2026), Lucide (grille et épaisseurs), Josh Comeau
(ombres), OQLF / Wikipédia (formats). Mesures : ratios de contraste de toute la palette slate / brand /
sémantique, `Intl` fr-FR sous Node, tables OpenType des trois polices.

## GitHub — 45 dépôts examinés, 30 analysés en détail (→ `github-projets.md`)
Tokens lus dans le code (tailwind.config, globals.css, thèmes, composants) : shadcn/ui v4, Radix Themes,
Tremor, Mantine, Origin UI, Magic UI (contre-exemple), Twenty, Cal.com, Formbricks, Documenso, Dub,
Midday, OpenStatus, PostHog, Supabase Studio, Novu, Teable, Plausible, Outline, Chatwoot, Huly,
Papermark, Trigger.dev, Inbox Zero, Rallly, Maybe, Ghost Shade, Excalidraw, Mattermost, Infisical.
Non couverts (tokens introuvables ou délégués) : Hoppscotch, Plane, Umami, HeroUI, Saas UI, NocoDB,
AppFlowy, Invoice Ninja, erxes, Lago, Unkey ; Geist n'a pas de dépôt public de tokens. Six extraits
exemplaires avec permaliens (tableau et sidebar shadcn, badge de statut Novu, bouton Chatwoot + ombres
Cal.com, carte KPI shadcn / Novu, état vide Dub). Fichiers bruts conservés hors du dépôt.
