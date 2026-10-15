"""
KLIKPHONE SAV — API REST FastAPI
Point d'entrée principal.
Last frontend bundle: index-Bevv2zlk.js (2026-05-17).
"""

import logging
import os
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

from app.database import close_pool
from app.api import auth, tickets, clients, config, team, parts, catalog, notifications, print_tickets, caisse_api, attestation, admin, chat, fidelite, email_api, tarifs, marketing, telephones, autocomplete, devis, reporting, depot_distance, suivi, iphone_tarifs, iphones_stock, smartphones_tarifs, tracking, notifications_center
from app.services.catalog_seed import seed_catalog
from app.api import search as search_api
from app.api import public_documents

logger = logging.getLogger("klikphone.startup")


def _migrations_recherche():
    """Recherche staff (app/services/search.py) : pg_trgm, fonctions IMMUTABLE kp_*, index.

    Chaque instruction est isolée : un échec (droits, extension absente) est
    journalisé sans bloquer le démarrage, et la recherche marche sans pg_trgm.
    Les extensions peuvent vivre dans « public » ou « extensions » (Supabase) :
    le schéma est lu dans pg_extension, jamais supposé.
    """
    from psycopg2 import sql as psql
    from app.database import get_cursor
    from app.services import search as S

    def run(label, stmt):
        try:
            with get_cursor() as cur:
                cur.execute("SET LOCAL lock_timeout = '3s'")
                cur.execute(stmt)
            return True
        except Exception as e:
            print(f"Warning recherche ({label}): {e}")
            return False

    def fetch(stmt, params=None):
        try:
            with get_cursor() as cur:
                cur.execute(stmt, params)
                return cur.fetchone()
        except Exception as e:
            print(f"Warning recherche (lecture catalogue): {e}")
            return None

    def ext_schema(name):
        return fetch(
            "SELECT n.nspname AS ns, quote_ident(n.nspname) AS qns FROM pg_extension e"
            " JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = %s",
            (name,),
        )

    if not ext_schema("pg_trgm"):
        in_ext = fetch("SELECT 1 AS ok FROM pg_namespace WHERE nspname = 'extensions'")
        run("pg_trgm", "CREATE EXTENSION IF NOT EXISTS pg_trgm" + (" WITH SCHEMA extensions" if in_ext else ""))
    ua, trgm = ext_schema("unaccent"), ext_schema("pg_trgm")

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
        ("kp_unaccent", unaccent_body, "IMMUTABLE PARALLEL SAFE STRICT"),
        ("kp_doc", psql.SQL(
            "SELECT ' ' || regexp_replace(lower(public.kp_unaccent(coalesce($1, ''))), '[^a-z0-9]+', ' ', 'g') || ' '"
        ), "IMMUTABLE PARALLEL SAFE"),
        ("kp_alnum", psql.SQL("SELECT regexp_replace(lower(coalesce($1, '')), '[^a-z0-9]+', '', 'g')"),
         "IMMUTABLE PARALLEL SAFE"),
        ("kp_phone_digits", psql.SQL("SELECT regexp_replace(coalesce($1, ''), '[^0-9]+', '', 'g')"),
         "IMMUTABLE PARALLEL SAFE"),
        ("kp_phone_key", psql.SQL("SELECT right(public.kp_phone_digits($1), 9)"), "IMMUTABLE PARALLEL SAFE"),
    ]
    changed = False
    for name, body, flags in funcs:
        try:
            with get_cursor() as cur:
                src_sql = body.as_string(cur)
                cur.execute(
                    "SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace"
                    " WHERE n.nspname = 'public' AND p.proname = %s",
                    (name,),
                )
                row = cur.fetchone()
                if row and row["prosrc"].strip() == src_sql.strip():
                    continue
                cur.execute("SET LOCAL lock_timeout = '3s'")
                cur.execute(psql.SQL(
                    "CREATE OR REPLACE FUNCTION public.{}(text) RETURNS text LANGUAGE sql " + flags + " AS $kp$ {} $kp$"
                ).format(psql.Identifier(name), psql.SQL(src_sql)))
                changed = changed or row is not None
        except Exception as e:
            print(f"Warning recherche (fonction {name}): {e}")
    if trgm:
        # STABLE (comme l'opérateur, qui lit pg_trgm.word_similarity_threshold) et non
        # STRICT : PostgreSQL l'inline, et « mot <% document » profite des index GIN.
        run("kp_word_match", psql.SQL(
            "CREATE OR REPLACE FUNCTION public.kp_word_match(text, text) RETURNS boolean LANGUAGE sql"
            " STABLE PARALLEL SAFE AS $kp$ SELECT $1 OPERATOR({}.<%) $2 $kp$"
        ).format(psql.Identifier(trgm["ns"])))

    dev = S.doc_sql("", S.T_DEVICE_COLS)
    indexes = [
        ("idx_clients_phone_key", "clients", "btree", "public.kp_phone_key(telephone)", ""),
        ("idx_tickets_imei_alnum", "tickets", "btree", "public.kp_alnum(imei)", "imei <> ''"),
        ("idx_tickets_pret_imei_alnum", "tickets", "btree", "public.kp_alnum(telephone_pret_imei)",
         "telephone_pret_imei <> ''"),
    ]
    if trgm:
        indexes += [
            ("idx_tickets_device_trgm_v1", "tickets", "gin", dev, ""),
            ("idx_tickets_device_compact_trgm_v1", "tickets", "gin", S.compact_sql(dev), ""),
            ("idx_tickets_work_trgm_v1", "tickets", "gin", S.doc_sql("", S.T_WORK_COLS), ""),
            ("idx_tickets_panne_trgm_v1", "tickets", "gin", S.doc_sql("", S.T_PANNE_COLS), ""),
            # Fragments d'IMEI : sans eux, le OR d'un mot numérique force un seq scan
            ("idx_tickets_imei_trgm", "tickets", "gin", "public.kp_alnum(imei)", ""),
            ("idx_tickets_pret_imei_trgm", "tickets", "gin", "public.kp_alnum(telephone_pret_imei)", ""),
            ("idx_clients_doc_trgm_v1", "clients", "gin", S.doc_sql("", S.C_COLS), ""),
            ("idx_clients_phone_digits_trgm", "clients", "gin", "public.kp_phone_digits(telephone)", ""),
            ("idx_notes_tickets_doc_trgm_v1", "notes_tickets", "gin", S.doc_sql("", S.NOTE_COLS),
             "type_note IN ('note', 'message_client', 'avis_client')"),
            ("idx_devis_doc_trgm_v1", "devis", "gin", S.doc_sql("", S.DEVIS_COLS), ""),
            ("idx_commandes_doc_trgm_v1", "commandes_pieces", "gin", S.doc_sql("", S.CMD_COLS), ""),
        ]
    analyze = set()
    for name, table, method, expr, where in indexes:
        existing = fetch("SELECT to_regclass(%s) IS NOT NULL AS ok", ("public." + name,))
        if existing and existing["ok"]:
            if changed:
                run(f"reindex {name}", psql.SQL("REINDEX INDEX {}").format(psql.Identifier(name)))
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
        if run(f"index {name}", stmt):
            analyze.add(table)
    # Statistiques des nouvelles expressions indexées, sinon le planner les ignore
    for table in sorted(analyze):
        run(f"analyze {table}", psql.SQL("ANALYZE {}").format(psql.Identifier(table)))


