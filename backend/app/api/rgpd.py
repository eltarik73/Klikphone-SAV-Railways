"""
RGPD : politique de confidentialité publique (générée depuis les paramètres),
export et anonymisation d'un client, rétention (clients inactifs, devis et
demandes de commande sans fiche, codes de déverrouillage des appareils rendus),
ces trois derniers réservés à l'admin. La rétention peut aussi s'appliquer seule,
une fois par jour (demarrer_retention_quotidienne, lancée au démarrage), mais
seulement si un admin l'a activée (RGPD_RETENTION_AUTO = '1') : désactivée par
défaut, premier passage 7 jours après l'activation.

L'anonymisation garde montants, lignes et dates (pièces comptables : 10 ans).
Aucune donnée personnelle dans les journaux : admin_audit_log ne reçoit que des
identifiants et des comptes.
"""

import hashlib
import logging
import os
import threading
import time
from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from app.database import get_cursor
from app.api.auth import client_ip, require_admin
from app.services import mentions
from app.services import params as params_cache

router = APIRouter(tags=["rgpd"])
logger = logging.getLogger(__name__)

_a, _m, _j = mentions.POLITIQUE_VERSION.split("-")
POLITIQUE_MAJ = f"{_j}/{_m}/{_a}"
NOM_ANONYME = "Client anonymisé"
MESSAGE_ANONYME = "[message anonymisé]"
STATUTS_RENDUS = ["Rendu au client", "Clôturé"]
# Jamais exportés : le client connaît son code, le jeton ouvre ses documents
COLONNES_SECRETES = ("pin", "pattern", "suivi_token")
# Notes gardées telles quelles à l'anonymisation : preuves de l'accord sur le devis et de l'encaissement
NOTES_CONSERVEES = ["validation_devis", "caisse"]

# Rétention automatique (anonymisation irréversible) : DÉSACTIVÉE tant que RGPD_RETENTION_AUTO ne
# vaut pas explicitement '1', écrit par un admin (config.py, élévation). Paramètre absent, vide ou
# autre valeur : rien. L'activation date le début à J+RETENTION_AUTO_DELAI_JOURS (noter_activation) :
# l'admin voit l'aperçu avant toute anonymisation. Début et dernier passage : gérés par le serveur.
PARAM_AUTO = "RGPD_RETENTION_AUTO"
PARAM_AUTO_DEBUT = "RGPD_RETENTION_AUTO_DEBUT"
PARAM_AUTO_DERNIERE = "RGPD_RETENTION_DERNIERE"
PARAMS_RETENTION = (PARAM_AUTO, PARAM_AUTO_DEBUT, PARAM_AUTO_DERNIERE)
RETENTION_AUTO_DELAI_JOURS = 7
# Date de début laissée sans activation (coupée hors API, ancienne version qui l'activait
# d'office) : effacée au démarrage, une activation ultérieure repart de J+7 (main._DONNEES_FIXES).
# Texte SQL fixe : clés PARAM_AUTO_DEBUT et PARAM_AUTO écrites en dur (vérifié par tests/test_raccords_fin.py)
SQL_DEBUT_SANS_ACTIVATION = """DELETE FROM params WHERE cle = 'RGPD_RETENTION_AUTO_DEBUT'
    AND NOT EXISTS (SELECT 1 FROM params WHERE cle = 'RGPD_RETENTION_AUTO' AND btrim(valeur) = '1')"""
_VERROU_RETENTION = 731_002_026   # pg_advisory : un seul passage par jour, même à plusieurs workers


# ─── Politique de confidentialité ────────────────────────────────

def _cle_definie(cle: str) -> bool:
    """Le service est configuré (paramètre ou variable d'environnement) ; la valeur n'est jamais lue ailleurs."""
    try:
        valeur = params_cache.get_param(cle, "")
    except Exception:
        valeur = ""
    return bool((valeur or "").strip() or os.environ.get(cle))


