# Klikphone SAV

Application de gestion de service après-vente pour magasin de réparation de téléphones (smartphones, tablettes). Gère le cycle complet : accueil client, création de ticket, suivi de réparation, devis, commande de pièces, notifications client (WhatsApp/SMS/Email), facturation, fidélité, et impression de documents.

## Stack technique

| Couche | Technologies |
|--------|-------------|
| **Backend** | FastAPI 0.115, psycopg2-binary, PostgreSQL (Supabase), Pydantic 2.9 |
| **Frontend** | React 18.3, Vite 5.4, Tailwind CSS 3.4, react-router-dom 6.26, lucide-react, recharts 3.7 |
| **Auth** | JWT (python-jose) + PIN 4 chiffres (rôles : accueil, tech) |
| **Deploy** | `git push` sur `main` → Railway auto-deploy (Nixpacks) |
| **Tests** | pytest + pytest-asyncio (backend), vitest + testing-library + jsdom (frontend) |
| **Autres** | anthropic SDK (IA), beautifulsoup4 (scraping), fpdf2 (PDF), qrcode, openpyxl (Excel), httpx |

## URLs importantes

| Ressource | URL |
|-----------|-----|
| **Repo GitHub** | https://github.com/eltarik73/Klikphone-SAV-Railways |
| **Production** | https://klikphone-sav-v2-production.up.railway.app |
| **API docs** | https://klikphone-sav-v2-production.up.railway.app/docs |
| **Health check** | /health et /health/db |

## Structure du projet

```
klikphone-sav/
├── backend/
│   ├── app/
│   │   ├── main.py              # Point d'entrée FastAPI + migrations auto au startup
│   │   ├── database.py          # Pool de connexion PostgreSQL (psycopg2)
│   │   ├── models.py            # Modèles Pydantic
│   │   ├── api/                 # Routers FastAPI (~22 modules)
│   │   │   ├── tickets.py       # CRUD tickets, statuts, notes, historique, KPI
│   │   │   ├── clients.py       # CRUD clients, recherche
│   │   │   ├── notifications.py # Templates, WhatsApp/SMS/Email
│   │   │   ├── print_tickets.py # Impressions HTML (client/staff/devis/recu)
│   │   │   ├── attestation.py   # Attestation de non-réparabilité
│   │   │   ├── caisse_api.py    # Intégration caisse/POS
│   │   │   ├── telephones.py    # Scraper LCD-Phone (catalogue)
│   │   │   ├── tarifs.py        # Grille tarifaire
│   │   │   ├── devis.py         # Devis
│   │   │   ├── auth.py          # Authentification PIN/JWT
│   │   │   ├── admin.py         # Administration
│   │   │   ├── config.py        # Configuration boutique
│   │   │   ├── catalog.py       # Catalogue pièces
│   │   │   ├── fidelite.py      # Programme fidélité
│   │   │   ├── marketing.py     # Community manager / marketing
│   │   │   ├── reporting.py     # Rapports
│   │   │   ├── chat.py          # Chat widget
│   │   │   ├── depot_distance.py # Dépôt à distance
│   │   │   ├── parts.py         # Gestion pièces
│   │   │   ├── team.py          # Gestion équipe
│   │   │   └── email_api.py     # API email
│   │   └── services/
│   │       ├── caisse.py            # Service caisse
│   │       ├── notifications.py     # Service notifications
│   │       └── scraper_lcdphone.py  # Scraper PrestaShop LCD-Phone
│   ├── requirements.txt
│   ├── Procfile
│   └── railway.json
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── api.js           # ApiClient centralisé (tous les endpoints)
│   │   │   └── utils.js         # Config statuts, formatters, templates
│   │   ├── pages/               # ~20 pages (DashboardPage, TicketDetailPage, ClientFormPage...)
│   │   └── components/          # Navbar, StatusBadge, PatternGrid, Toast...
│   ├── vite.config.js           # Proxy /api → localhost:8000, port 5173
│   ├── tailwind.config.js       # Palette brand (violet), fonts Plus Jakarta Sans
│   └── package.json
└── CLAUDE.md
```

## Design & UI

