"""
API Config — gestion des paramètres boutique (table params).
"""

import json
import os
import re
from datetime import datetime, date, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from app.database import get_cursor
from app.models import ParamUpdate, ParamOut
from app.api.auth import (
    ecrire_admin_password, exiger_elevation, exiger_role_admin, get_current_user, noter_echec, noter_succes,
    require_admin, verifier_essais, verifier_secret,
)
from app.api.catalog import clear_catalog_cache
from app.api import rgpd
from app.services import etagere
from app.services import mentions
from app.services import params as params_cache
from app.services import prix as prix_moteur
from app.services import sms

router = APIRouter(prefix="/api/config", tags=["config"])


# ─── SECRETS ─────────────────────────────────────────────────────
# Jamais renvoyés en clair : « •••• » indique seulement qu'ils sont définis.
MASQUE = "••••"
SECRET_KEYS = frozenset({
    "PIN_ACCUEIL", "PIN_TECH", "ADMIN_PASSWORD", "CAISSE_PASSWORD", "CAISSE_APIKEY",
    "DISCORD_WEBHOOK", "RESEND_API_KEY", "SMTP_PASSWORD", "ANTHROPIC_API_KEY",
    "TOGETHER_API_KEY", "LATE_API_KEY", "GOOGLE_PLACES_API_KEY", "JWT_SECRET",
})
_SECRET_RE = re.compile(
    r"^(PIN_|ADMIN_)|PASSWORD|PASSWD|MOT_?DE_?PASSE|(^|_)MDP($|_)|SECRET|TOKEN|API_?KEY"
    r"|WEBHOOK|PRIVATE|CREDENTIAL|(^|_)KEY$",
    re.IGNORECASE,
)


def est_secret(cle: str) -> bool:
    return bool(cle) and (cle.upper() in SECRET_KEYS or bool(_SECRET_RE.search(cle)))


def _masquer(cle: str, valeur):
    if not est_secret(cle):
        return valeur
    return MASQUE if valeur else ""


def _valeur_masquee(valeur) -> bool:
    """Vide ou « •••• » renvoyé tel quel par le formulaire : ne remplace pas le secret."""
    v = (valeur or "").strip()
    return not v or set(v) <= {"•", "*"}


def _ecrire_param(cur, cle: str, valeur: str):
    if cle == "ADMIN_PASSWORD":
        ecrire_admin_password(cur, valeur)
        return
    cur.execute("""
        INSERT INTO params (cle, valeur) VALUES (%s, %s)
        ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur
    """, (cle, valeur))


def _controler_secret(cle: str, valeur: str):
    if cle.upper().startswith("PIN_") and not re.fullmatch(r"\d{4}", valeur.strip()):
        raise HTTPException(400, "Le PIN doit être composé de 4 chiffres")
    if cle == "ADMIN_PASSWORD" and len(valeur) < 4:
        raise HTTPException(400, "Le mot de passe admin doit faire au moins 4 caractères")


# Réglages non secrets mais engageants (crédits SMS payants) : élévation admin aussi
SENSIBLE_KEYS = frozenset({sms.PARAM_ACTIF, sms.PARAM_EXPEDITEUR})


def _controler_sms(cle: str, valeur: str):
    if cle == sms.PARAM_ACTIF and valeur not in ("0", "1"):
        raise HTTPException(400, "SMS_BREVO_ACTIF vaut 0 ou 1")
    if cle == sms.PARAM_EXPEDITEUR and valeur and not sms.expediteur_valide(valeur):
        raise HTTPException(400, "Expéditeur SMS : 11 lettres ou chiffres maximum, sans espace ni accent")


def _controler_mention(cle: str, valeur: str) -> str:
    try:
        return mentions.valider(cle, valeur)
    except ValueError as e:
        raise HTTPException(400, str(e))


