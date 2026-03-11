# Klikphone SAV

Application de gestion de service après-vente pour magasin de réparation de téléphones.

## Stack technique

| Couche | Technologies |
|--------|-------------|
| **Backend** | FastAPI, psycopg2, PostgreSQL (Supabase) |
| **Frontend** | React 18.3, Vite, Tailwind CSS 3.4, react-router-dom 6.26, lucide-react |
| **Auth** | JWT + PIN 4 chiffres (rôles : accueil, tech) |
| **Deploy** | `git push` sur `main` → Railway auto-deploy |
| **Tests** | pytest (backend), vitest + testing-library (frontend) |

## Structure du projet

```
klikphone-sav/
├── backend/
│   ├── app/
│   │   ├── main.py              # Point d'entrée FastAPI
│   │   ├── database.py          # Connexion PostgreSQL (psycopg2)
│   │   ├── models.py            # Modèles Pydantic
│   │   ├── api/                 # Routers FastAPI
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
│   │   ├── pages/
│   │   │   ├── DashboardPage.jsx
│   │   │   ├── TicketDetailPage.jsx  # Page CRM détail ticket
│   │   │   ├── ClientFormPage.jsx    # Formulaire client (6 étapes)
│   │   │   ├── ClientsPage.jsx
│   │   │   ├── CommandesPage.jsx
│   │   │   ├── SuiviPage.jsx
│   │   │   ├── AttestationPage.jsx
│   │   │   ├── ConfigPage.jsx
│   │   │   ├── DevisPage.jsx
│   │   │   ├── DevisFlashPage.jsx
│   │   │   ├── TarifsPage.jsx
│   │   │   ├── TarifsTelephonesPage.jsx
│   │   │   ├── TelephonesVentePage.jsx
│   │   │   ├── DepotPage.jsx         # Dépôt à distance
│   │   │   ├── DeposerPage.jsx
│   │   │   ├── AdminPage.jsx
│   │   │   ├── AvisGoogle.jsx
│   │   │   ├── CommunityManager.jsx
│   │   │   ├── LoginPage.jsx
│   │   │   └── HomePage.jsx
│   │   └── components/
│   │       ├── Navbar.jsx           # Sidebar navigation (dark theme)
│   │       ├── StatusBadge.jsx
│   │       ├── ProgressTracker.jsx
│   │       ├── PatternGrid.jsx      # Grille SVG 3x3 (pattern unlock)
│   │       ├── PrintDrawer.jsx
│   │       ├── MessageComposer.jsx
│   │       ├── AutocompleteField.jsx
│   │       ├── ErrorBoundary.jsx
│   │       ├── Toast.jsx
│   │       └── ...
│   └── package.json
└── CLAUDE.md
```

## Design & UI

- **Palette** : Violet/Indigo (`#7C3AED` primary), défini dans `tailwind.config.js` comme `brand`
- **Fonts** : Plus Jakarta Sans (titres) + Inter (corps)
- **Composants UI** : Tailwind natif (pas de librairie UI externe)

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
npm run dev          # Dev server (Vite)
npm run build        # Build production
npm run test         # Tests vitest

# Tests backend
cd backend && pytest

# Deploy
git add -A && git commit -m "message" && git push origin main
```

## Points d'attention

- `date_recuperation` est du texte libre, PAS un datetime
- `PatternGrid` stocke le pattern en string dash-separated : `"1-5-9-6-3"`
- React Router 6 : les `<Route>` doivent être enfants directs de `<Routes>`, pas dans des fragments
- Railway timeout HTTP ~15s : utiliser `BackgroundTasks` de FastAPI pour les opérations longues
- `frontend/dist` est gitignored : utiliser `git add -f frontend/dist` si besoin de le committer
- Utiliser des caractères UTF-8 réels, pas des séquences `\u` dans le code
- Le scraper LCD-Phone utilise l'endpoint AJAX PrestaShop (`?ajax=1&action=productList`), pas le HTML statique
- `type_produit` : valeurs `'neuf'` et `'occasion'` uniquement (pas `'reconditionné'`)
