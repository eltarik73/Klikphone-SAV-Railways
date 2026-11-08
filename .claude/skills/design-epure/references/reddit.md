# Ce que disent les praticiens sur Reddit (47 fils lus, 2022–2026)

r/web_design, r/UI_Design, r/UXDesign, r/webdev, r/SaaS, r/ClaudeAI, r/Frontend… Fils lus via l'archive publique Arctic Shift (commentaires complets avec scores) le 8 novembre 2026 ; scores = ceux de l'archive, sous-estimés. Les identifiants des grands fils « anti-IA » viennent du dépôt JCarterJohnson/vibecoded-design-tells (3,2 M de posts scannés).

## Règles consolidées (actionnables, avec sources)

### Typographie
1. Une seule famille de police pour toute l'app ; au plus deux couleurs de texte « fortes » (« one font, two colors, three clicks », ↑43). — https://www.reddit.com/r/web_design/comments/1sovg4k/
2. Échelle typographique réduite : 3 à 4 tailles et 2 graisses suffisent pour un back-office (↑1, liste détaillée). — https://www.reddit.com/r/UI_Design/comments/1rn6smt/
3. Tailles en multiples de 2/4/8 ; interlignage ≈ 130 % pour le corps, ≈ 100 % pour les titres ; interlettrage des titres −1 à −3 %. — https://www.reddit.com/r/UXDesign/comments/1j1itp0/
4. Pour une UI dense : 14 px comme taille « par défaut » est défendable, 12–13 px pour microcopy et cellules de tableau si le contraste est fort ; 16 px pour le corps lu longuement ; WCAG ne fixe aucun minimum. — https://www.reddit.com/r/UXDesign/comments/1bxho5b/
5. Le texte gris clair peu contrasté est la vraie plaie, pas la petite taille (↑2) ; « Readability is #1 » (↑38). — https://www.reddit.com/r/UXDesign/comments/1bxho5b/ ; https://www.reddit.com/r/web_design/comments/1sovg4k/
6. Hiérarchie par nuances de gris et par graisse, pas par multiplication des couleurs (↑3). — https://www.reddit.com/r/UXDesign/comments/1bxho5b/
7. Éviter le trop-gras : « Use a modern sans-serif font with less weight » (↑24) ; libellés sous les grands chiffres pas trop petits (↑6). — https://www.reddit.com/r/UI_Design/comments/1pr2ow7/ ; https://www.reddit.com/r/UXDesign/comments/1rps7i2/
8. Donner des unités aux métriques (« 73 minutes ») et des données réalistes (↑2). — https://www.reddit.com/r/UXDesign/comments/1rps7i2/
9. Ne pas abuser d'Inter/Geist + CTA dégradé (empreinte v0) ; Inter reste une bonne police si le reste n'est pas « par défaut » (↑5). Plus Jakarta Sans échappe au tell, à condition de régler graisses et tailles. — https://www.reddit.com/r/ClaudeAI/comments/1s6mm8o/

### Espacement et grille
10. Grille 4 ou 8 pt « 95 % du temps » ; échelle d'espacement fermée (0, 1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112, 128 px) stockée en tokens (↑5). — https://www.reddit.com/r/UXDesign/comments/1j1itp0/
11. Laisser respirer : « fail to allow their designs to breathe » est le critère n° 1 d'amateurisme (↑38). — https://www.reddit.com/r/UI_Design/comments/17j96eu/
12. Marges plus grandes **et constantes** (↑1) ; un espacement inégal dilue la hiérarchie (↑1). — https://www.reddit.com/r/UI_Design/comments/1pr2ow7/ ; https://www.reddit.com/r/UXDesign/comments/1rps7i2/
13. Grouper par proximité (Gestalt) : fond, espace ou ligne — un seul des trois à la fois (↑1). — https://www.reddit.com/r/graphic_design/comments/1qv006k/ ; https://www.reddit.com/r/UXDesign/comments/1ci084x/
14. Aligner les contrôles entre eux (titre et profil sur une ligne, filtres alignés sur les sélecteurs) (↑1). — https://www.reddit.com/r/UXDesign/comments/1qil193/
15. Pas de blanc « infini » centré : « Tiny text, lots of whitespace » est un tell IA (↑2) ; la densité utile prime en outil métier (↑16). — https://www.reddit.com/r/ClaudeAI/comments/1s6mm8o/ ; https://www.reddit.com/r/UXDesign/comments/1ci084x/

