"""
API CRUD Clients — compatible schéma PostgreSQL existant.
"""

import csv
import hashlib
import io
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import Field
from app.database import get_cursor
from app.models import ClientCreate, ClientUpdate, ClientOut
from app.api.auth import client_ip, get_current_user, get_optional_user, noter_echec, require_admin, verifier_essais
from app.api.public_documents import LimiteurDebit
from app.services import client_ref
from app.services import mentions
from app.services import search as search_engine

router = APIRouter(prefix="/api/clients", tags=["clients"])


# Bornes des champs saisis (borne publique comprise) : un texte démesuré ou une carte
# Camby hors de l'INTEGER donnaient une fiche géante ou une erreur 500 → 422 lisible.
# (À remonter dans models.ClientCreate / ClientUpdate, lot modèles.)
NOM_MAX = 100


# ─── RGPD : information et consentement (dates posées par le serveur) ──
class ClientCreateRgpd(ClientCreate):
    nom: str = Field(..., max_length=NOM_MAX)
    prenom: Optional[str] = Field("", max_length=NOM_MAX)
    societe: Optional[str] = Field("", max_length=NOM_MAX)
    email: Optional[str] = Field("", max_length=254)
    carte_camby: Optional[int] = Field(0, ge=0, le=1)
    rgpd_informe: Optional[bool] = None
    consentement_marketing: Optional[bool] = None


class ClientUpdateRgpd(ClientUpdate):
    nom: Optional[str] = Field(None, max_length=NOM_MAX)
    prenom: Optional[str] = Field(None, max_length=NOM_MAX)
    societe: Optional[str] = Field(None, max_length=NOM_MAX)
    email: Optional[str] = Field(None, max_length=254)
    carte_camby: Optional[int] = Field(None, ge=0, le=1)
    consentement_marketing: Optional[bool] = None


# Création sans session (borne, dépôt en ligne) : 10 fiches / 10 min par IP, quelle que soit
# l'IP (les postes « connus » de la boutique ne sont plus exemptés : la borne y est soumise
# comme les autres), et 120 / h toutes IP confondues.
_LIMITEUR_CREATION = LimiteurDebit(
    limite=10, fenetre=600, limite_globale=120, fenetre_globale=3600,
    message="Trop de fiches créées depuis ce poste : réessayez dans quelques minutes.",
    message_global="Trop de dépôts en ce moment : réessayez dans quelques minutes.",
)
NOM_REQUIS = "Le nom est requis."


class ClientOutRgpd(ClientOut):
    rgpd_informe_le: Optional[datetime] = None
    consentement_marketing: Optional[bool] = False
    consentement_marketing_le: Optional[datetime] = None
    consentement_marketing_retire_le: Optional[datetime] = None
    consentement_marketing_source: Optional[str] = None
    anonymise_le: Optional[datetime] = None


class ClientCreeOut(ClientOutRgpd):
    """Réponse de POST /api/clients : la fiche (personnel) ou la seule référence signée (anonyme)."""
    id: Optional[int] = None
    client_ref: Optional[str] = None


def source_consentement(canal: str) -> str:
    """Preuve de l'accord : canal (comptoir, borne, depot_distance) et version de la politique acceptée."""
    return f"{canal}:politique-{mentions.POLITIQUE_VERSION}"


# Information : date du dernier avis de confidentialité accepté. Consentement : seule
# l'acceptation compte ici (case décochée par défaut : elle ne retire pas un accord
# donné avant) ; le retrait passe par PATCH /api/clients/{id}. Date et source ne
# changent qu'au passage à l'accord. Dans un UPDATE, chaque expression lit
# l'ancienne ligne : l'ordre des colonnes est sans effet.
_SET_CONSENTEMENTS = """
    rgpd_informe_le = CASE WHEN %(informe)s THEN NOW() ELSE rgpd_informe_le END,
    consentement_marketing_le = CASE WHEN %(accord)s AND NOT COALESCE(consentement_marketing, FALSE)
                                     THEN NOW() ELSE consentement_marketing_le END,
    consentement_marketing_source = CASE WHEN %(accord)s AND NOT COALESCE(consentement_marketing, FALSE)
                                         THEN %(source)s ELSE consentement_marketing_source END,
    consentement_marketing = CASE WHEN %(accord)s THEN TRUE ELSE consentement_marketing END"""


def _consentements(data, canal: str, accord_autorise: bool = True) -> dict:
    return {"informe": bool(getattr(data, "rgpd_informe", None)),
            "accord": accord_autorise and bool(getattr(data, "consentement_marketing", None)),
            "source": source_consentement(canal)}


