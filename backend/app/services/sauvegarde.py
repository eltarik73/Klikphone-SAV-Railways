"""Sauvegarde complète de la base (gérant, 11/11/2026 : « au cas où j'ai un souci sur le logiciel, que je
puisse faire des sauvegardes de tout de temps en temps »).

Supabase est au plan gratuit : aucune sauvegarde téléchargeable de son côté. Ce fichier est la copie du gérant.

- exporter(cur) : TOUTES les tables du schéma public, lues dans la base (une table ajoutée demain est sauvée sans
  rien changer ici), sauf TABLES_EXCLUES. Jamais dans le fichier : les secrets de params (codes, jetons, clés —
  config.est_secret) et les codes de déverrouillage des appareils (tickets.pin / pattern). Une table illisible
  est signalée dans « erreurs », jamais rendue vide en silence (l'ancien export le faisait).
- restaurer(cur, sauvegarde) : les tables du fichier qui existent dans la base, parents d'abord (clés étrangères
  lues dans la base), colonnes communes seulement (un fichier plus ancien ou plus récent que le schéma passe),
  insertion par paquets ; secrets et réglages d'équipe actuels gardés ; séquences d'identifiants recalées.
  Tout ou rien : une seule transaction, une erreur annule toute la restauration.
- classeur_lisible(cur) : clients et réparations dans un classeur Excel, lisible sans le logiciel.
Format : {format, version 2, backup_date, tables {table: [lignes]}, comptes, erreurs, exclues, colonnes_omises,
secrets_omis} ; une sauvegarde version 1 (15 tables, sans « format ») se restaure aussi.
"""
import base64
import io
import math
import re
from datetime import date, datetime, time, timedelta
from decimal import Decimal

import psycopg2
from psycopg2.extras import Json, execute_values

FORMAT = "klikphone-sauvegarde"
VERSION = 2
# Sessions et révocations admin : sécurité, jamais restaurées d'un fichier. Catalogue fournisseur et imports de
# prix : données de travail volumineuses, refaites par la synchro Mobilax / Utopya du lendemain.
TABLES_EXCLUES = frozenset({"sessions_admin", "revocations_admin", "fournisseurs_catalogue", "tarifs_imports"})
COLONNES_EXCLUES = {"tickets": frozenset({"pin", "pattern"})}
P_DERNIERE = "SAUVEGARDE_DERNIERE"
P_ERREURS = "SAUVEGARDE_DERNIERE_ERREURS"
TAILLE_PAQUET = 500
_IDENT = re.compile(r"^[a-z][a-z0-9_]{0,62}$")


def _q(nom: str) -> str:
    """Identifiant SQL cité, après contrôle strict (les noms viennent de information_schema)."""
    if not isinstance(nom, str) or not _IDENT.match(nom):
        raise ValueError(f"Nom de table ou de colonne invalide : {nom!r}")
    return f'"{nom}"'


def _nom(regclass: str) -> str:
    return str(regclass or "").split(".")[-1].strip('"')


def tables_base(cur) -> list:
    cur.execute("SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name")
    return [r["table_name"] for r in cur.fetchall() or [] if _IDENT.match(r.get("table_name") or "")]


def colonnes(cur) -> dict:
    """{table: {colonne: type}} dans l'ordre de la base."""
    cur.execute("SELECT table_name, column_name, data_type FROM information_schema.columns "
                "WHERE table_schema = 'public' ORDER BY table_name, ordinal_position")
    out = {}
    for r in cur.fetchall() or []:
        out.setdefault(r["table_name"], {})[r["column_name"]] = r["data_type"]
    return out


def ordre_parents(cur, tables) -> list:
    """Tables triées parents d'abord (clés étrangères du schéma public) ; un cycle garde l'ordre alphabétique."""
    cur.execute("SELECT conrelid::regclass::text AS enfant, confrelid::regclass::text AS parent "
                "FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace")
    deps = {t: set() for t in tables}
    for r in cur.fetchall() or []:
        e, p = _nom(r["enfant"]), _nom(r["parent"])
        if e in deps and p in deps and e != p:
            deps[e].add(p)
    ordre, restant = [], dict(deps)
    while restant:
        prets = sorted(t for t, d in restant.items() if not (d & restant.keys())) or sorted(restant)
        for t in prets:
            ordre.append(t)
            del restant[t]
    return ordre


def valeur_json(v):
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    if isinstance(v, (Decimal, float)):
        # NaN / infini : interdits en JSON (la réponse entière échouerait) → valeur vide
        return float(v) if math.isfinite(v) else None
    if isinstance(v, timedelta):
        return v.total_seconds()
    if isinstance(v, (bytes, bytearray, memoryview)):
        return {"$base64": base64.b64encode(bytes(v)).decode("ascii")}
    return v


