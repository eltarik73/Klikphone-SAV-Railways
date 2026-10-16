"""
Moteur de recherche staff : analyse de la saisie, normalisation (accents,
téléphone, IMEI, code ticket) et constructeurs de clauses SQL paramétrées.

Le SQL est assemblé uniquement à partir de fragments constants de ce module ;
toute valeur saisie passe par un paramètre psycopg2 nommé (SqlParams).
Les fonctions public.kp_* sont créées par _migrations_recherche() (main.py).
"""

import difflib
import re
import unicodedata
from dataclasses import dataclass, field, replace
from functools import lru_cache
from typing import Optional
from urllib.parse import unquote

MAX_QUERY_LEN = 100
MAX_WORDS = 6
TRGM_THRESHOLD = 0.5
# Miroir de services/etagere.EMPLACEMENT_MAX (longueur maximale d'un emplacement « B3 »)
EMPLACEMENT_MAX = 20
# Juste après code ticket explicite (1000) et IMEI (900 / 800), avant le téléphone (700)
EMPLACEMENT_SCORE = 750
# Expression couverte par idx_tickets_emplacement (main.py, _DDL_INDEXES, partiel
# « emplacement IS NOT NULL ») : la comparaison de base doit rester exactement celle-ci.
EMPLACEMENT_INDEX_EXPR = "upper(emplacement)"
# Lettres accentuées repliées par translate() (natif, IMMUTABLE, sans appel de fonction SQL
# par ligne) : « etagere 2 » trouve « ÉTAGÈRE 2 ». Miroir Python : emplacement_cle().
_EMPL_ACCENTS = "ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸàáâãäåçèéêëìíîïñòóôõöùúûüýÿ"
_EMPL_ASCII = "AAAAAACEEEEIIIINOOOOOUUUUYYaaaaaaceeeeiiiinooooouuuuyy"
_EMPL_FOLD = str.maketrans(_EMPL_ACCENTS, _EMPL_ASCII)

STATUTS_ARCHIVES = ("Rendu au client", "Clôturé")
NOTE_TYPES_CHERCHABLES = ("note", "message_client", "avis_client")

# Toute modification de ces listes change l'expression des index GIN :
# renommer les index *_v1 en *_v2 dans main.py (_migrations_recherche).
T_DEVICE_COLS = ("marque", "modele", "modele_autre", "categorie", "telephone_pret")
T_WORK_COLS = (
    "panne", "panne_detail", "reparation_supp", "type_ecran", "technicien_assigne",
    "notes_internes", "notes_client", "commentaire_client", "attention",
)
T_PANNE_COLS = ("panne",)
C_COLS = ("nom", "prenom", "societe", "email")
NOTE_COLS = ("contenu",)
DEVIS_COLS = ("numero", "client_nom", "client_prenom", "appareil", "description")
CMD_COLS = ("description", "fournisseur", "reference", "ticket_code", "notes")

STOPWORDS = frozenset({
    "de", "du", "des", "la", "le", "les", "et", "en", "au", "aux",
    "un", "une", "pour", "sur", "chez", "avec",
})

# Jargon d'atelier : chaque mot cherche aussi ses équivalents.
SYNONYMES = {
    "ecran": ["lcd", "oled", "dalle", "afficheur"],
    "lcd": ["ecran"],
    "oled": ["ecran"],
    "dalle": ["ecran"],
    "afficheur": ["ecran"],
    "connecteur": ["charge"],
    "charge": ["connecteur"],
    "lightning": ["connecteur", "charge"],
    "usb": ["connecteur", "charge"],
    "dos": ["vitre arriere", "back"],
    "hp": ["haut parleur"],
    "hautparleur": ["haut parleur"],
    "faceid": ["face id"],
    "touchid": ["touch id"],
    "oxyde": ["oxydation", "desoxydation"],
}

VOCAB_STATIQUE = (
    "ecran batterie connecteur charge camera vitre arriere tactile micro haut parleur "
    "bouton power volume nappe oxydation desoxydation face touch wifi bluetooth reseau "
    "lecteur carte sim ecouteur vibreur antenne reparation diagnostic logiciel "
    "iphone ipad ipod macbook watch samsung galaxy xiaomi redmi poco huawei honor oppo "
    "realme google pixel oneplus sony xperia motorola nokia apple asus lenovo alcatel "
    "wiko crosscall tablette montre ordinateur console switch playstation nintendo"
).split()


# ─── NORMALISATION ───────────────────────────────────────────────
_LIGATURES = str.maketrans({
    "œ": "oe", "Œ": "oe", "æ": "ae", "Æ": "ae", "ß": "ss",
    "ø": "o", "Ø": "o", "ł": "l", "Ł": "l", "đ": "d", "Đ": "d",
})
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_text(value) -> str:
    """Minuscules, sans accents, ponctuation → espaces (miroir de public.kp_doc)."""
    s = str(value or "").translate(_LIGATURES)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    return _NON_ALNUM.sub(" ", s).strip()


def doc_text(*values) -> str:
    """Document normalisé entouré d'espaces, comme public.kp_doc côté SQL."""
    return " " + " ".join(normalize_text(v) for v in values if v) + " "


def alnum(value) -> str:
    """Miroir de public.kp_alnum : minuscules et caractères alphanumériques seuls."""
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def esc_like(s: str) -> str:
    """Échappe les jokers LIKE (antislash = caractère d'échappement par défaut)."""
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@lru_cache(maxsize=512)
def _like_regex(pattern: str):
    out, i = [], 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == "\\" and i + 1 < len(pattern):
            out.append(re.escape(pattern[i + 1]))
            i += 2
            continue
        out.append(".*" if ch == "%" else "." if ch == "_" else re.escape(ch))
        i += 1
    return re.compile("".join(out), re.S)


