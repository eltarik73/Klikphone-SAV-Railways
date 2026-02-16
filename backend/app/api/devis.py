"""
API Devis — Gestion des devis clients.
CRUD complet, changement de statut, conversion en ticket, impression.
"""

from datetime import datetime
from decimal import Decimal
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.database import get_cursor
from app.api.auth import get_current_user

router = APIRouter(prefix="/api/devis", tags=["devis"])


# ─── Models ────────────────────────────────────────────────

class DevisLigneIn(BaseModel):
    description: str
    quantite: int = 1
    prix_unitaire: float = 0
    ordre: int = 0

class DevisCreate(BaseModel):
    client_id: Optional[int] = None
    client_nom: Optional[str] = None
    client_prenom: Optional[str] = None
    client_tel: Optional[str] = None
    client_email: Optional[str] = None
    appareil: Optional[str] = None
    description: Optional[str] = None
    tva: float = 20
    remise: float = 0
    notes: Optional[str] = None
    validite_jours: int = 30
    lignes: List[DevisLigneIn] = []

class DevisUpdate(BaseModel):
    client_id: Optional[int] = None
    client_nom: Optional[str] = None
    client_prenom: Optional[str] = None
    client_tel: Optional[str] = None
    client_email: Optional[str] = None
    appareil: Optional[str] = None
    description: Optional[str] = None
    statut: Optional[str] = None
    tva: Optional[float] = None
    remise: Optional[float] = None
    notes: Optional[str] = None
    validite_jours: Optional[int] = None
    lignes: Optional[List[DevisLigneIn]] = None


STATUTS = ["Brouillon", "Envoyé", "Accepté", "Refusé", "Converti"]


def _calc_totals(lignes, tva_pct, remise):
    """Calcule total_ht et total_ttc."""
    total_ht = sum(l.get("quantite", 1) * l.get("prix_unitaire", 0) for l in lignes)
    total_ht -= float(remise or 0)
    if total_ht < 0:
        total_ht = 0
    total_ttc = total_ht * (1 + float(tva_pct or 20) / 100)
    return round(total_ht, 2), round(total_ttc, 2)


def _gen_numero(cur):
    """Génère un numéro de devis unique: DEV-YYYYMM-XXXX."""
    now = datetime.now()
    prefix = f"DEV-{now.strftime('%Y%m')}-"
    cur.execute(
        "SELECT numero FROM devis WHERE numero LIKE %s ORDER BY id DESC LIMIT 1",
        (f"{prefix}%",),
    )
    row = cur.fetchone()
    if row:
        try:
            last_num = int(row["numero"].split("-")[-1])
        except (ValueError, IndexError):
            last_num = 0
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


# ─── LIST ──────────────────────────────────────────────────

@router.get("")
async def list_devis(
    statut: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    user: dict = Depends(get_current_user),
):
    conditions = []
    params = []
    if statut:
        conditions.append("d.statut = %s")
        params.append(statut)
    if search:
        conditions.append(
            "(d.numero ILIKE %s OR d.client_nom ILIKE %s OR d.client_prenom ILIKE %s "
            "OR d.client_tel LIKE %s OR d.appareil ILIKE %s)"
        )
        s = f"%{search}%"
        params.extend([s, s, s, s, s])
    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    params.extend([limit, offset])

    with get_cursor() as cur:
        cur.execute(f"""
            SELECT d.*,
                (SELECT COUNT(*) FROM devis_lignes WHERE devis_id = d.id) as nb_lignes
            FROM devis d
            {where}
            ORDER BY d.date_creation DESC
            LIMIT %s OFFSET %s
        """, params)
        rows = cur.fetchall()

    result = []
    for r in rows:
        d = dict(r)
        for key in ("date_creation", "date_maj", "date_acceptation", "date_refus"):
            if d.get(key) and hasattr(d[key], "isoformat"):
                d[key] = d[key].isoformat()
        result.append(d)
    return result


# ─── GET ONE ───────────────────────────────────────────────

