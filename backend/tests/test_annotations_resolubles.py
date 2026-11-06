"""Chaque nom cité dans une annotation de fonction (module ou méthode) de `app/` est défini ou importé dans son
module. Sous Python 3.14 (poste de développement), les annotations ne sont plus évaluées à la définition (PEP 649) :
un `-> Optional[dict]` sans `from typing import Optional` passe inaperçu ici et fait planter l'import en production
(Railway, Python plus ancien) — déploiement du 06/11/2026 refusé par le healthcheck pour cette raison exacte."""

import ast
import builtins
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parents[1] / "app"
MODULES = sorted(p for p in RACINE.rglob("*.py") if "__pycache__" not in p.parts)


def _noms_lies(corps) -> set:
    """Noms liés au niveau d'un corps (module ou classe) : imports, définitions, affectations, y compris dans
    les blocs if / try / with / for de ce niveau (jamais dans les fonctions)."""
    noms = set()

    def cible(t):
        if isinstance(t, ast.Name):
            noms.add(t.id)
        elif isinstance(t, (ast.Tuple, ast.List)):
            for x in t.elts:
                cible(x)
        elif isinstance(t, ast.Starred):
            cible(t.value)

    def visiter(stmts):
        for s in stmts:
            if isinstance(s, (ast.Import, ast.ImportFrom)):
                for a in s.names:
                    if a.name == "*":
                        noms.add("*")
                    else:
                        noms.add((a.asname or a.name).split(".")[0])
            elif isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                noms.add(s.name)
            elif isinstance(s, ast.Assign):
                for t in s.targets:
                    cible(t)
            elif isinstance(s, (ast.AnnAssign, ast.AugAssign)):
                cible(s.target)
            elif isinstance(s, (ast.If, ast.Try, ast.With, ast.For, ast.While)):
                for champ in ("body", "orelse", "finalbody"):
                    visiter(getattr(s, champ, []) or [])
                for h in getattr(s, "handlers", []) or []:
                    visiter(h.body)
                    if getattr(h, "name", None):
                        noms.add(h.name)
            elif isinstance(s, ast.TryStar):
                visiter(s.body)
                visiter(s.orelse)
                visiter(s.finalbody)
                for h in s.handlers:
                    visiter(h.body)
    visiter(corps)
    return noms


def _noms_annotation(node) -> set:
    """Noms (racines) cités dans une annotation ; une annotation chaîne n'est pas évaluée."""
    out = set()
    if node is None or (isinstance(node, ast.Constant) and isinstance(node.value, str)):
        return out
    for n in ast.walk(node):
        if isinstance(n, ast.Name):
            out.add(n.id)
    return out


def _annotations(fn):
    args = fn.args
    for a in args.posonlyargs + args.args + args.kwonlyargs + [x for x in (args.vararg, args.kwarg) if x]:
        yield a.annotation
    yield fn.returns


def _manquants(module: ast.Module) -> list:
    builtin = set(dir(builtins))
    globaux = _noms_lies(module.body)
    if "*" in globaux:
        return []                  # import * : impossible à juger statiquement
    manquants = []

    def verifier(fn, disponibles, contexte):
        for ann in _annotations(fn):
            for nom in _noms_annotation(ann):
                if nom not in disponibles and nom not in builtin:
                    manquants.append(f"{contexte}{fn.name} (ligne {fn.lineno}) : {nom}")

    for s in module.body:
        if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef)):
            verifier(s, globaux, "")
        elif isinstance(s, ast.ClassDef):
            locaux = globaux | _noms_lies(s.body)
            for m in s.body:
                if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    verifier(m, locaux, f"{s.name}.")
    return manquants


@pytest.mark.parametrize("chemin", MODULES, ids=lambda p: str(p.relative_to(RACINE)))
def test_annotations_resolubles(chemin):
    module = ast.parse(chemin.read_text(encoding="utf-8"), filename=str(chemin))
    assert _manquants(module) == [], f"{chemin.relative_to(RACINE)} : nom(s) d'annotation non défini(s)"


def test_le_controle_detecte_un_optional_oublie():
    src = "from decimal import Decimal\n\ndef f(x: dict) -> Optional[dict]:\n    return None\n\nclass C:\n    def g(self, y: Decimal) -> 'Optional[int]':\n        return 1\n"
    assert _manquants(ast.parse(src)) == ["f (ligne 3) : Optional"]
    assert _manquants(ast.parse("from typing import *\n\ndef f() -> Optional[int]:\n    return None\n")) == []