def _controler_retention(cle: str, valeur: str):
    """RGPD_RETENTION_AUTO : '1' active l'anonymisation automatique, '0' la coupe. Date de début
    (activation + 7 jours) et dernier passage : écrits par le serveur seul (rgpd.py)."""
    if cle != rgpd.PARAM_AUTO:
        raise HTTPException(400, f"{cle} : géré par le serveur (activez ou coupez {rgpd.PARAM_AUTO})")
    if valeur not in ("0", "1"):
        raise HTTPException(400, f"{cle} vaut 0 ou 1")


# Étagère (services/etagere) : non secrets ; le délai d'abandon, imprimé dans les conditions
# de dépôt, exige l'élévation admin
ETAGERE_KEYS = frozenset({etagere.PARAM_DELAI_ABANDON, etagere.PARAM_PALIERS, etagere.PARAM_EMPLACEMENTS})
# Jamais moins d'un an (loi du 31/12/1903), comme la page Config et les impressions
DELAI_ABANDON_BORNES = (mentions.ABANDON_JOURS_LEGAL, 3650)
EMPLACEMENTS_MAX = 40


def _controler_etagere(cle: str, valeur: str) -> str:
    """Valeur normalisée : délai « 365 », paliers « 3, 10, 30 », emplacements « A1, B3 » (comme la page Config)."""
    v = (valeur or "").strip()
    if cle == etagere.PARAM_DELAI_ABANDON:
        mini, maxi = DELAI_ABANDON_BORNES
        if not re.fullmatch(r"[0-9]{1,5}", v) or not mini <= int(v) <= maxi:
            raise HTTPException(400, f"Délai d'abandon : nombre entier de jours entre {mini} "
                                     f"(un an, minimum légal) et {maxi}")
        return str(int(v))
    if cle == etagere.PARAM_PALIERS:
        jetons = [j for j in re.split(r"[,;\s]+", v) if j]
        if not all(re.fullmatch(r"[0-9]{1,5}", j) and 0 < int(j) <= DELAI_ABANDON_BORNES[1] for j in jetons):
            raise HTTPException(400, f"Paliers de relance : jours entiers entre 1 et {DELAI_ABANDON_BORNES[1]}, "
                                     "séparés par des virgules")
        paliers = [int(j) for j in jetons]
        if any(a >= b for a, b in zip(paliers, paliers[1:])):
            raise HTTPException(400, "Paliers de relance : jours en ordre croissant, sans doublon (ex. 3,10,30)")
        return ", ".join(str(p) for p in paliers)
    emplacements = []
    for brut in v.split(","):
        try:
            e = etagere.normaliser_emplacement(brut)
        except ValueError as err:
            raise HTTPException(400, str(err))
        if e and e not in emplacements:
            emplacements.append(e)
    if len(emplacements) > EMPLACEMENTS_MAX:
        raise HTTPException(400, f"Emplacements : {EMPLACEMENTS_MAX} au maximum")
    return ", ".join(emplacements)


# Moteur de prix (services/prix, import_prix, veille_prix, telephones) : clés tenues par le
# serveur, jamais écrites par la configuration générique. Les règles de marge ne changent que par
# POST /api/tarifs/appliquer (aperçu, lot annulable, rôle admin et code) ; dates et résumés de
# veille et de synchro, drapeaux de migration, colonnes d'import mémorisées : le serveur seul.
CLES_MOTEUR_PRIX = frozenset({prix_moteur.CLE_REGLES})
PREFIXES_MOTEUR_PRIX = ("IMPORT_MAPPING_", "VEILLE_PRIX_", "LCDPHONE_", "MIGRATION_PRIX_", "MODELES_ALIAS_")
# Cadenas des grilles boutique ({table: [ids]}, ReglesPrixPanel) : écriture de prix, donc rôle
# admin et code, comme les routes /api/tarifs
PARAM_VERROUS_BOUTIQUE = "PRIX_LIGNES_VERROUILLEES"
TABLES_VERROUS_BOUTIQUE = ("tarifs_reparation", "iphone_tarifs", "smartphones_tarifs")
VERROUS_MAX = 2000


def est_cle_moteur_prix(cle: str) -> bool:
    c = (cle or "").strip().upper()
    return c in CLES_MOTEUR_PRIX or c.startswith(PREFIXES_MOTEUR_PRIX)


