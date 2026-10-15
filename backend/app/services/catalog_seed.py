"""
Seed versionné du catalogue marques / modèles (données : app/data/catalog_seed.py).

Au boot normal : un SELECT sur params et un sur pg_indexes. Le seed n'est rejoué
que si son contenu a changé, sous verrou consultatif (plusieurs instances au démarrage).
"""

import hashlib

from psycopg2.extras import execute_values

from app.data import catalog_seed as seed_data
from app.database import get_cursor

PARAM_KEY = "catalog_seed_version"

_TPL_MARQUE = "(%s, %s, %s::integer)"
_TPL_MODELE = "(%s, %s, %s, %s::smallint, %s::integer)"

_UNIQUE_INDEXES = (
    ("uq_catalog_modeles_ci",
     "CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_modeles_ci "
     "ON catalog_modeles (categorie, lower(marque), lower(modele))"),
    ("uq_catalog_marques_ci",
     "CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_marques_ci "
     "ON catalog_marques (categorie, lower(marque))"),
)


def _norm(value):
    return " ".join(str(value).split())


def seed_marker():
    """Valeur stockée dans params : SEED_VERSION + empreinte du contenu, pour
    qu'une modification des données sans bump de version soit quand même appliquée."""
    contenu = repr((seed_data.MARQUES, list(seed_data.rows()), seed_data.RENAMES))
    empreinte = hashlib.sha1(contenu.encode("utf-8")).hexdigest()[:12]
    return f"{seed_data.SEED_VERSION}#{empreinte}"


def prepare_seed():
    """Normalise les espaces et écarte les doublons insensibles à la casse et les « Autre »."""
    marques, vus = [], set()
    for categorie, marque, ordre in seed_data.MARQUES:
        marque = _norm(marque)
        cle = (categorie, marque.lower())
        if not marque or marque.lower() == "autre" or cle in vus:
            continue
        vus.add(cle)
        marques.append((categorie, marque, int(ordre)))

    modeles, vus = [], set()
    for categorie, marque, modele, annee, ordre in seed_data.rows():
        marque, modele = _norm(marque), _norm(modele)
        cle = (categorie, marque.lower(), modele.lower())
        if not modele or modele.lower() == "autre" or cle in vus:
            continue
        vus.add(cle)
        modeles.append((categorie, marque, modele, annee, ordre))

    renames = [
        (categorie, _norm(marque), _norm(ancien), _norm(nouveau))
        for categorie, marque, ancien, nouveau in seed_data.RENAMES
    ]
    return marques, modeles, renames


def _nettoyer(cur):
    # « Autre » n'est jamais une marque ni un modèle : le front l'ajoute lui-même
    cur.execute("""
        DELETE FROM catalog_modeles
        WHERE lower(btrim(modele)) = 'autre' OR lower(btrim(marque)) = 'autre'
    """)
    cur.execute("DELETE FROM catalog_marques WHERE lower(btrim(marque)) = 'autre'")

    # Doublons (casse / espaces) : on garde la ligne la plus ancienne. À faire
    # AVANT la normalisation des espaces, sinon UNIQUE(categorie, marque, modele) casse.
    cur.execute(r"""
        DELETE FROM catalog_modeles mo
        USING (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY categorie,
                             lower(btrim(regexp_replace(marque, '\s+', ' ', 'g'))),
                             lower(btrim(regexp_replace(modele, '\s+', ' ', 'g')))
                ORDER BY id
            ) AS rang
            FROM catalog_modeles
        ) d
        WHERE mo.id = d.id AND d.rang > 1
    """)
    cur.execute(r"""
        DELETE FROM catalog_marques ma
        USING (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY categorie,
                             lower(btrim(regexp_replace(marque, '\s+', ' ', 'g')))
                ORDER BY id
            ) AS rang
            FROM catalog_marques
        ) d
        WHERE ma.id = d.id AND d.rang > 1
    """)

    cur.execute(r"""
        UPDATE catalog_modeles
        SET marque = btrim(regexp_replace(marque, '\s+', ' ', 'g')),
            modele = btrim(regexp_replace(modele, '\s+', ' ', 'g'))
        WHERE marque <> btrim(regexp_replace(marque, '\s+', ' ', 'g'))
           OR modele <> btrim(regexp_replace(modele, '\s+', ' ', 'g'))
    """)
    cur.execute(r"""
        UPDATE catalog_marques
        SET marque = btrim(regexp_replace(marque, '\s+', ' ', 'g'))
        WHERE marque <> btrim(regexp_replace(marque, '\s+', ' ', 'g'))
    """)
    cur.execute("DELETE FROM catalog_modeles WHERE modele = '' OR marque = ''")
    cur.execute("DELETE FROM catalog_marques WHERE marque = ''")