@router.get("/{devis_id}")
async def get_devis(devis_id: int, user: dict = Depends(get_current_user)):
    with get_cursor() as cur:
        cur.execute("SELECT * FROM devis WHERE id = %s", (devis_id,))
        devis = cur.fetchone()
        if not devis:
            raise HTTPException(404, "Devis non trouvé")
        cur.execute(
            "SELECT * FROM devis_lignes WHERE devis_id = %s ORDER BY ordre, id", (devis_id,)
        )
        lignes = cur.fetchall()

    d = dict(devis)
    for key in ("date_creation", "date_maj", "date_acceptation", "date_refus"):
        if d.get(key) and hasattr(d[key], "isoformat"):
            d[key] = d[key].isoformat()
    d["lignes"] = [dict(l) for l in lignes]
    return d


# ─── CREATE ────────────────────────────────────────────────

@router.post("")
async def create_devis(data: DevisCreate, user: dict = Depends(get_current_user)):
    lignes_dicts = [l.model_dump() for l in data.lignes]
    for ld in lignes_dicts:
        ld["total"] = round(ld["quantite"] * ld["prix_unitaire"], 2)
    total_ht, total_ttc = _calc_totals(lignes_dicts, data.tva, data.remise)

    # Auto-fill client info from client_id
    client_nom = data.client_nom
    client_prenom = data.client_prenom
    client_tel = data.client_tel
    client_email = data.client_email
    if data.client_id and not client_nom:
        try:
            with get_cursor() as cur:
                cur.execute("SELECT nom, prenom, telephone, email FROM clients WHERE id = %s", (data.client_id,))
                c = cur.fetchone()
                if c:
                    client_nom = c["nom"]
                    client_prenom = c["prenom"]
                    client_tel = c["telephone"]
                    client_email = c.get("email")
        except Exception:
            pass

    with get_cursor() as cur:
        numero = _gen_numero(cur)
        cur.execute("""
            INSERT INTO devis (numero, client_id, client_nom, client_prenom, client_tel, client_email,
                appareil, description, tva, remise, total_ht, total_ttc, notes, validite_jours)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            numero, data.client_id, client_nom, client_prenom, client_tel, client_email,
            data.appareil, data.description, data.tva, data.remise, total_ht, total_ttc,
            data.notes, data.validite_jours,
        ))
        devis_id = cur.fetchone()["id"]

        for i, ld in enumerate(lignes_dicts):
            cur.execute("""
                INSERT INTO devis_lignes (devis_id, description, quantite, prix_unitaire, total, ordre)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (devis_id, ld["description"], ld["quantite"], ld["prix_unitaire"], ld["total"], i))

    return {"id": devis_id, "numero": numero}


# ─── UPDATE ────────────────────────────────────────────────