def _sous_traitants() -> str:
    lignes = [
        "- Railway : hébergement de l'application ;",
        "- Supabase : hébergement de la base de données ;",
        "- Brevo : envoi des SMS d'avancement ;",
        ("- Resend : envoi des e-mails ;" if _cle_definie("RESEND_API_KEY")
         else "- le fournisseur de messagerie de la boutique : envoi des e-mails ;"),
    ]
    if _cle_definie("ANTHROPIC_API_KEY"):
        lignes.append("- Anthropic : assistant utilisé par l'équipe, qui peut traiter les informations "
                      "d'un ticket à la demande d'un employé ;")
    lignes.append("- Google : uniquement si vous choisissez de publier un avis ;")
    lignes.append("- WhatsApp : uniquement si vous échangez avec nous par ce moyen.")
    return "\n".join(lignes)


def politique(ident: dict = None) -> dict:
    ident = ident or mentions.lire()
    nom = ident["BOUTIQUE_NOM"]
    contact = mentions.contact_rgpd(ident)
    joindre = " ou ".join(x for x in (
        f"par e-mail à {contact}" if contact else "",
        f"en boutique ({ident['BOUTIQUE_ADRESSE']})" if ident.get("BOUTIQUE_ADRESSE") else "en boutique",
    ) if x)
    coordonnees = " · ".join(x for x in (
        f"Tél : {ident['BOUTIQUE_TEL']}" if ident.get("BOUTIQUE_TEL") else "",
        ident.get("BOUTIQUE_EMAIL") or "",
    ) if x)
    responsable = "\n".join(x for x in (
        mentions.raison_sociale(ident), ident.get("BOUTIQUE_ADRESSE"), coordonnees,
        *mentions.lignes_legales(ident),
    ) if x)
    mois = mentions.nombre(ident, "RGPD_RETENTION_MOIS")
    jours = mentions.nombre(ident, "PURGE_CODES_JOURS")
    sections = [
        {"titre": "Responsable du traitement", "texte": (
            f"Les données personnelles recueillies lors du dépôt, du suivi et de la restitution de votre "
            f"appareil sont traitées par :\n{responsable}")},
        {"titre": "Données collectées", "texte": (
            "- Identité et coordonnées : nom, prénom, téléphone, e-mail, société ;\n"
            "- appareil confié : marque, modèle, IMEI ou numéro de série, état constaté à la réception, "
            "panne décrite ;\n"
            "- code ou schéma de déverrouillage, seulement si vous nous le confiez pour tester l'appareil ;\n"
            "- historique des réparations, devis, paiements et points de fidélité ;\n"
            "- vos messages et avis laissés depuis la page de suivi ;\n"
            "- vos demandes de commande passées depuis notre vitrine en ligne.")},
        {"titre": "Caractère obligatoire des données", "texte": (
            "- Nom et numéro de téléphone : indispensables pour enregistrer le dépôt, vous identifier à la "
            "restitution et vous prévenir de l'avancement ; sans eux, nous ne pouvons pas prendre l'appareil "
            "en charge ;\n"
            "- e-mail et société : facultatifs ; sans e-mail, devis et reçus ne vous sont pas envoyés par "
            "e-mail ;\n"
            "- code ou schéma de déverrouillage : facultatif ; sans lui, certains tests (écran tactile, "
            "caméras, Face ID ou Touch ID…) ne peuvent pas être faits avant et après la réparation ;\n"
            "- accord pour les communications commerciales : facultatif ; le refuser est sans conséquence "
            "sur la réparation.\n\n"
            "Aucune décision automatisée ni aucun profilage n'est fondé sur vos données.")},
        {"titre": "Finalités et bases légales", "texte": (
            "- Suivi de votre réparation (réception, diagnostic, devis, messages d'avancement, restitution, "
            "garantie) : exécution du contrat ;\n"
            "- facturation et comptabilité : obligation légale ;\n"
            "- programme de fidélité : exécution du contrat ;\n"
            "- communications commerciales (offres, nouveautés) : votre consentement, que vous pouvez "
            "retirer à tout moment.")},
        {"titre": "Destinataires", "texte": (
            f"Vos données sont réservées à l'équipe de {nom}. Elles ne sont ni vendues ni cédées. "
            f"Nos sous-traitants techniques n'y accèdent que pour rendre leur service :\n{_sous_traitants()}"
            "\n\nLorsqu'un sous-traitant traite des données hors de l'Union européenne, le transfert repose "
            "sur les garanties prévues par le RGPD (décision d'adéquation ou clauses contractuelles types).")},
        {"titre": "Durées de conservation", "texte": (
            f"- Données client et historique des réparations : {mois} mois après le dernier contact "
            "(dépôt, devis, échange), puis anonymisation ;\n"
            f"- devis sans fiche client et demandes de commande : anonymisés {mois} mois après leur "
            "dernière mise à jour ;\n"
            "- factures et pièces comptables : 10 ans (obligation légale) ; après anonymisation, seuls les "
            "montants sont conservés, sans votre identité ;\n"
            f"- codes de déverrouillage : supprimés {jours} jours après la restitution de l'appareil ;\n"
            "- consentement aux communications commerciales : jusqu'à son retrait.")},
        {"titre": "Vos droits", "texte": (
            "Vous disposez des droits d'accès, de rectification, d'effacement, d'opposition, de limitation du "
            "traitement et de portabilité de vos données, ainsi que du droit de retirer votre consentement à "
            f"tout moment. Pour les exercer, contactez-nous {joindre}. Nous vous répondons dans un délai "
            "d'un mois.\n\n"
            "Vous pouvez aussi définir des directives sur la conservation, l'effacement et la communication "
            "de vos données après votre décès (article 85 de la loi Informatique et Libertés).")},
        {"titre": "Réclamation", "texte": (
            "Si vous estimez, après nous avoir contactés, que vos droits ne sont pas respectés, vous pouvez "
            "adresser une réclamation à la CNIL (www.cnil.fr).")},
        {"titre": "Sécurité", "texte": (
            "L'accès aux données est réservé à l'équipe, par code personnel. Les échanges sont chiffrés (HTTPS) "
            "et les liens de suivi envoyés aux clients portent un jeton aléatoire.")},
    ]
    return {"titre": "Politique de confidentialité", "sections": sections, "maj": POLITIQUE_MAJ}