def like_match(pattern: str, text: str) -> bool:
    """Évalue un motif LIKE en Python (même sémantique que PostgreSQL)."""
    return _like_regex(pattern).fullmatch(text or "") is not None


# ─── TÉLÉPHONE ───────────────────────────────────────────────────
def phone_digits(value) -> str:
    return re.sub(r"\D", "", str(value or ""))


def phone_key(value) -> Optional[str]:
    """9 derniers chiffres : unifie 06…, +33 6…, 0033 6…, 6… (miroir de kp_phone_key)."""
    d = phone_digits(value)
    return d[-9:] if len(d) >= 9 else None


def phone_national(value) -> str:
    """Forme nationale française (0XXXXXXXXX) quand le numéro est français, sinon les chiffres."""
    d = phone_digits(value)
    rest = None
    if d.startswith("0033"):
        rest = d[4:]
    elif d.startswith("33") and len(d) in (11, 12):
        rest = d[2:]
    if rest is not None:
        return "0" + rest.lstrip("0")
    if len(d) == 9 and not d.startswith("0"):
        return "0" + d
    return d


_PHONE_INPUT_RE = re.compile(r"\+?[\d\s.\-()/]+")


def phone_canonical(value):
    """Forme stockée d'un téléphone saisi : 0612345678 pour la France (y compris
    +33 / 0033 / 33…), +41791234567 pour l'étranger. Une saisie qui ne ressemble
    pas à un numéro complet (lettres, < 9 chiffres) est rendue telle quelle."""
    if value is None:
        return None
    s = str(value).strip()
    d = phone_digits(s)
    if not _PHONE_INPUT_RE.fullmatch(s) or not 9 <= len(d) <= 15:
        return s
    intl = None
    if s.startswith("+"):
        intl = d
    elif d.startswith("00"):
        intl = d[2:]
    if intl is None:
        return phone_national(d)
    if intl.startswith("33") and len(intl) in (11, 12):
        return phone_national("0033" + intl[2:])
    return "+" + intl


def phone_full(value) -> str:
    """Numéro complet comparable : 0612345678 (France), 41791234567 (étranger, sans + ni 00)."""
    nat = phone_national(value)
    return nat[2:] if nat.startswith("00") else nat


def same_phone(a, b) -> bool:
    """Même numéro complet (≥ 9 chiffres) quel que soit le format de saisie.

    Hors France, seule l'écriture internationale est reconnue : « 079 123 45 67 »
    se lit comme un 07 français et ne vaut pas « +41 79 123 45 67 » (ambiguïté
    réelle, voulue). La recherche relie quand même les deux par la clé à 9 chiffres.
    """
    if len(phone_digits(a)) < 9 or len(phone_digits(b)) < 9:
        return False
    return phone_full(a) == phone_full(b)


def phone_full_variants(value) -> list:
    """Écritures en chiffres d'un même numéro complet (0612…, 33612…, 0033612…, 612… ;
    41791…, 0041791… pour l'étranger), comparées à kp_phone_digits(telephone)."""
    d = phone_digits(value)
    if len(d) < 9:
        return []
    nat = phone_national(d)
    out = {d, nat}
    if len(nat) == 10 and nat.startswith("0"):
        core = nat[1:]
        out |= {core, "33" + core, "0033" + core, "330" + core, "00330" + core}
    else:
        intl = phone_full(d)
        out |= {intl, "00" + intl}
    return sorted(out)


def _phone_prefix_variants(core: str) -> list:
    e = esc_like(core)
    return [f"0{e}%", f"33{e}%", f"0033{e}%", f"330{e}%"]


def phone_patterns(d: str) -> list:
    """Motifs LIKE sur kp_phone_digits(telephone) pour un fragment de chiffres saisi."""
    if len(d) < 4 or len(d) > 13:
        return []
    if len(d) >= 9:
        return [f"%{phone_key(d)}%"]
    pats = [f"%{d}" if len(d) == 4 else f"%{d}%"]
    if d.startswith("0") and not d.startswith("00"):
        pats += _phone_prefix_variants(d[1:])
    return pats


_INDICATIF_FR_RE = re.compile(r"\(?\+\s*33")


def phone_lookup(value):
    """Numéro saisi, complet ou partiel : ("key", clé à 9 chiffres), ("like", motifs sur
    kp_phone_digits) ou None (moins de 4 chiffres).

    Indicatif français explicite (+33, 0033, +33 (0)…) : la partie nationale décide,
    « +33 7 11 » cherche 0711… et « +33 6 12 34 56 7 » reste partiel. « 33 7 11 » sans +
    est ambigu : les deux lectures. 0 + 8 chiffres : numéro français incomplet.
    """
    s = str(value or "").strip()
    d = phone_digits(s)
    core = None
    if _INDICATIF_FR_RE.match(s):
        core = d[2:]
    elif d.startswith("0033"):
        core = d[4:]
    if core is not None:
        core = core[1:] if core.startswith("0") else core
        if len(core) >= 9:
            return ("key", core[-9:])
        return ("like", _phone_prefix_variants(core)) if len(core) >= 3 else None
    if len(d) >= 9 and not (len(d) == 9 and d.startswith("0") and not d.startswith("00")):
        return ("key", phone_key(d))
    if len(d) < 4:
        return None
    pats = phone_patterns(d)
    if len(d) == 9:
        pats += _phone_prefix_variants(d[1:])
    if d.startswith("33") and len(d) >= 5:
        core = d[2:][1:] if d[2:].startswith("0") else d[2:]
        if len(core) >= 3:
            pats += [p for p in _phone_prefix_variants(core) if p not in pats]
    return ("like", pats)


