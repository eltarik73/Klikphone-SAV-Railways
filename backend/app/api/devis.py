"""
API Devis — Gestion des devis clients.
CRUD complet, changement de statut, conversion en ticket, impression.
"""

import json
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from app.database import get_cursor
from app.services import mentions
from app.services import params as params_cache
from app.api.auth import get_current_user
from app.api.notifications_center import push_notification
from app.api import grille
from app.services import prestations as P

router = APIRouter(prefix="/api/devis", tags=["devis"])


# ─── Models ────────────────────────────────────────────────

# Bornes : montants et durées plausibles, et dans les colonnes (numeric(10,2), integer) —
# 50 lignes × 100 × 10 000 € tiennent dans total_ht ; TVA de 0 % (franchise) à 30 %.
_INT_MAX = 2_147_483_647
_PRIX_MAX = 10_000
_TXT, _TXT_LONG = 200, 10_000


class DevisLigneIn(BaseModel):
    description: str = Field(..., max_length=1000)
    quantite: int = Field(1, ge=1, le=100)
    prix_unitaire: float = Field(0, ge=0, le=_PRIX_MAX, allow_inf_nan=False)
    ordre: int = Field(0, ge=0, le=1000)

class DevisCreate(BaseModel):
    client_id: Optional[int] = Field(None, ge=1, le=_INT_MAX)
    client_nom: Optional[str] = Field(None, max_length=_TXT)
    client_prenom: Optional[str] = Field(None, max_length=_TXT)
    client_tel: Optional[str] = Field(None, max_length=40)
    client_email: Optional[str] = Field(None, max_length=254)
    appareil: Optional[str] = Field(None, max_length=_TXT)
    description: Optional[str] = Field(None, max_length=_TXT_LONG)
    tva: float = Field(20, ge=0, le=30, allow_inf_nan=False)
    remise: float = Field(0, ge=0, le=100_000, allow_inf_nan=False)
    notes: Optional[str] = Field(None, max_length=_TXT_LONG)
    validite_jours: int = Field(30, ge=1, le=365)
    lignes: List[DevisLigneIn] = Field([], max_length=50)

class DevisUpdate(BaseModel):
    client_id: Optional[int] = Field(None, ge=1, le=_INT_MAX)
    client_nom: Optional[str] = Field(None, max_length=_TXT)
    client_prenom: Optional[str] = Field(None, max_length=_TXT)
    client_tel: Optional[str] = Field(None, max_length=40)
    client_email: Optional[str] = Field(None, max_length=254)
    appareil: Optional[str] = Field(None, max_length=_TXT)
    description: Optional[str] = Field(None, max_length=_TXT_LONG)
    statut: Optional[str] = Field(None, max_length=40)
    tva: Optional[float] = Field(None, ge=0, le=30, allow_inf_nan=False)
    remise: Optional[float] = Field(None, ge=0, le=100_000, allow_inf_nan=False)
    notes: Optional[str] = Field(None, max_length=_TXT_LONG)
    validite_jours: Optional[int] = Field(None, ge=1, le=365)
    lignes: Optional[List[DevisLigneIn]] = Field(None, max_length=50)


ETATS_TELEPHONE = ("Neuf", "Occasion", "Reconditionné")


def _prix_saisi(v):
    """« 299,90 », « 299.90 € », 299.9 → 299.9 ; vide → None (champ laissé blanc)."""
    if v is None or isinstance(v, (int, float)):
        return v
    t = "".join(str(v).replace("€", "").split()).replace(",", ".")
    return t or None


