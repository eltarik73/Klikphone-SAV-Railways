# Mouvement, états et micro-interactions — règles et recettes Tailwind 3.4

Sources : Emil Kowalski (animations.dev, Sonner, Vaul), Rauno Freiberg, Linear, Apple HIG, Material 3, NN/g, WCAG, Josh Comeau, Radix/shadcn, Primer, Stripe, Carbon. 67 pages lues le 8 novembre 2026.

## 2. Règles consolidées

### A. Durées et courbes
1. Tout < 300 ms dans une app ; 150-200 ms est la norme pour menus, popovers, badges. — emilkowal.ski/ui/you-dont-need-animations ; nngroup.com/articles/animation-duration
2. Micro-retour (case, interrupteur, badge) : ~100 ms. — nngroup.com/articles/animation-duration ; m3 tokens (short2)
3. Modale / panneau : entrée 200-300 ms, sortie 150-200 ms (sortie plus courte que l'entrée). — nngroup animation-duration ; m3 applying-easing-and-duration
4. > 400 ms seulement pour un grand déplacement physique (drawer tactile plein écran : 500 ms, courbe iOS `cubic-bezier(0.32,0.72,0,1)`). — emilkowal.ski/ui/building-a-drawer-component ; m3 (long2)
5. Entrée = ease-out (ou `cubic-bezier(0,0,0.2,1)` Tailwind ; M3 decelerate `cubic-bezier(0,0,0,1)`). — emilkowal.ski great-animations ; tailwindcss.com/docs/transition-timing-function
6. Sortie définitive = ease-in court (M3 accelerate `cubic-bezier(0.3,0,1,1)`, 200 ms) ; Emil préfère ease-out partout : les deux sont acceptables, jamais ease-in pour une **entrée**. — m3 applying ; emilkowal.ski/ui/7-practical-animation-tips
7. Déplacement d'un élément déjà visible = ease-in-out (M3 standard `cubic-bezier(0.2,0,0,1)`). — emilkowal.ski/ui/good-vs-great-animations
8. Linéaire uniquement pour une progression (barre, spinner). — nngroup animation-duration ; joshwcomeau.com/animation/css-transitions
9. Courbe personnalisée dès qu'une animation dépasse un simple hover (`ease-[cubic-bezier(…)]`). — emilkowal.ski good-vs-great
10. Jamais `scale(0)` au départ : 0,93-0,97 → 1. — emilkowal.ski/ui/7-practical-animation-tips
11. `transform-origin` côté déclencheur pour tout popover/menu. — emilkowal.ski good-vs-great
12. Choisir la durée la plus courte qui ne choque pas ; en cas de doute, raccourcir. — nngroup animation-duration

### B. Ce qu'on anime (et ce qu'on n'anime pas)
13. Seulement `opacity` et `transform` ; jamais height/padding/margin/width/top. — emilkowal.ski great-animations ; joshwcomeau
14. `transition-colors`/`transition-opacity`/`transition-transform` ciblés, jamais `transition-all`. — joshwcomeau ; tailwindcss.com/docs/transition-property
15. Transitions interruptibles (`transition`, pas `@keyframes`) pour tout ce que l'utilisateur peut rouvrir/refermer vite. — emilkowal.ski building-a-toast-component
16. Zéro animation sur les actions au clavier (raccourci, palette ⌘K, navigation J/K). — emilkowal.ski great-animations ; rauno.me/craft/interaction-design
17. Zéro transition de page dans un outil métier ; le contenu remplace le contenu. — rauno.me/craft/interaction-design (« I removed motion from core interactions ») ; Apple HIG Motion
18. Pas d'animation au défilement (reveal, fade-in-up) : le scroll est le seul mouvement légitime. — w3.org SC 2.3.3 ; web.dev/prefers-reduced-motion
19. Pas d'animation des données (chiffres qui comptent, graphiques qui poussent) sur un dashboard de travail. — emilkowal.ski good-vs-great
20. Le mouvement expressif est réservé à ce qui arrive une fois (première connexion), jamais rejoué à chaque chargement. — rauno.me/craft/novelty
21. Un élément apparaît d'où il vient (menu sous son bouton, panneau depuis son bord). — rauno.me/craft/interaction-design
22. Décalage en cascade (stagger) au plus 3-5 éléments, 20-30 ms d'écart, et uniquement à un premier affichage. — rauno.me/craft/depth (principe) ; emil (< 300 ms total)

### C. Hover, focus, active
23. Survol = changement de fond ou de couleur subtil (`hover:bg-gray-50`), jamais `scale`, jamais d'ombre qui « décolle » une carte ou une ligne. — emilkowal.ski/ui/7-practical-animation-tips ; pencilandpaper.io data tables
24. Survol vu des dizaines de fois par jour : sans transition, ou 100-150 ms max. — emilkowal.ski you-dont-need-animations
25. Pression : `active:scale-[0.97]` (ou `active:bg-*` plus foncé) + réponse immédiate. — emilkowal.ski 7-practical-animation-tips
26. Contenu révélé au survol (infobulle, carte) : indice en 100 ms, contenu après 300-500 ms d'immobilité, fermeture après > 500 ms ; infobulles voisines instantanées. — nngroup.com/articles/timing-exposing-content ; emil 7 tips
27. Menu survolé : `transition-delay` 300 ms à la fermeture, 0 à l'ouverture (franchir l'espace vide). — joshwcomeau
28. Déclencher le hover sur un conteneur et animer un enfant (anti « doom flicker »). — joshwcomeau
29. Hover seulement là où il existe : `@media (hover: hover)` (iPad au comptoir = tactile). — tailwindcss.com/docs/hover-focus-and-other-states
30. Focus clavier : anneau 2 px, décalé de 2 px, contraste ≥ 3:1, via `outline`, visible seulement avec `:focus-visible`. — w3.org SC 2.4.13 ; sarasoueidan.com/blog/focus-indicators
31. Ne jamais `outline: none` sans remplaçant ; le focus ne doit pas être caché sous une barre collante. — sarasoueidan.com
32. Ne pas se fier à la couleur seule pour un état (icône, texte, bordure en plus). — nngroup error-message-guidelines