- **Palette** : Violet/Indigo (`#7C3AED` primary), défini dans `tailwind.config.js` comme `brand`
- **Sidebar** : Dark theme (`#0F172A`), défini comme `sidebar`
- **Fonts** : Plus Jakarta Sans (titres + corps) + Inter (fallback)
- **Composants UI** : Tailwind natif (pas de librairie UI externe)
- **Icons** : lucide-react exclusivement

## Statuts des tickets (8)

1. En attente de diagnostic
2. En attente de pièce
3. Pièce reçue
4. En attente d'accord client
5. En cours de réparation
6. Réparation terminée
7. Rendu au client
8. Clôturé

## Commandes courantes

```bash
# Backend (depuis /backend)
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (depuis /frontend)
npm install
npm run dev          # Dev server Vite (port 5173, proxy /api → :8000)
npm run build        # Build production + sync auto vers backend/static (hook postbuild)
npm run test         # Tests vitest

# Tests backend
cd backend && pytest

# Deploy
git add -A && git commit -m "message" && git push origin main
```

## ⚠️ Frontend prod servi depuis `backend/static/` (PAS `frontend/dist/`)

Railway/FastAPI sert les fichiers statiques depuis `backend/static/`
(cf. `STATIC_DIR` dans `backend/app/main.py`). Le dossier `frontend/dist/`
n'est jamais lu en prod.

Pour éviter le piège classique « j'ai pushé mes modifs frontend mais la
prod ne change pas », un hook **`postbuild`** dans `frontend/package.json`
copie automatiquement `frontend/dist/` → `backend/static/` après chaque
`npm run build` (cf. `frontend/scripts/sync-to-backend.mjs`).

**Workflow correct** :
```bash
cd frontend && npm run build           # build + sync auto
cd .. && git add backend/static/       # commit le nouveau bundle
git commit -m "build: ..."
git push origin main                   # Railway redeploy
```

Ne JAMAIS modifier `backend/static/` à la main — c'est généré par le hook.

## Règles non négociables

### Sécurité
- **Ne jamais committer les `.env`** — ils contiennent `DATABASE_URL`, `JWT_SECRET`
- **Ne jamais exposer le `JWT_SECRET`** dans le code ou les logs
- **CORS est ouvert (`*`)** en prod — acceptable pour cette app interne, mais ne jamais ajouter de credentials sensibles dans les cookies
- **Valider les entrées utilisateur** côté API (Pydantic le fait, ne pas le contourner)
- **SQL paramétré uniquement** — psycopg2 avec `%s` placeholders, jamais de f-strings dans les requêtes SQL
- **Ne pas exposer les stack traces en prod** — le handler global dans `main.py` renvoie `str(exc)`, attention à ne pas leaker d'infos sensibles

### Architecture
- **Backend = SQL brut (psycopg2)** — pas d'ORM, pas de SQLAlchemy. Toutes les requêtes sont écrites en SQL direct
- **Frontend = Tailwind natif** — pas de Material UI, pas de Chakra, pas de composants tiers pour l'UI
- **Pas de TypeScript** — le frontend est en JSX pur, ne pas introduire de `.tsx`
- **Un seul ApiClient** (`frontend/src/lib/api.js`) — tous les appels API passent par là
- **Migrations dans `main.py`** — pas d'outil de migration (Alembic). Les `CREATE TABLE IF NOT EXISTS` et `ALTER TABLE ADD COLUMN IF NOT EXISTS` sont dans le `lifespan`
- **`get_cursor()` context manager** — toujours utiliser `with get_cursor() as cur:` pour les requêtes DB

### Bonnes pratiques FastAPI
- **Préfixer les routes API avec `/api/`** pour éviter les conflits avec le SPA catch-all
- **Utiliser `BackgroundTasks`** pour les opérations longues (Railway timeout HTTP ~15s)
- **Pydantic models** pour la validation des requêtes entrantes
- **Tags sur les routers** pour organiser la doc Swagger

### Bonnes pratiques React/Vite
- **React Router 6** : les `<Route>` doivent être enfants directs de `<Routes>`, jamais dans des fragments `<>`
- **`import` dynamique** pour les grosses pages (code-splitting)
- **`manualChunks`** dans vite.config.js — vendor-react et vendor-icons sont séparés

## Erreurs fréquentes à éviter

