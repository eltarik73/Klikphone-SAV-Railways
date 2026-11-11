"""Sauvegarde complète (app/services/sauvegarde.py, gérant 11/11/2026) : toutes les tables, jamais un secret ni un
code de déverrouillage, table illisible signalée, restauration parents d'abord, tout ou rien, classeur lisible."""
import base64
import io
from datetime import datetime
from decimal import Decimal
from unittest.mock import patch

import pytest
from psycopg2.extras import Json

from app.services import sauvegarde as S

TABLES = ["clients", "devis", "devis_lignes", "fournisseurs_catalogue", "marketing_images", "params",
          "sessions_admin", "ticket_controles", "tickets"]
COLONNES = {
    "clients": {"id": "integer", "nom": "text", "telephone": "text"},
    "devis": {"id": "integer", "client_id": "integer"},
    "devis_lignes": {"id": "integer", "devis_id": "integer"},
    "marketing_images": {"id": "integer", "data": "bytea"},
    "params": {"cle": "text", "valeur": "text"},
    "ticket_controles": {"id": "integer", "ticket_id": "integer", "items": "jsonb"},
    "tickets": {"id": "integer", "client_id": "integer", "ticket_code": "text", "pin": "text", "pattern": "text",
                "tarif_final": "real", "nouvelle_colonne": "text"},
}
FK = [("devis", "clients"), ("devis_lignes", "devis"), ("tickets", "clients"), ("ticket_controles", "tickets")]
DONNEES = {
    "clients": [{"id": 1, "nom": "Martin", "telephone": "0612345678"}],
    "devis": [], "devis_lignes": [],
    "marketing_images": [{"id": 3, "data": memoryview(b"\xff\xd8jpeg")}],
    "params": [{"cle": "BOUTIQUE_NOM", "valeur": "Klikphone"}, {"cle": "PIN_TECH", "valeur": "hash"},
               {"cle": "MOBILAX_TOKEN", "valeur": "jeton"}],
    "ticket_controles": [{"id": 5, "ticket_id": 9, "items": {"ecran": "ok"}}],
    "tickets": [{"id": 9, "client_id": 1, "ticket_code": "KP-000009", "pin": "1234", "pattern": "1-5-9",
                 "tarif_final": Decimal("89.90"), "nouvelle_colonne": None}],
}


class Cur:
    """Curseur simulé : information_schema, pg_constraint, SELECT * par table (une table peut échouer)."""

    def __init__(self, echec=(), params_actuels=None):
        self.sql, self.params, self.echec = [], [], set(echec)
        self.params_actuels = params_actuels or []
        self._res = []

    def execute(self, sql, params=None):
        s = " ".join(str(sql).split())
        self.sql.append(s)
        self.params.append(params)
        self._res = []
        if "information_schema.tables" in s:
            self._res = [{"table_name": t} for t in TABLES]
        elif "information_schema.columns" in s:
            self._res = [{"table_name": t, "column_name": c, "data_type": ty}
                         for t, cols in COLONNES.items() for c, ty in cols.items()]
        elif "pg_constraint" in s:
            self._res = [{"enfant": e, "parent": f"public.{p}"} for e, p in FK]
        elif s.startswith("SELECT * FROM"):
            t = s.split('"')[1]
            if t in self.echec:
                raise RuntimeError("table illisible")
            self._res = [dict(r) for r in DONNEES.get(t, [])]
        elif s == "SELECT cle FROM params":
            self._res = [{"cle": c} for c in self.params_actuels]
        elif "pg_get_serial_sequence" in s:
            self._res = [{"seq": f"public.{params[0]}_id_seq"}]
        elif "FROM params WHERE cle = ANY" in s:
            self._res = [{"cle": S.P_DERNIERE, "valeur": "2026-10-01T09:00:00"},
                         {"cle": S.P_ERREURS, "valeur": "tickets,devis"}]

    def fetchall(self):
        return self._res

    def fetchone(self):
        return self._res[0] if self._res else None


def test_ordre_parents_d_abord():
    ordre = S.ordre_parents(Cur(), ["tickets", "devis_lignes", "clients", "devis", "ticket_controles", "params"])
    assert ordre.index("clients") < ordre.index("tickets") < ordre.index("ticket_controles")
    assert ordre.index("clients") < ordre.index("devis") < ordre.index("devis_lignes")


def test_ordre_parents_cycle_sans_boucle_infinie():
    class CurCycle(Cur):
        def execute(self, sql, params=None):
            self._res = [{"enfant": "a", "parent": "b"}, {"enfant": "b", "parent": "a"}]
    assert sorted(S.ordre_parents(CurCycle(), ["a", "b", "c"])) == ["a", "b", "c"]


