"""
API CRUD Clients — compatible schéma PostgreSQL existant.
"""

import csv
import io
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from app.database import get_cursor
from app.models import ClientCreate, ClientUpdate, ClientOut
from app.api.auth import get_current_user, get_optional_user, require_admin
from app.services import search as search_engine

router = APIRouter(prefix="/api/clients", tags=["clients"])


def find_client_by_phone(cur, telephone):
    """Client existant pour ce numéro, quel que soit le format (06 12…, 0612…, +33 6…).

    Clé indexée sur les 9 derniers chiffres, puis égalité du numéro complet
    (un numéro étranger peut partager ses 9 derniers chiffres). En dessous de
    9 chiffres, seule l'égalité stricte historique s'applique.
    """
    key = search_engine.phone_key(telephone)
    if not key:
        cur.execute("SELECT * FROM clients WHERE telephone = %s ORDER BY id LIMIT 1", (telephone,))
        return cur.fetchone()
    cur.execute(
        "SELECT * FROM clients WHERE public.kp_phone_key(telephone) = %s ORDER BY id",
        (key,),
    )
    for row in cur.fetchall() or []:
        if search_engine.same_phone(row["telephone"], telephone):
            return row
    return None


@router.get("", response_model=list[ClientOut])
def list_clients(
    search: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user),
):
    """Liste les clients avec recherche optionnelle.

    Recherche : chaque mot doit trouver nom, prénom, société, email ou
    téléphone (tout format : espaces, points, +33, 4 derniers chiffres).
    """
    if search:
        pq = search_engine.parse_query(search)
        pq.ticket_id = pq.code_prefix = pq.imei = None
        sp = search_engine.SqlParams()
        where = search_engine.client_where_sql(pq, sp, c="c")
        score = search_engine.client_score_sql(pq, sp, c="c")
        with get_cursor() as cur:
            cur.execute(
                "SELECT c.* FROM clients c WHERE " + where +
                " ORDER BY " + score + " DESC, c.date_creation DESC NULLS LAST, c.id DESC"
                " LIMIT %(limit)s OFFSET %(offset)s",
                {**sp.values, "limit": limit, "offset": offset},
            )
            return cur.fetchall()
    else:
        with get_cursor() as cur:
            cur.execute(
                "SELECT * FROM clients ORDER BY date_creation DESC LIMIT %s OFFSET %s",
                (limit, offset),
            )
            return cur.fetchall()


# ─── EXPORT routes (MUST be before /{client_id}) ──────────────
@router.get("/export/csv")
def export_clients_csv(user: dict = Depends(get_current_user)):
    """Exporte tous les clients au format CSV avec nb de tickets."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT c.id, c.nom, c.prenom, c.telephone, c.email, c.societe,
                   c.carte_camby, c.date_creation,
                   COUNT(t.id) AS nb_tickets
            FROM clients c
            LEFT JOIN tickets t ON t.client_id = c.id
            GROUP BY c.id
            ORDER BY c.nom
        """)
        rows = cur.fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Nom", "Prénom", "Téléphone", "Email", "Société", "Carte Camby", "Date création", "Nb tickets"])
    for r in rows:
        writer.writerow([r["id"], r["nom"], r["prenom"], r["telephone"], r["email"], r["societe"], r["carte_camby"], r["date_creation"], r["nb_tickets"]])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=clients_klikphone.csv"},
    )