| Erreur | Pourquoi | Solution |
|--------|----------|----------|
| `date_cloture` traité comme timestamp | C'est du **texte** (`TEXT`), pas un `TIMESTAMP` | Comparer comme string, pas avec `::timestamp` |
| `date_recuperation` traité comme datetime | C'est du **texte libre** | Ne pas parser comme date |
| f-string dans une requête SQL | **Injection SQL** | Utiliser `%s` avec psycopg2 |
| `<Route>` dans un fragment `<>` | React Router 6 crash | Enfant direct de `<Routes>` uniquement |
| `\u00e9` au lieu de `é` dans le code | Illisible, bug potentiel | Utiliser les caractères UTF-8 réels |
| `type_produit = 'reconditionné'` | Valeur invalide | Uniquement `'neuf'` ou `'occasion'` |
| Scraper LCD-Phone en HTML statique | L'endpoint a changé | Utiliser `?ajax=1&action=productList` |
| `PatternGrid` pattern mal formaté | Format spécifique attendu | String dash-separated : `"1-5-9-6-3"` |
| `git add frontend/dist` | Ignoré par `.gitignore` | Utiliser `git add -f frontend/dist` si nécessaire |
| Route API sans préfixe `/api/` | Conflit avec le SPA catch-all | Toujours préfixer avec `/api/` ou `/stats/` |
| `allow_origins=["*"]` avec cookies | Les credentials ne passent pas | Pas de cookies sensibles, JWT dans header uniquement |

## Variables d'environnement requises (backend)

```
DATABASE_URL=postgresql://...     # Supabase PostgreSQL
JWT_SECRET=...                    # Secret pour signer les JWT
FRONTEND_URL=...                  # URL du frontend (pour CORS)
```

Optionnelles (sécurité, cf. `app/api/auth.py` et `app/api/public_documents.py`) :

```
BACKEND_URL=https://...           # Origine publique du backend : fixe les liens de partage des documents
                                  # (sinon X-Forwarded-Host, accepté seulement pour un hôte du projet)
KP_TRUST_PROXY=1                  # 1 (défaut, Railway) : IP client = DERNIÈRE valeur de X-Forwarded-For.
                                  # 0 hors proxy : request.client.host seul — lancer alors uvicorn avec
                                  # --no-proxy-headers (sinon uvicorn réécrit lui-même request.client depuis
                                  # XFF pour les connexions locales). Une garde au démarrage signale un
                                  # réglage incohérent avec l'environnement (RAILWAY_*).
KP_HOTES_SUPPLEMENTAIRES=a,b      # Hôtes supplémentaires acceptés dans X-Forwarded-Host (recette…)
KP_IP_MAGASIN=1.2.3.4,5.6.7.8     # IP du magasin (borne) : exemptée des seuls plafonds GLOBAUX, jamais du quota par IP
```

Synchro automatique des tarifs Mobilax (`app/services/fournisseurs.py`, cf. section ci-dessous) :

```
MOBILAX_REFRESH_TOKEN=...         # Facultatif : amorce la connexion Mobilax si le gérant préfère la poser dans Railway
                                  # plutôt que de coller ses jetons dans l'app (copié dans params au premier passage)
MOBILAX_ID_CLIENT=1234            # Facultatif : id_customer Mobilax (sinon lu auprès de l'API)
KP_SYNC_FOURNISSEURS=0            # Empêche la tâche quotidienne (tests, maintenance)
```

Paramètre en base (table `params`, modifiable sans redéploiement) : `SUIVI_JETON_JOURS`
(défaut 180) — validité du jeton de suivi (QR, liens) après restitution ou clôture du dossier ;
le numéro de téléphone complet reste accepté sans limite de temps.

## Synchro automatique des tarifs fournisseurs (Mobilax)

- **Une seule action du gérant** : connecté sur mobilax.fr, console du navigateur →
  `copy(JSON.stringify(localStorage))`, puis coller le texte dans *Réparation smartphones → Connecter Mobilax*
  (ou poser `MOBILAX_REFRESH_TOKEN` dans Railway). Les jetons vont dans `params`
  (`MOBILAX_TOKEN`, `MOBILAX_REFRESH_TOKEN`, masqués par `api/config`), jamais dans le code ni dans une réponse API.
