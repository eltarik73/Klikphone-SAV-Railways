"""
Montants d'un ticket : une seule règle pour la fiche, la restitution, la
fidélité et la caisse.

Les prix des lignes sont TTC (aucune TVA n'est rajoutée). Les lignes sont
celles des documents imprimés (services/prestations.lignes_reparation) :
lignes JSON de la fiche, ou à défaut ligne « panne » au devis estimé plus le
supplément texte au prix_supp (ancien format).
"""

import json
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from app.services.prestations import lignes_reparation, normaliser

_CENT = Decimal("0.01")
# Devis refusé : seuls les frais restent dus (« Diagnostic », « Frais de dossier »…)
_MOTS_FRAIS = {"diagnostic", "frais"}


def _dec(v) -> Decimal:
    if v is None or isinstance(v, bool):
        return Decimal(0)
    try:
        d = Decimal(str(v).strip().replace(",", ".") or 0)
    except (InvalidOperation, ValueError):
        return Decimal(0)
    return d if d.is_finite() else Decimal(0)


def _cents(d: Decimal) -> Decimal:
    return d.quantize(_CENT, rounding=ROUND_HALF_UP)


def _format_lignes(t: dict) -> bool:
    """reparation_supp contient la liste JSON des lignes de la fiche (nouveau format)."""
    rs = str(t.get("reparation_supp") or "").strip()
    if rs[:1] not in ("[", "{"):
        return False
    try:
        return isinstance(json.loads(rs), list)
    except ValueError:
        return False


def _frais_dus(ligne: dict) -> bool:
    return ligne.get("cle") == "diagnostic" or bool(_MOTS_FRAIS & set(normaliser(ligne.get("label")).split()))


def lignes_dues(t: dict) -> list:
    """Lignes facturables [{"label", "prix", "cle"}] : devis refusé → frais seuls."""
    brutes = lignes_reparation(t) or []
    if str(t.get("issue") or "") == "refus_devis":
        brutes = [r for r in brutes if _frais_dus(r)]
    return brutes


def calculer_montants(t: dict) -> dict:
    """{sous_total, reduction, total, acompte, reste, trop_percu, paye, refus_devis, source, lignes}.

    - sous-total = somme des lignes ; sans ligne chiffrée, repli sur le devis
      estimé (comme l'écran) ;
    - ancien format (sans lignes JSON) : tarif_final > 0 fait foi, réduction
      comprise, comme l'ancienne caisse ;
    - devis refusé (issue='refus_devis') : seules les lignes de frais
      (diagnostic, frais…) sont dues, sans aucun repli : la réparation refusée
      n'est jamais réclamée ;
    - réduction en % prioritaire sur le montant, bornée au sous-total ;
    - reste = 0 dès que le ticket est marqué payé ; trop_percu = acompte au-delà du total.
    """
    refus = str(t.get("issue") or "") == "refus_devis"
    brutes = lignes_dues(t)
    lignes = [
        {"label": str(r.get("label") or ""), "prix": float(_cents(_dec(r.get("prix"))))}
        for r in brutes
    ]
    sous_total = sum((_dec(r["prix"]) for r in lignes), Decimal(0))
    source = "lignes"
    if not refus:
        tarif = _dec(t.get("tarif_final"))
        devis = _dec(t.get("devis_estime"))
        if tarif > 0 and not _format_lignes(t):
            sous_total, source = tarif, "tarif_final"
        elif sous_total <= 0 and devis > 0:
            sous_total, source = devis, "devis_estime"
    sous_total = max(sous_total, Decimal(0))

    reduction = Decimal(0)
    if source != "tarif_final":
        pct = _dec(t.get("reduction_pourcentage"))
        reduction = sous_total * pct / 100 if pct > 0 else _dec(t.get("reduction_montant"))
        reduction = min(max(_cents(reduction), Decimal(0)), sous_total)

    total = _cents(sous_total - reduction)
    acompte = _cents(max(_dec(t.get("acompte")), Decimal(0)))
    paye = bool(t.get("paye"))
    reste = Decimal(0) if paye else max(total - acompte, Decimal(0))
    return {
        "sous_total": float(_cents(sous_total)),
        "reduction": float(reduction),
        "total": float(total),
        "acompte": float(acompte),
        "reste": float(_cents(reste)),
        "trop_percu": float(max(acompte - total, Decimal(0))),
        "paye": paye,
        "refus_devis": refus,
        "source": source,
        "lignes": lignes,
    }


def statut_paiement(m: dict) -> str:
    """Libellé statut_paiement cohérent avec le drapeau paye (seule source de « payé »)."""
    if m["paye"]:
        return "Payé"
    return "Acompte versé" if m["acompte"] > 0 else "Non payé"


def format_euros(v) -> str:
    """120 → « 120,00 » (affichage français, deux décimales)."""
    return f"{float(v):.2f}".replace(".", ",")
