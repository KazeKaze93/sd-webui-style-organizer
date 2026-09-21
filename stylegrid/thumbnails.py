"""Thumbnail file paths, listing, and background SD preview generation."""

import csv
import hashlib
import os
import shutil
import threading
import time
import uuid
from collections import deque

from stylegrid.cache import get_cached_styles
from stylegrid.config import DATA_DIR, EXT_DIR, THUMBNAILS_DIR, get_styles_dirs

_RENAME_MAP_BASENAME = "RELEASE_NOTES_RENAMES.csv"


def _thumbnail_hash_input(style_name, csv_path=""):
    """Stable string for thumbnail filename hash; empty csv_path keeps legacy name-only hash."""
    if not csv_path:
        return style_name
    ap = os.path.normpath(os.path.abspath(csv_path))
    rel = None
    for base in get_styles_dirs():
        try:
            b = os.path.normpath(os.path.abspath(base))
            r = os.path.relpath(ap, b)
            if not r.startswith(".."):
                rel = r.replace("\\", "/")
                break
        except ValueError:
            continue
    if rel is None:
        rel = os.path.basename(ap).replace("\\", "/")
    return f"{style_name}::{rel}"


def thumbnail_hash_key(name: str, source: str) -> str:
    """Canonical thumbnail identity hash, matching generate_thumbnail's (name, source) scheme."""
    if not source:
        raise ValueError("thumbnail_hash_key requires a non-empty source")
    return hashlib.md5(_thumbnail_hash_input(name, source).encode("utf-8")).hexdigest()


def legacy_thumbnail_stem(style_name: str) -> str:
    """Pre-source-aware stem: md5(style name only)."""
    return hashlib.md5(_thumbnail_hash_input(style_name, "").encode("utf-8")).hexdigest()


def get_thumbnail_path(style_name, csv_path):
    """Return deterministic thumbnail file path using md5(name + source path) hash naming."""
    safe = thumbnail_hash_key(style_name, csv_path)
    return os.path.join(THUMBNAILS_DIR, safe + ".webp")


def load_renamed_old_names(path):
    """Return the set of old_name values from a RELEASE_NOTES_RENAMES.csv file."""
    names = set()
    if not path or not os.path.isfile(path):
        return names
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            old = (row.get("old_name") or "").strip()
            if old:
                names.add(old)
    return names


def discover_renamed_old_names():
    """Load rename old_names from data/ or extension root when the map file is present."""
    for base in (DATA_DIR, EXT_DIR):
        path = os.path.join(base, _RENAME_MAP_BASENAME)
        if os.path.isfile(path):
            return load_renamed_old_names(path)
    return set()


def _prompt_negative_pair(style):
    return (style.get("prompt") or "", style.get("negative_prompt") or "")


def _content_identical_across_sources(entries):
    """True when every source_file shares the same prompt+negative_prompt bytes."""
    per_source = {}
    for s in entries:
        source = s.get("source_file") or ""
        if not source:
            continue
        pair = _prompt_negative_pair(s)
        prev = per_source.get(source)
        if prev is None:
            per_source[source] = pair
        elif prev != pair:
            return False
    if len(per_source) <= 1:
        return True
    return len(set(per_source.values())) == 1