def _refuser_cle_moteur_prix(cle: str):
    if cle.strip().upper() == prix_moteur.CLE_REGLES:
        raise HTTPException(403, "Règles de prix : modifiez les marges dans Tarifs → Règles de prix "
                                 "(aperçu des prix touchés, puis lot annulable).")
    raise HTTPException(403, f"{cle} : réglage tenu par le serveur (moteur de prix), non modifiable ici.")


def _controler_verrous_boutique(valeur: str) -> str:
    """{"tarifs_reparation": [9, 10], …} normalisé (ids entiers triés, sans doublon) ; vide → {}."""
    v = (valeur or "").strip()
    try:
        brut = json.loads(v) if v else {}
    except ValueError:
        raise HTTPException(400, "Lignes verrouillées : JSON {table: [ids]} attendu")
    if not isinstance(brut, dict) or not set(brut) <= set(TABLES_VERROUS_BOUTIQUE):
        raise HTTPException(400, "Lignes verrouillées : tables " + ", ".join(TABLES_VERROUS_BOUTIQUE) + " uniquement")
    out = {}
    for table, ids in brut.items():
        if not isinstance(ids, list) or len(ids) > VERROUS_MAX or not all(
                isinstance(i, int) and not isinstance(i, bool) and 0 < i < 2 ** 31 for i in ids):
            raise HTTPException(400, f"Lignes verrouillées ({table}) : liste d'identifiants entiers attendue")
        out[table] = sorted(set(ids))
    return json.dumps(out, sort_keys=True)


def _reponse(ecritures: list) -> dict:
    """{"ok": True}, plus « avertissements » si un CGV_DEPOT écrit garde une ancienne clause de
    retrait en 3 mois : enregistré tel quel (texte de l'admin), mais signalé."""
    avertissements = [mentions.AVERTISSEMENT_CGV_ABANDON for cle, valeur in ecritures
                      if cle == "CGV_DEPOT" and mentions.clause_abandon_obsolete(valeur)][:1]
    return {"ok": True, "avertissements": avertissements} if avertissements else {"ok": True}


def _noter_activation_retention(cur, ecritures: list):
    """Avant l'écriture : l'activation de la rétention automatique date son début (J+7)."""
    lot = dict(ecritures)
    if rgpd.PARAM_AUTO in lot:
        rgpd.noter_activation(cur, lot[rgpd.PARAM_AUTO])


_FRANCHISE_TVA = re.compile(r"293\s*B", re.IGNORECASE)


def _controler_coherence(cur, ecritures: list):
    """État final (base + lot), seulement pour les règles que le lot touche : la franchise de
    TVA va avec un taux nul (et l'inverse) ; la conservation n'est jamais plus courte que la
    garantie (un client encore garanti serait anonymisé)."""
    lot = dict(ecritures)
    tva_touchee = bool({"tva", "TVA_MENTION"} & set(lot))
    durees_touchees = bool({"GARANTIE_MOIS", "RGPD_RETENTION_MOIS"} & set(lot))
    if not tva_touchee and not durees_touchees:
        return
    cles = mentions.cles_lues()
    cur.execute("SELECT cle, valeur FROM params WHERE cle = ANY(%s)", (cles,))
    valeurs = {r["cle"]: r["valeur"] for r in cur.fetchall() or []}
    valeurs.update(lot)
    ident = mentions.lire(valeurs)
    if tva_touchee:
        franchise = bool(_FRANCHISE_TVA.search(ident["TVA_MENTION"]))
        taux_nul = mentions.taux_nul(valeurs.get("tva") or "20")
        if franchise and not taux_nul:
            raise HTTPException(400, "TVA : la mention « TVA non applicable, art. 293 B » exige un taux de TVA "
                                     "à 0 %. Corrigez le taux ou la mention.")
        if taux_nul and not ident["TVA_MENTION"]:
            raise HTTPException(400, "TVA à 0 % : indiquez la mention légale "
                                     "(ex. « TVA non applicable, art. 293 B du CGI »).")
    if durees_touchees:
        conservation = mentions.nombre(ident, "RGPD_RETENTION_MOIS")
        garantie = mentions.nombre(ident, "GARANTIE_MOIS")
        if conservation < garantie:
            raise HTTPException(400, f"Conservation des données ({conservation} mois) plus courte que la garantie "
                                     f"({garantie} mois) : un client encore sous garantie serait anonymisé.")