@router.get("/export/excel")
def export_clients_excel(user: dict = Depends(get_current_user)):
    """Exporte tous les clients au format Excel (.xlsx) avec nb de tickets."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    with get_cursor() as cur:
        cur.execute("""
            SELECT c.id, c.nom, c.prenom, c.telephone, c.email, c.societe,
                   c.carte_camby, c.date_creation,
                   COUNT(t.id) AS nb_tickets
            FROM clients c
            LEFT JOIN tickets t ON t.client_id = c.id
            GROUP BY c.id
            ORDER BY c.nom
        """)
        rows = cur.fetchall()

    wb = Workbook()
    ws = wb.active
    ws.title = "Clients"

    headers = ["ID", "Nom", "Prénom", "Téléphone", "Email", "Société", "Carte Camby", "Date création", "Nb tickets"]
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="7C3AED", end_color="7C3AED", fill_type="solid")
    thin_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = thin_border

    for i, r in enumerate(rows, 2):
        vals = [r["id"], r["nom"], r["prenom"], r["telephone"], r["email"], r["societe"], r["carte_camby"], str(r["date_creation"] or ""), r["nb_tickets"]]
        for col, v in enumerate(vals, 1):
            cell = ws.cell(row=i, column=col, value=v)
            cell.border = thin_border

    # Auto-fit column widths
    for col in ws.columns:
        max_len = 0
        for cell in col:
            if cell.value:
                max_len = max(max_len, len(str(cell.value)))
        ws.column_dimensions[col[0].column_letter].width = min(max_len + 3, 40)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=clients_klikphone.xlsx"},
    )


@router.get("/{client_id}", response_model=ClientOut)
def get_client(client_id: int, user: dict = Depends(get_current_user)):
    """Récupère un client par ID."""
    with get_cursor() as cur:
        cur.execute("SELECT * FROM clients WHERE id = %s", (client_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Client non trouvé")
    return row


@router.get("/tel/{telephone}")
def get_client_by_tel(telephone: str, user: dict = Depends(get_current_user)):
    """Recherche un client par téléphone (réservé au staff — renvoie la fiche complète)."""
    with get_cursor() as cur:
        row = find_client_by_phone(cur, telephone)
    return row  # None si pas trouvé (pas d'erreur 404)


@router.post("", response_model=ClientOut, response_model_exclude_unset=True)
def create_or_get_client(data: ClientCreate, user: Optional[dict] = Depends(get_optional_user)):
    """Crée un client ou retourne l'existant si le téléphone existe déjà.

    Sans jeton (borne, dépôt en ligne) : la fiche d'un client existant n'est
    jamais réécrite, seuls ses nom, prénom et société vides sont complétés, et
    seul l'id est renvoyé (pas de fuite du nom ou de l'email d'un numéro connu).
    L'email n'est jamais posé ainsi : connaître un numéro suffirait à recevoir
    les devis, reçus et suivis de ce client. Il se renseigne au comptoir.
    carte_camby n'est modifiée que si elle est fournie.
    """
    camby = data.carte_camby if "carte_camby" in data.model_fields_set and data.carte_camby is not None else None
    with get_cursor() as cur:
        # Vérifier si le client existe (numéro normalisé : évite les doublons 06 12… / 0612…)
        existing = find_client_by_phone(cur, data.telephone)

        if existing and user:
            # Staff : les valeurs saisies remplacent les anciennes
            cur.execute("""
                UPDATE clients SET
                    nom = COALESCE(NULLIF(%(nom)s, ''), nom),
                    prenom = COALESCE(NULLIF(%(prenom)s, ''), prenom),
                    email = COALESCE(NULLIF(%(email)s, ''), email),
                    societe = COALESCE(NULLIF(%(societe)s, ''), societe),
                    carte_camby = COALESCE(%(camby)s, carte_camby)
                WHERE id = %(id)s
                RETURNING *
            """, {**data.model_dump(), "camby": camby, "id": existing["id"]})
            return cur.fetchone()

        if existing:
            # Public : compléter seulement (jamais l'email) ; la carte peut être déclarée, jamais retirée
            cur.execute("""
                UPDATE clients SET
                    nom = CASE WHEN COALESCE(nom, '') = '' THEN NULLIF(%(nom)s, '') ELSE nom END,
                    prenom = CASE WHEN COALESCE(prenom, '') = '' THEN NULLIF(%(prenom)s, '') ELSE prenom END,
                    societe = CASE WHEN COALESCE(societe, '') = '' THEN NULLIF(%(societe)s, '') ELSE societe END,
                    carte_camby = CASE WHEN %(camby)s = 1 THEN 1 ELSE carte_camby END
                WHERE id = %(id)s
            """, {**data.model_dump(), "camby": 1 if camby else 0, "id": existing["id"]})
            return {"id": existing["id"]}

        # Créer le client
        cur.execute("""
            INSERT INTO clients (nom, prenom, telephone, email, societe, carte_camby)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (
            data.nom, data.prenom, data.telephone,
            data.email, data.societe, camby or 0,
        ))
        row = cur.fetchone()
    return row if user else {"id": row["id"]}


@router.patch("/{client_id}", response_model=dict)
def update_client(
    client_id: int,
    data: ClientUpdate,
    user: dict = Depends(get_current_user),
):
    """Met à jour un client."""
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        return {"ok": True}

    set_clause = ", ".join(f"{k} = %s" for k in updates.keys())
    values = list(updates.values()) + [client_id]

    with get_cursor() as cur:
        cur.execute(f"UPDATE clients SET {set_clause} WHERE id = %s", values)

    return {"ok": True}


@router.delete("/{client_id}", response_model=dict)
def delete_client(client_id: int, user: dict = Depends(require_admin)):
    """Supprime un client (vérifie qu'il n'a pas de tickets). Idempotent. Élévation admin requise."""
    with get_cursor() as cur:
        cur.execute("SELECT COUNT(*) as cnt FROM tickets WHERE client_id = %s", (client_id,))
        row = cur.fetchone()
        if row and row["cnt"] > 0:
            raise HTTPException(400, f"Ce client a {row['cnt']} ticket(s). Supprimez-les d'abord.")

        cur.execute("DELETE FROM clients WHERE id = %s", (client_id,))

    return {"ok": True}


@router.get("/{client_id}/tickets", response_model=list)
def get_client_tickets(client_id: int, user: dict = Depends(get_current_user)):
    """Récupère tous les tickets d'un client avec info retour SAV."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.*,
                   orig.ticket_code AS ticket_original_code
            FROM tickets t
            LEFT JOIN tickets orig ON t.ticket_original_id = orig.id
            WHERE t.client_id = %s
            ORDER BY t.date_depot DESC
        """, (client_id,))
        return cur.fetchall()