# ─── IMEI / NUMÉRO DE SÉRIE ──────────────────────────────────────
def luhn_ok(d: str) -> bool:
    if not d.isdigit():
        return False
    total = 0
    for i, ch in enumerate(reversed(d)):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def is_imei(value) -> bool:
    d = phone_digits(value)
    return len(d) == 15 and len(d) == len(re.sub(r"[\s.\-/]", "", str(value).strip())) and luhn_ok(d)


_SERIAL_RE = re.compile(r"(?=(?:.*\d){2})(?=(?:.*[a-z]){2})[a-z0-9]{10,12}", re.I)


def serial_number(value) -> Optional[str]:
    """Numéro de série constructeur (10-12 alphanumériques, ≥ 2 lettres et ≥ 2 chiffres)."""
    s = str(value or "").strip()
    if not s or re.search(r"\s", s):
        return None
    compact = re.sub(r"[.\-_/]", "", s)
    return compact.lower() if _SERIAL_RE.fullmatch(compact) else None


# ─── CODE TICKET ─────────────────────────────────────────────────
_SUIVI_RE = re.compile(r"[?&]ticket=([^&#\s]+)", re.I)
_TICKET_RE = re.compile(r"(kp|#)?[-_#.:/]*(\d{1,9})", re.I)
_TAIL_KP_RE = re.compile(r"kp[^a-z0-9]{0,2}(\d{1,7})$", re.I)
# Douchette réglée en QWERTY sur un poste AZERTY : la rangée des chiffres sort
# sans Maj (à & é " ' ( - è _ ç) et le tiret du code devient « ) ».
_AZERTY_DIGITS = str.maketrans({
    "à": "0", "&": "1", "é": "2", '"': "3", "'": "4",
    "(": "5", "-": "6", "è": "7", "_": "8", "ç": "9", ")": "-",
})
_AZERTY_MARKERS = re.compile(r"[àéèç&]")


def descramble_scan(raw: str) -> str:
    """Rétablit un code ou un IMEI scanné en QWERTY sur un clavier AZERTY.

    N'agit que si le résultat ressemble à un code ticket ou à un IMEI, pour ne
    jamais altérer une saisie normale (« Hélène »).
    """
    s = (raw or "").strip()
    if not _AZERTY_MARKERS.search(s):
        return s
    fixed = s.translate(_AZERTY_DIGITS)
    if _TAIL_KP_RE.search(fixed) or re.fullmatch(r"\d{14,16}", fixed):
        return fixed
    return s


def suivi_code(raw: str) -> Optional[str]:
    """Code contenu dans une URL de QR (…/suivi?ticket=KP-000123)."""
    m = _SUIVI_RE.search(raw or "")
    return unquote(m.group(1)).strip() if m else None


@dataclass
class TicketRef:
    ticket_id: int
    explicit: bool
    code_prefix: Optional[str] = None


def parse_ticket_ref(raw: str, from_url: bool = False) -> Optional[TicketRef]:
    """Reconnaît 123, 000123, #123, KP-123, kp123, KP-000123, « kp 000123 ».

    explicit = forme sans ambiguïté (préfixe KP ou #, QR, 6 chiffres commençant
    par 00) ; un nombre nu peut aussi être une fin de téléphone ou d'IMEI.
    """
    s = re.sub(r"\s", "", raw or "")
    m = _TICKET_RE.fullmatch(s)
    if not m:
        m2 = _TAIL_KP_RE.search(s) if from_url else None
        if not m2:
            return None
        return TicketRef(int(m2.group(1)), True) if int(m2.group(1)) > 0 else None
    prefix, digits = (m.group(1) or "").lower(), m.group(2)
    significant = digits.lstrip("0")
    if not significant or len(significant) > 7:
        return None
    tid = int(significant)
    padded = digits.startswith("0")
    if from_url or prefix == "#":
        return TicketRef(tid, True)
    if prefix == "kp":
        if padded and len(digits) < 6:
            return TicketRef(tid, False, "KP-" + digits + "%")
        return TicketRef(tid, True)
    # « 000123 » oui, « 061234 » non : c'est plutôt un début de numéro de téléphone
    if len(digits) == 6 and digits.startswith("00"):
        return TicketRef(tid, True)
    return TicketRef(tid, False)


# ─── ANALYSE DE LA SAISIE ────────────────────────────────────────
@dataclass
class Word:
    text: str
    patterns: list
    compact: list
    phone: list
    imei: list
    prefixes: list
    trgm: bool = False
    fuzzy: bool = False


@dataclass
class ParsedQuery:
    q: str
    words: list = field(default_factory=list)
    ticket_id: Optional[int] = None
    ticket_explicit: bool = False
    code_prefix: Optional[str] = None
    imei: Optional[str] = None
    phone_key: Optional[str] = None
    phone_full: list = field(default_factory=list)
    numeric: bool = False
    fuzzy: bool = False
    # Code ticket + autres mots (« KP-000123 dupont ») : le code ET chaque mot
    code_and: bool = False
    # Saisie entière comparée à tickets.emplacement (« b3 » → « B3 »), voir emplacement_terme()
    emplacement: Optional[str] = None

    @property
    def empty(self) -> bool:
        return not (self.words or self.ticket_id or self.code_prefix or self.imei or self.phone_key
                    or self.emplacement)

    @property
    def ticket_code(self) -> Optional[str]:
        return f"KP-{self.ticket_id:06d}" if self.ticket_id else None


_NUMERIC_RE = re.compile(r"^\+?[\d\s.\-()/]+$")
_DIGIT_RUN_RE = re.compile(r"\+?\d+(?:[ .\-/]+\d+)+")