### D. Chargement
33. < 1 s : rien du tout ; 1-10 s : indicateur indéterminé ; > 10 s : pourcentage + annulation. — nngroup response-times-3-important-limits ; nngroup skeleton-screens ; primer.style loading
34. Délai de 200-300 ms avant d'afficher un loader, puis 400 ms minimum d'affichage (pas de clignotement). — docs.stripe.com/stripe-apps/patterns/loading ; design-system.learningequality.org/loaders
35. Squelette = chargement initial d'une page/liste, formes qui reproduisent la mise en page réelle ; spinner = un module ; barre = envoi/traitement. — nngroup skeleton-screens ; carbondesignsystem loading
36. Jamais de squelette pour un bouton, un champ, une modale, un toast, un menu. — carbondesignsystem.com/patterns/loading-pattern
37. Shimmer discret ou pulsation lente (`animate-pulse`), coupé sous reduced-motion. — nngroup skeleton-screens ; web.dev
38. Bouton en cours : largeur conservée, libellé visible, spinner 16 px à la place de l'icône, `aria-busy`/`aria-disabled`, pas de double envoi. — primer.style button ; docs.stripe.com loading
39. Indicateur au plus près de ce qu'il remplace, sans décalage de mise en page ; la barre d'onglets reste visible pendant le chargement d'un onglet. — primer.style loading ; docs.stripe.com
40. Un spinner un peu plus rapide (≈ 0,8 s/tour) paraît plus court. — emilkowal.ski you-dont-need-animations
41. Annonce unique `role="status"` pour un groupe de squelettes, `aria-busy="true"` pendant la mise à jour. — primer.style loading