### Couleur
16. Palette neutre (noir/gris/blanc) + **un** accent de marque ; « one or two basic primary colors with an additional highlight ». — https://www.reddit.com/r/UXDesign/comments/1j1itp0/ ; https://www.reddit.com/r/graphic_design/comments/1qv006k/
17. Le violet #7C3AED : jamais en dégradé, jamais en fond de hero, jamais en texte dégradé ; en aplat d'accent limité (boutons primaires, lien actif, focus) — le « purple-to-blue gradient is the biggest tell » (↑373). — https://www.reddit.com/r/ClaudeAI/comments/1s6mm8o/
18. Noir pur interdit : utiliser une nuance très sombre de la primaire (texte, sidebar) (↑5) ; fond pas 100 % blanc pour les sessions longues (« 95% white ») (↑1). — https://www.reddit.com/r/UXDesign/comments/1j1itp0/ ; https://www.reddit.com/r/UXDesign/comments/1qil193/
19. Couleurs **sémantiques** réservées aux statuts (rouge = destructif/erreur, vert = OK) et jamais au décor ; « Colors and icons should communicate something » (↑1). — https://www.reddit.com/r/UI_Design/comments/1pr2ow7/ ; https://www.reddit.com/r/web_design/comments/1sovg4k/
20. Graphiques : nuances d'une même teinte plutôt que 7 couleurs (↑9, ↑6) ; pas de donut/camembert par défaut (↑1) ; courbes pour les tendances, barres pour les comparaisons (↑1). — https://www.reddit.com/r/UXDesign/comments/1rps7i2/ ; https://www.reddit.com/r/UXDesign/comments/1qil193/
21. Vérifier chaque paire texte/fond (grille de contraste) ; « Most of the gradient stuff fails AA standard » (↑17). — https://www.reddit.com/r/graphic_design/comments/1qv006k/ ; https://www.reddit.com/r/web_design/comments/180pvpg/
22. Pas de mode sombre « par défaut IA » (noir + néon/vert lime, glow) ; la sidebar sombre est acceptable si le reste est clair et calme (↑1 « darker or gray sidebar »). — https://www.reddit.com/r/ClaudeAI/comments/1s6mm8o/ ; https://www.reddit.com/r/UXDesign/comments/1qil193/

### Bordures, ombres, profondeur, rayons
23. « the urge to put a box around everything » (↑10) et « boxes inside boxes » (↑1) = daté et IA : une seule couche de carte par page, séparateurs plutôt que fonds d'items de liste (↑2). — https://www.reddit.com/r/ClaudeAI/comments/1s6mm8o/ ; https://www.reddit.com/r/UI_Design/comments/1pr2ow7/
24. Bordures fines et peu contrastées (« thin, low-contrast outlines », ↑1) ; « Thick borders » = amateur (↑1) ; jamais de bordure épaisse sur un seul côté d'une carte (↑67). — https://www.reddit.com/r/UI_Design/comments/1pr2ow7/ ; https://www.reddit.com/r/UI_Design/comments/17j96eu/ ; https://www.reddit.com/r/ClaudeAI/comments/1s6mm8o/
25. Un seul rayon de coin pour toute l'app, rayon intérieur = rayon extérieur − padding (rayons imbriqués) (↑2, ↑24) ; pas de « rounded to oblivion » ni de boutons pilule systématiques (↑1). — https://www.reddit.com/r/UI_Design/comments/1pr2ow7/ ; https://www.reddit.com/r/vibecoding/comments/1s37qlp/
26. Profondeur par la lumière : couches arrière plus sombres, avant plus claires (↑3) ; pas d'ombres colorées, pas de glow (↑8 « hurts my brain »). — https://www.reddit.com/r/UI_Design/comments/1pr2ow7/ ; https://www.reddit.com/r/webdev/comments/1qwiqen/
27. Pas de glassmorphism ni de blobs — mineurs dans les données (0,2–0,3 %) mais toujours cités comme « unnecessary ». — https://github.com/JCarterJohnson/vibecoded-design-tells ; https://www.reddit.com/r/ClaudeCode/comments/1t5zhf8/