def test_export_toutes_les_tables_sans_secret_ni_code():
    out = S.exporter(Cur())
    assert out["format"] == S.FORMAT and out["version"] == 2 and out["backup_date"]
    # Tables lues dans la base, exclusions de sécurité et données de travail jamais lues
    assert set(out["tables"]) == {"clients", "devis", "devis_lignes", "marketing_images", "params",
                                  "ticket_controles", "tickets"}
    assert "sessions_admin" in out["exclues"] and "fournisseurs_catalogue" in out["exclues"]
    # Secrets de params jamais écrits, mais listés (le gérant sait quoi ressaisir)
    assert [p["cle"] for p in out["tables"]["params"]] == ["BOUTIQUE_NOM"]
    assert sorted(out["secrets_omis"]) == ["MOBILAX_TOKEN", "PIN_TECH"]
    # Codes de déverrouillage jamais dans le fichier
    ticket = out["tables"]["tickets"][0]
    assert "pin" not in ticket and "pattern" not in ticket and ticket["ticket_code"] == "KP-000009"
    assert out["colonnes_omises"] == {"tickets": ["pattern", "pin"]}
    # Montant, image binaire et JSON sérialisables
    assert ticket["tarif_final"] == pytest.approx(89.9)
    assert base64.b64decode(out["tables"]["marketing_images"][0]["data"]["$base64"]) == b"\xff\xd8jpeg"
    assert out["tables"]["ticket_controles"][0]["items"] == {"ecran": "ok"}
    assert out["comptes"]["clients"] == 1 and out["erreurs"] == {}


def test_export_table_illisible_signalee_jamais_vide_en_silence():
    cur = Cur(echec={"tickets"})
    out = S.exporter(cur)
    assert "tickets" not in out["tables"] and out["erreurs"] == {"tickets": "RuntimeError"}
    assert "ROLLBACK TO SAVEPOINT sauvegarde_table" in cur.sql      # la transaction reste utilisable
    assert out["tables"]["clients"]                                  # les autres tables sont sauvées


def test_restauration_parents_d_abord_colonnes_communes_et_secrets_gardes():
    fichier = S.exporter(Cur())
    fichier["tables"]["table_disparue"] = [{"id": 1}]
    fichier["tables"]["sessions_admin"] = [{"sid": "x"}]                # exclue : jamais restaurée
    fichier["tables"]["tickets"][0]["colonne_supprimee"] = "x"           # schéma plus ancien que le fichier
    fichier["tables"]["params"].append({"cle": "GEO_POINTAGE_ACTIF", "valeur": "1"})   # réglage d'équipe
    cur = Cur(params_actuels=["BOUTIQUE_NOM", "PIN_TECH", "MOBILAX_TOKEN", "GEO_RAYON_M"])
    inserts = []
    with patch.object(S, "execute_values", lambda c, q, vals, page_size: inserts.append((q, vals, page_size))):
        res = S.restaurer(cur, fichier)
    assert res["ignorees"] == ["sessions_admin", "table_disparue"] and res["version"] == 2
    # Vidage enfants d'abord ; params : secrets et réglages d'équipe actuels gardés
    vidages = [s for s in cur.sql if s.startswith("DELETE")]
    assert vidages.index('DELETE FROM "ticket_controles"') < vidages.index('DELETE FROM "tickets"') \
        < vidages.index('DELETE FROM "clients"')
    i = cur.sql.index("DELETE FROM params WHERE NOT (cle = ANY(%s))")
    assert sorted(cur.params[i][0]) == ["GEO_RAYON_M", "MOBILAX_TOKEN", "PIN_TECH"]
    # Insertion parents d'abord, par paquets, colonnes communes seulement
    tables = [q.split('"')[1] for q, _, _ in inserts]
    assert tables.index("clients") < tables.index("tickets") < tables.index("ticket_controles")
    q_tickets, v_tickets, page = next(x for x in inserts if '"tickets"' in x[0])
    assert page == S.TAILLE_PAQUET and "colonne_supprimee" not in q_tickets and '"pin"' not in q_tickets
    assert '"nouvelle_colonne"' in q_tickets          # colonne de la base présente dans le fichier (valeur nulle)
    q_params, v_params, _ = next(x for x in inserts if '"params"' in x[0])
    assert v_params == [("BOUTIQUE_NOM", "Klikphone")]          # ni secret ni réglage d'équipe venu du fichier
    _, v_ctrl, _ = next(x for x in inserts if '"ticket_controles"' in x[0])
    assert isinstance(v_ctrl[0][2], Json)                        # jsonb
    _, v_img, _ = next(x for x in inserts if '"marketing_images"' in x[0])
    assert bytes(v_img[0][1].adapted) == b"\xff\xd8jpeg"          # binaire retrouvé
    assert res["imported"]["tickets"] == 1 and res["imported"]["devis"] == 0
    # Identifiants recalés après le plus grand id
    setvals = [p for s, p in zip(cur.sql, cur.params) if s.startswith("SELECT setval")]
    assert ("public.tickets_id_seq",) in setvals and ("public.clients_id_seq",) in setvals