@router.patch("/{devis_id}")
async def update_devis(devis_id: int, data: DevisUpdate, user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in data.model_dump(exclude_unset=True).items() if k != "lignes"}

    with get_cursor() as cur:
        cur.execute("SELECT * FROM devis WHERE id = %s", (devis_id,))
        existing = cur.fetchone()
        if not existing:
            raise HTTPException(404, "Devis non trouvé")

        # Handle status changes
        if "statut" in updates:
            if updates["statut"] not in STATUTS:
                raise HTTPException(400, f"Statut invalide. Valides: {STATUTS}")
            if updates["statut"] == "Accepté":
                updates["date_acceptation"] = datetime.now()
            elif updates["statut"] == "Refusé":
                updates["date_refus"] = datetime.now()

        # Update lignes if provided
        if data.lignes is not None:
            cur.execute("DELETE FROM devis_lignes WHERE devis_id = %s", (devis_id,))
            lignes_dicts = []
            for i, l in enumerate(data.lignes):
                ld = l.model_dump()
                ld["total"] = round(ld["quantite"] * ld["prix_unitaire"], 2)
                lignes_dicts.append(ld)
                cur.execute("""
                    INSERT INTO devis_lignes (devis_id, description, quantite, prix_unitaire, total, ordre)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (devis_id, ld["description"], ld["quantite"], ld["prix_unitaire"], ld["total"], i))

            tva = updates.get("tva", existing["tva"])
            remise = updates.get("remise", existing["remise"])
            total_ht, total_ttc = _calc_totals(lignes_dicts, tva, remise)
            updates["total_ht"] = total_ht
            updates["total_ttc"] = total_ttc

        if updates:
            updates["date_maj"] = datetime.now()
            set_clause = ", ".join(f"{k} = %s" for k in updates.keys())
            values = list(updates.values()) + [devis_id]
            cur.execute(f"UPDATE devis SET {set_clause} WHERE id = %s", values)

    return {"ok": True}


# ─── DELETE ────────────────────────────────────────────────

@router.delete("/{devis_id}")
async def delete_devis(devis_id: int, user: dict = Depends(get_current_user)):
    with get_cursor() as cur:
        cur.execute("DELETE FROM devis_lignes WHERE devis_id = %s", (devis_id,))
        cur.execute("DELETE FROM devis WHERE id = %s", (devis_id,))
    return {"ok": True}


# ─── CONVERT TO TICKET ────────────────────────────────────

@router.post("/{devis_id}/convert")
async def convert_to_ticket(devis_id: int, user: dict = Depends(get_current_user)):
    """Convertit un devis accepté en ticket SAV."""
    with get_cursor() as cur:
        cur.execute("SELECT * FROM devis WHERE id = %s", (devis_id,))
        devis = cur.fetchone()
        if not devis:
            raise HTTPException(404, "Devis non trouvé")

        # Create client if needed
        client_id = devis.get("client_id")
        if not client_id and devis.get("client_tel"):
            cur.execute("SELECT id FROM clients WHERE telephone = %s", (devis["client_tel"],))
            row = cur.fetchone()
            if row:
                client_id = row["id"]
            else:
                cur.execute("""
                    INSERT INTO clients (nom, prenom, telephone, email)
                    VALUES (%s, %s, %s, %s) RETURNING id
                """, (devis.get("client_nom", ""), devis.get("client_prenom", ""),
                      devis.get("client_tel", ""), devis.get("client_email")))
                client_id = cur.fetchone()["id"]

        if not client_id:
            raise HTTPException(400, "Impossible de créer le ticket sans client")

        # Create ticket
        panne = devis.get("description") or "Réparation (devis)"
        cur.execute("""
            INSERT INTO tickets (client_id, panne, devis_estime, statut, notes_internes)
            VALUES (%s, %s, %s, 'En attente de diagnostic', %s)
            RETURNING id
        """, (client_id, panne, devis.get("total_ttc", 0),
              f"Créé depuis devis {devis.get('numero', '')}"))
        ticket_id = cur.fetchone()["id"]
        code = f"KP-{ticket_id:06d}"
        cur.execute("UPDATE tickets SET ticket_code = %s WHERE id = %s", (code, ticket_id))

        # Mark devis as converted
        cur.execute(
            "UPDATE devis SET statut = 'Converti', ticket_id = %s, date_maj = NOW() WHERE id = %s",
            (ticket_id, devis_id),
        )

    return {"ok": True, "ticket_id": ticket_id, "ticket_code": code}


# ─── DUPLICATE ─────────────────────────────────────────────

@router.post("/{devis_id}/duplicate")
async def duplicate_devis(devis_id: int, user: dict = Depends(get_current_user)):
    """Duplique un devis existant."""
    with get_cursor() as cur:
        cur.execute("SELECT * FROM devis WHERE id = %s", (devis_id,))
        original = cur.fetchone()
        if not original:
            raise HTTPException(404, "Devis non trouvé")

        numero = _gen_numero(cur)
        cur.execute("""
            INSERT INTO devis (numero, client_id, client_nom, client_prenom, client_tel, client_email,
                appareil, description, tva, remise, total_ht, total_ttc, notes, validite_jours, statut)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'Brouillon')
            RETURNING id
        """, (
            numero, original["client_id"], original["client_nom"], original["client_prenom"],
            original["client_tel"], original["client_email"], original["appareil"],
            original["description"], original["tva"], original["remise"],
            original["total_ht"], original["total_ttc"], original["notes"],
            original["validite_jours"],
        ))
        new_id = cur.fetchone()["id"]

        cur.execute("SELECT * FROM devis_lignes WHERE devis_id = %s ORDER BY ordre", (devis_id,))
        for l in cur.fetchall():
            cur.execute("""
                INSERT INTO devis_lignes (devis_id, description, quantite, prix_unitaire, total, ordre)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (new_id, l["description"], l["quantite"], l["prix_unitaire"], l["total"], l["ordre"]))

    return {"id": new_id, "numero": numero}


