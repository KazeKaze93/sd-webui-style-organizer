"""Unit tests for thumbnail identity (name + source) and legacy migration."""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import pytest

from stylegrid import config as sg_config
from stylegrid import source_ids
from stylegrid import thumbnails as sg_thumbs
from stylegrid.thumbnails import (
    FINISHED_JOB_TTL_SECONDS,
    MAX_PENDING_THUMBNAIL_JOBS,
    ThumbnailGenerationManager,
    ThumbnailQueueFullError,
)


@pytest.fixture
def thumbs_dir(tmp_path, monkeypatch):
    d = tmp_path / "thumbnails"
    d.mkdir()
    monkeypatch.setattr(sg_thumbs, "THUMBNAILS_DIR", str(d))
    monkeypatch.setattr(sg_thumbs, "get_styles_dirs", lambda: [str(tmp_path)])
    monkeypatch.setattr(sg_thumbs, "discover_renamed_old_names", lambda: set())
    return d


@pytest.fixture
def source_id_roots(tmp_path, monkeypatch, thumbs_dir):
    """EXT_DIR with styles/ + samples/ so to_source_id yields distinct ids."""
    ext = tmp_path / "ext"
    (ext / "styles").mkdir(parents=True)
    (ext / "samples").mkdir(parents=True)
    webui = tmp_path / "webui_data"
    webui.mkdir()
    monkeypatch.setattr(sg_config, "EXT_DIR", str(ext))
    monkeypatch.setattr(source_ids, "webui_styles_root", lambda: str(webui))
    monkeypatch.setattr(sg_config, "_get_webui_data_path", lambda: str(webui))
    styles_dir = ext / "styles"
    samples_dir = ext / "samples"
    monkeypatch.setattr(
        sg_thumbs, "get_styles_dirs", lambda: [str(styles_dir), str(samples_dir)]
    )
    return {
        "ext": ext,
        "styles": styles_dir,
        "samples": samples_dir,
        "webui": webui,
        "thumbs": thumbs_dir,
    }


def _write_legacy(thumbs_dir, name, payload=b"LEGACY"):
    path = thumbs_dir / f"{sg_thumbs.legacy_thumbnail_stem(name)}.webp"
    path.write_bytes(payload)
    return path


def _write_rel(thumbs_dir, name, source, payload=b"REL"):
    path = thumbs_dir / f"{sg_thumbs._legacy_rel_stem(name, source)}.webp"
    path.write_bytes(payload)
    return path


def _prod_replace_thumb(path: Path, payload: bytes):
    """Match generation write: tmp file, remove destination, rename into place."""
    tmp = Path(str(path) + ".tmp")
    tmp.write_bytes(payload)
    if path.is_file():
        path.unlink()
    tmp.rename(path)


def test_hash_keys_differ_across_source_files(thumbs_dir, tmp_path):
    a = str(tmp_path / "pony.csv")
    b = str(tmp_path / "illustrious.csv")
    name = "BASE_Anti_Futa"
    assert sg_thumbs.thumbnail_hash_key(name, a) != sg_thumbs.thumbnail_hash_key(name, b)
    assert sg_thumbs.thumbnail_hash_key(name, a) != sg_thumbs.legacy_thumbnail_stem(name)


def test_furry_futa_labeled_styles_are_independent(thumbs_dir, tmp_path):
    src = str(tmp_path / "pack.csv")
    keys = {
        sg_thumbs.thumbnail_hash_key("BODY_Ears", src),
        sg_thumbs.thumbnail_hash_key("BODY_FURRY_Ears", src),
        sg_thumbs.thumbnail_hash_key("BODY_FUTA_Ears", src),
    }
    assert len(keys) == 3
    legacy_base = _write_legacy(thumbs_dir, "BODY_Ears", b"BASE")
    styles = [
        {"name": "BODY_Ears", "source_file": src, "prompt": "ears", "negative_prompt": ""},
        {
            "name": "BODY_FURRY_Ears",
            "source_file": src,
            "prompt": "animal ears",
            "negative_prompt": "",
        },
    ]
    result = sg_thumbs.migrate_legacy_thumbnails(styles)
    assert result["migrated"] == 1
    assert Path(sg_thumbs.get_thumbnail_path("BODY_Ears", src)).read_bytes() == b"BASE"
    assert not Path(sg_thumbs.get_thumbnail_path("BODY_FURRY_Ears", src)).exists()
    assert legacy_base.exists()


