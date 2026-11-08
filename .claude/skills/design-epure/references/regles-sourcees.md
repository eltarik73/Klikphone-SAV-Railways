# Règles consolidées de design (sources : 78 pages — Refactoring UI, Geist, Polaris, Atlassian, Primer, Carbon, NN/g, Hobday, Kennedy, Emil Kowalski, Rauno, articles « AI slop » 2026)

Fichier généré le 8 novembre 2026 à partir de la recherche documentaire. Chaque règle est suivie de son URL source. Voir `sources.md` pour la bibliographie complète.

## Partie 2 — Règles consolidées (≈ 95 règles, classées par thème)

Format : règle → source.

### Typographie
1. Une échelle faite main, pas de tailles arbitraires : 12 / 14 / 16 / 18 / 20 / 24 / 30 / 36 / 48 / 60 ; aucune valeur à moins de ~25 % de la voisine. → https://maibuith.pages.dev/notes/refactoring-ui ; https://cdn.jsdelivr.net/npm/claude-code-skills@0.5.0/data/skills/ux-ui-design-system/references/refactoring-ui.md
2. Corps d'interface dense = **14 px / interligne 20 px** (Atlassian Body M 14/20, Carbon body-01 14/20, Primer body-medium 14/1.5, Material body-medium 14/20, Geist copy-14 « most common body style ») ; 16 px pour la lecture longue. → https://atlassian.design/foundations/typography ; https://carbondesignsystem.com/guidelines/typography/type-sets/ ; https://primer.style/product/primitives/typography/ ; https://vercel.com/geist/typography
3. Texte secondaire 13 px (tabulaire pour les nombres), tertiaire 12 px seulement en vue chargée ; jamais en dessous de 12 (Apple : 13 tertiaire, 10 minimum absolu). → https://vercel.com/geist/typography ; https://www.learnui.design/blog/ios-font-size-guidelines.html
4. « Never use tiny gray copy » : réécrire avant de rapetisser. → https://vercel.com/design.md
5. Hiérarchie par **graisse et couleur** d'abord, taille ensuite ; 2–3 tailles par composant. → https://maibuith.pages.dev/notes/refactoring-ui ; https://cdn.jsdelivr.net/npm/claude-code-skills@0.5.0/data/skills/ux-ui-design-system/references/refactoring-ui.md
6. Deux graisses suffisent : 400–500 normal, 600–700 emphase ; éviter 300 et ≥ 800 ; Medium (500) pour la plupart des composants et à côté d'icônes de trait. → https://maibuith.pages.dev/notes/refactoring-ui ; https://atlassian.design/foundations/typography
7. Interligne : corps 1,5–1,75 ; titres 1,2–1,3 ; UI 1,0–1,2 ; tous les interlignes sur la grille 4 px. → https://cdn.jsdelivr.net/npm/claude-code-skills@0.5.0/data/skills/ux-ui-design-system/references/refactoring-ui.md ; https://primer.style/foundations/typography
8. Interlettrage : grands titres −0,02 em (Polaris jusqu'à −0,54 px à 40 px), corps 0, capitales +0,05 à +0,1 em. → https://raw.githubusercontent.com/emilkowalski/skills/main/ui-cheatsheet.md ; https://raw.githubusercontent.com/Shopify/polaris/main/polaris-tokens/src/themes/base/font.ts
9. Longueur de ligne 45–75 caractères (≈ 65ch ; Polaris 40–60 ; Primer ≤ 80). → https://anthonyhobday.com/sideprojects/saferules/ ; https://ss-polaris.vercel.app/design/typography
10. Texte aligné à gauche ; pas de centré au-delà de 2–3 lignes ; centré/justifié « atypical » en produit. → https://primer.style/foundations/typography ; https://maibuith.pages.dev/notes/refactoring-ui
11. Sentence case partout (titres, boutons, en-têtes de tableau, lozenges) ; pas d'eyebrows en capitales espacées ni de numéros de section décoratifs. → https://atlassian.design/components/lozenge/usage ; https://vercel.com/design.md ; https://capitalandcompute.net/blog/fix-ai-slop-design/
12. Deux polices au plus ; ne pas prendre Inter « par défaut » : la choisir ou l'associer à une face distinctive. → https://anthonyhobday.com/sideprojects/saferules/ ; https://www.925studios.co/blog/ai-slop-design-tells
13. Chiffres tabulaires (`font-variant-numeric: tabular-nums`) pour toute colonne ou comparaison ; monospace seulement pour code, chemins et identifiants courts. → https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md ; https://vercel.com/design.md
14. Labels : les supprimer quand la valeur est évidente, les fondre dans la valeur, sinon plus petits et moins contrastés que la donnée. → https://maibuith.pages.dev/notes/refactoring-ui
15. Typographie fine : « … » plutôt que « ... », guillemets typographiques, espaces insécables dans « 10 Mo » ; `text-wrap: balance` sur les titres. → https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md

### Espacement et mise en page
16. Grille 4 px, échelle 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 (Polaris ajoute 20, 40, 80). → https://cdn.jsdelivr.net/npm/claude-code-skills@0.5.0/data/skills/ux-ui-design-system/references/refactoring-ui.md ; https://ss-polaris.vercel.app/design/space
17. « Start with too much whitespace » puis retirer ; densité acceptée pour dashboards et tableaux. → https://maibuith.pages.dev/notes/refactoring-ui
18. Plus d'espace autour d'un groupe qu'à l'intérieur ; padding extérieur ≥ padding intérieur. → https://maibuith.pages.dev/notes/refactoring-ui ; https://anthonyhobday.com/sideprojects/saferules/
19. Sauter au moins un cran de l'échelle quand on associe deux espacements voisins (ex. 8 dans le groupe, 16 entre groupes). → https://ss-polaris.vercel.app/design/space
20. Trois paliers : dans un groupe 8–16, entre groupes 24–32, entre sections 32–48 ; le plus grand cran réservé à une rupture de chapitre ; « each gap has one owner ». → https://vercel.com/design.md ; https://atlassian.design/foundations/spacing
21. Padding de carte 16 px (16–24), écart entre cartes 16 px ; formulaire : 24 entre groupes, 8 label→champ, 4 champ→aide. → https://raw.githubusercontent.com/Shopify/polaris/main/polaris-tokens/src/themes/base/space.ts ; https://cdn.jsdelivr.net/npm/claude-code-skills@0.5.0/data/skills/ux-ui-design-system/references/refactoring-ui.md
22. Grille 12 colonnes (desktop), 6 tablette, 4 mobile ; prose sur 6–7 colonnes, tableaux sur 12 ; padding de page 16 px (24 au-delà de 1280) ; largeur max ~1280. → https://vercel.com/design.md ; https://primer.style/foundations/layout
23. Tout élément aligné avec un autre ; alignement optique plutôt que mathématique ; éléments ordonnés par poids visuel, le plus lourd au bord. → https://anthonyhobday.com/sideprojects/saferules/
24. Ne pas forcer des trouvailles inégales dans des cellules égales ; casser la symétrie une fois pour montrer une décision. → https://vercel.com/design.md ; https://21st.dev/blog/website-not-look-ai-generated
25. `min-width: 0` sur les enfants flex/grid pour permettre la troncature ; prévoir contenu court, moyen, très long. → https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md

### Couleur
26. Jamais `#000` ni `#fff` : presque-noir, presque-blanc ; neutres saturés < 5 % avec la teinte de marque, tous chauds ou tous froids. → https://anthonyhobday.com/sideprojects/saferules/
27. Gris 8–10 nuances ; couleur primaire 5–7 nuances ; texte = 900, fonds teintés = 100, bouton = 500. → https://maibuith.pages.dev/notes/refactoring-ui
28. Échelle à 10 pas avec rôles fixes : 100 fond, 200 hover, 300 actif, 400 bordure, 500 bordure hover, 700 fond haut contraste, 900 texte secondaire, 1000 texte primaire. → https://vercel.com/geist/colors
29. Couleur saturée réservée aux actions et aux états ; le reste en neutres ; « Design in monochrome ». → https://cdn.jsdelivr.net/npm/claude-code-skills@0.5.0/data/skills/ux-ui-design-system/references/refactoring-ui.md ; https://vercel.com/design.md
30. Contraste : texte 4,5:1 (< 18 px), grand texte et éléments d'interface 3:1 ; haut contraste ≥ 7:1 ; bordure de contrôle interactif au minimum 3:1. → https://stripe.com/blog/accessible-color-systems ; https://threadreaderapp.com/thread/1635652394951254017.html ; https://primer.style/foundations/color/overview
31. Construire la palette en espace perceptuel (LCH/CIELAB), pas en HSL : à luminosité HSL égale, jaunes et verts paraissent plus clairs, bleus plus sombres. → https://stripe.com/blog/accessible-color-systems ; https://linear.app/blog/how-we-redesigned-the-linear-ui
32. Règle de paires : deux pas ≥ 5 niveaux d'écart passent le texte petit, 4 niveaux pour icônes/grand texte. → https://stripe.com/blog/accessible-color-systems
33. Pas de gris sur fond coloré : prendre la même teinte plus proche du fond ; texte secondaire sur fond coloré par rotation de teinte. → https://maibuith.pages.dev/notes/refactoring-ui ; https://cdn.jsdelivr.net/npm/pixelslop@0.3.8/dist/skill/resources/ai-slop-patterns.md
34. Jamais la couleur seule : icône, label ou forme en plus (erreurs : contour + texte + graisse). → https://www.nngroup.com/articles/web-form-design/ ; https://atlassian.design/components/lozenge/usage
35. Surface sombre : couleur de marque à 1–10 % de luminosité plutôt que noir ; écart conteneur/fond ≤ 12 % (sombre) ou ≤ 7 % (clair) en HSB. → https://blog.logrocket.com/ux-design/linear-design ; https://anthonyhobday.com/sideprojects/saferules/
36. Bannir les dégradés indigo→violet, le texte en dégradé, les halos colorés, le cyan sur sombre. → https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p ; https://cdn.jsdelivr.net/npm/pixelslop@0.3.8/dist/skill/resources/ai-slop-patterns.md

### Profondeur : bordures et ombres
37. Moins de bordures : remplacer par un fond adjacent différent, une ombre légère ou de l'espace ; « Prefer whitespace or borders over elevation ». → https://maibuith.pages.dev/notes/refactoring-ui ; https://atlassian.design/foundations/elevation
38. Bordure 1 px, pas 400 de l'échelle grise (≈ gray-200 ou plus clair) ; « Draw each border once », dividers à l'intérieur de la bordure. → https://vercel.com/geist/colors ; https://cdn.jsdelivr.net/npm/claude-code-skills@0.5.0/data/skills/ux-ui-design-system/references/refactoring-ui.md
39. Bordure de conteneur contrastant avec le conteneur ET le fond ; pas deux séparations dures côte à côte. → https://anthonyhobday.com/sideprojects/saferules/
40. Ombres en deux couches : grande douce + serrée nette (`0 1px 3px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.08)` pour une carte) ; flou = 2 × décalage ; translucides, jamais opaques. → https://cdn.jsdelivr.net/npm/claude-code-skills@0.5.0/data/skills/ux-ui-design-system/references/refactoring-ui.md ; https://anthonyhobday.com/sideprojects/saferules/ ; https://vercel.com/geist/colors
41. Échelle d'élévation courte et fixe (Polaris : `0 1px 0 .07` → `0 4px 6px -2px .20` → `0 8px 16px -4px .22`) ; surfaces : page, carte (bordure, pas d'ombre), menu, modale. → https://raw.githubusercontent.com/Shopify/polaris/main/polaris-tokens/src/themes/base/shadow.ts ; https://atlassian.design/foundations/elevation
42. « Raised » réservé aux cartes déplaçables ; une carte plate = surface + bordure. → https://atlassian.design/foundations/elevation
43. En sombre : pas d'ombres, les surfaces plus hautes sont plus claires. → https://anthonyhobday.com/sideprojects/saferules/ ; https://atlassian.design/foundations/elevation
44. Une seule technique de profondeur dans toute l'interface ; pas de cartes dans des cartes. → https://anthonyhobday.com/sideprojects/saferules/ ; https://vercel.com/design.md
45. Rayons restreints et cohérents : 6 px contrôles (boutons, champs, items de nav), 8 px cartes et menus, 12 px modales ; 2–4 px badges/lozenges ; rayon intérieur = extérieur − écart. → https://atlassian.design/foundations/radius ; https://vercel.com/geist/materials ; https://anthonyhobday.com/sideprojects/saferules/
46. Pas de `rounded-2xl` partout avec la même ombre ; varier rayon et élévation selon la hiérarchie. → https://capitalandcompute.net/blog/fix-ai-slop-design/
47. Glassmorphism seulement en surface d'accent, jamais pour du texte long, jamais blur sur blur ; « dense dashboards get less glass ». → https://setproduct.com/blog/liquid-glass-vs-glassmorphism