def migrate_legacy_thumbnails(styles=None, renamed_old_names=None, legacy_names=None):
    """Copy name-only thumbnail files to (name, source) keys when safe.

    Non-destructive: legacy WebPs are copied, never renamed or deleted.

    Auto-migrate when the name maps to one source, or to multiple sources whose
    prompt and negative_prompt are byte-identical. Need regeneration when content
    diverges across files, or when the name appears as old_name in a rename map.
    Orphaned: a legacy name with no matching style in the catalog.

    Returns migrated / need_regeneration / orphaned / skipped_existing.
    ``ambiguous`` is kept as an alias of need_regeneration for older callers.
    """
    empty = {
        "migrated": 0,
        "need_regeneration": 0,
        "orphaned": 0,
        "skipped_existing": 0,
        "ambiguous": 0,
    }
    if not os.path.isdir(THUMBNAILS_DIR):
        return empty

    if styles is None:
        styles = get_cached_styles()
    if renamed_old_names is None:
        renamed_old_names = discover_renamed_old_names()
    renamed_old_names = set(renamed_old_names)

    by_name = {}
    for s in styles:
        name = s.get("name") or ""
        source = s.get("source_file") or ""
        if not name or not source:
            continue
        # LoRA previews are sibling files, never name-only WebP hashes.
        if source == "__style_grid_lora__" or name.startswith("LORA_"):
            continue
        by_name.setdefault(name, []).append(s)

    if legacy_names is None:
        names_to_check = list(by_name.keys())
    else:
        names_to_check = list(dict.fromkeys(legacy_names))

    migrated = 0
    need_regeneration = 0
    orphaned = 0
    skipped_existing = 0
    for name in names_to_check:
        legacy_path = os.path.join(THUMBNAILS_DIR, legacy_thumbnail_stem(name) + ".webp")
        if not os.path.isfile(legacy_path):
            continue
        entries = by_name.get(name) or []
        if not entries:
            orphaned += 1
            continue
        if name in renamed_old_names:
            need_regeneration += 1
            continue
        uniq_sources = list(dict.fromkeys(s.get("source_file") or "" for s in entries))
        uniq_sources = [s for s in uniq_sources if s]
        if len(uniq_sources) > 1 and not _content_identical_across_sources(entries):
            need_regeneration += 1
            continue

        copied_any = False
        all_existed = True
        for source in uniq_sources:
            new_path = get_thumbnail_path(name, source)
            if os.path.isfile(new_path):
                continue
            all_existed = False
            try:
                shutil.copy2(legacy_path, new_path)
                copied_any = True
            except OSError:
                pass
        if copied_any:
            migrated += 1
        elif all_existed and uniq_sources:
            skipped_existing += 1

    return {
        "migrated": migrated,
        "need_regeneration": need_regeneration,
        "orphaned": orphaned,
        "skipped_existing": skipped_existing,
        "ambiguous": need_regeneration,
    }


def list_thumbnails():
    migrate_legacy_thumbnails()
    if not os.path.isdir(THUMBNAILS_DIR):
        return []
    hashes = {
        os.path.splitext(f)[0]
        for f in os.listdir(THUMBNAILS_DIR)
        if f.endswith(".webp")
    }
    result = []
    for s in get_cached_styles():
        source = s.get("source_file") or ""
        if not source:
            continue
        if thumbnail_hash_key(s["name"], source) in hashes:
            result.append({"name": s["name"], "source_file": source})
    return result