def test_migrate_unique_name_copies_legacy_file(thumbs_dir, tmp_path):
    src = str(tmp_path / "only.csv")
    name = "CAMERA_Closeup"
    legacy = _write_legacy(thumbs_dir, name)
    styles = [
        {"name": name, "source_file": src, "prompt": "closeup", "negative_prompt": ""}
    ]
    result = sg_thumbs.migrate_legacy_thumbnails(styles)
    assert result["migrated"] == 1
    assert result["need_regeneration"] == 0
    assert legacy.exists()
    new_path = Path(sg_thumbs.get_thumbnail_path(name, src))
    assert new_path.exists()
    assert new_path.read_bytes() == b"LEGACY"


def test_migrate_identical_multi_file_copies_to_both_keys(thumbs_dir, tmp_path):
    a = str(tmp_path / "pony.csv")
    b = str(tmp_path / "illustrious.csv")
    name = "LIGHTING_Rim"
    legacy = _write_legacy(thumbs_dir, name, b"SHARED")
    styles = [
        {"name": name, "source_file": a, "prompt": "rim light", "negative_prompt": "flat"},
        {"name": name, "source_file": b, "prompt": "rim light", "negative_prompt": "flat"},
    ]
    result = sg_thumbs.migrate_legacy_thumbnails(styles)
    assert result["migrated"] == 1
    assert result["need_regeneration"] == 0
    assert legacy.exists()
    assert Path(sg_thumbs.get_thumbnail_path(name, a)).read_bytes() == b"SHARED"
    assert Path(sg_thumbs.get_thumbnail_path(name, b)).read_bytes() == b"SHARED"


def test_migrate_diverging_multi_file_does_not_guess(thumbs_dir, tmp_path):
    a = str(tmp_path / "pony.csv")
    b = str(tmp_path / "illustrious.csv")
    name = "BASE_Anti_3D"
    legacy = _write_legacy(thumbs_dir, name, b"SHARED")
    styles = [
        {"name": name, "source_file": a, "prompt": "", "negative_prompt": "3d"},
        {"name": name, "source_file": b, "prompt": "", "negative_prompt": "3d, realistic"},
    ]
    result = sg_thumbs.migrate_legacy_thumbnails(styles)
    assert result["migrated"] == 0
    assert result["need_regeneration"] == 1
    assert legacy.exists()
    assert not Path(sg_thumbs.get_thumbnail_path(name, a)).exists()
    assert not Path(sg_thumbs.get_thumbnail_path(name, b)).exists()


def test_migrate_renamed_old_name_needs_regeneration(thumbs_dir, tmp_path):
    src = str(tmp_path / "furry.csv")
    name = "ACTION_Rimjob"
    legacy = _write_legacy(thumbs_dir, name)
    styles = [
        {"name": name, "source_file": src, "prompt": "rimjob", "negative_prompt": ""}
    ]
    result = sg_thumbs.migrate_legacy_thumbnails(
        styles, renamed_old_names={name}
    )
    assert result["migrated"] == 0
    assert result["need_regeneration"] == 1
    assert legacy.exists()
    assert not Path(sg_thumbs.get_thumbnail_path(name, src)).exists()


def test_migrate_orphan_name_category(thumbs_dir, tmp_path):
    gone = "DELETED_Style"
    legacy = _write_legacy(thumbs_dir, gone)
    keep_src = str(tmp_path / "keep.csv")
    styles = [
        {
            "name": "KEEP_Style",
            "source_file": keep_src,
            "prompt": "x",
            "negative_prompt": "",
        }
    ]
    result = sg_thumbs.migrate_legacy_thumbnails(
        styles, legacy_names=[gone, "KEEP_Style"]
    )
    assert result["orphaned"] == 1
    assert result["migrated"] == 0
    assert legacy.exists()


