# Références mesurées en direct et vidéos de créateurs (Chrome, 8 novembre 2026)

Ce que valent réellement les produits que tout le monde cite — relevé avec `getComputedStyle` dans le navigateur, pas recopié d'un article. Sert d'étalon quand une règle paraît abstraite.

Instagram : mur de connexion sur /explore et sur tous les profils (malewicz, uxdesigncc) → aucune lecture possible sans identifiants. Les mêmes créateurs publient sur YouTube (Shorts = format réel) ; transcriptions lues via le panneau « Afficher la transcription ».

## 1. « Your Vibe-Coded App Looks AI-Made. Fix It With These 26 Tricks. » — Pranav Innovates, Short, 8 nov. 2026
URL : https://www.youtube.com/watch?v=hffs7Rn2IGA
Les 26 corrections (transcription intégrale, reformulée) :
1. Retirer les dégradés violets.
2. Supprimer tout « glow » et toute ombre colorée.
3. Pas de texte en dégradé (titres).
4. Remplacer chaque emoji par une icône d'un seul jeu d'icônes.
5. Tout l'espacement sur une grille de 4 px.
6. Des cartes égales ont un padding égal.
7. Construire tous les gris à partir d'UNE rampe neutre.
8. Une seule couleur d'accent, utilisée rarement.
9. Supprimer les badges « New » / « Pro ».
10. Libellés en « sentence case », pas de capitales criardes.
11. Poids réguliers, pas de titres extra-bold.
12. Chaque nombre dans un seul format.
13. Aucun point d'exclamation dans l'interface.
14. Remplacer « Welcome back » par le vrai titre de la page.
15. Dire à quoi chaque variation (Δ) se compare.
16. Couper les mots creux : « supercharge », « seamless ».
17. Raccourcir les placeholders.
18. Afficher les raccourcis en « key caps » (kbd).
19. Rayons internes cohérents avec les rayons externes.
20. Ne pas tout mettre en pilule.
21. Un seul graphique en vedette.
22. Pas de barres arc-en-ciel : une couleur de surbrillance par graphique.
23. Varier les largeurs de cartes (pas 3 cartes identiques).
24. Supprimer les blobs flottants et les orbes brillantes.
25. Arrêter ce qui pulse et rebondit.
26. Montrer le vrai produit, pas une illustration de stock. + Vérifier que l'accent passe 4,5:1.

## 2. « Amateur vs Pro UI Design | with examples » — Jesse Showalter (Design Champs), 1er mars 2024, 281 k vues
URL : https://www.youtube.com/watch?v=XZf5A0wcruE (transcription intégrale lue)
Enseignements :
- Couleur : « if everything is on fire, nothing is on fire ». La couleur d'action est réservée aux appels à l'action primaires ; texte sombre sur fond clair partout ailleurs ; pas de titres, liens, icônes, bordures de champs tous dans la couleur de marque.
- Hiérarchie : un lien doit se distinguer d'un placeholder et d'un libellé (poids, soulignement, opacité) ; UN bouton primaire par écran, l'alternative (« pas de compte ? ») en lien texte tertiaire — jamais deux boutons de même poids.
- Proximité : logo + titre + sous-titre forment un « lock-up » avec un espacement constant ; ce qui va ensemble est rapproché, le reste écarté.
- Dashboards : « interface design is not web design » — « tools should be simple, easy, straightforward, and sometimes even a little bit more boring ». Le contenu est le point focal : pas de grande barre supérieure, pas de barre latérale qui attire l'œil, pas de logo/avatar surdimensionnés (« once in the interface, it's not a branding moment anymore »).
- Surutilisation de la couleur de marque dans les graphiques = tout se ressemble ; les pastilles de notification dans la couleur de marque deviennent illisibles. Retirer la marque, laisser la couleur « ponctuer » (punch) les données.
- Pas besoin de « widgetiser » (mettre chaque chose dans une boîte) : des sections avec titres réutilisables suffisent.
- Signal d'amateur : ombres portées lourdes partout et traits de séparation ajoutés = la personne ne maîtrise pas couleur/contraste.
- Barre latérale sombre : acceptable, mais les items inactifs doivent rester lisibles ; « Déconnexion » en rouge est une erreur (rouge/vert = couleurs système réservées aux états).
- Bordure de carte trop claire = séparation illisible ; le prix n'a pas besoin de la couleur de marque ; bleu/accent uniquement sur l'action principale et quelques boutons-icônes tertiaires.
- Senior : « the design is out of the way… the tool is serving the content, not the brand ». Un style assumé (ombres épaisses néo-brutalistes) ne marche que s'il est réservé aux zones d'attention, jamais sur tous les éléments.