class TelephoneVenteIn(BaseModel):
    """Téléphone à la vente (onglet de Devis Flash). Création : marque et modèle requis ;
    modification (PATCH) : seulement les champs envoyés."""
    marque: Optional[str] = Field(None, max_length=100)
    modele: Optional[str] = Field(None, max_length=_TXT)
    capacite: Optional[str] = Field(None, max_length=50)
    couleur: Optional[str] = Field(None, max_length=50)
    etat: Optional[str] = None
    prix_achat: Optional[float] = Field(None, ge=0, le=100_000, allow_inf_nan=False)
    prix_vente: Optional[float] = Field(None, ge=0, le=100_000, allow_inf_nan=False)
    imei: Optional[str] = Field(None, max_length=20)
    en_stock: Optional[bool] = None
    notes: Optional[str] = Field(None, max_length=_TXT_LONG)

    _prix = field_validator("prix_achat", "prix_vente", mode="before")(_prix_saisi)

    @field_validator("marque", "modele", "capacite", "couleur", "imei", mode="before")
    @classmethod
    def _texte(cls, v):
        return " ".join(str(v).split()) if v is not None else None

    @field_validator("etat")
    @classmethod
    def _etat(cls, v):
        if v is not None and v not in ETATS_TELEPHONE:
            raise ValueError(f"État inconnu : {', '.join(ETATS_TELEPHONE)}")
        return v


STATUTS = ["Brouillon", "Envoyé", "Accepté", "Refusé", "Converti"]


def _calc_totals(lignes, tva_pct, remise):
    """Calcule total_ht et total_ttc."""
    total_ht = sum(l.get("quantite", 1) * l.get("prix_unitaire", 0) for l in lignes)
    total_ht -= float(remise or 0)
    if total_ht < 0:
        total_ht = 0
    # TVA 0 (franchise, art. 293 B du CGI) est un taux valide : 20 % seulement si absent
    total_ttc = total_ht * (1 + float(20 if tva_pct is None else tva_pct) / 100)
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


# ══════════════════════════════════════════════════════════════
# STATIC ROUTES (must come BEFORE /{devis_id} to avoid conflicts)
# ══════════════════════════════════════════════════════════════


# ─── LIST ──────────────────────────────────────────────────