### E. États vides
42. Jamais un conteneur vide : un titre court, une phrase (pourquoi c'est vide / ce qui apparaîtra), une action directe. — nngroup empty-state-interface-design ; carbondesignsystem empty-states
43. Illustration optionnelle ; texte seul dans les petites zones et quand plusieurs états vides cohabitent. — carbondesignsystem empty-states
44. Distinguer « ça charge », « aucun résultat pour ce filtre », « rien ici pour l'instant » ; jamais « Aucun résultat » pendant le chargement. — nngroup empty-state
45. Recherche sans résultat : proposer d'élargir/retirer les filtres ; ton direct, sans humour ni jargon. — carbondesignsystem empty-states
46. L'état vide remplace le composant (pas un tableau vide avec en-têtes). — carbondesignsystem empty-states

### F. Erreurs
47. Erreur de champ : à côté du champ, icône + couleur + texte, dit comment corriger, saisie conservée. — nngroup error-message-guidelines ; nngroup indicators-validations-notifications
48. Valider à la soumission ou à la sortie d'un champ rempli, jamais pendant la frappe ni sur un champ quitté vide. — nngroup error-message-guidelines
49. Jamais une erreur bloquante dans un toast ; bannière inline persistante ou modale si grave. — nngroup indicators-validations-notifications ; design.deliveroo.net toasts
50. Échec d'une action optimiste : retour discret à l'état précédent + message inline, pas de dialogue. — smashingmagazine true-lies-of-optimistic-user-interfaces

### G. Succès et sauvegarde
51. Un changement visible à l'écran est sa propre confirmation ; pas de toast pour un statut qui vient de changer sous les yeux. — Apple HIG Feedback ; m3 snackbar
52. « Enregistré » inline à un endroit fixe (près du titre ou du bouton), horodaté si autosave ; états Enregistrement… / Enregistré / Échec explicite. — saasui.design autosave ; grafana.com saga save
53. Bouton Enregistrer toujours visible (même inactif) ; avertir avant de quitter avec des modifications non enregistrées. — grafana.com/developers/saga/patterns/save
54. Confirmer la réussite seulement pour les tâches importantes (envoi au client, facture) ; l'échec, lui, toujours. — Apple HIG Feedback
55. Transition de badge de statut : `transition-colors` 150-200 ms, pas de rebond. — tailwindcss transition-property ; nngroup (100 ms micro)

### H. Toasts
56. Durée 4-6 s (4 s par défaut), pause au survol et onglet caché. — sonner.emilkowal.ski ; m3 snackbar (4-10 s)
57. Position fixe unique, en bas (bottom-right desktop, bottom centré iPad), hors des zones d'action. — sonner ; m3 snackbar
58. Au plus 3 visibles, empilés ; le reste attend. — sonner (visibleToasts: 3) ; m3 (une seule)
59. Une action au plus (« Annuler »), qui garde le toast ouvert jusqu'au clic ; pas de lien, pas d'icône décorative. — sonner toast ; m3 snackbar
60. Balayage pour fermer sur tactile, raccourci clavier (alt+T) pour y accéder, `aria-live` polite. — sonner toaster
61. Entrée 200-400 ms ease-out depuis le bord, sortie 150-200 ms en fondu ; pas de rebond. — emilkowal.ski building-a-toast-component
62. Toast seulement pour l'information passive ; si le message est important, il est aussi inline. — m3 snackbar (« unless there's also inline feedback ») ; nngroup indicators

### I. Modales, panneaux, inline
63. Inline d'abord (édition sur place, ligne dépliée), panneau latéral pour un détail/un formulaire long sans perdre la liste, modale seulement pour une décision bloquante. — nngroup modal-nonmodal-dialog ; m3 side-sheets ; pencilandpaper data tables
64. Modale : ≤ 2 actions, titre = question précise, pas « Êtes-vous sûr ? », action principale à droite, Annuler à gauche, jamais désactivé. — m3 dialogs ; Apple HIG Alerts ; atlassian.design button
65. Modale : fondu + zoom 0,95 → 1 en 200 ms, overlay `bg-black/50` en fondu, sortie plus courte. — shadcn dialog.tsx ; radix animation guide
66. Panneau latéral : glissement depuis le bord, 300 ms ease-out à l'ouverture, 200 ms à la fermeture, largeur fixe (≈ 400-480 px), bouton fermer visible, Échap, défilement interne seulement. — shadcn sheet.tsx (500/300) ; m3 side-sheets
67. Focus piégé dans la modale, rendu au déclencheur à la fermeture ; Title/Description annoncés. — radix-ui.com dialog
68. Pas de défilement dans une modale ; sinon titre et boutons épinglés. — m3 dialogs
69. Tiroir tactile (iPad) : poignée, glisser pour fermer piloté par la vitesse, 500 ms courbe iOS, fond assombri. — emilkowal.ski building-a-drawer-component ; vaul api

