"""
Identité de la boutique et mentions légales : une seule source, la table params.

Clés canoniques non secrètes (servies par /api/config/public), remplies une seule
fois depuis les anciennes clés par SQL_MIGRATION (_DONNEES_FIXES de main.py).
Impressions, politique de confidentialité et rétention RGPD passent par lire().
"""

import re
import unicodedata

from app.services import params as params_cache

CLES = (
    "BOUTIQUE_NOM", "BOUTIQUE_FORME", "BOUTIQUE_ADRESSE", "BOUTIQUE_TEL", "BOUTIQUE_EMAIL",
    "BOUTIQUE_SIRET", "BOUTIQUE_RCS", "BOUTIQUE_TVA_INTRA", "TVA_MENTION", "CGV_DEPOT",
    "GARANTIE_MOIS", "RGPD_CONTACT_EMAIL", "RGPD_RETENTION_MOIS", "PURGE_CODES_JOURS",
)

TVA_FRANCHISE = "TVA non applicable, art. 293 B du CGI"

# Version de la politique de confidentialité (preuve du consentement : clients.consentement_marketing_source)
POLITIQUE_VERSION = "2026-10-16"

CGV_DEPOT_DEFAUT = (
    "Nous ne consultons ni n'accédons aux données de votre appareil. Sauvegardez vos "
    "données avant le dépôt : nous ne pouvons être tenus responsables d'une perte de "
    "données ou d'un dysfonctionnement sans lien avec la réparation effectuée."
)

# Valeurs reprises des impressions d'avant la migration (« KLIKPHONE SARL », SIRET
# et n° de TVA écrits en dur) ; SQL_MIGRATION sème les mêmes. Le n° de TVA ne
# vaut que pour ce SIREN : semé seulement si le SIRET retenu commence par lui.
DEFAUTS = {
    "BOUTIQUE_NOM": "KLIKPHONE",
    "BOUTIQUE_FORME": "SARL",
    "BOUTIQUE_ADRESSE": "79 Place Saint-Léger, 73000 Chambéry",
    "BOUTIQUE_TEL": "04 79 60 89 22",
    "BOUTIQUE_EMAIL": "",
    "BOUTIQUE_SIRET": "81396114100013",
    "BOUTIQUE_RCS": "",
    "BOUTIQUE_TVA_INTRA": "FR03813961141",
    "TVA_MENTION": "",
    "CGV_DEPOT": CGV_DEPOT_DEFAUT,
    "GARANTIE_MOIS": "6",
    "RGPD_CONTACT_EMAIL": "",
    "RGPD_RETENTION_MOIS": "36",
    "PURGE_CODES_JOURS": "30",
}
SIREN_DEFAUT = "813961141"

# Anciennes clés, par priorité. Lues tant que la clé canonique manque (base pas
# encore migrée) ; tenues à jour quand la clé canonique est écrite (config.py) :
# notifications, devis et dépôt à distance les lisent encore.
ANCIENNES = {
    "BOUTIQUE_NOM": ("nom_boutique", "NOM_BOUTIQUE"),
    "BOUTIQUE_ADRESSE": ("adresse", "ADRESSE_BOUTIQUE"),
    "BOUTIQUE_TEL": ("telephone", "tel_boutique", "TEL_BOUTIQUE"),
    "BOUTIQUE_EMAIL": ("email", "EMAIL_BOUTIQUE"),
    "BOUTIQUE_SIRET": ("siret", "SIRET", "SIRET_BOUTIQUE"),
    "CGV_DEPOT": ("mentions_legales",),
}

# (minimum, maximum) acceptés à l'écriture ; hors bornes à la lecture : défaut
ENTIERS = {
    "GARANTIE_MOIS": (0, 120),
    "RGPD_RETENTION_MOIS": (1, 240),
    "PURGE_CODES_JOURS": (1, 3650),
}
LONGUEUR_MAX = {"CGV_DEPOT": 4000}
LONGUEUR_MAX_DEFAUT = 300

FLAG_MIGRATION = "MIGRATION_MENTIONS_LEGALES_2026_10"

