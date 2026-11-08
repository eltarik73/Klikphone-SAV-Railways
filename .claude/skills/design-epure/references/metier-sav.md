# Patterns d'interface pour un SAV de réparation (logiciels du métier, service desk, back-office)

Sources : RepairDesk, RepairShopr, Fixably, Orderry, RepairQ, MyRepairApp, Shopmonkey, Tekmetric ; Linear, Zendesk, Intercom, Front, Help Scout, Chatwoot, Jira ; Polaris, Stripe, Square, Qonto. 62 pages lues le 8 novembre 2026.

## 4. Références transverses (valeurs à réutiliser)

Tables de données (Pencil & Paper, « UX pattern analysis: enterprise data tables ») :
- « Left-align text columns », « Right-align numeric columns », pas de centrage ; police à chasse fixe recommandée pour les montants ; le terme commun va dans l'en-tête, la cellule ne garde que le qualifiant.
- **Hauteurs de ligne : 40 px (condensé), 48 px (normal), 56 px (aéré)** ; sélecteur de densité hors table.
- Séparateurs de lignes par défaut ; **pas de zébrures** (elles entrent en conflit avec survol/sélection) ; séparateurs de colonnes « 1px max » gris clair.
- En-tête collant, première colonne figée au défilement horizontal ; **actions de ligne révélées au survol** ; case à cocher au survol, actions de masse affichées seulement une fois une ligne sélectionnée (barre fixée en bas) ; tri par chevron à côté de l'en-tête, « Default to the most recent entries or the entries most needing action » ; détail via **panneau latéral rapide** (« the most scalable option ») plutôt que modale.

Tables (Nielsen Norman Group, « Data tables ») : « The default order of the columns should reflect the importance of the data to the user » ; première colonne = « human-readable record identifier » (pas un ID technique) ; indication claire des filtres actifs ; actions inline seulement pour « one or two actions » ; **éviter les modales pour l'édition** (« A nonmodal side panel allows for the full display (and editing) of a single record »).

Badges de statut (Atlassian Lozenge) : couleurs **sémantiques** pour un sens partagé, couleurs d'accent seulement pour le contenu utilisateur ; « Don't use color alone to signify an important attribute » (texte + éventuellement icône) ; libellés courts (max 200 px, sinon tronqué et illisible) ; « Only capitalize the first letter » ; lozenge pour « workflow status, system state, priority », tag pour la simple classification ; non interactif (sinon un « lozenge dropdown trigger »).

États vides (Atlassian Empty state) : image facultative + **titre obligatoire** + description courte + une action primaire au plus ; largeur 464 px (par défaut) ou 304 px (étroit) ; ton selon le cas (première fois : pédagogique ; tout traité : célébration ; aucun résultat : neutre avec piste).

Cibles tactiles : Apple « Create controls that measure at least 44 points x 44 points » et texte ≥ 11 pt ; WCAG 2.2 : 2.5.8 minimum « 24 by 24 CSS pixels » (sauf espacement suffisant), 2.5.5 enhanced « 44 by 44 CSS pixel ». Pour un iPad de comptoir : **44 pt partout**, 24 px seulement pour des contrôles secondaires très espacés.

Panneau latéral : Help Scout fixe **400 px** ; Zendesk et Intercom le rendent redimensionnable (et Intercom s'est fait reprocher qu'il recouvre la conversation sur petits écrans).

---

## 5. Patterns recommandés pour un SAV de réparation

### 5.1 Liste de tickets (file de réparation côté accueil)