### Composants
28. **Boutons** : une seule action primaire par écran (↑1, ↑2 ×3 : « 2 primary buttons is in part responsible ») ; secondaire en style bordure ; hauteur des champs = hauteur des boutons (↑6) ; pas de boutons surdimensionnés (↑51). — https://www.reddit.com/r/web_design/comments/1sovg4k/ ; https://www.reddit.com/r/UI_Design/comments/1l8cqnb/
29. **Tableaux** : vue tableau pour gérer (toutes les colonnes, édition en lot), vue liste/cartes pour consulter ; ne pas fusionner (↑2). Les pros préfèrent des tableaux denses à des cartes (↑16) ; filtres omniprésents (↑9). — https://www.reddit.com/r/Notion/comments/1ppr2di/ ; https://www.reddit.com/r/UXDesign/comments/1ci084x/ ; https://www.reddit.com/r/ProductManagement/comments/1tq1z9l/
30. **Formulaires** : libellés seulement où le sens n'est pas évident (@, +/−), mais toujours présents dans les sections denses (fiches techniques) (↑3, ↑1) ; champ avec bordure et fond légèrement plus sombre que la page (↑2). — https://www.reddit.com/r/tailwindcss/comments/1kxzwgq/ ; https://www.reddit.com/r/UI_Design/comments/1l8cqnb/
31. **Badges de statut** : couleur = état, jamais décoration ; pas de « green dots that seem like live indicator » gratuits (↑3) ; pas de chips emoji. — https://www.reddit.com/r/vibecoding/comments/1ptoz0v/ ; https://www.reddit.com/r/UXDesign/comments/1tvt03p/
32. **Icônes** : un seul jeu cohérent (Lucide ici) assorti à la police (↑7) ; retirer les icônes à côté des chiffres clés (elles pèsent autant que les chiffres) (↑1) ; jamais d'emoji en icône (↑10, ↑37). — https://www.reddit.com/r/UXDesign/comments/1ci084x/ ; https://www.reddit.com/r/UXDesign/comments/1rps7i2/ ; https://www.reddit.com/r/ClaudeAI/comments/1s6mm8o/
33. **Barre latérale** : sombre ou grise, acceptable (↑1) ; navigation stable, jamais d'éléments de navigation qui disparaissent selon le contexte (↑1) ; boutons de navigation libellés (↑1). — https://www.reddit.com/r/UXDesign/comments/1qil193/ ; https://www.reddit.com/r/UXDesign/comments/1f3hr8x/
34. **KPI / dashboard** : une question par page, « one purpose per focus area » (↑1) ; métrique la plus actionnable en premier ; KPI en barre horizontale, pas en colonne (↑20) ; % de variation et sparkline plutôt que totaux bruts (↑1) ; « More information is not better on a dashboard » (↑2). — https://www.reddit.com/r/UXDesign/comments/1kr0w5b/ ; https://www.reddit.com/r/UXDesign/comments/1rps7i2/ ; https://www.reddit.com/r/projectmanagement/comments/1sfqlyz/
35. Ne pas trop cacher : « hiding too much detail creates anxiety » (↑6) — divulgation progressive sans quitter la page, pas de suppression. — https://www.reddit.com/r/ProductManagement/comments/1tq1z9l/ ; https://www.reddit.com/r/UXDesign/comments/1w0kiy8/
36. Cliquable = qui a l'air cliquable, et réciproquement (↑6) ; « Don't screw with the default UI » (↑2). — https://www.reddit.com/r/web_design/comments/1sovg4k/
37. Cibles tactiles 44 pt / 48 dp, zone de clic invisible plus grande que l'icône (↑1, ↑2). — https://www.reddit.com/r/UXDesign/comments/1w0kiy8/