def test_restauration_ancien_format_et_format_invalide():
    cur = Cur(params_actuels=[])
    with patch.object(S, "execute_values", lambda *a, **k: None):
        res = S.restaurer(cur, {"backup_date": "2026-01-01", "tables": {"clients": [{"id": 1, "nom": "A"}]}})
    assert res["imported"] == {"clients": 1} and res["version"] == 1
    assert 'DELETE FROM "tickets"' not in cur.sql          # une table absente du fichier n'est jamais vidée
    for mauvais in ({}, {"tables": {}}, {"tables": []}, []):
        with pytest.raises(ValueError):
            S.restaurer(Cur(), mauvais)


def test_etat_derniere_sauvegarde():
    assert S.etat(Cur(), maintenant=datetime(2026, 11, 11, 9)) == {
        "derniere": "2026-10-01T09:00:00", "jours": 41, "erreurs": ["tickets", "devis"]}

    class Jamais(Cur):
        def fetchall(self):
            return []
    assert S.etat(Jamais()) == {"derniere": None, "jours": None, "erreurs": []}


def test_noter_sauvegarde_date_et_tables_illisibles():
    cur = Cur()
    S.noter_sauvegarde(cur, {"tickets": "RuntimeError", "devis": "X"})
    ecrits = [p for s, p in zip(cur.sql, cur.params) if s.startswith("INSERT INTO params")]
    assert ecrits[0][0] == S.P_DERNIERE and ecrits[1] == (S.P_ERREURS, "devis,tickets")


def test_classeur_lisible_reparations_et_clients_sans_formule():
    from openpyxl import load_workbook

    class CurLisible:
        def __init__(self):
            self._res = []

        def execute(self, sql, params=None):
            if "FROM tickets t" in sql:
                self._res = [{"ticket_code": "KP-000009", "date_depot": datetime(2026, 11, 10, 16, 25), "nom": "Martin",
                              "prenom": "Léa", "telephone": "0612345678", "categorie": "Smartphone", "marque": "Apple",
                              "modele": "iPhone 13", "modele_autre": "", "panne": "Écran cassé", "panne_detail": "",
                              "statut": "Réparation terminée", "devis_estime": 129.0, "acompte": None,
                              "tarif_final": 129.0, "paye": 1, "rendu": "", "technicien_assigne": "Tarik",
                              "emplacement": "A3", "notes_client": "=HYPERLINK(\"x\")", "notes_internes": ""}]
            else:
                self._res = [{"nom": "Martin", "prenom": "Léa", "telephone": "0612345678", "email": "", "societe": "",
                              "date_creation": datetime(2026, 1, 2), "consentement_marketing": True, "reparations": 1}]

        def fetchall(self):
            return self._res

    wb = load_workbook(io.BytesIO(S.classeur_lisible(CurLisible())))
    assert wb.sheetnames == ["Réparations", "Clients"]
    rep = wb["Réparations"]
    assert [c.value for c in rep[1]][:4] == ["N°", "Déposé le", "Client", "Téléphone"]
    ligne = [c.value for c in rep[2]]
    assert ligne[:5] == ["KP-000009", "10/11/2026 16:25", "Martin Léa", "0612345678", "Smartphone Apple iPhone 13"]
    assert ligne[10] == 129.0 and ligne[11] == "Oui"
    assert rep.cell(row=2, column=16).data_type == "s"           # « =… » reste du texte
    assert [c.value for c in wb["Clients"][2]] == ["Martin", "Léa", "0612345678", None, None, "02/01/2026", 1, "Oui"]


def test_valeurs_non_finies_jamais_dans_le_fichier():
    assert S.valeur_json(float("nan")) is None and S.valeur_json(Decimal("NaN")) is None
    assert S.valeur_json(float("inf")) is None and S.valeur_json(Decimal("12.50")) == 12.5