Mise en page de référence (Polaris index + Linear + RepairDesk) :
1. **En-tête** pleine largeur : titre = le type de ressource (« Tickets »), action primaire unique en haut à droite (« Nouveau ticket »), rien d'autre.
2. **Onglets / vues enregistrées avec compteurs**, le premier verrouillé : « Tous » puis des vues par groupe de statuts (pas par statut) : « À diagnostiquer », « En attente » (pièce, accord client), « En cours », « Prêts » (terminés, à rendre), « Rendus / clôturés » à part et à la fin (Linear : les terminés toujours après les actifs ; Front : « Done » séparé de « Later »). Un onglet « Retard » ou un filtre « sans mise à jour depuis N jours » (RepairDesk « Days Since Last Update »).
3. **Barre de filtres** sous les onglets : recherche plein texte (nom, téléphone, IMEI, modèle, n°), filtres technicien / marque / type de panne, tri par défaut **échéance puis ancienneté** (RepairDesk trie par date d'échéance ; NN/g : « most needing action »), filtres actifs visibles comme puces effaçables (Front).
4. **Table** : hauteur de ligne 48 px (40 px en mode dense pour l'atelier) ; colonnes dans l'ordre d'importance : N° + statut (pastille + mot, jamais la couleur seule), Client (identifiant humain en première colonne, NN/g), Appareil (marque modèle · panne, comme la carte MyRepairApp « S23 · Charge port »), Technicien (avatar), Échéance / âge (relatif, rouge si dépassé : RepairDesk fond rouge pour le retard ; Orderry éclair coloré « Status deadline »), Montant (aligné à droite, chasse fixe), indicateur « message client non lu / avis » discret ; texte secondaire à ~50 % d'opacité (Linear). Actions de ligne révélées au survol (imprimer, changer le statut, envoyer un message) ; cases à cocher au survol et barre d'actions de masse en bas (« Changer le statut », « Imprimer les étiquettes ») à la Linear/Pencil & Paper.
5. **Détail sans quitter la liste** : clic = ouverture de la fiche, mais prévoir un **aperçu** (panneau droit ou « peek » à la barre d'espace) et « Précédent / Suivant » dans la fiche (Freshdesk, Polaris) pour enchaîner les tickets.
6. **Bascule Liste / Tableau** avec les mêmes filtres (Linear `Cmd B`, Intercom `L`, RepairDesk Kanban/liste/calendrier) ; le tableau est groupé par statut dans l'ordre du workflow, colonnes vides masquables.
7. **État vide** propre par onglet (titre + une action).
8. **Raccourcis minimaux** : `/` recherche, `N` nouveau ticket, `J/K` ou flèches pour naviguer, `Cmd K` commandes ; les afficher au survol des boutons (Linear) et ne jamais retirer le bouton correspondant (leçon Intercom).

Sources : Polaris resource index ; Linear display options / board / select issues ; RepairDesk feature page + New Ticket Listing ; Front ; Intercom ; Pencil & Paper ; NN/g ; Orderry statuses.

### 5.2 Fiche ticket

Mise en page de référence (Polaris details 2/3–1/3 + Zendesk + Jira + Fixably + RepairDesk) :
- **En-tête pleine largeur** : fil d'Ariane/retour, « Ticket #1044 », badge de statut (teinté, texte), nom du client cliquable, appareil, échéance ; à droite, **le bouton de l'action suivante du workflow** (« Passer en réparation », « Marquer terminé », « Rendre au client ») + 2 actions fréquentes (Imprimer, Notifier) + menu « ⋯ » pour le reste (dupliquer, fusionner, supprimer) ; « Précédent / Suivant ». Tekmetric met le statut en haut à gauche de chaque carte et le menu ⋯ en haut à droite : garder la même grammaire partout.
- **Colonne principale (2/3)**, en cartes par importance : 1) Panne et diagnostic (notes de diagnostic éditables en place, visibles du client), 2) Prestations et pièces avec total toujours visible (RepairQ : « always-visible ticket totals »), 3) Devis / accord client (envoyé le…, vu le… — les icônes avion/œil de Tekmetric), 4) Photos et état avant/après, 5) **Activité en bas** : timeline unique chronologique « plus récent en bas » avec composeur en bas (Zendesk) ou, si l'équipe lit surtout l'historique, plus récent en haut avec éditeur réduit — choisir une fois ; onglets de filtre « Tout / Statuts / Notes internes / Messages client » (RepairDesk « All / Status History / Private Comments ») ; notes épinglables en haut (RepairDesk flag) ; distinguer visuellement note interne vs message client (fond différent, Front/Help Scout).
- **Colonne secondaire (1/3)** = « static information » (Stripe) : carte Client (nom, téléphone, bouton appeler/WhatsApp, fidélité, « 3 derniers tickets » à la Intercom « Recent conversations »), carte Appareil (marque, modèle, IMEI, couleur, code/schéma, état à l'entrée), carte Dossier (technicien assigné, dates dépôt/promesse/restitution, acompte, mode de contact préféré) ; **édition en place au clic** (Help Scout) ; **champs vides masqués** sous un « Plus de champs » (Jira « Hide when empty »).
- Deux **vues du même ticket** selon le rôle (Shopmonkey « Service Writer View » / « Technician View ») : l'accueil voit client, prix, communication ; le tech voit panne, pièces, checklist, notes internes, avec le client en panneau latéral — même URL, bascule par rôle ou menu.
- **Changement de statut** = contrôle unique en en-tête, qui ouvre si nécessaire la raison / le message client (Orderry : commentaire, checklist ou paiement exigés à la transition ; RepairDesk : texte SMS/e-mail propre à chaque statut) ; statut financier (« à facturer / facturé / payé ») **séparé** du statut de réparation (RepairShopr 2021).
- Onglets de tickets ouverts (Zendesk) : optionnel ; prévoir au moins l'ouverture dans un nouvel onglet navigateur avec Cmd-clic (Linear).

Sources : Polaris resource details ; Stripe customer page ; Zendesk before/after ; Jira field layout ; Shopmonkey technician view ; RepairDesk ticket management / history ; Fixably Centromela ; Orderry statuses ; RepairShopr billing field ; Help Scout properties.

### 5.3 Dépôt au comptoir (création de ticket sur iPad)

Référence : RepairQ (5 étapes), RepairDesk (signature, checklist, étiquette), Fixably (confirmation e-mail au check-in), MyRepairApp (« Built for the counter »), Stripe `FocusView`, Apple 44 pt.
- **Flux plein écran à étapes** (FocusView : « complete a specific task from start to finish », fond bloquant), barre de progression en haut : 1) Client (recherche par téléphone en premier, création en ligne si absent, autocomplétion), 2) Appareil (marque → modèle avec autocomplétion sur la grille tarifaire, IMEI/série scannable, couleur, code PIN ou schéma PatternGrid), 3) Panne et état à l'entrée (checklist de conditions + photos, à la RepairDesk/RepairQ), 4) Prestation et prix (prix de la grille pré-rempli, devis si inconnu, acompte), 5) Récapitulatif + signature des conditions + impression (étiquette appareil + reçu client) + notification de confirmation.
- **Un seul champ saisi par écran si possible sur iPad**, contrôles ≥ 44 pt, clavier numérique pour le téléphone/IMEI, boutons de choix larges plutôt que menus déroulants.
- **Brouillon conservé** si l'on quitte (Linear garde un brouillon local et propose de le sauvegarder à l'Échap).
- Écran client séparé pour l'approbation/la signature si matériel (RepairQ « Qpop ») ; sinon rotation de l'iPad vers le client sur la dernière étape.
- Après validation : retour sur la fiche créée avec toast « Ticket #… créé — Imprimer l'étiquette » (Help Scout : feedback après soumission obligatoire).

