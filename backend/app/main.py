"""
KLIKPHONE SAV — API REST FastAPI
Point d'entrée principal.
Last frontend bundle: index-Bevv2zlk.js (2026-05-17).
"""

import hashlib
import inspect
import logging
import os
import re
import threading
import time
import traceback
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.encoders import jsonable_encoder
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from psycopg2 import errors as pg_errors

from app.database import APPLICATION_NAME, close_pool, prechauffer_pool
from app.api import auth, tickets, clients, config, team, parts, catalog, notifications, print_tickets, caisse_api, attestation, admin, chat, fidelite, email_api, tarifs, marketing, telephones, autocomplete, devis, reporting, depot_distance, suivi, iphone_tarifs, iphones_stock, smartphones_tarifs, tracking, notifications_center
from app.services.catalog_seed import seed_catalog
from app.services import params as params_cache
from app.api import search as search_api
from app.api import public_documents
from app.api import etagere as etagere_api
from app.api import grille
from app.api import reception as reception_api
from app.api import rgpd as rgpd_api
from app.api import propositions_prix
from app.api import equipe as equipe_api
from app.services import presence
from app.services import veille_prix
from app.services import mentions

logger = logging.getLogger("klikphone.startup")


# ═══ SCHÉMA (DDL) ═══════════════════════════════════════════════
# Rejoué seulement quand son empreinte change (SCHEMA_DDL_VERSION dans params) :
# toute instruction ajoutée ou modifiée ci-dessous, ou dans une fonction de
# _ddl_modules(), change l'empreinte. Incrémenter _SCHEMA_DDL_REV force un
# nouveau passage ; KP_FORCE_SCHEMA=1 aussi (base restaurée à la main…).
SCHEMA_DDL_PARAM = "SCHEMA_DDL_VERSION"
_SCHEMA_DDL_REV = 1

_DDL_TABLES = [
    "CREATE EXTENSION IF NOT EXISTS unaccent",
    # ─── TABLES COEUR ────────────────────────────────────────────
    # Historiquement créées à la main sur la prod ; déclarées ici pour que
    # le schéma soit reproductible sur une fresh DB (test, restauration).
    # IF NOT EXISTS → no-op sur la prod existante.
    """CREATE TABLE IF NOT EXISTS params (
        cle TEXT PRIMARY KEY,
        valeur TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS membres_equipe (
        id SERIAL PRIMARY KEY,
        nom TEXT NOT NULL,
        role TEXT DEFAULT 'Technicien',
        couleur TEXT DEFAULT '#94A3B8',
        actif INTEGER DEFAULT 1
    )""",
    """CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        nom TEXT,
        prenom TEXT,
        telephone TEXT,
        email TEXT,
        societe TEXT,
        points_fidelite INTEGER DEFAULT 0,
        total_depense DECIMAL(10,2) DEFAULT 0,
        carte_camby INTEGER DEFAULT 0,
        cree_par TEXT DEFAULT '',
        date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        ticket_code TEXT,
        client_id INTEGER REFERENCES clients(id),
        categorie TEXT,
        marque TEXT,
        modele TEXT,
        modele_autre TEXT,
        imei TEXT,
        panne TEXT,
        panne_detail TEXT,
        pin TEXT,
        pattern TEXT,
        notes_client TEXT,
        notes_internes TEXT,
        commentaire_client TEXT,
        type_ecran TEXT,
        statut TEXT DEFAULT 'En attente de diagnostic',
        statut_paiement TEXT DEFAULT 'Non payé',
        paye INTEGER DEFAULT 0,
        devis_estime DECIMAL(10,2) DEFAULT 0,
        tarif_final DECIMAL(10,2) DEFAULT 0,
        acompte DECIMAL(10,2) DEFAULT 0,
        reste_a_payer DECIMAL(10,2) DEFAULT 0,
        reparation_supp TEXT,
        prix_supp DECIMAL(10,2) DEFAULT 0,
        technicien_assigne TEXT,
        historique TEXT,
        commande_piece INTEGER DEFAULT 0,
        msg_whatsapp INTEGER DEFAULT 0,
        msg_sms INTEGER DEFAULT 0,
        msg_email INTEGER DEFAULT 0,
        date_depot TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        date_maj TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        date_cloture TEXT,
        date_recuperation TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS commandes_pieces (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
        ticket_code TEXT DEFAULT '',
        description TEXT,
        fournisseur TEXT,
        reference TEXT,
        prix DECIMAL(10,2),
        statut TEXT DEFAULT 'En attente',
        notes TEXT,
        date_commande TEXT,
        date_reception TEXT,
        date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS catalog_marques (
        id SERIAL PRIMARY KEY,
        categorie TEXT NOT NULL,
        marque TEXT NOT NULL,
        UNIQUE(categorie, marque)
    )""",
    """CREATE TABLE IF NOT EXISTS catalog_modeles (
        id SERIAL PRIMARY KEY,
        categorie TEXT NOT NULL,
        marque TEXT NOT NULL,
        modele TEXT NOT NULL,
        UNIQUE(categorie, marque, modele)
    )""",
    # Audit log : actions admin sensibles (suppression, etc.)
    # Permet de tracer qui a fait quoi (ne pas truster aveuglement le staff).
    """CREATE TABLE IF NOT EXISTS admin_audit_log (
        id SERIAL PRIMARY KEY,
        user_login TEXT DEFAULT '',
        user_target TEXT DEFAULT '',
        action TEXT NOT NULL,
        target_type TEXT DEFAULT '',
        target_id INTEGER DEFAULT NULL,
        details TEXT DEFAULT '',
        ip_hash TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE INDEX IF NOT EXISTS idx_audit_action_date ON admin_audit_log(action, created_at DESC)""",
    # Demandes de commande passees depuis la vitrine publique
    # /site-tarifs-iphone (bouton 'Passer commande').
    # Statut : nouvelle / en_cours / confirmee / annulee
    """CREATE TABLE IF NOT EXISTS demandes_commandes (
        id SERIAL PRIMARY KEY,
        nom TEXT NOT NULL,
        telephone TEXT NOT NULL,
        email TEXT DEFAULT '',
        marque TEXT DEFAULT '',
        modele TEXT NOT NULL,
        stockage TEXT DEFAULT '',
        prix INTEGER DEFAULT 0,
        message TEXT DEFAULT '',
        statut TEXT DEFAULT 'nouvelle',
        date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        date_maj TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        admin_notes TEXT DEFAULT ''
    )""",
    """CREATE INDEX IF NOT EXISTS idx_demandes_commandes_statut ON demandes_commandes(statut, date_creation DESC)""",
    # Tracking events : clics sur liens publics (compteurs admin reporting)
    """CREATE TABLE IF NOT EXISTS tracking_events (
        id SERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        source TEXT DEFAULT '',
        target TEXT DEFAULT '',
        ip_hash TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE INDEX IF NOT EXISTS idx_tracking_type_date ON tracking_events(event_type, created_at)""",
    """CREATE TABLE IF NOT EXISTS historique (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
        type TEXT DEFAULT 'statut',
        contenu TEXT,
        date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        sender TEXT NOT NULL,
        recipient TEXT DEFAULT 'all',
        message TEXT NOT NULL,
        is_private BOOLEAN DEFAULT FALSE,
        read_by TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS fidelite_historique (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id),
        ticket_id INTEGER REFERENCES tickets(id),
        type TEXT NOT NULL,
        points INTEGER NOT NULL,
        description TEXT,
        date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS notes_tickets (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
        auteur TEXT NOT NULL,
        contenu TEXT NOT NULL,
        important BOOLEAN DEFAULT FALSE,
        date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS autocompletion (
        id SERIAL PRIMARY KEY,
        categorie VARCHAR(50) NOT NULL,
        terme VARCHAR(255) NOT NULL,
        compteur INTEGER DEFAULT 1,
        derniere_utilisation TIMESTAMP DEFAULT NOW(),
        UNIQUE(categorie, terme)
    )""",
    """CREATE TABLE IF NOT EXISTS devis (
        id SERIAL PRIMARY KEY,
        numero TEXT UNIQUE,
        client_id INTEGER REFERENCES clients(id),
        client_nom TEXT,
        client_prenom TEXT,
        client_tel TEXT,
        client_email TEXT,
        appareil TEXT,
        description TEXT,
        statut TEXT DEFAULT 'Brouillon',
        total_ht DECIMAL(10,2) DEFAULT 0,
        tva DECIMAL(5,2) DEFAULT 20,
        total_ttc DECIMAL(10,2) DEFAULT 0,
        remise DECIMAL(10,2) DEFAULT 0,
        notes TEXT,
        validite_jours INTEGER DEFAULT 30,
        date_creation TIMESTAMP DEFAULT NOW(),
        date_maj TIMESTAMP DEFAULT NOW(),
        date_acceptation TIMESTAMP,
        date_refus TIMESTAMP,
        ticket_id INTEGER
    )""",
    """CREATE TABLE IF NOT EXISTS devis_lignes (
        id SERIAL PRIMARY KEY,
        devis_id INTEGER REFERENCES devis(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        quantite INTEGER DEFAULT 1,
        prix_unitaire DECIMAL(10,2) DEFAULT 0,
        total DECIMAL(10,2) DEFAULT 0,
        ordre INTEGER DEFAULT 0
    )""",
    """CREATE TABLE IF NOT EXISTS telephones_vente (
        id SERIAL PRIMARY KEY,
        marque TEXT NOT NULL,
        modele TEXT NOT NULL,
        capacite TEXT,
        couleur TEXT,
        etat TEXT DEFAULT 'Occasion',
        prix_achat DECIMAL(10,2) DEFAULT 0,
        prix_vente DECIMAL(10,2) DEFAULT 0,
        imei TEXT,
        en_stock BOOLEAN DEFAULT TRUE,
        notes TEXT,
        date_ajout TIMESTAMP DEFAULT NOW()
    )""",
    """CREATE TABLE IF NOT EXISTS notifications_center (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        important BOOLEAN DEFAULT FALSE,
        target_user TEXT,
        related_ticket_id INTEGER,
        related_devis_id INTEGER,
        action_url TEXT,
        icon TEXT,
        read_by TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""",
    # Fiche de réception (phase 'entree') et contrôle de sortie ('sortie') : app/api/reception.py
    """CREATE TABLE IF NOT EXISTS ticket_controles (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        phase TEXT NOT NULL CHECK (phase IN ('entree', 'sortie')),
        items JSONB,
        complete BOOLEAN DEFAULT FALSE,
        auteur TEXT,
        date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        date_maj TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (ticket_id, phase)
    )""",
    # Journal des connexions de l'équipe (services/presence.py, api/equipe.py) : jamais de
    # coordonnées ni d'adresse IP en clair ; position effacée à 60 jours, ligne à 183 jours
    """CREATE TABLE IF NOT EXISTS connexions_equipe (
        id SERIAL PRIMARY KEY,
        sid TEXT NOT NULL,
        utilisateur TEXT NOT NULL,
        cible TEXT NOT NULL DEFAULT 'accueil',
        poste TEXT,
        appareil_type TEXT NOT NULL DEFAULT 'inconnu',
        appareil_marque TEXT,
        appareil_modele TEXT,
        systeme TEXT,
        navigateur TEXT,
        ip_empreinte TEXT DEFAULT '',
        debut TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
        derniere_activite TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
        fin TIMESTAMP,
        fin_motif TEXT,
        actions INTEGER NOT NULL DEFAULT 0,
        geo_statut TEXT,
        geo_distance_m INTEGER,
        geo_precision_m INTEGER,
        geo_le TIMESTAMP
    )""",
    # Remise de la note d'information (pointage de présence) : par membre et par version du
    # texte ; un membre sans remise de la version en vigueur n'est jamais géolocalisé
    """CREATE TABLE IF NOT EXISTS equipe_notes_remises (
        utilisateur TEXT PRIMARY KEY,
        remise_le TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
        remise_par TEXT,
        version TEXT NOT NULL
    )""",
    # Postes (lignée de session, cf. auth.py) qui ont saisi le code admin
    """CREATE TABLE IF NOT EXISTS sessions_admin (
        sid TEXT PRIMARY KEY,
        origine TEXT DEFAULT 'code',
        prouve_le TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expire TIMESTAMP NOT NULL
    )""",
    # Dernière révocation du mode admin par lignée (auth._noter_revocation : verrouillage,
    # déconnexion, changement de membre) : un jeton d'élévation X-Admin-Token émis avant est
    # refusé, même après un redémarrage du processus
    """CREATE TABLE IF NOT EXISTS revocations_admin (
        sid TEXT PRIMARY KEY,
        revoque_epoch DOUBLE PRECISION NOT NULL,
        revoque_le TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
    )""",
    # Moteur de prix (BE-A, app/services/prix.py) : historique de chaque prix écrit (annulation
    # d'un lot), aperçus d'import de fichier fournisseur, propositions venues des commandes
    """CREATE TABLE IF NOT EXISTS tarifs_historique (
        id SERIAL PRIMARY KEY,
        table_nom TEXT NOT NULL,
        ligne_id INTEGER NOT NULL,
        colonne TEXT NOT NULL,
        ancien NUMERIC,
        nouveau NUMERIC,
        source TEXT,
        lot_id TEXT,
        par TEXT,
        le TIMESTAMP DEFAULT NOW(),
        ancien_maj_le TIMESTAMP,
        ancien_source TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS tarifs_imports (
        id SERIAL PRIMARY KEY,
        fichier TEXT,
        fournisseur TEXT,
        cible TEXT,
        statut TEXT DEFAULT 'apercu',
        resume JSONB,
        par TEXT,
        le TIMESTAMP DEFAULT NOW(),
        lot_id TEXT,
        applique_le TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS tarifs_propositions (
        id SERIAL PRIMARY KEY,
        tarif_cle TEXT NOT NULL,
        ancien_ht NUMERIC,
        nouveau_ht NUMERIC,
        source TEXT,
        commande_id INTEGER,
        statut TEXT DEFAULT 'en_attente',
        par TEXT,
        le TIMESTAMP DEFAULT NOW(),
        traite_le TIMESTAMP,
        traite_par TEXT
    )""",
    # Moteur de prix (BE-B) : alias de modèles pour la grille (« iPhone Air » → « iPhone 17 Air »),
    # édités par l'admin (app/api/grille.py)
    """CREATE TABLE IF NOT EXISTS modeles_alias (
        id SERIAL PRIMARY KEY,
        alias TEXT UNIQUE NOT NULL,
        modele_canonique TEXT NOT NULL,
        categorie TEXT,
        le TIMESTAMP DEFAULT NOW()
    )""",
]