@router.get("")
def list_devis(
    statut: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(50, ge=0, le=200),
    offset: int = Query(0, ge=0, le=_INT_MAX),
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


# ─── CREATE ────────────────────────────────────────────────

@router.post("")
def create_devis(data: DevisCreate, user: dict = Depends(get_current_user)):
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


# ─── STATS ─────────────────────────────────────────────────

@router.get("/stats/overview")
def devis_stats(user: dict = Depends(get_current_user)):
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


# ─── DEVIS FLASH — SEARCH TARIFS (grouped by model) ──────

@router.get("/flash/search")
def devis_flash_search(
    q: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(20, ge=1, le=50),
    user: dict = Depends(get_current_user),
):
    """Recherche dans les grilles, résultats groupés par modèle (prix client TTC).

    Mêmes règles que les suggestions du ticket (api/grille) : jamais de pièce obsolète ni de
    pièce « à renseigner » (prix ≤ 0) ; pour un iPhone, la grille boutique (tarifs_reparation)
    passe devant les pièces fournisseur du même type, qui ne sont pas reprises. Chaque modèle
    porte le taux de TVA de la boutique (tva, en %) : Devis Flash en tire le prix HT du devis.
    """
    motif = f"%{q}%"
    colonnes = ", ".join(c for c, *_ in grille._COLONNES_GRILLE_IPHONE)
    with get_cursor() as cur:
        # LIMIT sur les modèles (pas sur les lignes) : chaque modèle garde toutes ses réparations
        cur.execute("""
            WITH valides AS (
                SELECT marque, modele, type_piece, qualite, prix_client, en_stock
                FROM tarifs
                WHERE obsolete IS NOT TRUE AND COALESCE(prix_client, 0) > 0
                  AND prix_source IS DISTINCT FROM %s
            ), m AS (
                SELECT marque, modele
                FROM valides
                WHERE modele ILIKE %s OR marque ILIKE %s
                GROUP BY marque, modele
                ORDER BY marque, modele
                LIMIT %s
            )
            SELECT v.marque, v.modele, v.type_piece, v.qualite, v.prix_client, v.en_stock
            FROM valides v
            JOIN m ON m.marque = v.marque AND m.modele = v.modele
            ORDER BY v.marque, v.modele, v.type_piece, v.qualite
        """, ("a_renseigner", motif, motif, limit))
        rows = cur.fetchall() or []
        cur.execute(f"""
            SELECT modele, {colonnes} FROM tarifs_reparation
            WHERE modele ILIKE %s OR %s ILIKE %s
            ORDER BY ordre, id
            LIMIT %s
        """, (motif, "Apple", motif, limit))
        boutique = cur.fetchall() or []
        tva = _tva_boutique(cur)

    models = {}
    couverts = {}
    for r in boutique:
        cle = "Apple||" + grille.cle_modele(r["modele"], "Apple")
        if cle in models:
            continue
        reps = []
        for col, type_piece, qualite, _label in grille._COLONNES_GRILLE_IPHONE:
            prix = grille._prix(r.get(col))
            if prix is not None:
                reps.append({"composant": type_piece, "qualite": qualite, "prix_vente": prix, "en_stock": True})
                couverts.setdefault(cle, set()).update(grille._REPLI_PAR_COLONNE.get(col, set()))
        if reps:
            models[cle] = {"marque": "Apple", "modele": r["modele"], "tva": tva, "reparations": reps}

    for r in rows:
        apple = grille.marque_canonique(r["marque"]) == "apple"
        cle = ("Apple||" + grille.cle_modele(r["modele"], "Apple")) if apple else f"{r['marque']}||{r['modele']}"
        if apple and P.cle_panne(r["type_piece"]) in couverts.get(cle, ()):
            continue   # type de pièce couvert par la grille boutique : son prix fait foi
        if cle not in models:
            models[cle] = {"marque": r["marque"], "modele": r["modele"], "tva": tva, "reparations": []}
        models[cle]["reparations"].append({
            "composant": r["type_piece"],
            "qualite": r["qualite"] or None,
            "prix_vente": float(r["prix_client"]),
            "en_stock": bool(r.get("en_stock", True)),
        })

    resultat = sorted(models.values(), key=lambda m: (str(m["marque"]).lower(), grille.cle_modele(m["modele"], m["marque"])))
    return resultat[:limit]


def _tva_boutique(cur) -> float:
    """Taux de TVA de la boutique (params.tva, en %), 20 si absent ou illisible."""
    cur.execute("SELECT valeur FROM params WHERE cle = 'tva'")
    row = cur.fetchone()
    try:
        taux = float(str(row["valeur"]).replace(",", ".")) if row and row.get("valeur") not in (None, "") else 20.0
    except (TypeError, ValueError):
        return 20.0
    return taux if 0 <= taux <= 30 else 20.0


# ─── TELEPHONES VENTE — CRUD ──────────────────────────────

@router.get("/telephones-vente")
def list_telephones_vente(
    search: Optional[str] = None,
    marque: Optional[str] = None,
    etat: Optional[str] = None,
    en_stock: Optional[bool] = None,
    limit: int = Query(50, ge=0, le=200),
    offset: int = Query(0, ge=0, le=_INT_MAX),
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
def telephones_vente_stats(user: dict = Depends(get_current_user)):
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
def telephones_vente_marques(user: dict = Depends(get_current_user)):
    with get_cursor() as cur:
        cur.execute("SELECT DISTINCT marque FROM telephones_vente ORDER BY marque")
        return [r["marque"] for r in cur.fetchall()]


@router.post("/telephones-vente")
def create_telephone_vente(data: TelephoneVenteIn, user: dict = Depends(get_current_user)):
    vals = {k: v for k, v in data.model_dump(exclude_unset=True).items() if k != "en_stock"}
    if not vals.get("marque") or not vals.get("modele"):
        raise HTTPException(400, "Marque et modèle requis")
    # Prix laissé vide : 0, comme la valeur par défaut de la colonne
    for k in ("prix_achat", "prix_vente"):
        if k in vals and vals[k] is None:
            vals[k] = 0

    cols = ", ".join(vals.keys())
    placeholders = ", ".join(["%s"] * len(vals))
    with get_cursor() as cur:
        cur.execute(
            f"INSERT INTO telephones_vente ({cols}) VALUES ({placeholders}) RETURNING id",
            list(vals.values()),
        )
        return {"id": cur.fetchone()["id"]}


@router.patch("/telephones-vente/{tel_id}")
def update_telephone_vente(tel_id: int, data: TelephoneVenteIn, user: dict = Depends(get_current_user)):
    updates = data.model_dump(exclude_unset=True)
    for k in ("marque", "modele"):
        if k in updates and not updates[k]:
            raise HTTPException(400, "Marque et modèle requis")
    for k in ("prix_achat", "prix_vente"):
        if k in updates and updates[k] is None:
            updates[k] = 0
    if "en_stock" in updates and updates["en_stock"] is None:
        del updates["en_stock"]
    if not updates:
        return {"ok": True}
    set_clause = ", ".join(f"{k} = %s" for k in updates.keys())
    with get_cursor() as cur:
        cur.execute(f"UPDATE telephones_vente SET {set_clause} WHERE id = %s", list(updates.values()) + [tel_id])
    return {"ok": True}


@router.delete("/telephones-vente/{tel_id}")
def delete_telephone_vente(tel_id: int, user: dict = Depends(get_current_user)):
    with get_cursor() as cur:
        cur.execute("DELETE FROM telephones_vente WHERE id = %s", (tel_id,))
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# PARAMETERIZED ROUTES (/{devis_id}) — must come AFTER static routes
# ══════════════════════════════════════════════════════════════


# ─── GET ONE ───────────────────────────────────────────────

@router.get("/{devis_id}")
def get_devis(devis_id: int, user: dict = Depends(get_current_user)):
    with get_cursor() as cur:
        cur.execute("SELECT * FROM devis WHERE id = %s", (devis_id,))
        devis = cur.fetchone()
        if not devis:
            raise HTTPException(404, "Devis non trouvé")
        cur.execute(
            "SELECT * FROM devis_lignes WHERE devis_id = %s ORDER BY ordre, id", (devis_id,)
        )
        lignes = cur.fetchall()

        # Fetch linked client info if client_id is set
        client_info = None
        if devis.get("client_id"):
            cur.execute(
                "SELECT id, nom, prenom, telephone, email FROM clients WHERE id = %s",
                (devis["client_id"],),
            )
            client_info = cur.fetchone()

    d = dict(devis)
    for key in ("date_creation", "date_maj", "date_acceptation", "date_refus"):
        if d.get(key) and hasattr(d[key], "isoformat"):
            d[key] = d[key].isoformat()
    d["lignes"] = [dict(l) for l in lignes]
    if client_info:
        d["client"] = dict(client_info)
    return d


# ─── UPDATE ────────────────────────────────────────────────

@router.patch("/{devis_id}")
def update_devis(devis_id: int, data: DevisUpdate, user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in data.model_dump(exclude_unset=True).items() if k != "lignes"}

    # Pour le trigger de notification après commit
    notif_event = None  # 'accepte' | 'refuse' | None
    existing_data = None

    with get_cursor() as cur:
        cur.execute("SELECT * FROM devis WHERE id = %s", (devis_id,))
        existing = cur.fetchone()
        if not existing:
            raise HTTPException(404, "Devis non trouvé")
        existing_data = dict(existing)

        # Handle status changes
        if "statut" in updates:
            if updates["statut"] not in STATUTS:
                raise HTTPException(400, f"Statut invalide. Valides: {STATUTS}")
            previous_statut = existing_data.get("statut")
            new_statut = updates["statut"]
            if new_statut == "Accepté":
                updates["date_acceptation"] = datetime.now()
                if previous_statut != "Accepté":
                    notif_event = "accepte"
            elif new_statut == "Refusé":
                updates["date_refus"] = datetime.now()
                if previous_statut != "Refusé":
                    notif_event = "refuse"

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

    # Trigger validation APRÈS le commit : UNIQUEMENT validation positive
    if notif_event == "accepte" and existing_data:
        numero = existing_data.get("numero", f"#{devis_id}")
        total_ttc = existing_data.get("total_ttc") or 0
        related_ticket_id = existing_data.get("ticket_id")
        action_url = f"/accueil/ticket/{related_ticket_id}" if related_ticket_id else None
        # Nom du membre connecté qui a coché "Accepté" dans DevisPage.
        auteur_action = (user or {}).get("sub") or "Staff"

        # 1. Si le devis est lié à un ticket, on crée une note 'validation_devis'
        # → alimente accord_client_valide (point vert dashboard + bannière verte ticket).
        if related_ticket_id:
            try:
                with get_cursor() as cur2:
                    cur2.execute(
                        """
                        INSERT INTO notes_tickets (ticket_id, auteur, contenu, type_note, is_read)
                        VALUES (%s, %s, %s, 'validation_devis', FALSE)
                        """,
                        (
                            related_ticket_id,
                            auteur_action,
                            f"✅ Devis {numero} accepté ({float(total_ttc):.2f} €) — marqué par {auteur_action}",
                        ),
                    )
            except Exception as e:
                print(f"[devis] note validation_devis insert failed: {e}")

        # 2. Notification in-app
        try:
            push_notification(
                type="devis_accepte",
                # Ni nom ni téléphone du client : la notification et son écho dans le chat
                # survivent à l'anonymisation RGPD (seuls le devis et le ticket sont cités)
                title=f"Devis {numero} accepté",
                message=f"{auteur_action} a marqué le devis {numero} comme accepté par le client "
                        f"({float(total_ttc):.2f} €). Vous pouvez démarrer la réparation.",
                important=True,
                icon="✅",
                related_devis_id=devis_id,
                related_ticket_id=related_ticket_id,
                action_url=action_url,
            )
        except Exception as e:
            print(f"[devis] notification trigger failed: {e}")

    return {"ok": True}


# ─── DELETE ────────────────────────────────────────────────

@router.delete("/{devis_id}")
def delete_devis(devis_id: int, user: dict = Depends(get_current_user)):
    with get_cursor() as cur:
        cur.execute("DELETE FROM devis_lignes WHERE devis_id = %s", (devis_id,))
        cur.execute("DELETE FROM devis WHERE id = %s", (devis_id,))
    return {"ok": True}


# ─── CONVERT TO TICKET ────────────────────────────────────

@router.post("/{devis_id}/convert")
def convert_to_ticket(devis_id: int, user: dict = Depends(get_current_user)):
    """Convertit un devis accepté en ticket SAV.
    Idempotent et protégé : un devis déjà converti renvoie son ticket existant,
    et seul un devis 'Accepté' (ou 'Envoyé') peut être converti — empêche les
    doubles tickets (double-clic/retry) et la conversion d'un devis refusé."""
    with get_cursor() as cur:
        cur.execute("SELECT * FROM devis WHERE id = %s FOR UPDATE", (devis_id,))
        devis = cur.fetchone()
        if not devis:
            raise HTTPException(404, "Devis non trouvé")

        # Idempotence : déjà converti → renvoyer le ticket existant
        if devis.get("statut") == "Converti":
            existing_tid = devis.get("ticket_id")
            if existing_tid:
                return {
                    "ok": True,
                    "ticket_id": existing_tid,
                    "ticket_code": f"KP-{existing_tid:06d}",
                    "already_converted": True,
                }
            raise HTTPException(409, "Devis marqué converti sans ticket associé")

        # Garde de statut : seul un devis accepté ou envoyé est convertible
        if devis.get("statut") not in ("Accepté", "Envoyé"):
            raise HTTPException(409, "Seul un devis accepté peut être converti")

        # Client : celui du devis, sinon retrouvé par son téléphone, sinon créé (un devis saisi
        # avec un nom seul se convertit aussi ; le devis est rattaché au client, pour le RGPD)
        client_id = devis.get("client_id")
        if not client_id:
            row = None
            if (devis.get("client_tel") or "").strip():
                from app.api.clients import find_client_by_phone
                row = find_client_by_phone(cur, devis["client_tel"])
            if row:
                client_id = row["id"]
            elif any((devis.get(k) or "").strip() for k in ("client_nom", "client_prenom", "client_tel")):
                cur.execute("""
                    INSERT INTO clients (nom, prenom, telephone, email)
                    VALUES (%s, %s, %s, %s) RETURNING id
                """, ((devis.get("client_nom") or "").strip(), (devis.get("client_prenom") or "").strip(),
                      (devis.get("client_tel") or "").strip(), devis.get("client_email") or None))
                client_id = cur.fetchone()["id"]

        if not client_id:
            raise HTTPException(400, "Impossible de créer le ticket sans client : indiquez au moins son nom")

        cur.execute(
            "SELECT description, quantite, prix_unitaire, total FROM devis_lignes WHERE devis_id = %s ORDER BY ordre, id",
            (devis_id,),
        )
        lignes, reduction = _lignes_ticket(cur.fetchall() or [], devis)
        appareil = _appareil_ticket(cur, devis.get("appareil"))

        # Create ticket
        panne = devis.get("description") or "Réparation (devis)"
        cur.execute("""
            INSERT INTO tickets (client_id, categorie, marque, modele, modele_autre, panne,
                                 devis_estime, reparation_supp, reduction_montant, statut, notes_internes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'En attente de diagnostic', %s)
            RETURNING id
        """, (client_id, appareil["categorie"], appareil["marque"], appareil["modele"], appareil["modele_autre"],
              panne, devis.get("total_ttc", 0),
              json.dumps(lignes, ensure_ascii=False, separators=(",", ":")) if lignes else None,
              reduction, f"Créé depuis devis {devis.get('numero', '')}"))
        ticket_id = cur.fetchone()["id"]
        code = f"KP-{ticket_id:06d}"
        cur.execute("UPDATE tickets SET ticket_code = %s WHERE id = %s", (code, ticket_id))

        # Mark devis as converted
        cur.execute(
            "UPDATE devis SET statut = 'Converti', ticket_id = %s, client_id = %s, date_maj = NOW() WHERE id = %s",
            (ticket_id, client_id, devis_id),
        )

    # Transaction séparée, comme à la création : le lien de suivi se rattrape à la demande
    from app.api.public_documents import jeton_suivi
    try:
        jeton_suivi(ticket_id)
    except Exception as e:
        print(f"[devis] jeton de suivi non créé pour le ticket {ticket_id} : {e}")

    return {"ok": True, "ticket_id": ticket_id, "ticket_code": code}


def _cents(v) -> Decimal:
    try:
        d = Decimal(str(v if v is not None else 0))
    except (InvalidOperation, ValueError):
        return Decimal(0)
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if d.is_finite() else Decimal(0)


def _lignes_ticket(lignes_devis, devis) -> tuple:
    """Lignes du devis (HT) → lignes du ticket (TTC, format de la fiche) et réduction TTC.

    La somme des lignes moins la réduction redonne le total TTC du devis : la remise
    (HT) devient la réduction du ticket ; sans remise, l'écart d'arrondi va sur la
    dernière ligne.
    """
    taux = 1 + _cents(devis.get("tva") if devis.get("tva") is not None else 20) / 100
    lignes = []
    for l in lignes_devis:
        label = " ".join(str(l.get("description") or "").split())
        if not label:
            continue
        qte = l.get("quantite") or 1
        total_ht = l.get("total") if l.get("total") is not None else _cents(l.get("prix_unitaire")) * qte
        if qte > 1:
            label = f"{label} (x{qte})"
        lignes.append({"label": label, "prix": _cents(_cents(total_ht) * taux), "source": "devis"})
    if not lignes:
        return [], 0
    somme = sum((l["prix"] for l in lignes), Decimal(0))
    total_ttc = _cents(devis.get("total_ttc"))
    reduction = Decimal(0)
    if _cents(devis.get("remise")) > 0:
        reduction = max(Decimal(0), somme - total_ttc)
    elif somme != total_ttc and abs(somme - total_ttc) <= Decimal("0.05") * len(lignes):
        lignes[-1]["prix"] += total_ttc - somme
    for l in lignes:
        l["prix"] = float(l["prix"])
    return lignes, float(reduction)


def _appareil_ticket(cur, appareil) -> dict:
    """devis.appareil (texte libre) → catégorie/marque/modèle du catalogue, sinon modele_autre."""
    texte = " ".join(str(appareil or "").split())
    vide = {"categorie": None, "marque": None, "modele": None, "modele_autre": None}
    if not texte:
        return vide
    cur.execute("""
        SELECT categorie, marque, modele FROM catalog_modeles
        WHERE lower(marque || ' ' || modele) = lower(%s) OR lower(modele) = lower(%s)
        ORDER BY (lower(marque || ' ' || modele) = lower(%s)) DESC,
                 (actif IS NOT FALSE) DESC, (categorie = 'Smartphone') DESC, id
        LIMIT 1
    """, (texte, texte, texte))
    row = cur.fetchone()
    if row:
        return {"categorie": row["categorie"], "marque": row["marque"], "modele": row["modele"], "modele_autre": ""}
    # Appareil hors catalogue : « Autre » + texte libre, catégorie de la marque citée en tête si connue
    cur.execute("""
        SELECT categorie FROM catalog_marques
        WHERE lower(marque) = lower(split_part(%s, ' ', 1))
        ORDER BY (categorie = 'Smartphone') DESC, id
        LIMIT 1
    """, (texte,))
    row = cur.fetchone()
    return {"categorie": row["categorie"] if row else "Autre", "marque": "Autre", "modele": "",
            "modele_autre": texte}


# ─── DUPLICATE ─────────────────────────────────────────────

@router.post("/{devis_id}/duplicate")
def duplicate_devis(devis_id: int, user: dict = Depends(get_current_user)):
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


# ─── PRINT DEVIS ───────────────────────────────────────────

@router.get("/{devis_id}/print")
def print_devis(devis_id: int, user: dict = Depends(get_current_user)):
    """Génère un HTML imprimable pour le devis (session staff requise)."""
    from html import escape
    from fastapi.responses import HTMLResponse

    def e(v):
        return "" if v is None else escape(str(v), quote=True)

    with get_cursor() as cur:
        cur.execute("SELECT * FROM devis WHERE id = %s", (devis_id,))
        devis = cur.fetchone()
        if not devis:
            raise HTTPException(404, "Devis non trouvé")
        cur.execute("SELECT * FROM devis_lignes WHERE devis_id = %s ORDER BY ordre", (devis_id,))
        lignes = cur.fetchall()

        # Override client info from clients table if client_id is set
        if devis.get("client_id"):
            cur.execute("SELECT nom, prenom, telephone, email FROM clients WHERE id = %s", (devis["client_id"],))
            c = cur.fetchone()
            if c:
                devis = dict(devis)
                devis["client_nom"] = c["nom"]
                devis["client_prenom"] = c["prenom"]
                devis["client_tel"] = c["telephone"]
                devis["client_email"] = c.get("email")

        # Identité et mentions légales : services/mentions (aucune valeur écrite ici)
        ident = mentions.lire(cur=cur)

    nom_boutique = e(ident["BOUTIQUE_NOM"])
    lignes_emetteur = mentions.lignes_identite(ident)
    if not ident.get("BOUTIQUE_FORME"):
        lignes_emetteur = lignes_emetteur[1:]   # raison sociale = nom déjà en titre
    emetteur = "<br>".join(e(x) for x in lignes_emetteur)
    pied_legal = " · ".join(e(x) for x in (mentions.raison_sociale(ident), *mentions.lignes_legales(ident)))
    garantie = e(mentions.mention_garantie(ident))

    def fp(v):
        try:
            return f"{float(v or 0):,.2f}".replace(",", " ").replace(".", ",")
        except (TypeError, ValueError):
            return "0,00"

    date_creation = devis["date_creation"]
    if hasattr(date_creation, "strftime"):
        date_str = date_creation.strftime("%d/%m/%Y")
    else:
        date_str = str(date_creation)[:10] if date_creation else ""

    lignes_html = ""
    for l in lignes:
        lignes_html += f"""
        <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">{e(l['description'])}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center">{e(l['quantite'])}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">{fp(l['prix_unitaire'])} €</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600">{fp(l['total'])} €</td>
        </tr>"""

    numero = e(devis.get("numero"))
    validite = e(30 if devis.get("validite_jours") is None else devis["validite_jours"])
    client_nom = e(" ".join(str(p) for p in (devis.get("client_prenom"), devis.get("client_nom")) if p))
    client_contact = e(devis.get("client_tel"))
    if devis.get("client_email"):
        client_contact += " — " + e(devis["client_email"])
    appareil_html = f"<div style='margin-top:6px;font-size:12px'><b>Appareil :</b> {e(devis['appareil'])}</div>" if devis.get("appareil") else ""
    description_html = f"<div style='margin-top:4px;font-size:12px;color:#64748b;white-space:pre-wrap'>{e(devis['description'])}</div>" if devis.get("description") else ""
    # total_ht est net de la remise : le sous-total affiché avant elle est la somme des lignes
    sous_total_ht = sum(float(l.get("total") or 0) for l in lignes)
    remise_html = (
        f"<div class='total-row'><span>Remise</span><span>-{fp(devis['remise'])} €</span></div>"
        f"<div class='total-row'><span>Total HT</span><span>{fp(devis['total_ht'])} €</span></div>"
    ) if float(devis.get("remise") or 0) > 0 else ""
    notes_html = f"<div style='margin-top:24px;padding:12px;background:#fffbeb;border-radius:8px;font-size:12px;color:#92400e;white-space:pre-wrap'><b>Notes :</b> {e(devis['notes'])}</div>" if devis.get("notes") else ""

    html = f"""<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'">
<title>Devis {numero}</title>
<style>
    @page {{ size: A4; margin: 15mm; }}
    body {{ font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 13px; color: #1e293b; margin: 0; padding: 20px; overflow-wrap: anywhere; }}
    .header {{ display: flex; justify-content: space-between; gap: 24px; margin-bottom: 30px; }}
    .shop {{ font-size: 12px; color: #64748b; line-height: 1.6; }}
    .shop-name {{ font-size: 20px; font-weight: 800; color: #7c3aed; margin-bottom: 4px; }}
    .devis-info {{ text-align: right; }}
    .devis-num {{ font-size: 18px; font-weight: 700; color: #1e293b; }}
    .client-box {{ background: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 24px; }}
    .client-label {{ font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; margin-bottom: 6px; font-weight: 600; }}
    table {{ width: 100%; border-collapse: collapse; margin-bottom: 24px; }}
    th {{ background: #7c3aed; color: white; padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }}
    th:nth-child(2), th:nth-child(3), th:last-child {{ text-align: center; }}
    th:last-child {{ text-align: right; }}
    .totals {{ margin-left: auto; width: 280px; }}
    .total-row {{ display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }}
    .total-final {{ font-size: 18px; font-weight: 800; color: #7c3aed; border-top: 2px solid #7c3aed; padding-top: 8px; margin-top: 4px; }}
    .footer {{ margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; }}
    .status-badge {{ display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; }}
    @media print {{ body {{ padding: 0; }} * {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }} }}
</style>
</head><body>
<div class="header">
    <div>
        <div class="shop-name">{nom_boutique}</div>
        <div class="shop">{emetteur}</div>
    </div>
    <div class="devis-info">
        <div class="devis-num">{numero}</div>
        <div style="color:#64748b;font-size:12px;margin-top:4px">Date : {e(date_str)}</div>
        <div style="color:#64748b;font-size:12px">Validité : {validite} jours</div>
        <div style="margin-top:8px">
            <span class="status-badge" style="background:#f1f5f9;color:#475569">{e(devis.get('statut'))}</span>
        </div>
    </div>
</div>

<div class="client-box">
    <div class="client-label">Client</div>
    <div style="font-weight:600;font-size:14px">{client_nom}</div>
    <div style="color:#64748b;font-size:12px;margin-top:2px">{client_contact}</div>
    {appareil_html}
    {description_html}
</div>

<table>
    <thead><tr>
        <th>Description</th><th>Qté</th><th>Prix unit. HT</th><th>Total HT</th>
    </tr></thead>
    <tbody>{lignes_html}</tbody>
</table>

<div class="totals">
    <div class="total-row"><span>{"Sous-total HT" if remise_html else "Total HT"}</span><span>{fp(sous_total_ht if remise_html else devis['total_ht'])} €</span></div>
    {remise_html}
    <div class="total-row"><span>TVA ({fp(devis['tva'])}%)</span><span>{fp(float(devis['total_ttc'] or 0) - float(devis['total_ht'] or 0))} €</span></div>
    <div class="total-row total-final"><span>Total TTC</span><span>{fp(devis['total_ttc'])} €</span></div>
</div>

{notes_html}

<div class="footer">
    <p>Devis n° {numero} du {e(date_str)}, valable {validite} jours à compter de sa date d'émission.</p>
    <p>{garantie}</p>
    <p>{pied_legal}</p>
</div>
</body></html>"""

    return HTMLResponse(content=html, headers={
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "Cache-Control": "no-store",
    })