### 5.4 File atelier (vue technicien)

Référence : Tekmetric Tech Board, Shopmonkey app techs, Fixably files « à prendre », Linear board.
- **Tableau** avec colonne « Non assigné » à gauche puis **une colonne par technicien** (Tekmetric), ou colonnes par statut groupées par technicien (swimlanes Linear) ; **compteur et charge en tête de colonne** (« Assigned / Complete / Incomplete » en heures chez Tekmetric ; nombre de dossiers par colonne dans l'app Shopmonkey).
- **Carte minimale** : statut en haut à gauche (texte teinté), menu ⋯ en haut à droite, « Modèle · panne », client, échéance, indicateurs bas (pièce reçue, accord client, message) ; **pas de description** sur la carte (Linear) ; aperçu au survol/espace.
- **Glisser en haut = prioriser** (Tekmetric), glisser entre colonnes = réassigner ; filtre par technicien/marque/type d'appareil (Fixably files par marque, Omnique filtres « Technician Assigned »).
- Sur l'écran du tech : « Mes dossiers » d'abord, « À prendre » ensuite ; actions à un tap : démarrer / mettre en attente de pièce / terminer ; notes internes partagées en temps réel avec l'accueil (Shopmonkey) ; checklist de réparation séquencée (Fixably macros, RepairDesk workflows).
- Densité : mode compact 40 px en liste ; techniciens absents masquables (Tekmetric).

### 5.5 Clients

Référence : Polaris details, Stripe customer page, Intercom/Help Scout sidebar.
- Liste : première colonne = nom (humain), puis téléphone, dernier passage, nombre de tickets, fidélité, montant cumulé (droite) ; recherche par téléphone/nom/IMEI ; filtres « avec ticket ouvert », « avis demandé ».
- Fiche : en-tête (nom, téléphone cliquable, actions « Nouveau ticket », « Envoyer un message ») ; colonne principale = **historique dynamique** (tickets, devis, paiements, messages) ; colonne secondaire = **coordonnées et métadonnées statiques** éditables en place, appareils connus, préférences de notification ; « Potential duplicates » (Intercom) sur même téléphone/e-mail avec fusion.

### 5.6 Devis

Référence : Tekmetric (états « Requires Authorization / Pending Authorization / Declined All », envoyé/vu), RepairDesk (devis par SMS pour approbation), Stripe (microcopie datée).
- Dans la fiche ticket, une carte « Devis » : lignes (prestation, pièce, qualité, prix), total, **état d'approbation en badge** (« Brouillon », « Envoyé le 7 nov. », « Vu », « Accepté », « Refusé ») avec les icônes envoyé/vu ; actions « Envoyer », « Relancer », « Marquer accepté par téléphone ».
- Côté client : page publique mobile avec deux boutons larges Accepter / Refuser et le texte « Répondre avant le [date] » plutôt que « Action requise » (Stripe).
- Liste des devis : onglets « En attente de réponse » (défaut) / « Acceptés » / « Refusés » / « Expirés », colonne « Envoyé il y a », relance en action de ligne.

### 5.7 Dashboard (accueil)

Référence : Stripe (5 KPI, pas de personnalisation), Square (4 métriques + « vs. » + « Who's working »), MyRepairApp (« Revenue this week +12% »), Linear « Inbox » (ce qui réclame attention), Fixably (accueil par rôle).
- **Première ligne = ce qui réclame une action aujourd'hui**, pas des graphiques : « À diagnostiquer (N) », « Pièces reçues (N) », « Accords client en attente (N) », « Prêts à rendre (N) », « En retard (N) », chaque tuile menant à la vue filtrée (Stripe : « routes them to core workflows »). Pour un gérant, 4 à 5 KPI maximum avec comparaison de période en petit sous le chiffre et sparkline monochrome.
- **Deuxième zone** : liste courte « Messages / avis clients non lus » et « Aujourd'hui : dépôts, restitutions, rendez-vous ».
- Troisième zone (gérant) : CA semaine vs semaine précédente, panier moyen, délai moyen de réparation, charge par technicien (« Who's working »).
- Accueil **différent par rôle** (accueil vs tech vs gérant) plutôt qu'un dashboard configurable ; état zéro explicite avec l'action à faire.

### 5.8 Impression (documents)

Ce qui ressort des outils du métier : **étiquette appareil scannable** qui rouvre le ticket (RepairDesk, un code par appareil d'un ticket multi-appareils) ; reçu de dépôt avec état à l'entrée et conditions signées (RepairDesk, RepairQ) ; de plus en plus remplacé par **l'e-mail/SMS de confirmation au check-in** (Fixably : « Automatic email order confirmations replaced printing »). Prévoir sur la fiche un bouton « Imprimer » avec sous-choix (étiquette, reçu client, fiche atelier, devis) plutôt que quatre boutons.

---

## 6. Pièges fréquents dans ces outils (ce que les utilisateurs détestent)

1. **Ajouter des clics aux gestes quotidiens** lors d'une refonte : Shopmonkey 2.0 (« made it much harder to use », « more keystrokes and mouse usage »), Intercom Inbox 2 (« Everything is hidden behind multiple clicks »), Tekmetric (« a lot of mouse clicking from one item, screen to another »). Mesurer le nombre de clics des 5 gestes les plus fréquents avant/après.
2. **Cacher les actions derrière des menus déroulants** et compter sur les raccourcis clavier : « Having everything be in a drop-down menu feels like overkill », « asking us to take hands off the mouse to do keyboard commands is actually slower ». Les raccourcis s'ajoutent aux boutons, ils ne les remplacent pas — surtout avec un iPad au comptoir.
3. **Espace perdu / panneaux plus gros pour la même information** : « I'm seeing a lot of unused space », « panels overall take up more space for the same function » ; et à l'inverse un panneau de détails qui recouvre le contenu sur petit écran. Densité réglable et panneau latéral repliable (`⌘ B` Chatwoot).
4. **Liste sans tri ni filtre utile** (RepairDesk 2018 : « listed all tickets in one go, without any sorting options ») et difficulté à retrouver un ticket/une facture : la recherche par téléphone, IMEI et numéro doit être instantanée et globale (« Search Everything »).
5. **Couleurs de statut incohérentes entre écrans** et multiplication de statuts juste pour avoir une couleur (forum RepairShopr). Couleur par groupe de statuts (Orderry), identique partout, jamais seule (Atlassian).
6. **Mélanger état de réparation et état financier** dans le même statut (RepairShopr a dû retirer « Invoiced »).
7. **Trop de fonctions à l'écran** : « there were so many things in the workspace and you don't use most of it » (ex-utilisateur avant Fixably) ; « hard to wrap my head around the enormity of the scope » (RepairShopr). Accueil et vues par rôle, champs vides masqués.
8. **Look daté ou utilitaire** : « clunky », « very utilitarian », « outdated », « modernized UI design » réclamé (RepairShopr, RepairDesk, Orderry). La sobriété Qonto/Stripe (une famille de caractères, deux rayons, pas d'ombres, couleur réservée aux statuts) est l'antidote crédible — pas les dégradés et cartes ombrées « IA ».
9. **Lenteur et chargements** (Orderry, Tekmetric, Intercom « loads for long periods ») : squelettes plutôt que spinners, UI optimiste (Linear), pas de rafraîchissement manuel (Fixably).
10. **Erreur impossible à corriger** (RepairDesk : appareil mal sélectionné non modifiable) ; rendre chaque champ de la fiche éditable en place.
11. **Changement d'utilisateur trop discret** sur un poste partagé (RepairShopr) : afficher clairement qui est connecté, bascule PIN visible.
12. **Mobile/tablette négligé** (« too large to reasonably use on smaller devices », « Limited Mobile App Functionality ») : 44 pt, pas de survol obligatoire (les actions au survol doivent avoir un équivalent tactile : menu ⋯ ou appui long).

---