- **Chaque jour** (`fournisseurs.demarrer_synchro_quotidienne`, lancé dans le `lifespan`, vérification horaire,
  un passage par jour réservé par compare-and-set dans `params`, 3 essais au plus, verrou 40 min entre workers) :
  jeton renouvelé (`POST user/refresh-token`), chaque modèle de la grille cherché
  (`GET catalogs/web/products?search=…&id_customer=…`), prix du **palier du compte** (Bronze/Silver/Gold… :
  liste `prices` de chaque produit, palier lu sur la fiche client et gardé dans `params.MOBILAX_PALIER` ;
  le champ `price` seul est le prix Bronze), produits passés au moteur d'import
  (`import_prix.apercu` → `appliquer`) : prix d'achat HT et prix client recalculé écrits (lot annulable,
  historique source `import`, par « Synchro Mobilax »). Grosse variation d'un prix **de référence** (réel et
  plus récent que `jours_perime`) → `tarifs_propositions` (tuile « Propositions ») ; un prix **absent, estimé**
  (`prix_source` estimation_…) **ou périmé** est remplacé sans validation (`fournisseurs.remplacable`), et les
  propositions Mobilax en attente d'une pièce dont le HT vient d'être écrit sont réglées (`acceptee`, même lot).
  Pièce verrouillée / obsolète jamais touchée, produit inconnu jamais créé.