# ─── STATS ─────────────────────────────────────────────────

@router.get("/stats/overview")
async def devis_stats(user: dict = Depends(get_current_user)):
    with get_cursor() as cur:
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE statut = 'Brouillon') as brouillons,
                COUNT(*) FILTER (WHERE statut = 'Envoyé') as envoyes,
                COUNT(*) FILTER (WHERE statut = 'Accepté') as acceptes,
                COUNT(*) FILTER (WHERE statut = 'Refusé') as refuses,
                COUNT(*) FILTER (WHERE statut = 'Converti') as convertis,
                COALESCE(SUM(total_ttc) FILTER (WHERE statut = 'Accepté'), 0) as ca_accepte,
                COALESCE(AVG(total_ttc), 0) as panier_moyen
            FROM devis
        """)
        return cur.fetchone()


# ─── DEVIS FLASH — SEARCH TARIFS ──────────────────────────

@router.get("/flash/search")
async def devis_flash_search(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, le=50),
    user: Optional[dict] = None,
):
    """Recherche dans tarifs_reparations pour le devis flash."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT id, marque, modele, type_piece, qualite, prix_client,
                   en_stock, fournisseur
            FROM tarifs_reparations
            WHERE (modele ILIKE %s OR marque ILIKE %s OR type_piece ILIKE %s)
            ORDER BY marque, modele, type_piece
            LIMIT %s
        """, (f"%{q}%", f"%{q}%", f"%{q}%", limit))
        return cur.fetchall()


# ─── TELEPHONES VENTE — CRUD ──────────────────────────────

@router.get("/telephones-vente")
async def list_telephones_vente(
    search: Optional[str] = None,
    marque: Optional[str] = None,
    etat: Optional[str] = None,
    en_stock: Optional[bool] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    user: dict = Depends(get_current_user),
):
    conditions = []
    params = []
    if search:
        conditions.append("(marque ILIKE %s OR modele ILIKE %s OR imei ILIKE %s)")
        s = f"%{search}%"
        params.extend([s, s, s])
    if marque:
        conditions.append("marque = %s")
        params.append(marque)
    if etat:
        conditions.append("etat = %s")
        params.append(etat)
    if en_stock is not None:
        conditions.append("en_stock = %s")
        params.append(en_stock)
    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    params.extend([limit, offset])

    with get_cursor() as cur:
        cur.execute(f"""
            SELECT * FROM telephones_vente {where}
            ORDER BY date_ajout DESC LIMIT %s OFFSET %s
        """, params)
        rows = cur.fetchall()

    result = []
    for r in rows:
        d = dict(r)
        if d.get("date_ajout") and hasattr(d["date_ajout"], "isoformat"):
            d["date_ajout"] = d["date_ajout"].isoformat()
        result.append(d)
    return result


@router.get("/telephones-vente/stats")
async def telephones_vente_stats(user: dict = Depends(get_current_user)):
    with get_cursor() as cur:
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE en_stock = true) as en_stock,
                COUNT(*) FILTER (WHERE etat = 'Neuf') as neufs,
                COUNT(*) FILTER (WHERE etat = 'Occasion') as occasions,
                COALESCE(SUM(prix_vente) FILTER (WHERE en_stock = true), 0) as valeur_stock,
                COUNT(DISTINCT marque) as nb_marques
            FROM telephones_vente
        """)
        return cur.fetchone()


@router.get("/telephones-vente/marques")
async def telephones_vente_marques(user: dict = Depends(get_current_user)):
    with get_cursor() as cur:
        cur.execute("SELECT DISTINCT marque FROM telephones_vente ORDER BY marque")
        return [r["marque"] for r in cur.fetchall()]