def _avec_anciennes_cles(ecritures: list) -> list:
    """Une clé d'identité canonique (BOUTIQUE_TEL…) réécrit aussi ses anciennes clés, encore
    lues par les notifications, le devis et le dépôt à distance (sauf celles du même lot)."""
    deja = {cle for cle, _ in ecritures}
    return ecritures + [(a, v) for cle, v in ecritures for a in mentions.cles_alias(cle) if a not in deja]


def _ecritures(request: Request, user: dict, params: list) -> list:
    """Paires (clé, valeur) à écrire ; un secret ou un réglage sensible exige l'élévation admin :
    identité légale imprimée et durées RGPD (elles pilotent une anonymisation irréversible) aussi.
    Clés du moteur de prix refusées (403) ; cadenas des grilles boutique : rôle admin et code."""
    ecritures, elevation, role_admin = [], False, False
    for p in params:
        if est_cle_moteur_prix(p.cle):
            _refuser_cle_moteur_prix(p.cle)
        if p.cle == PARAM_VERROUS_BOUTIQUE:
            p = p.model_copy(update={"valeur": _controler_verrous_boutique(p.valeur)})
            role_admin = True
        elif est_secret(p.cle):
            if _valeur_masquee(p.valeur):
                continue
            _controler_secret(p.cle, p.valeur)
            elevation = True
        elif p.cle in SENSIBLE_KEYS:
            p = p.model_copy(update={"valeur": (p.valeur or "").strip()})
            _controler_sms(p.cle, p.valeur)
            elevation = True
        elif p.cle in mentions.CLES:
            p = p.model_copy(update={"valeur": _controler_mention(p.cle, p.valeur)})
            elevation = True
        elif p.cle in rgpd.PARAMS_RETENTION:
            p = p.model_copy(update={"valeur": (p.valeur or "").strip()})
            _controler_retention(p.cle, p.valeur)
            elevation = True
        elif p.cle in ETAGERE_KEYS:
            p = p.model_copy(update={"valeur": _controler_etagere(p.cle, p.valeur)})
            elevation = elevation or p.cle == etagere.PARAM_DELAI_ABANDON
        ecritures.append((p.cle, p.valeur))
    if role_admin:
        exiger_role_admin(request, user)
    if elevation:
        exiger_elevation(request, user)
    return _avec_anciennes_cles(ecritures)


@router.get("", response_model=list[ParamOut])
def list_params(user: dict = Depends(get_current_user)):
    """Liste les paramètres ; les secrets sont masqués."""
    with get_cursor() as cur:
        cur.execute("SELECT cle, valeur FROM params ORDER BY cle")
        rows = cur.fetchall() or []
    return [{"cle": r["cle"], "valeur": _masquer(r["cle"], r["valeur"])} for r in rows]


PUBLIC_KEYS = ("NOM_BOUTIQUE", "TEL_BOUTIQUE", "ADRESSE_BOUTIQUE", "HORAIRES_BOUTIQUE", "URL_SUIVI")


@router.get("/public")
def get_public_params():
    """Paramètres publics (formulaire client, suivi, confidentialité) : anciennes clés
    présentes, puis identité et mentions légales effectives (services/mentions)."""
    valeurs = params_cache.get_params(PUBLIC_KEYS, dict.fromkeys(PUBLIC_KEYS))
    out = {cle: v for cle, v in valeurs.items() if v is not None}
    out.update({cle: v for cle, v in mentions.lire().items() if not est_secret(cle)})
    return out