def test_migrate_second_run_is_idempotent(thumbs_dir, tmp_path):
    a = str(tmp_path / "pony.csv")
    b = str(tmp_path / "illustrious.csv")
    name = "POSE_Standing"
    legacy = _write_legacy(thumbs_dir, name, b"ONCE")
    styles = [
        {"name": name, "source_file": a, "prompt": "standing", "negative_prompt": ""},
        {"name": name, "source_file": b, "prompt": "standing", "negative_prompt": ""},
    ]
    first = sg_thumbs.migrate_legacy_thumbnails(styles)
    second = sg_thumbs.migrate_legacy_thumbnails(styles)
    assert first["migrated"] == 1
    assert second["migrated"] == 0
    assert second["skipped_existing"] == 1
    assert legacy.exists()
    assert Path(sg_thumbs.get_thumbnail_path(name, a)).read_bytes() == b"ONCE"
    assert Path(sg_thumbs.get_thumbnail_path(name, b)).read_bytes() == b"ONCE"


def test_list_thumbnails_is_source_aware(thumbs_dir, tmp_path, monkeypatch):
    a = str(tmp_path / "pony.csv")
    b = str(tmp_path / "illustrious.csv")
    name = "POSE_Standing"
    Path(sg_thumbs.get_thumbnail_path(name, a)).write_bytes(b"A")
    styles = [
        {"name": name, "source_file": a, "prompt": "standing", "negative_prompt": ""},
        {"name": name, "source_file": b, "prompt": "standing", "negative_prompt": ""},
    ]
    monkeypatch.setattr(sg_thumbs, "get_cached_styles", lambda: styles)
    listed = sg_thumbs.list_thumbnails()
    assert listed == [{"name": name, "source_file": a}]


@pytest.fixture
def blocked_thumb_mgr():
    """Fresh manager whose _run_generation blocks until the release event is set."""
    release = threading.Event()
    mgr = ThumbnailGenerationManager()

    def _block(_name, _source):
        if not release.wait(timeout=30):
            raise TimeoutError("blocked_thumb_mgr release was not set")

    mgr._run_generation = _block
    try:
        yield mgr, release
    finally:
        release.set()