@router.post("/telephones-vente")
async def create_telephone_vente(data: dict, user: dict = Depends(get_current_user)):
    fields = ["marque", "modele", "capacite", "couleur", "etat", "prix_achat", "prix_vente", "imei", "notes"]
    vals = {k: data.get(k) for k in fields if k in data}
    if not vals.get("marque") or not vals.get("modele"):
        raise HTTPException(400, "Marque et modèle requis")

    cols = ", ".join(vals.keys())
    placeholders = ", ".join(["%s"] * len(vals))
    with get_cursor() as cur:
        cur.execute(
            f"INSERT INTO telephones_vente ({cols}) VALUES ({placeholders}) RETURNING id",
            list(vals.values()),
        )
        return {"id": cur.fetchone()["id"]}


@router.patch("/telephones-vente/{tel_id}")
async def update_telephone_vente(tel_id: int, data: dict, user: dict = Depends(get_current_user)):
    allowed = ["marque", "modele", "capacite", "couleur", "etat", "prix_achat", "prix_vente", "imei", "en_stock", "notes"]
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        return {"ok": True}
    set_clause = ", ".join(f"{k} = %s" for k in updates.keys())
    with get_cursor() as cur:
        cur.execute(f"UPDATE telephones_vente SET {set_clause} WHERE id = %s", list(updates.values()) + [tel_id])
    return {"ok": True}


@router.delete("/telephones-vente/{tel_id}")
async def delete_telephone_vente(tel_id: int, user: dict = Depends(get_current_user)):
    with get_cursor() as cur:
        cur.execute("DELETE FROM telephones_vente WHERE id = %s", (tel_id,))
    return {"ok": True}


# ─── PRINT DEVIS ───────────────────────────────────────────

@router.get("/{devis_id}/print")
async def print_devis(devis_id: int):
    """Génère un HTML imprimable pour le devis."""
    from fastapi.responses import HTMLResponse

    with get_cursor() as cur:
        cur.execute("SELECT * FROM devis WHERE id = %s", (devis_id,))
        devis = cur.fetchone()
        if not devis:
            raise HTTPException(404, "Devis non trouvé")
        cur.execute("SELECT * FROM devis_lignes WHERE devis_id = %s ORDER BY ordre", (devis_id,))
        lignes = cur.fetchall()

    # Shop info
    try:
        with get_cursor() as cur:
            cur.execute("SELECT cle, valeur FROM params WHERE cle IN ('NOM_BOUTIQUE', 'ADRESSE_BOUTIQUE', 'TEL_BOUTIQUE', 'EMAIL_BOUTIQUE', 'SIRET_BOUTIQUE')")
            params = {r["cle"]: r["valeur"] for r in cur.fetchall()}
    except Exception:
        params = {}

    nom_boutique = params.get("NOM_BOUTIQUE", "KLIKPHONE")
    adresse = params.get("ADRESSE_BOUTIQUE", "79 Place Saint-Léger, 73000 Chambéry")
    tel = params.get("TEL_BOUTIQUE", "04 79 60 89 22")
    email_boutique = params.get("EMAIL_BOUTIQUE", "")
    siret = params.get("SIRET_BOUTIQUE", "")

    def fp(v):
        if v is None:
            return "0,00"
        return f"{float(v):,.2f}".replace(",", " ").replace(".", ",")

    date_creation = devis["date_creation"]
    if hasattr(date_creation, "strftime"):
        date_str = date_creation.strftime("%d/%m/%Y")
    else:
        date_str = str(date_creation)[:10] if date_creation else ""

    lignes_html = ""
    for l in lignes:
        lignes_html += f"""
        <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">{l['description']}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center">{l['quantite']}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">{fp(l['prix_unitaire'])} €</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600">{fp(l['total'])} €</td>
        </tr>"""

    html = f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Devis {devis['numero']}</title>
