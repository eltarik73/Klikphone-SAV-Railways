# 🔧 KLIKPHONE SAV — Application de gestion de tickets

## Architecture

```
klikphone-sav/
├── backend/          ← FastAPI (Python) — API REST
│   ├── app/
│   │   ├── main.py          ← Point d'entrée
│   │   ├── database.py      ← Connexion PostgreSQL (pool)
│   │   ├── models.py        ← Schemas Pydantic
│   │   ├── api/
│   │   │   ├── tickets.py   ← CRUD tickets
│   │   │   ├── clients.py   ← CRUD clients
│   │   │   ├── auth.py      ← Authentification JWT
│   │   │   ├── config.py    ← Paramètres boutique
│   │   │   ├── team.py      ← Membres équipe
│   │   │   ├── parts.py     ← Commandes pièces
│   │   │   └── catalog.py   ← Marques/Modèles
│   │   └── services/
│   │       ├── notifications.py  ← Discord/Email/WhatsApp
│   │       ├── caisse.py         ← Intégration caisse
│   │       └── pdf.py            ← Génération PDF
│   ├── requirements.txt
│   ├── Procfile
│   └── railway.json
│
└── frontend/         ← React + Vite + Tailwind
    ├── src/
    │   ├── App.jsx
    │   ├── main.jsx
    │   ├── pages/         ← Les 4 interfaces
    │   ├── components/    ← Composants réutilisables
    │   ├── hooks/         ← Custom hooks (API, auth)
    │   └── lib/           ← Utilitaires
    ├── package.json
    └── railway.json
```

## Déploiement sur Railway (2 services)

### 1. Backend (FastAPI)
```bash
cd backend
# Railway détecte Python automatiquement
# Variables d'environnement à configurer :
#   DATABASE_URL=postgresql://...  (ta Supabase existante)
#   JWT_SECRET=un_secret_fort
#   FRONTEND_URL=https://ton-frontend.railway.app
```

### 2. Frontend (React)
```bash
cd frontend
npm install
npm run build
# Variables d'environnement :
#   VITE_API_URL=https://ton-backend.railway.app
```

### 3. Connexion à ta base Supabase existante
La base de données N'EST PAS MODIFIÉE.
Le backend se connecte directement avec ta DATABASE_URL Supabase existante.