# Mesures en direct de produits de référence (sonde getComputedStyle dans Chrome, 08/11/2026)

## Vercel (vercel.com, connecté, page 404 d'équipe — chrome du dashboard)
- Police : Geist Sans ; corps 16 px / interligne 24 px ; textes 14 px (dominant) et 13 px.
- Couleurs de texte : #171717 (principal), #4D4D4D (secondaire), #A8A8A8 (tertiaire/désactivé), bleu oklch pour les liens. Fond de page #FAFAFA.
- Bordures : rgba(0,0,0,0.08) — UNE seule couleur de bordure, noir à 8 %.
- Boutons : 32 px et 36 px de haut, rayon 6 px, 14 px, poids 500, bordure #EBEBEB, aucune ombre ; bouton primaire noir #171717. Pilules (rayon ∞) pour les sélecteurs.
- Icônes : 12 / 14 / 16 px. Aucune ombre portée détectée sur la page.
- Titre 404 : 72 px, poids 600, letter-spacing −0,06 em (−4,32 px), interligne 1.

## Stripe (dashboard.stripe.com/login, non connecté — page de connexion)
- Police : Söhne (sohne-var) ; corps 14 px ; textes 12 / 13 / 14 / 16 / 20 / 22 px.
- Couleur de texte : rgb(60,66,87) = gris TEINTÉ bleu (pas de gris neutre), titres rgb(26,31,54).
- Bordures : rgb(212,222,233) (gris-bleu clair) et rgb(236,241,246) (séparateur très léger).
- Champs : 44 px de haut, rayon 6 px, 16 px ; focus = anneau 1 px violet (box-shadow 0 0 0 1px) + ombre, pas d'outline épais.
- Boutons : 40–44 px, rayon 6 px, 16 px, poids 500 ; primaire violet rgb(103,93,255) ; petits boutons 24 px / 12 px / 600.
- Rayons présents : 4, 5, 6, 12 px. Ombres : anneaux 1 px (box-shadow en « ring »), pas d'ombres floues.

## Vercel (vercel.com/<équipe>, connecté — chrome du dashboard, écran 2FA)
- Barre latérale : 256 px, fond #FAFAFA (= fond de page), bordure droite 1 px #EBEBEB — CLAIRE, pas sombre.
- Titres : H2 24 px / 600 / letter-spacing −0,04 em / interligne 32 px ; H3 14 px / 500.
- Texte : 16 (corps) / 14 (UI) / 13 / 12 / 11 px. Couleurs : #171717, #4D4D4D, #7D7D7D, #8F8F8F (4 niveaux de gris neutre pur).
- Boutons : 32 px (compact) et 36 px (standard), rayon 6 px, 14 px / 500, bordure #EBEBEB, fond blanc ou transparent, ombre = anneau 1 px rgba(0,0,0,0.08) au plus.
- Champs : 36 px, 14 px, bordure #EBEBEB. Rayons rencontrés : 4 / 6 / 8 / 12 px + pilules.
- Icônes : 12 / 14 / 16 / 20 px, stroke 2 quand il est déclaré.

## Supabase (supabase.com/dashboard, page de connexion)
- Police Inter, corps 15 px / interligne 22,5 px ; textes 12 / 13 / 15 px.
- Titre H1 28 px / 600 / −0,025 em ; H2 13 px / 600 (intitulés de section = petits).
- Boutons 42 px (formulaire de connexion, tactile) rayon ~10 px ; petits boutons 26 px / 12 px rayon 8 px.
- Champs 34 px, rayon 8 px, 13 px, fond noir à 1,5 %, bordure noir à 14,6 %.
- Bordures : noir à ~14 % (oklch 0.1 / 0.146) — une seule teinte. Couleurs de texte : noir, gris 52 %, gris 39 %.