### J. Confirmation et annulation
70. Action destructive courante et réversible : pas de confirmation, un « Annuler » immédiat (toast 5-8 s) + corbeille/historique. — alistapart neveruseawarning ; Apple HIG Alerts ; nngroup confirmation-dialog
71. Confirmation seulement pour le rare et irréversible (supprimer un client avec ses tickets, envoyer une facture). — nngroup confirmation-dialog ; Apple HIG Alerts
72. Le dialogue nomme l'objet (« Supprimer le ticket #4821 de M. Martin ? ») et ses boutons disent le résultat (« Supprimer le ticket » / « Conserver »). — nngroup confirmation-dialog
73. Bouton destructif rouge, à droite, jamais focus par défaut ; Annuler par Échap. — Apple HIG Alerts ; m3 dialogs
74. Pour le très grave et très rare : saisir un mot, ou un second utilisateur. — nngroup confirmation-dialog
75. Ne pas confirmer ce que l'utilisateur vient de choisir délibérément (ex. clic sur « Clôturer » dans un menu explicite). — Apple HIG Alerts (style destructif) ; HIG Feedback

### K. UI optimiste
76. Optimiste pour les actions binaires à > 97 % de succès et < 2 s de réponse : changer un statut, cocher, épingler, ajouter une note. — smashingmagazine optimistic-ui
77. Réponse visible en < 100 ms, requête en arrière-plan, retour discret si échec dans les 2 s. — smashingmagazine ; nngroup response-times
78. Pas d'optimisme pour paiement, envoi WhatsApp/SMS/email, impression, suppression définitive : spinner dans le bouton puis confirmation. — smashingmagazine (inférence des critères)
79. Données locales/cache et mises à jour granulaires (une ligne, pas la liste) : c'est ce qui rend Linear « instantané ». — dev.to why-linear-feels-fast

### L. Raccourcis clavier et palette
80. ⌘K/Ctrl+K ouvre la palette ; recherche floue sur actions **et** objets (tickets, clients) ; groupes avec en-têtes ; état vide et chargement propres. — maggieappleton.com/command-bar ; github.com/pacocoursey/cmdk
81. Raccourci affiché à droite de chaque commande en `<kbd>` ; `?` ou ⌘/ liste les raccourcis. — maggieappleton.com (Todoist) ; Apple HIG Keyboards
82. Respecter les standards (⌘F, ⌘S, ⌘Z, Échap ferme), ne pas détourner ; quelques raccourcis maison seulement pour les actions les plus fréquentes. — Apple HIG Keyboards
83. Palette : ouverture sans animation ou fondu 100 ms, flèches bouclantes, Entrée exécute, Échap revient d'un niveau puis ferme. — emil you-dont-need-animations (Raycast) ; cmdk README
84. Éviter la touche Contrôle sur Mac ; sur PC Ctrl remplace ⌘ (afficher la bonne touche selon la plateforme). — Apple HIG Keyboards

### M. Reduced motion
85. Sous `prefers-reduced-motion: reduce` : couper déplacements, zooms, stagger, shimmer ; garder fondus courts et changements de couleur (non considérés comme mouvement). — w3.org SC 2.3.3 ; web.dev/prefers-reduced-motion
86. Écrire les mouvements en opt-in (`motion-safe:`) plutôt qu'en « annulation » (`motion-reduce:`). — tailwindcss hover-focus-and-other-states
87. Les indicateurs de chargement et retours fonctionnels restent (sans rotation agressive : `motion-reduce:animate-none` + texte « Chargement… »). — web.dev ; primer loading
88. En JS : `matchMedia('(prefers-reduced-motion: reduce)')` pour désactiver springs/transitions programmatiques. — web.dev

