"""
API Catalogue marques et modèles.
"""

import hashlib
import json
import threading
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from psycopg2.extras import execute_values
from pydantic import BaseModel, Field

from app.database import get_cursor
from app.api.auth import get_current_user
from app.data.catalog_seed import SEED_VERSION

router = APIRouter(prefix="/api/catalog", tags=["catalog"])

CATEGORIES = ["Smartphone", "Tablette", "PC Portable", "Console", "Commande", "Autre"]
NOM_MAX = 80
BULK_MAX = 500
_CACHE_TTL = 300  # secondes
# Revalidation à chaque appel (304 via ETag) : un max-age servirait l'ancien arbre
# depuis le cache HTTP du navigateur juste après un ajout de modèle.
_TREE_CACHE_CONTROL = "no-cache"
_TPL_MODELE = "(%s, %s, %s, %s::smallint, %s::integer)"

# Cache mémoire par catégorie : {categorie: (expire_a, {"tree": dict, "json": bytes, "etag": str})}.
# _cache_gen empêche un chargement commencé avant une écriture d'être mis en cache après.
_cache = {}
_cache_gen = 0
_cache_lock = threading.Lock()
_load_lock = threading.Lock()


def clear_catalog_cache():
    """À appeler après toute écriture dans catalog_marques / catalog_modeles."""
    global _cache_gen
    with _cache_lock:
        _cache.clear()
        _cache_gen += 1


def _norm(value):
    return " ".join((value or "").split())


def _key(value):
    return _norm(value).lower()


def _nom_valide(value, label):
    nom = _norm(value)
    if not nom:
        raise HTTPException(400, f"Nom de {label} vide")
    if nom.lower() == "autre":
        raise HTTPException(400, f"« Autre » n'est pas un nom de {label} valide")
    if len(nom) > NOM_MAX:
        raise HTTPException(400, f"Nom de {label} trop long ({NOM_MAX} caractères max)")
    return nom


def _categorie_valide(value):
    categorie = _norm(value)
    if categorie not in CATEGORIES:
        raise HTTPException(400, "Catégorie inconnue")
    return categorie


def assemble_tree(marques_rows, modeles_rows):
    """Construit [{"marque", "modeles": [{"m", "a"}]}] à partir des lignes SQL.

    modeles_rows doit déjà être trié (annee DESC NULLS LAST, ordre, modele).
    Une marque désactivée masque ses modèles ; un modèle sans ligne marque
    fait apparaître sa marque (ordre 100).
    """
    entrees, inactives = {}, set()
    for r in marques_rows:
        cle = _key(r["marque"])
        if r["actif"] is False:
            inactives.add(cle)
        elif cle not in entrees:
            ordre = r["ordre"] if r["ordre"] is not None else 100
            entrees[cle] = {"marque": r["marque"], "ordre": ordre, "modeles": [], "vus": set()}
    inactives -= entrees.keys()

    for r in modeles_rows:
        cle = _key(r["marque"])
        if cle in inactives:
            continue
        entree = entrees.get(cle)
        if entree is None:
            entree = {"marque": _norm(r["marque"]), "ordre": 100, "modeles": [], "vus": set()}
            entrees[cle] = entree
        cle_modele = _key(r["modele"])
        if cle_modele in entree["vus"]:
            continue
        entree["vus"].add(cle_modele)
        entree["modeles"].append({"m": r["modele"], "a": r["annee"]})

    ordonnees = sorted(entrees.values(), key=lambda e: (e["ordre"], e["marque"].lower()))
    return [{"marque": e["marque"], "modeles": e["modeles"]} for e in ordonnees]


