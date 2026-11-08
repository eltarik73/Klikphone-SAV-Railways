# Conventions françaises d'interface et règles des créateurs design (52 pages lues)

Sources : DSFR (dépôt GouvernementFR/dsfr), RGAA 4.1.2, GOV.UK, OQLF, Microsoft French Style Guide, Canada.ca ; Erik Kennedy, Malewicz/Hype4, Dannaway (Practical UI), Refactoring UI, Vitaly Friedman, Cloud Four, Mizko. 8 novembre 2026.

## 3. Règles consolidées (par thème, avec source)

Format : **règle** — source. « Métier » = adapté à une application de gestion ; les sources entre crochets sont les miroirs/synthèses secondaires.

### 3.1 Typographie

1. Une seule famille sans-serif à grande hauteur d'x (≥ ~68 %), chiffres 0/O et I/l/1 distincts ; Plus Jakarta Sans convient si l'on varie tailles, graisses et espacement — Dannaway https://threadreaderapp.com/thread/1635652394951254017 ; Mizko https://www.thedesignership.com/blog/best-free-fonts-for-ui-design ; Bakaus https://www.impeccable.style/slop
2. Au plus 2 polices (serif + sans si une deuxième est voulue), choisir la police de corps d'abord — Kennedy https://www.learnui.design/blog/guide-pairing-fonts.html
3. Corps 16 px (14 px toléré en UI dense sur desktop), jamais moins de 12 px pour une mention ; champs ≥ 16 px sur mobile — Kennedy https://www.learnui.design/blog/mobile-desktop-website-font-size-guidelines.html ; DSFR typographie
4. Environ 4 tailles par produit, 2–3 par composant ; 3 tailles + 2 graisses suffisent pour un écran — Kennedy (tailles) ; Malewicz https://hype4.academy/articles/design/how-to-dark-mode ; [Refactoring UI]
5. Deux graisses (400 + 600/700), pas de 300 ni ≥ 800 — Dannaway ; [Refactoring UI]
6. Échelle de titres de référence (desktop/mobile) : 40/32, 32/28, 28/24, 24/22, 22/20, 20/18 px ; interlignage = taille + 8 px ; corps 16/24, détail 14/24, mention 12/20 — DSFR typographie
7. Interligne corps 1,5 (DSFR 24/16 = 1,5), titres 1,2–1,3, UI compacte 1,0–1,2 ; ne jamais empêcher un utilisateur de monter à 1,5 — Dannaway ; [Refactoring UI] ; RGAA 10.12
8. Longueur de ligne 45–75 caractères (desktop), 35–40 (mobile) — DSFR typographie ; Kennedy
9. Interlettrage des grands titres −1 % (≈ −0,01 à −0,02 em), jamais serré sur le corps ni sur petit écran — Kennedy partie 2 ; [Refactoring UI] ; Bakaus
10. Texte secondaire = corps − 2 px et ~70 % d'intensité ; hiérarchie par graisse et couleur avant la taille — Kennedy (tailles) ; [Refactoring UI]
11. Aligner à gauche, jamais justifier ; pas de capitales en corps de texte ; capitales réservées aux très courts libellés (badges) — Dannaway ; Bakaus ; DSFR badge
12. Un seul H1, hiérarchie sans saut, 4 niveaux max ; titre plus proche de son contenu que de la section précédente — DSFR typographie ; RGAA 9.1 ; Bakaus
13. `text-wrap: balance` sur les titres, `pretty` sur les paragraphes — Bakaus

### 3.2 Espacement et mise en page