### Composants — boutons
48. Un seul primaire par écran ou zone ; secondaire en contour ou fond léger ; tertiaire en texte. → https://raw.githubusercontent.com/Shopify/polaris/main/polaris.shopify.com/content/components/actions/button.mdx ; https://atlassian.design/components/button/usage
49. Hauteurs standard : 28 (compact) / **32 (défaut)** / 40 (grand) / 48 (empty state, mobile) ; padding horizontal = 2 × vertical. → https://primer.style/product/primitives/size/ ; https://anthonyhobday.com/sideprojects/saferules/
50. Libellé = verbe + objet, sentence case, sans article (« Ajouter une pièce » → « Ajouter pièce » en anglais ; en français garder la lisibilité) ; jamais « Continuer » quand « Enregistrer la clé » est possible. → https://atlassian.design/components/button/usage ; https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
51. Désactiver rarement : garder cliquable et expliquer par validation ; si désactivé, le contexte (ou un tooltip) dit pourquoi. → https://atlassian.design/components/button/usage ; https://vercel.com/geist/button
52. Destructif : pas forcément gros, rouge et gras ; un « critique » ouvre une confirmation ou offre une annulation. → https://maibuith.pages.dev/notes/refactoring-ui ; https://raw.githubusercontent.com/Shopify/polaris/main/polaris.shopify.com/content/components/actions/button.mdx
53. Icône seule = `aria-label` nommant l'action ; la plupart des boutons n'ont pas besoin d'icône. → https://vercel.com/geist/button ; https://atlassian.design/components/button/usage
54. Retour de pression `scale(0.97)` 160 ms ease-out ; `loading` intégré plutôt qu'un spinner maison. → https://raw.githubusercontent.com/emilkowalski/skills/main/skills/emil-design-eng/SKILL.md ; https://vercel.com/geist/button
55. Primaire du côté de l'alignement du groupe : droite pour modales/tâches focalisées, gauche pour formulaires pleine page. → https://atlassian.design/components/button/usage