MIGRATION_FORFAITS_LIGNES = "MIGRATION_FICHE_FORFAITS_LIGNES"


def _migrations_fiche():
    """Fiche ticket : colonnes de restitution, pannes accentuées, lignes JSON en forfaits.

    Chaque bloc tient dans un get_cursor (idempotent, échec journalisé sans
    bloquer le démarrage). date_maj n'est jamais touchée.
    """
    import json
    from datetime import datetime
    from psycopg2.extras import execute_values
    from app.database import get_cursor
    from app.services import prestations as P

    def run(label, fn):
        try:
            with get_cursor() as cur:
                cur.execute("SET LOCAL lock_timeout = '3s'")
                fn(cur)
        except Exception as e:
            print(f"Warning fiche ({label}): {e}")

    def colonnes(cur):
        # TEXT comme date_cloture (format '%Y-%m-%d %H:%M:%S')
        cur.execute("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS date_rendu TEXT")
        cur.execute("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS rendu_par TEXT")
        # Issue distincte du statut : 'refus_devis' (devis refusé, rendu sans réparation)
        cur.execute("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS issue TEXT")

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
        cur.execute("SELECT 1 FROM params WHERE cle = %s", (MIGRATION_FORFAITS_LIGNES,))
        if cur.fetchone():
            return
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

    run("colonnes", colonnes)
    run("pannes accentuées", pannes)
    run("lignes en forfaits", lignes_forfaits)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle: init DB tables + fermer proprement le pool DB a l'arret."""
    from app.database import get_cursor
    # Non-blocking migrations: kill idle sessions, short lock_timeout, skip on failure
    try:
        with get_cursor() as cur:
            cur.execute("""
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE state = 'idle in transaction'
                AND pid != pg_backend_pid()
            """)
    except Exception:
        print(f"Warning kill idle sessions:\n{traceback.format_exc()}")

    # Enable unaccent extension for accent-insensitive search
    try:
        with get_cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    except Exception as e:
        print(f"Warning unaccent extension: {e}\n{traceback.format_exc()}")

    # CREATE TABLE statements (don't need exclusive locks)
    for sql in [
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
    ]:
        try:
            with get_cursor() as cur:
                cur.execute(sql)
        except Exception as e:
            print(f"Warning CREATE TABLE: {e}\n{traceback.format_exc()}")

    # Tarifs table
    try:
        tarifs._ensure_table()
    except Exception as e:
        print(f"Warning tarifs table: {e}\n{traceback.format_exc()}")

    # iPhone tarifs (affiches boutique) : table + seed
    try:
        iphone_tarifs.init_iphone_tarifs()
    except Exception as e:
        print(f"Warning iphone_tarifs init: {e}\n{traceback.format_exc()}")

    # iPhones stock (ventes + générateur vidéo Story) : table + seed
    try:
        iphones_stock.init_iphones_stock()
    except Exception as e:
        print(f"Warning iphones_stock init: {e}\n{traceback.format_exc()}")

    # Smartphones non-Apple (Samsung, Xiaomi, Google, etc.)
    try:
        smartphones_tarifs.init_smartphones_tarifs()
    except Exception as e:
        print(f"Warning smartphones_tarifs init: {e}\n{traceback.format_exc()}")

    # Attestations table
    try:
        attestation._ensure_attestation_table()
    except Exception as e:
        print(f"Warning attestations table: {e}\n{traceback.format_exc()}")

    # Marketing tables
    try:
        marketing._ensure_tables()
    except Exception as e:
        print(f"Warning marketing tables: {e}\n{traceback.format_exc()}")

    # Telephones table
    try:
        telephones._ensure_table()
    except Exception as e:
        print(f"Warning telephones table: {e}\n{traceback.format_exc()}")

    # ALTER TABLE statements (need exclusive lock — use very short timeout)
    for sql in [
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
    ]:
        try:
            with get_cursor() as cur:
                cur.execute("SET lock_timeout = '3s'")
                cur.execute(sql)
        except Exception as e:
            print(f"Warning ALTER TABLE: {e}\n{traceback.format_exc()}")
    # Performance indexes (CREATE INDEX IF NOT EXISTS is safe to run every startup)
    for sql in [
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
    ]:
        try:
            with get_cursor() as cur:
                cur.execute(sql)
        except Exception as e:
            print(f"Warning CREATE INDEX: {e}\n{traceback.format_exc()}")

    # Rattrapage des jetons de partage manquants (tickets antérieurs, ou créés
    # par la conversion de devis / le dépôt à distance). Idempotent.
    try:
        import secrets
        from psycopg2.extras import execute_values
        with get_cursor() as cur:
            cur.execute("SELECT id FROM tickets WHERE suivi_token IS NULL")
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

    # Recherche staff : après les ALTER, pour que toutes les colonnes indexées existent
    _migrations_recherche()

    # Purge de rétention : chat_messages et notifications_center grossissent sans
    # limite (miroir notif → chat). On borne à 90 jours pour que les requêtes
    # unread (polées toutes les 8-12s) restent rapides dans le temps.
    try:
        with get_cursor() as cur:
            cur.execute("DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '90 days'")
            cur.execute("DELETE FROM notifications_center WHERE created_at < NOW() - INTERVAL '90 days'")
    except Exception as e:
        print(f"Warning purge old messages: {e}")

    # Seed autocompletion — pannes courantes
    try:
        with get_cursor() as cur:
            cur.execute("""
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
            """)
            cur.execute("""
                INSERT INTO params (cle, valeur) VALUES ('AFFICHER_AUTOCOMPLETION', 'true')
                ON CONFLICT (cle) DO NOTHING
            """)
            cur.execute("""
                INSERT INTO params (cle, valeur) VALUES
                    ('MODULE_DEVIS_VISIBLE', 'false'),
                    ('MODULE_DEVIS_FLASH_VISIBLE', 'false'),
                    ('DEPOT_DISTANCE_ACTIF', 'true'),
                    ('NOTIFICATIONS_EMAIL_ACTIF', 'true'),
                    ('NOTIFICATIONS_STATUTS', 'Réparation terminée,En attente de pièce,En cours de réparation')
                ON CONFLICT (cle) DO NOTHING
            """)
    except Exception as e:
        print(f"Warning autocompletion seed: {e}\n{traceback.format_exc()}")

    # Fiche ticket : après le seed, pour fusionner « Écran casse » dans « Écran cassé »
    _migrations_fiche()

    # Default admin password — lu depuis env var DEFAULT_ADMIN_PASSWORD.
    # Si absent, on ne seed PAS de mot de passe en clair (security).
    # Le password existant en DB est preserve (ON CONFLICT DO NOTHING).
    try:
        default_admin_pwd = os.environ.get("DEFAULT_ADMIN_PASSWORD")
        with get_cursor() as cur:
            if default_admin_pwd:
                cur.execute(
                    """INSERT INTO params (cle, valeur) VALUES ('ADMIN_PASSWORD', %s)
                       ON CONFLICT (cle) DO NOTHING""",
                    (default_admin_pwd,),
                )
            cur.execute("""
                INSERT INTO params (cle, valeur) VALUES ('GOOGLE_REVIEW_LINK', 'https://g.page/r/Cf6adrBONrj3EAE/review')
                ON CONFLICT (cle) DO NOTHING
            """)
            cur.execute("""
                INSERT INTO params (cle, valeur) VALUES ('URL_SUIVI', 'https://klikphone-sav-v2-production.up.railway.app')
                ON CONFLICT (cle) DO UPDATE SET valeur = 'https://klikphone-sav-v2-production.up.railway.app'
                WHERE params.valeur != 'https://klikphone-sav-v2-production.up.railway.app'
            """)
    except Exception as e:
        print(f"Warning ADMIN_PASSWORD default: {e}\n{traceback.format_exc()}")

    # Catalogue marques/modèles : seed versionné (no-op si déjà appliqué)
    try:
        seed_catalog()
    except Exception as e:
        print(f"Warning catalog seed: {e}\n{traceback.format_exc()}")

    yield
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