### États (vide, chargement, erreur)
38. Concevoir avec du contenu réel : longueur max, **état vide**, trop de données (↑1) ; les designs d'amateur « break with real data, long names, or empty states » (↑1). — https://www.reddit.com/r/web_design/comments/1sovg4k/ ; https://www.reddit.com/r/UI_Design/comments/1rn6smt/
39. Les générateurs IA oublient « key interaction states » (hover, focus, disabled, erreur) : les spécifier explicitement (↑1, ↑8). — https://www.reddit.com/r/UXDesign/comments/1uuyjwi/ ; https://www.reddit.com/r/webdev/comments/1mw6brs/
40. Pas de spinners morts ni de pop-up de confirmation à la fermeture d'une modale (↑1) ; pas de décalage de mise en page au chargement (↑22). — https://www.reddit.com/r/ClaudeCode/comments/1qkq4m7/ ; https://www.reddit.com/r/UXDesign/comments/1f3hr8x/
41. Vitesse perçue = priorité n° 2 après la lisibilité (↑13). — https://www.reddit.com/r/web_design/comments/1sovg4k/

### Motion
42. Pas d'animations d'entrée en cascade (« Framer fade-ins », 1,1 % des commentaires) ; « excessive page animations makes it feel super slow » (↑1) ; « What triggers me is the grow animation on hover » (↑2). — https://github.com/JCarterJohnson/vibecoded-design-tells ; https://www.reddit.com/r/ClaudeCode/comments/1qkq4m7/ ; https://www.reddit.com/r/ClaudeCode/comments/1p9srut/
43. Pas de scroll-jacking ni de modales non sollicitées (↑6). — https://www.reddit.com/r/UXDesign/comments/1f3hr8x/
44. Le mouvement doit expliquer un changement d'état, sinon le supprimer (« unexplained motion and logos », ↑2). — https://www.reddit.com/r/ClaudeCode/comments/1qkq4m7/

### Anti-IA (processus et garde-fous)
45. Interdire explicitement dans le skill : dégradé violet→bleu, texte dégradé, glow, glassmorphism, blobs, bento, hero centré + 3 cartes + CTA, emoji-icônes, « No X. No Y. Just Z », em dashes dans la copy, bordure gauche épaisse, 1 px gris + violet, fond quadrillé, boutons pilule partout. — https://www.reddit.com/r/ClaudeAI/comments/1s6mm8o/ ; https://www.reddit.com/r/vibecoding/comments/1s37qlp/ ; https://www.reddit.com/r/ClaudeCode/comments/1t5zhf8/
46. Décrire le look voulu, jamais « modern » ni « clean » seuls (↑1) ; « If you let it decide, it will always default to its training data » (↑41). — https://www.reddit.com/r/cursor/comments/1p8jyg7/ ; https://www.reddit.com/r/ProductManagement/comments/1qccb1g/
47. Un `DESIGN.md` : grille, échelle d'espacement, tokens, règles de composants, URL de référence et **règles « ne pas faire »** ; « concrete references beat prose » (↑1) ; registre des décisions mis à jour (↑2). — https://www.reddit.com/r/ClaudeAI/comments/1t24gan/
48. Tokens de thème obligatoires, « no hard code colors » + passe de nettoyage (↑11) ; thème shadcn personnalisé (tweakcn) plutôt que défaut (↑43). — https://www.reddit.com/r/cursor/comments/1p8jyg7/
49. Passe « audit for AI slop » après génération (↑3) ; une passe = un écran = une dimension (↑4). — https://www.reddit.com/r/ClaudeAI/comments/1t24gan/ ; https://www.reddit.com/r/vibecoding/comments/1tzie7q/
50. Le vrai antidote : du **contenu réel** (vraies captures, vraies données, vrais noms de pièces et de clients) — « the biggest tell is the lack of images » (↑7) ; la cohérence d'ensemble (↑9 « has no cohesion ») vaut plus que chaque écran. — https://www.reddit.com/r/ClaudeAI/comments/1s6mm8o/ ; https://www.reddit.com/r/webdev/comments/1mw6brs/
51. Se différencier par « tone of voice, motion, spacing rhythm, and illustration style » plutôt que par des composants exotiques (↑1) ; garder la navigation prévisible (↑28). — https://www.reddit.com/r/webdev/comments/1ne0h3g/ ; https://www.reddit.com/r/webdev/comments/17clmce/
52. Test du plissement d'yeux (↑2) et test en niveaux de gris (↑1) avant livraison : ce qui ressort en premier doit être l'action ou la donnée principale. — https://www.reddit.com/r/UXDesign/comments/1rps7i2/ ; https://www.reddit.com/r/UXDesign/comments/1w0kiy8/