def _merge_phone_runs(raw: str) -> str:
    """« dupont 06 12 34 56 78 » → « dupont 0612345678 » (sans fusionner « 12 2020 64 »)."""
    def repl(m):
        groups = re.findall(r"\d+", m.group(0))
        total = sum(len(g) for g in groups)
        if 9 <= total <= 13 and len(groups) >= 3 and max(len(g) for g in groups) <= 4:
            return " " + "".join(groups) + " "
        return m.group(0)
    return _DIGIT_RUN_RE.sub(repl, raw)


def tokenize(raw: str) -> list:
    """Mots de recherche (≤ MAX_WORDS). Un chiffre seul est gardé (« iphone 8 ») ;
    une lettre seule ne l'est que si elle est toute la saisie (élisions « l' », « d' »)."""
    words = normalize_text(_merge_phone_runs(raw)).split()
    tokens = []
    for t in words:
        if (len(t) >= 2 or t.isdigit() or len(words) == 1) and t not in tokens:
            tokens.append(t)
    if len(tokens) > 1:
        tokens = [t for t in tokens if t not in STOPWORDS] or tokens
    return tokens[:MAX_WORDS]


def make_word(t: str) -> Word:
    e = esc_like(t)
    if len(t) == 1 and t.isalpha():
        start = [f"% {e}%"]
        return Word(t, start, [], [], [], start)
    if t.isdigit() and len(t) <= 3:
        # « 13 » en mot entier : évite KP-000130, 2013, A13…
        whole = [f"% {e} %"]
        return Word(t, whole, [], [], [], whole)
    alts = [t] + SYNONYMES.get(t, [])
    patterns = [f"%{esc_like(a)}%" for a in alts]
    compact = [] if t.isdigit() else [f"%{e}%"]
    phone = phone_patterns(t) if t.isdigit() else []
    if t.isdigit():
        imei = [f"%{e}" if len(t) <= 8 else f"%{e}%"] if len(t) >= 4 else []
    else:
        imei = [f"%{e}%"] if len(t) >= 4 and not t.isalpha() else []
    return Word(t, patterns, compact, phone, imei, [f"% {e}%"])


_CODE_TOKEN_RE = re.compile(r"(?<!\S)(kp[-_#.:/]?\d{1,7}|#\d{1,7})(?!\S)", re.I)


def _code_token(raw: str):
    """(TicketRef, reste) quand la saisie contient exactement un code KP-… / #… parmi d'autres mots."""
    found = _CODE_TOKEN_RE.findall(raw)
    if len(found) != 1:
        return None, raw
    ref = parse_ticket_ref(found[0])
    if not ref:
        return None, raw
    return ref, _CODE_TOKEN_RE.sub(" ", raw).strip()


def emplacement_terme(raw) -> Optional[str]:
    """Saisie entière lue comme un emplacement d'étagère, normalisée comme
    services/etagere.normaliser_emplacement (« b3 » → « B3 », « Étagère  2 » → « ÉTAGÈRE 2 »).

    None hors 1-20 caractères, sans lettre ni chiffre (« _ ») ou avec un caractère
    non imprimable (un NUL ferait échouer psycopg2).
    """
    v = " ".join(str(raw or "").split()).upper()
    if not 1 <= len(v) <= EMPLACEMENT_MAX or not v.isprintable() or not any(ch.isalnum() for ch in v):
        return None
    return v


def emplacement_cle(value) -> str:
    """Miroir de upper(translate(…)) dans _emplacement_sql : accents repliés puis majuscules
    (« étagère 2 », « ETAGERE 2 » et « ÉTAGÈRE 2 » → « ETAGERE 2 »)."""
    return str(value or "").translate(_EMPL_FOLD).upper()


def parse_query(q) -> ParsedQuery:
    raw = descramble_scan(str(q or "")[:500])
    url_code = suivi_code(raw)
    raw = url_code if url_code else raw[:MAX_QUERY_LEN]
    pq = ParsedQuery(q=raw)
    if not raw:
        return pq

    ref = parse_ticket_ref(raw, from_url=bool(url_code))
    numeric = bool(_NUMERIC_RE.match(raw))
    if ref:
        pq.ticket_id, pq.ticket_explicit, pq.code_prefix = ref.ticket_id, ref.explicit, ref.code_prefix
        if not numeric:
            # Code KP-… / #… / QR : pas d'emplacement, la recherche reste servie par les index
            return pq

    if numeric:
        d = phone_digits(raw)
        pq.numeric = True
        if 14 <= len(d) <= 16:
            pq.imei = d
        elif 9 <= len(d) <= 13:
            pq.phone_key = d[-9:]
            pq.phone_full = phone_full_variants(d)
        if len(d) >= 2:
            pq.words = [make_word(d)]
        if not (pq.imei or pq.phone_key):
            # « 12 » peut être un emplacement ; un téléphone ou un IMEI complet, jamais
            pq.emplacement = emplacement_terme(raw)
        return pq

    code_ref, rest = _code_token(raw)
    if code_ref and tokenize(rest):
        pq.ticket_id, pq.ticket_explicit, pq.code_prefix = (
            code_ref.ticket_id, code_ref.explicit, code_ref.code_prefix)
        pq.code_and = True
        raw = rest
    else:
        pq.emplacement = emplacement_terme(raw)
    pq.imei = serial_number(raw)
    pq.words = [make_word(t) for t in tokenize(raw)]
    return pq


# ─── FAUTES DE FRAPPE (repli quand rien n'est trouvé) ────────────
def build_vocab(values) -> frozenset:
    vocab = set(VOCAB_STATIQUE)
    for v in values:
        for t in normalize_text(v).split():
            if len(t) >= 3 and t.isalpha():
                vocab.add(t)
    return frozenset(vocab)