## shadcn/ui — exemple Dashboard (ui.shadcn.com/examples/dashboard, style par défaut 2026)
- Police Geist 16 px ; UI en 14 px, secondaires 12 / 12,8 px, KPI 18 px+.
- Barre latérale 256 px, fond lab(98.26) ≈ #F9F9F9, bordure ≈ #E5E5E5 (neutral-200) — claire.
- Boutons 32 px (défaut !), 28 px (xs), 36 px (groupe), rayon 8–10 px ; aucune ombre portée (anneaux transparents).
- Lignes de tableau : 40 px (compact) et 53 px.
- Texte secondaire lab(48.5) ≈ #737373 (neutral-500) ; muted = noir à 70 %.
- Icônes 12 / 14 / 16 / 18 / 20 px, stroke 2 (lucide).
- Cartes KPI : libellé 14 px gris + badge de variation à droite (« +12,5 % » avec flèche, bordure fine), valeur 24–30 px semibold tabulaire, puis une ligne de tendance 14 px et une description 12–14 px grise. Pas d'icône dans un rond coloré.

## GitHub (github.com, dépôt du projet — Primer en production)
- Police Mona Sans VF, corps 14 px / interligne 21 px ; textes 12 / 13,6 / 14 / 16 / 20 px.
- Titres : H1 32 / 600 ; H2 24 / 600 ; H3 20 / 600 ; H2 de section 16 / 600 — letter-spacing normal.
- Boutons : 28 px (small) et 32 px (medium), rayon 6 px, 14 px / 500 ; secondaire fond #F6F8FA bordure #D1D9E0 + ombre 0 1px 0 rgba(31,35,40,.04) ; primaire vert #1F883D avec bordure noire à 15 % + ombre 0 1px 1px .04 + 0 1px 2px .03 (deux couches minuscules).
- Lignes de liste de fichiers : 40–41 px. Bordures : #D1D9E0 (et la même à 70 %). Texte : #1F2328 (principal), #59636E (secondaire), liens #0969DA.
- Badges (Label/State) : 20 px de haut, 12 px / 500, pilule, bordure rgba(209,217,224,.7) et texte gris — peu de couleur.

## Plausible (plausible.io/plausible.io, dashboard public)
- Police système (ui-sans-serif), 16 px / 24 px ; UI 14 px, légendes 12 px, KPI 18–19 px.
- Neutres zinc légèrement froids (oklch 0.274 0.006 286 = zinc-800 pour le texte, 0.552 = zinc-500 secondaire, bordure 0.92 = zinc-200). Un seul accent indigo pour la courbe et le bouton Sign up.
- Boutons 32 px, rayon 6 px, 14 px / 400, sans ombre. Rayons : 2 / 4 / 6 px.
- Tuiles KPI : OVERLINE 11–12 px capitales espacées grises, valeur 18–20 px semibold, variation « ↗ 24 % » en petit, séparées par des traits verticaux fins dans une carte unique (pas 6 cartes), KPI sélectionné = fond gris très léger.
- Icônes lucide 16 / 18 px stroke 1,5.

## Linear (linear.app, page d'accueil — variables CSS réelles du produit, thème sombre)
- Police « Inter Variable » ; UI 13–14 px ; poids 510 / 590 (variable, légèrement plus que 500/600) ; titres avec letter-spacing −0,022 em.
- --color-text-primary #F7F8F8, secondary #D0D6E0, tertiary #8A8F98 (3 niveaux) ; --color-border-primary #23252A ; accent #7170FF ; fond #08090A.
- --shadow-low 0 2px 4px rgba(0,0,0,.10) ; --shadow-medium 0 4px 24px rgba(0,0,0,.20) ; anneaux 1–2 px rgba(0,0,0,.2) ; --speed-quickTransition .1s.
- Boutons 28 px (défaut) et 32 px, 13 px, rayon 8 px ou pilule, fonds blanc à 2–4 % — pas de bordure visible.
- App visible dans la capture : barre latérale ~220 px avec items 28–32 px, icônes 16 px, intitulés de groupe « Workspace » en 12 px gris, fiche d'issue = contenu + colonne droite de propriétés, « Activity » en bas.
