# Le « look IA » : catalogue des signes qui trahissent une interface générée, et leurs correctifs

Sources lues le 8 novembre 2026 (détail par source). La synthèse opérationnelle est dans `SKILL.md` (section « Anti-look IA »).

### A. « AI slop » / le look IA

#### A1. Anthony Hobday — « Visual design rules you can safely follow every time »
- Auteur : Anthony Hobday · URL : https://anthonyhobday.com/sideprojects/saferules/ · 2023 (mis à jour)
- 28 règles, toutes concrètes :
1. Jamais de noir pur ni de blanc pur : presque-noir / presque-blanc.
2. Saturer les neutres avec la teinte de la palette : en HSB, « under 5% saturation is usually enough ».
3. Contraste fort pour l'important (boutons, contenu clé), contraste faible pour la structure (bordures, ombres).
4. Bordures de conteneur : 1 px, plus claires que le conteneur ET le fond en sombre, plus foncées que les deux en clair.
5. Tout doit être aligné avec autre chose ; l'alignement optique bat l'alignement mathématique.
6. Grand texte : baisser interlettrage et interligne ; petit texte : les augmenter.
7. Mesures mathématiquement liées (multiples de 8) ; grille horizontale = 12 colonnes.
8. Ombres portées : flou = 2 × distance (décalage 4 px → flou 8 px) ; opacité plus faible quand l'élément est « proche ».
9. Écart de luminosité (HSB) entre un conteneur et son fond : ≤ 12 % en interface sombre, ≤ 7 % en interface claire (relevé sur ~100 sites bien conçus).
10. Padding extérieur ≥ padding intérieur ; espacement mesuré entre points de fort contraste.
11. Corps de texte ≥ 16 px ; longueur de ligne ≈ 70 caractères (60–80).
12. Boutons : padding horizontal = 2 × padding vertical (plus large que haut).
13. Deux polices au plus ; rayons imbriqués : rayon intérieur = rayon extérieur − écart (30 − 20 = 10).
14. Pas deux séparations dures côte à côte ; pas d'ombres en interface sombre ; ne pas mélanger les techniques de profondeur.
15. Baisser le contraste des icônes posées à côté du texte (elles paraissent plus lourdes).

#### A2. 925Studios — « AI Slop Fonts and Gradients: The Tells That Give Away AI Design »
- Auteur : 925Studios (relu par Yusuf, lead designer) · URL : https://www.925studios.co/blog/ai-slop-design-tells · 2026
1. Les quatre « tells » : police (Inter par défaut), dégradé indigo→violet, mise en page (3 cartes égales, hero sombre à dégradé), copy sans poids (« Build faster. Ship smarter. »).
2. Le dégradé indigo descend de Tailwind `indigo-500` (2019) ; Adam Wathan s'en est excusé publiquement.
3. Icônes à trait fin interchangeables au-dessus de chaque carte = signal IA.
4. Correctifs : choisir la police délibérément (ou associer Inter à une face distinctive), bâtir la palette « from something true about the product », casser le réflexe du triptyque, écrire des titres que seul ce produit pourrait porter.
5. Décider une fois les choix de marque et les appliquer sur toutes les surfaces ; « fixing even one helps ».

#### A3. Capital & Compute — « How to Fix AI Slop in Web Design, Tell by Tell »
- URL : https://capitalandcompute.net/blog/fix-ai-slop-design/ · 25 sept. 2026
1. Deuxième vague de défauts : crème + terracotta (≈ `#D97757`, nommé par le skill Anthropic « frontend-design » du 3 sept. 2026), presque-noir + un néon ; « defaults rather than choices ».
2. Palette : 4 à 6 couleurs hex nommées, chacune avec un rôle, décidées avant le code.
3. Police : une ou deux familles et une échelle ; éviter l'italique coloré sur un seul mot et les étiquettes en capitales espacées.
4. Dégradé de texte : à supprimer ; `rounded-2xl` partout + même ombre douce : varier rayon et élévation selon la hiérarchie (le zéro-rayon « hairline » partout est aussi un tic).
5. Cartes dans des cartes, 3 cartes égales : utiliser des lignes ou des tableaux quand le contenu est tabulaire.
6. Glassmorphism (`backdrop-blur`) et halos sans raison : retirer, ou en garder un seul là où la profondeur a un sens.
7. Copy : nommer ce que fait chaque bouton, supprimer tout chiffre non sourcé (« 10,000% ROI »).
8. Motion : même fade+slide sur chaque section, bounce, compteurs : un seul moment orchestré, le reste lié aux actions.
9. Chrome de gabarit : eyebrows en capitales, chaînes « A · B · C », petits labels monospace, flèches sur chaque lien : à retirer.
10. Catalogues cités : avoid-ai-design 67 tells (P0/P1/P2), antislop 38 règles, Impeccable 61, Hallmark 57.