# ADD COLUMN déjà présente : écartée avant exécution (l'ALTER prendrait quand
# même l'AccessExclusiveLock sur la table)
_DDL_ALTERS = [
    # Position approximative (≈ 100 m) d'une connexion hors de la boutique ou imprécise
    # (activité de l'équipe, carte de l'administrateur) ; effacée à 60 jours comme le reste
    "ALTER TABLE connexions_equipe ADD COLUMN IF NOT EXISTS geo_lat DOUBLE PRECISION",
    "ALTER TABLE connexions_equipe ADD COLUMN IF NOT EXISTS geo_lng DOUBLE PRECISION",
    # Lieu approximatif de cette position (rue et commune, Base Adresse Nationale)
    "ALTER TABLE connexions_equipe ADD COLUMN IF NOT EXISTS geo_lieu TEXT",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS attention TEXT",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS points_fidelite INTEGER DEFAULT 0",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS total_depense DECIMAL(10,2) DEFAULT 0",
    # Bon de grattage disponible : 'film', 'reduction' ou NULL. Valable pour
    # la PROCHAINE reparation (consome au paiement par l'admin).
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS bon_grattage TEXT DEFAULT NULL",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS grattage_fait BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS grattage_gain TEXT",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reduction_montant DECIMAL(10,2) DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reduction_pourcentage DECIMAL(5,2) DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS telephone_pret TEXT",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS telephone_pret_imei TEXT",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS telephone_pret_rendu BOOLEAN DEFAULT FALSE",
    "ALTER TABLE commandes_pieces ADD COLUMN IF NOT EXISTS ticket_code TEXT DEFAULT ''",
    # Moteur de prix (BE-B) : HT réellement payé et pièce de la grille (« tarifs:123 ») → proposition
    "ALTER TABLE commandes_pieces ADD COLUMN IF NOT EXISTS prix_ht NUMERIC(10,2)",
    "ALTER TABLE commandes_pieces ADD COLUMN IF NOT EXISTS tarif_cle TEXT",
    "ALTER TABLE notes_tickets ADD COLUMN IF NOT EXISTS type_note TEXT DEFAULT 'note'",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reparation_debut TIMESTAMP",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reparation_fin TIMESTAMP",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reparation_duree INTEGER DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cree_par TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS cree_par TEXT DEFAULT ''",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS est_retour_sav BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_original_id INTEGER",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'boutique'",
    "ALTER TABLE notes_tickets ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS type_document TEXT DEFAULT 'devis'",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS carte_camby INTEGER DEFAULT 0",
    # Base créée avec l'ancien schéma (BOOLEAN) : le modèle et la prod sont en INTEGER 0/1
    """DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = current_schema() AND table_name = 'clients'
                     AND column_name = 'carte_camby' AND data_type = 'boolean') THEN
            ALTER TABLE clients ALTER COLUMN carte_camby DROP DEFAULT;
            ALTER TABLE clients ALTER COLUMN carte_camby TYPE INTEGER
                USING (CASE WHEN carte_camby THEN 1 ELSE 0 END);
            ALTER TABLE clients ALTER COLUMN carte_camby SET DEFAULT 0;
        END IF;
    END $$""",
    # date_cloture est du TEXTE : cast tolérant pour les durées des stats admin
    # (« 2026-02-30 » passe une regex mais ferait échouer toute la requête).
    # Pas PARALLEL SAFE : le bloc EXCEPTION ouvre une sous-transaction.
    """CREATE OR REPLACE FUNCTION public.kp_try_ts(text) RETURNS timestamp
        LANGUAGE plpgsql STABLE STRICT AS $kp$
    BEGIN
        RETURN $1::timestamp;
    EXCEPTION WHEN others THEN
        RETURN NULL;
    END
    $kp$""",
    # Colonnes tickets écrites par le code mais absentes des migrations
    # historiques (toggle_paye, update_ticket, parts auto-sync). Sans elles,
    # une fresh DB crashe au premier paiement / PATCH ticket.
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS statut_paiement TEXT DEFAULT 'Non payé'",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reste_a_payer DECIMAL(10,2) DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS commentaire_client TEXT",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS type_ecran TEXT",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS msg_whatsapp INTEGER DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS msg_sms INTEGER DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS msg_email INTEGER DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS historique TEXT",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS commande_piece INTEGER DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reparation_supp TEXT",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS prix_supp DECIMAL(10,2) DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS paye INTEGER DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS devis_estime DECIMAL(10,2) DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tarif_final DECIMAL(10,2) DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS acompte DECIMAL(10,2) DEFAULT 0",
    # Jeton aléatoire des liens de partage client (/api/public/documents/{jeton})
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS suivi_token TEXT",
    # Catalogue : ordre d'affichage, suppression logique, année de sortie
    "ALTER TABLE catalog_marques ADD COLUMN IF NOT EXISTS ordre INTEGER DEFAULT 100",
    "ALTER TABLE catalog_marques ADD COLUMN IF NOT EXISTS actif BOOLEAN DEFAULT TRUE",
    "ALTER TABLE catalog_modeles ADD COLUMN IF NOT EXISTS annee SMALLINT",
    "ALTER TABLE catalog_modeles ADD COLUMN IF NOT EXISTS ordre INTEGER DEFAULT 0",
    "ALTER TABLE catalog_modeles ADD COLUMN IF NOT EXISTS actif BOOLEAN DEFAULT TRUE",
    "ALTER TABLE catalog_modeles ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manuel'",
    # Fiche ticket : restitution (TEXT comme date_cloture, '%Y-%m-%d %H:%M:%S')
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS date_rendu TEXT",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS rendu_par TEXT",
    # Issue distincte du statut : 'refus_devis' (devis refusé, rendu sans réparation)
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS issue TEXT",
    # Étagère : emplacement physique de l'appareil terminé (« B3 », app/api/etagere.py)
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS emplacement TEXT",
    # Priorité atelier : 'normal' | 'express' | 'attente' (client sur place) | 'pro' (contrôle : app/models.py)
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priorite TEXT NOT NULL DEFAULT 'normal'",
    # Second numéro pour joindre le client pendant la réparation (borne : « si votre téléphone
    # reste chez nous ») ; forme canonique de clients.telephone, NULL si absent (app/models.py)
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tel_contact TEXT",
    # RGPD (app/api/rgpd.py) : information, consentement marketing, anonymisation
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS rgpd_informe_le TIMESTAMP",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS consentement_marketing BOOLEAN DEFAULT FALSE",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS consentement_marketing_le TIMESTAMP",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS consentement_marketing_retire_le TIMESTAMP",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS consentement_marketing_source TEXT",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS anonymise_le TIMESTAMP",
    # Moteur de prix (BE-A) : date et source de chaque prix, verrou manuel, fournisseur, obsolète.
    # prix_maj_le sans valeur par défaut : initialisé une fois depuis updated_at (_DONNEES_FIXES)
    "ALTER TABLE tarifs ADD COLUMN IF NOT EXISTS prix_maj_le TIMESTAMP",
    "ALTER TABLE tarifs ADD COLUMN IF NOT EXISTS prix_source TEXT",
    "ALTER TABLE tarifs ADD COLUMN IF NOT EXISTS verrou_manuel BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tarifs ADD COLUMN IF NOT EXISTS ref_fournisseur TEXT",
    "ALTER TABLE tarifs ADD COLUMN IF NOT EXISTS fournisseur TEXT DEFAULT 'Mobilax'",
    "ALTER TABLE tarifs ADD COLUMN IF NOT EXISTS obsolete BOOLEAN DEFAULT FALSE",
    # Réparation smartphones (B1) : page fournisseur d'où le prix HT a été relevé (saisie admin)
    "ALTER TABLE tarifs ADD COLUMN IF NOT EXISTS url_fournisseur TEXT",
    "ALTER TABLE tarifs_apple_devices ADD COLUMN IF NOT EXISTS prix_maj_le TIMESTAMP",
    "ALTER TABLE tarifs_apple_devices ADD COLUMN IF NOT EXISTS prix_source TEXT",
    "ALTER TABLE tarifs_apple_devices ADD COLUMN IF NOT EXISTS verrou_manuel BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tarifs_apple_devices ADD COLUMN IF NOT EXISTS ref_fournisseur TEXT",
    "ALTER TABLE tarifs_apple_devices ADD COLUMN IF NOT EXISTS fournisseur TEXT DEFAULT 'Mobilax'",
    "ALTER TABLE tarifs_apple_devices ADD COLUMN IF NOT EXISTS obsolete BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tarifs_reparation ADD COLUMN IF NOT EXISTS prix_maj_le TIMESTAMP",
    "ALTER TABLE iphone_tarifs ADD COLUMN IF NOT EXISTS prix_maj_le TIMESTAMP",
    "ALTER TABLE smartphones_tarifs ADD COLUMN IF NOT EXISTS prix_maj_le TIMESTAMP",
    # Lot de l'acceptation d'une proposition (prix.appliquer_ht) : annuler ce lot la rouvre
    "ALTER TABLE tarifs_propositions ADD COLUMN IF NOT EXISTS lot_id TEXT",
]

