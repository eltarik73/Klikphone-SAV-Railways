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
│   ├── tailwind.config.js       # Palette brand (action noire, rampe slate), police Inter variable
│   └── package.json
└── CLAUDE.md
```

## Design & UI

- **Skill `design-epure`** (`.claude/skills/design-epure/`, nov. 2026) : à charger avant toute modification
  d'interface — dix décisions (un point focal et un seul `btn-primary` par écran, noir = action seulement,
  statuts en 4 teintes, cartes sans ombre, rayons 6/8/12, aucune animation décorative, ton et formats
  français), checklist anti-« look IA », gabarits de page, audit chiffré du code et restes à traiter (§ 8).
- **Palette** : action **noire** depuis le 9 nov. 2026 (décision du gérant) — le jeton `brand` est une rampe slate,
  `brand-600` = `#0F172A` (bouton primaire, actif, case cochée), `brand-500` = `#475569` (focus) ; sur fond sombre
  (barre latérale, borne, vitrine) l'action s'inverse en blanc. **Plus de violet** (ancien K), et l'orange `#FF6600`
  reste au seul logo (il se confond avec l'ambre des alertes). Neutres slate ; sémantiques success/warning/danger/info
  (emerald/amber/red/blue). Jamais de dégradé ni de tuile d'icône colorée. Documents clients (devis, e-mail de
  dépôt à distance, reçu) alignés sur le noir ; couleurs de données (calendrier marketing, équipe) inchangées.
- **Statuts** : couleurs franches depuis le 9 nov. 2026 (gérant : « un peu de couleur, lisible facilement ») —
  violet = à diagnostiquer, cyan = attente de pièce, bleu = pièce reçue / en cours, ambre = accord client, émeraude =
  terminée, neutre = rendu / clôturé / pré-enregistré (`lib/utils.js` → `getStatusConfig`, clés
  `bg/text/ring/champ/dot/color/icon/groupe` ; `champ` = sélecteur de statut teinté des listes et de la fiche) ;
  **délais** : pastille verte / ambre / rouge (point qui pulse en retard, `motion-safe`) + jauge animée du temps écoulé
  (`PastilleDelai jauge`, `lib/delai.avancementDelai`) ; ligne d'alertes du tableau de bord en pastilles colorées ;
  `StatusBadge` variante `dot` (listes) ou `solid` / `size="lg"` (en-tête de fiche). Aucun statut en rouge.
- **Navigation** : jetons `nav-*` (`tailwind.config.js`, variables CSS d'`index.css`). Sous 1 024 px (téléphone, iPad en
  portrait) barre du haut et menu sur **fond blanc** (gérant, 09/11/2026) ; au-dessus, barre latérale **sombre** `#0F172A`,
  version « muette » (gérant, 08/11). Ne pas réécrire `text-white` / `bg-white/10` en dur dans `Navbar.jsx` : passer par `nav-*`.
- **Police** : Inter variable seule (Google Fonts `opsz,wght@14..32,400..700`, `font-optical-sizing: auto`) ;
  plus de Plus Jakarta Sans ni d'Instrument Serif.
- **Logo officiel KlikPhone** (fourni par le gérant le 8 nov. 2026, PDF vectoriel) : le « K » orange `#FF6600` /
  gris `#9A9A9A` avec le tournevis blanc — `components/LogoK.jsx` (`LogoK` = le K seul, carré à angles vifs ;
  `LogoKlikPhone` = K + mot « KlikPhone® », `theme` clair/sombre, `vertical`, `sousTitre`). Fichiers :
  `public/brand/klikphone-k.svg`, `klikphone-wordmark-noir.png` / `-blanc.png`, `favicon.svg`, `icon-192/512.png`,
  `icon-maskable-512.png`, `apple-touch-icon.png`, `logo_k.png` ; côté serveur `backend/app/api/logo_k.png` (tickets
  thermiques en 1 bit, PDF). Ne jamais redessiner, arrondir, recolorer ni mettre en dégradé le logo.
- **Confirmations** : `components/ConfirmDialog.jsx` (`useConfirmDialog`), jamais `confirm()` / `prompt()` natifs.
- **Composants UI** : Tailwind natif (pas de librairie UI externe), classes partagées d'`index.css`
- **Icons** : lucide-react exclusivement, nues (16–20 px, slate-500), jamais d'emoji

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