@router.put("")
def set_param(data: ParamUpdate, request: Request, user: dict = Depends(get_current_user)):
    """Crée ou met à jour un paramètre (secret : élévation admin requise)."""
    ecritures = _ecritures(request, user, [data])
    if ecritures:
        with get_cursor() as cur:
            _controler_coherence(cur, ecritures)
            _noter_activation_retention(cur, ecritures)
            for cle, valeur in ecritures:
                _ecrire_param(cur, cle, valeur)
        params_cache.invalidate()
    return _reponse(ecritures)


@router.put("/batch")
def set_params_batch(
    params: list[ParamUpdate],
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Met à jour plusieurs paramètres en une fois (tout ou rien)."""
    ecritures = _ecritures(request, user, params)
    if ecritures:
        with get_cursor() as cur:
            _controler_coherence(cur, ecritures)
            _noter_activation_retention(cur, ecritures)
            for cle, valeur in ecritures:
                _ecrire_param(cur, cle, valeur)
        params_cache.invalidate()
    return _reponse(ecritures)


class PinChangeRequest(BaseModel):
    target: str  # "accueil" or "tech"
    old_pin: str
    new_pin: str


@router.post("/change-pin")
def change_pin(data: PinChangeRequest, request: Request, user: dict = Depends(require_admin)):
    """Change le PIN d'accès (élévation admin + ancien PIN)."""
    if data.target not in ("accueil", "tech"):
        raise HTTPException(400, "Target invalide")
    if len(data.new_pin) != 4 or not data.new_pin.isdigit():
        raise HTTPException(400, "Le PIN doit être composé de 4 chiffres")

    cible = f"pin:{data.target}"
    verifier_essais(request, cible)
    param_key = f"PIN_{data.target.upper()}"
    with get_cursor() as cur:
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (param_key,))
        row = cur.fetchone()
        if not row or not verifier_secret(data.old_pin, row["valeur"]):
            noter_echec(request, cible)
            # 403 et non 401 : le front déconnecte sur tout 401
            raise HTTPException(403, "Ancien PIN incorrect")
        noter_succes(request, cible)
        cur.execute(
            "UPDATE params SET valeur = %s WHERE cle = %s",
            (data.new_pin, param_key),
        )
    params_cache.invalidate()
    return {"ok": True}


ALLOWED_BACKUP_TABLES = frozenset([
    "clients", "tickets", "params", "membres_equipe", "commandes_pieces",
    "catalog_marques", "catalog_modeles", "historique", "chat_messages",
    "notes_tickets", "autocompletion", "devis", "devis_lignes",
    "telephones_vente", "fidelite_historique",
])

import re as _re_sql
_SAFE_IDENT = _re_sql.compile(r"^[a-z][a-z0-9_]{0,63}$")


def _safe_ident(name: str) -> str:
    """Protection defense-in-depth : meme si `name` sort de la whitelist,
    on valide qu'il correspond a un identifiant SQL strict (lowercase,
    underscore, digits, max 64 chars). Empeche toute injection f-string."""
    if not isinstance(name, str) or not _SAFE_IDENT.match(name):
        raise HTTPException(400, f"Nom de table/colonne invalide: {name!r}")
    return name


@router.get("/backup")
def export_backup(user: dict = Depends(require_admin)):
    """Exporte toute la BDD au format JSON pour backup."""
    tables = {}
    with get_cursor() as cur:
        for table in ALLOWED_BACKUP_TABLES:
            try:
                cur.execute(f"SELECT * FROM {_safe_ident(table)}")
                rows = cur.fetchall()
                def serialize(v):
                    if isinstance(v, (datetime, date)):
                        return v.isoformat()
                    if isinstance(v, Decimal):
                        return float(v)
                    if isinstance(v, timedelta):
                        return v.total_seconds()
                    return v
                tables[table] = [{k: serialize(v) for k, v in row.items()} for row in rows]
            except Exception:
                tables[table] = []

    return JSONResponse(
        content={"backup_date": datetime.now().isoformat(), "tables": tables},
        headers={"Content-Disposition": f"attachment; filename=klikphone_backup_{datetime.now().strftime('%Y%m%d')}.json"},
    )