### N. Scroll, sticky, tableaux
89. En-tête de tableau collant, opaque, séparé par une bordure fine ; première colonne figée si défilement horizontal. — pencilandpaper data tables ; nngroup sticky-headers
90. Barre d'actions collante en bas d'un formulaire long ou d'une sélection multiple, visible seulement quand elle a un sens. — pencilandpaper ; grafana save
91. Hauteurs de ligne 40/48/56 px, chiffres tabulaires alignés à droite, séparateurs légers plutôt que zébrures. — pencilandpaper data tables
92. Une barre qui se cache au scroll réapparaît en 300-400 ms après quelques pixels de remontée ; pas d'en-tête translucide. — nngroup sticky-headers
93. Survol de ligne : fond légèrement plus sombre + actions révélées, sans déplacement du contenu. — pencilandpaper ; emil 7 tips

### O. Anti-template-IA (ce qui trahit le générateur)
94. Pas de fade-in-up au scroll, pas de « reveal » des sections : le contenu est là, point. — w3.org 2.3.3 ; emil you-dont-need-animations
95. Pas de carte qui grossit, flotte ou gagne une grosse ombre au survol ; un fond de 2-4 % plus sombre suffit. — emil 7 tips ; pencilandpaper
96. Pas de dégradés animés, d'aurores, de « glow » pulsant, de particules. — web.dev/prefers-reduced-motion (liste des effets à couper)
97. Pas d'animation de chiffres (compteurs) ni de graphiques qui poussent au montage. — emil good-vs-great
98. Pas de transition de route, pas de spinner plein écran entre deux pages ; les onglets restent visibles. — rauno interaction-design ; docs.stripe.com loading
99. Pas de toast pour tout : un toast par événement non visible à l'écran, jamais pour un succès déjà visible. — Apple HIG Feedback ; m3 snackbar
100. Pas d'illustration générique dans chaque état vide ; une phrase utile et une action. — carbondesignsystem empty-states ; nngroup empty-state
101. Pas de « Êtes-vous sûr ? » générique ; un « Annuler » après coup, ou un dialogue qui nomme l'objet. — alistapart ; nngroup confirmation-dialog
102. Pas de `transition-all duration-300` partout ; chaque transition nomme sa propriété et dure 100-200 ms. — joshwcomeau ; tailwind transition-property
103. Pas de rebond (`ease-[cubic-bezier(.68,-.55,.265,1.55)]`, `animate-bounce`) sur quoi que ce soit de fonctionnel. — m3 applying (accelerate/decelerate) ; nngroup animation-duration
104. Le soin se sent après quelques minutes (alignements, densité, cohérence) plus qu'il ne se voit en une capture. — linear.app how-we-redesigned-the-linear-ui
105. Une seule famille d'easing, deux ou trois durées (100/150/200 ms) dans tout le produit ; les tokens M3 ou Tailwind suffisent. — m3 tokens-specs ; tailwind

---

## 3. Recettes Tailwind 3.4 (sans librairie UI ; Radix primitives optionnelles)

Préambule `tailwind.config.js` (une fois) :
```js
// tailwind.config.js
module.exports = {
  future: { hoverOnlyWhenSupported: true }, // hover: → @media (hover:hover) (iPad)
  theme: { extend: {
    transitionTimingFunction: {
      'out-std': 'cubic-bezier(0, 0, 0.2, 1)',        // entrées (Tailwind ease-out)
      'in-std':  'cubic-bezier(0.3, 0, 1, 1)',        // sorties (M3 accelerate)
      'ios':     'cubic-bezier(0.32, 0.72, 0, 1)',    // tiroir tactile (Vaul)
    },
    keyframes: {
      'fade-in':  { from: { opacity: 0 }, to: { opacity: 1 } },
      'fade-out': { from: { opacity: 1 }, to: { opacity: 0 } },
      'pop-in':   { from: { opacity: 0, transform: 'scale(.96)' }, to: { opacity: 1, transform: 'scale(1)' } },
      'pop-out':  { from: { opacity: 1, transform: 'scale(1)' },  to: { opacity: 0, transform: 'scale(.96)' } },
      'slide-in-right':  { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
      'slide-out-right': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(100%)' } },
      'toast-in': { from: { opacity: 0, transform: 'translateY(16px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
    },
    animation: {
      'fade-in': 'fade-in 150ms cubic-bezier(0,0,0.2,1) both',
      'fade-out': 'fade-out 120ms cubic-bezier(0.3,0,1,1) both',
      'pop-in': 'pop-in 180ms cubic-bezier(0,0,0.2,1) both',
      'pop-out': 'pop-out 120ms cubic-bezier(0.3,0,1,1) both',
      'slide-in-right': 'slide-in-right 280ms cubic-bezier(0,0,0.2,1) both',
      'slide-out-right': 'slide-out-right 200ms cubic-bezier(0.3,0,1,1) both',
      'toast-in': 'toast-in 240ms cubic-bezier(0,0,0.2,1) both',
    },
  } },
};
```