#### A4. Alan West — « Why Every AI-Built Website Looks the Same (Blame Tailwind's Indigo-500) »
- URL : https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p · 2026
1. Le kit par défaut : `bg-indigo-500`, `text-indigo-600`, `from-indigo-500 to-purple-600`, Inter/system-ui, fond blanc, `border-radius: 0.5rem`, ombres basse opacité, grille de 3 features avec icônes, hero à texte dégradé.
2. Test : ouvrir trois landing pages IA, « at least two » montrent le motif.
3. « The AI isn't designing. It's averaging. » : sans contrainte, le modèle rend la moyenne statistique.
4. Correctifs : palette en hex, site de référence (Stripe, Vercel), police nommée (DM Sans plutôt qu'Inter), layout décrit, design system cité.

#### A5. Robots on Payroll — « how to avoid that 'vibe coded' look »
- Auteur : Jonathan · URL : https://robotsonpayroll.substack.com/p/how-to-avoid-that-vibe-coded-look · 21 juil. 2026
1. Tells nommés : Inter, dégradé violet→bleu, ombres grises sur cartes flottantes, **bordure gauche colorée sur les cartes** (« almost as reliable a sign … as em-dashes »), icônes emoji, layouts prévisibles.
2. Nommer chaque couleur avec son hex dans un `design.md` ; grille d'espacement 8 points.
3. Règles vérifiables à l'œil : « Generous padding » échoue, « buttons are pill-shaped with a hard black shadow » passe.
4. Spécifier états des composants et variante sombre dans des tables de tokens.
5. Audit : « Stop. Re-read design.md … list every violation, fix them all » ; test inverse : coller une capture dans un chat neuf et demander quel builder l'a faite.

#### A6. 21st.dev — « How to Make a Site Not Look AI Generated »
- URL : https://21st.dev/blog/website-not-look-ai-generated · 21 août 2026
1. Tells : hero violet→bleu centré avec deux boutons, copy générique (le plus fort), 3 cartes/3 icônes/3 phrases de même longueur, imagerie stock, aucun chiffre/nom/date, symétrie partout.
2. Correctifs par ordre d'effet : montrer le produit réel ; une phrase spécifique (« Cut deploy time from 12 minutes to 90 seconds ») ; palette non par défaut dont les gris dérivent de la couleur de marque ; polices choisies ; casser la symétrie une fois ; mettre une personne ; adapter les composants empruntés.
3. Test : cacher le logo et lire ; si le texte tient sur le site d'un concurrent, il n'est pas encore à vous.

#### A7. aismells — « Bento Box Sprawl »
- URL : https://aismells.pages.dev/bento-box-sprawl.html · 2026
1. Le motif : chaque contenu devient une tuile arrondie de poids égal (eyebrow, icône, une phrase, parfois un chiffre) ; « Everything becomes a dashboard ».
2. Pourquoi ça sent l'IA : emphase « everything, equally », les cartes sont des « compositional training wheels » qui évitent toute décision de hiérarchie.
3. Résultat : « looks competent from a thumbnail and exhausting at reading distance ».
4. Nuance : le bento est une vraie tendance 2024–2026 ; le problème est la sur-application : « the page … starts having inventory ».

#### A8. pixelslop — « AI Slop Pattern Catalog » (détecteur, 26 motifs visuels + 16 motifs source)
- URL : https://cdn.jsdelivr.net/npm/pixelslop@0.3.8/dist/skill/resources/ai-slop-patterns.md · 2026
1. Texte en dégradé (`background-clip: text`), `backdrop-filter` sur ≥ 3 éléments, fond ≤ 45/255 par canal + halos colorés, cyan sur sombre.
2. Métriques héroïques : nombres seuls ≥ 24 px, ≥ 2 instances ; cartes identiques : ≥ 3 frères de même taille (≥ 100×80) et même structure.
3. Cartes imbriquées : conteneur bordé/ombré de rayon > 4 px dans un autre ; rayon 8–20 px + ombre sur > 4 conteneurs.
4. Bordure accent d'un seul côté ≥ 3 px (autres côtés < 2 px) sur > 2 éléments.
5. Fond `#000000` / `#ffffff` ; > 70 % des blocs centrés ; icône au-dessus de ≥ 3 titres ; titre et paragraphe partageant > 40 % des mots.
6. Tous les boutons « primaires » (≥ 3 boutons quasi identiques) ; ≤ 2 valeurs d'espacement distinctes sur > 6 écarts ; > 6 éléments « cartés » (rayon + bordure/ombre + padding > 8).
7. Texte gris moyen (R 80–180, neutre) sur fond coloré/sombre ; animations rebond (`cubic-bezier` y ≥ 1,3) ; monospace hors code (> 2) ; > 2 modales.
8. Source : `transition: all`, `shadow-md/lg/xl` uniformes, `animate-bounce/pulse`, libellés « Learn More / Get Started » ≥ 3 fois, classes > 200 caractères.
9. Score : 0–1 motif CLEAN, 2–3 MILD, 4–6 SLOPPY, 7+ TERMINAL.

#### A9. Oleh Volostnykh — « Users Can Tell When Your UI Was AI-Generated — And They Don't Like It »
- URL : https://dev.to/olehvolos/users-can-tell-when-your-ui-was-ai-generated-and-they-dont-like-it-33kn · 2026
1. Tells : défauts Tailwind + shadcn, primaire bleu/violet, hero + grille de features à libellés de trois mots, cartes arrondies, sidebar d'icônes, ombres douces.
2. Le vernis casse avec le vrai contenu : noms longs, erreurs, états vides, troncatures.
3. « Kill the defaults » : changer couleur primaire, rayon, police.
4. Concevoir avec des données réelles et des cas limites tôt ; soigner les « trust moments » (onboarding, vide, erreur, chargement) ; ajouter un élément non généré.

#### A10. Daniel Schwarz (LogRocket) — « Linear design: the SaaS design trend that's boring and bettering UI »
- URL : https://blog.logrocket.com/ux-design/linear-design · 7 juin 2025
1. Traits du « Linear design » : mode sombre, palette monochrome à fort contraste, peu d'accents, type gras et direct, dégradés qui apportent de la dimension, contenu séquentiel.
2. Fond sombre : couleur de marque à 1–10 % de luminosité plutôt que noir pur.
3. Critique : « almost every SaaS website looks the same » ; « just flat design with dark mode and gradients ».
4. Le glassmorphism « coming and going », difficile à faire autrement, donc réduit l'originalité.
5. Sortie : garder la linéarité, ajouter couleur unique, typographie plus audacieuse, identité de marque (Raycast).

#### A11. Boone (Brainy Papers) — « Why Every SaaS Looks the Same in 2026 »
- URL : https://brainy.ink/paper/why-every-saas-looks-the-same-2026 · sept. 2026
1. Cinq tells : surface sombre par défaut (≈ 70 % des lancements B2B sur 18 mois), hero en mesh coral→violet→cyan, un mot monospace dans le H1, pilule ⌘K, grain/points/grille fine ; plus la rangée de logos à 60 % d'opacité. Quatre sur cinq = gabarit.
2. Boucle : designer → produit → données d'entraînement → designer suivant ; « the data lacks variance ».
3. Audit en quatre questions (échanger le wordmark avec un concurrent, le choix que vous ne copieriez jamais, produit = marketing ?, décrire la marque sans citer un concurrent).
4. Choisir un ou deux tells à contredire (surface claire saturée, H1 serif, fond chaud) et bâtir l'identité jusque dans les états de chargement.