## Synchro Utopya automatique du serveur (`app/services/utopya.py`, 10/11/2026)

- **Découverte** : les pages de utopya.fr répondent 403 (Cloudflare) aux programmes et cachent les prix aux visiteurs, mais
  l'accès REST **anonyme** de Magento `GET https://www.utopya.fr/rest/V1/products-render-info?searchCriteria[…]&storeId=1&currencyCode=EUR`
  répond (même sans navigateur ni compte) avec `id`, `name`, `url`, `is_salable` ('1' / ''), `price_info.final_price` = prix HT
  **identique au compte pro du gérant** (vérifié : écran Pixel 6 97 €, ReLife 54,91 €). Pas de `sku` renvoyé, mais filtrable.
  GraphQL est bloqué (403), `rest/V1/products` et `customers/me` refusés (401). Accès sans doute laissé ouvert par oubli :
  il peut fermer → le favori reste le secours.
- **Passage** (`utopya.synchroniser`) : `ClientUtopya.tout()` lit tout le catalogue (pages de 500 triées par `entity_id`, fin sur
  page vide / incomplète / déjà vue, 0,4 s entre pages, erreurs passagères rejouées 3 fois) — mesuré : 17 224 produits, 35 pages,
  ~2 min ; puis les écrans à **référence chiffrée** (`FILTRES_NUMERIQUES` : nom `%cran%`, sku `from 0` / `to 9~`, sans `-` ni `@` :
  1 099 produits) → `sku_numerique` (écran sans étiquette + référence chiffrée = Original, `qualite_nom(…, numerique=)`).
  `produits_api` : pièces suivies (`import_prix.piece_de`) d'une marque de la grille (`marque_produit` : marque ou gamme dans le
  modèle — `_GAMMES_MARQUE`, `_GAMMES_SURES`), référence = celle du catalogue pour la même fiche (`refs_catalogue`, relevée par le
  favori), sinon le nombre en fin d'adresse (« …-a546b-134705.html » = sku 134705), sinon `UTN<id>` (écran du filtre « référence chiffrée » : lu comme numérique par `fournisseurs.ref_utopya_numerique` / `qualite_coherente`) ou `UT<id>` (référence maison) — ces références notées ne viennent jamais de `refs_catalogue` ; une « page » par marque. Puis
  `traiter(collecte, mode="serveur")` (auteur « Synchro Utopya ») : mêmes lignes, import, diagnostic, purges, châssis que le favori ;
  passage complet → `purger_catalogue`. Mesuré : ~8 000 lignes de prix (13 marques).
- **Chaque jour** : la boucle horaire de `fournisseurs._boucle` appelle `utopya.synchro_quotidienne()` après Mobilax (verrou
  `UTOPYA_SYNCHRO_VERROU`, jour `UTOPYA_SYNCHRO_JOUR`, 3 essais/jour — `fournisseurs._verrouiller(cur, cle)` /
  `_reserver_jour(cur, jour, cle)`) ; coupée par `UTOPYA_SYNCHRO_ACTIVE=0` (params) ou `KP_SYNC_UTOPYA=0`. Jamais pendant une
  collecte du favori (et inversement). Bouton « Synchroniser maintenant » du bloc Utopya (admin) → `POST …/utopya/sync`.
- **État** : `UTOPYA_SYNCHRO_{DERNIERE,OK,RESUME}` → `etat().synchro {active, en_cours, derniere, ok, erreur, code, resume}` ;
  codes `bloque` (403 / page HTML : Cloudflare), `ferme` (401/404), `limite` (429), `reseau`, `reponse`, `vide`, `incomplet`,
  `occupe`, `import`. Un échec n'efface pas la dernière collecte (`UTOPYA_COLLECTE_*`, `resume.mode` 'serveur' | 'favori') ;
  l'écran dit « Synchro automatique Utopya en échec … Derniers prix Utopya : date » et le favori prend le relais.
- **Tests** : `tests/test_utopya_synchro.py` (MockTransport, produits réels du 10/11/2026), vitest `synchro_fournisseur.test.jsx`.