@router.get("/api/public/confidentialite")
def get_confidentialite():
    """Politique de confidentialité (publique), générée depuis l'identité de la boutique."""
    return JSONResponse(politique(), headers={"Cache-Control": "public, max-age=300"})


# ─── Outils ──────────────────────────────────────────────────────

def _json(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, timedelta):
        return v.total_seconds()
    return v


def _lignes(rows) -> list:
    return [{k: _json(v) for k, v in dict(r).items()} for r in rows or []]


def _journaliser(cur, request, user: dict, action: str, client_id, details: str = ""):
    """Trace admin (identifiants et comptes seulement) ; un échec n'annule jamais l'opération.
    `request` absente : tâche automatique, sans adresse IP."""
    ip_hash = hashlib.sha256(("kp:" + client_ip(request)).encode("utf-8")).hexdigest()[:16] if request else ""
    cur.execute("SAVEPOINT kp_audit")
    try:
        cur.execute(
            """INSERT INTO admin_audit_log (user_login, user_target, action, target_type, target_id, details, ip_hash)
               VALUES (%s, %s, %s, 'client', %s, %s, %s)""",
            (str(user.get("sub") or "")[:60], str(user.get("target") or "")[:30], action,
             client_id, details[:500], ip_hash),
        )
        cur.execute("RELEASE SAVEPOINT kp_audit")
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT kp_audit")


def _sous_savepoint(cur, sql: str, params) -> int:
    """Écriture sur une table de module (créée à part) : absente, rien n'est bloqué. Lignes touchées."""
    cur.execute("SAVEPOINT kp_module")
    try:
        cur.execute(sql, params)
        n = cur.rowcount or 0
        cur.execute("RELEASE SAVEPOINT kp_module")
        return n
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT kp_module")
        return 0


