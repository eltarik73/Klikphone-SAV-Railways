"""
Cache mémoire très court des réponses pollées (chat, notifications, interactions).

Plusieurs postes qui interrogent la même chose dans la même fenêtre partagent
une seule lecture en base. Toute écriture du domaine appelle invalidate() :
les lectures qui suivent sont donc toujours à jour dans ce processus ; la
durée de vie (quelques secondes) borne le retard des écritures faites ailleurs
(autre module qui ne prévient pas, autre worker).

Les réponses portent un ETag faible : le navigateur revalide (If-None-Match)
et reçoit un 304 sans corps quand rien n'a changé.
"""

import hashlib
import json
import threading
from time import monotonic

from fastapi import Request, Response


class PollCache:
    def __init__(self, ttl: float, max_entries: int = 500):
        self.ttl = ttl
        self.max_entries = max_entries
        self._data: dict = {}
        self._version = 0
        self._lock = threading.Lock()

    def invalidate(self):
        with self._lock:
            self._version += 1
            self._data.clear()

    def get(self, key, compute, with_headers: bool = False):
        """(corps JSON, etag, en-têtes) de compute(), recalculé au plus une fois par TTL.

        with_headers : compute() renvoie (contenu, en-têtes à joindre à la réponse).
        """
        now = monotonic()
        with self._lock:
            hit = self._data.get(key)
            if hit and hit[0] == self._version and now - hit[1] < self.ttl:
                return hit[2]
            version = self._version
        payload, headers = compute() if with_headers else (compute(), None)
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str)
        headers = headers or {}
        empreinte = body + json.dumps(headers, sort_keys=True)
        etag = 'W/"' + hashlib.sha1(empreinte.encode("utf-8")).hexdigest()[:20] + '"'
        entry = (body, etag, headers)
        with self._lock:
            # Une invalidation pendant le calcul rend ce résultat obsolète : on ne le garde pas
            if version == self._version:
                if len(self._data) >= self.max_entries:
                    self._data.clear()
                self._data[key] = (version, monotonic(), entry)
        return entry


def json_etag(request: Request, body: str, etag: str, headers: dict = None) -> Response:
    """Réponse JSON avec ETag, ou 304 si le navigateur a déjà cette version."""
    h = {"ETag": etag, "Cache-Control": "private, no-cache"}
    if headers:
        h.update(headers)
    if etag in (request.headers.get("if-none-match") or ""):
        return Response(status_code=304, headers=h)
    return Response(content=body, media_type="application/json", headers=h)


def cached_json(request: Request, cache: PollCache, key, compute, with_headers: bool = False) -> Response:
    body, etag, headers = cache.get(key, compute, with_headers)
    return json_etag(request, body, etag, headers)