## Collecte Utopya depuis le navigateur du gérant (secours, `app/services/utopya.py`)

- **Pourquoi** : utopya.fr (Magento) ne montre ses prix qu'à un compte connecté et répond 403 (challenge Cloudflare) à tout
  programme sur ses pages. Avant la synchro serveur (ci-dessus), c'était la seule voie ; c'est désormais le secours si Utopya
  bloque ou ferme son accès REST.
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
  (`/tarifs-iphone`), Vente smartphones (`/tarifs-smartphones`), Catalogue téléphones (`/tarifs-telephones`), Recherche
  fournisseurs (`/tarifs-fournisseurs`, cf. section suivante) — chaque route de `App.jsx` enveloppe sa page dans
  `<OngletsTarifs>` ; adresses inchangées (liens, favoris, tuiles).
- Plus de rubrique « Tarifs » dépliable ni de sous-groupe « Beta » ; `/telephones-vente` (« Mes téléphones », doublon du
  catalogue) redirige vers `/tarifs-telephones`. « Site Tarifs iPhone » reste dans Administration.
- **Plus de « Prix à revoir »** (gérant, 06/11/2026 : « valide tout et efface cette catégorie ») : l'entrée du menu et
  l'onglet « Propositions de prix » ont disparu ; la page devient « Modèles sans prix et alias » (`/modeles-sans-prix`,
  `ModelesSansPrixPage.jsx`, ancienne adresse `/prix-a-revoir` redirigée), atteinte depuis la grille (« Modèles sans prix
  et alias ») et la tuile « Modèles sans prix » de la santé des prix. Une tuile « Prix appliqués » (`sante.appliques_7j`)
  remplace « Propositions » et mène à Recherche fournisseurs, dont le bas de page liste « Derniers prix appliqués
  automatiquement » (`GET /api/tarifs/fournisseurs/recents?q=&jours=`, `api/fournisseurs.prix_recents` : historique
  des coûts de source import / mobilax / utopya / commande, ancien → nouveau prix client, HT pour l'admin) — information
  seulement, pour repérer une erreur en passant.

## Grille comparative des fournisseurs (`tarifs_fournisseurs_prix`, `prix.cible_fournisseur`)

- **Un prix par fournisseur et par pièce** : chaque import fournisseur (synchro Mobilax, collecte Utopya) note le prix de
  CE fournisseur dans `tarifs_fournisseurs_prix` (`prix.enregistrer_prix_fournisseur` : clé de pièce, fournisseur, HT de la
  variante la moins chère, référence, désignation, page, `en_stock`, `vu_le`, `prix_maj_le`), retenu ou non. Le coût retenu
  reste `prix_fournisseur_ht` / `*_prix_ht` (colonne `fournisseur` = d'où il vient).
- **Rien à valider, nulle part** : la synchro et la collecte appliquent les prix du fournisseur, grosses variations
  comprises (`planifier(proposer=False)`, compteur `variations_appliquees`) ; le prix HT payé sur une commande devient le
  coût de la pièce tout de suite (`prix.appliquer_prix_commande`, appelé par `api/parts._appliquer_prix` : écart > 1 €,
  source `commande`, lot annulable, trace `tarifs_propositions` statut `acceptee` — `refusee` pour une pièce verrouillée,
  jamais touchée ; réponse `proposition_id` (trace) + `prix_applique`). Les propositions encore en attente ont été réglées
  une fois au démarrage (`propositions_prix.valider_en_attente_au_demarrage`, marqueur `PROPOSITIONS_VALIDEES_2026_11_06` :
  commande → appliquée ; fournisseur → appliquée si c'est le retenu ou si le coût n'était pas une référence, sinon
  fermée ; verrou → refusée). Les routes `/api/tarifs/propositions` restent (historique, tests).
- **Fournisseur retenu pour toute la grille — jamais « le moins cher »** (décision du gérant, 06/11/2026) : param
  `FOURNISSEUR_PREFERE` (`Mobilax` | `Utopya` ; vide = `fournisseurs.PREFERENCE_DEFAUT` = Mobilax, `etat().preference_defaut`),
  `PUT /api/tarifs/fournisseurs/preference {fournisseur}` (admin, obligatoire) → `prix.appliquer_preference` aligne les coûts
  retenus en tâche de fond (`lancer_preference`, un lot, `etat().preference_en_cours / preference_resultat`).
  `prix.cible_fournisseur(dispo, desc, prefere)` : choix à la pièce (`fournisseur_choisi`), sinon le préféré, sinon l'autre
  quand le préféré n'a pas la pièce (complément) — le prix ne décide jamais. `planifier` : une pièce retenue chez l'autre
  fournisseur dont le coût en vigueur vient bien de lui et reste une référence est laissée (`autre_fournisseur_retenu`,
  compteur `autre_fournisseur_choisi`) ; sinon le prix est appliqué (`complements`). Bloc « Fournisseur retenu pour la
  grille : Mobilax | Utopya » de SynchroFournisseur. Choix par pièce possible (`PATCH …/{id}/fournisseur`), sans UI.
- **Cohérence qualité ↔ produit** (`fournisseurs.qualite_coherente`, `purger_prix_incoherents`) : vérifié sur le Pixel 6
  (Mobilax « Ecran Tactile Original … G949-00175-01 » = officiel, « Original Refurb (PIEC) » = reconditionné, « Oled » =
  compatible ; Utopya « Ecran Complet Google Pixel 6 » réf. 420921, 97 € = officiel, « (ReLife) » 54,91 € = compatible).
  Un produit reconditionné (Pulled, Refurb, Assembled, Grade…) ou compatible (ReLife, BOLT, SPARK, OLED, Incell…, ou Utopya
  sans étiquette à réf. alphanumérique) ne tient jamais la ligne « Original » ; la ligne « Reconditionné » exige un
  marqueur de reconditionné ; une ligne compatible refuse l'officiel. La purge (après chaque passage et au démarrage,
  `_boucle` → `purger_qualites`) retire ces prix de la grille comparative et corrige la pièce dont le coût venait d'un tel
  produit : prix cohérent du fournisseur retenu ou de l'autre, sinon « prix à renseigner » (`prix.vider_prix` : HT 0,
  client 0, `prix_source` a_renseigner) — jamais un prix faux gardé. Résumé `purge {examines, supprimes, reassignees, videes}`.
  **L'import et la purge doivent dire la même chose**, sinon la pièce est écrite puis vidée à chaque passage (P Smart Z,
  Galaxy A05s vidés chaque nuit jusqu'au 10/11/2026) : `fournisseurs.sans_faux_marqueurs` retire avant toute lecture
  d'étiquette « (Original Size) », « (Original Notch) » et le « Prime » / « Premium » d'un nom de modèle (Y9 Prime 2019,
  Narzo 50i Prime, Grand Prime, XZ Premium ; l'étiquette Utopya s'écrit « (Prime) ») — utilisé par `qualite_coherente`
  et `utopya.qualite_nom` ; un écran de catégorie Mobilax « Original » dont le nom porte un marqueur de reconditionné
  (« (Grade A) ») est importé « Reconditionnee » (`lignes_produit`). Test d'invariant :
  `test_lignes_produit_qualite_coherente_avec_la_purge`.