def _anonymiser(cur, ids: list) -> tuple:
    """(clients anonymisés, tickets dont les codes ont été effacés).

    Effacés : identité, consentements, codes, IMEI, textes libres (notes, détail de panne
    au-delà du nom de la pièce, messages envoyés ou reçus, fiche de réception). Restent les
    montants, lignes, statuts et dates : la réparation reste comptée, plus personne n'y figure.
    """
    if not ids:
        return [], 0
    cur.execute("""
        UPDATE clients SET nom = %s, prenom = '', telephone = '', email = '', societe = '',
               consentement_marketing = FALSE, consentement_marketing_le = NULL,
               consentement_marketing_retire_le = NULL, consentement_marketing_source = NULL,
               anonymise_le = NOW()
        WHERE id = ANY(%s) AND anonymise_le IS NULL
        RETURNING id
    """, (NOM_ANONYME, ids))
    faits = [r["id"] for r in cur.fetchall() or []]
    if not faits:
        return [], 0
    cur.execute("""
        UPDATE tickets SET pin = '', pattern = ''
        WHERE client_id = ANY(%s) AND (COALESCE(pin, '') <> '' OR COALESCE(pattern, '') <> '')
    """, (faits,))
    codes = cur.rowcount or 0
    # panne_detail = « pièce — notes » : la pièce (libellé des lignes facturées) reste, les notes partent.
    # suivi_token = NULL : plus aucun lien de suivi ni document public ne rouvre le dossier
    # (jamais recréé, cf. public_documents.jeton_suivi et main._rattraper_jetons)
    cur.execute("""
        UPDATE tickets SET imei = NULL, notes_client = NULL, commentaire_client = NULL,
               notes_internes = NULL, attention = NULL, tel_contact = NULL, suivi_token = NULL,
               panne_detail = NULLIF(regexp_replace(COALESCE(panne_detail, ''), '\\s*[—–].*$', ''), '')
        WHERE client_id = ANY(%s)
    """, (faits,))
    cur.execute("""
        UPDATE notes_tickets SET contenu = %s
        WHERE ticket_id IN (SELECT id FROM tickets WHERE client_id = ANY(%s))
          AND NOT (COALESCE(type_note, 'note') = ANY(%s)) AND contenu IS DISTINCT FROM %s
    """, (MESSAGE_ANONYME, faits, NOTES_CONSERVEES, MESSAGE_ANONYME))
    cur.execute("""
        UPDATE historique SET contenu = %s
        WHERE ticket_id IN (SELECT id FROM tickets WHERE client_id = ANY(%s))
          AND type IN ('note_privee', 'note_publique', 'alerte')
    """, (MESSAGE_ANONYME, faits))
    cur.execute("""
        UPDATE ticket_controles SET items = (
            CASE WHEN jsonb_typeof(items -> 'etat') = 'object'
                 THEN jsonb_set(items, '{etat,notes}', '""'::jsonb) ELSE items END
        ) || '{"imei_verifie": null, "accessoires_autre": ""}'::jsonb
        WHERE jsonb_typeof(items) = 'object'
          AND ticket_id IN (SELECT id FROM tickets WHERE client_id = ANY(%s))
    """, (faits,))
    cur.execute("""
        UPDATE devis SET client_nom = %s, client_prenom = '', client_tel = '', client_email = ''
        WHERE client_id = ANY(%s)
    """, (NOM_ANONYME, faits))
    _sous_savepoint(cur, """
        UPDATE attestations SET nom = %s, prenom = '', adresse = '', telephone = '', email = '', imei = ''
        WHERE client_id = ANY(%s)
    """, (NOM_ANONYME, faits))
    _anonymiser_notifications(cur, faits)
    return faits, codes


def _anonymiser_notifications(cur, faits: list) -> None:
    """Centre de notifications et son écho dans le chat équipe (tables de module, créées à part) :
    les notifications liées aux tickets ou devis de ces clients peuvent citer leur nom ou leur
    message ; absentes, rien n'est bloqué."""
    from app.api.notifications_center import anonymiser_notifications
    cur.execute("SELECT id FROM tickets WHERE client_id = ANY(%s)", (faits,))
    tickets = [r["id"] for r in cur.fetchall() or []]
    cur.execute("SELECT id FROM devis WHERE client_id = ANY(%s) OR ticket_id = ANY(%s)", (faits, tickets))
    devis = [r["id"] for r in cur.fetchall() or []]
    cur.execute("SAVEPOINT kp_module")
    try:
        anonymiser_notifications(cur, tickets, devis, MESSAGE_ANONYME)
        cur.execute("RELEASE SAVEPOINT kp_module")
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT kp_module")


# ─── Export et anonymisation d'un client ─────────────────────────

def _optionnel(cur, sql: str, params) -> list:
    """Lecture d'une table de module (créée à part) : absente, liste vide."""
    cur.execute("SAVEPOINT kp_export")
    try:
        cur.execute(sql, params)
        rows = _lignes(cur.fetchall())
        cur.execute("RELEASE SAVEPOINT kp_export")
        return rows
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT kp_export")
        return []


