# Typographie, couleur, icônes — décisions détaillées et sources

62 pages lues le 8 novembre 2026, complétées par des mesures locales : ratios WCAG calculés sur les hex Tailwind v3, formats `Intl` fr-FR vérifiés sous Node, tables OpenType (`tnum`) lues dans Plus Jakarta Sans, Geist et Instrument Serif. La section 4 donne des tokens prêts pour Tailwind 3.4. Là où ce document propose 6 teintes de statut (teal, violet…), `SKILL.md` retient la variante à 4 teintes sémantiques (slate / bleu / ambre / émeraude + rouge pour le retard) : la règle « la couleur porte un sens » prime ; les deux options sont documentées ici.

## 1. Typographie

### 1.1 Ce que font les produits de référence (2024–2026)

| Produit | Police(s) | Degré de certitude | Source |
|---|---|---|---|
| Linear | **Inter** pour tout le texte, **Inter Display** pour les titres (« kept using regular Inter for the rest of the text elements ») | Élevé (billet officiel) | https://linear.app/blog/how-we-redesigned-the-linear-ui — confirmé par l'audit tiers « the primary web font is Inter » https://www.stfo.io/research/audits/linear/ |
| Vercel | **Geist Sans / Geist Mono**, créée par Vercel avec Basement Studio, OFL 1.1, 9 graisses, « inspiration suisse » | Élevé | https://vercel.com/font ; https://github.com/vercel/geist-font (influences citées : Inter, Univers, Suisse International, SF Pro) |
| Stripe | **Söhne** (Klim Type Foundry, 2020) sur stripe.com : logo, navigation, titres, boutons, corps ; Source Code Pro pour le code. Dashboard : affirmé mais non démontré | Élevé pour le site, faible pour le dashboard | https://fontalternatives.com/inspiration/stripe-sohne/ |
| Figma | **Figma Sans** (Grilli Type, sept. 2024), remplace Whyte ; variantes Text / Display / Condensed / Mono, variable (graisse, largeur, taille optique) | Élevé (billet officiel) | https://www.figma.com/blog/the-story-of-creating-figma-sans/ |
| Shopify (admin) | Polaris v12 (2023) : « style uplift », nouveaux tokens et **nouvelle police web, Inter** | Élevé | https://shopify.dev/changelog/polaris-v12-beta-now-available-1 |
| Attio | Inter (UI, graisse 500 par défaut, `ss03`), Inter Display (titres marketing), Tiempos Text (citations) ; mesures « normalisées » et rôles « interprétés » par Refero | Moyen (tiers) | https://styles.refero.design/style/08c8700c-f278-42bc-812e-f60dc6ce996e |
| Raycast | Inter (+ SF Pro pour quelques éléments macOS) | Faible (résumé tiers) | https://design-gallery.pages.dev/design/raycast |
| Mercury | Police maison « Arcadia » affirmée sans source vérifiable ; palette « dark-first » | Faible (tiers, non vérifiable) | https://blakecrosley.com/guides/design/mercury |
| Notion | Pile système (SF / Segoe UI / Roboto) | Faible (blogs, pas de doc officielle) | https://madegooddesigns.com/?p=7570 |
| Cal.com | **Cal Sans** pour les titres (commande de Cal.com à WORDMARK, OFL 1.1) ; police de corps non confirmée | Élevé pour Cal Sans | https://github.com/calcom/font |
| Qonto (FR) | **PolySans** (rebranding Koto, 2022) : « simple, versatile, utilitarian and able to work at both small sizes in the Qonto app and larger sizes » | Moyen (extrait du billet Qonto Way ; page non lisible en direct, 403) | https://medium.com/qonto-way/forging-a-new-identity-for-the-qonto-brand-762852d3ec41 |
| Alan (FR) | **Alan Sans**, police maison open source (OFL 1.1, v1 du 16 sept. 2025), « a "not so corporate" corporate typeface », 7 graisses, pensée UI + marketing | Élevé | https://github.com/alan-eu/Alan-Sans |
| Pennylane, Framer, Resend, Dub, Midday, Cron, Superhuman, Arc | Aucune source fiable trouvée | Non vérifié | — |

Ce qu'il faut en retenir :

1. Aucune référence n'utilise une police « décorative » dans son produit : toutes sont des grotesques neutres
   (Inter, Geist, Söhne, Figma Sans, PolySans). Le caractère vient des **réglages** (taille optique pour les titres,
   graisses mesurées, chiffres tabulaires, interlignes) et des détails, pas de la famille.
2. Les plus matures finissent par commander une police maison (Figma, Alan, Cal.com, Mercury) : hors de portée ici,
   mais l'intention est la même — une grotesque sobre, pas une géométrique « amicale ».
3. Linear et Attio utilisent la **version Display** de leur police pour les titres : la taille optique est le
   levier d'expression, pas la graisse 800.

### 1.2 Plus Jakarta Sans : « look IA / template » ?