- **Catalogue fournisseur et recherche de tarifs pro** : `fournisseurs_catalogue` (`prix.enregistrer_catalogue`, appelé par
  `_importer(lignes=)` : un produit par (fournisseur, ref) tel que le fournisseur le nomme, HT, `en_stock`, fiche, marque /
  modèle / pièce / qualité lus, `tarif_cle` reçue, texte `recherche` normalisé ; `purger_catalogue` après un passage complet).
  `GET /api/tarifs/fournisseurs/recherche?q=&type=` → modèles de la grille dont le nom porte chaque mot (jetons d'un chiffre
  gardés : « Pixel 6 »), pièces avec `prix_fournisseurs` des deux fournisseurs, et pour l'admin les produits du catalogue
  (`prix.rechercher_catalogue`, prix client qu'ils donneraient). Page `RechercheFournisseursPage.jsx` (onglet « Recherche
  fournisseurs ») : Pièce | Mobilax | Utopya | Retenu (HT admin, prix client, En stock / Rupture, réf., fiche, « retenu »),
  filtre par type, `?q=&type=`, catalogues Mobilax / Utopya côte à côte (admin), code admin proposé au personnel.
- **Stock** : Mobilax `quantity` / `is_availibility_alert` (`en_stock_produit`) ; Utopya, favori **version 3** : la tuile en
  rupture porte « Prévenez-moi quand il sera disponible. » (`stock: 'rupture' | 'ok'`, `utopya.en_stock_tuile`). Affiché
  dans les grilles fournisseur (« En stock » / « Rupture »), « Rupture chez X » sur le coût retenu, et dans la recherche.