def _appliquer_marques(cur, marques):
    # Insère seulement les marques absentes : une marque désactivée (actif=FALSE)
    # reste désactivée.
    execute_values(cur, """
        INSERT INTO catalog_marques (categorie, marque, ordre)
        SELECT v.categorie, v.marque, v.ordre
        FROM (VALUES %s) AS v(categorie, marque, ordre)
        WHERE NOT EXISTS (
            SELECT 1 FROM catalog_marques ma
            WHERE ma.categorie = v.categorie AND lower(ma.marque) = lower(v.marque)
        )
        ON CONFLICT DO NOTHING
    """, marques, template=_TPL_MARQUE, page_size=1000)
    execute_values(cur, """
        UPDATE catalog_marques ma
        SET marque = v.marque, ordre = v.ordre
        FROM (VALUES %s) AS v(categorie, marque, ordre)
        WHERE ma.categorie = v.categorie AND lower(ma.marque) = lower(v.marque)
          AND (ma.marque, ma.ordre) IS DISTINCT FROM (v.marque, v.ordre)
    """, marques, template=_TPL_MARQUE, page_size=1000)
    # Même casse de marque côté modèles (y compris les modèles saisis à la main)
    execute_values(cur, """
        UPDATE catalog_modeles mo
        SET marque = v.marque
        FROM (VALUES %s) AS v(categorie, marque, ordre)
        WHERE mo.categorie = v.categorie AND lower(mo.marque) = lower(v.marque)
          AND mo.marque <> v.marque
    """, marques, template=_TPL_MARQUE, page_size=1000)


def _appliquer_renames(cur, renames):
    for categorie, marque, ancien, nouveau in renames:
        params = {"categorie": categorie, "marque": marque, "ancien": ancien, "nouveau": nouveau}
        # Le nouveau nom existe déjà sur une AUTRE ligne : l'ancienne fait doublon
        cur.execute("""
            DELETE FROM catalog_modeles o
            WHERE o.categorie = %(categorie)s
              AND lower(o.marque) = lower(%(marque)s)
              AND lower(o.modele) = lower(%(ancien)s)
              AND lower(%(ancien)s) <> lower(%(nouveau)s)
              AND EXISTS (
                  SELECT 1 FROM catalog_modeles n
                  WHERE n.categorie = o.categorie
                    AND lower(n.marque) = lower(o.marque)
                    AND lower(n.modele) = lower(%(nouveau)s)
                    AND n.id <> o.id
              )
        """, params)
        cur.execute("""
            UPDATE catalog_modeles SET modele = %(nouveau)s
            WHERE categorie = %(categorie)s
              AND lower(marque) = lower(%(marque)s)
              AND lower(modele) = lower(%(ancien)s)
              AND modele <> %(nouveau)s
        """, params)


def _appliquer_modeles(cur, modeles):
    """Met à jour les modèles existants (sans toucher actif) puis insère les manquants."""
    maj = execute_values(cur, """
        UPDATE catalog_modeles mo
        SET marque = v.marque, modele = v.modele, annee = v.annee,
            ordre = v.ordre, source = 'seed'
        FROM (VALUES %s) AS v(categorie, marque, modele, annee, ordre)
        WHERE mo.categorie = v.categorie
          AND lower(mo.marque) = lower(v.marque)
          AND lower(mo.modele) = lower(v.modele)
          AND (mo.marque, mo.modele, mo.annee, mo.ordre, mo.source)
              IS DISTINCT FROM (v.marque, v.modele, v.annee, v.ordre, 'seed'::text)
        RETURNING mo.id
    """, modeles, template=_TPL_MODELE, page_size=1000, fetch=True)
    ajoutes = execute_values(cur, """
        INSERT INTO catalog_modeles (categorie, marque, modele, annee, ordre, source)
        SELECT v.categorie, v.marque, v.modele, v.annee, v.ordre, 'seed'
        FROM (VALUES %s) AS v(categorie, marque, modele, annee, ordre)
        WHERE NOT EXISTS (
            SELECT 1 FROM catalog_modeles mo
            WHERE mo.categorie = v.categorie
              AND lower(mo.marque) = lower(v.marque)
              AND lower(mo.modele) = lower(v.modele)
        )
        ON CONFLICT DO NOTHING
        RETURNING id
    """, modeles, template=_TPL_MODELE, page_size=1000, fetch=True)
    return len(maj), len(ajoutes)