# Numéros de remplissage (« 06 00 00 00 00 », « 06 11 11 11 11 », « 06 12 34 56 78 ») : saisis par un
# client qui ne veut pas donner son numéro, ils retombaient sur une ancienne fiche d'essai « Test Test »
_SUITES_FICTIVES = ("12345678", "23456789", "87654321", "98765432")
TELEPHONE_FICTIF = ("Ce numéro ne semble pas valide. Merci d'indiquer votre vrai numéro : "
                    "il sert uniquement à vous prévenir quand votre appareil est prêt.")


def telephone_fictif(telephone) -> bool:
    """Numéro de remplissage : 6 chiffres identiques d'affilée ou une suite 12345678 dans les 9 derniers."""
    national = re.sub(r"\D", "", str(telephone or ""))[-9:]
    if len(national) < 9:
        return False
    return bool(re.search(r"(\d)\1{5}", national)) or national[-8:] in _SUITES_FICTIVES


def fiche_d_un_autre(fiche: Optional[dict], nom, prenom) -> bool:
    """Fiche trouvée par le numéro mais au nom de quelqu'un d'autre (nom renseigné et différent)."""
    return bool(fiche) and bool((fiche.get("nom") or "").strip()) and not meme_personne(fiche, nom, prenom)


def meme_personne(fiche: dict, nom, prenom) -> bool:
    """Nom (et prénom s'il est connu) saisis identiques à la fiche, accents et casse ignorés.

    Sans session staff, un numéro connu ne suffit pas à engager quelqu'un : l'accord
    marketing d'une fiche existante n'est enregistré que si l'identité saisie concorde.
    """
    nom_fiche = search_engine.normalize_text(fiche.get("nom"))
    if not nom_fiche or nom_fiche != search_engine.normalize_text(nom):
        return False
    prenom_fiche = search_engine.normalize_text(fiche.get("prenom"))
    return not prenom_fiche or prenom_fiche == search_engine.normalize_text(prenom)


def enregistrer_consentements(cur, client_id: int, rgpd_informe=None, consentement_marketing=None,
                              canal: str = "comptoir"):
    """Pose les dates RGPD d'un client existant (borne, dépôt à distance)."""
    if not rgpd_informe and not consentement_marketing:
        return
    cur.execute("UPDATE clients SET" + _SET_CONSENTEMENTS + " WHERE id = %(id)s",
                {"informe": bool(rgpd_informe), "accord": bool(consentement_marketing),
                 "source": source_consentement(canal), "id": client_id})


def find_client_by_phone(cur, telephone):
    """Client existant pour ce numéro, quel que soit le format (06 12…, 0612…, +33 6…).

    Clé indexée sur les 9 derniers chiffres, puis égalité du numéro complet
    (un numéro étranger peut partager ses 9 derniers chiffres). En dessous de
    9 chiffres, seule l'égalité stricte historique s'applique.
    """
    key = search_engine.phone_key(telephone)
    if not key and not str(telephone or "").strip():
        # Numéro vide (client anonymisé, fiche incomplète) : n'identifie personne
        return None
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


@router.get("", response_model=list[ClientOutRgpd])
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
# Toute la base clients en un fichier : élévation admin (comme l'export RGPD unitaire)
# et trace dans admin_audit_log. Les valeurs viennent en partie de la borne publique :
# une cellule qui commence par = + - @ (ou tabulation / retour chariot) serait lue
# comme une formule par Excel → préfixée d'une apostrophe (_cellule_sure).
EXPORT_ENTETES = ["ID", "Nom", "Prénom", "Téléphone", "Email", "Société", "Carte Camby", "Date création", "Nb tickets"]
_DEBUTS_FORMULE = ("=", "+", "-", "@", "\t", "\r")


def _cellule_sure(v):
    """Valeur d'export inoffensive pour un tableur (injection de formules CSV / Excel)."""
    if isinstance(v, str) and v.startswith(_DEBUTS_FORMULE):
        return "'" + v
    return v


def _lignes_export():
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
        rows = cur.fetchall() or []
    return [[_cellule_sure(v) for v in (
        r["id"], r["nom"], r["prenom"], r["telephone"], r["email"], r["societe"],
        r["carte_camby"], str(r["date_creation"] or ""), r["nb_tickets"],
    )] for r in rows]


def _journaliser_export(request: Request, user: dict, action: str, nb: int):
    """Trace admin (compte et nombre de lignes, aucune donnée personnelle). Un échec n'empêche pas l'export."""
    ip_hash = hashlib.sha256(("kp:" + client_ip(request)).encode("utf-8")).hexdigest()[:16]
    try:
        with get_cursor() as cur:
            cur.execute(
                """INSERT INTO admin_audit_log (user_login, user_target, action, target_type, target_id, details, ip_hash)
                   VALUES (%s, %s, %s, 'clients', NULL, %s, %s)""",
                (str(user.get("sub") or "")[:60], str(user.get("target") or "")[:30], action,
                 f"{nb} client(s)", ip_hash),
            )
    except Exception as e:
        print(f"[clients] trace d'export non enregistrée : {type(e).__name__}")