# Une seule fois (drapeau) ; une clé canonique déjà posée n'est jamais remplacée.
# Valeur : première ancienne clé non vide, sinon le défaut (identique à DEFAUTS,
# vérifié par tests/test_lot5_conformite.py).
SQL_MIGRATION = """
    INSERT INTO params (cle, valeur)
    SELECT v.cle, COALESCE(
        (SELECT btrim(p.valeur) FROM params p
          WHERE p.cle = ANY(v.anciennes) AND btrim(COALESCE(p.valeur, '')) <> ''
          ORDER BY array_position(v.anciennes, p.cle) LIMIT 1),
        v.defaut)
    FROM (VALUES
        ('BOUTIQUE_NOM', ARRAY['nom_boutique', 'NOM_BOUTIQUE'], $kp$KLIKPHONE$kp$),
        ('BOUTIQUE_FORME', ARRAY[]::text[], $kp$SARL$kp$),
        ('BOUTIQUE_ADRESSE', ARRAY['adresse', 'ADRESSE_BOUTIQUE'], $kp$79 Place Saint-Léger, 73000 Chambéry$kp$),
        ('BOUTIQUE_TEL', ARRAY['telephone', 'tel_boutique', 'TEL_BOUTIQUE'], $kp$04 79 60 89 22$kp$),
        ('BOUTIQUE_EMAIL', ARRAY['email', 'EMAIL_BOUTIQUE'], $kp$$kp$),
        ('BOUTIQUE_SIRET', ARRAY['siret', 'SIRET', 'SIRET_BOUTIQUE'], $kp$81396114100013$kp$),
        ('BOUTIQUE_RCS', ARRAY[]::text[], $kp$$kp$),
        ('BOUTIQUE_TVA_INTRA', ARRAY[]::text[],
         CASE WHEN left(regexp_replace(COALESCE(
                  (SELECT valeur FROM params WHERE cle = 'BOUTIQUE_SIRET'),
                  (SELECT btrim(p.valeur) FROM params p
                    WHERE p.cle = ANY(ARRAY['siret', 'SIRET', 'SIRET_BOUTIQUE']) AND btrim(COALESCE(p.valeur, '')) <> ''
                    ORDER BY array_position(ARRAY['siret', 'SIRET', 'SIRET_BOUTIQUE'], p.cle) LIMIT 1),
                  $kp$81396114100013$kp$), '[^0-9]', '', 'g'), 9) = '813961141'
              THEN $kp$FR03813961141$kp$ ELSE $kp$$kp$ END),
        ('TVA_MENTION', ARRAY[]::text[],
         CASE WHEN EXISTS (SELECT 1 FROM params WHERE cle = 'tva'
                           AND replace(btrim(valeur), ',', '.') ~ '^0+([.]0+)?$')
              THEN $kp$TVA non applicable, art. 293 B du CGI$kp$ ELSE $kp$$kp$ END),
        ('CGV_DEPOT', ARRAY['mentions_legales'], $kp$Nous ne consultons ni n'accédons aux données de votre appareil. Sauvegardez vos données avant le dépôt : nous ne pouvons être tenus responsables d'une perte de données ou d'un dysfonctionnement sans lien avec la réparation effectuée.$kp$),
        ('GARANTIE_MOIS', ARRAY[]::text[], $kp$6$kp$),
        ('RGPD_CONTACT_EMAIL', ARRAY[]::text[], $kp$$kp$),
        ('RGPD_RETENTION_MOIS', ARRAY[]::text[], $kp$36$kp$),
        ('PURGE_CODES_JOURS', ARRAY[]::text[], $kp$30$kp$)
    ) AS v(cle, anciennes, defaut)
    WHERE NOT EXISTS (SELECT 1 FROM params WHERE cle = 'MIGRATION_MENTIONS_LEGALES_2026_10')
    ON CONFLICT (cle) DO NOTHING"""

SQL_MIGRATION_FLAG = """INSERT INTO params (cle, valeur) VALUES ('MIGRATION_MENTIONS_LEGALES_2026_10', '1')
    ON CONFLICT (cle) DO NOTHING"""


# ─── Délai d'abandon (loi du 31 décembre 1903) ─────────────────────
# Un appareil confié pour réparation et non retiré ne peut être vendu qu'après un an,
# aux enchères publiques et seulement sur autorisation du juge. Clause imprimée par le
# code (mention_abandon), jamais dans CGV_DEPOT : elle suit ETAGERE_DELAI_ABANDON_JOURS.
ABANDON_JOURS_LEGAL = 365