# Index déjà présent : écarté avant exécution (CREATE INDEX IF NOT EXISTS prend
# le ShareLock de la table avant de tester le nom)
_DDL_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_tickets_client_id ON tickets(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_tickets_statut ON tickets(statut)",
    "CREATE INDEX IF NOT EXISTS idx_tickets_date_depot ON tickets(date_depot DESC)",
    "CREATE INDEX IF NOT EXISTS idx_clients_telephone ON clients(telephone)",
    "CREATE INDEX IF NOT EXISTS idx_notes_tickets_ticket_id ON notes_tickets(ticket_id)",
    "CREATE INDEX IF NOT EXISTS idx_commandes_pieces_ticket_id ON commandes_pieces(ticket_id)",
    "CREATE INDEX IF NOT EXISTS idx_historique_ticket_id ON historique(ticket_id)",
    "CREATE INDEX IF NOT EXISTS idx_fidelite_hist_client ON fidelite_historique(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_fidelite_hist_ticket ON fidelite_historique(ticket_id)",
    "CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_tickets_technicien ON tickets(technicien_assigne)",
    "CREATE INDEX IF NOT EXISTS idx_autocompletion_categorie ON autocompletion(categorie)",
    "CREATE INDEX IF NOT EXISTS idx_autocompletion_compteur ON autocompletion(categorie, compteur DESC)",
    "CREATE INDEX IF NOT EXISTS idx_devis_client_id ON devis(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_devis_statut ON devis(statut)",
    "CREATE INDEX IF NOT EXISTS idx_devis_date ON devis(date_creation DESC)",
    "CREATE INDEX IF NOT EXISTS idx_devis_lignes_devis_id ON devis_lignes(devis_id)",
    "CREATE INDEX IF NOT EXISTS idx_telephones_vente_marque ON telephones_vente(marque)",
    "CREATE INDEX IF NOT EXISTS idx_telephones_vente_stock ON telephones_vente(en_stock)",
    "CREATE INDEX IF NOT EXISTS idx_tickets_cree_par ON tickets(cree_par)",
    "CREATE INDEX IF NOT EXISTS idx_tickets_date_cloture ON tickets(date_cloture DESC)",
    "CREATE INDEX IF NOT EXISTS idx_tickets_retour_sav ON tickets(est_retour_sav) WHERE est_retour_sav = true",
    "CREATE INDEX IF NOT EXISTS idx_tickets_original_id ON tickets(ticket_original_id) WHERE ticket_original_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_tickets_source ON tickets(source)",
    # Performance indexes — ticket_code lookups, commandes, clients
    "CREATE INDEX IF NOT EXISTS idx_tickets_ticket_code ON tickets(ticket_code)",
    "CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email)",
    "CREATE INDEX IF NOT EXISTS idx_commandes_pieces_ticket_code ON commandes_pieces(ticket_code)",
    "CREATE INDEX IF NOT EXISTS idx_commandes_pieces_statut ON commandes_pieces(statut)",
    "CREATE INDEX IF NOT EXISTS idx_notes_tickets_type ON notes_tickets(ticket_id, type_note)",
    # Index pour le filtre type_note SEUL (dashboard interactions, polées /30s)
    # — l'index composite ci-dessus a ticket_id en tête, inutilisable ici.
    "CREATE INDEX IF NOT EXISTS idx_notes_tickets_type_note ON notes_tickets(type_note)",
    "CREATE INDEX IF NOT EXISTS idx_notes_tickets_type_unread ON notes_tickets(type_note, ticket_id) WHERE (is_read = FALSE OR is_read IS NULL)",
    # Index chat_messages : unread (recipient) + conversations privées,
    # polées toutes les 5-8s par poste — sinon seq scan complet à chaque poll.
    "CREATE INDEX IF NOT EXISTS idx_chat_recipient_created ON chat_messages(recipient, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_chat_private_pair ON chat_messages(sender, recipient, created_at DESC) WHERE is_private = TRUE",
    # Index notifications_center : unread-count polé /12s par NotificationCenter.
    "CREATE INDEX IF NOT EXISTS idx_notifc_target_created ON notifications_center(target_user, created_at DESC)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_suivi_token ON tickets(suivi_token)",
    # Recherche par emplacement d'étagère (« b3 » → upper(t.emplacement) = 'B3', services/search)
    "CREATE INDEX IF NOT EXISTS idx_tickets_emplacement ON tickets (upper(emplacement)) WHERE emplacement IS NOT NULL",
    # Moteur de prix (BE-A) : une pièce par (marque, modèle, type, qualité) — doublons vérifiés à 0 en
    # prod — et une seule proposition en attente par pièce (services/prix.creer_proposition)
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tarifs_piece_unique ON tarifs "
    "(lower(marque), lower(modele), lower(type_piece), COALESCE(lower(qualite), ''))",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tarifs_propositions_attente ON tarifs_propositions (tarif_cle) "
    "WHERE statut = 'en_attente'",
    "CREATE INDEX IF NOT EXISTS idx_tarifs_propositions_statut ON tarifs_propositions (statut, le DESC)",
    "CREATE INDEX IF NOT EXISTS idx_tarifs_historique_lot ON tarifs_historique (lot_id)",
    "CREATE INDEX IF NOT EXISTS idx_tarifs_historique_ligne ON tarifs_historique (table_nom, ligne_id, id DESC)",
    "CREATE INDEX IF NOT EXISTS idx_tarifs_imports_lot ON tarifs_imports (lot_id) WHERE lot_id IS NOT NULL",
    # Journal des connexions : semaine d'un salarié, session d'un poste, connectés et expiration
    "CREATE INDEX IF NOT EXISTS idx_connexions_equipe_utilisateur ON connexions_equipe (utilisateur, debut DESC)",
    "CREATE INDEX IF NOT EXISTS idx_connexions_equipe_sid ON connexions_equipe (sid)",
    "CREATE INDEX IF NOT EXISTS idx_connexions_equipe_activite ON connexions_equipe (derniere_activite)",
    "CREATE INDEX IF NOT EXISTS idx_connexions_equipe_debut ON connexions_equipe (debut)",
]