@router.get("/export/csv")
def export_clients_csv(request: Request, user: dict = Depends(require_admin)):
    """Exporte tous les clients en CSV pour Excel français (UTF-8 avec BOM, séparateur « ; »)."""
    lignes = _lignes_export()
    _journaliser_export(request, user, "export_clients_csv", len(lignes))

    output = io.StringIO()
    output.write("\ufeff")
    writer = csv.writer(output, delimiter=";")
    writer.writerow(EXPORT_ENTETES)
    writer.writerows(lignes)
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8")]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=clients_klikphone.csv"},
    )


@router.get("/export/excel")
def export_clients_excel(request: Request, user: dict = Depends(require_admin)):
    """Exporte tous les clients au format Excel (.xlsx) avec nb de tickets (cellules texte, jamais de formule)."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    lignes = _lignes_export()
    _journaliser_export(request, user, "export_clients_excel", len(lignes))

    wb = Workbook()
    ws = wb.active
    ws.title = "Clients"

    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="7C3AED", end_color="7C3AED", fill_type="solid")
    thin_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    for col, h in enumerate(EXPORT_ENTETES, 1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = thin_border

    for i, vals in enumerate(lignes, 2):
        for col, v in enumerate(vals, 1):
            cell = ws.cell(row=i, column=col, value=v)
            if isinstance(v, str):
                # openpyxl lit « =… » comme une formule : le texte reste du texte
                cell.data_type = "s"
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


@router.get("/{client_id}", response_model=ClientOutRgpd)
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


def reference_client(client_id: int, request: Request) -> dict:
    """Réponse de la voie anonyme : la référence signée, jamais l'identifiant nu, et la même
    forme que la fiche soit nouvelle ou existante (rien ne dit qu'un numéro est déjà client)."""
    return {"client_ref": client_ref.signer(client_id, client_ip(request))}


def _cible_numero(telephone) -> str:
    return f"client:{search_engine.phone_key(telephone) or str(telephone or '').strip()}"


@router.post("", response_model=ClientCreeOut, response_model_exclude_unset=True)
def create_or_get_client(data: ClientCreateRgpd, request: Request,
                         user: Optional[dict] = Depends(get_optional_user)):
    """Crée un client ou retourne l'existant si le téléphone existe déjà.

    Sans jeton (borne, dépôt en ligne) : nom non vide exigé (422) ; la fiche d'un client
    existant n'est jamais réécrite, seuls ses nom, prénom et société vides sont complétés ;
    la réponse est {"client_ref": <référence signée, 20 min, liée à l'IP>} — même forme que
    la fiche soit nouvelle ou existante (aucun champ « existant », pas d'identifiant nu, pas
    de fuite du nom ou de l'email d'un numéro connu). POST /api/tickets exige cette référence.
    Un numéro connu saisi avec un autre nom (fiche_d_un_autre) crée une nouvelle fiche et
    compte un échec par (IP, numéro) : l'énumération des numéros de la clientèle se verrouille.
    L'email n'est jamais posé ainsi : connaître un numéro suffirait à recevoir
    les devis, reçus et suivis de ce client. Il se renseigne au comptoir.
    carte_camby n'est modifiée que si elle est fournie. rgpd_informe et
    consentement_marketing posent leurs dates (_SET_CONSENTEMENTS) ; sans jeton,
    l'accord marketing d'une fiche existante exige la même identité (meme_personne).
    Avec session du personnel : la fiche complète (id compris), inchangé.
    """
    fictif = telephone_fictif(data.telephone)
    if not user:
        if fictif:
            raise HTTPException(422, {"code": "telephone_fictif", "message": TELEPHONE_FICTIF})
        if not (data.nom or "").strip():
            raise HTTPException(422, {"code": "nom_requis", "message": NOM_REQUIS})
        _LIMITEUR_CREATION.verifier(client_ip(request))
        verifier_essais(request, _cible_numero(data.telephone))
    camby = data.carte_camby if "carte_camby" in data.model_fields_set and data.carte_camby is not None else None
    champs = data.model_dump(exclude={"rgpd_informe", "consentement_marketing"})
    with get_cursor() as cur:
        # Vérifier si le client existe (numéro normalisé : évite les doublons 06 12… / 0612…).
        # Un numéro de remplissage (comptoir) ne désigne personne : jamais rattaché à une fiche.
        existing = None if fictif else find_client_by_phone(cur, data.telephone)
        # Borne : numéro connu mais au nom de quelqu'un d'autre → nouvelle fiche, jamais le dossier
        # (ni le téléphone, destinataire des SMS) d'une autre personne ; compté comme un échec
        if not user and fiche_d_un_autre(existing, data.nom, data.prenom):
            existing = None
            noter_echec(request, _cible_numero(data.telephone))

        if existing and user:
            # Staff : les valeurs saisies remplacent les anciennes
            cur.execute("""
                UPDATE clients SET
                    nom = COALESCE(NULLIF(%(nom)s, ''), nom),
                    prenom = COALESCE(NULLIF(%(prenom)s, ''), prenom),
                    email = COALESCE(NULLIF(%(email)s, ''), email),
                    societe = COALESCE(NULLIF(%(societe)s, ''), societe),
                    carte_camby = COALESCE(%(camby)s, carte_camby),""" + _SET_CONSENTEMENTS + """
                WHERE id = %(id)s
                RETURNING *
            """, {**champs, **_consentements(data, "comptoir"), "camby": camby, "id": existing["id"]})
            return cur.fetchone()

        if existing:
            # Public : compléter seulement (jamais l'email) ; la carte peut être déclarée, jamais retirée
            cur.execute("""
                UPDATE clients SET
                    nom = CASE WHEN COALESCE(nom, '') = '' THEN NULLIF(%(nom)s, '') ELSE nom END,
                    prenom = CASE WHEN COALESCE(prenom, '') = '' THEN NULLIF(%(prenom)s, '') ELSE prenom END,
                    societe = CASE WHEN COALESCE(societe, '') = '' THEN NULLIF(%(societe)s, '') ELSE societe END,
                    carte_camby = CASE WHEN %(camby)s = 1 THEN 1 ELSE carte_camby END,""" + _SET_CONSENTEMENTS + """
                WHERE id = %(id)s
            """, {**champs, **_consentements(data, "borne", meme_personne(existing, data.nom, data.prenom)),
                  "camby": 1 if camby else 0, "id": existing["id"]})
            return reference_client(existing["id"], request)

        # Créer le client
        accord = bool(data.consentement_marketing)
        cur.execute("""
            INSERT INTO clients (nom, prenom, telephone, email, societe, carte_camby,
                                 rgpd_informe_le, consentement_marketing, consentement_marketing_le,
                                 consentement_marketing_source)
            VALUES (%s, %s, %s, %s, %s, %s,
                    CASE WHEN %s THEN NOW() END, %s, CASE WHEN %s THEN NOW() END, %s)
            RETURNING *
        """, (
            data.nom, data.prenom, data.telephone,
            data.email, data.societe, camby or 0,
            bool(data.rgpd_informe), accord, accord,
            source_consentement("comptoir" if user else "borne") if accord else None,
        ))
        row = cur.fetchone()
    return row if user else reference_client(row["id"], request)


@router.patch("/{client_id}", response_model=dict)
def update_client(
    client_id: int,
    data: ClientUpdateRgpd,
    user: dict = Depends(get_current_user),
):
    """Met à jour un client. consentement_marketing : accord ou retrait, chacun daté (preuve gardée)."""
    updates = {k: v for k, v in data.model_dump(exclude={"consentement_marketing"}).items() if v is not None}
    accord = data.consentement_marketing
    if not updates and accord is None:
        return {"ok": True}

    # Un seul UPDATE : champs saisis et consentement (sans changement d'état, le consentement
    # ne bouge pas ; l'accord passé reste daté après un retrait). Noms : champs du modèle.
    sets = [f"{k} = %({k})s" for k in updates]
    params = {**updates, "_id": client_id}
    if accord is not None:
        chg = "COALESCE(consentement_marketing, FALSE) IS DISTINCT FROM %(_accord)s"
        sets += [
            f"consentement_marketing_le = CASE WHEN {chg} AND %(_accord)s THEN NOW() ELSE consentement_marketing_le END",
            f"consentement_marketing_source = CASE WHEN {chg} AND %(_accord)s THEN %(_source)s"
            " ELSE consentement_marketing_source END",
            f"consentement_marketing_retire_le = CASE WHEN {chg} AND NOT %(_accord)s THEN NOW()"
            " ELSE consentement_marketing_retire_le END",
            f"consentement_marketing = CASE WHEN {chg} THEN %(_accord)s ELSE consentement_marketing END",
        ]
        params.update(_accord=accord, _source=source_consentement("comptoir"))
    with get_cursor() as cur:
        cur.execute(f"UPDATE clients SET {', '.join(sets)} WHERE id = %(_id)s", params)

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