---

## Apps citées en exemple → ce qui est précisément admiré

| App | Ce qui est admiré (source) |
|---|---|
| **Linear** | Vitesse et navigation clavier « every SaaS should study » (r/UXDesign 1tl5dnv ↑3) ; espacement et sensation de calme « compared to most saas stuff » (1um9sjk) ; notifications actionnables + snooze (1qb1tsn) ; upsell contextuel seulement à la limite atteinte (1q575ot) ; navigation au mousedown pour la vitesse perçue (1vugli1, contesté) ; « the hottest website » que tout le monde copie après Stripe (r/webdev 17clmce ↑6) ; cité « exceptionally made » avec Vercel et Framer (1j1itp0). Réserves : « there is a lot going on », « least intuitive tool » pour certains utilisateurs forcés. |
| **Stripe** | Réponse n° 1 à « favorite SaaS UX » (↑5, 1tl5dnv) ; les SaaS de paiement (Stripe, Square, SumUp, Wise, Xero) ont l'UX la plus poussée car le marché est concurrentiel (↑5, 1ugwtk8) ; benchmark de design system (1td3stu). |
| **Raycast** | « the command palette interaction model is so clean it makes everything else feel clunky » (1tl5dnv ↑3). |
| **Arc** | A changé la façon de penser l'UI d'un navigateur (1tl5dnv ↑3). |
| **Things 3** | App de tâches mobile bien conçue, interactions « considered » (1tl5dnv ↑3). |
| **Craft Docs** | Typographie et disposition spatiale qui travaillent ensemble (1tl5dnv ↑3). |
| **Notion** | Recommandé en boucle (1tl5dnv) ; notifications sélectives et groupées (1qb1tsn) ; upsell contextuel (1q575ot) ; empty states traités comme des composants (sources blog, hors Reddit). |
| **Slack** | Hiérarchie des notifications et fils (1qb1tsn). |
| **Vercel / Framer** | « exceptionally made products » à étudier (1j1itp0) ; Vercel nommé pour ses bonnes pratiques (1q8oskm, post). |
| **Apple / Google** | Simplicité : « Unnecessary colors/elements that don't add anything » (17j96eu ↑8) ; Apple = langage de design copié par les startups (17clmce ↑3). |
| **Contrôles natifs (Windows/macOS, Roblox Studio)** | Copier « font, size, corner radius, margins, colors » des contrôles natifs quand on fait un outil (1pr2ow7 ↑2). |
| **berkshirehathaway.com** | « peak UI/UX » : clarté, architecture d'information, rapidité > « modern » UI (1qedyr8 ↑10, ↑1). |
| **Material Design** | Système alternatif nommé pour échapper au look shadcn (1qccb1g ↑6). |
| Non trouvés | Attio, Height, Superhuman, Mercury, Cron/Notion Calendar : aucune occurrence dans les fils lus. |

---