# --- GZIP (compress responses > 500 bytes) ---
app.add_middleware(GZipMiddleware, minimum_size=500)


# --- SECURITY HEADERS + CACHE HEADERS for static assets ---
@app.middleware("http")
async def security_and_cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path

    # ─── Security headers (toujours posés sur les réponses HTML/JSON) ───
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = (
        "geolocation=(), microphone=(), camera=(), payment=()"
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
app.include_router(caisse_api.router)
app.include_router(attestation.router)
app.include_router(admin.router)
app.include_router(chat.router)
app.include_router(fidelite.router)
app.include_router(email_api.router)
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
    @app.get("/logo_k.png")
    @app.get("/tampon_klikphone.png")
    @app.get("/manifest.json")
    @app.get("/sw.js")
    async def static_root_files(request: Request):
        fname = request.url.path.lstrip("/")
        fpath = STATIC_DIR / fname
        if fpath.exists():
            return FileResponse(str(fpath))
        return JSONResponse({"detail": "Not found"}, 404)

    @app.get("/")
    async def serve_index():
        return FileResponse(str(STATIC_DIR / "index.html"))

    _STATIC_ROOT = STATIC_DIR.resolve()

    # SPA catch-all: any path not matched by API routers → serve index.html
    @app.get("/{full_path:path}")
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
    @app.get("/")
    async def root():
        return {
            "service": "Klikphone SAV API",
            "version": "2.1.0",
            "docs": "/docs",
        }
