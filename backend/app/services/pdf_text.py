"""Texte sûr pour les polices core de fpdf2 (Helvetica, Courier : Latin-1 uniquement)."""

# Les claviers Mac/iOS insèrent des caractères typographiques hors Latin-1
# (apostrophe courbe, tirets, €…) : sans translittération, fpdf2 lève
# FPDFUnicodeEncodingException et le PDF entier échoue.
_PDF_REPL = {
    "’": "'", "‘": "'", "ʼ": "'", "‚": ",",
    "“": '"', "”": '"', "„": '"',
    "–": "-", "—": "-", "−": "-", "‐": "-", "‑": "-",
    "…": "...", "€": "EUR", " ": " ", " ": " ", " ": " ",
    "​": "", "﻿": "",
    "•": "-", "→": "->", "œ": "oe", "Œ": "OE",
}


def _pdf_safe(s) -> str:
    """Rend une chaîne sûre pour la police core Helvetica (Latin-1)."""
    if s is None or s == "":
        return ""
    out = str(s)
    for k, v in _PDF_REPL.items():
        out = out.replace(k, v)
    # Tout caractère restant hors Latin-1 (emoji…) devient '?' : jamais de plantage
    return out.encode("latin-1", "replace").decode("latin-1")