# Ancienne clause des impressions A4 et PDF (avant le lot 5), contraire à la loi
ANCIENNES_CLAUSES_ABANDON = (
    "Tout matériel non récupéré sous 3 mois sera considéré comme abandonné.",
    "Tout materiel non recupere sous 3 mois sera considere comme abandonne.",
)
FLAG_MIGRATION_ABANDON = "MIGRATION_CGV_ABANDON_2026_10"


def jours_abandon(jours) -> int:
    """Délai imprimé : le paramètre, jamais moins d'un an (minimum de la loi de 1903)."""
    try:
        n = int(str(jours).strip())
    except (TypeError, ValueError):
        return ABANDON_JOURS_LEGAL
    return max(n, ABANDON_JOURS_LEGAL)


def _duree_abandon(jours) -> tuple:
    """(« d'un an », « 1 an ») pour 365 ; « de 2 ans » pour 730 ; sinon « de 400 jours »."""
    n = jours_abandon(jours)
    if n % ABANDON_JOURS_LEGAL == 0:
        ans = n // ABANDON_JOURS_LEGAL
        return ("d'un an", "1 an") if ans == 1 else (f"de {ans} ans", f"{ans} ans")
    return f"de {n} jours", f"{n} jours"


AVERTISSEMENT_CGV_ABANDON = (
    "Conditions de dépôt : votre texte contient encore une clause de retrait en « 3 mois ». La clause "
    "conforme à la loi du 31/12/1903 (un an, vente seulement sur autorisation du juge) est imprimée "
    "automatiquement : retirez l'ancienne, sinon les deux se contredisent sur les impressions."
)
_PHRASES = re.compile(r"[.!?;\n]+")
_TROIS_MOIS = re.compile(r"\b(3|trois)\s*mois\b")
_RETRAIT = re.compile(r"abandonn|non\s+(recuper|retir|reclam)|enchere|propriete")


def clause_abandon_obsolete(texte) -> bool:
    """Texte personnalisé (CGV_DEPOT) qui porte encore une clause « 3 mois … abandonné / récupéré » :
    signalé à l'admin, jamais réécrit (seule la valeur semée l'est, par SQL_MIGRATION_ABANDON)."""
    plat = unicodedata.normalize("NFKD", str(texte or "")).encode("ascii", "ignore").decode().lower()
    return any(_TROIS_MOIS.search(p) and _RETRAIT.search(p) for p in _PHRASES.split(plat))


def mention_abandon(jours=None, courte: bool = False) -> str:
    """Clause de retrait des appareils (texte brut, à échapper par l'appelant).

    Longue (A4, PDF) ; courte pour le papier thermique. `jours` : ETAGERE_DELAI_ABANDON_JOURS.
    """
    long_, court = _duree_abandon(jours)
    if courte:
        return f"Appareil non retiré sous {court} : vente possible sur autorisation du juge (loi du 31/12/1903)."
    return (
        "Tout appareil réparé, ou dont le devis a été refusé, doit être retiré dès notre avis de mise "
        "à disposition. Conformément à la loi du 31 décembre 1903 relative à la vente de certains objets "
        f"abandonnés, un appareil non retiré dans le délai {long_} pourra être vendu aux enchères publiques, "
        "uniquement sur autorisation du juge, le produit de la vente servant à régler les sommes restant dues."
    )