def _ddl_modules():
    """Tables créées par les modules (chacune dans sa transaction)."""
    return [
        ("tarifs", tarifs._ensure_table),
        ("iphone_tarifs", iphone_tarifs._ensure_table),
        ("iphones_stock", iphones_stock._ensure_table),
        ("smartphones_tarifs", smartphones_tarifs._ensure_table),
        ("attestations", attestation._ensure_attestation_table),
        ("marketing", marketing._ensure_tables),
        ("telephones", telephones._ensure_table),
        ("notifications_center", notifications_center._ensure_table),
        ("chat", chat._ensure_table),
    ]


# Modules à création paresseuse (« déjà vérifié ») : ils avalent leurs erreurs,
# le drapeau dit si leur DDL est passé.
_DRAPEAUX_SCHEMA = (
    (marketing, "_tables_checked"),
    (telephones, "_table_checked"),
    (notifications_center, "_TABLE_CHECKED"),
    (chat, "_table_checked"),
)


def _source(fn) -> str:
    try:
        return inspect.getsource(fn)
    except (OSError, TypeError):
        return repr(fn.__code__.co_code) + repr(fn.__code__.co_consts)


def schema_empreinte() -> str:
    contenu = repr((_SCHEMA_DDL_REV, _DDL_TABLES, _DDL_ALTERS, _DDL_INDEXES,
                    [(nom, _source(fn)) for nom, fn in _ddl_modules()]))
    return hashlib.sha1(contenu.encode("utf-8")).hexdigest()


_RE_ADD_COLUMN = r"^ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)\b"
_RE_INDEX = r"^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)\b"


def _deja_present(stmt: str, existant: set) -> bool:
    s = " ".join(stmt.split())
    m = re.match(_RE_ADD_COLUMN, s, re.IGNORECASE)
    if m:
        return f"c:{m.group(1).lower()}.{m.group(2).lower()}" in existant
    m = re.match(_RE_INDEX, s, re.IGNORECASE)
    return bool(m) and f"i:{m.group(1).lower()}" in existant


# lock_timeout, statement_timeout
_DELAIS_DEPASSES = {"55P03", "57014"}


def _executer_lot(cur, label: str, stmts: list) -> bool:
    """Instructions dans la transaction de `cur`, chacune isolée par un SAVEPOINT.

    Tout passe : un seul aller-retour. Sinon le lot est rejoué instruction par
    instruction : seules les fautives sont écartées (journalisées). Un délai de
    verrou (55P03) ou d'instruction (57014) dépassé arrête le lot sans second essai :
    la même attente recommencerait (rejoué au prochain démarrage). True si tout est passé.
    """
    stmts = [s.strip().rstrip(";") for s in stmts if s and s.strip()]
    if not stmts:
        return True
    try:
        cur.execute("SAVEPOINT kp_lot;\n" + ";\n".join(stmts) + ";\nRELEASE SAVEPOINT kp_lot")
        return True
    except Exception as e:
        cur.execute("ROLLBACK TO SAVEPOINT kp_lot; RELEASE SAVEPOINT kp_lot")
        if getattr(e, "pgcode", None) in _DELAIS_DEPASSES:
            print(f"Warning {label}: {' '.join(str(e).split())[:300]}")
            return False
    ok = True
    for stmt in stmts:
        try:
            cur.execute("SAVEPOINT kp_ddl;\n" + stmt + ";\nRELEASE SAVEPOINT kp_ddl")
        except Exception as e:
            cur.execute("ROLLBACK TO SAVEPOINT kp_ddl; RELEASE SAVEPOINT kp_ddl")
            ok = False
            print(f"Warning {label}: {' '.join(str(e).split())[:300]} — {' '.join(stmt.split())[:120]}")
            if getattr(e, "pgcode", None) in _DELAIS_DEPASSES:
                break
    return ok


def _groupe_ddl(label: str, stmts: list, existant: set) -> bool:
    """Un groupe DDL = une transaction (verrous relâchés au COMMIT du groupe).

    lock_timeout de 3 s pour chaque groupe : un CREATE INDEX (ShareLock), un ALTER ou
    une clé étrangère vers tickets qui attend son verrou fait patienter derrière lui
    toutes les écritures de l'instance encore en service.
    """
    from app.database import get_cursor
    a_faire = [s for s in stmts if not _deja_present(s, existant)]
    if not a_faire:
        return True
    try:
        with get_cursor() as cur:
            # Deux instances qui démarrent ensemble : l'une attend l'autre (avant le lock_timeout)
            cur.execute("SELECT pg_advisory_xact_lock(727001);\nSET LOCAL lock_timeout = '3s'")
            return _executer_lot(cur, label, a_faire)
    except Exception as e:
        print(f"Warning {label}: {e}\n{traceback.format_exc()}")
        return False


def _objets_existants() -> set:
    """Colonnes (c:table.colonne) et index (i:nom) du schéma courant, en une requête."""
    from app.database import get_cursor
    try:
        with get_cursor() as cur:
            cur.execute("""
                SELECT 'c:' || lower(table_name) || '.' || lower(column_name) AS k
                FROM information_schema.columns WHERE table_schema = current_schema()
                UNION ALL
                SELECT 'i:' || lower(indexname) FROM pg_indexes WHERE schemaname = current_schema()
            """)
            return {r["k"] for r in cur.fetchall() or []}
    except Exception as e:
        print(f"Warning lecture du schéma: {e}")
        return set()


def appliquer_schema() -> bool:
    """Tables, tables des modules, colonnes, fonctions, index. True si tout est passé."""
    ok = _groupe_ddl("CREATE TABLE", _DDL_TABLES, _objets_existants())
    for mod, drapeau in _DRAPEAUX_SCHEMA:
        setattr(mod, drapeau, False)
    for nom, fn in _ddl_modules():
        try:
            fn()
        except Exception as e:
            ok = False
            print(f"Warning table {nom}: {e}\n{traceback.format_exc()}")
    ok = ok and all(getattr(mod, drapeau, False) for mod, drapeau in _DRAPEAUX_SCHEMA)
    existant = _objets_existants()
    ok = _groupe_ddl("ALTER TABLE", _DDL_ALTERS, existant) and ok
    ok = _groupe_ddl("CREATE INDEX", _DDL_INDEXES, existant) and ok
    return ok


def _etat_initial():
    """Une transaction : sessions bloquées de CETTE application, puis version du schéma.

    Seules les connexions « klikphone » restées « idle in transaction » depuis
    plus de 10 min sont coupées (transaction oubliée qui bloquerait un ALTER) :
    jamais les connexions saines de l'instance encore en service pendant un déploiement.
    """
    from app.database import get_cursor
    version = None
    with get_cursor() as cur:
        try:
            cur.execute("""
                SAVEPOINT kp_init;
                SELECT count(pg_terminate_backend(pid)) AS n FROM pg_stat_activity
                WHERE application_name = %s AND state = 'idle in transaction'
                  AND state_change < NOW() - INTERVAL '10 minutes' AND pid <> pg_backend_pid()
            """, (APPLICATION_NAME,))
            n = (cur.fetchone() or {}).get("n") or 0
            if n:
                print(f"Sessions « idle in transaction » de plus de 10 min coupées : {n}")
        except Exception as e:
            cur.execute("ROLLBACK TO SAVEPOINT kp_init")
            print(f"Warning sessions bloquées: {e}")
        try:
            cur.execute("SAVEPOINT kp_version; SELECT valeur FROM params WHERE cle = %s", (SCHEMA_DDL_PARAM,))
            row = cur.fetchone()
            version = row["valeur"] if row else None
        except Exception:
            cur.execute("ROLLBACK TO SAVEPOINT kp_version")   # base neuve : pas encore de params
    return version


def _ecrire_version(empreinte: str):
    from app.database import get_cursor
    try:
        with get_cursor() as cur:
            cur.execute(
                "INSERT INTO params (cle, valeur) VALUES (%s, %s)"
                " ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur",
                (SCHEMA_DDL_PARAM, empreinte),
            )
    except Exception as e:
        print(f"Warning version du schéma: {e}")


# ═══ DONNÉES (à chaque démarrage, chacune avec sa garde) ════════

_SEED_AUTOCOMPLETION = """
    INSERT INTO autocompletion (categorie, terme, compteur) VALUES
        ('panne', 'Écran cassé', 100),
        ('panne', 'Batterie HS', 80),
        ('panne', 'Ne charge plus', 60),
        ('panne', 'Connecteur de charge', 45),
        ('panne', 'Écran qui clignote', 40),
        ('panne', 'Vitre arrière cassée', 35),
        ('panne', 'Bouton power HS', 30),
        ('panne', 'Caméra arrière HS', 25),
        ('panne', 'Désoxydation', 25),
        ('panne', 'Tactile ne répond plus', 22),
        ('panne', 'Caméra avant HS', 20),
        ('panne', 'Haut-parleur HS', 20),
        ('panne', 'Face ID HS', 20),
        ('panne', 'LCD tâche noire', 18),
        ('panne', 'Micro HS', 15),
        ('panne', 'Touch ID HS', 15),
        ('panne', 'Écouteur interne HS', 12),
        ('panne', 'Batterie qui gonfle', 10),
        ('panne', 'Wifi / Bluetooth HS', 10),
        ('panne', 'Nappe volume HS', 8)
    ON CONFLICT (categorie, terme) DO NOTHING
"""