### 3.1 Bouton en chargement (largeur conservée, spinner 16 px, anti double-clic)
```jsx
<button type="submit" disabled={saving} aria-busy={saving}
  className="relative inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white
             transition-colors duration-150 hover:bg-brand-700 active:scale-[0.97] motion-safe:transition-transform
             focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600
             disabled:cursor-not-allowed disabled:opacity-70">
  <span className={saving ? 'invisible' : ''}>Enregistrer</span>
  {saving && (
    <span className="absolute inset-0 grid place-items-center" aria-hidden="true">
      <svg className="h-4 w-4 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-90" d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  )}
  {saving && <span className="sr-only">Enregistrement en cours</span>}
</button>
```
Le libellé devient invisible (pas retiré) : la largeur ne bouge pas. Hook conseillé : n'afficher le spinner qu'après 200 ms (`useDelayedFlag(saving, 200)`).

### 3.2 Squelette qui reflète la ligne de tableau (délai 300 ms, pulsation lente)
```jsx
// À monter seulement si le chargement dure déjà > 300 ms (useDelayedFlag(loading, 300))
<tr className="animate-pulse motion-reduce:animate-none [animation-duration:1.6s]" aria-hidden="true">
  <td className="px-3 py-3"><div className="h-3.5 w-16 rounded bg-gray-200" /></td>
  <td className="px-3 py-3"><div className="h-3.5 w-40 rounded bg-gray-200" /></td>
  <td className="px-3 py-3"><div className="h-5 w-24 rounded-full bg-gray-200" /></td>
  <td className="px-3 py-3 text-right"><div className="ml-auto h-3.5 w-12 rounded bg-gray-200" /></td>
</tr>
// Une seule annonce pour tout le tableau :
<p role="status" className="sr-only">{loading ? 'Chargement des tickets…' : `${rows.length} tickets`}</p>
```