def exporter(cur) -> dict:
    from app.api.config import est_secret
    out = {"format": FORMAT, "version": VERSION, "backup_date": datetime.now().isoformat(timespec="seconds"),
           "tables": {}, "comptes": {}, "erreurs": {}, "exclues": sorted(TABLES_EXCLUES),
           "colonnes_omises": {t: sorted(c) for t, c in COLONNES_EXCLUES.items()}, "secrets_omis": []}
    for t in tables_base(cur):
        if t in TABLES_EXCLUES:
            continue
        cur.execute("SAVEPOINT sauvegarde_table")
        try:
            cur.execute(f"SELECT * FROM {_q(t)}")
            rows = cur.fetchall() or []
            cur.execute("RELEASE SAVEPOINT sauvegarde_table")
        except Exception as e:
            cur.execute("ROLLBACK TO SAVEPOINT sauvegarde_table")
            out["erreurs"][t] = type(e).__name__
            continue
        omises = COLONNES_EXCLUES.get(t, frozenset())
        lignes = []
        for r in rows:
            if t == "params" and est_secret(str(r.get("cle") or "")):
                out["secrets_omis"].append(str(r.get("cle")))
                continue
            lignes.append({k: valeur_json(v) for k, v in r.items() if k not in omises})
        out["tables"][t] = lignes
        out["comptes"][t] = len(lignes)
    return out


def noter_sauvegarde(cur, erreurs=()):
    """Date de la sauvegarde produite et tables restées illisibles (affichées par l'écran)."""
    for cle, valeur in ((P_DERNIERE, datetime.now().isoformat(timespec="seconds")), (P_ERREURS, ",".join(sorted(erreurs)))):
        cur.execute("INSERT INTO params (cle, valeur) VALUES (%s, %s) "
                    "ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur", (cle, valeur))


def etat(cur, maintenant: datetime = None) -> dict:
    """{derniere, jours, erreurs} : dernière sauvegarde téléchargée (None si jamais) et tables qu'elle n'a pas pu lire."""
    cur.execute("SELECT cle, valeur FROM params WHERE cle = ANY(%s)", ([P_DERNIERE, P_ERREURS],))
    lu = {r["cle"]: (r["valeur"] or "").strip() for r in cur.fetchall() or []}
    try:
        quand = datetime.fromisoformat(lu.get(P_DERNIERE, "")) if lu.get(P_DERNIERE) else None
    except ValueError:
        quand = None
    jours = ((maintenant or datetime.now()) - quand).days if quand else None
    return {"derniere": quand.isoformat(timespec="seconds") if quand else None, "jours": jours,
            "erreurs": [t for t in lu.get(P_ERREURS, "").split(",") if t] if quand else []}


def _valeur_sql(v, type_col: str):
    if v is None:
        return None
    if type_col in ("json", "jsonb"):
        return Json(v)
    if type_col == "bytea" and isinstance(v, dict) and "$base64" in v:
        return psycopg2.Binary(base64.b64decode(v["$base64"]))
    if type_col == "interval" and isinstance(v, (int, float)):
        return timedelta(seconds=v)
    if isinstance(v, dict):
        return Json(v)
    return v


def restaurer(cur, sauvegarde: dict) -> dict:
    """→ {imported {table: n}, ignorees [tables du fichier absentes ou exclues], version}. ValueError : format."""
    from app.api.config import est_cle_equipe, est_secret
    tables_fichier = sauvegarde.get("tables") if isinstance(sauvegarde, dict) else None
    if not isinstance(tables_fichier, dict) or not tables_fichier:
        raise ValueError("Format de sauvegarde invalide (pas de clé « tables »)")
    existantes = [t for t in tables_base(cur) if t not in TABLES_EXCLUES]
    cols = colonnes(cur)
    a_restaurer = [t for t in ordre_parents(cur, existantes)
                   if isinstance(tables_fichier.get(t), list)]
    ignorees = sorted(set(tables_fichier) - set(a_restaurer))

    def garde(cle) -> bool:
        cle = str(cle or "")
        return est_secret(cle) or est_cle_equipe(cle)

    # Vider : enfants d'abord. Params : secrets et réglages d'équipe actuels gardés (jamais dans le fichier)
    for t in reversed(a_restaurer):
        if t == "params":
            cur.execute("SELECT cle FROM params")
            gardees = [r["cle"] for r in cur.fetchall() or [] if garde(r["cle"])]
            cur.execute("DELETE FROM params WHERE NOT (cle = ANY(%s))", (gardees,))
        else:
            cur.execute(f"DELETE FROM {_q(t)}")
    comptes = {}
    for t in a_restaurer:
        lignes = [l for l in tables_fichier[t] if isinstance(l, dict)]
        if t == "params":
            lignes = [l for l in lignes if not garde(l.get("cle"))]
        types = cols.get(t, {})
        noms = [c for c in types if any(c in l for l in lignes)]
        if not lignes or not noms:
            comptes[t] = 0
            continue
        requete = f"INSERT INTO {_q(t)} ({', '.join(_q(c) for c in noms)}) VALUES %s ON CONFLICT DO NOTHING"
        execute_values(cur, requete, [tuple(_valeur_sql(l.get(c), types[c]) for c in noms) for l in lignes],
                       page_size=TAILLE_PAQUET)
        comptes[t] = len(lignes)
    # Identifiants : la prochaine fiche reprend après le plus grand id restauré
    for t in a_restaurer:
        if "id" not in cols.get(t, {}):
            continue
        cur.execute("SELECT pg_get_serial_sequence(%s, 'id') AS seq", (t,))
        seq = (cur.fetchone() or {}).get("seq")
        if seq:
            cur.execute(f"SELECT setval(%s, COALESCE((SELECT MAX(id) FROM {_q(t)}), 0) + 1, false)", (seq,))
    return {"imported": comptes, "ignorees": ignorees, "version": sauvegarde.get("version") or 1}