def _marques_orphelines(cur):
    """Chaque modèle doit avoir sa ligne marque (sinon invisible dans la config)."""
    cur.execute("""
        INSERT INTO catalog_marques (categorie, marque)
        SELECT DISTINCT ON (mo.categorie, lower(mo.marque)) mo.categorie, mo.marque
        FROM catalog_modeles mo
        WHERE NOT EXISTS (
            SELECT 1 FROM catalog_marques ma
            WHERE ma.categorie = mo.categorie AND lower(ma.marque) = lower(mo.marque)
        )
        ORDER BY mo.categorie, lower(mo.marque), mo.id
        ON CONFLICT DO NOTHING
    """)


def ensure_unique_indexes():
    """Crée les index uniques insensibles à la casse qui manquent. Vérifié à chaque
    boot : un échec (doublon, verrou) est retenté au démarrage suivant. CREATE INDEX
    IF NOT EXISTS verrouille la table même quand l'index existe, d'où le SELECT préalable."""
    try:
        with get_cursor() as cur:
            cur.execute(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname = current_schema() AND indexname = ANY(%s)",
                ([nom for nom, _ in _UNIQUE_INDEXES],),
            )
            existants = {r["indexname"] for r in cur.fetchall()}
    except Exception as e:
        print(f"Warning index catalogue : {e}")
        return
    for nom, sql in _UNIQUE_INDEXES:
        if nom in existants:
            continue
        try:
            with get_cursor() as cur:
                cur.execute("SET LOCAL lock_timeout = '3s'")
                # Deux CREATE INDEX IF NOT EXISTS simultanés (instances qui démarrent
                # ensemble) : le second échoue sur pg_class au lieu d'ignorer
                cur.execute("SELECT pg_advisory_xact_lock(hashtext('catalog_seed'))")
                cur.execute(sql)
        except Exception as e:
            print(f"Warning index catalogue : {e}")


def _appliquer_seed(marker):
    """Applique le seed en une transaction. Retourne (nb_maj, nb_ajoutes), ou None s'il est déjà en base."""
    with get_cursor() as cur:
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (PARAM_KEY,))
        row = cur.fetchone()
    if row and row["valeur"] == marker:
        return None

    marques, modeles, renames = prepare_seed()
    with get_cursor() as cur:
        # La boucle ALTER de main.py laisse lock_timeout = 3s sur des connexions du pool :
        # on attend le verrou (borné par statement_timeout) au lieu d'abandonner.
        cur.execute("SET LOCAL lock_timeout = 0")
        cur.execute("SELECT pg_advisory_xact_lock(hashtext('catalog_seed'))")
        # Une autre instance a pu appliquer le seed pendant qu'on attendait le verrou
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (PARAM_KEY,))
        row = cur.fetchone()
        if row and row["valeur"] == marker:
            return None
        _nettoyer(cur)
        _appliquer_marques(cur, marques)
        _appliquer_renames(cur, renames)
        nb_maj, nb_ajoutes = _appliquer_modeles(cur, modeles)
        _marques_orphelines(cur)
        cur.execute(
            "INSERT INTO params (cle, valeur) VALUES (%s, %s) "
            "ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur",
            (PARAM_KEY, marker),
        )
    return nb_maj, nb_ajoutes


def seed_catalog():
    """Applique le seed du catalogue s'il n'est pas déjà en base, puis vérifie les
    index uniques. Retourne True si le seed a été appliqué."""
    marker = seed_marker()
    stats = _appliquer_seed(marker)
    ensure_unique_indexes()
    if stats is None:
        return False

    from app.api.catalog import clear_catalog_cache
    clear_catalog_cache()
    nb_maj, nb_ajoutes = stats
    print(f"Catalogue : seed {marker} appliqué ({nb_ajoutes} modèles ajoutés, {nb_maj} mis à jour)")
    return True