### Composants — champs et formulaires
56. Une colonne, un champ par ligne ; label au-dessus, visible, jamais remplacé par le placeholder. → https://www.nngroup.com/articles/web-form-design/ ; https://www.andrewcoyle.com/blog/design-better-forms
57. Largeur du champ ≈ longueur attendue ; radios pour 2–3 options, options visibles jusqu'à 5, liste déroulante avec recherche au-delà de 25. → https://www.nngroup.com/articles/web-form-design/ ; https://www.andrewcoyle.com/blog/design-better-forms
58. Marquer les champs optionnels (1–2 au plus) plutôt que les requis ; supprimer le superflu. → https://www.andrewcoyle.com/blog/design-better-forms ; https://www.nngroup.com/articles/web-form-design/
59. Valider à la sortie du champ, erreurs en ligne sous le champ, focus sur la première erreur, saisie conservée, formats annoncés avant. → https://www.andrewcoyle.com/blog/design-better-forms ; https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
60. Champs « creusés » (lumière du haut), rayon 6, hauteur 32–40, `font-family: inherit`, `autocomplete`/`inputmode` corrects, jamais bloquer le collage. → https://learnui.design/blog/7-rules-for-creating-gorgeous-ui-part-1.html ; https://ss-polaris.vercel.app/design/typography ; https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
61. Pas de bouton Reset ; Annuler bien moins visible qu'Enregistrer ; avertir avant de quitter avec des changements non sauvés. → https://www.nngroup.com/articles/web-form-design/ ; https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md

