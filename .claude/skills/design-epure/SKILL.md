---
name: design-epure
description: >
  Design épuré, lisible et efficace pour l'application Klikphone SAV (React + Tailwind, outil métier
  utilisé toute la journée au comptoir sur iPad et à l'atelier sur PC) — sans le « look IA »
  (dégradés violets, tuiles d'icônes, cartes partout, bannières empilées, emoji, animations gratuites).
  Charger ce skill dès qu'on touche à l'interface : créer ou modifier une page, un composant, un
  tableau, un formulaire, une modale, un badge, la barre latérale ; refonte, « rendre plus joli »,
  « plus épuré », « moins chargé », « ça fait IA », audit design, revue d'un écran, choix de couleur,
  de police, d'espacement, d'animation ; ou quand le gérant parle de design, d'ergonomie, de lisibilité.
  Fondé sur une recherche sourcée (Refactoring UI, Geist, Polaris, Atlassian, Primer, Carbon, NN/g,
  Linear, Emil Kowalski, Rauno, catalogues « AI slop » 2026, mesures en direct de Vercel/Linear/GitHub/
  Stripe/shadcn, logiciels du métier) et sur un audit chiffré du code (8 nov. 2026). Toujours en français.
---

# Design épuré — Klikphone SAV

**Règle d'or : l'outil s'efface devant le contenu.** Au comptoir, la question est toujours
« quel est l'état, que dois-je faire ». Chaque écran a **un** point focal, **une** action primaire,
**une** teinte d'accent, et le reste est gris, aligné, silencieux. Ce qui fait « template IA », ce n'est
pas une couleur ou un rayon : c'est **l'addition** — tuiles d'icônes + pastilles + bannières + trois
boutons violets + animations à chaque montage. On enlève avant d'ajouter.

Ce fichier donne les décisions. Les preuves et les valeurs de référence sont dans `references/` :

| Fichier | Contenu |
|---|---|
| `references/regles-sourcees.md` | 104 règles chiffrées avec URL (typo, espace, couleur, profondeur, composants, états, motion, a11y) + tableau comparatif des design systems |
| `references/anti-ia-sources.md` | Catalogue détaillé des « tells » IA (Hobday, 925Studios, pixelslop, aismells, 21st.dev…) |
| `references/motion-etats.md` | 105 règles de mouvement/états + 11 recettes Tailwind prêtes (bouton en chargement, squelette, toast, drawer, modale, état vide, focus, ligne de tableau, badge, kbd) |
| `references/metier-sav.md` | Patterns des logiciels de réparation et des service desks : liste de tickets, fiche, dépôt comptoir, file atelier, clients, devis, dashboard, pièges |
| `references/references-mesurees.md` | Valeurs réelles relevées dans Vercel, Linear, GitHub, Stripe, Supabase, Plausible, shadcn ; leçons des vidéos de créateurs |
| `references/audit-2026-11.md` | Audit du code Klikphone (fichier:ligne), 15 chantiers classés, vérification visuelle en production |
| `references/gabarits.md` | Gabarits de page (liste, fiche, formulaire, dashboard, modale, drawer) avec squelettes JSX |
| `references/typo-couleur.md` | Décisions détaillées police / neutres / statuts / icônes et leurs sources (contrastes calculés, `Intl` vérifié) |
| `references/conventions-fr.md` | Rédaction et typographie françaises à l'écran (DSFR, RGAA, OQLF, Microsoft FR), règles des créateurs, modes vs fondamentaux |
| `references/reddit.md` | 52 règles tirées de 47 fils Reddit (scores), apps admirées et pourquoi |
| `references/github-projets.md` | Tokens réels des meilleurs projets open source (shadcn, Radix, Geist, Twenty, Cal.com, Formbricks, Documenso, Dub, Midday, Plane, PostHog…) et leur consensus |
| `references/sources.md` | Bibliographie : ce qui a été appris où (Reddit, articles, GitHub, vidéos, mesures) |

## 1. Les dix décisions (à appliquer telles quelles)

1. **Un point focal par écran.** Avant de coder, écrire en une phrase ce que l'œil doit voir en premier
   (ex. fiche ticket : « le statut et l'action suivante »). Tout ce qui n'y contribue pas descend d'un
   cran : gris, plus petit, plus bas, ou supprimé.
2. **Une action primaire par écran** (`btn-primary`), à droite de l'en-tête ou en pied de modale. Les
   autres actions : `btn-secondary` (contour), `btn-ghost` (texte), ou menu « ⋯ » au-delà de trois.
   Jamais deux fois la même action à l'écran. Le vert plein est réservé à l'encaissement / remise.
3. **Le noir porte l'action, pas la décoration** (décision du gérant, 9 nov. 2026 : le violet venait de
   l'ancien K et n'est pas la marque ; l'orange du logo se confond avec l'ambre des alertes et n'atteint
   que 2,9:1 avec du blanc). Le jeton `brand` est désormais une rampe slate : `brand-600` = slate-900
   `#0F172A` (bouton primaire, onglet actif, case cochée, étape en cours ; 17,9:1), `brand-700` = slate-800
   (survol, texte d'action), `brand-500` = slate-600 (anneau de focus, 7,6:1), `brand-50` = slate-100
   (fond sélectionné), `brand-300` = slate-400 (bordure sélectionnée). **Sur fond sombre** (barre latérale,
   borne, vitrine) l'action s'inverse : blanc plein, texte `slate-900`, focus `ring-slate-300`.
   `badge-brand` = contour (`ring-slate-300`), pour rester distinct de `badge-neutral`. Interdit : fonds
   `brand-50/100` décoratifs (tuiles d'icônes, avatars), codes ou titres colorés, bordure gauche colorée,
   dégradés, ombre colorée, retour du violet.
   **Exception : le logo officiel KlikPhone** (K orange `#FF6600` / gris `#9A9A9A`, `components/LogoK.jsx`)
   garde ses couleurs partout ; on ne le redessine, n'arrondit, ne recolore ni ne le met en dégradé.
4. **Texte d'interface 14 px / interligne 20 px**, secondaire 13 px, légende 12 px (plancher absolu),
   saisies 16 px (iPad). Titre de page 24 px / 600 / −0,02 em, titre de carte ou de section 16 px / 600,
   chiffre clé 24–30 px / 600 tabulaire. Graisses 400 / 500 / 600 seulement (700 pour `t-display`
   uniquement, jamais 800). `tabular-nums` sur tout nombre, prix, heure, compteur. **Une seule famille :
   Inter variable** (décision du gérant, 8 nov. 2026 ; Google Fonts `Inter:opsz,wght@14..32,400..700`,
   `font-optical-sizing: auto` sur `html` : la variante « Display » s'applique d'elle-même aux titres —
   recette Linear), titres en `tracking-tight`. Instrument Serif (italique d'accent) est **retirée** :
   marqueur reconnu des sites « vibe-codés » 2025, sans chiffres tabulaires. Inter n'est un « tell » que
   posée par défaut sur une landing page ; réglée (500/600, optique, tabulaires, une seule famille) elle
   lit « outil », pas « IA ». Plan B documenté : Geist Sans ; voir `references/typo-couleur.md` § 1.3.
5. **Gris = slate, du 50 au 950, sans noir pur** (slate gardé : gris froids, cohérents avec la barre
   latérale `#0F172A` et le gris du logo ; pas de mauve) : titres et valeurs `slate-900`, corps `slate-700` (10,4:1), secondaire
   `slate-600` (7,6:1), tertiaire `slate-500` **sur blanc seulement** (4,8:1 ; 4,3:1 sur `slate-100`,
   donc interdit là), `slate-400` jamais porteur de sens (2,6:1 : placeholders, désactivé). Bordure
   `slate-200`, champ `slate-300`, fond de page `slate-50`, surface `white`, zone neutre `slate-100`
   jamais empilée sur `slate-50` sans bordure. Trois niveaux de texte par écran, pas plus. Un lien
   d'interface est en `brand-700` + `font-medium` ; dans une phrase, il est souligné (le noir seul ne le
   distingue pas du texte).
6. **Statuts en 4 teintes sémantiques, pas 9 couleurs** — la couleur dit *qui doit agir* :

   | Statut | Sens | Liste : pastille + texte `slate-700` | Fiche : badge | Icône lucide |
   |---|---|---|---|---|
   | En attente de diagnostic | à nous, pas commencé | cercle vide `border-2 border-slate-400` | `bg-white border-slate-300 text-slate-700` | `CircleDashed` |
   | En attente de pièce | au fournisseur | pastille `bg-slate-500` | `bg-slate-100 text-slate-700` | `Package` |
   | Pièce reçue | à nous, débloqué | pastille `bg-blue-600` | `bg-blue-50 text-blue-700` | `PackageCheck` |
   | En attente d'accord client | au client (à relancer) | pastille `bg-amber-600` | `bg-amber-50 text-amber-800` | `MessageSquareMore` |
   | En cours de réparation | à nous, en main | pastille `bg-blue-600` | `bg-blue-50 text-blue-700` | `Wrench` |
   | Réparation terminée | prêt, à rendre | pastille `bg-emerald-600` | `bg-emerald-50 text-emerald-700` | `CircleCheck` |
   | Rendu au client | fini, à encaisser s'il reste | cercle plein `bg-slate-700` | `bg-slate-100 text-slate-700` | `CheckCheck` |
   | Clôturé | archivé | cercle plein `bg-slate-300` + texte `slate-500` | `border border-slate-200 text-slate-500` | `Archive` |

   Pastilles en 600 (≥ 3:1 ; les 500 échouent), textes 700 sur fond 50 (≥ 4,5:1), icône + libellé
   toujours (jamais la couleur seule). **Aucun statut en rouge** : le rouge est un calque réservé au
   retard, au refus de devis, à l'impayé et aux erreurs. Même règle pour les 7 statuts de commande
   (neutre / bleu / ambre / émeraude). Détail et variante à 6 teintes : `references/typo-couleur.md` § 2.3 et 4.5.
7. **Profondeur par la bordure et l'espace, pas par l'ombre.** Carte = `bg-white border
   border-slate-200`, sans ombre. Ombre uniquement sur ce qui flotte : menus et popovers (`shadow-md`),
   modales / drawers / toasts (`shadow-lg`). Rayons : contrôles et badges 6 px (`rounded-md`), cartes
   et menus 8 px (`rounded-lg`), modales et drawers 12 px (`rounded-xl`). Jamais `rounded-2xl/3xl`,
   jamais `backdrop-blur`, jamais de carte dans une carte.
8. **Espacement sur la grille 4 px : 4 / 8 / 12 / 16 / 24 / 32 / 48.** Dans un groupe 8–12, entre
   groupes 24, entre sections 32–48. Padding de carte 16 px (`card-body`), 20 px sur les bornes.
   Formulaire : 24 px entre groupes, 8 px libellé → champ, 4 px champ → aide. Une seule classe par
   règle (`min-h-11` pour les cibles, pas `h-11` ni `min-h-[44px]`).
9. **Mouvement : rien, sauf ce qui flotte.** Survol = fond `slate-50/100`, `transition-colors
   duration-150`. Modale 200 ms (opacité + `scale .96`), drawer 250 ms, toast 4 s. Zéro `animate-in`
   sur les cartes et étapes, zéro `pulse`, `bounce`, `wiggle`, `hover:scale`, `transition-all`,
   `duration-300+`, zéro animation au clavier, à la navigation et au défilement.
10. **Écrire comme un collègue, pas comme une landing page.** Casse de phrase, vouvoiement constant,
    boutons à l'infinitif verbe + objet (« Prévenir le client », « Imprimer le reçu »), phrases courtes à
    la voix active, aucun « ! », aucun emoji ni « ✓ » dans un libellé, pas de « Bienvenue », « Merci pour
    votre confiance », « Jetez un œil », « veuillez », « oups », pas de capitales pour insister (« Reste à
    payer », pas « RESTE À PAYER »). Champs : « (facultatif) » sur les rares champs facultatifs (terme déjà
    employé dans toute l'application) plutôt que des astérisques partout ; aide en une phrase sans point ; erreur affirmative sous le champ, avec la
    correction (« Le numéro doit avoir 10 chiffres, par exemple 06 12 34 56 78. »). Formats français
    produits par `Intl` (`fr-FR`), jamais à la main : `1 234,50 €`, `20 %`, `8 nov. 2026`, `14 h 30`,
    `n° 1234` (sans séparateur de milliers), guillemets « », capitales accentuées (« À traiter »),
    « — » pour l'absence. Détail : `references/conventions-fr.md` § 3.8–3.9.

## 2. Tokens Klikphone (Tailwind) — ce qui existe et ce qui change

Le système de `frontend/src/styles/index.css` est bon et adopté à 78 % : la refonte est un
**resserrage**, pas une reconstruction. Décisions par rapport à l'existant :

| Sujet | Avant (index.css / tailwind.config.js) | Décision |
|---|---|---|
| Police | Plus Jakarta Sans 400–800 + Instrument Serif italique | **Inter variable** (opsz 14–32, 400–700), `html { font-optical-sizing: auto }`, `tracking-tight` sur les titres, `tabular-nums` ; Instrument Serif retirée ; `fontFamily.display` = alias de `sans` (à supprimer avec les dernières classes `font-display`) |
| Corps / UI | 14 px (`t-body`) ; `t-h3`, `t-small`, `t-label`, `t-mono`, `btn-sm` en 13 px | 14 px partout en UI ; 13 px seulement `t-small`/`t-mono` ; `t-h3` et `t-label` → 14 px ; plancher 12 px |
| Titres | `t-h1` 24 bold, `t-h2` 16 semibold, `t-display` 30 bold | `t-h1` 24 / 600 / `tracking-tight` ; `t-h2` 16 / 600 ; `t-display` 30 / 700 / `tracking-tight` réservé aux bornes ; **tout titre passe par une classe `t-*`** |
| Rayons | `rounded-lg` contrôles, `rounded-xl` cartes | **6 / 8 / 12** : `.btn .input .badge .select .choice` → `rounded-md` ; `.card .table-wrap .segmented` → `rounded-lg` ; `.modal .drawer .toast` → `rounded-xl` ; pilule seulement pour `badge-count` et points |
| Ombres | `shadow-xs` sur cartes et boutons, `shadow-lg` flottants | **carte sans ombre** (bordure seule) ; `shadow-xs` gardée sur `btn-secondary` ; `shadow-md` menus ; `shadow-lg` modales/drawers/toasts |
| Bordures | `slate-200` cartes, `slate-100` lignes de tableau | inchangé ; jamais deux séparations côte à côte (pas de bordure + fond + ombre) |
| Statuts | 9 teintes (`lib/utils.js`) : indigo, amber, violet, cyan, orange, blue, emerald, gray, slate | **4 teintes** (tableau de la décision 6) ; pastille 600 + texte `slate-700` dans les listes ; badge `bg-*-50 text-*-700` dans l'en-tête de fiche ; icône dédiée ; hex des graphiques alignés |
| Badges | pilule 24 px, 12 px semibold | `rounded-md`, 12 px / 500 ; `badge-count` reste rond ; **≤ 2 badges par ligne de tableau** |
| Boutons | 40 px (`btn`), 36 (`sm`), 48 (`lg`) ; 44 au doigt | hauteurs gardées (consensus GitHub : 36 par défaut, 32 dense, 40 pour l'action principale et le tactile) : `btn-sm` 36 dans les barres d'outils et tableaux, `btn` 40 pour les actions, `btn-lg` 48 sur les bornes ; primaire **unique** ; `btn-success` réservé à l'encaissement / remise ; `btn-icon` sans fond coloré |
| KPI | `kpi-icon` (carré brand-50 + icône) | **supprimer la tuile d'icône** : libellé 14 px slate-600, valeur 24 px tabulaire, variation en 12 px (« +12 % vs semaine passée »), 4–5 KPI max, dans une seule carte à colonnes séparées par un trait (modèle Plausible/shadcn) |
| Tableaux | lignes 56 px, en-tête 12 px capitales | lignes **48 px** (40 dense, 52 au doigt), en-tête 12 px / 600 capitales OK ou 13 px sentence case ; texte à gauche, nombres à droite ; 1 lien par ligne (la ligne) + menu « ⋯ » ; ≤ 3 marqueurs |
| Barre latérale | sombre `#0F172A`, item actif `brand-600/20` + barre 3 px, avatar dégradé + point vert, pill BETA, signature | gardée sombre (décision du gérant, 8 nov. 2026 ; Shopify y est revenu en 2026 ; 26 des 28 projets open source étudiés ont une barre claire, choix d'identité assumé), 256 px (Vercel, shadcn, Carbon), items 36 px à la souris / 44 px au doigt, mais **muette** : texte `slate-300`, icônes `slate-400` 18 px, intitulés de groupe 11 px capitales `slate-400`, survol `bg-white/5`, actif `bg-white/10 text-white` (la barre blanche 3 px marque l'item actif ; plus aucun violet ; **sous 1 024 px la barre du haut et le menu sont sur fond blanc**, jetons `nav-*`, décision du 9 nov. tolérée), compteurs `bg-white/10` sauf urgence rouge ; avatar = initiale sur `slate-700` ; **retirer** dégradé, point vert, pill BETA, signature « TkS∞26 », tagline en capitales espacées |
| Icônes | lucide 16–24 px, 77 tuiles colorées | lucide `w-4 h-4` avec du texte 12–14, `w-5 h-5` dans les boutons, champs et menu, `w-6 h-6` seulement titres et états vides ; `strokeWidth` 2 (1,5 à partir de 24 px) ; `text-slate-500` au repos, `currentColor` dans les boutons ; toujours un libellé ou un `aria-label` ; **aucune tuile colorée** autour d'une icône, aucun emoji |
| Callouts | 95 usages, jusqu'à 8 empilés | **1 bandeau d'état par écran**, une ligne, priorisé ; le reste en texte dans la carte concernée |
| Motion | `animate-in` ×55, `wiggle`, `shimmer`, `pulse` | garder `animate-scale-in` (modale), `animate-slide-in` (drawer), toast, loaders ; retirer `wiggle` et `fadeUp` de la config ; squelette statique ou pulsation lente |
| Ton | 16 « ! », emoji, « Bienvenue », tutoiement ponctuel | décision 10 |

Détail et justification de chaque ligne : `references/typo-couleur.md` et `references/audit-2026-11.md` § 6.

## 3. Anti-look IA : la liste à vérifier avant de livrer

Un écran est « propre » s'il ne coche **aucune** de ces cases (source : catalogues pixelslop /
avoid-ai-design / Capital & Compute / Robots on Payroll / 26 tricks, et audit Klikphone) :

- [ ] Dégradé (fond, bouton, texte `bg-clip-text`), halo, ombre colorée, `backdrop-blur`, « liquid glass »
- [ ] Icône dans un rond ou un carré coloré ; avatar à initiales sur fond violet ; icône > 24 px hors état vide
- [ ] Trois cartes identiques côte à côte avec icône + titre + phrase ; carte dans une carte ; « tout en carte »
- [ ] Bordure gauche colorée sur une carte ou un bandeau (le toast actuel est l'exception tolérée)
- [ ] Plus d'un bouton primaire visible ; deux boutons de même poids côte à côte ; la même action deux fois
- [ ] Plus de 6 familles de couleur à l'écran (slate + brand + 4 sémantiques) ; statut en couleur hors des 4 teintes de la décision 6 ; un statut en rouge
- [ ] Bannières empilées (> 1) au-dessus du contenu ; pastilles multicolores en rangée
- [ ] Nombre seul ≥ 24 px sans libellé ni comparaison ; capitales pour insister ; `font-bold` partout
- [ ] Texte < 12 px ; `slate-400` sur du texte ; gris sur fond coloré ; contraste < 4,5:1
- [ ] `rounded-2xl/3xl`, `shadow-xl/2xl`, `text-[13px]`, `min-h-[44px]`, `transition-all`, `!important` dans un `className`
- [ ] `animate-in` au montage d'une carte, `pulse`, `bounce`, `wiggle`, `hover:scale`, compteur animé, barre de progression décorative
- [ ] « ! », emoji, « ✓ » dans un libellé ; « Bienvenue », « Merci pour votre confiance », « puissant », « en un clic » ; tutoiement mêlé au vouvoiement
- [ ] `confirm()` / `prompt()` natifs ; « Êtes-vous sûr ? » ; modale pour ce qu'un « Annuler » après coup réglerait
- [ ] État vide = conteneur blanc, ou illustration générique ; chargement = spinner plein écran ; « Aucun résultat » pendant le chargement
- [ ] Chaîne de 8+ classes copiée dans 3 fichiers au lieu d'une classe `index.css` ou d'un composant

Deux tests finaux : **cacher le logo** et regarder si l'écran pourrait être celui d'un template ;
**compter** les commandes au-dessus du premier contenu utile (cible : ≤ 12 sur une page liste).

Règle de pouce tirée des 30 meilleurs projets open source (`references/github-projets.md`) : au-delà de
**10 % d'alpha** pour une ombre, **200 ms** pour une transition, **8 px** de rayon pour un contrôle,
**une** couleur chromatique par écran hors statuts, ou **20 px** pour une icône en ligne, on est sorti du
consensus — et il faut une raison écrite.

## 4. Méthode de travail (à chaque modification d'interface)

1. **Lire** `frontend/src/styles/index.css` (classes existantes) et, pour une page liste / fiche /
   formulaire / dashboard, le gabarit correspondant dans `references/gabarits.md` et le pattern métier
   dans `references/metier-sav.md`.
2. **Écrire le point focal** et l'action primaire de l'écran (une phrase chacune) ; lister ce qui descend
   d'un cran ou disparaît. Sur une refonte, partir du relevé `references/audit-2026-11.md`.
3. **Construire avec le système** : classes `t-*`, `page*`, `card*`, `btn*`, `input*`, `badge*`,
   `table*`, `callout`, `segmented`, `modal*`, `drawer*`. Un besoin récurrent (≥ 3 usages) devient une
   classe dans `index.css` ou un composant dans `components/`, jamais une chaîne copiée.
4. **Vrai contenu** : tester avec un nom long, un prix à 4 chiffres, une liste vide, une erreur réseau,
   un chargement lent ; sur iPad paysage 1024 × 768 (cibles 44 px, saisies 16 px, pas de survol
   obligatoire) et sur PC 1366 × 768.
5. **Passer la liste** de la section 3, puis le workflow du `CLAUDE.md` (contrastes AA, aria, focus
   clavier, cibles ≥ 44 px, `prefers-reduced-motion`, `npm run build`).
6. **Vérifier à l'écran** (aperçu ou production) : capture avant / après, et compter — commandes
   au-dessus du contenu, couleurs présentes, boutons pleins, badges par ligne.

Mode **audit** (quand on demande « est-ce que cet écran est bien ? ») : produire les mêmes comptes
(commandes, teintes, primaires, badges, bannières, animations, textes hors système) avec `fichier:ligne`,
classer les écarts par gravité (écrans quotidiens > pages publiques > vitrine) et proposer les correctifs
par rentabilité (S/M/L), comme dans `references/audit-2026-11.md` § 4–6.

## 5. Composants : la forme attendue

- **Page liste** (tickets, clients, commandes) : `page-header` (titre = nom de la ressource, 1 primaire)
  → onglets de vues avec compteurs (par **groupe** de statuts, terminés à la fin) → une ligne de
  filtres (recherche à gauche, 2–3 filtres, tri) → tableau. Tout cela tient dans **une** zone de
  commande ; la première ligne est visible au-dessus du pli sur iPad.
- **Ligne de tableau** : la ligne entière est le lien ; 48 px ; identifiant lisible en première colonne
  (client), code en `slate-900` mono 13 px ; statut = point + mot ; **délai de réparation toujours visible**
  (pastille neutre si tenu, ambre si proche, rouge si dépassé, « Délai à fixer » pointillé si absent — exigence du
  gérant) ; montant à droite tabulaire ; actions révélées au survol (`@media (hover: hover)`)
  + menu « ⋯ » accessible au doigt ; ≤ 2 badges.
- **Fiche** : en-tête clair pleine largeur (retour, identifiant, statut, client · appareil, montant,
  **l'action suivante du workflow** + « Imprimer » + « ⋯ ») ; 1 bandeau d'état au plus ; 2/3 contenu
  (diagnostic, prestations et pièces avec total visible, devis, photos, activité en bas) + 1/3 contexte
  (client, appareil, dossier) éditable en place ; champs vides masqués ; timeline unique.
- **Formulaire / borne** : une colonne, libellé au-dessus (jamais le placeholder), champs 44–56 px à
  16 px, options visibles ≤ 5 en boutons de choix, erreurs en ligne à la sortie du champ, « Suivant »
  primaire seul, brouillon conservé ; écran de fin sobre (titre, numéro, 2 actions), sans rond vert géant.
- **Dashboard** : première ligne = ce qui réclame une action aujourd'hui (4–5 compteurs textuels
  cliquables menant aux vues filtrées), puis la liste ; KPI du gérant en une carte à colonnes, avec
  comparaison et sparkline monochrome ; pas de camembert ni de jauge ; accueil différent par rôle.
- **Badge de statut** : `inline-flex items-center gap-1.5 rounded-md px-2 h-6 text-xs font-medium`,
  `badge-dot` de la teinte (600) + texte `slate-700` dans les listes ; fond teinté `*-50` + texte `*-700`
  (`amber-800`) seulement dans l'en-tête de fiche. Sentence case, libellé court.
- **Modale** : ≤ 560 px, titre = question précise, corps, pied avec « Annuler » (ghost) puis l'action
  (primaire ou danger), focus piégé, Échap ferme, 200 ms. Destructif rare et irréversible seulement ;
  sinon « Annuler » après coup (toast 5–8 s).
- **Drawer** : 420–480 px, pour un détail ou un formulaire sans perdre la liste ; en-tête collant, pied
  collant avec l'action ; 250 ms à l'ouverture, 200 ms à la fermeture.
- **État vide** : titre court + une phrase (pourquoi c'est vide, ce qui apparaîtra) + une action ;
  distinguer « ça charge », « aucun résultat pour ce filtre », « rien pour l'instant ».
- **Chargement** : rien avant 300 ms ; squelette aux dimensions du contenu pour une page ou une liste ;
  spinner 16 px dans le bouton (largeur conservée, `aria-busy`) pour une action ; jamais de spinner
  plein écran entre deux pages.

Recettes Tailwind prêtes à coller : `references/motion-etats.md` § 3.

## 6. Ce qu'on garde absolument

Le principe écrit en tête d'`index.css` (« la couleur porte un sens, la hiérarchie vient du poids et
de l'espace »), les contrastes calculés, la règle tactile `pointer: coarse` (44 px / 16 px), les
`aria-*`, `focus-visible:ring-brand-500`, `tabular-nums`, les squelettes « zéro saut », les états vides
avec cause et action, `StatusBadge` / `PrioriteBadge` / `Toast` / `Modal` accessibles, la navigation
clavier de la liste et de la palette, le vocabulaire métier en français dans le code. Rien de tout
cela ne doit régresser au nom de l'épure.

## 7. Phase 2 : la refonte, dans l'ordre (détail et `fichier:ligne` dans `references/audit-2026-11.md` § 6)

Chaque chantier se livre seul, avec capture avant / après et la liste de la section 3 passée.

1. **Statuts** → 4 teintes (`lib/utils.js`, `StatusBadge`, statuts de commande, hex des graphiques). S.
2. **Dashboard** → une seule zone de commande (recherche + vues + tri dans l'en-tête du tableau), 4–5
   compteurs textuels au lieu des 6 tuiles + 7 pastilles, « Statistiques du jour » retirées. M.
3. **Ligne de ticket** → la ligne est le lien, menu « ⋯ », ≤ 3 marqueurs, code en slate. M.
4. **Fiche ticket** → une action primaire par état dans l'en-tête, un seul bandeau d'état, en-tête clair à
   4 informations, zéro pulsation, `confirm()` remplacés par la `Modal`. M.
5. **Ornements** → serif, avatar dégradé, signature, pill BETA, dégradé et ombre violette de l'accueil,
   écrans de fin « landing » des bornes. S.
6. **Tuiles d'icônes** (77) → icône nue ou rien ; `kpi-icon`, `EnTete` des bornes, têtes de modale,
   avatars à initiales. S/M.
7. **Typo et tokens** → titres dans `t-*`, 13 → 14 px, rayons 6/8/12, carte sans ombre, codemod
   `min-h-11`, paddings de carte, `space-y`. M.
8. **Composants partagés** → `SearchInput`, `ModalHeader`, `Switch`, `ConfirmationBorne` ; boutons manuels
   et `!important` → variantes `btn`. M.
9. **Ton et formats** → « ! », emoji, « Bienvenue », entités HTML, `14 h 30`, `n° 1234`. S.
10. **Mouvement** → `animate-in` des cartes, wiggle, scale, barres décoratives, `backdrop-blur` des voiles. S.
11. **Vitrine** → supprimer `DemoDesignPage`, isoler `AdminSiteTarifsPage` / `VentesIphoneStory` /
    `.liquid-glass` du CSS commun. S/M.

Mesure de réussite sur les deux écrans quotidiens : Dashboard de 17 teintes → ≤ 6 et de ≈ 38 → ≈ 12
commandes au-dessus du tableau ; fiche ticket de 10 pastilles d'en-tête → 1, de ≤ 8 bannières → 1, de 13
boutons pleins → 1 primaire + 1 d'encaissement, 0 animation hors modales / toasts / loaders.
