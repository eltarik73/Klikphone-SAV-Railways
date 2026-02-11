"""
API Config — gestion des paramètres boutique (table params).
"""

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from app.database import get_cursor
from app.models import ParamUpdate, ParamOut
from app.api.auth import get_current_user

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("", response_model=list[ParamOut])
async def list_params(user: dict = Depends(get_current_user)):
    """Liste tous les paramètres."""
    with get_cursor() as cur:
        cur.execute("SELECT cle, valeur FROM params ORDER BY cle")
        return cur.fetchall()


@router.get("/public")
async def get_public_params():
    """Paramètres publics (pour le formulaire client et le suivi)."""
    public_keys = [
        "NOM_BOUTIQUE", "TEL_BOUTIQUE", "ADRESSE_BOUTIQUE",
        "HORAIRES_BOUTIQUE", "URL_SUIVI",
    ]
    with get_cursor() as cur:
        cur.execute(
            "SELECT cle, valeur FROM params WHERE cle = ANY(%s)",
            (public_keys,),
        )
        rows = cur.fetchall()
    return {row["cle"]: row["valeur"] for row in rows}


@router.put("")
async def set_param(data: ParamUpdate, user: dict = Depends(get_current_user)):
    """Crée ou met à jour un paramètre."""
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO params (cle, valeur) VALUES (%s, %s)
            ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur
        """, (data.cle, data.valeur))
    return {"ok": True}


@router.put("/batch")
async def set_params_batch(
    params: list[ParamUpdate],
    user: dict = Depends(get_current_user),
):
    """Met à jour plusieurs paramètres en une fois."""
    with get_cursor() as cur:
        for p in params:
            cur.execute("""
                INSERT INTO params (cle, valeur) VALUES (%s, %s)
                ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur
            """, (p.cle, p.valeur))
    return {"ok": True}


class PinChangeRequest(BaseModel):
    target: str  # "accueil" or "tech"
    old_pin: str
    new_pin: str


@router.post("/change-pin")
async def change_pin(data: PinChangeRequest, user: dict = Depends(get_current_user)):
    """Change le PIN d'accès."""
    if data.target not in ("accueil", "tech"):
        raise HTTPException(400, "Target invalide")
    if len(data.new_pin) != 4 or not data.new_pin.isdigit():
        raise HTTPException(400, "Le PIN doit être composé de 4 chiffres")

    param_key = f"PIN_{data.target.upper()}"
    with get_cursor() as cur:
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (param_key,))
        row = cur.fetchone()
        if not row or row["valeur"] != data.old_pin:
            raise HTTPException(401, "Ancien PIN incorrect")
        cur.execute(
            "UPDATE params SET valeur = %s WHERE cle = %s",
            (data.new_pin, param_key),
        )
    return {"ok": True}


@router.get("/backup")
async def export_backup(user: dict = Depends(get_current_user)):
    """Exporte toute la BDD au format JSON pour backup."""
    tables = {}
    with get_cursor() as cur:
        for table in ["clients", "tickets", "params", "membres_equipe", "commandes_pieces", "catalog_marques", "catalog_modeles", "historique", "chat_messages"]:
            try:
                cur.execute(f"SELECT * FROM {table}")
                rows = cur.fetchall()
                tables[table] = [{k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in row.items()} for row in rows]
            except Exception:
                tables[table] = []

    return JSONResponse(
        content={"backup_date": datetime.now().isoformat(), "tables": tables},
        headers={"Content-Disposition": f"attachment; filename=klikphone_backup_{datetime.now().strftime('%Y%m%d')}.json"},
    )


@router.post("/backup/import")
async def import_backup(backup: dict, user: dict = Depends(get_current_user)):
    """Importe un backup JSON complet. Remplace toutes les données existantes."""
    tables = backup.get("tables", {})
    if not tables:
        raise HTTPException(400, "Format de backup invalide (pas de clé 'tables')")

    # Ordre d'import : tables parentes d'abord
    import_order = ["params", "membres_equipe", "catalog_marques", "catalog_modeles", "clients", "tickets", "commandes_pieces", "historique", "chat_messages"]
    counts = {}

    with get_cursor() as cur:
        # Supprimer dans l'ordre inverse (FK)
        for table in reversed(import_order):
            if table in tables:
                cur.execute(f"DELETE FROM {table}")

        for table in import_order:
            rows = tables.get(table, [])
            if not rows:
                counts[table] = 0
                continue
            cols = list(rows[0].keys())
            placeholders = ", ".join(["%s"] * len(cols))
            col_names = ", ".join(cols)
            for row in rows:
                vals = [row.get(c) for c in cols]
                cur.execute(f"INSERT INTO {table} ({col_names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING", vals)
            counts[table] = len(rows)

        # Reset sequences
        for table in ["clients", "tickets", "membres_equipe", "commandes_pieces", "historique", "chat_messages"]:
            try:
                cur.execute(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE(MAX(id), 1)) FROM {table}")
            except Exception:
                pass

    return {"ok": True, "imported": counts}


@router.get("/{cle}")
async def get_param(cle: str, user: dict = Depends(get_current_user)):
    """Récupère un paramètre par clé."""
    with get_cursor() as cur:
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (cle,))
        row = cur.fetchone()
    return {"cle": cle, "valeur": row["valeur"] if row else None}