class ThumbnailGenerationManager:
    """FIFO single-worker thumbnail jobs: enqueue returns job_id; one process_images at a time."""

    def __init__(self):
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)
        self._queue = deque()  # job ids in FIFO order
        self._jobs = {}  # job_id -> record
        self._current_job_id = None
        self._worker = threading.Thread(target=self._worker_loop, daemon=True)
        self._worker.start()

    def enqueue(self, name, source):
        """Queue a generation job; returns job_id immediately (non-blocking)."""
        if not source:
            raise ValueError("enqueue requires a non-empty source")
        job_id = uuid.uuid4().hex
        record = {
            "id": job_id,
            "name": name,
            "source": source,
            "status": "queued",
            "message": None,
            "cancel_requested": False,
        }
        with self._cond:
            self._jobs[job_id] = record
            self._queue.append(job_id)
            self._cond.notify()
        return job_id

    def get_status(self, job_id):
        """Return job status fields, or an explicit unknown-job error (never idle)."""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return {"status": "error", "message": "unknown job_id"}
            return {
                "id": job["id"],
                "name": job["name"],
                "source": job["source"],
                "status": job["status"],
                "message": job["message"],
                "cancel_requested": job["cancel_requested"],
            }

    def cancel(self, job_id):
        """Cancel a queued job, or request cancel + best-effort interrupt if running."""
        with self._cond:
            job = self._jobs.get(job_id)
            if not job:
                return False
            status = job["status"]
            if status in ("done", "error", "cancelled"):
                return False
            if status == "queued":
                try:
                    self._queue.remove(job_id)
                except ValueError:
                    pass
                job["status"] = "cancelled"
                job["message"] = "cancelled before start"
                return True
            if status == "running":
                job["cancel_requested"] = True
                try:
                    from modules.shared import (
                        state as forge_state,  # type: ignore[reportMissingImports]
                    )
                    forge_state.interrupt()
                except Exception:
                    pass
                return True
            return False

    def _worker_loop(self):
        while True:
            with self._cond:
                while not self._queue:
                    self._cond.wait()
                job_id = self._queue.popleft()
                job = self._jobs.get(job_id)
                if not job or job["status"] == "cancelled":
                    continue
                if job.get("cancel_requested"):
                    job["status"] = "cancelled"
                    job["message"] = "cancelled before start"
                    continue
                name = job["name"]
                source = job["source"]

            # Soft-wait while main WebUI generation holds shared.state.job
            cancelled_while_waiting = False
            while True:
                with self._lock:
                    job = self._jobs.get(job_id)
                    if not job or job["status"] == "cancelled" or job.get("cancel_requested"):
                        if job and job["status"] != "cancelled":
                            job["status"] = "cancelled"
                            job["message"] = "cancelled while waiting for SD"
                        cancelled_while_waiting = True
                        break
                busy = False
                try:
                    from modules.shared import (
                        state as forge_state,  # type: ignore[reportMissingImports]
                    )
                    busy = bool(getattr(forge_state, "job", None))
                except Exception:
                    busy = False
                if not busy:
                    break
                time.sleep(0.5)
            if cancelled_while_waiting:
                continue

            with self._lock:
                job = self._jobs.get(job_id)
                if not job or job["status"] == "cancelled" or job.get("cancel_requested"):
                    if job and job["status"] != "cancelled":
                        job["status"] = "cancelled"
                        job["message"] = "cancelled before start"
                    continue
                job["status"] = "running"
                self._current_job_id = job_id

            try:
                self._run_generation(name, source)
                with self._lock:
                    job = self._jobs.get(job_id)
                    if not job:
                        pass
                    elif job.get("cancel_requested"):
                        # cancel_requested wins over done; keep any file already written
                        job["status"] = "cancelled"
                        job["message"] = "cancelled after generation"
                    else:
                        job["status"] = "done"
                        job["message"] = None
            except Exception as e:
                with self._lock:
                    job = self._jobs.get(job_id)
                    if job:
                        if job.get("cancel_requested"):
                            job["status"] = "cancelled"
                            job["message"] = str(e) or "cancelled"
                        else:
                            job["status"] = "error"
                            job["message"] = str(e)
            finally:
                with self._lock:
                    if self._current_job_id == job_id:
                        self._current_job_id = None

    def _run_generation(self, style_name, source_hint):
        """Resolve style and run SD preview; raises on failure. Does not update job status."""
        all_cached = get_cached_styles()
        style = None
        if source_hint and source_hint != "All":
            for s in all_cached:
                if s.get("name") == style_name and source_hint in (
                    s.get("source") or "", s.get("source_file") or ""
                ):
                    style = s
                    break
        if style is None:
            style_map = {s["name"]: s for s in all_cached}
            style = style_map.get(style_name)
        if not style:
            raise ValueError("Style not found")

        thumb_csv_path = style.get("source_file") or ""
        if not thumb_csv_path:
            raise ValueError("Style has no source_file")

        img_path = get_thumbnail_path(style_name, thumb_csv_path)
        tmp_path = img_path + ".tmp"

        prompt = style.get("prompt", "")
        prompt = prompt.replace("{prompt}", "1girl, solo")
        negative = style.get("negative_prompt", "")

        from modules import processing  # type: ignore[reportMissingImports]
        from modules.processing import (
            StableDiffusionProcessingTxt2Img,  # type: ignore[reportMissingImports]
        )
        from modules.shared import sd_model  # type: ignore[reportMissingImports]

        p = StableDiffusionProcessingTxt2Img(
            sd_model=sd_model,
            prompt=prompt,
            negative_prompt=negative,
            seed=-1,
            steps=20,
            cfg_scale=7,
            width=384,
            height=512,
            batch_size=1,
            n_iter=1,
            do_not_save_samples=True,
            do_not_save_grid=True,
            override_settings={"samples_filename_pattern": ""},
        )

        # Empty ScriptRunner — thumbnail generation must not trigger
        # extension scripts (Regional Prompter, ControlNet, etc.)
        # We only need p.scripts to not be None so Reforge's
        # process_images_inner can safely iterate alwayson_scripts.
        try:
            from modules.scripts import ScriptRunner
            p.scripts = ScriptRunner()
            p.scripts.scripts = []
            p.scripts.alwayson_scripts = []
            p.script_args = []
        except Exception:
            pass

        try:
            processed = processing.process_images(p)
        finally:
            p.close()

        if not processed.images:
            raise ValueError("No images returned")

        processed.images[0].save(tmp_path, "WEBP", quality=85)
        if os.path.isfile(img_path):
            os.remove(img_path)
        os.rename(tmp_path, img_path)


thumbnail_generation_manager = ThumbnailGenerationManager()