### 3.3 Toast (4 s, pause au survol, action « Annuler », 3 visibles)
```jsx
<ol aria-label="Notifications" className="fixed bottom-6 right-6 z-50 flex w-80 flex-col gap-2">
  {toasts.slice(-3).map(t => (
    <li key={t.id} role="status" aria-live="polite"
        onMouseEnter={() => pause(t.id)} onMouseLeave={() => resume(t.id)}
        className={`flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm shadow-md
                    motion-safe:animate-toast-in ${t.leaving ? 'motion-safe:animate-fade-out' : ''}`}>
      <span className="flex-1">{t.message}</span>
      {t.onUndo && (
        <button onClick={() => { t.onUndo(); dismiss(t.id); }}
                className="rounded px-2 py-1 font-medium text-brand-700 transition-colors duration-150 hover:bg-brand-50
                           focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600">
          Annuler
        </button>
      )}
    </li>
  ))}
</ol>
```
`setTimeout` de 4 000 ms (8 000 ms s'il y a « Annuler »), suspendu sur `mouseenter` et `document.hidden`. Suppression du DOM après `animationend`.

### 3.4 Panneau latéral (drawer) — Radix Dialog ou `<dialog>` natif
```jsx
<Dialog.Portal>
  <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40
                             data-[state=open]:motion-safe:animate-fade-in data-[state=closed]:motion-safe:animate-fade-out" />
  <Dialog.Content aria-describedby={undefined}
    className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col bg-white shadow-xl outline-none
               data-[state=open]:motion-safe:animate-slide-in-right data-[state=closed]:motion-safe:animate-slide-out-right">
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-5">
      <Dialog.Title className="text-base font-semibold">Ticket #4821</Dialog.Title>
      <Dialog.Close className="grid h-11 w-11 place-items-center rounded-lg text-gray-500 transition-colors duration-150 hover:bg-gray-100
                               focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600" aria-label="Fermer">
        <X className="h-5 w-5" />
      </Dialog.Close>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
    <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-white px-5 py-3">{actions}</footer>
  </Dialog.Content>
</Dialog.Portal>
```
Entrée 280 ms ease-out, sortie 200 ms ; Radix attend la fin de l'animation `closed` avant de démonter.

### 3.5 Modale de confirmation (nomme l'objet, destructif à droite, jamais focus par défaut)
```jsx
<Dialog.Portal>
  <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:motion-safe:animate-fade-in data-[state=closed]:motion-safe:animate-fade-out" />
  <Dialog.Content onOpenAutoFocus={e => { e.preventDefault(); cancelRef.current?.focus(); }}
    className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-6 shadow-xl outline-none
               data-[state=open]:motion-safe:animate-pop-in data-[state=closed]:motion-safe:animate-pop-out">
    <Dialog.Title className="text-base font-semibold">Supprimer le ticket #4821 de M. Martin ?</Dialog.Title>
    <Dialog.Description className="mt-1 text-sm text-gray-600">Les notes, photos et l'historique seront supprimés. Cette action est définitive.</Dialog.Description>
    <div className="mt-6 flex justify-end gap-2">
      <Dialog.Close ref={cancelRef} className="h-10 rounded-lg border border-gray-300 px-4 text-sm transition-colors duration-150 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">Conserver</Dialog.Close>
      <button onClick={onDelete} className="h-10 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-red-700 active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600">Supprimer le ticket</button>
    </div>
  </Dialog.Content>
</Dialog.Portal>
```
Pour une suppression courante et réversible, remplacer tout cela par un toast « Ticket archivé — Annuler » (recette 3.3).

### 3.6 État vide (titre + une phrase + une action, sans illustration)
```jsx
<div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-gray-300 px-6 py-10">
  <h3 className="text-sm font-semibold text-gray-900">Aucun ticket en attente de pièce</h3>
  <p className="text-sm text-gray-600">Les tickets passeront ici dès qu'une commande de pièce sera créée.</p>
  <button className="mt-2 h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700
                     focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
    Commander une pièce
  </button>
</div>
// Variante « filtre sans résultat » : « Aucun ticket ne correspond à “iPhone 12 + Clôturé” » + bouton « Effacer les filtres ».
```

### 3.7 Anneau de focus global (2 px, décalé de 2 px, clavier seulement)
```css
/* index.css — s'applique à tout élément focalisable sans classe à ajouter */
@layer base {
  :focus-visible { @apply outline-none ring-2 ring-brand-600 ring-offset-2 ring-offset-white; }
  .dark :focus-visible { @apply ring-offset-sidebar; }
  @media (forced-colors: active) { :focus-visible { outline: 2px solid CanvasText; outline-offset: 2px; } }
}
```
`outline` (pas seulement `box-shadow`) pour survivre au mode contraste élevé ; jamais `outline-none` sans ce remplaçant.

### 3.8 Ligne de tableau : survol, sélection, actions révélées (sans scale)
```jsx
<tr className="group h-12 border-b border-gray-100 transition-colors duration-100 hover:bg-gray-50 aria-selected:bg-brand-50
               data-[clickable]:cursor-pointer" aria-selected={selected} data-clickable>
  <td className="px-3 font-mono tabular-nums text-gray-500">#4821</td>
  <td className="px-3">Martin · iPhone 12</td>
  <td className="px-3"><StatusBadge status="piece_recue" /></td>
  <td className="px-3 text-right tabular-nums">129,00 €</td>
  <td className="w-24 px-3 text-right">
    <div className="flex justify-end gap-1 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
      <IconButton label="Imprimer"><Printer className="h-4 w-4" /></IconButton>
      <IconButton label="Notifier"><MessageSquare className="h-4 w-4" /></IconButton>
    </div>
  </td>
</tr>
```
Sur tactile (`hover:none`), les actions restent visibles. En-tête : `<thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_theme(colors.gray.200)]">`.

### 3.9 Badge de statut qui change (couleur seulement, 150 ms)
```jsx
const STYLE = {
  attente_diag: 'bg-gray-100 text-gray-700 ring-gray-200',
  attente_piece: 'bg-amber-50 text-amber-800 ring-amber-200',
  piece_recue: 'bg-sky-50 text-sky-800 ring-sky-200',
  en_cours: 'bg-brand-50 text-brand-800 ring-brand-200',
  terminee: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
};
<span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset
                  transition-colors duration-150 ${STYLE[status]}`}>
  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
  {LABEL[status]}