@router.get("/api/rgpd/clients/{client_id}/export")
def export_client(client_id: int, request: Request, user: dict = Depends(require_admin)):
    """Toutes les données d'un client (droit d'accès et portabilité), en JSON."""
    with get_cursor() as cur:
        cur.execute("SELECT * FROM clients WHERE id = %s", (client_id,))
        client = cur.fetchone()
        if not client:
            raise HTTPException(404, "Client non trouvé")
        cur.execute("SELECT * FROM tickets WHERE client_id = %s ORDER BY date_depot, id", (client_id,))
        tickets = []
        for t in _lignes(cur.fetchall()):
            t["code_deverrouillage_conserve"] = bool(t.get("pin") or t.get("pattern"))
            for col in COLONNES_SECRETES:
                t.pop(col, None)
            tickets.append(t)
        cur.execute("""
            SELECT n.ticket_id, n.auteur, n.contenu, n.type_note, n.important, n.date_creation
            FROM notes_tickets n JOIN tickets t ON t.id = n.ticket_id
            WHERE t.client_id = %s ORDER BY n.ticket_id, n.date_creation
        """, (client_id,))
        notes = _lignes(cur.fetchall())
        cur.execute("""
            SELECT h.ticket_id, h.type, h.contenu, h.date_creation
            FROM historique h JOIN tickets t ON t.id = h.ticket_id
            WHERE t.client_id = %s ORDER BY h.ticket_id, h.date_creation
        """, (client_id,))
        historique = _lignes(cur.fetchall())
        cur.execute("""
            SELECT tc.ticket_id, tc.phase, tc.items, tc.complete, tc.date_creation, tc.date_maj
            FROM ticket_controles tc JOIN tickets t ON t.id = tc.ticket_id
            WHERE t.client_id = %s ORDER BY tc.ticket_id, tc.phase
        """, (client_id,))
        receptions = _lignes(cur.fetchall())
        cur.execute("SELECT * FROM fidelite_historique WHERE client_id = %s ORDER BY date_creation, id",
                    (client_id,))
        fidelite = _lignes(cur.fetchall())
        cur.execute("SELECT * FROM devis WHERE client_id = %s ORDER BY date_creation, id", (client_id,))
        devis = _lignes(cur.fetchall())
        cur.execute("""SELECT l.* FROM devis_lignes l JOIN devis d ON d.id = l.devis_id
                       WHERE d.client_id = %s ORDER BY l.devis_id, l.ordre, l.id""", (client_id,))
        devis_lignes = _lignes(cur.fetchall())
        attestations = _optionnel(
            cur, "SELECT * FROM attestations WHERE client_id = %s ORDER BY date_creation, id", (client_id,))
        _journaliser(cur, request, user, "rgpd_export", client_id, f"{len(tickets)} ticket(s)")
    contenu = {
        "export_le": datetime.now().isoformat(timespec="seconds"),
        "client": _lignes([client])[0],
        "tickets": tickets,
        "notes": notes,
        "historique": historique,
        "receptions": receptions,
        "fidelite": fidelite,
        "devis": devis,
        "devis_lignes": devis_lignes,
        "attestations": attestations,
    }
    return JSONResponse(contenu, headers={
        "Cache-Control": "no-store",
        "Content-Disposition": f'attachment; filename="donnees_client_{client_id}.json"',
    })


