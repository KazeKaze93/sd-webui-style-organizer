"""
CivitAI title enrichment for LoRA cards — opt-in, manual trigger only.

The local metadata json CivitAI Browser+ writes next to each LoRA (see
stylegrid.lora_scan._read_user_metadata) has `modelId` but not the model's
actual display title (e.g. "Balalaika ... | Black Lagoon ... | Illustrious")
— that only exists on the CivitAI page itself. This module fetches it from
the public, unauthenticated `GET /api/v1/models/{id}` endpoint.

Never runs automatically — only via POST /style_grid/lora/fetch_titles,
so an offline setup never makes an unexpected outbound request. If a
CivitAI API key is configured for CivitAI Browser+ (opts.custom_api_key),
it's reused for a better rate-limit tier; otherwise requests go
unauthenticated, which the endpoint fully supports.

Results are cached to disk (data/lora_titles.json) keyed by modelId, so a
given model is fetched at most once across the lifetime of the install
(barring an explicit force-refetch).
"""

import concurrent.futures
import json
import os
import threading
import time
import urllib.error
import urllib.request

from stylegrid.config import DATA_DIR

TITLES_CACHE_FILE = os.path.join(DATA_DIR, "lora_titles.json")
API_BASE = "https://civitai.com/api/v1/models/"
REQUEST_TIMEOUT = 10
MAX_WORKERS = 1  # sequential: CivitAI's edge 429s hard under any concurrency
MIN_REQUEST_INTERVAL = 1.5  # seconds between requests, enforced regardless of worker count
MAX_429_RETRIES = 4
FALLBACK_BACKOFF = (2, 4, 8, 16)  # seconds, used when the server sends no Retry-After

_lock = threading.Lock()
_rate_lock = threading.Lock()
_last_request_at = 0.0
_cache = None  # lazy: {str(model_id): {"name": str, "fetched_at": float} | {"error": str, "fetched_at": float}}


def _load_cache():
    global _cache
    if _cache is not None:
        return _cache
    if os.path.isfile(TITLES_CACHE_FILE):
        try:
            with open(TITLES_CACHE_FILE, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            _cache = loaded if isinstance(loaded, dict) else {}
        except Exception:
            _cache = {}
    else:
        _cache = {}
    return _cache


def _save_cache():
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = TITLES_CACHE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_cache, f, indent=2, ensure_ascii=False)
        os.replace(tmp, TITLES_CACHE_FILE)
    except Exception:
        pass


def get_cached_title(model_id):
    """Cached CivitAI title for a modelId, or None if never fetched, errored,
    or model_id is falsy."""
    if not model_id:
        return None
    with _lock:
        entry = _load_cache().get(str(model_id))
    return entry.get("name") if isinstance(entry, dict) else None


def _api_key():
    try:
        from modules import shared  # type: ignore[reportMissingImports]
        return shared.opts.data.get("custom_api_key", "") or ""
    except Exception:
        return ""


def _throttle():
    """Enforce MIN_REQUEST_INTERVAL between consecutive outbound requests,
    regardless of how many worker threads call this concurrently.
    """
    global _last_request_at
    with _rate_lock:
        wait = MIN_REQUEST_INTERVAL - (time.time() - _last_request_at)
        if wait > 0:
            time.sleep(wait)
        _last_request_at = time.time()


def _fetch_one(model_id):
    """GET the model's title from CivitAI's public API.
    Returns (name, None) on success or (None, error_message) on failure.

    Headers matter here: CivitAI's edge (Cloudflare/WAF) returns HTTP 403
    for urllib's default "Python-urllib/x.y" User-Agent, treating it as a
    bot. Mirrors the header set CivitAI Browser+ itself sends (which does
    not get blocked) rather than urllib's defaults.

    Retries on HTTP 429 (rate limit), honoring Retry-After when present and
    falling back to fixed backoff steps otherwise. Any other error is not
    retried here — it's recorded and will be retried on the next manual run
    (see TitleFetchManager._run's pending filter).
    """
    req = urllib.request.Request(API_BASE + str(model_id))
    req.add_header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    )
    req.add_header("Accept", "application/json")
    key = _api_key()
    if key:
        req.add_header("Authorization", f"Bearer {key}")

    attempt = 0
    while True:
        _throttle()
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            name = data.get("name") if isinstance(data, dict) else None
            return (name, None) if name else (None, "no name in response")
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < MAX_429_RETRIES:
                retry_after = e.headers.get("Retry-After") if e.headers else None
                try:
                    delay = float(retry_after) if retry_after else FALLBACK_BACKOFF[
                        min(attempt, len(FALLBACK_BACKOFF) - 1)
                    ]
                except ValueError:
                    delay = FALLBACK_BACKOFF[min(attempt, len(FALLBACK_BACKOFF) - 1)]
                time.sleep(min(delay, 30))
                attempt += 1
                continue
            return None, f"HTTP {e.code}"
        except Exception as e:
            return None, str(e)


class TitleFetchManager:
    """Background job: fetch missing CivitAI titles for a given set of
    modelIds. Mirrors stylegrid.thumbnails.ThumbnailGenerationManager's
    status/lock pattern (single job at a time, pollable status dict).
    """

    def __init__(self):
        self._status = {"status": "idle", "done": 0, "total": 0, "errors": 0}
        self._status_lock = threading.Lock()

    def get_status(self):
        with self._status_lock:
            return dict(self._status)

    def try_begin(self):
        with self._status_lock:
            if self._status.get("status") == "running":
                return False
            self._status = {"status": "running", "done": 0, "total": 0, "errors": 0}
            return True

    def spawn(self, model_ids, force=False):
        t = threading.Thread(target=self._run, args=(list(model_ids), force), daemon=True)
        t.start()

    def _run(self, model_ids, force):
        cache = _load_cache()
        pending = []
        seen = set()
        for mid in model_ids:
            if mid in seen:
                continue
            seen.add(mid)
            if not force:
                entry = cache.get(str(mid))
                # Only a prior *successful* fetch counts as "already done" —
                # an error-only entry (e.g. a transient 403/timeout) must
                # still be retried on the next run without needing force=True.
                if isinstance(entry, dict) and entry.get("name"):
                    continue
            pending.append(mid)

        with self._status_lock:
            self._status["total"] = len(pending)

        errors = 0
        if pending:
            with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
                futures = {pool.submit(_fetch_one, mid): mid for mid in pending}
                for fut in concurrent.futures.as_completed(futures):
                    mid = futures[fut]
                    name, err = fut.result()
                    with _lock:
                        if name:
                            cache[str(mid)] = {"name": name, "fetched_at": time.time()}
                        else:
                            cache[str(mid)] = {"error": err or "unknown", "fetched_at": time.time()}
                            errors += 1
                        _save_cache()
                    with self._status_lock:
                        self._status["done"] += 1
                        self._status["errors"] = errors

        with self._status_lock:
            self._status["status"] = "done"

        # Titles are read into Style dicts at scan time (lora_scan._scan),
        # so the in-memory lora cache must be dropped for the new titles to
        # actually show up on the next /style_grid/styles fetch.
        from stylegrid.lora_scan import invalidate_lora_cache
        invalidate_lora_cache()


title_fetch_manager = TitleFetchManager()