@router.post("/backup/import")
def import_backup(backup: dict, user: dict = Depends(require_admin)):
    """Importe un backup JSON complet. Remplace toutes les données existantes."""
    tables = backup.get("tables", {})
    if not tables:
        raise HTTPException(400, "Format de backup invalide (pas de clé 'tables')")

    # Ordre d'import : tables parentes d'abord
    import_order = ["params", "membres_equipe", "catalog_marques", "catalog_modeles", "clients", "tickets", "commandes_pieces", "historique", "chat_messages", "notes_tickets", "autocompletion", "devis", "devis_lignes", "telephones_vente", "fidelite_historique"]
    counts = {}

    with get_cursor() as cur:
        # Supprimer dans l'ordre inverse (FK)
        for table in reversed(import_order):
            if table not in ALLOWED_BACKUP_TABLES:
                continue
            if table in tables:
                cur.execute(f"DELETE FROM {_safe_ident(table)}")

        for table in import_order:
            if table not in ALLOWED_BACKUP_TABLES:
                continue
            rows = tables.get(table, [])
            if not rows:
                counts[table] = 0
                continue
            # Whitelist stricte des noms de colonnes via _safe_ident
            cols = [_safe_ident(c.lower()) for c in rows[0].keys() if _SAFE_IDENT.match(c.lower())]
            placeholders = ", ".join(["%s"] * len(cols))
            col_names = ", ".join(cols)
            for row in rows:
                vals = [row.get(c) for c in cols]
                cur.execute(
                    f"INSERT INTO {_safe_ident(table)} ({col_names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING",
                    vals,
                )
            counts[table] = len(rows)

        # Reset sequences
        for table in import_order:
            if table not in ALLOWED_BACKUP_TABLES or table == "params":
                continue
            try:
                safe = _safe_ident(table)
                cur.execute(
                    f"SELECT setval(pg_get_serial_sequence('{safe}', 'id'), COALESCE(MAX(id), 1)) FROM {safe}"
                )
            except Exception:
                pass

    clear_catalog_cache()
    params_cache.invalidate()
    from app.api.chat import invalider_cache_chat
    from app.api.notifications_center import invalider_cache_notifications
    invalider_cache_chat()
    invalider_cache_notifications()
    return {"ok": True, "imported": counts}


@router.post("/test-discord")
def test_discord(user: dict = Depends(get_current_user)):
    """Teste le webhook Discord configuré."""
    from app.services.notifications import test_discord_webhook
    with get_cursor() as cur:
        cur.execute("SELECT valeur FROM params WHERE cle = 'DISCORD_WEBHOOK'")
        row = cur.fetchone()
    webhook_url = row["valeur"] if row else ""
    if not webhook_url:
        raise HTTPException(400, "Webhook Discord non configuré")
    ok, msg = test_discord_webhook(webhook_url)
    if not ok:
        raise HTTPException(500, msg)
    return {"ok": True, "message": msg}


@router.get("/message-templates")
def get_message_templates(user: dict = Depends(get_current_user)):
    """Récupère les templates de messages (depuis params ou défaut)."""
    with get_cursor() as cur:
        cur.execute("SELECT valeur FROM params WHERE cle = 'message_templates'")
        row = cur.fetchone()
    if row and row["valeur"]:
        try:
            return json.loads(row["valeur"])
        except Exception:
            pass
    return []