# CGV_DEPOT semé (SQL_MIGRATION) depuis l'ancienne clé mentions_legales qui portait l'ancienne
# clause « 3 mois » : seule cette phrase est retirée (la clause conforme est imprimée par le
# code), et seulement si la valeur est restée celle semée — identique à sa source
# mentions_legales, que l'écriture de CGV_DEPOT (config.py) réécrit aussi. Les deux clés sont
# tenues égales ; plus rien d'autre : valeur vidée → défaut, comme le semis. Une fois (drapeau).
# Texte SQL fixe (aucune f-string) : chaque clause de ANCIENNES_CLAUSES_ABANDON, suivie puis
# précédée d'une espace, puis seule ; défaut = CGV_DEPOT_DEFAUT ; drapeau = FLAG_MIGRATION_ABANDON
# (tous vérifiés par tests/test_raccords_fin.py).
SQL_MIGRATION_ABANDON = """
    UPDATE params p SET valeur = n.valeur
    FROM (
        SELECT COALESCE(NULLIF(btrim(
            replace(replace(replace(replace(replace(replace(c.valeur,
                $kp$Tout matériel non récupéré sous 3 mois sera considéré comme abandonné. $kp$, ''),
                $kp$ Tout matériel non récupéré sous 3 mois sera considéré comme abandonné.$kp$, ''),
                $kp$Tout matériel non récupéré sous 3 mois sera considéré comme abandonné.$kp$, ''),
                $kp$Tout materiel non recupere sous 3 mois sera considere comme abandonne. $kp$, ''),
                $kp$ Tout materiel non recupere sous 3 mois sera considere comme abandonne.$kp$, ''),
                $kp$Tout materiel non recupere sous 3 mois sera considere comme abandonne.$kp$, '')
            ), ''), $kp$Nous ne consultons ni n'accédons aux données de votre appareil. Sauvegardez vos données avant le dépôt : nous ne pouvons être tenus responsables d'une perte de données ou d'un dysfonctionnement sans lien avec la réparation effectuée.$kp$) AS valeur
        FROM params c
        WHERE c.cle = 'CGV_DEPOT'
          AND (strpos(c.valeur, $kp$Tout matériel non récupéré sous 3 mois sera considéré comme abandonné.$kp$) > 0
               OR strpos(c.valeur, $kp$Tout materiel non recupere sous 3 mois sera considere comme abandonne.$kp$) > 0)
          AND btrim(c.valeur) = (SELECT btrim(COALESCE(m.valeur, '')) FROM params m WHERE m.cle = 'mentions_legales')
    ) n
    WHERE p.cle IN ('CGV_DEPOT', 'mentions_legales')
      AND NOT EXISTS (SELECT 1 FROM params WHERE cle = 'MIGRATION_CGV_ABANDON_2026_10')"""

SQL_MIGRATION_ABANDON_FLAG = """INSERT INTO params (cle, valeur) VALUES ('MIGRATION_CGV_ABANDON_2026_10', '1')
    ON CONFLICT (cle) DO NOTHING"""


def taux_nul(tva) -> bool:
    try:
        return float(str(tva).replace(",", ".")) == 0
    except (TypeError, ValueError):
        return False


def chiffres(v) -> str:
    return re.sub(r"[^0-9]", "", str(v or ""))


def _defaut(cle: str, valeurs: dict, deja: dict) -> str:
    if cle == "TVA_MENTION":
        return TVA_FRANCHISE if taux_nul(valeurs.get("tva")) else ""
    if cle == "BOUTIQUE_TVA_INTRA" and not chiffres(deja.get("BOUTIQUE_SIRET")).startswith(SIREN_DEFAUT):
        return ""
    return DEFAUTS[cle]


def cles_lues() -> list:
    return [*CLES, *(a for anc in ANCIENNES.values() for a in anc), "tva"]


def lire(valeurs: dict = None, cur=None) -> dict:
    """Valeurs effectives {clé canonique: texte} : clé posée (même vide), sinon
    ancienne clé non vide, sinon défaut. Nom toujours renseigné, entiers bornés.
    `cur` : curseur de l'appelant (aucune seconde connexion prise au pool)."""
    if valeurs is None:
        cles = cles_lues()
        try:
            valeurs = params_cache.get_params(cles, dict.fromkeys(cles), cur=cur)
        except Exception:
            valeurs = {}
    out = {}
    for cle in CLES:
        v = valeurs.get(cle)
        if v is None:
            v = next((valeurs[a] for a in ANCIENNES.get(cle, ()) if str(valeurs.get(a) or "").strip()), None)
        if v is None:
            v = _defaut(cle, valeurs, out)
        out[cle] = str(v).strip()
    if not out["BOUTIQUE_NOM"]:
        out["BOUTIQUE_NOM"] = DEFAUTS["BOUTIQUE_NOM"]
    for cle in ENTIERS:
        out[cle] = str(nombre(out, cle))
    return out


def nombre(ident: dict, cle: str) -> int:
    mini, maxi = ENTIERS[cle]
    try:
        n = int(str(ident.get(cle, "")).strip())
    except (TypeError, ValueError):
        return int(DEFAUTS[cle])
    return n if mini <= n <= maxi else int(DEFAUTS[cle])


def valider(cle: str, valeur: str) -> str:
    """Valeur normalisée à écrire ; ValueError (message pour l'écran) si refusée."""
    v = (valeur or "").strip()
    if cle in ENTIERS:
        mini, maxi = ENTIERS[cle]
        if not v.isdigit() or not mini <= int(v) <= maxi:
            raise ValueError(f"{cle} : nombre entier entre {mini} et {maxi}")
        return str(int(v))
    maxi = LONGUEUR_MAX.get(cle, LONGUEUR_MAX_DEFAUT)
    if len(v) > maxi:
        raise ValueError(f"{cle} : {maxi} caractères au maximum")
    return v