@router.post("/api/rgpd/clients/{client_id}/anonymiser")
def anonymiser_client(client_id: int, request: Request, user: dict = Depends(require_admin)):
    """Efface l'identité du client (droit à l'effacement) ; montants et réparations conservés."""
    with get_cursor() as cur:
        cur.execute("SELECT id, anonymise_le FROM clients WHERE id = %s FOR UPDATE", (client_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Client non trouvé")
        if row.get("anonymise_le"):
            return {"ok": True, "client_id": client_id, "deja_anonymise": True,
                    "anonymise_le": _json(row["anonymise_le"]), "codes_effaces": 0}
        cur.execute("""
            SELECT COUNT(*) AS n FROM tickets
            WHERE client_id = %s AND NOT (COALESCE(statut, '') = ANY(%s))
        """, (client_id, STATUTS_RENDUS))
        en_cours = (cur.fetchone() or {}).get("n") or 0
        if en_cours:
            raise HTTPException(409, detail={
                "code": "tickets_en_cours",
                "message": f"Ce client a {en_cours} ticket(s) en cours : rendez l'appareil avant d'anonymiser.",
            })
        _faits, codes = _anonymiser(cur, [client_id])
        cur.execute("SELECT anonymise_le FROM clients WHERE id = %s", (client_id,))
        quand = (cur.fetchone() or {}).get("anonymise_le")
        _journaliser(cur, request, user, "rgpd_anonymisation", client_id, f"codes effacés : {codes}")
    return {"ok": True, "client_id": client_id, "deja_anonymise": False,
            "anonymise_le": _json(quand), "codes_effaces": codes}


# ─── Rétention ───────────────────────────────────────────────────

# Dernier contact : création, information RGPD, consentement, ticket (dépôt ou
# mise à jour), devis, fidélité. Jamais un client dont un appareil est en cours.
_SQL_INACTIFS = """
    SELECT c.id FROM clients c
    WHERE c.anonymise_le IS NULL
      AND GREATEST(
            c.date_creation, c.rgpd_informe_le, c.consentement_marketing_le,
            (SELECT MAX(GREATEST(t.date_depot, t.date_maj)) FROM tickets t WHERE t.client_id = c.id),
            (SELECT MAX(GREATEST(d.date_creation, d.date_maj)) FROM devis d WHERE d.client_id = c.id),
            (SELECT MAX(f.date_creation) FROM fidelite_historique f WHERE f.client_id = c.id)
          ) < NOW() - make_interval(months => %(mois)s)
      AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.client_id = c.id
                      AND NOT (COALESCE(t.statut, '') = ANY(%(rendus)s)))
"""

# date_rendu et date_cloture sont du TEXTE ('%Y-%m-%d %H:%M:%S') : comparés comme
# texte quand ils commencent par une date ISO ; sinon date_maj (TIMESTAMP).
_SQL_CODES = """
    FROM tickets t
    WHERE (COALESCE(t.pin, '') <> '' OR COALESCE(t.pattern, '') <> '')
      AND t.statut = ANY(%(rendus)s)
      AND CASE
            WHEN COALESCE(t.date_rendu, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN t.date_rendu < %(seuil)s
            WHEN COALESCE(t.date_cloture, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN t.date_cloture < %(seuil)s
            ELSE t.date_maj < NOW() - make_interval(days => %(jours)s)
          END
"""


# Sans fiche client (devis libre, vitrine, attestation saisie à la main) : date de la ligne
_SQL_DEVIS_SANS_FICHE = """
    FROM devis d
    WHERE d.client_id IS NULL
      AND (COALESCE(d.client_nom, '') NOT IN ('', %(anonyme)s) OR COALESCE(d.client_prenom, '') <> ''
           OR COALESCE(d.client_tel, '') <> '' OR COALESCE(d.client_email, '') <> '')
      AND GREATEST(d.date_creation, d.date_maj) < NOW() - make_interval(months => %(mois)s)
"""
_SQL_DEMANDES = """
    FROM demandes_commandes dc
    WHERE (dc.nom <> %(anonyme)s OR dc.telephone <> '' OR COALESCE(dc.email, '') <> ''
           OR COALESCE(dc.message, '') <> '' OR COALESCE(dc.admin_notes, '') <> '')
      AND GREATEST(dc.date_creation, dc.date_maj) < NOW() - make_interval(months => %(mois)s)
"""
_SQL_ATTESTATIONS = """
    FROM attestations a
    WHERE a.client_id IS NULL AND (a.nom <> %(anonyme)s OR COALESCE(a.telephone, '') <> ''
                                   OR COALESCE(a.email, '') <> '' OR COALESCE(a.adresse, '') <> '')
      AND a.date_creation < NOW() - make_interval(months => %(mois)s)
"""


def _criteres(cur=None) -> dict:
    ident = mentions.lire(cur=cur)
    jours = mentions.nombre(ident, "PURGE_CODES_JOURS")
    return {
        # Jamais plus court que la garantie : un appareil encore garanti garde son client
        "mois": max(mentions.nombre(ident, "RGPD_RETENTION_MOIS"), mentions.nombre(ident, "GARANTIE_MOIS")),
        "jours": jours,
        "seuil": (datetime.now() - timedelta(days=jours)).strftime("%Y-%m-%d %H:%M:%S"),
        "rendus": STATUTS_RENDUS,
        "anonyme": NOM_ANONYME,
    }


def _compter(cur, sql_from: str, p: dict, module: bool = False) -> int:
    if module:
        cur.execute("SAVEPOINT kp_compte")
        try:
            cur.execute("SELECT COUNT(*) AS n " + sql_from, p)
            n = (cur.fetchone() or {}).get("n") or 0
            cur.execute("RELEASE SAVEPOINT kp_compte")
            return n
        except Exception:
            cur.execute("ROLLBACK TO SAVEPOINT kp_compte")
            return 0
    cur.execute("SELECT COUNT(*) AS n " + sql_from, p)
    return (cur.fetchone() or {}).get("n") or 0


def _etat_auto(cur) -> dict:
    """auto : activée explicitement ('1') ; sans paramètre, désactivée. Début seulement si activée."""
    cur.execute("SELECT cle, valeur FROM params WHERE cle = ANY(%s)", (list(PARAMS_RETENTION),))
    v = {r["cle"]: (r["valeur"] or "").strip() for r in cur.fetchall() or []}
    auto = v.get(PARAM_AUTO) == "1"
    return {"auto": auto, "auto_debut": (v.get(PARAM_AUTO_DEBUT) or None) if auto else None,
            "derniere_execution": v.get(PARAM_AUTO_DERNIERE) or None}


def noter_activation(cur, valeur: str, aujourd_hui: date = None):
    """Écriture de RGPD_RETENTION_AUTO (config.py, même transaction, avant l'écriture) : passage
    à '1' → début à aujourd'hui + 7 jours ; déjà '1' → début inchangé ; coupée → début effacé
    (une nouvelle activation repart de J+7)."""
    if valeur != "1":
        cur.execute("DELETE FROM params WHERE cle = %s", (PARAM_AUTO_DEBUT,))
        return
    cur.execute("SELECT valeur FROM params WHERE cle = %s FOR UPDATE", (PARAM_AUTO,))
    row = cur.fetchone()
    if row and (row["valeur"] or "").strip() == "1":
        return
    jour = aujourd_hui or date.today()
    _ecrire(cur, PARAM_AUTO_DEBUT, (jour + timedelta(days=RETENTION_AUTO_DELAI_JOURS)).isoformat())


@router.get("/api/rgpd/retention/apercu")
def apercu_retention(user: dict = Depends(require_admin)):
    """Ce que la rétention ferait maintenant (rien n'est modifié), et l'état de la tâche quotidienne."""
    p = _criteres()
    with get_cursor() as cur:
        clients = _compter(cur, "FROM (" + _SQL_INACTIFS + ") i", p)
        codes = _compter(cur, _SQL_CODES, p)
        devis = _compter(cur, _SQL_DEVIS_SANS_FICHE, p)
        demandes = _compter(cur, _SQL_DEMANDES, p)
        attestations = _compter(cur, _SQL_ATTESTATIONS, p, module=True)
        auto = _etat_auto(cur)
    return {"clients_a_anonymiser": clients, "codes_a_purger": codes,
            "devis_a_anonymiser": devis, "demandes_a_anonymiser": demandes,
            "attestations_a_anonymiser": attestations,
            "retention_mois": p["mois"], "purge_codes_jours": p["jours"], **auto}


def _appliquer(cur, p: dict) -> dict:
    cur.execute("SET LOCAL lock_timeout = '5s'")
    cur.execute(_SQL_INACTIFS + " FOR UPDATE OF c SKIP LOCKED", p)
    ids = [r["id"] for r in cur.fetchall() or []]
    faits, codes_clients = _anonymiser(cur, ids)
    cur.execute("UPDATE tickets t SET pin = '', pattern = '' WHERE t.id IN (SELECT t.id " + _SQL_CODES + ")", p)
    codes = (cur.rowcount or 0) + codes_clients
    cur.execute("""UPDATE devis SET client_nom = %(anonyme)s, client_prenom = '', client_tel = '', client_email = ''
                   WHERE id IN (SELECT d.id """ + _SQL_DEVIS_SANS_FICHE + ")", p)
    devis = cur.rowcount or 0
    cur.execute("""UPDATE demandes_commandes SET nom = %(anonyme)s, telephone = '', email = '', message = '',
                          admin_notes = ''
                   WHERE id IN (SELECT dc.id """ + _SQL_DEMANDES + ")", p)
    demandes = cur.rowcount or 0
    attestations = _sous_savepoint(cur, """
        UPDATE attestations SET nom = %(anonyme)s, prenom = '', adresse = '', telephone = '', email = '', imei = ''
        WHERE id IN (SELECT a.id """ + _SQL_ATTESTATIONS + ")", p)
    return {"clients_anonymises": len(faits), "codes_purges": codes, "devis_anonymises": devis,
            "demandes_anonymisees": demandes, "attestations_anonymisees": attestations,
            "retention_mois": p["mois"], "purge_codes_jours": p["jours"]}


def _resume(r: dict) -> str:
    return (f"clients anonymisés : {r['clients_anonymises']} ; codes purgés : {r['codes_purges']} ; "
            f"devis : {r['devis_anonymises']} ; demandes : {r['demandes_anonymisees']} ; "
            f"attestations : {r['attestations_anonymisees']}")


@router.post("/api/rgpd/retention/appliquer")
def appliquer_retention(request: Request, user: dict = Depends(require_admin)):
    """Anonymise ce qui a dépassé la durée de conservation et efface les codes des appareils rendus."""
    p = _criteres()
    with get_cursor() as cur:
        r = _appliquer(cur, p)
        _journaliser(cur, request, user, "rgpd_retention", None, _resume(r))
    return r


# ─── Rétention automatique (une fois par jour) ───────────────────

def _ecrire(cur, cle: str, valeur: str):
    cur.execute("""INSERT INTO params (cle, valeur) VALUES (%s, %s)
                   ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur""", (cle, valeur))


def retention_automatique(aujourd_hui: date = None):
    """Passage du jour : rien (aucune écriture) tant qu'elle n'est pas activée ('1'), ni si elle
    est déjà faite aujourd'hui, avant sa date de début ou si un autre worker la tient.
    Activée sans date de début (écrite hors API) : début daté à J+7, rien n'est appliqué.
    Renvoie les comptes appliqués, sinon None."""
    jour = aujourd_hui or date.today()
    with get_cursor() as cur:
        cur.execute("SELECT pg_try_advisory_xact_lock(%s) AS ok", (_VERROU_RETENTION,))
        if not (cur.fetchone() or {}).get("ok"):
            return None
        etat = _etat_auto(cur)
        if not etat["auto"] or etat["derniere_execution"] == jour.isoformat():
            return None
        if not etat["auto_debut"]:
            _ecrire(cur, PARAM_AUTO_DEBUT, (jour + timedelta(days=RETENTION_AUTO_DELAI_JOURS)).isoformat())
            resultat = None
        elif jour.isoformat() < etat["auto_debut"]:
            return None
        else:
            resultat = _appliquer(cur, _criteres(cur))
            _ecrire(cur, PARAM_AUTO_DERNIERE, jour.isoformat())
            _journaliser(cur, None, {"sub": "auto"}, "rgpd_retention_auto", None, _resume(resultat))
    params_cache.invalidate()
    return resultat


_tache = {"thread": None}


def _boucle_retention(delai_initial: float, periode: float):
    time.sleep(delai_initial)
    while True:
        try:
            retention_automatique()
        except Exception as e:
            # Type seul : un message d'erreur SQL peut citer des valeurs
            logger.warning("Rétention RGPD automatique : échec (%s)", type(e).__name__)
        time.sleep(periode)


def demarrer_retention_quotidienne(delai_initial: float = 300, periode: float = 3600):
    """Tâche de fond (une par processus) : vérifie chaque heure si le passage du jour est dû ;
    sans activation par un admin (RGPD_RETENTION_AUTO = '1'), chaque vérification ne fait rien.
    KP_RETENTION_AUTO=0 dans l'environnement empêche même la tâche (tests, maintenance)."""
    if os.getenv("KP_RETENTION_AUTO") == "0":
        return
    t = _tache["thread"]
    if t is not None and t.is_alive():
        return
    t = threading.Thread(target=_boucle_retention, args=(delai_initial, periode), daemon=True,
                         name="rgpd_retention")
    _tache["thread"] = t
    t.start()