def correct_word(t: str, vocab, cutoff: float = 0.75) -> Optional[str]:
    """Correction marque / modèle / panne (iphnoe → iphone), jamais d'un mot connu."""
    if len(t) < 4 or not t.isalpha() or t in vocab:
        return None
    if any(v.startswith(t) for v in vocab):
        return None
    found = difflib.get_close_matches(t, sorted(vocab), n=1, cutoff=cutoff)
    return found[0] if found and found[0] != t else None


def fuzzy_query(pq: ParsedQuery, vocab, trgm: bool) -> Optional[ParsedQuery]:
    """Variante approchée de pq, ou None si aucun mot ne s'y prête."""
    if pq.numeric or not pq.words:
        return None
    words, changed = [], False
    for w in pq.words:
        if not (w.text.isalpha() and len(w.text) >= 4):
            words.append(w)
            continue
        fixed = correct_word(w.text, vocab)
        extra = [f"%{esc_like(fixed)}%"] if fixed else []
        if extra or trgm:
            changed = True
            words.append(Word(w.text, w.patterns + extra, w.compact + extra, w.phone, w.imei,
                              w.prefixes, trgm=trgm, fuzzy=True))
        else:
            words.append(w)
    if not changed:
        return None
    return replace(pq, words=words, fuzzy=True)


# ─── FRAGMENTS SQL CONSTANTS ─────────────────────────────────────
def doc_sql(alias: str, cols) -> str:
    """public.kp_doc(coalesce(a.c1,'') || ' ' || …) : alias '' pour les index."""
    p = alias + "." if alias else ""
    return "public.kp_doc(" + " || ' ' || ".join(f"coalesce({p}{c}, '')" for c in cols) + ")"


def compact_sql(doc: str) -> str:
    return f"replace({doc}, ' ', '')"


def actif_sql(alias: str = "t") -> str:
    return f"(COALESCE({alias}.statut, '') NOT IN ('Rendu au client', 'Clôturé'))"


class SqlParams:
    """Paramètres nommés : seuls des noms générés ici entrent dans le texte SQL."""

    def __init__(self, prefix: str = "kp"):
        self.values = {}
        self._prefix = prefix
        self._n = 0

    def add(self, value) -> str:
        name = f"{self._prefix}{self._n}"
        self._n += 1
        self.values[name] = value
        return f"%({name})s"


_NOTE_TYPES_SQL = "('note', 'message_client', 'avis_client')"


def _any(expr: str, ph: str) -> str:
    return f"{expr} LIKE ANY({ph}::text[])"


def _ticket_word_sql(w: Word, P: SqlParams, t: str, c: str) -> str:
    p = P.add(w.patterns)
    dev, work = doc_sql("x", T_DEVICE_COLS), doc_sql("x", T_WORK_COLS)
    in_tickets = [_any(dev, p), _any(work, p)]
    if w.compact:
        in_tickets.append(_any(compact_sql(dev), P.add(w.compact)))
    if w.imei:
        i = P.add(w.imei)
        in_tickets.append(_any("public.kp_alnum(x.imei)", i))
        in_tickets.append(_any("public.kp_alnum(x.telephone_pret_imei)", i))
    cdoc = doc_sql("y", C_COLS)
    in_clients = [_any(cdoc, p)]
    if w.phone:
        in_clients.append(_any("public.kp_phone_digits(y.telephone)", P.add(w.phone)))
    if w.trgm:
        tw = P.add(w.text)
        in_tickets.append(f"public.kp_word_match({tw}, {dev})")
        in_tickets.append(f"public.kp_word_match({tw}, {doc_sql('x', T_PANNE_COLS)})")
        in_clients.append(f"public.kp_word_match({tw}, {cdoc})")
    ndoc = doc_sql("n", NOTE_COLS)
    return (
        f"({t}.id IN (SELECT x.id FROM tickets x WHERE " + " OR ".join(in_tickets) + ")"
        f" OR {t}.client_id IN (SELECT y.id FROM clients y WHERE " + " OR ".join(in_clients) + ")"
        f" OR {t}.id IN (SELECT n.ticket_id FROM notes_tickets n WHERE n.type_note IN {_NOTE_TYPES_SQL}"
        f" AND {_any(ndoc, p)}))"
    )


def _imei_exact_sql(alias: str, col: str, ph: str) -> str:
    # col <> '' : permet l'usage des index partiels sur kp_alnum(imei)
    return f"({alias}.{col} <> '' AND public.kp_alnum({alias}.{col}) = {ph})"


def _emplacement_replie(pq: ParsedQuery) -> bool:
    """Accents repliés seulement si le terme a une lettre et que des mots sont cherchés : leurs
    sous-requêtes OR imposent déjà un parcours de tickets, le repli n'y est qu'un filtre de
    plus. Sans mot (« 7 », « a b »), la condition reste upper() = upper(), servie par
    idx_tickets_emplacement."""
    return bool(pq.words) and any(ch.isalpha() for ch in pq.emplacement or "")


def _emplacement_sql(pq: ParsedQuery, t: str, ph: str) -> str:
    # upper() des deux côtés : tolère un emplacement saisi hors API (« b3 »)
    cond = f"upper({t}.emplacement) = upper({ph})"
    if not _emplacement_replie(pq):
        return cond
    fold = f"'{_EMPL_ACCENTS}', '{_EMPL_ASCII}'"
    return f"({cond} OR upper(translate({t}.emplacement, {fold})) = upper(translate({ph}, {fold})))"


def _emplacement_trouve(pq: ParsedQuery, row: dict) -> bool:
    """Miroir de _emplacement_sql ; row doit contenir t.emplacement."""
    v = row.get("emplacement")
    if not (pq.emplacement and v):
        return False
    if _emplacement_replie(pq):
        return emplacement_cle(v) == emplacement_cle(pq.emplacement)
    return str(v).upper() == pq.emplacement