14. Grille de 4 px, échelle 4, 8, 12, 16, 24, 32, 48, 64, 96 (DSFR : pas de 4 jusqu'à 128) — DSFR espacement ; Malewicz ; [Refactoring UI]
15. Espacement faible = lié, espacement fort = indépendant ; un titre a plus d'espace au-dessus qu'en dessous — DSFR espacement ; Bakaus
16. Quand on hésite, doubler l'espace blanc : entrée de menu = 2 × hauteur du texte ; 48 px avant un appel à l'action — Kennedy partie 1 ; Malewicz
17. Marge basse 24 px après un titre ou un paragraphe — DSFR espacement
18. Contenu de lecture limité à 8 colonnes / ~1200 px ; gouttières 16 px (mobile) et 24 px (desktop) — DSFR typographie ; [open-design]
19. Points de rupture : 576 / 768 / 992 / 1248 px ; aucune barre de défilement horizontale à 320 px — [open-design] ; RGAA 10.11
20. Pas d'espacement monotone : varier les écarts pour exprimer les groupes ; éviter les cartes imbriquées, aplatir avec espace et séparateurs — Bakaus
21. Une seule asymétrie volontaire par écran, pas des grilles de cartes identiques — 21st.dev ; Bakaus

### 3.3 Couleur

22. Concevoir en niveaux de gris, ajouter la couleur en dernier et avec un rôle — Kennedy partie 1
23. Répartition ~60 % neutre / ~30 % secondaire / ~10 % accent vif réservé aux actions — Malewicz https://hype4.academy/articles/design/60-30-10-rule-in-ui
24. Une couleur « interactive » réservée aux liens et boutons ; jamais sur les titres — Dannaway ; DSFR typographie
25. Variantes en HSB : plus foncé = +saturation −luminosité, plus clair = −saturation +luminosité, teinte quasi fixe — Kennedy couleur
26. Palette écrite à la main : 9 nuances (100–900) par couleur, 8–10 gris, pas de `lighten/darken` — Refactoring UI https://www.refactoringui.com/previews/building-your-color-palette
27. Pas de noir pur ni de gris pur : gris teintés dérivés de la couleur de marque — Dannaway ; Refactoring UI ; Malewicz ombres ; Bakaus
28. Couleurs système réservées aux états (succès/erreur/info/avertissement), jamais détournées pour décorer ; couleurs d'accent limitées (1–2 couleurs de tags par page, < 5 teintes par illustration) — DSFR couleurs ; DSFR tag
29. Jamais d'information par la couleur seule : texte, icône ou forme en plus — RGAA 3.1 ; DSFR couleurs ; Dannaway ; Friedman erreurs
30. Pas de texte gris sur fond coloré : prendre une teinte plus foncée du fond ou du texte clair — Bakaus ; [Refactoring UI]
31. Éviter la palette « IA » : violet Tailwind par défaut + dégradé violet→bleu, cyan sur sombre, texte en dégradé, halos — Bakaus ; 21st.dev
32. Mode sombre / barre latérale sombre : pas de couleurs sursaturées ; élévation par fond plus clair (grey-50 → 75 → 100) ; ombres à 32 % au lieu de 16 % — Malewicz 60-30-10 et dark mode ; DSFR élévation

### 3.4 Profondeur, ombres, bordures, rayons

33. Lumière du haut : ombres décalées vers le bas (Y > 0), jamais X seul — Kennedy partie 1 ; Malewicz ombres
34. Trois niveaux d'ombre suffisent : 0 2 6 (cartes), 0 4 12 (menus), 0 6 18 (modales), couleur bleu-noir teintée à 16 % (32 % en sombre) ; empiler deux ombres douces plutôt qu'une dure — DSFR élévation ; Malewicz ombres ; [Refactoring UI]
35. Ombre **ou** bordure fine, pas les deux ; bordures avec parcimonie (préférer fond ou espacement) ; bordure semi-transparente plus légère qu'une opaque — Bakaus ; [Refactoring UI] ; Kennedy 37 ways
36. Rayons modérés et imbriqués : rayon interne = rayon externe − padding (borné à 0) ; pas de 44 px sur une petite carte ; plein arrondi réservé aux avatars, pastilles, badges — Cloud Four https://cloudfour.com/thinks/the-math-behind-nesting-rounded-corners/ ; Bakaus
37. Ombre interne uniquement pour les champs, cases et radios, avec modération ; pas de neumorphisme — Malewicz ombres
38. Pas de glassmorphisme, de bordure en dégradé ni de bordure colorée épaisse sur carte arrondie — Bakaus ; Kennedy 37 ways

### 3.5 Composants

39. Boutons : un seul primaire par vue ; une seule taille par page ; groupe ≤ 3 boutons, même taille, 16 px d'écart ; primaire en premier si le groupe est à gauche/centré, en dernier s'il est à droite — DSFR bouton
40. Pas de bouton désactivé par défaut : cliquable, validation à l'envoi, erreurs comptées et ciblées ; si désactivation, `aria-disabled` + explication — Friedman boutons ; DSFR bouton
41. Pendant un traitement : libellé « Enregistrement… » + indicateur, bloquer le double envoi — Friedman boutons
42. Icône jamais seule : libellé visible ou `title` + texte masqué ; un concept = une icône ; trait 2 pt, un seul style ; tailles 16/24/32 px calées sur le texte — DSFR icônes ; Dannaway
43. Badge = statut informatif, non cliquable, libellé court en capitales, 5 couleurs système à icône imposée ; Tag = classement/filtre, cliquable ou supprimable ; ne pas mélanger les deux rôles — DSFR badge ; DSFR tag
44. Alerte : icône + titre (ou description), couleur liée au type, fermeture optionnelle ; les erreurs ne vont pas dans des toasts — DSFR alerte ; Friedman erreurs
45. Filtres : 7–10 options visibles puis accordéon, chips des filtres actifs au-dessus des résultats, « Tout réinitialiser », compteur de résultats, mise à jour asynchrone sans décalage, options vides désactivées et expliquées — Friedman filtres
46. Pagination par défaut ; « charger plus » seulement pour de l'exploration (10/30 éléments, bascule entre 30 et 70) ; page active en bouton primaire, précédent/suivant désactivés aux extrémités, numéros masqués sur mobile — Friedman infinite scroll ; DSFR pagination
47. Onglets : titres concis, onglet courant souligné, ≤ 8 colonnes de large ; fil d'Ariane utile dès 3–4 niveaux, chevrons, page courante non cliquable, parent jamais tronqué — DSFR onglets ; DSFR fil d'Ariane ; Friedman breadcrumbs
48. Menu latéral : 3 niveaux max, élément actif par bordure de couleur primaire, repliable sur mobile derrière un bouton ; en-tête : ≤ 3 accès rapides — DSFR menu latéral ; DSFR en-tête
49. Cartes : une police, 1–3 tailles, un seul point focal, multiples de 8, pas d'icône dans une tuile au-dessus du titre, pas de badge décoratif au-dessus du titre principal — Moucka/Hype4 ; Bakaus
50. Libellés de données : « libellé : valeur » en dernier recours ; fusionner (« 12 en stock ») ou laisser le format parler (prix, e-mail) ; libellé secondaire quand il faut comparer (KPI) — Refactoring UI labels
51. Métriques « héros » sans contexte interdites : comparer, dater, expliquer — Bakaus ; 21st.dev
52. Mouvement : pas de point pulsant sans activité réelle, pas de rebond, pas de défilement automatique ; respecter `prefers-reduced-motion` — Bakaus

### 3.6 Formulaires

53. Libellé visible au-dessus du champ (ou à gauche), accolé, jamais remplacé par un placeholder ; cases et radios : libellé à droite — RGAA 11.4 ; DSFR champ ; GOV.UK
54. Texte d'aide sous le libellé, une phrase courte sans point, format attendu et exemple **avant** la validation — GOV.UK ; RGAA 11.10 ; DSFR champ
55. Obligatoire par défaut : phrase d'introduction + « (optionnel) » sur les exceptions ; pas d'astérisques — GOV.UK ; DSFR champ (mention au début + `required`)
56. Largeur du champ proportionnée au contenu attendu (code postal étroit, e-mail large) — DSFR champ
57. Validation à la sortie du champ, jamais au focus d'un champ vide ; erreur corrigée effacée immédiatement ; champs vides vérifiés à la soumission — Friedman validation
58. Message d'erreur : icône + barre colorée + texte identifiant le champ, relié par `aria-describedby`, avec exemple de valeur ; placé sous le champ (DSFR) de façon constante ; focus sur le premier champ en erreur ; résumé au-dessus du bouton ou en haut si rechargement — DSFR champ ; Friedman erreurs ; RGAA 11.10–11.11
59. Rédaction des erreurs : phrase affirmative, point final, pas de « veuillez », « désolé », « oups », « invalide » ; dire quoi faire (« Le mot de passe est incorrect, réessayez. ») — Friedman erreurs ; Microsoft §5.5.1
60. Regrouper les champs liés en `fieldset`/`legend` ; `autocomplete` sur les données personnelles ; jamais bloquer le copier-coller ; accepter les formats non ambigus — RGAA 11.5–11.13 ; Friedman validation
61. Confirmer les actions destructives ; préférer « annuler » (undo) quand c'est possible — Friedman erreurs
62. Ne pas désactiver un champ : le masquer s'il n'est pas requis — DSFR champ

### 3.7 Tableaux

63. `caption` (titre) obligatoire, en-têtes `th` avec `scope`, tri par colonne dans l'en-tête — DSFR tableau ; RGAA 5.4–5.7 ; Bece
64. Bordures horizontales seulement ; verticales uniquement pour un tableau complexe ; zébrage possible mais pas cumulé avec des bordures lourdes — DSFR tableau ; Bece
65. Trois densités (SM/MD/LG), cellules à largeur de contenu, colonne de sélection figée à gauche, en-tête collant avec fond opaque — DSFR tableau ; Bece
66. Barre haute : lignes sélectionnées, recherche, actions ; barre basse : total, lignes par page, pagination — DSFR tableau
67. Défilement horizontal : conteneur `overflow:auto` focusable (`tabindex="0"`), ombres de bord ; informations clés dans les premières colonnes — Bece ; DSFR tableau
68. Sur mobile : colonne principale + accordéon, ou colonnes masquables ; l'empilement n'est acceptable que pour des données non comparables — Bece
69. En-tête d'une colonne numérique porte l'unité (« Montant TTC (€) »), zéro plutôt que vide, un tableau complexe se découpe — Canada.ca
70. Montants et dates en chiffres tabulaires alignés à droite (`font-variant-numeric: tabular-nums`) — pratique courante non trouvée telle quelle dans les pages lues ; cohérente avec « alignement vertical et horizontal correct » de Bece (à vérifier : Plus Jakarta Sans expose-t-elle la fonctionnalité `tnum` ?)

### 3.8 Rédaction d'interface en français

71. Vouvoiement constant, au masculin singulier ; jamais « on » ; s'adresser à la personne (« Vous pouvez… ») — Microsoft §4.1.13
72. Boutons et commandes : verbe à l'**infinitif** en tête, majuscule initiale seule, 1 à 3 mots, sans point (« Enregistrer », « Prévenir le client », « Imprimer le ticket ») ; les titres de tâches aussi à l'infinitif — Blender ; Canada.ca ; Debian
73. Casse de phrase partout : pas de Majuscule À Chaque Mot (anglicisme), pas de MAJUSCULES sauf badges courts et sigles — Microsoft §4.1.5 ; Canada.ca ; Blender
74. Phrases < 20 mots, voix active, forme positive, présent ; une idée par phrase ; pas de point-virgule ; pas de « ! » — Canada.ca ; Microsoft §4.1.14
75. Mots pleins et courants : « application », « informations », « téléphone » ; bannir « il faut », « il y a », « avoir la possibilité de », « nécessiter » — Microsoft §2.1
76. Pas de point d'interrogation sauf vraie question posée à l'utilisateur ; pas de tiret cadratin (point, virgule ou parenthèses) — Canada.ca ; Microsoft §4.1.14
77. Listes : ≤ 7 éléments, structure homogène (que des infinitifs ou que des noms), majuscule initiale, pas de ponctuation finale pour des fragments — Canada.ca ; Microsoft §4.1.14
78. Liens : texte descriptif de la destination, jamais « cliquez ici » ; même texte = même cible ; soulignement réservé aux liens — Canada.ca ; RGAA 6.1
79. Erreurs : affirmatives, factuelles, avec l'action à faire ; formules standard « Impossible de… », « … introuvable », « … n'est pas disponible. » ; point final ; pas de parenthèses — Microsoft §5.5.1 ; Friedman erreurs
80. Écriture épicène plutôt que point médian : « la clientèle », « l'équipe », « la personne », pluriels ; les deux formes seulement si nécessaire (« tous et toutes ») — Microsoft §3.1
81. États vides et confirmations : courts, à la voix active, qui disent la prochaine action (« Tout est prêt. », « Aucun ticket en attente. Créer un ticket ») — Microsoft §2.2.1 ; Canada.ca (liens orientés tâche)
82. Première mention d'un sigle en toutes lettres, puis sigle seul ; sigles sans points (SAV, HT, TTC, SMS) — Canada.ca ; Microsoft §4.1.2

### 3.9 Typographie française à l'écran

83. Espace insécable (U+00A0) avant « : », à l'intérieur de « … », avant % et € ; espace fine insécable (U+202F) avant « ; ? ! » (l'insécable simple est l'usage courant toléré) — Wikipédia espace insécable ; OQLF ; Debian
84. Nombres : milliers par espace insécable fine, virgule décimale, symbole après : « 12 345,60 € », « 1 250 € HT », « 20 % » ; jamais « 785 € 60 » ni « 12,345.60 » — Wikipédia conventions ; OQLF ; Canada.ca
85. Numéros d'ordre sans séparateur de milliers : ticket 10452, code postal 73000, année 2026 — Wikipédia conventions
86. Heures « 14 h 30 », « 9 h », « de 9 h à 19 h » ; pas de « 14h30 » ni « 14:30 » dans le texte (le « 13:52 » collé reste admis dans un affichage strictement numérique/horloge) — Wikipédia conventions ; OQLF ; Canada.ca
87. Dates : « 8 novembre 2026 », abrégée « 8 nov. 2026 » (janv., févr., mars, avr., mai, juin, juil./juill., août, sept., oct., nov., déc.), jour et mois en minuscule ; numérique « 2026-11-08 » seulement faute de place ; espace insécable entre jour et mois — OQLF mois ; Canada.ca
88. Ordinaux « 1er, 1re, 2e » (exposant), jamais « 2ème » ; « n° » toléré à l'écran (forme savante nᵒ), « nos » au pluriel ; « M. », « Mme », « etc. » avec virgule avant — Wikipédia conventions ; Microsoft §4.1.1
89. Guillemets français « » avec insécables ; apostrophe courbe ’ ; capitales accentuées (« À traiter », « État ») — Wikipédia conventions ; Microsoft §4.1.14 ; Debian
90. Unités avec insécable et symbole invariable : « 2 Go », « 200 Mo », « 37 °C », « 45° » (le degré d'angle collé) — Wikipédia ; OQLF ; Microsoft §4.1.1
91. k€/M€ uniquement dans les tableaux et graphiques (« 22,3 k€ ») — Wikipédia conventions
92. Point final jamais dans les libellés, titres, info-bulles courtes, en-têtes de tableau, éléments de liste-fragments ; toujours dans les messages d'erreur et phrases complètes — Canada.ca ; Blender ; Microsoft §5.5.1
93. Mise en œuvre : `Intl.NumberFormat('fr-FR', {style:'currency', currency:'EUR'})` et `Intl.DateTimeFormat('fr-FR', {day:'numeric', month:'short', year:'numeric'})` produisent déjà U+202F/U+00A0, « 12 345,60 € » et « 8 nov. 2026 » ; ne pas reconstruire ces chaînes à la main (note technique, hors sources)

### 3.10 Accessibilité (RGAA 4.1.2 / WCAG 2.1 AA)

94. Contraste texte 4,5:1 (< 24 px ou gras < 18,5 px), 3:1 au-delà ; 3:1 pour bordures de champs, icônes, états de boutons — RGAA 3.2–3.3 ; Dannaway
95. Focus toujours visible (anneau 2 px contrasté, ex. `#0A76F6` DSFR) ; ordre de tabulation logique — RGAA 10.7 ; [ui-skills DSFR]
96. Texte lisible à 200 % et avec interligne 1,5 / espacement de mots 0,16 em imposés par l'utilisateur ; pas de hauteur fixe qui coupe le texte — RGAA 10.4, 10.12
97. Aucun défilement horizontal à 320 px ; cibles tactiles confortables (le DSFR élargit le padding des tags SM sur mobile) — RGAA 10.11 ; DSFR tag
98. Tout contenu au survol (info-bulle) accessible au focus et au clavier ; info-bulle d'erreur affichée au clic/toucher, jamais recouvrant la saisie — RGAA 10.14 ; Friedman erreurs
99. Intitulés de liens et de boutons explicites ; nom accessible contenant l'intitulé visible ; icônes `aria-hidden` quand un libellé existe — RGAA 6.1, 11.9 ; DSFR icônes
100. Limite de session ≥ 20 h ou prolongeable avec avertissement 20 s avant (pertinent pour une appli de comptoir ouverte toute la journée) — RGAA 13.1
101. Régions live (`role="status"`) pour les confirmations et les nouveaux éléments chargés ; ne pas annoncer ce qui est purement décoratif — DSFR formulaire ; Friedman infinite scroll

---

## 4. Modes vs fondamentaux

| Modes (à éviter ou à doser dans une appli métier) | Fondamentaux (toujours valables) |
|---|---|
| Dégradés violet→bleu, texte en dégradé, halos radiaux, accents néon (Bakaus ; 21st.dev) | Une couleur d'accent vive réservée aux actions, 60-30-10, neutres teintés (Malewicz ; Kennedy ; Refactoring UI) |
| Glassmorphisme, flous d'arrière-plan décoratifs (Bakaus ; Malewicz « background blur ») | Trois niveaux d'élévation simples, ombres teintées décalées vers le bas (DSFR ; Malewicz ; Kennedy) |
| Neumorphisme, ombres internes partout (Malewicz) | Ombres internes réservées aux champs/cases, états contrastés 3:1 (Malewicz ; RGAA) |
| Néo-brutalisme : ombres pleines décalées, bordures épaisses noires, polices display (Kennedy 37 ways n° 19 « mixte ») | Bordure fine ou ombre, pas les deux ; rayons modérés et concentriques (Bakaus ; Cloud Four) |
| Claymorphisme / 3D, illustrations génériques, emoji en guise d'icônes (Malewicz claymorphism ; Bakaus) | Une bibliothèque d'icônes au trait 2 pt, toujours avec libellé (Dannaway ; DSFR) |
| Hero + 3 cartes identiques, icônes dans des tuiles arrondies, badge décoratif au-dessus du titre, numéros 01/02/03 (Bakaus ; 21st.dev) | Hiérarchie par graisse/couleur/espacement, une asymétrie volontaire, libellés fusionnés avec leurs valeurs (Refactoring UI ; 21st.dev) |
| Titres serif italiques « premium », Inter/Geist par réflexe, interlettrage très serré (Bakaus) | 1–2 polices, grande hauteur d'x, 4 tailles, 2 graisses, interligne 1,5, 45–75 caractères (Kennedy ; Dannaway ; DSFR ; Mizko) |
| Défilement infini, points qui pulsent, rebonds, marquees (Friedman ; Bakaus) | Pagination par défaut, mouvements sobres, `prefers-reduced-motion` (Friedman ; Bakaus) |
| Toasts pour les erreurs, validation « en direct » agressive, boutons grisés tant que le formulaire n'est pas parfait (Friedman) | Erreurs reliées au champ, validation au blur, bouton cliquable qui explique (Friedman ; DSFR ; RGAA) |
| Mode sombre total par style (Malewicz : sursaturation, fatigue) | Thème sombre maîtrisé : élévation par luminosité, couleurs désaturées, jetons de décision (DSFR ; Malewicz) |
| Copie marketing générique (« transformez votre flux de travail »), métriques héros (21st.dev ; Bakaus) | Texte spécifique, chiffres réels, verbes d'action à l'infinitif, vouvoiement (Canada.ca ; Microsoft ; Blender) |
| Anglicismes typographiques : Title Case, « 14:30 », « 12,345.60 », guillemets droits, « ! » (Microsoft ; Canada.ca ; Debian) | Casse de phrase, « 14 h 30 », « 12 345,60 € », « », capitales accentuées, insécables (OQLF ; Wikipédia ; Imprimerie nationale via Wikipédia) |

Règle de lecture : une « mode » devient acceptable quand elle porte une information (une ombre « superposée » sur un menu, une couleur sur un tag qui distingue un type de support) ; elle est à proscrire quand elle décore.

---

## 5. Application immédiate à Klikphone SAV (pistes tirées des sources)

- **Violet** : `#7C3AED` = `violet-600` Tailwind ; décaler légèrement (HSB : teinte, −saturation sur les variantes claires, +saturation sur les foncées) et dériver `brand-50…950` à la main (9 nuances), plus des gris teintés de violet pour fond/bordures/texte (Kennedy ; Refactoring UI ; Bakaus). Réserver le violet aux actions et à l'élément actif du menu, jamais aux titres (DSFR).
- **Barre latérale sombre `#0F172A`** : élévation par fond plus clair pour l'élément survolé/actif plutôt que par ombres ; libellés désaturés ; bordure de 2–3 px de la couleur primaire sur l'entrée active (DSFR menu latéral ; Malewicz).
- **8 statuts de ticket** : badges non cliquables, libellé court en capitales ou en casse de phrase mais toujours avec le texte complet au survol ; au plus 5 couleurs système (information = diagnostic/attente, avertissement = attente d'accord/pièce, succès = terminé/rendu, neutre = clôturé) + icône, jamais 8 teintes décoratives (DSFR badge ; RGAA 3.1).
- **Tableaux de tickets** : `caption` masquée, en-tête collant, bordures horizontales seules, densité SM pour le comptoir, montants en chiffres tabulaires alignés à droite avec l'unité dans l'en-tête, colonne « n° / client / appareil » en premier, pagination (pas de défilement infini), filtres actifs en chips au-dessus (DSFR ; Bece ; Friedman ; Canada.ca).
- **Formulaires client / ticket** : libellé au-dessus, aide en une phrase sans point, « (optionnel) » plutôt qu'astérisques, validation au blur, message sous le champ avec exemple (« Format attendu : 06 12 34 56 78 »), bouton « Enregistrer » toujours actif, « Enregistrement… » pendant l'appel (DSFR ; GOV.UK ; Friedman).
- **Textes** : vouvoiement, infinitif sur les boutons (« Prévenir le client », « Imprimer le reçu », « Clôturer le ticket »), casse de phrase, « 8 nov. 2026 », « 14 h 30 », « 149,00 € TTC », espaces insécables via `Intl` (Microsoft ; Canada.ca ; OQLF).
- **Ce qui « fait IA » à surveiller dans le code actuel** : dégradés de marque, cartes KPI identiques en rangée de 3–4 avec icône dans une tuile arrondie, ombres `shadow-lg` + bordure, `rounded-2xl` sur de petits éléments, gris `slate` par défaut, points de statut animés (Bakaus ; 21st.dev).

---