_DONNEES_FIXES = [
    # Rétention : chat_messages et notifications_center grossissent sans limite
    # (miroir notif → chat). Bornés à 90 jours pour garder rapides les requêtes
    # unread polées toutes les 8-12 s.
    "DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '90 days'",
    "DELETE FROM notifications_center WHERE created_at < NOW() - INTERVAL '90 days'",
    _SEED_AUTOCOMPLETION,
    """INSERT INTO params (cle, valeur) VALUES
        ('AFFICHER_AUTOCOMPLETION', 'true'),
        ('MODULE_DEVIS_VISIBLE', 'false'),
        ('MODULE_DEVIS_FLASH_VISIBLE', 'false'),
        ('DEPOT_DISTANCE_ACTIF', 'true'),
        ('NOTIFICATIONS_EMAIL_ACTIF', 'true'),
        ('NOTIFICATIONS_STATUTS', 'Réparation terminée'),
        ('GOOGLE_REVIEW_LINK', 'https://g.page/r/Cf6adrBONrj3EAE/review'),
        -- Partie admin réservée au gérant (auth.admin_autorise) ; modifiable dans params
        ('ADMIN_MEMBRES', 'Tarik')
    ON CONFLICT (cle) DO NOTHING""",
    # L'ancienne valeur semée n'était lue par rien jusqu'au message « prêt » proposé :
    # ramenée une seule fois au défaut, un choix fait ensuite dans la config est conservé.
    """UPDATE params SET valeur = 'Réparation terminée'
    WHERE cle = 'NOTIFICATIONS_STATUTS'
      AND valeur = 'Réparation terminée,En attente de pièce,En cours de réparation'
      AND NOT EXISTS (SELECT 1 FROM params WHERE cle = 'MIGRATION_NOTIF_STATUTS_2026_10')""",
    """INSERT INTO params (cle, valeur) VALUES ('MIGRATION_NOTIF_STATUTS_2026_10', '1')
    ON CONFLICT (cle) DO NOTHING""",
    """INSERT INTO params (cle, valeur) VALUES ('URL_SUIVI', 'https://klikphone-sav-v2-production.up.railway.app')
    ON CONFLICT (cle) DO UPDATE SET valeur = 'https://klikphone-sav-v2-production.up.railway.app'
    WHERE params.valeur != 'https://klikphone-sav-v2-production.up.railway.app'""",
    # Jeton de suivi expirable (public_documents.jeton_perime) : jours de validité du QR / des
    # liens envoyés après restitution ou clôture ; le numéro complet reste accepté sans limite
    """INSERT INTO params (cle, valeur) VALUES ('SUIVI_JETON_JOURS', '180')
    ON CONFLICT (cle) DO NOTHING""",
    # RGPD : un client anonymisé n'a plus de lien de suivi (rattrapage des anonymisations
    # faites avant que rgpd._anonymiser efface suivi_token ; jamais recréé, cf. _rattraper_jetons)
    """UPDATE tickets t SET suivi_token = NULL
    FROM clients c WHERE c.id = t.client_id AND c.anonymise_le IS NOT NULL AND t.suivi_token IS NOT NULL""",
    # Identité et mentions légales : clés canoniques remplies une fois depuis les anciennes
    mentions.SQL_MIGRATION,
    mentions.SQL_MIGRATION_FLAG,
    # CGV_DEPOT semé avec l'ancienne clause « 3 mois » (loi de 1903 : un an, juge) : phrase retirée
    mentions.SQL_MIGRATION_ABANDON,
    mentions.SQL_MIGRATION_ABANDON_FLAG,
    # Rétention RGPD automatique : désactivée par défaut, jamais de date de début sans activation
    rgpd_api.SQL_DEBUT_SANS_ACTIVATION,
    # Moteur de prix (BE-B) : alias de modèles initiaux, une seule fois (un alias retiré par
    # l'admin ne revient pas au démarrage suivant)
    grille.SQL_ALIAS_INITIAUX,
    grille.SQL_ALIAS_INITIAUX_FLAG,
    # Moteur de prix (BE-A) : date et source initiales des prix, une seule fois (drapeau dans le bloc)
    tarifs.SQL_INIT_PRIX,
]


def _donnees_de_demarrage():
    """Seeds des tables vides, jetons de suivi manquants, rétention, paramètres par défaut.

    Une requête dit ce qui manque ; seul le nécessaire est exécuté.
    """
    from app.database import get_cursor
    besoins = None
    try:
        with get_cursor() as cur:
            try:
                cur.execute("""
                    SAVEPOINT kp_besoins;
                    SELECT NOT EXISTS (SELECT 1 FROM iphone_tarifs) AS iphone_tarifs,
                           NOT EXISTS (SELECT 1 FROM iphones_stock) AS iphones_stock,
                           NOT EXISTS (SELECT 1 FROM smartphones_tarifs) AS smartphones_tarifs,
                           NOT EXISTS (SELECT 1 FROM templates_marketing) AS templates_marketing,
                           NOT EXISTS (SELECT 1 FROM membres_equipe WHERE nom = 'Système') AS systeme,
                           EXISTS (SELECT 1 FROM tickets t WHERE t.suivi_token IS NULL
                                   AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = t.client_id
                                                   AND c.anonymise_le IS NOT NULL)) AS jetons
                """)
                besoins = dict(cur.fetchone())
            except Exception as e:
                cur.execute("ROLLBACK TO SAVEPOINT kp_besoins")
                print(f"Warning état des données: {e}")
            _executer_lot(cur, "données de démarrage", _DONNEES_FIXES)
            # Mot de passe admin initial (variable DEFAULT_ADMIN_PASSWORD) : jamais
            # de valeur en clair dans le code ni dans les journaux, l'existant est conservé
            defaut_admin = os.environ.get("DEFAULT_ADMIN_PASSWORD")
            if defaut_admin:
                try:
                    cur.execute(
                        "SAVEPOINT kp_admin; INSERT INTO params (cle, valeur) VALUES ('ADMIN_PASSWORD', %s)"
                        " ON CONFLICT (cle) DO NOTHING; RELEASE SAVEPOINT kp_admin",
                        (defaut_admin,),
                    )
                except Exception:
                    cur.execute("ROLLBACK TO SAVEPOINT kp_admin")
                    print("Warning ADMIN_PASSWORD par défaut non enregistré")
    except Exception as e:
        print(f"Warning données de démarrage: {e}\n{traceback.format_exc()}")

    tout = besoins is None   # état illisible : chaque seed vérifie lui-même
    seeds = [
        ("iphone_tarifs", iphone_tarifs._seed_default_data),
        ("iphones_stock", iphones_stock._seed_default),
        ("smartphones_tarifs", smartphones_tarifs._seed_default),
        ("templates_marketing", marketing._seed_templates),
    ]
    for cle, fn in seeds:
        if tout or besoins.get(cle):
            try:
                fn()
            except Exception as e:
                print(f"Warning seed {cle}: {e}")
    if tout or besoins.get("systeme"):
        notifications_center._TABLE_CHECKED = False
        notifications_center._ensure_table()   # crée le membre « Système » du chat
    if tout or besoins.get("jetons"):
        _rattraper_jetons()


def _rattraper_jetons():
    """Jetons de partage manquants (tickets antérieurs, conversion de devis…).

    Jamais pour le ticket d'un client anonymisé : RGPD, son lien de suivi a été retiré."""
    import secrets
    from psycopg2.extras import execute_values
    from app.database import get_cursor
    try:
        with get_cursor() as cur:
            cur.execute("""SELECT t.id FROM tickets t WHERE t.suivi_token IS NULL
                           AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = t.client_id
                                           AND c.anonymise_le IS NOT NULL)""")
            manquants = [(r["id"], secrets.token_urlsafe(16)) for r in cur.fetchall()]
            if manquants:
                execute_values(
                    cur,
                    "UPDATE tickets t SET suivi_token = v.jeton FROM (VALUES %s) AS v(id, jeton) "
                    "WHERE t.id = v.id AND t.suivi_token IS NULL",
                    manquants, page_size=1000,
                )
                print(f"suivi_token : {len(manquants)} ticket(s) rattrapé(s)")
    except Exception as e:
        print(f"Warning suivi_token: {e}\n{traceback.format_exc()}")