def _tid_sql(pq: ParsedQuery, P: SqlParams, t: str) -> str:
    return f"({t}.id = {P.add(pq.ticket_id)} OR {t}.ticket_code = {P.add(pq.ticket_code)})"


def _code_and(pq: ParsedQuery) -> bool:
    return bool(pq.code_and and pq.words and (pq.ticket_id or pq.code_prefix))


def _code_sql(pq: ParsedQuery, P: SqlParams, t: str) -> list:
    out = []
    if pq.ticket_id:
        out.append(_tid_sql(pq, P, t))
    if pq.code_prefix:
        out.append(f"{t}.ticket_code LIKE {P.add(pq.code_prefix)}")
    return out


def phone_homonym_sql(pq: ParsedQuery, P: SqlParams, client_id: str = "c.id") -> Optional[str]:
    """Écarte les numéros qui ne partagent que les 9 derniers chiffres (+41 6… pour 06…)
    dès qu'un client a exactement le numéro saisi.

    Sous-requêtes indexées (idx_clients_phone_key) : aucun calcul par ligne parcourue.
    """
    if not (pq.phone_key and pq.phone_full):
        return None
    k, full = P.add(pq.phone_key), P.add(pq.phone_full)
    return (
        f"({client_id} IS NULL OR {client_id} NOT IN (SELECT z.id FROM clients z"
        f" WHERE public.kp_phone_key(z.telephone) = {k}"
        f" AND public.kp_phone_digits(z.telephone) <> ALL({full}::text[])"
        f" AND EXISTS (SELECT 1 FROM clients e WHERE public.kp_phone_key(e.telephone) = {k}"
        f" AND public.kp_phone_digits(e.telephone) = ANY({full}::text[]))))"
    )


def _with_homonyms(cond: str, pq: ParsedQuery, P: SqlParams, client_id: str) -> str:
    excl = phone_homonym_sql(pq, P, client_id) if cond != "FALSE" else None
    return f"({cond} AND {excl})" if excl else cond


def ticket_where_sql(pq: ParsedQuery, P: SqlParams, t: str = "t", c: str = "c") -> str:
    """Condition de recherche sur tickets t JOIN clients c (code, IMEI, téléphone,
    emplacement d'étagère, mots)."""
    words = "(" + " AND ".join(_ticket_word_sql(w, P, t, c) for w in pq.words) + ")" if pq.words else None
    ors = _code_sql(pq, P, t)
    if _code_and(pq):
        return "((" + " OR ".join(ors) + f") AND {words})"
    if pq.imei:
        i = P.add(pq.imei)
        ors.append(_imei_exact_sql(t, "imei", i))
        ors.append(_imei_exact_sql(t, "telephone_pret_imei", i))
    if pq.phone_key:
        # Sous-requête indexée plutôt que kp_phone_key(c.telephone) recalculé à chaque jointure
        ors.append(f"{t}.client_id IN (SELECT y.id FROM clients y"
                   f" WHERE public.kp_phone_key(y.telephone) = {P.add(pq.phone_key)})")
    if pq.emplacement:
        ors.append(_emplacement_sql(pq, t, P.add(pq.emplacement)))
    if words:
        ors.append(words)
    return _with_homonyms("(" + " OR ".join(ors) + ")" if ors else "FALSE", pq, P, f"{t}.client_id")


def matching_tickets_sql(pq: ParsedQuery, P: SqlParams, col: str = "id") -> str:
    """Sous-requête des tickets trouvés (col = id ou client_id), pour relier devis, commandes, clients."""
    return (f"(SELECT tk.{col} FROM tickets tk JOIN clients ck ON ck.id = tk.client_id"
            f" WHERE {ticket_where_sql(pq, P, 'tk', 'ck')})")


def _all(words, attr) -> list:
    out = []
    for w in words:
        for v in getattr(w, attr):
            if v not in out:
                out.append(v)
    return out


def _phone_full_score(pq: ParsedQuery, P: SqlParams, c: str) -> str:
    # Départage des clés à 9 chiffres partagées (+41 6… / 06…) : numéro complet identique
    return f"CASE WHEN public.kp_phone_digits({c}.telephone) = ANY({P.add(pq.phone_full)}::text[]) THEN 100 ELSE 0 END"


def ticket_score_sql(pq: ParsedQuery, P: SqlParams, t: str = "t", c: str = "c") -> str:
    parts = []
    if pq.ticket_id:
        pts = 1000 if pq.ticket_explicit else 500
        parts.append(f"CASE WHEN {_tid_sql(pq, P, t)} THEN {pts} ELSE 0 END")
    if pq.code_prefix:
        parts.append(f"CASE WHEN {t}.ticket_code LIKE {P.add(pq.code_prefix)} THEN 400 ELSE 0 END")
    if pq.imei:
        i = P.add(pq.imei)
        parts.append(
            f"CASE WHEN {_imei_exact_sql(t, 'imei', i)} THEN 900"
            f" WHEN {_imei_exact_sql(t, 'telephone_pret_imei', i)} THEN 800 ELSE 0 END"
        )
    if pq.phone_key:
        parts.append(f"CASE WHEN public.kp_phone_key({c}.telephone) = {P.add(pq.phone_key)} THEN 700 ELSE 0 END")
        parts.append(_phone_full_score(pq, P, c))
    if pq.emplacement:
        parts.append(f"CASE WHEN {_emplacement_sql(pq, t, P.add(pq.emplacement))}"
                     f" THEN {EMPLACEMENT_SCORE} ELSE 0 END")
    phones, imeis, prefixes = _all(pq.words, "phone"), _all(pq.words, "imei"), _all(pq.words, "prefixes")
    if phones:
        parts.append(f"CASE WHEN {_any(f'public.kp_phone_digits({c}.telephone)', P.add(phones))} THEN 300 ELSE 0 END")
    if imeis:
        i = P.add(imeis)
        parts.append(
            f"CASE WHEN {_any(f'public.kp_alnum({t}.imei)', i)} OR {_any(f'public.kp_alnum({t}.telephone_pret_imei)', i)}"
            " THEN 250 ELSE 0 END"
        )
    if prefixes:
        pp = P.add(prefixes)
        parts.append(f"CASE WHEN {_any(doc_sql(c, C_COLS), pp)} THEN 120 ELSE 0 END")
        parts.append(f"CASE WHEN {_any(doc_sql(t, T_DEVICE_COLS), pp)} THEN 60 ELSE 0 END")
    parts.append(
        f"CASE {t}.statut WHEN 'Réparation terminée' THEN 90 WHEN 'Rendu au client' THEN 0"
        " WHEN 'Clôturé' THEN 0 ELSE 50 END"
    )
    return "(" + " + ".join(parts) + ")"