Faits sur la police : dessinée par Gumpita Rahayu (Tokotype) pour le programme « +Jakarta City of Collaboration »
du gouvernement provincial, v1 du 21 février 2020, licence OFL 1.1, axe variable `wght` uniquement
(https://github.com/tokotype/PlusJakartaSans). Table OpenType lue dans le fichier `PlusJakartaSans[wght].ttf`
(dépôt Google Fonts) : `tnum`, `pnum`, `case`, `ss01–ss03`, `frac`, `ordn` — donc les chiffres tabulaires **existent**.

Ce que disent les articles sur les « tells » du design IA (2025–2026) :

- Le marqueur typographique nommé partout est **Inter** « utilisée partout, sans décision » — et seulement elle
  (https://www.925studios.co/blog/ai-slop-design-tells) ; « Inter or Roboto type »
  (https://superdesign.dev/blog/why-ai-design-looks-generic) ; « Inter associée à une police système »
  (https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c) ; liste à
  éviter « Inter, Roboto, Arial, Open Sans, Lato, polices système », Space Grotesk devenu lui aussi un défaut
  (https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website).
- **Plus Jakarta Sans n'est citée par aucune de ces sources** comme marqueur IA. Elle apparaît en revanche dans les
  annuaires de sites SaaS et templates, souvent associée à Inter et Geist (https://maxibestof.one/typefaces/plus-jakarta-sans),
  et un guide la propose comme alternative à Inter « pour ne pas paraître générique »
  (https://buildwithangga.com/tips/tips-claude-design-biar-hasil-desainmu-nggak-terlihat-generik-di-2026).
- Les autres tells cités, à retenir pour l'app : dégradé indigo → violet hérité de `bg-indigo-500` de Tailwind UI
  (https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website) ; accents `indigo-500 #6366F1`,
  `violet-500 #8B5CF6`, `purple-500 #A855F7`, rangée de trois cartes avec petite icône, badge au-dessus du titre, carte à
  **bordure gauche colorée**, glassmorphism (https://superdesign.dev/blog/why-ai-design-looks-generic) ; **même rayon
  16 px et même padding 24 px partout** qui aplatissent la page (https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c) ;
  icônes « thin-line » génériques (https://www.925studios.co/blog/ai-slop-design-tells).

Verdict (jugement appuyé sur ces sources) : Plus Jakarta Sans n'est pas un marqueur « IA » mais un marqueur
« template SaaS 2021–2024 » — géométrique, large, ronde, surtout en 700/800 sur les titres avec l'interlettrage par
défaut. Dans un back-office dense elle coûte de la largeur de colonne (formes rondes, chasse large) et son dessin n'est
pas optimisé pour 13 px comme Inter/Geist (polices nées pour l'écran : https://www.typewolf.com/inter décrit Inter
comme « conçue pour les écrans, grande hauteur d'x »). Le vrai tell de l'app actuelle est ailleurs : la marque
`#7C3AED` est exactement `violet-600`, et l'italique serif d'accent (voir 1.3 c).

### 1.3 Trois options argumentées

**(a) Garder Plus Jakarta Sans, mieux réglée** — coût nul, gain réel.
- Graisses 400 (corps), 500 (libellés, nav, boutons), 600 (titres) ; **jamais 700/800** dans l'UI (les échelles
  « productives » de Carbon n'utilisent que 400 et 600 : https://carbondesignsystem.com/elements/typography/type-sets/ ;
  Attio : 500 par défaut, 600 pour les titres).
- Titres ≥ 20 px : `tracking-tight` (−0,025 em) ou −0,015 em ; corps 0 ; overlines en capitales +0,06 em (valeur
  mesurée chez Attio pour les « eyebrows » 12 px).
- `tabular-nums` sur prix, dates, compteurs, numéros (la police le supporte).
- Charger 400..600 au lieu de 400..800 (poids inutiles).
- Limite : la police reste large et « amicale » ; le gain de sobriété est partiel.

**(b) Une grotesque libre plus sobre** — licence, rendu dense, exposition :

| Police | Licence | Rendu en back-office dense (13–14 px) | Exposition / risque « déjà vu » |
|---|---|---|---|
| **Inter Variable (v4)** | OFL 1.1 ; axe de taille optique text → display, `tnum`, `zero`, `case`, `cv11`, `ss01` (https://rsms.me/inter/) | Référence absolue pour l'UI dense (Linear, Raycast, Attio, Shopify Polaris v12) ; formule d'interlettrage dynamique publiée : −0,011 em à 16 px, −0,017 à 20, −0,0195 à 24 (https://d.rsms.me/inter-website/v3/dynmetrics/) | La plus vue ; seule police nommée comme « tell IA » — mais par des articles qui parlent de landing pages. Bien réglée (Display pour les titres, tabulaires, 500/600), elle lit « Linear », pas « IA ». |
| **Geist Sans** | OFL 1.1 (https://vercel.com/font) ; table lue dans `Geist[wght].ttf` : `tnum`, `case`, `ss01–ss11`, `frac` | Dessinée pour les interfaces, 9 graisses, un peu plus de caractère (terminaisons droites) | Devenue la police par défaut de l'écosystème Next.js / Vercel : look « outil dev » reconnaissable. |
| **IBM Plex Sans** | OFL 1.1 (https://github.com/IBM/plex) | Très lisible en petit, chiffres clairs, famille complète (Sans, Mono, Condensed) | Identité IBM forte ; la plus singulière des sobres. |
| **Source Sans 3** | OFL (Google Fonts : https://fonts.google.com/faq) | La plus étroite : excellente pour les tableaux | Un peu datée ; rendu plus « administratif ». |
| Public Sans, Hanken Grotesk, Onest, Schibsted Grotesk, Instrument Sans | OFL (Google Fonts) | Correctes ; Instrument Sans est la sœur d'Instrument Serif | Peu vues, mais moins abouties en hinting et en jeux de chiffres que les trois premières. |
| Figtree | OFL | Géométrique amicale | Trop proche de Plus Jakarta Sans : aucun gain. |
| **Switzer / Satoshi** (Fontshare) | ITF Free Font License : « 100 % free for personal and commercial use », mais **pas open source**, EULA ITF, kits hors ligne Web + Desktop fournis (https://www.indiantypefoundry.com/news/introducing-fontshare) ; redistribution interdite | Switzer = helvétique neutre, Satoshi = géométrique | Satoshi est le « Plus Jakarta Sans de Fontshare » (templates 2023–2024) ; Switzer est plus discret mais la licence impose l'auto-hébergement depuis le kit Fontshare, sans redistribution. |
| Bricolage Grotesque | OFL | Accent seulement (titres) | Trop expressive pour un outil métier. |

**(c) Une paire avec serif d'accent (Instrument Serif italique)** — déconseillé dans l'outil métier :
- Instrument Serif est décrite comme passée « du clin d'œil DTC Instagram » au « rendu par défaut des sites
  vibe-codés » (https://bubbles.town/entry/15233200) ; un développeur rapporte que les agents de code « (surtout Claude
  Code) la choisissent très souvent par défaut » (https://reddit.sentinel-team.org/posts/1tn1evo/snapshots/2026-05-25T21%3A17%3A46.401882Z) ;
  Creative Bloq relaie « Let's move on from Instrument Serif » (15 sept. 2025) et des designers qui la trouvent
  « lazy » (https://www.creativebloq.com/design/fonts-typography/serif-fonts-are-back-in-fashion-and-i-couldnt-be-happier) ;
  un guide de style la bannit en titre et qualifie « le mot en italique dans un titre droit » de tell IA fiable
  (https://instagit.com/Nutlope/hallmark/what-is-hallmarks-2-plus-1-font-rule-and-why-are-italic-headers-banned/).
- Le serif est devenu le code visuel des marques IA pour « paraître humaines et dignes de confiance »
  (https://www.monotype.com/company/thought-leadership/why-ai-brands-are-obsessed-serif-fonts ;
  https://keyavadgama.substack.com/p/the-serif-renaissance-in-ai-branding). C'est un registre marketing 2025, pas un
  registre d'outil utilisé 8 h par jour. Attio ne l'emploie que pour des citations clients, jamais dans le produit.
- Le fichier `InstrumentSerif-Italic.ttf` n'a ni `tnum` ni chiffres alternatifs (table lue) : inutilisable pour
  les montants.

**Recommandation** : option (b) avec **Inter Variable** comme famille unique (titres via la taille optique,
corps 400/500, titres 600), `tnum` partout où il y a des nombres, Instrument Serif retirée de l'app. Plan B si le
gérant « reconnaît Inter » : **Geist Sans** avec exactement les mêmes réglages. Plan C, si l'on veut une
singularité : IBM Plex Sans. Dans tous les cas, ce sont les réglages (1.4) qui font la différence, pas la famille :
les articles « anti-slop » convergent sur « l'absence de décision », pas sur une police en particulier.

### 1.4 Échelle concrète pour un back-office

Sources d'appui : échelle productive Carbon (label 12/16, body-compact 14/18, heading-compact 14/18 600,
heading-03 20/28, letter-spacing 0,32 px à 12 px et 0,16 px à 14 px : https://carbondesignsystem.com/elements/typography/type-sets/) ;
système Geist (tailles 12/13/14/16/20/24/32, `text-label-13` « avec chiffres tabulaires pour un espacement constant » :
https://vercel.com/geist/text) ; défauts Tailwind (xs 12/16, sm 14/20, base 16/24, xl 20/28, 2xl 24/32 :
https://v3.tailwindcss.com/docs/font-size ; `tracking-tight` −0,025 em, `tracking-wide` +0,025 em, `tracking-wider`
+0,05 em : https://v3.tailwindcss.com/docs/letter-spacing) ; métriques dynamiques d'Inter (tracking ≈ +0,0005 em à
12 px, −0,006 à 14, −0,011 à 16, −0,017 à 20, −0,0195 à 24, −0,022 à 32 : https://d.rsms.me/inter-website/v3/dynmetrics/).

| Rôle | Taille / interligne | Graisse | Interlettrage | Notes |
|---|---|---|---|---|
| Overline, en-tête de colonne en capitales | 11–12 / 16 | 500–600 | +0,06 em (capitales) | Rare : préférer les en-têtes de tableau en bas de casse 12 px 500 / 0 em. |
| Légende, aide, méta (date de création…) | 12 / 16 | 400 | 0 | Couleur slate-600 minimum (voir 2.4), jamais slate-400. |
| Texte dense de tableau, cellules | 13 / 18 | 400 ; 500 pour la cellule-clé | 0 | `tabular-nums` sur toutes les colonnes numériques. |
| Corps UI, libellés, menus, boutons | 14 / 20 | 400 corps, 500 libellés/boutons | 0 (−0,006 em si Inter) | Hauteur de bouton 36 px, 40 px sur tactile. |
| Champs de formulaire | **16 / 24** | 400 | 0 | 16 px obligatoire sur iPad : Safari iOS zoome sur tout champ ≤ 15 px ; ne jamais « corriger » avec `maximum-scale=1` (désastre d'accessibilité) : https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom/ |
| Texte long (notes, messages, devis) | 16 / 24 | 400 | 0 | Mesure 45–90 caractères (https://practicaltypography.com/line-length.html) → `max-w-prose` (65 ch). |
| Titre de carte / de section | 16 / 24 | 600 | −0,01 em | Pas 18 px : garder une échelle courte. |
| Titre de page, nom du client en fiche | 20 / 28 | 600 | −0,015 em | Inter : taille optique Display automatique. |
| Titre de page principal, montant total | 24 / 32 | 600 | −0,02 em | |
| Chiffre KPI (dashboard) | 30–32 / 36 | 600 | −0,02 em + `tabular-nums` | Jamais plus grand dans l'UI dense. |

Règles transverses :
- **Trois graisses** : 400 / 500 / 600. Le 700 est réservé à l'impression (devis, factures) si besoin ; jamais 800.
- **Chiffres tabulaires** (`font-variant-numeric: tabular-nums` = OpenType `tnum`, classe Tailwind `tabular-nums`,
  Baseline « widely available » : https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric ;
  https://v3.tailwindcss.com/docs/font-variant-numeric) sur prix, dates, heures, compteurs, numéros de ticket, IMEI.
  `slashed-zero` sur IMEI / numéros de série (Inter et Geist le supportent).
- **Casse** : phrase (« En attente de pièce »), pas de capitales ni de Title Case, y compris dans les badges
  (règle Atlassian : « Only capitalize the first letter of the label and any proper nouns » :
  https://atlassian.design/components/lozenge/usage).
- **Taille optique** : avec Inter v4 variable, laisser `font-optical-sizing: auto` (défaut navigateur) : les titres
  ≥ 20 px passent sur les dessins Display sans rien faire (« trois dessins par glyphe… axe text → display » :
  https://rsms.me/inter/) — c'est exactement la recette Linear (Inter Display titres, Inter corps).
- **Longueur de ligne** : 45–90 caractères pour les textes ; les tableaux sont exemptés.

---

## 2. Couleur

### 2.1 Neutres : slate, zinc, gray, stone, mauve ou gris maison ?

Ce que font les références :
- **Refactoring UI** : 8 à 10 nuances de gris, partir d'un gris très foncé plutôt que du noir, 5 à 10 nuances par
  couleur, couleurs d'accent « avec parcimonie » (https://www.refactoringui.com/previews/building-your-color-palette).
  Le conseil « gris légèrement saturés / teintés » vient du chapitre du livre, non consultable en ligne ; il est relayé
  par des sources secondaires qui citent un slate `#64748b` comme exemple froid.
- **Radix Colors** : « choose the gray scale which is saturated with the hue closest to your accent hue » ; pour
  violet / purple → **mauve** ; pour indigo / blue → slate ; `gray` pur = « a neutral vibe » qui va avec tout ;
  la différence « reste subtile » ; pour le **texte** (pas 11 et 12) le gris donne « une ambiance plus fonctionnelle,
  adaptée aux applications » ; attention aux fonds saturés quand l'UI contient beaucoup de composants colorés
  (Badge) (https://www.radix-ui.com/colors/docs/palette-composition/composing-a-palette). Mauve 1–12 :
  `#fdfcfd #faf9fb #f2eff3 #eae7ec #e3dfe6 #dbd8e0 #d0cdd7 #bcbac7 #8e8c99 #84828e #65636d #211f26`
  (https://unpkg.com/@radix-ui/colors@3.0.0/mauve.css).
- **Linear** : moteur de thème passé en LCH, trois variables seulement (« base color, accent color, and contrast ») ;
  surtout, ils ont **réduit la teinte d'accent dans les gris** pour revenir à un rendu « more neutral and timeless »
  et exploré le design « principalement avec des opacités de noir et de blanc »
  (https://linear.app/blog/how-we-redesigned-the-linear-ui).
- **Vercel / Geist** : 10 pas de gris (100–1000) avec rôles stricts : 100–300 fonds (défaut, survol, actif),
  400–600 bordures, 700–800 fonds à fort contraste, 900–1000 texte ; `gray-alpha` seulement quand le fond doit
  transparaître ; badges sur `gray-200/300` (https://vercel.com/geist/colors).
- **OneSignal** (marque violette) : gris légèrement **froids** pour s'harmoniser avec le violet, teinte constante sur
  toute l'échelle, saturation à peine relevée en 800–900 ; suppression d'un pas indiscernable (Gray-20 vs Gray-50) ;
  leçon : « une couleur trop proche de ses voisines n'apporte rien et ajoute de la complexité »
  (https://onesignal.com/blog/11-shades-of-gray-a-color-system-story/).

Valeurs Tailwind v3 (https://v3.tailwindcss.com/docs/customizing-colors) et contrastes calculés sur blanc :

| Échelle | 400 | 500 | 600 | Teinte |
|---|---|---|---|---|
| slate | `#94a3b8` 2,56:1 | `#64748b` 4,76:1 | `#475569` 7,58:1 | bleu froid (~215°) |
| zinc | `#a1a1aa` 2,56:1 | `#71717a` 4,83:1 | `#52525b` 7,73:1 | quasi neutre |
| gray | `#9ca3af` | `#6b7280` | `#4b5563` | bleu très léger |
| stone | `#a8a29e` | `#78716c` | `#57534e` | chaud |
| Radix mauve | mauve9 `#8e8c99` 3,30:1 | mauve11 `#65636d` 5,90:1 | mauve12 `#211f26` 16,3:1 | violet désaturé |

Faut-il passer en gris teintés violet (mauve) avec une marque violette ? **Non, rester sur slate** (décision) :
1. Linear a fait le chemin inverse (moins de teinte d'accent dans les gris) pour durer ; Radix dit la différence
   « subtile » et réserve le gris teinté à une ambiance « plus colorée », marketing.
2. Violet + gris lavande = toute l'interface dérive vers le « purple wash » que les articles anti-slop identifient
   comme LE marqueur IA ; des gris légèrement froids (slate) tiennent le violet à distance — c'est exactement le
   choix d'OneSignal pour sa marque violette.
3. Zéro migration : slate est déjà partout, ses contrastes sont connus (ci-dessus) ; zinc n'apporterait qu'une
   neutralité « Vercel » au prix d'une migration globale sans gain perceptible.
4. Si un jour l'app a besoin d'un gris maison : partir de slate en OKLCH avec une chroma ≈ 0,01 et une teinte unique
   (recette OneSignal / Radix), pas de mauve.

Règles de fond : page `white` ou `slate-50` (`#f8fafc`), **un seul** niveau de surface au-dessus (carte blanche
sur page slate-50, ou carte slate-50 sur page blanche) ; jamais slate-50 sur slate-100 sur blanc (pas
indiscernables, leçon OneSignal). Rôles à la Vercel : slate-50/100 fonds, slate-200 bordures, slate-500/600 texte
secondaire, slate-900 texte principal.

### 2.2 Usage de l'accent violet

- Règle 60-30-10 : 60 % neutre dominant, 30 % secondaire, **10 % d'accent sur « l'élément qui doit guider
  l'utilisateur », typiquement le CTA**, « la plus vive de la palette », et « limiter les couleurs au maximum »
  (https://hype4.academy/articles/design/60-30-10-rule-in-ui). L'accent « réservé à une action principale par
  écran » est la formulation la plus répétée des guides (https://www.visily.ai/?p=90572 ;
  https://colorpick-io.pages.dev/learn/60-30-10-rule) — sources secondaires, mais convergentes.
- Les tells IA liés à l'accent : dégradé indigo→violet sur le héros et le bouton (https://www.925studios.co/blog/ai-slop-design-tells),
  accents `violet-500 #8B5CF6` / `indigo-500` (https://superdesign.dev/blog/why-ai-design-looks-generic), violet « partout,
  fonds, boutons, accents » = « décoration qui remplace un système » → nommer les couleurs par fonction
  (https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c).
- Contrastes mesurés : blanc sur `brand-600 #7C3AED` = 5,70:1 (texte de bouton OK) ; `brand-500` sur blanc = 4,23:1
  (**échoue** comme texte : ne jamais écrire en brand-500) ; `brand-700 #6D28D9` sur blanc = 7,10:1 ; brand-700 sur
  brand-50 = 6,48:1.

Décisions :
- **Une seule couleur d'action** : un bouton primaire violet par écran (par zone visible), jamais deux côte à côte ;
  le second devient secondaire (blanc, bordure slate-300, texte slate-700) ; les actions tertiaires sont du texte
  brand-700 ou slate-700 souligné au survol.
- **Surfaces violettes : zéro** en dehors du bouton primaire, de l'anneau de focus et de la pastille du statut « En
  cours ». Les fonds `brand-50` disparaissent des panneaux, encadrés d'information, en-têtes de carte, lignes de
  tableau : ils ne restent que pour l'état **sélectionné** d'une ligne, d'un segment ou d'un item de liste
  (`bg-brand-50 text-brand-700`), un seul à la fois à l'écran. Un encadré d'information = `bg-slate-50 border
  slate-200` + icône slate-500 + texte slate-700.
- **Icône ou texte violet plutôt que fond violet** : l'item de navigation actif, l'onglet actif, le lien, le compteur
  mis en avant se signalent par la couleur du texte / de l'icône (brand-700) ou une barre de 2 px, pas par un aplat.
- **Pas de dégradé**, nulle part ; pas d'ombre violette sous les boutons ; pas de « glow ».
- Les liens dans les tableaux restent slate-900 (soulignés au survol) : réserver le violet aux liens dans la prose.

### 2.3 Statuts : style de badge et attribution pour 8 statuts

Trois styles comparés :

| Style | Exemple | Avantages | Inconvénients |
|---|---|---|---|
| Fond teinté + texte foncé (Tailwind 50/700) | Atlassian Lozenge « subtle », Polaris Badge | Lisible de loin, pas de pastille à viser ; contrastes mesurés tous ≥ 4,5:1 en 700 sur 50 (emerald 5,21, amber 4,84, red 5,91, blue 6,16, sky 5,57, teal 5,25, violet 6,48, slate 9,90) ; en 700 sur **100**, amber 4,51 et orange 4,52 sont à la limite | Huit pilules colorées par ligne = confettis ; Radix met en garde contre les fonds saturés quand l'UI est pleine de badges ; poids visuel qui concurrence les boutons |
| Pastille colorée + texte neutre (Linear, Height, Vercel `gray-200/300`) | ● En cours | Calme dans les tableaux ; le texte reste slate-700 (≥ 9:1) ; la pastille peut porter une **forme** (le motif « status circles » de Linear est reconnu comme sa signature UI : https://www.stfo.io/research/audits/linear/) | La pastille est un « objet graphique » soumis au 3:1 de WCAG 1.4.11 → il faut des teintes 600, pas 500 (mesuré : emerald-500 2,54 ✗, amber-500 2,15 ✗, sky-500 2,77 ✗ ; emerald-600 3,77 ✓, amber-600 3,19 ✓, teal-600 3,74 ✓, blue-600 5,17 ✓, violet-600 5,70 ✓, slate-500 4,76 ✓) |
| Bordure teintée seule | pilule blanche à bordure amber-300 | Léger | Bordure fine à faible contraste, illisible pour les daltoniens, et la « ligne colorée à gauche » est un tell IA cité (https://superdesign.dev/blog/why-ai-design-looks-generic) |

Combien de couleurs de statut avant confusion ? Au-delà de 8 catégories, trouver des couleurs « readily
distinguished » devient « close to impossible » ; un maximum de 8 est recommandé pour étiqueter des catégories
(https://thenode.biologists.com/?p=48902) ; les gens « perçoivent facilement » peu de catégories de couleur et, passé
quelques secondes, n'en discriminent que 10–12 (https://visualexpert.com/Resources/cfaqPart2.html). Et la couleur ne
doit jamais être le seul vecteur : texte, icône, forme ou motif en plus (WCAG 1.4.1 :
https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html ; Atlassian : « Don't use color alone to signify an
important attribute… utilisez un libellé clair et, si pertinent, une icône » : https://atlassian.design/components/lozenge/usage).

Décision : **6 teintes pour 8 statuts**, le gris portant trois états distingués par le **remplissage** (principe des
cercles Linear : vide = pas commencé, plein = fini, estompé = archivé), chaque statut ayant sa propre icône Lucide
et son libellé toujours affiché. Aucun statut en rouge : le rouge reste réservé aux erreurs et au retard (indicateur
séparé « en retard 3 j » avec icône). Les deux paires les plus utiles sont **ambre / bleu** (attente fournisseur /
attente client) — un axe que les daltonismes rouge-vert les plus fréquents distinguent bien (connaissance générale,
non sourcée ici) — et teal / emerald, voisins mais jamais ambigus : l'un précède la réparation, l'autre la suit, et
leurs icônes diffèrent.

| # | Statut | Famille | Icône Lucide | Liste / tableau (pastille + texte) | En-tête de fiche (badge plein) | Logique |
|---|---|---|---|---|---|---|
| 1 | En attente de diagnostic | gris « vide » | `CircleDashed` | pastille **creuse** `border-2 border-slate-400`, texte slate-700 | `bg-white border border-slate-300 text-slate-700` | Rien n'est décidé : pas de couleur, cercle pointillé (motif Linear « backlog »). |
| 2 | En attente de pièce | ambre | `Package` | `bg-amber-600` (3,19:1) + texte slate-700 | `bg-amber-50 text-amber-700` (4,84:1) | Bloqué par l'extérieur (fournisseur). |
| 3 | Pièce reçue | teal | `PackageCheck` | `bg-teal-600` (3,74:1) | `bg-teal-50 text-teal-700` (5,25:1) | Débloqué, à planifier. |
| 4 | En attente d'accord client | bleu | `MessageSquareMore` | `bg-blue-600` (5,17:1) | `bg-blue-50 text-blue-700` (6,16:1) | La balle est chez le client (communication). |
| 5 | En cours de réparation | violet (brand) | `Wrench` | `bg-brand-600` (5,70:1) | `bg-brand-50 text-brand-700` (6,48:1) | Le seul statut « actif » : seule surface violette tolérée hors boutons ; si l'on veut zéro violet, prendre indigo-600. |
| 6 | Réparation terminée | emerald | `CircleCheck` | `bg-emerald-600` (3,77:1) | `bg-emerald-50 text-emerald-700` (5,21:1) | Prête à rendre : l'action est au comptoir. |
| 7 | Rendu au client | gris « plein » | `CheckCheck` | pastille pleine `bg-slate-500` (4,76:1) | `bg-slate-100 text-slate-700` (9,45:1) | Fini pour le client, dossier encore ouvert (paiement, avis). |
| 8 | Clôturé | gris « estompé » | `Archive` | pastille `bg-slate-300`, texte slate-500 (4,76:1) | `bg-transparent text-slate-500 border border-slate-200` | Archivé : s'efface visuellement. |

Mise en œuvre : un seul composant `StatusBadge` avec deux variantes (`dot` pour les listes, `solid` pour la fiche),
l'icône toujours à gauche en 14–16 px, `white-space: nowrap`, hauteur 22–24 px, rayon plein (pilule) pour la
variante `solid`, texte 12–13 px 500. Le sélecteur de statut réutilise la variante `solid` dans l'ordre du flux.

### 2.4 Contraste : WCAG et APCA

- WCAG 2.1 **1.4.3** : 4,5:1 pour le texte, 3:1 pour le texte « large » (≥ 18 pt ≈ 24 px, ou 14 pt gras ≈ 18,66 px) ;
  seuils stricts (« threshold values ») ; exceptions : texte désactivé, décoratif, logos
  (https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html).
- WCAG 2.1 **1.4.11** : 3:1 pour les composants d'interface (bordure de champ, case, indicateur de focus) et les
  objets graphiques « nécessaires à la compréhension » — les « icônes de statut d'un tableau de bord » sont citées ;
  exceptions : composants inactifs, graphiques décoratifs, information disponible autrement (libellé), états de
  survol ; valeurs non arrondies (2,999 échoue) (https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html).

Ratios calculés (hex Tailwind v3, formule WCAG) :

| Texte | sur blanc | sur slate-50 | sur slate-100 | Verdict |
|---|---|---|---|---|
| slate-400 `#94a3b8` | 2,56 | 2,45 | 2,34 | Échoue partout, même le 3:1 UI → placeholders et états désactivés uniquement |
| slate-500 `#64748b` | 4,76 | 4,55 | **4,34 ✗** | Texte secondaire sur blanc seulement ; sur fond teinté passer en slate-600 |
| slate-600 `#475569` | 7,58 | 7,24 | 6,92 | Texte secondaire par défaut |
| slate-700 `#334155` | 10,35 | 9,90 | 9,45 | Corps ; slate-900 pour les titres |
| brand-600 `#7C3AED` | 5,70 | — | — | Texte violet OK ; brand-500 (4,23) interdit en texte |
| Bordure slate-200 `#e2e8f0` | 1,23 | — | — | Séparateur décoratif (exempté 1.4.11) |
| Bordure slate-300 `#cbd5e1` | 1,48 | — | — | Bordure de champ **sous** 3:1 : compenser par le fond blanc du champ sur page slate-50, le libellé, et un focus à 3:1+ ; une lecture stricte imposerait slate-500 |

APCA en bref (https://github.com/Myndex/SAPC-APCA/blob/master/documentation/APCA_in_a_Nutshell.md) : échelle Lc
0–105 ; **Lc 90** texte courant préféré, **Lc 75** minimum texte courant, **Lc 60** texte non courant, **Lc 45** grands
titres et icônes en contour, **Lc 30** placeholders / désactivé, **Lc 15** minimum discernable (séparateurs) ; le
contraste requis dépend de la taille et de la graisse (ex. Lc 75 : 16 px/500 ou 18 px/400) ; WCAG 2 surévalue le
contraste des paires sombres (mode sombre) et ignore taille et graisse. Radix garantit Lc 60 / Lc 90 pour ses pas 11
et 12 sur le pas 2 (https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale). Traduction
pratique : à 13–14 px en 400, viser slate-600 ou plus foncé ; slate-500 seulement ≥ 14 px en 500 ; slate-400 jamais
pour du texte porteur de sens.

### 2.5 Barre latérale sombre ou claire

Ce que font les produits cités :
- **Linear** : un seul système de thème pour clair et sombre ; en thème clair, la sidebar est claire (même base) ;
  le chrome a été retravaillé pour « reduce visual noise, maintain visual alignment, and increase the hierarchy and
  density of navigation elements », avec un alignement vertical/horizontal des libellés, icônes et boutons
  (https://linear.app/blog/how-we-redesigned-the-linear-ui).
- **Shopify** : 2023, Polaris v12 (uplift + Inter) pour l'admin redessiné (https://shopify.dev/changelog/polaris-v12-beta-now-available-1) ;
  **2026 (24 sept.), nouveau look avec « dark side navigation »** repliable, qui absorbe recherche, notifications et
  sélecteur de boutique, sous quatre principes : Focus, Directness, **De-layering** (« moins de conteneurs à chaque
  écran »), Personality (https://www.shopify.com/blog/admin-new-look). Donc : sidebar sombre + contenu clair est
  redevenu un choix assumé chez un éditeur d'outil métier de premier plan.
- Stripe, Notion, Vercel : chrome clair (observation courante, non sourcée ici).
- Templates d'admin « IA » : héros et panneaux sombres à dégradé (https://www.925studios.co/blog/ai-slop-design-tells),
  glassmorphism (https://superdesign.dev/blog/why-ai-design-looks-generic).

Lecture longue, 8 h/jour : NN/g (revue de littérature) : pour une vision normale, le mode clair donne de meilleures
performances, et « plus la police est petite, plus l'avantage du mode clair augmente » ; de nuit le clair reste
meilleur pour la lecture rapide ; recommandation : ne pas imposer le sombre, proposer le choix, suivre l'API système
(https://www.nngroup.com/articles/dark-mode/). Le clair est meilleur en environnement lumineux (bureaux), le sombre
réduit la fatigue en basse lumière ; aucun n'est universel (https://www.bootstrapdash.com/blog/admin-dashboard-light-mode-vs-dark-mode-whats-beyond-the-look).
Un magasin et un atelier sont éclairés : le **contenu doit rester clair**, non négociable.

Pour la sidebar, les deux choix sont défendables ; `#0F172A` est un ancrage de marque qui « ne bouge pas » (CLAUDE.md).
Elle ne fera pas « template » si :
- aucun dégradé, aucune texture, aucune icône colorée, aucun aplat violet ;
- texte au repos slate-300 (12,0:1 sur `#0F172A`), icônes slate-400 (6,96:1, ≥ 3:1), libellés de groupe 11 px 500
  en capitales +0,06 em en slate-400 (pas slate-500 : 3,75:1, insuffisant pour du texte) ;
- item actif = **fond blanc à 8–10 %** (`bg-white/10`) + texte et icône blancs ; survol `bg-white/5` ; option : une
  barre de 2 px blanche à gauche, pas violette ;
- compteurs en `bg-white/10 text-slate-200`, jamais en pilule colorée ; séparateurs `border-white/[0.06]` ;
- la marque n'apparaît qu'au logo ; le violet est absent de la barre (Linear : « opacités de noir et de blanc »).
Si un jour elle passe en clair : fond slate-50, bordure droite slate-200, item actif `bg-slate-200/60 text-slate-900`,
icônes slate-500 → slate-900 à l'état actif (recette Linear / Vercel).

Mode sombre pour l'atelier : rien ne l'appuie (NN/g ci-dessus ; un plan de travail de réparation est très éclairé).
Hors périmètre ; si cela revient, le faire par tokens (approche Linear à trois variables), jamais en dupliquant des classes.

---

## 3. Icônes et détails

### 3.1 Lucide : épaisseur, taille, couleur, usage

- Défauts Lucide : 24 px, `stroke-width` 2, `currentColor` ; réglage global par `LucideProvider` (`size`,
  `strokeWidth`, `color`) ou par CSS sur `.lucide` (https://lucide.dev/guide/advanced/global-styling). Grille de
  conception : 24 × 24, trait de 2 px **sans mélanger les épaisseurs**, 1 px de marge, jonctions et terminaisons
  rondes, rayons 2 px, ≥ 2 px entre éléments (https://lucide.dev/guide/design/icon-design-guide).
- Primer (GitHub) : deux dessins par icône, 16 px et 24 px, trait constant 1,5 px ; le 12 px seulement si le 16 ne
  convient pas (https://primer.style/foundations/icons/design-guidelines/). Material 3 : 20 dp pour les interfaces
  denses, 24 dp standard, 40/48 dp pour l'affichage, cible tactile ≥ 48 dp (https://m3.material.io/styles/icons/applying-icons).

Décisions :
- **Épaisseur 2 (défaut Lucide) partout de 16 à 20 px**, sans `absoluteStrokeWidth` (le trait se réduit à ~1,33 px
  à 16 px, ce qui équilibre le poids avec un texte 13–14 px en 400) ; **1,5 uniquement ≥ 24 px** (états vides,
  illustrations). Ne jamais mélanger 1,5 et 2 dans une même rangée : les icônes Lucide sont dessinées pour 2
  (guide), et le 1,5 « fin » généralisé est un des tells cités (« thin-line icons »).
- Tailles : **16 px** à côté d'un texte 12–14 px (cellules, menus, badges, libellés), **20 px** dans les boutons,
  champs et items de navigation (texte 14–16 px), **24 px** seulement en titre de page / état vide ; jamais plus
  dans l'UI dense (le 40–48 de Material est réservé à l'affichage).
- Couleur : monochrome, `text-slate-500` au repos (4,76:1, au-dessus du 3:1 des objets graphiques), slate-700 au
  survol / actif, blanc dans le bouton primaire ; une icône colorée seulement à côté d'un texte de la même couleur
  sémantique (statut, erreur).
- **Pas d'icônes dans des ronds ou carrés colorés** (la carte « petite icône + titre + texte » ×3 est le motif IA le
  plus cité) : l'icône se place en ligne devant son libellé, ou seule dans un bouton icône avec `aria-label` et
  infobulle.
- **Icône + libellé** par défaut ; icône seule uniquement pour les actions universelles (fermer, menu, rechercher,
  plus) et toujours avec un nom accessible. Cible tactile 44 px (règle du projet) / 48 dp (Material) obtenue par le
  padding, le glyphe restant à 20 px.
- **Aucun emoji dans l'UI** : rendu différent selon l'OS, couleurs hors système, lecture vocale verbeuse (jugement,
  cohérent avec la règle « monochrome »). Les emojis restent possibles dans les messages envoyés aux clients, ce
  qui est un autre registre.

### 3.2 Rayons, ombres, bordures, séparateurs

Échelle Tailwind par défaut : `rounded-sm` 2, `rounded` 4, `md` 6, `lg` 8, `xl` 12, `2xl` 16, `3xl` 24, `full`
(https://v3.tailwindcss.com/docs/border-radius). Règle des rayons imbriqués : **rayon interne = rayon externe −
(bordure + padding)**, borné à 0 (`max(0px, …)`), pour que les deux arcs soient concentriques ; exemples : carte 16 px
+ padding 8 → interne 8 ; carte 16 px + bordure 1 + padding 12 → interne 3 ; une pilule : `999px` sur les deux
(https://dev.to/sgbp/the-concentric-border-radius-rule-why-nested-rounded-corners-look-slightly-wrong-3hog). Le « même
rayon 16 px + même padding 24 px partout » est explicitement listé comme tell IA
(https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c).

Décisions :
- **Contrôles** (champs, boutons, segments, badges rectangulaires, cases) : **6 px** (`rounded-md`).
- **Cartes, tableaux, panneaux** : **10 px** (token `card`) — ni 8 (trop « formulaire ») ni 16 (trop « template »).
- **Modales, drawers, menus flottants** : **12 px** (`rounded-xl`) ; 16 px au plus pour une modale plein écran mobile.
- **Pilules** (statut `solid`, avatars, compteurs) : `rounded-full`.
- Imbrication : élément interne = externe − padding (ex. vignette 4 px dans une carte 10 px à 6 px de padding ;
  segment actif 4 px dans un contrôle segmenté 6 px avec 2 px de padding).

Ombres — règles de Josh Comeau : plusieurs couches, **teintées de la couleur du fond** (jamais noir pur, qui « délave »),
source lumineuse unique (décalage vertical = 2 × horizontal, ou vertical seul), élévation ↑ → décalage et flou ↑,
opacité ↓ (https://www.joshwcomeau.com/css/designing-shadows/). Les défauts Tailwind sont en noir pur `rgb(0 0 0 / .1)`
(https://v3.tailwindcss.com/docs/box-shadow) : à remplacer par des ombres teintées slate-900 (`rgb(15 23 42 / x)`), ce que
le `tailwind.config.js` actuel fait déjà pour `xs` et `lg` ; ajouter un niveau `md` et passer en deux couches. Jamais
d'ombre colorée (violet) ni de « glow ».

Bordures et séparateurs :
- Bordure standard slate-200 `#e2e8f0` (1,23:1 : décorative, exemptée du 3:1), ou `rgb(15 23 42 / 0.08)` quand elle
  doit passer sur un fond teinté (même valeur perçue, transparente) ; Vercel réserve ses pas 400–600 aux bordures.
- **Une seule élévation par surface** : carte posée sur page slate-50 = blanc + bordure slate-200, **sans** ombre ;
  élément flottant (menu, popover, modale, toast) = ombre + bordure ; jamais bordure + ombre sur une carte statique.
- **Séparateurs vs espacement** : à l'intérieur d'un bloc, filets slate-200 (lignes de tableau, items de liste) ;
  entre blocs, de l'espace (16–24 px) plutôt que des lignes — « moins de conteneurs à chaque écran » (Shopify
  « de-layering »), « reduce visual noise » (Linear). Pas de carte dans une carte.
- Focus : `focus-visible:outline-none ring-2 ring-brand-600 ring-offset-2` (brand-600 sur blanc 5,70:1 ≥ 3:1 exigé
  pour l'indicateur de focus) ; champs : bordure brand-600 + anneau, pas de brand-500.

### 3.3 Chiffres et unités en français

Règles (Banque de dépannage linguistique, OQLF) :
- **Espace insécable avant %, €, $ et les symboles d'unités** ; sécable après (https://vitrinelinguistique.oqlf.gouv.qc.ca/22039/la-typographie/espacement/espacement-avant-et-apres-les-signes-de-ponctuation-et-les-symboles).
  Le symbole € se place après le nombre : « 150 000 € » (fiche euro, https://vitrinelinguistique.oqlf.gouv.qc.ca/fiche-gdt/fiche/8371822/euro).
- **Milliers** par tranches de trois chiffres séparées par une espace insécable, jamais par un point ou une virgule ;
  facultatif pour les nombres de quatre chiffres, **sauf dans une colonne** (https://vitrinelinguistique.oqlf.gouv.qc.ca/21191/la-typographie/nombres/emploi-du-signe-decimal-et-indication-de-la-division-dans-les-unites-de-mesure).
- **Heure** : « 14 h 30 » avec espace insécable **avant et après** le h ; « 8 h » sans zéros ; les deux-points
  (« 15:30 ») sont admis seulement en contexte numérique / technique (ordinateurs, horaires), pas dans les textes
  courants ; « 17 h 05 » avec zéro désormais privilégié (https://vitrinelinguistique.oqlf.gouv.qc.ca/21516/la-typographie/nombres/ecriture-des-heures ;
  tableau des espacements ci-dessus).
- **Numéro** : « n° » avec **o minuscule en exposant** (pas le signe degré), « nos » au pluriel, seulement quand le
  mot suit le nom qu'il détermine (« ticket n° 1234 »), espace avant le chiffre, **aucun regroupement** dans un
  numéro (« n° 852410 », pas « 852 410 »), le `#` est déconseillé (https://vitrinelinguistique.oqlf.gouv.qc.ca/25450/les-abreviations-et-les-symboles/les-abreviations/cas-particuliers-dabreviations/abreviation-de-numero).
- Ponctuation : espace insécable avant « : » et « » », après « « » ; l'usage de France met aussi une fine insécable
  avant « ; ! ? » (https://www.debian.org/international/french/typographie ; l'OQLF préfère l'absence d'espace sur
  ces trois-là, variante québécoise).

Ce que donne `Intl` (Node 22, ICU) — mesuré :
- `new Intl.NumberFormat('fr-FR', {style:'currency', currency:'EUR'}).format(1234.5)` → `1 234,50 €` avec
  **U+202F** (espace fine insécable) entre les milliers et **U+00A0** avant € : conforme.
- `{style:'percent'}` → `20 %` avec U+00A0 : conforme.
- `Intl.DateTimeFormat('fr-FR', {day:'numeric', month:'short', year:'numeric'})` → `8 nov. 2026` : conforme.
- `{hour:'2-digit', minute:'2-digit'}` → `14:30` : forme « technique », acceptable dans un tableau ou un horodatage,
  **pas** dans une phrase, un SMS ou un document imprimé → écrire une fonction `formatHeure` qui rend
  `14 h 30` (et `8 h` pour les heures justes).
- Attention au glyphe U+202F : peu de polices l'ont (remarque CLDR relayée : https://corp.unicode.org/pipermail/cldr-users/2014-December/000192.html) ;
  si la police choisie l'affiche en « tofu » ou trop large, remplacer U+202F par U+00A0 à la sortie du formateur.
  Dans les exports CSV / Excel, remplacer les deux par une espace ordinaire ou formater en nombre.
- Toujours `white-space: nowrap` + `tabular-nums` sur les montants, heures et numéros ; « TTC » / « HT » séparés
  par une insécable (« 129,00 € TTC »).

---

## 4. Décisions recommandées pour Klikphone — tokens prêts pour Tailwind 3.4

Chaque ligne : token → valeur → justification en une ligne. Les clés `brand` et `sidebar` existantes ne bougent pas.

### 4.1 Polices

| Token | Valeur | Justification |
|---|---|---|
| `fontFamily.sans` | `['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'sans-serif']` (auto-hébergée, `font-optical-sizing: auto`) | Recette Linear (Inter + Display via taille optique), `tnum`/`zero` natifs, OFL. |
| `fontFamily.display` | **= `sans`** (supprimer la distinction) | Les titres se distinguent par taille, graisse 600 et interlettrage, pas par une seconde famille. |
| Serif d'accent | **Retirée** (plus d'Instrument Serif dans `index.html`) | Marqueur « site vibe-codé 2025 », sans chiffres tabulaires, registre marketing. |
| Plan B | Geist Sans (mêmes réglages ; `tnum`, `case`, `ss01–ss11` vérifiés dans le fichier) | Si le gérant « reconnaît Inter » ; même famille de rendu. |
| Option zéro-coût | Plus Jakarta Sans gardée, chargée 400..600, titres `tracking-tight`, `tabular-nums` (`tnum` vérifié) | Améliore nettement sans migration ; reste large et géométrique. |
| Graisses chargées | 400, 500, 600 (variable : `wght 400 600`) | Trois graisses suffisent ; 700+ hors UI. |

### 4.2 Échelle typographique (`fontSize`)

| Token | Valeur `[taille, {lineHeight, letterSpacing, fontWeight}]` | Justification |
|---|---|---|
| `text-2xs` | `['11px', {lineHeight:'16px', letterSpacing:'0.06em'}]` | Overlines en capitales uniquement. |
| `text-xs` | `['12px', {lineHeight:'16px'}]` | Légendes, méta ; couleur ≥ slate-600. |
| `text-table` | `['13px', {lineHeight:'18px'}]` | Cellules denses (Geist label-13 + tabulaires). |
| `text-sm` | `['14px', {lineHeight:'20px'}]` | Corps UI (Carbon body-compact-01). |
| `text-base` | `['16px', {lineHeight:'24px'}]` | Champs (anti-zoom iOS) et textes longs. |
| `text-title` | `['16px', {lineHeight:'24px', letterSpacing:'-0.01em', fontWeight:'600'}]` | Titre de carte / section. |
| `text-h2` | `['20px', {lineHeight:'28px', letterSpacing:'-0.015em', fontWeight:'600'}]` | Titre de page, nom client. |
| `text-h1` | `['24px', {lineHeight:'32px', letterSpacing:'-0.02em', fontWeight:'600'}]` | Titre principal, total. |
| `text-kpi` | `['30px', {lineHeight:'36px', letterSpacing:'-0.02em', fontWeight:'600'}]` + `tabular-nums` | Chiffres du dashboard, plafond de l'échelle. |
| Base CSS | `input, select, textarea { font-size: 16px }` ; `.num { font-variant-numeric: tabular-nums }` ; `max-w-prose` sur les notes | iOS, alignement des colonnes, mesure 45–90 car. |

### 4.3 Neutres

| Token | Valeur | Justification |
|---|---|---|
| Échelle | **slate** inchangée (pas de mauve, pas de zinc) | Gris froids à côté du violet (OneSignal), « neutre et intemporel » (Linear), zéro migration. |
| `bg-page` | `slate-50 #f8fafc` | Un seul niveau sous les cartes blanches. |
| `bg-surface` | `white` | Cartes, tableaux, formulaires. |
| `bg-subtle` | `slate-100 #f1f5f9` | En-têtes de tableau, zones inactives ; jamais empilé sur slate-50 sans bordure. |
| `border-default` | `slate-200 #e2e8f0` ou `rgb(15 23 42 / 0.08)` | Décoratif (exempt 1.4.11), transparent utilisable sur fond teinté. |
| `border-strong` | `slate-300 #cbd5e1` | Bordure des champs au repos ; slate-400 au survol. |
| `text-primary` | `slate-900 #0f172a` | Titres et valeurs clés. |
| `text-body` | `slate-700 #334155` (10,35:1) | Corps. |
| `text-secondary` | `slate-600 #475569` (7,58:1) | Méta, légendes, icônes importantes. |
| `text-muted` | `slate-500 #64748b` (4,76:1 sur blanc) | Seulement sur blanc, ≥ 14 px ; sur slate-100 échoue (4,34). |
| `text-disabled` / placeholders | `slate-400 #94a3b8` | Sous 3:1 : réservé à ce qui est exempté. |

### 4.4 Accent

| Token | Valeur | Justification |
|---|---|---|
| `action` (bouton primaire) | `bg-brand-600 text-white hover:bg-brand-700` (5,70:1 / 7,10:1) | Une seule par écran. |
| `action-text` (lien, tertiaire) | `text-brand-700` | brand-500 interdit en texte (4,23:1). |
| `selected` | `bg-brand-50 text-brand-700` (6,48:1), un seul élément à la fois | Seul usage de brand-50 en fond. |
| `ring-focus` | `ring-2 ring-brand-600 ring-offset-2` | Indicateur de focus ≥ 3:1. |
| Interdits | dégradés, `bg-brand-*` sur panneaux / en-têtes / lignes, icônes violettes dans des ronds, ombres violettes | Tells IA documentés ; règle des 10 %. |
| Sémantiques | `success = emerald`, `warning = amber`, `danger = red`, `info = blue` (alias existants) | Texte en 700 sur fond 50 ; pastilles en 600. |

### 4.5 Statuts (8) — classes Tailwind

| Statut | Variante liste (`dot`) | Variante fiche (`solid`) | Icône |
|---|---|---|---|
| En attente de diagnostic | `<span class="size-2 rounded-full border-2 border-slate-400">` + `text-slate-700` | `bg-white border border-slate-300 text-slate-700` | `CircleDashed` |
| En attente de pièce | `bg-amber-600` + `text-slate-700` | `bg-amber-50 text-amber-700` | `Package` |
| Pièce reçue | `bg-teal-600` | `bg-teal-50 text-teal-700` | `PackageCheck` |
| En attente d'accord client | `bg-blue-600` | `bg-blue-50 text-blue-700` | `MessageSquareMore` |
| En cours de réparation | `bg-brand-600` | `bg-brand-50 text-brand-700` | `Wrench` |
| Réparation terminée | `bg-emerald-600` | `bg-emerald-50 text-emerald-700` | `CircleCheck` |
| Rendu au client | `bg-slate-500` | `bg-slate-100 text-slate-700` | `CheckCheck` |
| Clôturé | `bg-slate-300` + `text-slate-500` | `border border-slate-200 text-slate-500` | `Archive` |

Justification commune : 6 teintes pour 8 états (limite pratique ≤ 8, ambre/bleu comme axe principal), remplissage
du gris pour début / fin / archive, icône + libellé toujours présents (WCAG 1.4.1), pastilles en 600 (≥ 3:1), textes
700 sur 50 (≥ 4,5:1), pas de rouge pour un statut.

### 4.6 Rayons, ombres, bordures

| Token | Valeur | Justification |
|---|---|---|
| `borderRadius.control` | `6px` | Champs, boutons, segments, badges rectangulaires. |
| `borderRadius.card` | `10px` | Cartes, tableaux, panneaux : entre 8 (formulaire) et 16 (template). |
| `borderRadius.modal` | `12px` | Modales, menus, popovers, toasts. |
| Imbrication | interne = externe − padding, borné à 0 | Arcs concentriques. |
| `boxShadow.xs` | `0 1px 2px rgb(15 23 42 / .06), 0 1px 1px rgb(15 23 42 / .04)` | Boutons secondaires, segment actif ; teintée slate-900, deux couches. |
| `boxShadow.md` | `0 4px 12px -2px rgb(15 23 42 / .10), 0 2px 4px rgb(15 23 42 / .06)` | Menus, popovers, dropdowns. |
| `boxShadow.lg` | `0 16px 40px -12px rgb(15 23 42 / .22), 0 2px 6px rgb(15 23 42 / .06)` | Modales, drawers, toasts. |
| Règle | bordure **ou** ombre par surface ; cartes statiques = bordure seule | Une élévation par surface. |
| Séparateurs | filets slate-200 dans un bloc ; espace 16–24 px entre blocs ; pas de carte dans une carte | De-layering (Shopify), moins de bruit (Linear). |

### 4.7 Icônes

| Token | Valeur | Justification |
|---|---|---|
| `strokeWidth` global | `2` (`LucideProvider` ou `.lucide { stroke-width: 2 }`) | Grille native Lucide ; 1,5 seulement ≥ 24 px. |
| Tailles | `size-4` (16) avec texte 12–14, `size-5` (20) dans boutons/champs/nav, `size-6` (24) titres et états vides | Texte 14 → icône 16 ; jamais > 24 en UI dense. |
| Couleur | `text-slate-500` repos, `text-slate-700` actif, `currentColor` dans les boutons | Monochrome ≥ 3:1. |
| Forme | inline devant le libellé ; bouton icône = `aria-label` + infobulle + cible 44 px | Pas de rond coloré, pas d'icône seule sans nom. |
| Emoji | aucun dans l'UI | Rendu et couleurs incontrôlés. |

### 4.8 Sidebar (`#0F172A` conservée)

| Token | Valeur | Justification |
|---|---|---|
| `sidebar.text` | `text-slate-300` (12,0:1) | Lisible sans crier. |
| `sidebar.icon` | `text-slate-400` (6,96:1) | ≥ 3:1 objets graphiques. |
| `sidebar.group` | `text-slate-400 text-2xs uppercase tracking-[0.06em]` | slate-500 (3,75:1) insuffisant pour du texte. |
| `sidebar.active` | `bg-white/10 text-white` (+ icône blanche) | Opacités de blanc, pas de violet (Linear). |
| `sidebar.hover` | `bg-white/5` | Même logique. |
| `sidebar.badge` | `bg-white/10 text-slate-200` | Pas de pilule colorée. |
| Interdits | dégradé, icônes colorées, aplat brand, logo en couleur partout | Ce qui fait « template ». |

### 4.9 Formats français

| Token / helper | Valeur | Justification |
|---|---|---|
| `formatEuro(n)` | `Intl.NumberFormat('fr-FR', {style:'currency', currency:'EUR'})` → `1 234,50 €` (U+202F / U+00A0) | OQLF : insécable avant €, milliers par insécable. |
| `formatHeure(d)` | `${h} h ${mm}` (« 14 h 30 », « 8 h ») | OQLF : h entouré d'insécables ; `14:30` seulement dans les tableaux/horodatages. |
| `formatDate(d)` | `Intl.DateTimeFormat('fr-FR', {day:'numeric', month:'short', year:'numeric'})` → `8 nov. 2026` | Conforme. |
| Numéro | `n<sup>o</sup> 1234` (ou « nº » U+00BA), sans regroupement | OQLF : o en exposant, pas de #, pas d'espace dans le numéro. |
| CSS | `.num { font-variant-numeric: tabular-nums; white-space: nowrap }` | Alignement et insécabilité. |

### 4.10 Extrait `tailwind.config.js` (à fusionner dans `theme.extend`)

```js
fontFamily: {
  sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
  display: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'], // alias = sans, à supprimer à terme
},
fontSize: {
  '2xs': ['11px', { lineHeight: '16px', letterSpacing: '0.06em' }],
  table: ['13px', { lineHeight: '18px' }],
  title: ['16px', { lineHeight: '24px', letterSpacing: '-0.01em', fontWeight: '600' }],
  h2: ['20px', { lineHeight: '28px', letterSpacing: '-0.015em', fontWeight: '600' }],
  h1: ['24px', { lineHeight: '32px', letterSpacing: '-0.02em', fontWeight: '600' }],
  kpi: ['30px', { lineHeight: '36px', letterSpacing: '-0.02em', fontWeight: '600' }],
},
borderRadius: { control: '6px', card: '10px', modal: '12px' },
boxShadow: {
  xs: '0 1px 2px rgb(15 23 42 / 0.06), 0 1px 1px rgb(15 23 42 / 0.04)',
  md: '0 4px 12px -2px rgb(15 23 42 / 0.10), 0 2px 4px rgb(15 23 42 / 0.06)',
  lg: '0 16px 40px -12px rgb(15 23 42 / 0.22), 0 2px 6px rgb(15 23 42 / 0.06)',
},
```

```css
/* index.css */
html { font-optical-sizing: auto; }
input, select, textarea { font-size: 16px; }            /* iPad : pas de zoom */
.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.lucide { stroke-width: 2; }
```

---

## Les 12 décisions clés

1. Une seule famille, **Inter Variable** auto-hébergée (plan B : Geist) ; Instrument Serif retirée de l'app.
2. Trois graisses (400 / 500 / 600), jamais 700+ dans l'UI ; titres par taille optique + interlettrage négatif.
3. Échelle courte 11 · 12 · 13 · 14 · 16 · 20 · 24 · 30, champs à 16 px (iPad), `tabular-nums` sur tout nombre.
4. Neutres : **slate conservé**, pas de gris violets ; deux niveaux de fond au plus.
5. Texte : slate-700 corps, slate-600 secondaire, slate-500 seulement sur blanc, slate-400 jamais porteur de sens.
6. Violet : un bouton primaire par écran, focus, sélection ; **zéro aplat violet** ailleurs, zéro dégradé.
7. Statuts : pastille 600 + texte neutre dans les listes, badge 50/700 en en-tête de fiche, jamais la bordure teintée.
8. 6 teintes pour 8 statuts (gris vide / plein / estompé, ambre, teal, bleu, violet, emerald), icône + libellé toujours.
9. Sidebar `#0F172A` gardée mais « muette » : opacités de blanc, item actif `bg-white/10`, aucun violet, aucun dégradé.
10. Lucide à `stroke-width` 2, tailles 16 / 20 / 24, monochrome slate-500, pas d'icône dans un rond coloré, pas d'emoji.
11. Rayons 6 / 10 / 12 (contrôle / carte / modale), interne = externe − padding ; ombres teintées slate-900 en deux couches ; bordure **ou** ombre.
12. Français : `1 234,50 €`, `14 h 30` (insécables), `8 nov. 2026`, `n° 1234` en exposant sans regroupement.

---

