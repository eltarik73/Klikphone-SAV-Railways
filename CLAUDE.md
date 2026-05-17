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

## Workflow automatique après chaque modification UI

Après chaque modification d'un fichier .tsx, .jsx ou .html dans src/components ou app/ :
1. Vérifie l'accessibilité : contrastes WCAG AA, labels aria, focus clavier, touch targets ≥ 44px
2. Vérifie la performance : pas d'animations sans prefers-reduced-motion, pas de layout shift, images optimisées
3. Corrige automatiquement les problèmes trouvés sans demander
4. Lance npm run build pour vérifier que ça compile

Ne me demande PAS avant de corriger ces problèmes — fais-le automatiquement.