def _migrations_recherche():
    """Recherche staff (app/services/search.py) : pg_trgm, fonctions IMMUTABLE kp_*, index.

    Une requête lit l'état (extensions, corps des fonctions, index présents) ;
    seul ce qui manque ou a changé est exécuté, chaque instruction isolée par un
    SAVEPOINT : un échec (droits, extension absente) est journalisé sans bloquer
    le démarrage, et la recherche marche sans pg_trgm. Les extensions peuvent
    vivre dans « public » ou « extensions » (Supabase) : le schéma est lu dans
    pg_extension, jamais supposé.
    """
    from psycopg2 import sql as psql
    from app.database import get_cursor
    from app.services import search as S

    noms_fonctions = ["kp_unaccent", "kp_doc", "kp_alnum", "kp_phone_digits", "kp_phone_key", "kp_word_match"]
    dev = S.doc_sql("", S.T_DEVICE_COLS)
    index_btree = [
        ("idx_clients_phone_key", "clients", "public.kp_phone_key(telephone)", ""),
        # Second numéro du ticket : recherche du dossier par « l'autre numéro »
        ("idx_tickets_tel_contact_key", "tickets", "public.kp_phone_key(tel_contact)", "tel_contact IS NOT NULL"),
        ("idx_tickets_imei_alnum", "tickets", "public.kp_alnum(imei)", "imei <> ''"),
        ("idx_tickets_pret_imei_alnum", "tickets", "public.kp_alnum(telephone_pret_imei)",
         "telephone_pret_imei <> ''"),
    ]
    index_gin = [
        ("idx_tickets_device_trgm_v1", "tickets", dev, ""),
        ("idx_tickets_device_compact_trgm_v1", "tickets", S.compact_sql(dev), ""),
        ("idx_tickets_work_trgm_v1", "tickets", S.doc_sql("", S.T_WORK_COLS), ""),
        ("idx_tickets_panne_trgm_v1", "tickets", S.doc_sql("", S.T_PANNE_COLS), ""),
        # Fragments d'IMEI : sans eux, le OR d'un mot numérique force un seq scan
        ("idx_tickets_imei_trgm", "tickets", "public.kp_alnum(imei)", ""),
        ("idx_tickets_pret_imei_trgm", "tickets", "public.kp_alnum(telephone_pret_imei)", ""),
        ("idx_clients_doc_trgm_v1", "clients", S.doc_sql("", S.C_COLS), ""),
        ("idx_clients_phone_digits_trgm", "clients", "public.kp_phone_digits(telephone)", ""),
        ("idx_tickets_tel_contact_digits_trgm", "tickets", "public.kp_phone_digits(tel_contact)",
         "tel_contact IS NOT NULL"),
        ("idx_notes_tickets_doc_trgm_v1", "notes_tickets", S.doc_sql("", S.NOTE_COLS),
         "type_note IN ('note', 'message_client', 'avis_client')"),
        ("idx_devis_doc_trgm_v1", "devis", S.doc_sql("", S.DEVIS_COLS), ""),
        ("idx_commandes_doc_trgm_v1", "commandes_pieces", S.doc_sql("", S.CMD_COLS), ""),
    ]
    noms_index = [n for n, *_ in index_btree + index_gin]

    def etat(cur):
        cur.execute("""
            SELECT
              (SELECT json_object_agg(e.extname, json_build_object('ns', n.nspname, 'qns', quote_ident(n.nspname)))
                 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
                WHERE e.extname IN ('pg_trgm', 'unaccent')) AS ext,
              EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') AS ns_extensions,
              (SELECT json_object_agg(p.proname, p.prosrc) FROM pg_proc p
                 JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = ANY(%s)) AS fonctions,
              (SELECT array_agg(c.relname::text) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = ANY(%s)) AS index
        """, (noms_fonctions, noms_index))
        r = cur.fetchone()
        return r["ext"] or {}, r["ns_extensions"], r["fonctions"] or {}, set(r["index"] or [])

    def essayer(cur, label, stmt) -> bool:
        texte = stmt if isinstance(stmt, str) else stmt.as_string(cur)
        try:
            cur.execute("SAVEPOINT kp_r;\n" + texte + ";\nRELEASE SAVEPOINT kp_r")
            return True
        except Exception as e:
            cur.execute("ROLLBACK TO SAVEPOINT kp_r; RELEASE SAVEPOINT kp_r")
            print(f"Warning recherche ({label}): {e}")
            return False

    try:
        with get_cursor() as cur:
            ext, ns_extensions, sources, presents = etat(cur)
            if "pg_trgm" not in ext:
                cur.execute("SET LOCAL lock_timeout = '3s'")
                if essayer(cur, "pg_trgm", "CREATE EXTENSION IF NOT EXISTS pg_trgm"
                           + (" WITH SCHEMA extensions" if ns_extensions else "")):
                    ext, ns_extensions, sources, presents = etat(cur)
            ua, trgm = ext.get("unaccent"), ext.get("pg_trgm")

            if ua:
                # Forme à 2 arguments (dictionnaire explicite) : seule enveloppe IMMUTABLE fiable.
                unaccent_body = psql.SQL("SELECT {}({}::regdictionary, $1)").format(
                    psql.Identifier(ua["ns"], "unaccent"), psql.Literal(ua["qns"] + ".unaccent"),
                )
            else:
                src, dst = "ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ", "AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy"
                unaccent_body = psql.SQL(
                    "SELECT translate(replace(replace(replace(replace($1, 'œ', 'oe'), 'Œ', 'OE'), 'æ', 'ae'), 'ß', 'ss'), {}, {})"
                ).format(psql.Literal(src), psql.Literal(dst))
            # Ne jamais changer un corps sans REINDEX : les index sur ces expressions
            # deviendraient silencieusement faux (géré ci-dessous via `changed`).
            funcs = [
                ("kp_unaccent", "(text) RETURNS text", unaccent_body, "IMMUTABLE PARALLEL SAFE STRICT"),
                ("kp_doc", "(text) RETURNS text", psql.SQL(
                    "SELECT ' ' || regexp_replace(lower(public.kp_unaccent(coalesce($1, ''))), '[^a-z0-9]+', ' ', 'g') || ' '"
                ), "IMMUTABLE PARALLEL SAFE"),
                ("kp_alnum", "(text) RETURNS text",
                 psql.SQL("SELECT regexp_replace(lower(coalesce($1, '')), '[^a-z0-9]+', '', 'g')"),
                 "IMMUTABLE PARALLEL SAFE"),
                ("kp_phone_digits", "(text) RETURNS text",
                 psql.SQL("SELECT regexp_replace(coalesce($1, ''), '[^0-9]+', '', 'g')"),
                 "IMMUTABLE PARALLEL SAFE"),
                ("kp_phone_key", "(text) RETURNS text", psql.SQL("SELECT right(public.kp_phone_digits($1), 9)"),
                 "IMMUTABLE PARALLEL SAFE"),
            ]
            if trgm:
                # STABLE (comme l'opérateur, qui lit pg_trgm.word_similarity_threshold) et non
                # STRICT : PostgreSQL l'inline, et « mot <% document » profite des index GIN.
                funcs.append(("kp_word_match", "(text, text) RETURNS boolean",
                              psql.SQL("SELECT $1 OPERATOR({}.<%) $2").format(psql.Identifier(trgm["ns"])),
                              "STABLE PARALLEL SAFE"))
            changed = False
            verrou = False
            for name, signature, body, flags in funcs:
                src_sql = body.as_string(cur)
                ancien = sources.get(name)
                if ancien is not None and ancien.strip() == src_sql.strip():
                    continue
                if not verrou:
                    cur.execute("SET LOCAL lock_timeout = '3s'")
                    verrou = True
                ok = essayer(cur, f"fonction {name}", psql.SQL(
                    "CREATE OR REPLACE FUNCTION public.{}" + signature + " LANGUAGE sql " + flags + " AS $kp$ {} $kp$"
                ).format(psql.Identifier(name), psql.SQL(src_sql)))
                # kp_word_match n'est la base d'aucun index : pas de REINDEX pour elle
                changed = changed or (ok and ancien is not None and name != "kp_word_match")

            analyze = set()
            for method, liste in (("btree", index_btree), ("gin", index_gin if trgm else [])):
                for name, table, expr, where in liste:
                    if name in presents:
                        if changed:
                            essayer(cur, f"reindex {name}", psql.SQL("REINDEX INDEX {}").format(psql.Identifier(name)))
                        continue
                    if method == "gin":
                        stmt = psql.SQL("CREATE INDEX IF NOT EXISTS {} ON {} USING gin (({}) {})").format(
                            psql.Identifier(name), psql.Identifier(table), psql.SQL(expr),
                            psql.Identifier(trgm["ns"], "gin_trgm_ops"),
                        )
                    else:
                        stmt = psql.SQL("CREATE INDEX IF NOT EXISTS {} ON {} (({}))").format(
                            psql.Identifier(name), psql.Identifier(table), psql.SQL(expr),
                        )
                    if where:
                        stmt = stmt + psql.SQL(" WHERE " + where)
                    if not verrou:
                        cur.execute("SET LOCAL lock_timeout = '3s'")
                        verrou = True
                    if essayer(cur, f"index {name}", stmt):
                        analyze.add(table)
            # Statistiques des nouvelles expressions indexées, sinon le planner les ignore
            for table in sorted(analyze):
                essayer(cur, f"analyze {table}", psql.SQL("ANALYZE {}").format(psql.Identifier(table)))
    except Exception as e:
        print(f"Warning recherche: {e}\n{traceback.format_exc()}")


MIGRATION_FORFAITS_LIGNES = "MIGRATION_FICHE_FORFAITS_LIGNES"
# Schémas faits de points 1 à 9 et de séparateurs, hors format « 1-5-9-6-3 » (fragment fixe)
_PATTERN_A_NORMALISER = (
    "pattern ~ '^[1-9 ,./;>–-]+$' AND pattern !~ '^[1-9](-[1-9])*$' AND length(pattern) <= 50"
)