### Composants — tableaux
62. Texte à gauche, **nombres à droite**, en-têtes alignés comme leurs cellules, jamais centré ; unité dans l'en-tête, décimales constantes. → https://raw.githubusercontent.com/Shopify/polaris/main/polaris.shopify.com/content/components/tables/data-table.mdx ; https://vercel.com/design.md
63. Hauteur de ligne : 40 px par défaut, 32 compact, 48 confortable (Carbon xs 24 → xl 64) ; padding de cellule 16 px (Polaris 6 px vertical dans l'index table) ; laisser l'utilisateur choisir la densité. → https://carbondesignsystem.com/components/data-table/style/ ; https://raw.githubusercontent.com/Shopify/polaris/main/polaris-tokens/src/themes/base/space.ts ; https://www.andrewcoyle.com/blog/design-better-data-tables
64. En-tête de colonne 14/600, texte de ligne 14/400 en gris secondaire qui passe au primaire au survol ; surbrillance de ligne au survol. → https://carbondesignsystem.com/components/data-table/style/
65. Première colonne = identifiant lisible (nom du client, n° de ticket parlant), colonnes par importance, liées adjacentes ; en-tête fixe dès que ça dépasse. → https://www.nngroup.com/articles/data-tables/
66. Lignes de séparation fines plutôt que zébrure ; zébrure seulement sur de longues listes (trompeuse avec peu de lignes) ; bordures désactivées par défaut. → https://www.andrewcoyle.com/blog/design-better-data-tables ; https://vercel.com/geist/table
67. Chaque ligne est une action (ouvre la fiche) ; 1–2 actions inline au plus, sinon menu ; actions groupées = cases + barre + « Tout sélectionner ». → https://raw.githubusercontent.com/Shopify/polaris/main/polaris.shopify.com/content/components/tables/index-table.mdx ; https://www.nngroup.com/articles/data-tables/
68. Pagination au-delà de 50 lignes (pas d'infinite scroll dans un outil de priorisation) ; virtualiser au-delà de 50 éléments rendus. → https://raw.githubusercontent.com/Shopify/polaris/main/polaris.shopify.com/content/components/tables/index-table.mdx ; https://www.andrewcoyle.com/blog/design-better-data-tables ; https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
69. Valeur absente = « — » ; dates relatives puis absolues après 7 jours ; « Wrap instead of truncate » pour les libellés qui commencent pareil. → https://vercel.com/geist/table ; https://raw.githubusercontent.com/emilkowalski/skills/main/ui-cheatsheet.md ; https://raw.githubusercontent.com/Shopify/polaris/main/polaris.shopify.com/content/components/tables/data-table.mdx
70. Filtres visibles et état actif indiqué ; filtres, tri, onglets, pagination reflétés dans l'URL. → https://www.nngroup.com/articles/data-tables/ ; https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
71. Édition d'une ligne dans un panneau latéral non modal plutôt qu'une modale qui cache les voisines. → https://www.nngroup.com/articles/data-tables/

### Composants — badges de statut
72. Un lozenge porte un attribut important (statut de workflow, priorité) ; la méta descriptive va dans un tag discret ; pas de badge pour la méta ordinaire. → https://atlassian.design/components/lozenge/usage ; https://vercel.com/design.md
73. Sentence case, texte court, rayon 2–4 px, fond teinté (pas 100–200) + texte de la même teinte (900) ; version « bold » (fond plein) réservée aux compteurs ou à l'état critique. → https://atlassian.design/components/lozenge/usage ; https://atlassian.design/components/badge/usage ; https://stripe.com/blog/accessible-color-systems
74. Couleur sémantique partagée (succès/attention/danger/info/neutre) ; jamais la couleur seule : libellé toujours lu, icône si utile ; ≤ 6 sémantiques. → https://atlassian.design/components/lozenge/usage ; https://primer.style/foundations/color/overview
75. Badge numérique : chiffres seuls (+/−, K), toujours à côté d'un label. → https://atlassian.design/components/badge/usage

### Composants — barre latérale et chrome
76. Chrome en « L inversé » (sidebar + bande haute) qui cadre la vue ; labels, icônes et boutons alignés sur les deux axes ; densité de navigation accrue. → https://linear.app/blog/how-we-redesigned-the-linear-ui
77. Largeur 240–256 px (Carbon 256) ; items 32 px, icônes 16 px, label 14/600, padding 16 ; texte secondaire au repos → primaire au survol/sélection ; sélection par fond + barre 2–4 px. → https://carbondesignsystem.com/components/UI-shell-left-panel/style/
78. En sombre : hiérarchie par gradations d'opacité de blanc, surfaces plus hautes plus claires, aucune ombre. → https://atlassian.design/foundations/elevation ; https://anthonyhobday.com/sideprojects/saferules/
79. Séparer les régions du shell par l'espace, pas par des bordures de routine ; pas de rail coloré. → https://vercel.com/design.md
80. Palette de commandes et raccourcis clavier : aucune animation sur les actions clavier ; les coins d'écran sont des cibles infinies. → https://raw.githubusercontent.com/emilkowalski/skills/main/skills/emil-design-eng/SKILL.md ; https://rauno.me/craft/interaction-design

### Composants — cartes et dashboard
81. Une carte doit être « earned » (groupe interactif, sélection) ; la plupart du contenu repose directement sur la page ; pas de « card kit » de trois tuiles égales. → https://vercel.com/design.md ; https://aismells.pages.dev/bento-box-sprawl.html
82. Pas de bordure gauche colorée sur les cartes (signal IA notoire) ; pas d'icône au-dessus de chaque titre. → https://robotsonpayroll.substack.com/p/how-to-avoid-that-vibe-coded-look ; https://cdn.jsdelivr.net/npm/pixelslop@0.3.8/dist/skill/resources/ai-slop-patterns.md
83. Métriques : jamais un nombre seul ≥ 24 px ; contexte, comparaison, unité ; une relation composée vaut mieux que des boîtes répétées. → https://cdn.jsdelivr.net/npm/pixelslop@0.3.8/dist/skill/resources/ai-slop-patterns.md ; https://vercel.com/design.md
84. Dashboard sur un écran, une tâche ; barres/lignes (longueur, position), pas de camembert ni jauge ; couleur en renfort, jamais pour une quantité ; labels directs plutôt que légende. → https://www.nngroup.com/articles/dashboards-preattentive/ ; https://vercel.com/design.md

### États
85. Vide : jamais un conteneur blanc ; dire que c'est vide, expliquer comment ça se remplit, bouton d'action direct ; jamais « aucun élément » pendant le chargement. → https://www.nngroup.com/articles/empty-state-interface-design/ ; https://raw.githubusercontent.com/Shopify/polaris/main/polaris.shopify.com/content/components/tables/index-table.mdx
86. Chargement : < 1 s rien ; 1–10 s skeleton (page) ou spinner (module) ; > 10 s barre avec estimation ; skeleton statique de la vraie structure. → https://www.nngroup.com/articles/skeleton-screens/
87. Hover/active/focus plus contrastés que le repos ; state layers 8 % hover, 10 % focus/pressed, 16 % drag. → https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md ; https://docs.rs/frust-material/latest/frust_material/state_layer/index.html
88. Hover/sélection par couleur, fond ou ombre, jamais par taille ou graisse (le layout bougerait). → https://learnui.design/blog/7-rules-for-creating-gorgeous-ui-part-2.html
89. Confirmation seulement pour l'irréversible, boutons qui nomment l'issue (« Supprimer le ticket » / « Conserver »), pas de « Oui » par défaut ; sinon annulation (undo). → https://www.nngroup.com/articles/confirmation-dialog/
90. Feedback immédiat : réponse < 400 ms (Doherty), bouton actif jusqu'au départ de la requête puis spinner, `aria-live="polite"` pour les toasts. → https://lawsofux.com/ ; https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md

### Motion
91. < 300 ms pour toute animation d'interface : pression 100–160, tooltip 125–200, menu 150–250, modale 200–300 ; sortie plus rapide que l'entrée. → https://raw.githubusercontent.com/emilkowalski/skills/main/skills/emil-design-eng/SKILL.md ; https://emilkowal.ski/ui/great-animations
92. `ease-out` pour entrer/sortir, `ease-in-out` pour déplacer, `ease` pour hover/couleur ; jamais `ease-in`, jamais de bounce sur un dashboard. → https://raw.githubusercontent.com/emilkowalski/skills/main/skills/emil-design-eng/SKILL.md ; https://cdn.jsdelivr.net/npm/pixelslop@0.3.8/dist/skill/resources/ai-slop-patterns.md
93. Seulement `transform` et `opacity`, jamais `transition: all`, `transform-origin` sur le déclencheur, départ à `scale(0.95)` pas 0. → https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md ; https://raw.githubusercontent.com/emilkowalski/skills/main/skills/emil-design-eng/SKILL.md
94. Pas d'animation pour ce qui est fait 100 fois par jour (raccourcis, navigation de liste) ; « Default to stillness » ; pas de révélation au scroll, pas de compteurs, pas de pulse. → https://raw.githubusercontent.com/emilkowalski/skills/main/skills/emil-design-eng/SKILL.md ; https://vercel.com/design.md
95. `prefers-reduced-motion` : moins et plus doux (garder opacité), pas zéro ; animations interruptibles. → https://emilkowal.ski/ui/great-animations ; https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md

### Accessibilité
96. Cibles ≥ 24 × 24 CSS px (AA) et 44 × 44 pour les contrôles importants (AAA / Apple) ; Practical UI : boutons ≥ 48 px. → https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html ; https://threadreaderapp.com/thread/1635652394951254017.html
97. Anneau de focus 2 px, décalé de 2 px, rayon + 2 px, via `:focus-visible` ; jamais `outline-none` sans remplacement. → https://atlassian.design/foundations/radius ; https://atlassian.design/foundations/border ; https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
98. Icônes décoratives `aria-hidden`, boutons icône `aria-label`, labels `htmlFor`, un h1, titres ordonnés, `<button>` pour agir et `<a>` pour naviguer. → https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
99. Icônes : un seul jeu, même trait (2 px), 16 px en ligne / 20 dans les boutons / 24 seules ; contraste baissé à côté du texte ; jamais d'icônes agrandies. → https://threadreaderapp.com/thread/1635652394951254017.html ; https://cdn.jsdelivr.net/npm/claude-code-skills@0.5.0/data/skills/ux-ui-design-system/references/refactoring-ui.md ; https://anthonyhobday.com/sideprojects/saferules/

### Anti-look IA (synthèse)
100. Interdits nets : dégradé indigo→violet, texte dégradé, halos, verre partout, `rounded-2xl` + ombre douce sur tout, trois cartes égales avec icône, bordure gauche colorée, eyebrows en capitales, emoji-icônes, fond #000/#fff, tout centré, compteurs animés, « Get Started / Learn More ». → https://cdn.jsdelivr.net/npm/pixelslop@0.3.8/dist/skill/resources/ai-slop-patterns.md ; https://capitalandcompute.net/blog/fix-ai-slop-design/ ; https://robotsonpayroll.substack.com/p/how-to-avoid-that-vibe-coded-look
101. Décider et écrire : 4–6 couleurs hex nommées avec rôle, une échelle de type, une police choisie, des règles vérifiables à l'œil, états et variante sombre dans des tables de tokens. → https://capitalandcompute.net/blog/fix-ai-slop-design/ ; https://robotsonpayroll.substack.com/p/how-to-avoid-that-vibe-coded-look
102. Concevoir avec le vrai contenu (noms longs, erreurs, listes vides) ; soigner les « trust moments » (vide, erreur, chargement) ; ajouter un élément non générique. → https://dev.to/olehvolos/users-can-tell-when-your-ui-was-ai-generated-and-they-dont-like-it-33kn
103. Hiérarchie plutôt qu'inventaire : « when every idea becomes a card, the page … starts having inventory » ; pas de silhouettes de sections identiques. → https://aismells.pages.dev/bento-box-sprawl.html ; https://vercel.com/design.md
104. Tests : cacher le logo et lire ; coller une capture dans un chat neuf et demander quel builder l'a faite ; audit en quatre questions d'identité. → https://21st.dev/blog/website-not-look-ai-generated ; https://robotsonpayroll.substack.com/p/how-to-avoid-that-vibe-coded-look ; https://brainy.ink/paper/why-every-saas-looks-the-same-2026

### Daté vs actuel (2025–2026)
- **Daté** : neumorphism (« effectively declining »), verre en fond de page, halos et mesh gradients, dark mode « par défaut » avec accent cyan/violet, grain/points de fond, pilule ⌘K décorative, bento sur tout, skeuomorphisme lourd. → https://setproduct.com/blog/liquid-glass-vs-glassmorphism ; https://brainy.ink/paper/why-every-saas-looks-the-same-2026 ; https://blog.logrocket.com/ux-design/linear-design
- **Actuel** : couleur retenue (monochrome + un accent qui porte du sens), typographie qui porte l'identité (« Type-First »), « Data-Dense Utilitarian UI » pour les outils experts, bordures 1 px subtiles plutôt qu'ombres, icônes monochromes à trait unique, motion utile et courte, verre « surgical » sur une surface d'accent au plus. → https://trends.daisyui.com/ui-design-trends-2026/ ; https://vercel.com/design.md ; https://raw.githubusercontent.com/emilkowalski/skills/main/skills/emil-design-eng/SKILL.md

---

## Partie 3 — Valeurs de référence : comparaison des design systems

| Système | Échelle de type (UI) | Hauteur bouton | Rayon | Ombre | Bordure | Focus | Ligne de tableau | Sidebar |
|---|---|---|---|---|---|---|---|---|
| **Vercel Geist** | label/copy 14 (courant), 13 secondaire & tabulaire, 12 tertiaire ; headings 72→14 ; valeurs px/tracking non publiées | tiny / small / medium (défaut) / large — px non publiés | 6 (base, small, tooltip) · 12 (menu, modal, medium, large) · 16 (fullscreen) | 4 paliers relatifs, translucides ; carte = bordure | gray-400 défaut, 500 hover, 600 actif ; « draw each border once » | n.p. | bordures off par défaut, `striped` option, `tabular-nums`, « — » pour l'absence | n.p. |
| **Shopify Polaris** | 11 / 12 / 13 / 14 / 16 / 18 / 20 / 22 / 24 / 28 / 30 / 32 / 36 / 40 ; interlignes 12–48 (grille 4) ; graisses 450/550/650/700 | n.p. dans les pages lues (micro/slim/medium/large) | 2 / 4 / 6 / 8 / 12 / 16 / 20 / 30 / full | 100 : `0 1px 0 rgba(26,26,26,.07)` · 300 : `0 4px 6px -2px .20` · 400 : `0 8px 16px -4px .22` ; boutons par ombres internes | 0,66 / 1 / 2 / 4 px ; `shadow-border-inset 0 0 0 1px rgba(0,0,0,.08)` | n.p. | cellule padding 6 px ; nombres à droite ; pagination > 50 ; condensé < 490 px | n.v. (240 px usuel) |
| **Atlassian ADS** | Body M **14/20** (défaut), L 16/24, S 12/16 ; headings 12→32 gras ; métriques 16/24/28 | compact + défaut (px n.p. ; ~32 n.v.) | 2 badge · 4 lozenge/tag/tooltip · **6 bouton/champ/nav** · 8 carte/menu · 12 modale/tableau · 16 · full | tokens raised / overlay (valeurs n.p.) ; « prefer whitespace or borders » ; carte plate = bordure | 1 px défaut, 2 px sélection | **2 px, +2 px dehors, rayon +2 px**, `color.border.focused` | n.p. | n.v. (240 px tiers) |
| **GitHub Primer** | body-medium **14/1.5**, small 12/1.625, caption 12/1.25 ; title 16/20/32 à 600 ; display 40/500 | **24 / 28 / 32 (défaut) / 40 / 48** | 3 · **6 (défaut)** · 12 · full | n.p. | neutre pas 7–8 (8 = min. contrôle interactif) ; texte pas 9–10 | token `focus-outlineColor` | n.p. (padding de contenu 16/24) | panes 16 px de padding ; largeur n.p. |
| **IBM Carbon** | body-compact-01 14/18, body-01 14/20, label 12/16, heading-01 14/600, heading-03 20/28 | n.v. (32 / 40 / 48 usuels) | n.v. (0 usuel) | n.p. (layers par couleur) | `border-subtle` ; sélection 4 px | `$focus` 2 px (n.v. largeur) | **xs 24 · sm 32 · md 40 · lg 48 · xl 64** ; padding 16 ; en-tête 14/600 | **256 px**, items 32 px, icône 16, label 14/600 |
| **Material 3** | body 16/24 · **14/20** · 12/16 ; label 14/12/11 à 500 ; title 22/16/14 | n.v. (40 dp usuel) | n.v. | n.p. | n.p. | state layer focus 10 % | n.p. | n.v. (360 dp drawer) |
| **Apple (iOS via Kennedy)** | 17 corps · 15 secondaire · 13 tertiaire · 34 grand titre · 10 min (tab bar) ; tracking −0,43 px à 17 | 44 pt cible (n.v. HIG ; AAA WCAG) | n.p. | n.p. | n.p. | n.p. | n.p. | n.p. |
| **Linear (2024)** | Inter Display titres, Inter texte ; LCH ; 3 variables (base, accent, contraste) | n.p. | n.p. | surfaces background → modals, pas d'ombres documentées | n.p. | n.p. | n.p. | « inverted L », alignement 2 axes, densité accrue |
| **Refactoring UI** | 12 / 14 / 16 / 18 / 20 / 24 / 30 / 36 / 48 / 60 ; corps ≥ 16 (lecture) ; 400/500/600/700 | padding H = 2 × V | 4 / 8 / 12 constant | carte `0 1px 3px .12, 0 1px 2px .08` ; menu `0 4px 6px .1, 0 2px 4px .06` ; modale `0 10px 20px .15, 0 3px 6px .1` | 1 px gray-200 ou plus clair, rare | — | — | — |
| **WCAG 2.2** | — | cible **24 × 24** (AA), 44 × 44 (AAA) | — | — | contrôle 3:1 | visible | — | — |

Légende : n.p. = non précisé dans les pages lues ; n.v. = valeur usuelle non vérifiée dans cette session.

### Convergences à retenir pour le skill
- **Texte d'interface : 14 px / 20 px**, secondaire 13 ou 12, lecture 16 ; titres de page 20–24 en 600, titres de section 16 en 600.
- **Contrôles : 32 px par défaut** (28 compact, 40 grand), rayon 6, bordure 1 px gray-200/300, focus 2 px de la couleur d'accent décalé de 2 px.
- **Tableaux : lignes 40 px** (32 compact), en-tête 14/600, texte 14/400 gris-900 → gris-1000 au survol, nombres à droite, « — » pour l'absence, pagination > 50.
- **Espacement : 4 / 8 / 12 / 16 / 24 / 32 / 48**, carte 16 de padding, 24 entre groupes de formulaire.
- **Profondeur : bordures 1 px ou fond adjacent ; une seule échelle d'ombres (carte sans ombre, menu `0 4px 6px -2px .2`, modale `0 8px 16px -4px .22`) ; aucune ombre sur fond sombre.**
- **Couleur : gris teintés de violet < 5 % de saturation, violet `#7C3AED` réservé aux actions/états/sélection, statuts en 5–6 sémantiques fond 100 + texte 800/900, jamais de dégradé.**
- **Motion : 150–250 ms ease-out sur transform/opacity, rien sur le clavier, reduced-motion.**