- **Trois grilles** : `GET /reparation-smartphones/modele` → pièce `prix_fournisseurs {Mobilax: {ht (admin), client, calcul
  (admin), ref, url, en_stock, vu_le, connu}, Utopya: …}` ; dans Réparation smartphones, « Prix retenus | Grille Mobilax |
  Grille Utopya » (`?grille=mobilax|utopya`, `TableauPieces grille=`, `LigneGrilleFournisseur` en lecture seule : prix
  relevé, calcul, prix client qu'il donnerait, « retenu », « En stock » / « Rupture »).
- **Qualités d'écran** : « Original » = l'officiel seulement (Service Pack, « Ecran Tactile Original », « Ecran Original
  Google ») ; « Original Pulled / Refurb / Assembled » (Mobilax) et « Pulled » (Utopya) = Reconditionnee, jamais la ligne
  Original (`REPLI_ECRAN` sans Original ← Reconditionnee). Utopya : sans étiquette, SKU numérique = origine
  (« Ecran Complet Noir Galaxy A54 5G (A546B) »), SKU alphanumérique (« A546-OLED@ », « IP11-BOLT ») = compatible.
- **Écran avec châssis d'abord** (gérant, 07/11/2026 : « nous réparons avec châssis ») : Mobilax (catégorie « Ecran Tactile
  Original sans Châssis ») et Utopya (« Ecran Complet Galaxy S25 (S931B) (Sans Châssis) ») vendent l'écran officiel des
  Samsung en deux variantes : l'écran complet (un peu moins de 100 € HT sur un S25, nom sans mention ou « avec Châssis »)
  et la dalle seule « sans châssis » (un peu moins de 70 €). `prix.chassis_designation(nom)` → True / False / None (écran
  seulement) ; `prix.rang_chassis` fait passer un « sans châssis » après toutes les autres variantes dans
  `fournisseurs.planifier` et `prix.enregistrer_prix_fournisseur` (il ne l'emporte que seul). Lignes Mobilax / Utopya
  portent `chassis` ; `prix_fournisseurs`, `_prix_fournisseurs_out` et `rechercher_catalogue` le renvoient (lu dans la
  désignation, aucune colonne) ; badge « Avec châssis » / « Sans châssis » (orange, `BadgeChassis`) sur le coût retenu,
  les grilles Mobilax / Utopya, les cellules et catalogues de Recherche fournisseurs. `fournisseurs.corriger_sans_chassis`
  (après chaque passage et au démarrage, `purger_qualites`) remplace un prix relevé « sans châssis » par l'écran avec châssis
  du catalogue du même fournisseur (qualité cohérente, le moins cher), et le coût retenu s'il en venait ; résumé `chassis
  {examines, corriges, reassignees}` (« N écrans passés sur la variante avec châssis »).
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
- **Tests** : `tests/test_grille_fournisseurs.py`, `test_recherche_fournisseurs.py` (cohérence, purge, catalogue, route),
  `test_prix_moteur.py` (iPad, nappe power), `test_fournisseurs_mobilax.py` (familles, débordement, fournisseur retenu),
  vitest `reparation_smartphones.test.jsx` (« grille comparative »), `recherche_fournisseurs.test.jsx`, `synchro_fournisseur.test.jsx`.

## Community Manager : publication Instagram via Late / Zernio (`app/services/reseaux_sociaux.py`)

- **Late a été rebaptisé Zernio** (même service, même clé `LATE_API_KEY`, ou `ZERNIO_API_KEY`). `reseaux_sociaux.requete`
  essaie `https://getlate.dev/api/v1` puis `https://zernio.com/api/v1` (domaine suivant sur 3xx / 404 / erreur réseau ;
  un délai dépassé n'est jamais rejoué) ; `LATE_API_BASE` force une base. Comptes connectés (07/11/2026) :
  Instagram @klikphone, LinkedIn KLIKPHONE.
- **Un post part sur le compte de SA plateforme, jamais ailleurs** (`corps_publication`) : avant, un post Instagram sans
  photo partait en silence sur LinkedIn. Instagram sans photo → 400 « Instagram exige une photo » ; réseau non connecté →
  400 avec la liste des comptes connectés. Légende Instagram ≤ 2 200 caractères, 30 hashtags au plus, hashtag déjà
  dans le texte non répété.
- **Réponse Late** (`lire_publication`) : 201 / 200 / **207** (partiel ou échec : `platformResults`, `error`), identifiant
  `post._id` (gardé dans `external_post_id`). Erreurs traduites (`erreur_reponse`) : `ACCOUNT_DISCONNECTED` → « Reconnecter »,
  409 doublon, 401 clé refusée, 429.
- **Programmer** (`POST /posts/{id}/programmer`) envoie le post à Late avec `scheduledFor` + `timezone: Europe/Paris`
  (avant : statut changé, rien publié). `POST /posts/actualiser` relit chez Late les posts programmés échus (publié /
  erreur), appelé par l'écran à l'ouverture.
- **Connecter / reconnecter un réseau** : `GET /api/marketing/late/connect/{plateforme}?retour=/tech|accueil/community`
  → `authUrl` Zernio (profil des comptes déjà connectés, sinon `GET /v1/profiles`) ; retour sur la page avec
  `?connexion=late&connected=…&username=…` (ou `error`). Bloc « Comptes connectés » de l'onglet Posts.
- **Photos** : table `marketing_images` (BYTEA, créée par `marketing._ensure_tables`) ; `POST /api/marketing/images`
  (admin, champ `fichier`, 15 Mo) et images IA passent par `reseaux_sociaux.preparer_image` → JPEG, orientation EXIF,
  fond blanc, recadrage au centre dans 4:5 – 1,91:1, 1 440 px de large au plus. Servies **sans jeton** (Late / Instagram
  les téléchargent) par `GET /api/marketing/images/{id}.jpg`, URL bâtie sur `BACKEND_URL` / `RAILWAY_PUBLIC_DOMAIN`.
  Avant : en mémoire, perdues à chaque redéploiement — une ancienne URL absente donne « remettez une photo ».
- **Image IA en tâche de fond** : `POST /posts/generer-image` → `{job_id}`, suivi `GET /posts/generer-image/{job_id}`
  (l'écran interroge toutes les 4 s, 8 min au plus). Together AI d'abord si `TOGETHER_API_KEY` (modèle
  `TOGETHER_IMAGE_MODEL`, défaut FLUX.1-schnell payant — **crédit épuisé au 07/11/2026 : 402**), sinon AI Horde
  (gratuit, plusieurs modèles photo, jusqu'à 6 min). Constaté en prod le 07/11/2026 : Horde > 3 min puis échec, d'où la
  photo envoyée comme voie principale.
- **Écran** (`CommunityManager.jsx`) : Instagram par défaut, « Ajouter une photo » (générateur et brouillons),
  « Publier sur <réseau> » désactivé pour un brouillon Instagram sans photo, « Voir » / « Modifier » le texte d'un
  brouillon, échec de publication d'un post généré → gardé en brouillon.
- **Claude Code ↔ Instagram** : serveur MCP Zernio `claude mcp add --scope user --transport http zernio
  https://mcp.zernio.com/mcp`, puis `/mcp` → zernio → Authenticate (compte Zernio du gérant).
- **Tests** : `tests/test_reseaux_sociaux.py` (httpx.MockTransport, base simulée), vitest `community_manager.test.jsx`.

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

## Offres commerciales : case cochée d'office (gérant, 11/11/2026)

- **Cadre** : offres de la boutique à ses propres clients sur des services analogues (réparation, téléphones,
  accessoires) — exception « client existant » de l'article L34-5 du CPCE, pas un consentement « opt-in » : le client
  doit pouvoir s'y opposer simplement **à la collecte** (case à décocher) **et dans chaque message** (lien de
  désinscription, « STOP » en SMS — à mettre dans toute campagne). Une case pré-cochée ne vaut jamais consentement RGPD :
  ne pas l'utiliser pour autre chose (partenaires, revente, profilage).
- **Formulaires** (comptoir `ClientFormPage`, borne `DepotPage`, dépôt à distance `DeposerPage`) : état initial
  `CONSENTEMENT_PAR_DEFAUT` (`ConfidentialitePage.jsx`), libellé « Recevoir par SMS ou e-mail les offres de … » et aide
  « Décochez la case si vous ne souhaitez pas les recevoir… ». Politique de confidentialité `POLITIQUE_VERSION` 2026-11-11.
- **Retrait respecté** : `clients._SET_CONSENTEMENTS` n'écrit l'accord que si `consentement_marketing_retire_le IS NULL`
  — une case restée cochée ne remet jamais un client qui avait retiré son accord ; seul le personnel le rétablit sur la
  fiche (PATCH), à la demande du client.
- **Clients existants** : cochés une fois au démarrage (`rgpd.cocher_offres_au_demarrage`, marqueur
  `OFFRES_CLIENTS_EXISTANTS_2026_11_11` dans `params`, valeur = date + `coches=… retraits_respectes=…`), sauf retrait
  daté ou fiche anonymisée ; source `boutique:clients-existants-2026-11-11` (retour arrière possible par cette source).
- **Tests** : `tests/test_offres_cochees.py`, `test_lot5_conformite.py` (base réelle), vitest `lot5_accueil`, `borne_depot`.

## Sauvegarde complète (`app/services/sauvegarde.py`, gérant 11/11/2026)

- **Pourquoi** : Supabase est au plan **gratuit** (aucune sauvegarde téléchargeable de son côté) : le fichier de
  *Configuration → Sauvegarde* est la seule copie du gérant. L'ancien export ne couvrait que 15 tables sur 44 (ni la
  grille des tarifs, ni les attestations, ni le stock iPhone) et rendait vide en silence une table illisible.
- **Export** `GET /api/config/backup` (élévation admin) : toutes les tables du schéma public lues dans la base (une table
  ajoutée plus tard est sauvée sans rien changer), sauf `TABLES_EXCLUES` (sessions / révocations admin ; catalogue
  fournisseur et imports de prix, refaits par la synchro) ; jamais les secrets de `params` (`config.est_secret`, listés
  dans `secrets_omis`) ni `tickets.pin / pattern` ; table illisible → `erreurs` (savepoint), jamais vide en silence.
  Format v2 `{format, version, backup_date, tables, comptes, erreurs, exclues, colonnes_omises, secrets_omis}` ;
  binaire en `{"$base64": …}`. Date et tables en erreur gardées dans `params` (`SAUVEGARDE_DERNIERE[_ERREURS]`),
  `GET …/backup/etat` (tout le personnel) → rappel « Dernière sauvegarde … — pensez à en refaire une » après 30 jours.
- **Classeur lisible** `GET …/backup/lisible` : Excel « Réparations » + « Clients », lisible sans le logiciel.
- **Restauration** `POST …/backup/import` : tables du fichier présentes dans la base, parents d'abord (clés étrangères
  lues dans `pg_constraint`), colonnes communes, `execute_values` par 500, jsonb / bytea / interval adaptés, secrets et
  réglages d'équipe actuels gardés, séquences recalées ; tout ou rien (une transaction). Un fichier v1 se restaure.
- **Tests** : `tests/test_sauvegarde.py`, vitest `sauvegarde.test.jsx`.

## Workflow automatique après chaque modification UI

Après chaque modification d'un fichier .tsx, .jsx ou .html dans src/components ou app/ :
1. Vérifie l'accessibilité : contrastes WCAG AA, labels aria, focus clavier, touch targets ≥ 44px
2. Vérifie la performance : pas d'animations sans prefers-reduced-motion, pas de layout shift, images optimisées
3. Corrige automatiquement les problèmes trouvés sans demander
4. Lance npm run build pour vérifier que ça compile

Ne me demande PAS avant de corriger ces problèmes — fais-le automatiquement.