def _migrations_fiche():
    """Fiche ticket : pannes accentuées, lignes JSON en forfaits (colonnes : _DDL_ALTERS).

    Une transaction : une requête dit ce qui reste à faire ; chaque bloc est isolé
    par un SAVEPOINT (échec journalisé sans bloquer le démarrage). date_maj
    n'est jamais touchée.
    """
    import json
    from datetime import datetime
    from psycopg2.extras import execute_values
    from app.database import get_cursor
    from app.services import prestations as P

    renommees = list(P.PANNES_RENOMMEES)   # [(nouvelle, ancienne)]

    def pannes(cur):
        execute_values(
            cur,
            "UPDATE tickets t SET panne = v.nouv FROM (VALUES %s) AS v(nouv, anc) WHERE t.panne = v.anc",
            renommees,
        )
        # Le seed recrée « Écran cassé » à chaque démarrage : on fusionne les compteurs puis on supprime
        execute_values(
            cur,
            """INSERT INTO autocompletion (categorie, terme, compteur, derniere_utilisation)
               SELECT 'panne', v.nouv, COALESCE(SUM(a.compteur), 0), MAX(a.derniere_utilisation)
               FROM (VALUES %s) AS v(nouv, anc)
               JOIN autocompletion a ON a.categorie = 'panne' AND a.terme = v.anc
               GROUP BY v.nouv
               ON CONFLICT (categorie, terme) DO UPDATE
               SET compteur = autocompletion.compteur + EXCLUDED.compteur,
                   derniere_utilisation = GREATEST(autocompletion.derniere_utilisation,
                                                   EXCLUDED.derniere_utilisation)""",
            renommees,
        )
        execute_values(
            cur,
            "DELETE FROM autocompletion a USING (VALUES %s) AS v(nouv, anc)"
            " WHERE a.categorie = 'panne' AND a.terme = v.anc",
            renommees,
        )

    def lignes_forfaits(cur):
        """Une seule fois : lignes JSON des tickets en cours égales à un symptôme → forfait.

        Exclus : tickets terminés, rendus, clôturés, payés ou facturés (document
        déjà remis), et les lignes rattachées à une commande de pièce (même libellé).
        """
        symptomes = {
            P.normaliser(v)
            for _cle, sympt, _presta, _court, alias in P.PRESTATIONS
            for v in (sympt, *alias) if v
        }
        symptomes |= {P.normaliser(anc) for _nouv, anc in renommees}
        symptomes.add("autre")
        cur.execute("""
            SELECT id, panne_detail, reparation_supp FROM tickets
            WHERE ltrim(reparation_supp) LIKE '[%'
              AND COALESCE(statut, '') NOT IN ('Réparation terminée', 'Rendu au client', 'Clôturé')
              AND COALESCE(type_document, '') <> 'facture'
              AND COALESCE(paye, 0) = 0
            FOR UPDATE
        """)
        tickets = cur.fetchall()
        commandes = {}
        if tickets:
            cur.execute(
                "SELECT ticket_id, description FROM commandes_pieces WHERE ticket_id = ANY(%s)",
                ([r["id"] for r in tickets],),
            )
            for c in cur.fetchall():
                commandes.setdefault(c["ticket_id"], set()).add((c["description"] or "").strip())
        maj = []
        for r in tickets:
            try:
                lignes = json.loads(r["reparation_supp"])
            except (TypeError, ValueError):
                continue
            if not isinstance(lignes, list):
                continue
            change = False
            for ligne in lignes:
                if not isinstance(ligne, dict):
                    continue
                label = str(ligne.get("label") or "").strip()
                if not label or label in commandes.get(r["id"], ()) or P.normaliser(label) not in symptomes:
                    continue
                forfait = P.libelle_prestation(label, r["panne_detail"])
                if forfait != label:
                    ligne["label"] = forfait
                    change = True
            if change:
                # Même sérialisation que JSON.stringify côté fiche
                maj.append((r["id"], json.dumps(lignes, ensure_ascii=False, separators=(",", ":"))))
        if maj:
            execute_values(
                cur,
                "UPDATE tickets t SET reparation_supp = v.rs FROM (VALUES %s) AS v(id, rs) WHERE t.id = v.id",
                maj,
            )
        cur.execute(
            "INSERT INTO params (cle, valeur) VALUES (%s, %s) ON CONFLICT (cle) DO NOTHING",
            (MIGRATION_FORFAITS_LIGNES, f"{datetime.now():%Y-%m-%d %H:%M:%S} — {len(maj)} ticket(s)"),
        )
        if maj:
            print(f"Forfaits : {len(maj)} ticket(s) en cours mis à niveau")

    def patterns(cur):
        """Schémas saisis sans tirets (« 15963 », « 1 5 9 6 3 ») → « 1-5-9-6-3 » (PatternGrid).
        Idempotent : seules les valeurs que models.normaliser_pattern sait ramener au format
        changent ; les autres (texte libre, chiffre répété) restent telles quelles."""
        from app.models import normaliser_pattern
        cur.execute(f"SELECT id, pattern FROM tickets WHERE {_PATTERN_A_NORMALISER} FOR UPDATE")
        maj = []
        for r in cur.fetchall():
            try:
                canon = normaliser_pattern(r["pattern"])
            except ValueError:
                continue
            if canon and canon != r["pattern"]:
                maj.append((r["id"], canon))
        if maj:
            execute_values(
                cur,
                "UPDATE tickets t SET pattern = v.p FROM (VALUES %s) AS v(id, p) WHERE t.id = v.id",
                maj,
            )
            print(f"Schémas : {len(maj)} ticket(s) remis au format 1-5-9-6-3")

    anciennes = [anc for _nouv, anc in renommees]
    try:
        with get_cursor() as cur:
            cur.execute(f"""
                SELECT EXISTS (SELECT 1 FROM tickets WHERE panne = ANY(%(anc)s))
                       OR EXISTS (SELECT 1 FROM autocompletion WHERE categorie = 'panne' AND terme = ANY(%(anc)s))
                       AS pannes,
                       NOT EXISTS (SELECT 1 FROM params WHERE cle = %(flag)s) AS forfaits,
                       EXISTS (SELECT 1 FROM tickets WHERE {_PATTERN_A_NORMALISER}) AS patterns
            """, {"anc": anciennes, "flag": MIGRATION_FORFAITS_LIGNES})
            a_faire = cur.fetchone()
            blocs = [(label, fn) for label, fn, cle in (("pannes accentuées", pannes, "pannes"),
                                                       ("lignes en forfaits", lignes_forfaits, "forfaits"),
                                                       ("schémas sans tirets", patterns, "patterns"))
                     if a_faire[cle]]
            if blocs:
                cur.execute("SET LOCAL lock_timeout = '3s'")
            for label, fn in blocs:
                cur.execute("SAVEPOINT kp_fiche")
                try:
                    fn(cur)
                    cur.execute("RELEASE SAVEPOINT kp_fiche")
                except Exception as e:
                    cur.execute("ROLLBACK TO SAVEPOINT kp_fiche")
                    print(f"Warning fiche ({label}): {e}")
    except Exception as e:
        print(f"Warning fiche: {e}")


def _prechauffer_pool():
    try:
        prechauffer_pool()
    except Exception as e:
        print(f"Warning préchauffage du pool: {e}")


def _marquer_schema_verifie():
    """Schéma à jour : les modules à création paresseuse n'ont plus rien à vérifier."""
    for mod, drapeau in _DRAPEAUX_SCHEMA:
        setattr(mod, drapeau, True)


# Délais (s) des nouveaux essais en fond quand le DDL du démarrage a échoué : pendant un
# déploiement, l'instance sortante tient des verrous sur tickets au-delà du lock_timeout.
_RELANCES_SCHEMA = (30, 60, 120)


def _relancer_schema(empreinte: str, arret: threading.Event, delais=_RELANCES_SCHEMA) -> bool:
    """Rejoue le schéma (puis les données qui en dépendent) sans attendre le prochain démarrage."""
    for essai, delai in enumerate(delais, 1):
        if arret.wait(delai):   # arrêt de l'application : plus de DDL
            return False
        try:
            ok = appliquer_schema()
        except Exception as e:
            ok = False
            print(f"Warning nouvel essai du schéma: {e}")
        if ok:
            _ecrire_version(empreinte)
            for etape in (_donnees_de_demarrage, _migrations_recherche, _migrations_fiche):
                try:
                    etape()
                except Exception as e:
                    print(f"Warning {etape.__name__}: {e}")
            tickets._reception_absente_le = 0.0   # repli du dashboard levé tout de suite
            params_cache.invalidate()
            print(f"Schéma appliqué au nouvel essai {essai} ({empreinte[:12]})")
            return True
        print(f"Schéma toujours incomplet (essai {essai}/{len(delais)})")
    print("Schéma toujours incomplet : nouvel essai au prochain démarrage")
    return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Démarrage : schéma (si son empreinte a changé), données, puis service ; pool fermé à l'arrêt."""
    debut = time.perf_counter()
    empreinte = schema_empreinte()
    try:
        version = _etat_initial()
    except Exception as e:
        print(f"Warning état initial: {e}\n{traceback.format_exc()}")
        version = None
    force = os.getenv("KP_FORCE_SCHEMA") == "1"
    schema_incomplet = False
    arret_relance = threading.Event()
    if version == empreinte and not force:
        _marquer_schema_verifie()
        print(f"Schéma à jour ({empreinte[:12]}) : DDL sauté")
    else:
        if appliquer_schema():
            _ecrire_version(empreinte)
            print(f"Schéma appliqué ({empreinte[:12]})")
        else:
            schema_incomplet = True
            print("Schéma appliqué avec des erreurs : empreinte non enregistrée, nouveaux essais en fond")

    # Données : après le schéma (colonnes et tables présentes)
    _donnees_de_demarrage()
    # Déconnexion générale demandée par le gérant (une seule fois : on repart à zéro) ;
    # KP_DECONNEXION_DEMARRAGE=0 l'empêche (tests : jetons préparés avant le démarrage)
    if os.getenv("KP_DECONNEXION_DEMARRAGE", "1") != "0":
        auth.deconnexion_generale_unique("2026_10_25")
    # Recherche staff : après les ALTER, pour que toutes les colonnes indexées existent
    _migrations_recherche()
    # Fiche ticket : après le seed, pour fusionner « Écran casse » dans « Écran cassé »
    _migrations_fiche()
    # Catalogue marques/modèles : seed versionné (no-op si déjà appliqué)
    try:
        seed_catalog()
    except Exception as e:
        print(f"Warning catalog seed: {e}\n{traceback.format_exc()}")
    # Backfill + catalogue iPhones en arrière-plan (ne retarde pas le démarrage)
    iphones_stock.lancer_init_differee()
    # Rétention RGPD : vérification horaire en tâche de fond, sans effet tant qu'un admin ne l'a
    # pas activée (RGPD_RETENTION_AUTO = '1', premier passage 7 jours après l'activation)
    rgpd_api.demarrer_retention_quotidienne()
    # Journal des connexions : position effacée à 60 jours, lignes à 183 jours, sessions inactives
    # depuis 12 h closes (chaque heure ; KP_RETENTION_AUTO=0 empêche la tâche)
    presence.demarrer_retention()
    # Veille des prix : un passage par semaine (comptages et notification, aucun prix écrit) ;
    # KP_VEILLE_PRIX=0 empêche même la tâche
    veille_prix.demarrer_veille_hebdomadaire()
    params_cache.invalidate()
    # Connexions du pool ouvertes en tâche de fond (une seule a servi au démarrage)
    threading.Thread(target=_prechauffer_pool, daemon=True, name="pool_prechauffage").start()
    if schema_incomplet:
        threading.Thread(target=_relancer_schema, args=(empreinte, arret_relance),
                         daemon=True, name="schema_relance").start()
    print(f"Démarrage : {time.perf_counter() - debut:.2f} s")

    yield
    arret_relance.set()
    close_pool()