@router.put("/message-templates")
def save_message_templates(data: dict, user: dict = Depends(get_current_user)):
    """Sauvegarde les templates de messages."""
    templates = data.get("templates", [])
    val = json.dumps(templates, ensure_ascii=False)
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO params (cle, valeur) VALUES ('message_templates', %s)
            ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur
        """, (val,))
    params_cache.invalidate()
    return {"ok": True}


# Valeurs par défaut de la config caisse. Les secrets (mot de passe, clé API)
# NE sont PLUS hardcodés : ils sont lus depuis les variables d'environnement
# Railway (os.getenv). Les valeurs en base (table params) restent prioritaires
# côté get_caisse_config. Définir sur Railway : CAISSE_PASSWORD, CAISSE_APIKEY.
CAISSE_DEFAULTS = {
    "CAISSE_ENABLED": os.getenv("CAISSE_ENABLED", "1"),
    "CAISSE_LOGIN": os.getenv("CAISSE_LOGIN", "klikphone"),
    "CAISSE_PASSWORD": os.getenv("CAISSE_PASSWORD", ""),
    "CAISSE_APIKEY": os.getenv("CAISSE_APIKEY", ""),
    "CAISSE_SHOPID": os.getenv("CAISSE_SHOPID", "38373"),
    "CAISSE_CB_ID": os.getenv("CAISSE_CB_ID", "528273"),
    "CAISSE_ESP_ID": os.getenv("CAISSE_ESP_ID", "528275"),
    "CAISSE_ID": os.getenv("CAISSE_ID", "49343"),
    "CAISSE_USER_ID": os.getenv("CAISSE_USER_ID", "42867"),
}

CAISSE_KEYS = list(CAISSE_DEFAULTS.keys())


@router.get("/caisse")
def get_caisse_config(user: dict = Depends(get_current_user)):
    """Récupère la config caisse enregistreuse (mot de passe et clé API masqués)."""
    with get_cursor() as cur:
        cur.execute(
            "SELECT cle, valeur FROM params WHERE cle = ANY(%s)",
            (CAISSE_KEYS,),
        )
        rows = cur.fetchall()
    existing = {row["cle"]: row["valeur"] for row in rows}
    return {k: _masquer(k, existing.get(k, CAISSE_DEFAULTS.get(k, ""))) for k in CAISSE_KEYS}


@router.put("/caisse")
def save_caisse_config(data: dict, user: dict = Depends(require_admin)):
    """Sauvegarde la config caisse enregistreuse (élévation admin requise)."""
    with get_cursor() as cur:
        for key, value in data.items():
            if key not in CAISSE_KEYS:
                continue
            value = "" if value is None else str(value)
            if est_secret(key) and _valeur_masquee(value):
                continue
            cur.execute("""
                INSERT INTO params (cle, valeur) VALUES (%s, %s)
                ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur
            """, (key, value))
    params_cache.invalidate()
    return {"ok": True}


@router.post("/caisse/test")
def test_caisse_connexion(user: dict = Depends(get_current_user)):
    """Teste la connexion à caisse.enregistreuse.fr."""
    import httpx
    with get_cursor() as cur:
        cur.execute(
            "SELECT cle, valeur FROM params WHERE cle = ANY(%s)",
            (CAISSE_KEYS,),
        )
        rows = cur.fetchall()
    existing = {row["cle"]: row["valeur"] for row in rows}
    shopid = existing.get("CAISSE_SHOPID", CAISSE_DEFAULTS["CAISSE_SHOPID"])
    apikey = existing.get("CAISSE_APIKEY", CAISSE_DEFAULTS["CAISSE_APIKEY"])

    if not shopid or not apikey:
        return {"status": "error", "message": "SHOPID ou APIKEY manquant"}

    try:
        url = f"https://caisse.enregistreuse.fr/workers/webapp.php?idboutique={shopid}&key={apikey}"
        with httpx.Client(timeout=10) as client:
            response = client.get(url)
        if response.status_code == 200:
            return {"status": "ok", "message": "Connexion réussie"}
        else:
            return {"status": "error", "message": f"Erreur HTTP {response.status_code}"}
    except Exception as e:
        # Le message d'erreur httpx peut contenir l'URL, donc la clé API
        return {"status": "error", "message": str(e).replace(apikey, MASQUE)}


@router.get("/{cle}")
def get_param(cle: str, user: dict = Depends(get_current_user)):
    """Récupère un paramètre par clé (secret : masqué)."""
    with get_cursor() as cur:
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (cle,))
        row = cur.fetchone()
    if not row:
        return {"cle": cle, "valeur": None}
    return {"cle": cle, "valeur": _masquer(cle, row["valeur"])}