- **Diagnostic** : après chaque passage, `params.MOBILAX_DIAGNOSTIC` liste les pièces de la grille restées sans
  prix (raison : aucun produit pour le modèle, pièce absente, nom non rattaché, modèle non cherché) avec jusqu'à
  trois produits Mobilax ressemblants — `GET /api/tarifs/fournisseurs/mobilax/diagnostic` (prix des candidats pour
  l'admin), bouton « N pièces sans prix Mobilax » du bloc de synchro.
- **Bouton « Synchroniser maintenant »** : `POST /api/tarifs/fournisseurs/mobilax/sync` (tâche de fond) ;
  état : `GET /api/tarifs/fournisseurs/etat` et tuile « Synchro Mobilax » de la santé des prix.
  Jeton refusé → connexion « expirée » affichée, à recoller une fois ; aucun plantage.
- **Rattachement des produits Mobilax** (`fournisseurs.lignes_produit`) : chaque nom Mobilax commence par sa
  catégorie (`category_name`, « Ecran Tactile Soft Oled », « Batterie Originale », « Appareil Photo Original Pulled ») :
  `piece_categorie` en tire la pièce et la qualité (`CATEGORIES_PIECES`, `QUALITES_CATEGORIE`, variantes écartées
  `CATEGORIES_EXCLUES` : écran externe, batterie secondaire, port à souder…), `modele_produit` lit le modèle dans le reste
  du nom (suffixe technique `suffix`, codes constructeur, mégapixels, coloris, « Diagnostic/Ti/Genuine » retirés), un nom
  citant plusieurs marques donne une ligne par marque (`segments_marques`). Le CSV passé au moteur d'import porte les
  colonnes Marque / Modèle / Type de pièce / Qualité (`COLONNES_CSV`). Évalué sur un relevé anonyme réel : 84 % des
  pièces de la grille reçoivent un prix (38 % avant).
- **Moteur d'import** (`import_prix`) : niveau « ref » (références Apple A1932… : un MacBook / iPad se reconnaît à sa
  référence), repli de qualité d'écran quand le modèle n'a pas la ligne exacte (`REPLI_ECRAN` : Incell/LCD/OLED → ligne
  Compatible, Compatible → LCD ou Incell, Reconditionné → Original ; la variante la moins chère l'emporte ensuite),
  modèle raccourci de ses mots de fin parasites (`Index._modeles_essayes` : « Pixel 9a G526Q »), ambiguïté à un niveau
  tolérant sans perdre les modèles déjà trouvés d'un nom groupé. `grille.variantes` déplie correctement
  « Apple iPhone 12/iPhone 12 Pro », « Galaxy A34 5G/A35 5G », « Xiaomi Mi 11 Lite 4G/11 Lite 5G NE ».
- **Moins-disant entre fournisseurs** (`fournisseurs.planifier(..., fournisseur=)`, `moins_cher_ailleurs`) : une pièce dont
  le prix de référence (réel, récent) vient de l'autre fournisseur et n'est pas plus cher est laissée (`plus_cher_ailleurs`
  dans le résumé) ; moins cher ici → appliqué (ou proposé si grosse variation) et la pièce change de fournisseur.
  `prix.decrire_tarifs` renvoie `fournisseur`.
- **Tests** : `tests/test_fournisseurs_mobilax.py` (httpx.MockTransport, fixture `fixtures/mobilax_products.json`,
  aucun appel réseau ; base réelle via `KP_TEST_DATABASE_URL`).

## Collecte Utopya depuis le navigateur du gérant (`app/services/utopya.py`)

- **Pourquoi** : utopya.fr (Magento) ne montre ses prix qu'à un compte connecté et répond 403 (challenge Cloudflare) à tout
  programme : aucune synchro serveur. La collecte passe par le navigateur du gérant, déjà connecté.
- **Une installation** : *Réparation smartphones → Installer le collecteur* (admin) → `GET /api/tarifs/fournisseurs/utopya/collecteur`
  rend l'adresse `javascript:` d'un favori « Collecte Utopya » (script `utopya.SCRIPT`, origine publique du serveur, clé
  `UTOPYA_COLLECTE_TOKEN` créée dans `params`, masquée par `api/config`) à glisser dans la barre des favoris. « Nouvelle clé »
  (`POST …/collecteur/regenerer`) invalide l'ancien favori. L'adresse est `javascript:void(<script>)` **sans « ; » final**
  (sinon SyntaxError muette : Chrome ne fait rien au clic) ; `utopya.VERSION` change à chaque modification du script
  (le gérant réinstalle le favori) ; le test `test_script_du_favori_est_du_javascript_valide` le vérifie avec `node --check`.
- **Une action par collecte** : sur utopya.fr connecté, cliquer le favori. Le script lit le menu (une page par modèle :
  `/samsung/galaxy-a/a54-5g-a546b.html`), l'envoie à `POST …/utopya/plan` (en-tête `X-Collecte-Cle`) → `utopya.plan`
  apparie les modèles de la grille aux pages (clés de modèle d'`import_prix`) et ajoute les pages de série des marques sans
  page par modèle (Pixel, OnePlus, Série Reno…) ; puis lit chaque page (`?product_list_limit=200`, pagination, 400 ms
  entre pages, fenêtre de progression, bouton Arrêter) et envoie les tuiles (nom, référence, prix) à `POST …/utopya/collecte`.
- **Serveur** (`utopya.traiter`, fil de fond, `GET …/utopya/suivi` pour le script, `/etat` pour l'app) :
  `lignes_collecte` traduit chaque nom (`piece_de`, qualité d'écran `qualite_nom` : Service Pack → Original, Soft/Hard OLED,
  LTPS/Incell, ReLife/Prime/BOLT/SPARK/Alcalian → Compatible, Pulled → Reconditionné ; sans étiquette : référence
  numérique = origine du catalogue Utopya, sinon compatible ; prix HT lu dans le texte, TTC ramené en HT), marque de la page,
  puis `fournisseurs._importer(…, fournisseur="Utopya", source="utopya")` : mêmes règles que Mobilax (remplaçable, propositions,
  moins-disant). Résumé `UTOPYA_COLLECTE_*`, diagnostic `UTOPYA_DIAGNOSTIC` (`GET …/utopya/diagnostic`, bouton « N pièces
  sans prix Utopya »).
- **Tests** : `tests/test_utopya_collecte.py` (menu et tuiles réels, import simulé, routes avec clé), vitest
  `synchro_fournisseur.test.jsx`. Vérifié sur le compte du gérant (04/11/2026) : tuile connectée
  `<span class="price">94,90€</span>` sans HT/TTC ni `data-price-amount`, prix affichés hors taxe (Magento
  `display_cart_subtotal_excl_tax`) — `prix_collecte` lit ce montant en HT. Première collecte réelle : 266 pages, 7 050
  produits, 680 pièces reconnues. Les codes de batterie (« BP46 », « EB-BA546ABY ») sont retirés du modèle (`_CODE_BATTERIE`).

## Rubrique « Tarifs » : une entrée de menu, des onglets (`components/OngletsTarifs.jsx`)

- Le menu n'a qu'une entrée **Tarifs** (`Navbar.jsx`, `match: cheminsTarifs(basePath)` : allumée sur toutes les grilles).
  La page porte les onglets Réparation smartphones (`/tarifs`), Réparation iPhone (`/tarifs-reparation`), Vente iPhones
  (`/tarifs-iphone`), Vente smartphones (`/tarifs-smartphones`), Catalogue téléphones (`/tarifs-telephones`) — chaque
  route de `App.jsx` enveloppe sa page dans `<OngletsTarifs>` ; adresses inchangées (liens, favoris, tuiles).
- Plus de rubrique « Tarifs » dépliable ni de sous-groupe « Beta » ; `/telephones-vente` (« Mes téléphones », doublon du
  catalogue) redirige vers `/tarifs-telephones`. « Prix à revoir » et « Site Tarifs iPhone » restent dans Administration.

## Grille comparative des fournisseurs (`tarifs_fournisseurs_prix`, `prix.choisir_fournisseur`)

- **Un prix par fournisseur et par pièce** : chaque import fournisseur (synchro Mobilax, collecte Utopya) note le prix de
  CE fournisseur dans `tarifs_fournisseurs_prix` (`prix.enregistrer_prix_fournisseur` : clé de pièce, fournisseur, HT de la
  variante la moins chère, référence, désignation, page, `en_stock`, `vu_le`, `prix_maj_le`), retenu ou non. Le coût retenu
  reste `prix_fournisseur_ht` / `*_prix_ht` (colonne `fournisseur` = d'où il vient) : moins-disant par défaut.
- **Rien à valider** : la synchro et la collecte appliquent les prix du fournisseur, grosses variations comprises
  (`planifier(proposer=False)`, compteur `variations_appliquees`) ; les propositions ne servent plus qu'aux commandes.
- **Préférence pour toute la grille** : param `FOURNISSEUR_PREFERE` (`Mobilax`, `Utopya`, vide = le moins cher disponible),
  `PUT /api/tarifs/fournisseurs/preference {fournisseur}` (admin) → `prix.appliquer_preference` aligne les coûts retenus de
  toutes les pièces en tâche de fond (`lancer_preference`, un lot, `etat().preference_en_cours / preference_resultat`) ;
  `planifier` la respecte (`fournisseur_choisi(desc, prefere)`). Bloc « Prix retenus dans la grille » de SynchroFournisseur.
  Un choix par pièce reste possible (`fournisseur_choisi`, `PATCH …/{id}/fournisseur`, `prix.choisir_fournisseur`), sans UI.
- **Trois grilles** : `GET /reparation-smartphones/modele` → pièce `prix_fournisseurs {Mobilax: {ht (admin), client, calcul
  (admin), ref, url, en_stock, vu_le, connu}, Utopya: …}` ; dans Réparation smartphones, « Prix retenus | Grille Mobilax |
  Grille Utopya » (`?grille=mobilax|utopya`, `TableauPieces grille=`, `LigneGrilleFournisseur` en lecture seule : prix
  relevé, calcul, prix client qu'il donnerait, « retenu », « Rupture »).
- **Qualités d'écran** : « Original » = l'officiel seulement (Service Pack, « Ecran Tactile Original », « Ecran Original
  Google ») ; « Original Pulled / Refurb / Assembled » (Mobilax) et « Pulled » (Utopya) = Reconditionnee, jamais la ligne
  Original (`REPLI_ECRAN` sans Original ← Reconditionnee). Utopya : sans étiquette, SKU numérique = origine
  (« Ecran Complet Noir Galaxy A54 5G (A546B) »), SKU alphanumérique (« A546-OLED@ », « IP11-BOLT ») = compatible.
- **Produit vu sans prix** (rupture, prix masqué) : la synchro Mobilax rattache aussi les produits sans prix
  (`lignes_produit(sans_prix=True)`, `rattacher_sans_prix`) → ligne notée `en_stock = FALSE` (prix connu gardé) et raison
  `sans_prix_fournisseur` dans le diagnostic, au lieu d'un faux « non reconnu ».
- **Recherche Mobilax** : une recherche qui déborde (`PAGES_MAX` pages : iPhone, Galaxy S…) est complétée par une recherche
  par famille (`FAMILLES_REQUETES` : « Batterie Apple iPhone 13 »…, `PAGES_FAMILLE` pages) ; un iPad est cherché sous son nom
  canonique et sa référence (`requetes_ipad` : « iPad 7 », « iPad Pro 11 » + « A2377 »), jamais « iPad 7 (2019) 10.2" ».
- **iPad par génération** : niveau `ipad` du moteur d'import (`import_prix.cles_ipad`, table `IPADS` : famille, numéro,
  taille, année, puce, références) — « iPad 10.2" (7/8/9e Gen) », « iPad Air 11 M2 2024 », « iPad Pro 11 (2021/2022) »,
  « A2197 » et « iPad 7 (2019) 10.2" » tombent sur la même clé « ipad 7 » / « ipad air 6 11 » / « ipad pro 11 2021 ».
- **Bouton power** : type de pièce `Bouton power` (`_PIECES` bouton_power : nappe power / on-off / allumage ; le capuchon
  « Bouton On/Off » seul n'en est pas), catégories Mobilax « Nappe Power… » (`CATEGORIES_GARDEES`), Utopya « Nappe Power ».
  `PIECES_COURANTES` = écran, batterie, connecteur, vitre arrière, bouton power ;
  `POST /reparation-smartphones/pieces-courantes/tous {types}` (admin) les crée sur tous les modèles de la grille (bouton
  « Compléter tous les modèles »). Une nappe est un accessoire pour toute autre pièce (« Nappe LCD » ≠ écran).
- **Tests** : `tests/test_grille_fournisseurs.py`, `test_prix_moteur.py` (iPad, nappe power), `test_fournisseurs_mobilax.py`
  (familles, débordement, choix), vitest `reparation_smartphones.test.jsx` (« grille comparative »).

## Batterie changée « par l'écran » (`app/services/par_ecran.py`)

- **Règle** : sur les appareils où la batterie n'est accessible qu'en décollant l'écran (iPad, Google Pixel…), le
  gérant facture le risque : prix client de la batterie = arrondi((HT écran + HT batterie) × TVA + marge
  `batterie_par_ecran`, 70 € par défaut dans `prix.REGLES_DEFAUT`, réglable dans « Modifier les règles »).
- **Quels modèles** : case par modèle sur la fiche du modèle (admin) — `tarifs_modeles_options` (grille des pièces,
  `PUT /api/tarifs/modeles/batterie-par-ecran`) ou colonne `batterie_par_ecran` d'une fiche iPad / Mac
  (`PUT /api/tarifs/apple-devices/{id}/batterie-par-ecran`) ; sans réglage : Google et iPad oui, les autres non.
- **Quel écran** : l'original / reconditionné le moins cher du modèle (Original, Pulled, Refurbished,
  Reconditionné, Service Pack), sinon le moins cher (`choisir_ecran`) ; sans écran au prix connu, calcul ordinaire.
- **Dépendance entre lignes** : `prix.ecrire_prix_lot` passe tout lot par `par_ecran.deriver_changements` (prix
  client des batteries concernées recalculé dans le même lot, écran ou batterie modifié, import, synchro Mobilax,
  proposition, règles) — `deriver=False` pour un prix tapé par l'admin, jamais à l'annulation d'un lot ;
  `par_ecran.recalculer` après une création de pièce ou un changement de case. Batterie verrouillée jamais touchée.
- **Affichage** : `GET /reparation-smartphones/modele` → `batterie_par_ecran {actif, explicite, defaut, ecran, marge}`,
  pièce `par_ecran: true` et `calcul {ht, ht_ecran, …}` — « (15,00 + 13,00) × 1,2 + 70 = 103,60 → 109 € ».
- **Tests** : `tests/test_batterie_par_ecran.py` (curseurs simulés), vitest `reparation_smartphones.test.jsx`.

## Workflow automatique après chaque modification UI

Après chaque modification d'un fichier .tsx, .jsx ou .html dans src/components ou app/ :
1. Vérifie l'accessibilité : contrastes WCAG AA, labels aria, focus clavier, touch targets ≥ 44px
2. Vérifie la performance : pas d'animations sans prefers-reduced-motion, pas de layout shift, images optimisées
3. Corrige automatiquement les problèmes trouvés sans demander
4. Lance npm run build pour vérifier que ça compile

Ne me demande PAS avant de corriger ces problèmes — fais-le automatiquement.