# Désactive la doc Swagger/Redoc en prod (évite d'exposer l'arborescence de
# l'API). Réactivable via DISABLE_DOCS=0 si besoin de debug.
_DISABLE_DOCS = os.getenv("DISABLE_DOCS", "1") != "0"

app = FastAPI(
    title="Klikphone SAV API",
    version="2.1.0",
    description="API de gestion de tickets SAV pour Klikphone",
    lifespan=lifespan,
    docs_url=None if _DISABLE_DOCS else "/docs",
    redoc_url=None if _DISABLE_DOCS else "/redoc",
    openapi_url=None if _DISABLE_DOCS else "/openapi.json",
)

# --- CORS ---
# allow_credentials=False car on utilise JWT en header (pas de cookies). Cela
# permet de garder allow_origins=["*"] côté navigateur (les credentials avec
# wildcard origin sont de toute façon refusés par les navigateurs).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- GZIP (réponses > 500 octets ; niveau 6 : ~4x moins de CPU que 9 pour ~3 % de plus) ---
app.add_middleware(GZipMiddleware, minimum_size=500, compresslevel=6)


# --- SECURITY HEADERS + CACHE HEADERS for static assets ---
@app.middleware("http")
async def security_and_cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    # Journal des connexions : activité de la session (mémoire, écrite au plus une fois par minute)
    presence.noter_requete(request, response.status_code)

    # ─── Security headers (toujours posés sur les réponses HTML/JSON) ───
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = (
        # geolocation=(self) : une lecture de position par session (pointage de présence, désactivé
        # par défaut, réglé par l'admin) ; jamais pour un cadre tiers
        "geolocation=(self), microphone=(), camera=(), payment=()"
    )
    # HSTS uniquement sur HTTPS (Railway sert en HTTPS, donc actif)
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    # ─── Cache headers (assets versionnés Vite) ───
    # Hashed JS/CSS assets: cache 1 year (immutable, filename changes on rebuild)
    if path.startswith("/assets/") and any(path.endswith(ext) for ext in (".js", ".css")):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    # Images/fonts: cache 1 week
    elif path.startswith("/assets/") or path.endswith((".png", ".jpg", ".svg", ".woff2")):
        response.headers["Cache-Control"] = "public, max-age=604800"
    # index.html: no cache (always fresh)
    elif path == "/" or (not path.startswith("/api/") and "." not in path.split("/")[-1]):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


# --- ERROR HANDLER ---
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Log full traceback server-side, but return a generic message client-side
    # pour éviter de fuiter des infos (stack traces, requêtes SQL, env vars).
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers={"Access-Control-Allow-Origin": "*"},
    )

# 422 dont l'entrée renvoyée est NaN / Infinity (montant borné par Field(ge, le)) : le JSON
# de la réponse ne sait pas les encoder (500) ; même 422, sans l'entrée.
@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    # Pointage de présence : jamais l'entrée dans la réponse (coordonnées)
    if request.url.path.startswith("/api/equipe/position"):
        return JSONResponse(status_code=422, content={"detail": equipe_api.ERREUR_POSITION})
    try:
        return await request_validation_exception_handler(request, exc)
    except ValueError:
        erreurs = [{k: v for k, v in e.items() if k != "input"} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": jsonable_encoder(erreurs)})


# Valeur refusée par PostgreSQL (entier hors bornes, texte trop long, date impossible…) :
# erreur de saisie, pas une panne du serveur. Une 500 ferme aussi la connexion keep-alive.
@app.exception_handler(pg_errors.DataError)
async def donnees_invalides_handler(request: Request, exc: pg_errors.DataError):
    print(f"[400] {request.method} {request.url.path} : {type(exc).__name__}")
    return JSONResponse(status_code=400, content={"detail": "Valeur invalide (format ou longueur)"},
                        headers={"Access-Control-Allow-Origin": "*"})


@app.exception_handler(pg_errors.ForeignKeyViolation)
async def reference_invalide_handler(request: Request, exc: pg_errors.ForeignKeyViolation):
    print(f"[FK] {request.method} {request.url.path} : {type(exc).__name__}")
    detail = (getattr(exc.diag, "message_detail", None) or "") if getattr(exc, "diag", None) else ""
    if "is not present" in detail:
        return JSONResponse(status_code=404, content={"detail": "Élément lié introuvable"},
                            headers={"Access-Control-Allow-Origin": "*"})
    return JSONResponse(status_code=409, content={"detail": "Élément encore utilisé ailleurs"},
                        headers={"Access-Control-Allow-Origin": "*"})


# --- ROUTERS ---
app.include_router(auth.router)
app.include_router(tickets.router)
app.include_router(clients.router)
app.include_router(config.router)
app.include_router(team.router)
app.include_router(parts.router)
app.include_router(catalog.router)
app.include_router(notifications.router)
app.include_router(print_tickets.router)
app.include_router(public_documents.router)
app.include_router(etagere_api.router)
app.include_router(caisse_api.router)
app.include_router(attestation.router)
app.include_router(admin.router)
app.include_router(chat.router)
app.include_router(fidelite.router)
app.include_router(email_api.router)
# Avant tarifs : /api/tarifs/propositions… ne doit pas être pris pour /api/tarifs/{id}
app.include_router(propositions_prix.router)
app.include_router(tarifs.router)
app.include_router(marketing.router)
app.include_router(telephones.router)
app.include_router(autocomplete.router)
app.include_router(devis.router)
app.include_router(reporting.router)
app.include_router(depot_distance.router)
app.include_router(suivi.router)
app.include_router(iphone_tarifs.router)
app.include_router(iphones_stock.router)
app.include_router(smartphones_tarifs.router)
app.include_router(tracking.router)
app.include_router(notifications_center.router)
app.include_router(search_api.router)
app.include_router(grille.router)
app.include_router(reception_api.router)
app.include_router(rgpd_api.router)
app.include_router(equipe_api.router)


# --- HEALTH CHECK ---
@app.get("/health")
async def health():
    return {"status": "ok", "service": "klikphone-sav-api"}


@app.get("/health/db")
def health_db():
    try:
        from app.database import get_cursor
        with get_cursor() as cur:
            cur.execute("SELECT 1")
        return {"status": "ok", "db": "connected"}
    except Exception:
        # Ne pas exposer le message d'erreur DB (peut contenir DSN/secrets)
        traceback.print_exc()
        return {"status": "error", "db": "unreachable"}



# --- GENERATED VIDEOS (Story iPhone) ---
GENERATED_VIDEOS_DIR = Path(__file__).resolve().parent / "video" / "generated"
GENERATED_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
app.mount(
    "/generated-videos",
    StaticFiles(directory=str(GENERATED_VIDEOS_DIR)),
    name="generated-videos",
)


# --- STATIC FRONTEND (SPA) ---
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

if STATIC_DIR.exists():
    # Serve /assets/* (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="static-assets")

    # Serve known static files at root (logo, manifest, sw.js, etc.)
    # HEAD aussi (sondes de disponibilité, curl -I, navigateurs) : 405 sinon
    @app.api_route("/logo_k.png", methods=["GET", "HEAD"])
    @app.api_route("/tampon_klikphone.png", methods=["GET", "HEAD"])
    @app.api_route("/manifest.json", methods=["GET", "HEAD"])
    @app.api_route("/sw.js", methods=["GET", "HEAD"])
    async def static_root_files(request: Request):
        fname = request.url.path.lstrip("/")
        fpath = STATIC_DIR / fname
        if fpath.exists():
            return FileResponse(str(fpath))
        return JSONResponse({"detail": "Not found"}, 404)

    @app.api_route("/", methods=["GET", "HEAD"])
    async def serve_index():
        return FileResponse(str(STATIC_DIR / "index.html"))

    _STATIC_ROOT = STATIC_DIR.resolve()

    # SPA catch-all: any path not matched by API routers → serve index.html
    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
    async def spa_fallback(full_path: str):
        # Don't serve index.html for API paths or docs
        if full_path.startswith("api/") or full_path.startswith("generated-videos/") or full_path in ("docs", "redoc", "openapi.json", "health", "health/db"):
            return JSONResponse({"detail": "Not found"}, 404)
        # resolve() + is_relative_to : un chemin encodé (..%2F) ne doit jamais sortir de static/
        file_path = (STATIC_DIR / full_path).resolve()
        if file_path.is_relative_to(_STATIC_ROOT) and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(STATIC_DIR / "index.html"))
else:
    @app.api_route("/", methods=["GET", "HEAD"])
    async def root():
        return {
            "service": "Klikphone SAV API",
            "version": "2.1.0",
            "docs": "/docs",
        }