def ticket_exact_sql(pq: ParsedQuery, P: SqlParams, t: str = "t") -> str:
    """Vrai pour une désignation explicite (code KP / QR / IMEI exact)."""
    parts = []
    if pq.ticket_id and pq.ticket_explicit:
        parts.append(_tid_sql(pq, P, t))
    if pq.imei:
        i = P.add(pq.imei)
        parts.append(_imei_exact_sql(t, "imei", i))
        parts.append(_imei_exact_sql(t, "telephone_pret_imei", i))
    return "COALESCE(" + " OR ".join(parts) + ", FALSE)" if parts else "FALSE"


def ticket_order_sql(pq: ParsedQuery, P: SqlParams, t: str = "t", c: str = "c") -> str:
    """Désignation exacte, puis actifs avant archivés, puis pertinence, puis récence."""
    exact = ticket_exact_sql(pq, P, t)
    # « ORDER BY FALSE » est refusé par PostgreSQL (constante non entière)
    head = "" if exact == "FALSE" else f"{exact} DESC, "
    return (
        f"{head}{actif_sql(t)} DESC, {ticket_score_sql(pq, P, t, c)} DESC,"
        f" {t}.date_depot DESC NULLS LAST, {t}.id DESC"
    )


def _client_word_sql(w: Word, P: SqlParams, c: str) -> str:
    cdoc = doc_sql(c, C_COLS)
    ors = [_any(cdoc, P.add(w.patterns))]
    if w.phone:
        ors.append(_any(f"public.kp_phone_digits({c}.telephone)", P.add(w.phone)))
    if w.trgm:
        ors.append(f"public.kp_word_match({P.add(w.text)}, {cdoc})")
    return "(" + " OR ".join(ors) + ")"


def client_where_sql(pq: ParsedQuery, P: SqlParams, c: str = "c", with_tickets: bool = False) -> str:
    """Condition sur clients c. with_tickets : inclut le client d'un code ticket / IMEI exact."""
    if with_tickets and _code_and(pq):
        return f"{c}.id IN {matching_tickets_sql(pq, P, 'client_id')}"
    linked = []
    if with_tickets and pq.ticket_id and pq.ticket_explicit:
        linked.append(f"{c}.id IN (SELECT x.client_id FROM tickets x WHERE {_tid_sql(pq, P, 'x')})")
    if with_tickets and pq.imei:
        i = P.add(pq.imei)
        linked.append(f"{c}.id IN (SELECT x.client_id FROM tickets x WHERE {_imei_exact_sql('x', 'imei', i)})")
    # À côté d'un IN (tickets), les conditions propres passent aussi par une sous-requête :
    # un OR mêlant les deux formes force sinon kp_doc() sur chaque client.
    a = "y" if linked else c
    own = []
    if pq.phone_key:
        own.append(f"public.kp_phone_key({a}.telephone) = {P.add(pq.phone_key)}")
    if pq.words:
        own.append("(" + " AND ".join(_client_word_sql(w, P, a) for w in pq.words) + ")")
    if linked and own:
        own = [f"{c}.id IN (SELECT y.id FROM clients y WHERE " + " OR ".join(own) + ")"]
    ors = linked + own
    return _with_homonyms("(" + " OR ".join(ors) + ")" if ors else "FALSE", pq, P, f"{c}.id")


def client_score_sql(pq: ParsedQuery, P: SqlParams, c: str = "c") -> str:
    # 0::int et non 0 : un entier nu dans ORDER BY serait lu comme un numéro de colonne
    parts = ["0::int"]
    if pq.phone_key:
        parts.append(f"CASE WHEN public.kp_phone_key({c}.telephone) = {P.add(pq.phone_key)} THEN 700 ELSE 0 END")
        parts.append(_phone_full_score(pq, P, c))
    phones, prefixes = _all(pq.words, "phone"), _all(pq.words, "prefixes")
    if phones:
        parts.append(f"CASE WHEN {_any(f'public.kp_phone_digits({c}.telephone)', P.add(phones))} THEN 300 ELSE 0 END")
    if prefixes:
        parts.append(f"CASE WHEN {_any(doc_sql(c, C_COLS), P.add(prefixes))} THEN 120 ELSE 0 END")
    return "(" + " + ".join(parts) + ")"