</span>
```
Pas de pulsation, pas de zoom : le fond et le texte glissent d'une couleur à l'autre, c'est tout.

### 3.10 Touche `<kbd>` et ligne de palette ⌘K
```jsx
export const Kbd = ({ children }) => (
  <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-gray-300 bg-gray-50 px-1 font-sans text-[11px] font-medium text-gray-600 shadow-[inset_0_-1px_0_theme(colors.gray.300)]">
    {children}
  </kbd>
);
// Ligne de palette (cmdk) : surbrillance sans animation, raccourci à droite
<Command.Item value="nouveau ticket" onSelect={creerTicket}
  className="flex h-10 cursor-default items-center gap-3 rounded-md px-3 text-sm
             data-[selected=true]:bg-gray-100 aria-disabled:opacity-50">
  <Plus className="h-4 w-4 text-gray-500" />
  <span className="flex-1">Nouveau ticket</span>
  <span className="flex gap-1"><Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd><Kbd>N</Kbd></span>
</Command.Item>
```
Ouverture de la palette : `animate-fade-in` 100 ms au plus, ou rien ; fermeture instantanée.

### 3.11 Hook utilitaire : retour différé (anti-clignotement) et reduced motion
```js
// useDelayedFlag(flag, 300) : true seulement si flag reste vrai > 300 ms, puis 400 ms minimum
export function useDelayedFlag(flag, delay = 300, minVisible = 400) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let t;
    if (flag) t = setTimeout(() => setShown(true), delay);
    else if (shown) t = setTimeout(() => setShown(false), minVisible);
    return () => clearTimeout(t);
  }, [flag]); // eslint-disable-line
  return shown;
}
export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
```

---

## 4. Chiffres à retenir (feuille d'aide-mémoire)

| Élément | Durée | Courbe | Source |
|---|---|---|---|
| Hover / badge / case | 0-150 ms | `transition-colors`, ease par défaut | Emil 7 tips ; NN/g duration |
| Pression de bouton | instantané, `scale(0.97)` | — | Emil 7 tips |
| Infobulle | délai 300-500 ms, 125 ms ease-out, voisines 0 ms | ease-out | NN/g timing ; Emil 7 tips |
| Menu / popover | 150-200 ms, origine côté déclencheur | ease-out | Emil you-dont-need ; M3 short4 |
| Modale | 200 ms in (fade + zoom .95), 120-150 ms out | ease-out / ease-in | shadcn dialog ; M3 |
| Panneau latéral | 250-300 ms in, 200 ms out | ease-out / accelerate | shadcn sheet ; M3 applying |
| Tiroir tactile | 500 ms | `cubic-bezier(.32,.72,0,1)` | Vaul |
| Toast | in 240-400 ms, affiché 4 s (8 s avec Annuler), out 150 ms | ease-out | Sonner ; M3 snackbar |
| Loader | apparaît après 300 ms, reste 400 ms min | — | Stripe ; Learning Equality |
| Seuils d'attente | < 1 s rien ; 1-10 s indicateur ; > 10 s % | — | NN/g response times |
| Focus | ring 2 px, offset 2 px, 3:1 | — | WCAG 2.4.13 ; Soueidan |
| Clavier / palette / navigation | 0 ms | — | Emil ; Rauno ; Apple HIG |