def _entree(tree):
    contenu = json.dumps(tree, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    etag = '"' + hashlib.sha1(contenu).hexdigest()[:20] + '"'
    return {"tree": tree, "json": contenu, "etag": etag}


def _load_tree(categorie):
    with get_cursor() as cur:
        cur.execute("""
            SELECT marque, ordre, actif FROM catalog_marques
            WHERE categorie = %s AND lower(btrim(marque)) <> 'autre'
            ORDER BY id
        """, (categorie,))
        marques = cur.fetchall()
        cur.execute("""
            SELECT marque, modele, annee FROM catalog_modeles
            WHERE categorie = %s AND actif IS NOT FALSE
              AND lower(btrim(marque)) <> 'autre' AND lower(btrim(modele)) <> 'autre'
            ORDER BY annee DESC NULLS LAST, ordre, modele
        """, (categorie,))
        modeles = cur.fetchall()
    return _entree({"version": SEED_VERSION, "marques": assemble_tree(marques, modeles)})


# Catégorie inconnue : réponse vide sans requête (routes publiques, pool DB limité)
_ENTREE_VIDE = _entree({"version": SEED_VERSION, "marques": []})


def _cache_lookup(categorie):
    with _cache_lock:
        hit = _cache.get(categorie)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    return None


def _get_entry(categorie):
    if categorie not in CATEGORIES:
        return _ENTREE_VIDE
    entry = _cache_lookup(categorie)
    if entry is not None:
        return entry
    # Un seul chargement à la fois : les requêtes concurrentes réutilisent son résultat
    with _load_lock:
        entry = _cache_lookup(categorie)
        if entry is not None:
            return entry
        with _cache_lock:
            gen = _cache_gen
        entry = _load_tree(categorie)
        with _cache_lock:
            if gen == _cache_gen:
                _cache[categorie] = (time.monotonic() + _CACHE_TTL, entry)
    return entry


@router.get("/categories")
def get_categories():
    """Liste les catégories disponibles."""
    return list(CATEGORIES)


@router.get("/pannes")
def get_pannes():
    """Liste les pannes (symptômes) proposées au client."""
    from app.services.prestations import PANNES_CATALOGUE
    return list(PANNES_CATALOGUE)


@router.get("/prestations")
def get_prestations():
    """Table symptôme → prestation (libellés des lignes facturées), source unique du front."""
    from app.services.prestations import catalogue_prestations
    return Response(
        content=json.dumps(catalogue_prestations(), ensure_ascii=False),
        media_type="application/json",
        headers={"Cache-Control": f"public, max-age={_CACHE_TTL}"},
    )


def _etag_correspond(if_none_match, etag):
    if not if_none_match:
        return False
    # Un proxy (gzip) peut affaiblir l'ETag en W/"..."
    for valeur in if_none_match.split(","):
        valeur = valeur.strip()
        if valeur[:2] == "W/":
            valeur = valeur[2:]
        if valeur in ("*", etag):
            return True
    return False


@router.get("/tree")
def get_tree(request: Request, categorie: str = Query(..., max_length=50)):
    """Marques actives d'une catégorie et leurs modèles (du plus récent au plus ancien)."""
    entry = _get_entry(categorie)
    headers = {"Cache-Control": _TREE_CACHE_CONTROL, "ETag": entry["etag"]}
    if _etag_correspond(request.headers.get("if-none-match"), entry["etag"]):
        return Response(status_code=304, headers=headers)
    return Response(content=entry["json"], media_type="application/json", headers=headers)


@router.get("/marques")
def get_marques(categorie: str = Query(..., max_length=50)):
    """Liste les marques actives d'une catégorie (ordre d'affichage puis nom)."""
    return [e["marque"] for e in _get_entry(categorie)["tree"]["marques"]]


@router.get("/modeles")
def get_modeles(categorie: str = Query(..., max_length=50), marque: str = Query(..., max_length=100)):
    """Liste les modèles actifs d'une marque, du plus récent au plus ancien."""
    cle = _key(marque)
    for entree in _get_entry(categorie)["tree"]["marques"]:
        if _key(entree["marque"]) == cle:
            return [m["m"] for m in entree["modeles"]]
    return []


def _assurer_marque(cur, categorie, marque):
    """Crée la marque si absente, la réactive si supprimée. Retourne son nom en base."""
    cur.execute(
        "SELECT id, marque, actif FROM catalog_marques "
        "WHERE categorie = %s AND lower(marque) = lower(%s) ORDER BY id LIMIT 1",
        (categorie, marque),
    )
    row = cur.fetchone()
    if row is None:
        cur.execute(
            "INSERT INTO catalog_marques (categorie, marque) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (categorie, marque),
        )
        return marque
    if row["actif"] is False:
        cur.execute("UPDATE catalog_marques SET actif = TRUE WHERE id = %s", (row["id"],))
    return row["marque"]


@router.post("/marques")
def add_marque(
    categorie: str = Query(...),
    marque: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Ajoute une marque au catalogue (ou la réactive si elle avait été supprimée)."""
    categorie = _categorie_valide(categorie)
    marque = _nom_valide(marque, "marque")
    with get_cursor() as cur:
        _assurer_marque(cur, categorie, marque)
    clear_catalog_cache()
    return {"ok": True}


@router.post("/modeles")
def add_modele(
    categorie: str = Query(...),
    marque: str = Query(...),
    modele: str = Query(...),
    annee: Optional[int] = Query(None, ge=1990, le=2100),
    user: dict = Depends(get_current_user),
):
    """Ajoute un modèle au catalogue (ou le réactive s'il avait été supprimé).

    Sans année, le modèle est classé après ceux datés (comme /modeles/bulk)."""
    categorie = _categorie_valide(categorie)
    marque = _nom_valide(marque, "marque")
    modele = _nom_valide(modele, "modèle")
    with get_cursor() as cur:
        marque = _assurer_marque(cur, categorie, marque)
        cur.execute(
            "UPDATE catalog_modeles SET actif = TRUE "
            "WHERE categorie = %s AND lower(marque) = lower(%s) AND lower(modele) = lower(%s)",
            (categorie, marque, modele),
        )
        if cur.rowcount == 0:
            cur.execute(
                "INSERT INTO catalog_modeles (categorie, marque, modele, annee, source) "
                "VALUES (%s, %s, %s, %s, 'manuel') ON CONFLICT DO NOTHING",
                (categorie, marque, modele, annee),
            )
    clear_catalog_cache()
    return {"ok": True}


class ModelesBulk(BaseModel):
    categorie: str = Field(..., max_length=50)
    marque: str = Field(..., max_length=200)
    annee: Optional[int] = Field(None, ge=1990, le=2100)
    modeles: List[str] = Field(..., max_length=BULK_MAX)


@router.post("/modeles/bulk")
def add_modeles_bulk(data: ModelesBulk, user: dict = Depends(get_current_user)):
    """Ajoute une liste de modèles (ordre de la liste conservé). Les lignes vides,
    « Autre » et les doublons sont ignorés ; les modèles supprimés sont réactivés."""
    categorie = _categorie_valide(data.categorie)
    marque = _nom_valide(data.marque, "marque")
    noms, vus = [], set()
    for brut in data.modeles:
        nom = _norm(brut)
        if not nom or nom.lower() == "autre" or nom.lower() in vus:
            continue
        if len(nom) > NOM_MAX:
            raise HTTPException(400, f"Nom de modèle trop long ({NOM_MAX} caractères max) : {nom[:40]}…")
        vus.add(nom.lower())
        noms.append(nom)
    if not noms:
        return {"ok": True, "ajoutes": 0, "reactives": 0}

    with get_cursor() as cur:
        marque = _assurer_marque(cur, categorie, marque)
        lignes = [(categorie, marque, nom, data.annee, (i + 1) * 10) for i, nom in enumerate(noms)]
        reactives = execute_values(cur, """
            UPDATE catalog_modeles mo SET actif = TRUE
            FROM (VALUES %s) AS v(categorie, marque, modele, annee, ordre)
            WHERE mo.categorie = v.categorie
              AND lower(mo.marque) = lower(v.marque)
              AND lower(mo.modele) = lower(v.modele)
              AND mo.actif IS FALSE
            RETURNING mo.id
        """, lignes, template=_TPL_MODELE, page_size=BULK_MAX, fetch=True)
        ajoutes = execute_values(cur, """
            INSERT INTO catalog_modeles (categorie, marque, modele, annee, ordre, source)
            SELECT v.categorie, v.marque, v.modele, v.annee, v.ordre, 'import'
            FROM (VALUES %s) AS v(categorie, marque, modele, annee, ordre)
            WHERE NOT EXISTS (
                SELECT 1 FROM catalog_modeles mo
                WHERE mo.categorie = v.categorie
                  AND lower(mo.marque) = lower(v.marque)
                  AND lower(mo.modele) = lower(v.modele)
            )
            ON CONFLICT DO NOTHING
            RETURNING id
        """, lignes, template=_TPL_MODELE, page_size=BULK_MAX, fetch=True)
    clear_catalog_cache()
    return {"ok": True, "ajoutes": len(ajoutes), "reactives": len(reactives)}


@router.delete("/marques")
def delete_marque(
    categorie: str = Query(...),
    marque: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Désactive une marque : elle et ses modèles disparaissent des listes."""
    marque = _norm(marque)
    with get_cursor() as cur:
        cur.execute(
            "UPDATE catalog_marques SET actif = FALSE WHERE categorie = %s AND lower(marque) = lower(%s)",
            (categorie, marque),
        )
        if cur.rowcount == 0:
            # Modèles sans ligne marque : on crée la marque déjà désactivée pour les masquer
            cur.execute("""
                INSERT INTO catalog_marques (categorie, marque, actif)
                SELECT %s, %s, FALSE
                WHERE EXISTS (
                    SELECT 1 FROM catalog_modeles
                    WHERE categorie = %s AND lower(marque) = lower(%s)
                )
                ON CONFLICT DO NOTHING
            """, (categorie, marque, categorie, marque))
    clear_catalog_cache()
    return {"ok": True}


@router.delete("/modeles")
def delete_modele(
    categorie: str = Query(...),
    marque: str = Query(...),
    modele: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Désactive un modèle du catalogue."""
    with get_cursor() as cur:
        cur.execute(
            "UPDATE catalog_modeles SET actif = FALSE "
            "WHERE categorie = %s AND lower(marque) = lower(%s) AND lower(modele) = lower(%s)",
            (categorie, _norm(marque), _norm(modele)),
        )
    clear_catalog_cache()
    return {"ok": True}


@router.get("/all")
def get_all_catalog(
    inclure_inactifs: bool = Query(False),
    user: dict = Depends(get_current_user),
):
    """Retourne tout le catalogue (marques + modèles) pour la page config.

    Par défaut sans les éléments supprimés ; inclure_inactifs=true les ajoute (champ actif)."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT categorie, marque, ordre, COALESCE(actif, TRUE) AS actif
            FROM catalog_marques
            WHERE lower(btrim(marque)) <> 'autre'
              AND (%s OR actif IS NOT FALSE)
            ORDER BY categorie, ordre, marque
        """, (inclure_inactifs,))
        marques = cur.fetchall()
        cur.execute("""
            SELECT mo.categorie, COALESCE(ma.marque, mo.marque) AS marque, mo.modele,
                   mo.annee, mo.ordre, COALESCE(mo.actif, TRUE) AS actif
            FROM catalog_modeles mo
            LEFT JOIN catalog_marques ma
              ON ma.categorie = mo.categorie AND lower(ma.marque) = lower(mo.marque)
            WHERE lower(btrim(mo.modele)) <> 'autre' AND lower(btrim(mo.marque)) <> 'autre'
              AND (%s OR (mo.actif IS NOT FALSE AND ma.actif IS NOT FALSE))
            ORDER BY mo.categorie, lower(COALESCE(ma.marque, mo.marque)),
                     mo.annee DESC NULLS LAST, mo.ordre, mo.modele
        """, (inclure_inactifs,))
        modeles = cur.fetchall()
    return {"marques": marques, "modeles": modeles}