# ─── Classeur lisible sans le logiciel ───────────────────────────
ENTETES_REPARATIONS = ["N°", "Déposé le", "Client", "Téléphone", "Appareil", "Panne", "Détail", "Statut",
                       "Devis (€)", "Acompte (€)", "Prix final (€)", "Payé", "Rendu le", "Technicien",
                       "Emplacement", "Notes client", "Notes internes"]
ENTETES_CLIENTS = ["Nom", "Prénom", "Téléphone", "E-mail", "Société", "Client depuis", "Réparations", "Offres"]


def _jour(v, heure: bool = True) -> str:
    if isinstance(v, datetime):
        return v.strftime("%d/%m/%Y %H:%M" if heure else "%d/%m/%Y")
    if isinstance(v, date):
        return v.strftime("%d/%m/%Y")
    return str(v or "")


def _montant(v):
    return round(float(v), 2) if v not in (None, "") else None


def lignes_lisibles(cur) -> tuple:
    """(réparations, clients) : lignes du classeur, réparations les plus récentes d'abord."""
    cur.execute("""
        SELECT t.ticket_code, t.date_depot, c.nom, c.prenom, c.telephone, t.categorie, t.marque, t.modele,
               t.modele_autre, t.panne, t.panne_detail, t.statut, t.devis_estime, t.acompte, t.tarif_final, t.paye,
               COALESCE(NULLIF(t.date_rendu, ''), t.date_recuperation) AS rendu, t.technicien_assigne, t.emplacement,
               t.notes_client, t.notes_internes
        FROM tickets t LEFT JOIN clients c ON c.id = t.client_id
        ORDER BY t.date_depot DESC NULLS LAST, t.id DESC
    """)
    reparations = []
    for r in cur.fetchall() or []:
        appareil = " ".join(x for x in (r["categorie"], r["marque"], r["modele_autre"] or r["modele"]) if x)
        reparations.append([
            r["ticket_code"] or "", _jour(r["date_depot"]),
            " ".join(x for x in (r["nom"], r["prenom"]) if x), r["telephone"] or "", appareil, r["panne"] or "",
            r["panne_detail"] or "", r["statut"] or "", _montant(r["devis_estime"]), _montant(r["acompte"]),
            _montant(r["tarif_final"]), "Oui" if r["paye"] else "Non", _jour(r["rendu"]), r["technicien_assigne"] or "",
            r["emplacement"] or "", r["notes_client"] or "", r["notes_internes"] or "",
        ])
    cur.execute("""
        SELECT c.nom, c.prenom, c.telephone, c.email, c.societe, c.date_creation, c.consentement_marketing,
               COUNT(t.id) AS reparations
        FROM clients c LEFT JOIN tickets t ON t.client_id = c.id
        WHERE c.anonymise_le IS NULL
        GROUP BY c.id ORDER BY c.nom, c.prenom, c.id
    """)
    clients = [[r["nom"] or "", r["prenom"] or "", r["telephone"] or "", r["email"] or "", r["societe"] or "",
                _jour(r["date_creation"], heure=False), int(r["reparations"] or 0), "Oui" if r["consentement_marketing"] else "Non"]
               for r in cur.fetchall() or []]
    return reparations, clients


def classeur_lisible(cur) -> bytes:
    """Classeur Excel « Réparations » + « Clients » (cellules texte, jamais de formule)."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font

    reparations, clients = lignes_lisibles(cur)
    wb = Workbook()
    for i, (titre, entetes, lignes) in enumerate((("Réparations", ENTETES_REPARATIONS, reparations),
                                                   ("Clients", ENTETES_CLIENTS, clients))):
        ws = wb.active if i == 0 else wb.create_sheet()
        ws.title = titre
        ws.append(entetes)
        for cell in ws[1]:
            cell.font = Font(bold=True)
            cell.alignment = Alignment(vertical="top")
        for ligne in lignes:
            ws.append(ligne)
            for cell in ws[ws.max_row]:
                if isinstance(cell.value, str):
                    cell.data_type = "s"   # « =… » reste du texte, jamais une formule
        ws.freeze_panes = "A2"
        for col in ws.columns:
            largeur = max((len(str(c.value)) for c in col[:200] if c.value is not None), default=8)
            ws.column_dimensions[col[0].column_letter].width = min(max(largeur + 2, 8), 50)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