def _wait_status(mgr, job_id, wanted, timeout=2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = mgr.get_status(job_id).get("status")
        if status == wanted:
            return status
        time.sleep(0.01)
    return mgr.get_status(job_id).get("status")


def test_enqueue_rejects_when_pending_cap_reached(blocked_thumb_mgr):
    mgr, release = blocked_thumb_mgr
    ids = [mgr.enqueue(f"n{i}", "src.csv") for i in range(MAX_PENDING_THUMBNAIL_JOBS)]
    assert _wait_status(mgr, ids[0], "running") == "running"
    with pytest.raises(ThumbnailQueueFullError):
        mgr.enqueue("overflow", "src.csv")
    assert mgr.cancel(ids[-1]) is True
    again = mgr.enqueue("again", "src.csv")
    assert again
    assert mgr.get_status(again)["status"] in ("queued", "running")
    release.set()


def test_prune_drops_finished_past_ttl(blocked_thumb_mgr):
    mgr, release = blocked_thumb_mgr
    release.set()
    mgr._run_generation = lambda _n, _s: None
    old_id = mgr.enqueue("old", "src.csv")
    assert _wait_status(mgr, old_id, "done") == "done"
    with mgr._lock:
        mgr._jobs[old_id]["finished_at"] = time.monotonic() - FINISHED_JOB_TTL_SECONDS - 1
    fresh = mgr.enqueue("fresh", "src.csv")
    assert fresh
    assert mgr.get_status(old_id) == {"status": "error", "message": "unknown job_id"}
    assert _wait_status(mgr, fresh, "done") == "done"


def test_prune_never_drops_queued_or_running(blocked_thumb_mgr):
    mgr, release = blocked_thumb_mgr
    running_id = mgr.enqueue("run", "src.csv")
    assert _wait_status(mgr, running_id, "running") == "running"
    queued_id = mgr.enqueue("queued", "src.csv")
    assert mgr.get_status(queued_id)["status"] == "queued"
    with mgr._lock:
        mgr._prune_finished_locked()
        assert running_id in mgr._jobs
        assert queued_id in mgr._jobs
        assert mgr._jobs[running_id]["status"] == "running"
        assert mgr._jobs[queued_id]["status"] == "queued"
    release.set()


def test_same_filename_two_roots_yield_two_stems(source_id_roots):
    styles_csv = str(source_id_roots["styles"] / "pack.csv")
    samples_csv = str(source_id_roots["samples"] / "pack.csv")
    Path(styles_csv).write_text("name,prompt\n", encoding="utf-8")
    Path(samples_csv).write_text("name,prompt\n", encoding="utf-8")
    name = "POSE_Standing"
    assert source_ids.to_source_id(styles_csv) == "styles/pack.csv"
    assert source_ids.to_source_id(samples_csv) == "samples/pack.csv"
    ka = sg_thumbs.thumbnail_hash_key(name, styles_csv)
    kb = sg_thumbs.thumbnail_hash_key(name, samples_csv)
    assert ka != kb
    assert sg_thumbs._legacy_rel_stem(name, styles_csv) == sg_thumbs._legacy_rel_stem(
        name, samples_csv
    )


def test_migrate_rel_unique_source_places_new_keeps_old(source_id_roots):
    thumbs = source_id_roots["thumbs"]
    src = str(source_id_roots["styles"] / "only.csv")
    Path(src).write_text("name,prompt\n", encoding="utf-8")
    name = "CAMERA_Closeup"
    old = _write_rel(thumbs, name, src, b"UNIQUE")
    styles = [
        {"name": name, "source_file": src, "prompt": "closeup", "negative_prompt": ""}
    ]
    result = sg_thumbs.migrate_rel_thumbnails(styles)
    new_path = Path(sg_thumbs.get_thumbnail_path(name, src))
    assert result["need_regeneration"] == 0
    assert result["linked"] + result["copied"] == 1
    assert old.exists()
    assert new_path.exists()
    assert new_path.read_bytes() == b"UNIQUE"
    assert old.read_bytes() == b"UNIQUE"


def test_migrate_rel_identical_multi_source_places_every_stem(source_id_roots):
    thumbs = source_id_roots["thumbs"]
    a = str(source_id_roots["styles"] / "pack.csv")
    b = str(source_id_roots["samples"] / "pack.csv")
    Path(a).write_text("name,prompt\n", encoding="utf-8")
    Path(b).write_text("name,prompt\n", encoding="utf-8")
    name = "LIGHTING_Rim"
    old = _write_rel(thumbs, name, a, b"SHARED")
    styles = [
        {"name": name, "source_file": a, "prompt": "rim light", "negative_prompt": "flat"},
        {"name": name, "source_file": b, "prompt": "rim light", "negative_prompt": "flat"},
    ]
    result = sg_thumbs.migrate_rel_thumbnails(styles)
    assert result["need_regeneration"] == 0
    assert result["linked"] + result["copied"] == 2
    assert old.exists()
    assert Path(sg_thumbs.get_thumbnail_path(name, a)).read_bytes() == b"SHARED"
    assert Path(sg_thumbs.get_thumbnail_path(name, b)).read_bytes() == b"SHARED"


def test_migrate_rel_diverging_multi_source_needs_regeneration(source_id_roots):
    thumbs = source_id_roots["thumbs"]
    a = str(source_id_roots["styles"] / "pack.csv")
    b = str(source_id_roots["samples"] / "pack.csv")
    Path(a).write_text("name,prompt\n", encoding="utf-8")
    Path(b).write_text("name,prompt\n", encoding="utf-8")
    name = "BASE_Anti_3D"
    old = _write_rel(thumbs, name, a, b"SHARED")
    styles = [
        {"name": name, "source_file": a, "prompt": "", "negative_prompt": "3d"},
        {"name": name, "source_file": b, "prompt": "", "negative_prompt": "3d, realistic"},
    ]
    result = sg_thumbs.migrate_rel_thumbnails(styles)
    assert result["linked"] == 0
    assert result["copied"] == 0
    assert result["need_regeneration"] == 1
    assert old.exists()
    assert not Path(sg_thumbs.get_thumbnail_path(name, a)).exists()
    assert not Path(sg_thumbs.get_thumbnail_path(name, b)).exists()


def test_migrate_rel_existing_new_stem_never_overwritten(source_id_roots):
    thumbs = source_id_roots["thumbs"]
    src = str(source_id_roots["styles"] / "only.csv")
    Path(src).write_text("name,prompt\n", encoding="utf-8")
    name = "POSE_Existing"
    _write_rel(thumbs, name, src, b"OLD")
    new_path = Path(sg_thumbs.get_thumbnail_path(name, src))
    new_path.write_bytes(b"KEEP")
    styles = [
        {"name": name, "source_file": src, "prompt": "x", "negative_prompt": ""}
    ]
    result = sg_thumbs.migrate_rel_thumbnails(styles)
    assert result["linked"] == 0
    assert result["copied"] == 0
    assert result["skipped_existing"] == 1
    assert new_path.read_bytes() == b"KEEP"


def test_migrate_rel_second_run_linked_and_copied_zero(source_id_roots):
    thumbs = source_id_roots["thumbs"]
    src = str(source_id_roots["styles"] / "only.csv")
    Path(src).write_text("name,prompt\n", encoding="utf-8")
    name = "POSE_Idempotent"
    _write_rel(thumbs, name, src, b"ONCE")
    styles = [
        {"name": name, "source_file": src, "prompt": "x", "negative_prompt": ""}
    ]
    first = sg_thumbs.migrate_rel_thumbnails(styles)
    second = sg_thumbs.migrate_rel_thumbnails(styles)
    assert first["linked"] + first["copied"] == 1
    assert second["linked"] == 0
    assert second["copied"] == 0
    assert second["skipped_existing"] >= 1


def test_migrate_rel_hardlink_isolation_on_prod_write(source_id_roots):
    thumbs = source_id_roots["thumbs"]
    src = str(source_id_roots["styles"] / "only.csv")
    Path(src).write_text("name,prompt\n", encoding="utf-8")
    name = "POSE_Hardlink"
    old = _write_rel(thumbs, name, src, b"ORIGINAL")
    styles = [
        {"name": name, "source_file": src, "prompt": "x", "negative_prompt": ""}
    ]
    result = sg_thumbs.migrate_rel_thumbnails(styles)
    new_path = Path(sg_thumbs.get_thumbnail_path(name, src))
    assert result["linked"] + result["copied"] == 1
    assert new_path.exists()
    _prod_replace_thumb(new_path, b"NEWBYTES")
    assert old.read_bytes() == b"ORIGINAL"
    assert new_path.read_bytes() == b"NEWBYTES"


def test_migrate_rel_os_link_oserror_falls_back_to_copy2(source_id_roots, monkeypatch):
    thumbs = source_id_roots["thumbs"]
    src = str(source_id_roots["styles"] / "only.csv")
    Path(src).write_text("name,prompt\n", encoding="utf-8")
    name = "POSE_CopyFallback"
    _write_rel(thumbs, name, src, b"COPYME")
    styles = [
        {"name": name, "source_file": src, "prompt": "x", "negative_prompt": ""}
    ]

    def _boom(*_a, **_k):
        raise OSError("no hardlinks")

    monkeypatch.setattr(os, "link", _boom)
    result = sg_thumbs.migrate_rel_thumbnails(styles)
    assert result["copied"] == 1
    assert result["linked"] == 0
    assert Path(sg_thumbs.get_thumbnail_path(name, src)).read_bytes() == b"COPYME"


def test_thumbnail_hash_input_falls_back_when_to_source_id_none(source_id_roots, monkeypatch):
    src = str(source_id_roots["styles"] / "only.csv")
    Path(src).write_text("name,prompt\n", encoding="utf-8")
    assert source_ids.to_source_id(src) == "styles/only.csv"
    monkeypatch.setattr(sg_thumbs, "to_source_id", lambda _p: None)
    name = "FALLBACK_Style"
    assert sg_thumbs._thumbnail_hash_input(name, src) == sg_thumbs._legacy_rel_hash_input(
        name, src
    )


def test_name_only_legacy_migrates_to_source_id_stem(source_id_roots):
    thumbs = source_id_roots["thumbs"]
    src = str(source_id_roots["styles"] / "only.csv")
    Path(src).write_text("name,prompt\n", encoding="utf-8")
    name = "LEGACY_NameOnly"
    legacy = _write_legacy(thumbs, name, b"NAMEONLY")
    styles = [
        {"name": name, "source_file": src, "prompt": "x", "negative_prompt": ""}
    ]
    new_stem = sg_thumbs.thumbnail_hash_key(name, src)
    rel_stem = sg_thumbs._legacy_rel_stem(name, src)
    assert new_stem != rel_stem
    assert new_stem != sg_thumbs.legacy_thumbnail_stem(name)
    result = sg_thumbs.migrate_legacy_thumbnails(styles)
    assert result["migrated"] == 1
    new_path = Path(sg_thumbs.get_thumbnail_path(name, src))
    assert new_path.exists()
    assert new_path.name == f"{new_stem}.webp"
    assert new_path.read_bytes() == b"NAMEONLY"
    assert legacy.exists()