<style>
    @page {{ size: A4; margin: 15mm; }}
    body {{ font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 13px; color: #1e293b; margin: 0; padding: 20px; }}
    .header {{ display: flex; justify-content: space-between; margin-bottom: 30px; }}
    .shop {{ font-size: 12px; color: #64748b; line-height: 1.6; }}
    .shop-name {{ font-size: 20px; font-weight: 800; color: #7c3aed; margin-bottom: 4px; }}
    .devis-info {{ text-align: right; }}
    .devis-num {{ font-size: 18px; font-weight: 700; color: #1e293b; }}
    .client-box {{ background: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 24px; }}
    .client-label {{ font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; margin-bottom: 6px; font-weight: 600; }}
    table {{ width: 100%; border-collapse: collapse; margin-bottom: 24px; }}
    th {{ background: #7c3aed; color: white; padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }}
    th:nth-child(2), th:nth-child(3), th:last-child {{ text-align: center; }}
    th:last-child {{ text-align: right; }}
    .totals {{ margin-left: auto; width: 280px; }}
    .total-row {{ display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }}
    .total-final {{ font-size: 18px; font-weight: 800; color: #7c3aed; border-top: 2px solid #7c3aed; padding-top: 8px; margin-top: 4px; }}
    .footer {{ margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; }}
    .status-badge {{ display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; }}
    @media print {{ body {{ padding: 0; }} }}
</style>
</head><body>
<div class="header">
    <div>
        <div class="shop-name">{nom_boutique}</div>
        <div class="shop">{adresse}<br>{tel}
        {"<br>" + email_boutique if email_boutique else ""}
        {"<br>SIRET: " + siret if siret else ""}
        </div>
    </div>
    <div class="devis-info">
        <div class="devis-num">{devis['numero']}</div>
        <div style="color:#64748b;font-size:12px;margin-top:4px">Date: {date_str}</div>
        <div style="color:#64748b;font-size:12px">Validité: {devis.get('validite_jours', 30)} jours</div>
        <div style="margin-top:8px">
            <span class="status-badge" style="background:#f1f5f9;color:#475569">{devis['statut']}</span>
        </div>
    </div>
</div>

<div class="client-box">
    <div class="client-label">Client</div>
    <div style="font-weight:600;font-size:14px">{devis.get('client_prenom', '')} {devis.get('client_nom', '')}</div>
    <div style="color:#64748b;font-size:12px;margin-top:2px">
        {devis.get('client_tel', '')}
        {' — ' + devis.get('client_email', '') if devis.get('client_email') else ''}
    </div>
    {"<div style='margin-top:6px;font-size:12px'><b>Appareil:</b> " + devis['appareil'] + "</div>" if devis.get('appareil') else ''}
    {"<div style='margin-top:4px;font-size:12px;color:#64748b'>" + devis['description'] + "</div>" if devis.get('description') else ''}
</div>

<table>
    <thead><tr>
        <th>Description</th><th>Qté</th><th>Prix unit.</th><th>Total</th>
    </tr></thead>
    <tbody>{lignes_html}</tbody>
</table>

<div class="totals">
    <div class="total-row"><span>Sous-total HT</span><span>{fp(devis['total_ht'])} €</span></div>
    {"<div class='total-row'><span>Remise</span><span>-" + fp(devis['remise']) + " €</span></div>" if float(devis.get('remise') or 0) > 0 else ''}
    <div class="total-row"><span>TVA ({fp(devis['tva'])}%)</span><span>{fp(float(devis['total_ttc'] or 0) - float(devis['total_ht'] or 0))} €</span></div>
    <div class="total-row total-final"><span>Total TTC</span><span>{fp(devis['total_ttc'])} €</span></div>
</div>

{"<div style='margin-top:24px;padding:12px;background:#fffbeb;border-radius:8px;font-size:12px;color:#92400e'><b>Notes:</b> " + devis['notes'] + "</div>" if devis.get('notes') else ''}

<div class="footer">
    <p>Devis valable {devis.get('validite_jours', 30)} jours à compter de la date d'émission.</p>
    <p>{nom_boutique} — {adresse} — {tel}</p>
</div>
</body></html>"""

    return HTMLResponse(content=html)