def devis_where_sql(pq: ParsedQuery, P: SqlParams, d: str = "d") -> str:
    if _code_and(pq):
        return f"{d}.ticket_id IN {matching_tickets_sql(pq, P)}"
    ors = []
    if pq.phone_key:
        ors.append(f"public.kp_phone_key({d}.client_tel) = {P.add(pq.phone_key)}")
    if pq.ticket_id and pq.ticket_explicit:
        ors.append(f"{d}.ticket_id = {P.add(pq.ticket_id)}")
    if pq.words:
        blocks = []
        for w in pq.words:
            ors_w = [_any(doc_sql(d, DEVIS_COLS), P.add(w.patterns))]
            if w.phone:
                ors_w.append(_any(f"public.kp_phone_digits({d}.client_tel)", P.add(w.phone)))
            blocks.append("(" + " OR ".join(ors_w) + ")")
        ors.append("(" + " AND ".join(blocks) + ")")
    return "(" + " OR ".join(ors) + ")" if ors else "FALSE"


def commande_where_sql(pq: ParsedQuery, P: SqlParams, cp: str = "cp", t: str = "t", c: str = "c") -> str:
    """Commandes de pièces : texte de la commande, client et appareil du ticket lié."""
    if _code_and(pq):
        return f"{cp}.ticket_id IN {matching_tickets_sql(pq, P)}"
    ors = []
    if pq.ticket_id:
        ors.append(f"{cp}.ticket_id = {P.add(pq.ticket_id)}")
    if pq.imei:
        ors.append(_imei_exact_sql(t, "imei", P.add(pq.imei)))
    if pq.phone_key:
        ors.append(f"public.kp_phone_key({c}.telephone) = {P.add(pq.phone_key)}")
    if pq.words:
        blocks = []
        for w in pq.words:
            p = P.add(w.patterns)
            ors_w = [
                _any(doc_sql(cp, CMD_COLS), p),
                _any(doc_sql(c, C_COLS), p),
                _any(doc_sql(t, T_DEVICE_COLS), p),
            ]
            if w.compact:
                ors_w.append(_any(compact_sql(doc_sql(t, T_DEVICE_COLS)), P.add(w.compact)))
            blocks.append("(" + " OR ".join(ors_w) + ")")
        ors.append("(" + " AND ".join(blocks) + ")")
    return _with_homonyms("(" + " OR ".join(ors) + ")" if ors else "FALSE", pq, P, f"{c}.id")


# ─── EXPLICATION DE LA CORRESPONDANCE ────────────────────────────
_CLIENT_FIELDS = (("client_nom", "nom"), ("client_prenom", "prénom"), ("client_societe", "société"),
                  ("client_email", "email"))
_DEVICE_FIELDS = (("marque", "marque"), ("modele", "modèle"), ("modele_autre", "modèle"),
                  ("categorie", "catégorie"), ("telephone_pret", "téléphone de prêt"))
_WORK_FIELDS = (("panne", "panne"), ("panne_detail", "détail panne"), ("reparation_supp", "réparation"),
                ("type_ecran", "type d'écran"), ("technicien_assigne", "technicien"),
                ("notes_internes", "note interne"), ("notes_client", "note client"),
                ("commentaire_client", "commentaire"), ("attention", "attention"))


def _word_label(w: Word, row: dict, fallback: bool = True) -> Optional[str]:
    """Champ où le mot a été trouvé ; sinon « note » (notes_tickets, absentes de row),
    ou None si fallback=False."""
    def hit(value, patterns):
        doc = doc_text(value)
        return any(like_match(p, doc) for p in patterns)

    for key, label in _CLIENT_FIELDS:
        if hit(row.get(key), w.patterns):
            return label
    if w.phone and any(like_match(p, phone_digits(row.get("client_tel"))) for p in w.phone):
        return "téléphone"
    for key, label in _DEVICE_FIELDS:
        if hit(row.get(key), w.patterns):
            return label
    if w.compact:
        device = doc_text(*(row.get(k) for k, _ in _DEVICE_FIELDS)).replace(" ", "")
        if any(like_match(p, device) for p in w.compact):
            return "modèle"
    if w.imei:
        if any(like_match(p, alnum(row.get("imei"))) for p in w.imei):
            return "IMEI"
        if any(like_match(p, alnum(row.get("telephone_pret_imei"))) for p in w.imei):
            return "IMEI prêt"
    for key, label in _WORK_FIELDS:
        if hit(row.get(key), w.patterns):
            return label
    if not fallback:
        return None
    return "approché" if w.trgm else "note"


def ticket_match_label(pq: ParsedQuery, row: dict) -> str:
    """Court texte expliquant ce qui a correspondu (« IMEI », « nom, modèle »…)."""
    labels = []
    if pq.ticket_id and (row.get("id") == pq.ticket_id or row.get("ticket_code") == pq.ticket_code):
        labels.append("code ticket")
    elif pq.code_prefix and like_match(pq.code_prefix, row.get("ticket_code") or ""):
        labels.append("code ticket")
    if pq.imei:
        if alnum(row.get("imei")) == pq.imei:
            labels.append("IMEI")
        elif alnum(row.get("telephone_pret_imei")) == pq.imei:
            labels.append("IMEI prêt")
    if pq.phone_key and phone_key(row.get("client_tel")) == pq.phone_key:
        labels.append("téléphone")
    emplacement = _emplacement_trouve(pq, row)
    if emplacement:
        labels.append("emplacement")
    if not labels or pq.code_and or not (pq.numeric or pq.ticket_id):
        for w in pq.words:
            # Trouvé par l'emplacement : un mot sans champ correspondant n'est pas « note »
            lab = _word_label(w, row, fallback=not emplacement)
            if lab:
                labels.append(lab)
    out = []
    for lab in labels:
        if lab not in out:
            out.append(lab)
    text = ", ".join(out) or "recherche"
    return text + " (approché)" if pq.fuzzy and "approché" not in text else text