def contact_rgpd(ident: dict) -> str:
    return ident.get("RGPD_CONTACT_EMAIL") or ident.get("BOUTIQUE_EMAIL") or ""


def raison_sociale(ident: dict) -> str:
    forme = ident.get("BOUTIQUE_FORME")
    return f"{ident['BOUTIQUE_NOM']}, {forme}" if forme else ident["BOUTIQUE_NOM"]


def ligne_rcs(ident: dict) -> str:
    rcs = ident.get("BOUTIQUE_RCS") or ""
    return rcs if not rcs or rcs.upper().startswith("RCS") else f"RCS {rcs}"


def lignes_identite(ident: dict, contact: bool = True) -> list:
    """Identité imprimée (texte brut, à échapper par l'appelant) : raison sociale,
    adresse, contact, SIRET et RCS, TVA intracommunautaire et/ou mention de TVA."""
    lignes = [raison_sociale(ident)]
    if ident.get("BOUTIQUE_ADRESSE"):
        lignes.append(ident["BOUTIQUE_ADRESSE"])
    if contact:
        tel_mail = " · ".join(p for p in (
            f"Tél : {ident['BOUTIQUE_TEL']}" if ident.get("BOUTIQUE_TEL") else "",
            ident.get("BOUTIQUE_EMAIL") or "",
        ) if p)
        if tel_mail:
            lignes.append(tel_mail)
    lignes.extend(lignes_legales(ident))
    return lignes


def lignes_legales(ident: dict) -> list:
    lignes = []
    ids = " · ".join(p for p in (
        f"SIRET : {ident['BOUTIQUE_SIRET']}" if ident.get("BOUTIQUE_SIRET") else "",
        ligne_rcs(ident),
    ) if p)
    if ids:
        lignes.append(ids)
    tva = " · ".join(p for p in (
        f"TVA intracom. : {ident['BOUTIQUE_TVA_INTRA']}" if ident.get("BOUTIQUE_TVA_INTRA") else "",
        ident.get("TVA_MENTION") or "",
    ) if p)
    if tva:
        lignes.append(tva)
    return lignes


GARANTIES_LEGALES = (
    "Sans préjudice des garanties légales de conformité et des vices cachés (art. 1641 du Code civil)."
)


def mention_garantie(ident: dict) -> str:
    """Garantie commerciale : contenu, point de départ, exclusions, rappel des garanties légales."""
    mois = nombre(ident, "GARANTIE_MOIS")
    if not mois:
        return GARANTIES_LEGALES
    return (
        f"Garantie {mois} mois pièces et main-d'œuvre sur la réparation effectuée, à compter de la "
        "restitution, hors casse, oxydation ou intervention d'un tiers. " + GARANTIES_LEGALES
    )


def siren(ident: dict) -> str:
    """SIREN (9 premiers chiffres du SIRET), groupé « 813 961 141 » ; vide si absent."""
    d = chiffres(ident.get("BOUTIQUE_SIRET"))[:9]
    return f"{d[:3]} {d[3:6]} {d[6:]}" if len(d) == 9 else ""


def ville(ident: dict) -> str:
    """Ville de l'adresse (après le code postal) ; vide si introuvable."""
    m = re.search(r"\b\d{5}\s+([^,\n]+)", ident.get("BOUTIQUE_ADRESSE") or "")
    return m.group(1).strip() if m else ""


def url_confidentialite(base: str) -> str:
    return f"{(base or '').rstrip('/')}/confidentialite"


def adresse_courte(url: str) -> str:
    """URL sans schéma ni « www. », pour l'impression."""
    u = (url or "").split("://", 1)[-1]
    return u[4:] if u.startswith("www.") else u


def mention_rgpd_courte(ident: dict, base: str) -> str:
    contact = contact_rgpd(ident) or "en boutique"
    return (
        f"Vos données servent au suivi de votre réparation et à la facturation. "
        f"Accès, rectification, effacement : {contact}. "
        f"Politique de confidentialité : {adresse_courte(url_confidentialite(base))}"
    )


def cles_alias(cle: str) -> tuple:
    """Anciennes clés à tenir à jour quand la clé canonique `cle` est écrite."""
    return ANCIENNES.get(cle, ())
