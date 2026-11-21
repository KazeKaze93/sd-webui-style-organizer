"""Backup membership (metadata + optional thumbs) and restore with safety snapshot."""

from __future__ import annotations

import json
import os
import zipfile
from pathlib import Path

import pytest

from stylegrid import data_files as sg_data


@pytest.fixture
def backup_env(tmp_path, monkeypatch):
    """Isolate backup/restore under tmp_path with one CSV + all metadata files."""
    from stylegrid import config as sg_config

    data_dir = tmp_path / "data"
    styles_dir = tmp_path / "styles"
    thumbs_dir = data_dir / "thumbnails"
    backup_dir = data_dir / "backups"
    for d in (data_dir, styles_dir, thumbs_dir, backup_dir):
        d.mkdir(parents=True, exist_ok=True)

    csv_path = styles_dir / "pack.csv"
    csv_path.write_text(
        "name,prompt,negative_prompt,description,category\r\n"
        "A,tag_a,,,\r\n",
        encoding="utf-8-sig",
    )

    presets = data_dir / "presets.json"
    cat_order = data_dir / "category_order.json"
    favorites = data_dir / "favorites.json"
    recent = data_dir / "recent.json"
    presets.write_text(
        json.dumps(
            {
                "P1": {
                    "styles": [],
                    "wildcards": [],
                    "note": "",
                    "created": "2026-01-01T00:00:00",
                }
            }
        )
        + "\n",
        encoding="utf-8",
    )
    cat_order.write_text(json.dumps(["BASE", "BODY"]) + "\n", encoding="utf-8")
    favorites.write_text(json.dumps({"items": ["styles/pack.csv\0A"]}) + "\n", encoding="utf-8")
    recent.write_text(json.dumps({"items": ["styles/pack.csv\0A"]}) + "\n", encoding="utf-8")

    thumb = thumbs_dir / "preview.webp"
    thumb.write_bytes(b"WEBPFAKE")

    monkeypatch.setattr(sg_data, "EXT_DIR", str(tmp_path))
    monkeypatch.setattr(sg_data, "BACKUP_DIR", str(backup_dir))
    monkeypatch.setattr(sg_data, "PRESETS_FILE", str(presets))
    monkeypatch.setattr(sg_data, "CATEGORY_ORDER_FILE", str(cat_order))
    monkeypatch.setattr(sg_data, "FAVORITES_FILE", str(favorites))
    monkeypatch.setattr(sg_data, "RECENT_FILE", str(recent))
    monkeypatch.setattr(sg_data, "THUMBNAILS_DIR", str(thumbs_dir))
    monkeypatch.setattr(sg_config, "EXT_DIR", str(tmp_path))
    monkeypatch.setattr(sg_config, "BACKUP_DIR", str(backup_dir))
    monkeypatch.setattr(sg_config, "THUMBNAILS_DIR", str(thumbs_dir))
    monkeypatch.setattr(sg_data, "get_all_styles_file_paths", lambda: [str(csv_path)])

    return {
        "tmp": tmp_path,
        "csv": csv_path,
        "presets": presets,
        "cat_order": cat_order,
        "favorites": favorites,
        "recent": recent,
        "thumb": thumb,
        "backup_dir": backup_dir,
    }


def test_backup_includes_metadata_members(backup_env):
    result = sg_data.backup_csv_files(include_thumbnails=False, snapshot_name="20260101_120000")
    assert result["ok"] is True
    assert result["snapshot"] == "20260101_120000"
    members = set(result["members"])
    assert any(m.endswith("pack.csv") or m == "styles/pack.csv" for m in members)
    for name in (
        "presets.json",
        "category_order.json",
        "favorites.json",
        "recent.json",
    ):
        assert name in members
    assert "usage.json" not in members
    assert not any(m.startswith("thumbnails/") for m in members)
    assert result["thumbnails_bytes"] == 0

    snap_dir = Path(backup_env["backup_dir"]) / "20260101_120000"
    assert (snap_dir / "presets.json").is_file()
    assert (snap_dir / "favorites.json").is_file()
    assert (snap_dir.with_suffix(".zip")).is_file()


def test_backup_thumbnails_opt_in(backup_env):
    result = sg_data.backup_csv_files(include_thumbnails=True, snapshot_name="20260101_130000")
    assert result["ok"] is True
    assert any(m.startswith("thumbnails/") for m in result["members"])
    assert result["thumbnails_bytes"] == backup_env["thumb"].stat().st_size


def test_restore_creates_safety_and_restores_metadata(backup_env):
    # Initial snapshot with known favorites.
    created = sg_data.backup_csv_files(include_thumbnails=False, snapshot_name="20260101_140000")
    assert created["ok"] is True

    # Mutate live data after the snapshot.
    backup_env["favorites"].write_text(
        json.dumps({"items": ["mutated\0X"]}) + "\n",
        encoding="utf-8",
    )
    backup_env["csv"].write_text(
        "name,prompt,negative_prompt,description,category\r\n"
        "B,tag_b,,,\r\n",
        encoding="utf-8-sig",
    )

    restored = sg_data.restore_from_backup("20260101_140000", create_safety=True)
    assert restored["ok"] is True
    assert restored["safety_snapshot"]
    assert restored["safety_snapshot"].endswith("_safety") or restored["safety_snapshot"].endswith(
        "_safety2"
    )
    assert "favorites.json" in restored["restored"]
    assert "presets.json" in restored["restored"]

    fav = json.loads(backup_env["favorites"].read_text(encoding="utf-8"))
    assert fav["items"] == ["styles/pack.csv\0A"]

    csv_text = backup_env["csv"].read_text(encoding="utf-8-sig")
    assert "tag_a" in csv_text
    assert "tag_b" not in csv_text

    # Safety snapshot exists and captured the mutated favorites.
    safety_dir = Path(backup_env["backup_dir"]) / restored["safety_snapshot"]
    assert safety_dir.is_dir()
    safety_fav = json.loads((safety_dir / "favorites.json").read_text(encoding="utf-8"))
    assert safety_fav["items"] == ["mutated\0X"]

    listed = {b["name"] for b in sg_data.list_backups()}
    assert "20260101_140000" in listed
    assert restored["safety_snapshot"] in listed


def _snap(i):
    """Snapshot name for index *i*: names sort the same way as *i*."""
    return f"20260101_{i:06d}"


def _make_snapshots(count, start=0):
    return [
        sg_data.backup_csv_files(include_thumbnails=False, snapshot_name=_snap(start + i))["snapshot"]
        for i in range(count)
    ]


def _entries(backup_dir):
    return sorted(os.listdir(backup_dir))


def test_prune_keeps_newest_snapshots_with_folder_and_zip_together(backup_env):
    backup_dir = backup_env["backup_dir"]
    names = _make_snapshots(25)
    assert sg_data.BACKUP_KEEP_SNAPSHOTS == 20

    kept = [b["name"] for b in sg_data.list_backups()]
    assert kept == sorted(names[5:], reverse=True)
    # Every kept snapshot still has both its folder and its .zip.
    expected = sorted([n for n in names[5:]] + [f"{n}.zip" for n in names[5:]])
    assert _entries(backup_dir) == expected
    assert all(b["has_dir"] and b["has_zip"] for b in sg_data.list_backups())


def test_prune_counts_an_orphan_once_and_deletes_whole_snapshots(backup_env):
    backup_dir = Path(backup_env["backup_dir"])
    _make_snapshots(20)
    # Orphans: the oldest loses its .zip, the second oldest its folder.
    os.remove(backup_dir / f"{_snap(0)}.zip")
    import shutil

    shutil.rmtree(backup_dir / _snap(1))
    listed = [b["name"] for b in sg_data.list_backups()]
    assert len(listed) == 20

    _make_snapshots(2, start=20)
    listed = [b["name"] for b in sg_data.list_backups()]
    assert len(listed) == 20
    assert _snap(0) not in listed and _snap(1) not in listed
    assert not (backup_dir / _snap(0)).exists()
    assert not (backup_dir / f"{_snap(1)}.zip").exists()
    assert (backup_dir / _snap(2)).is_dir() and (backup_dir / f"{_snap(2)}.zip").is_file()


def test_prune_never_touches_unrelated_entries(backup_env):
    backup_dir = Path(backup_env["backup_dir"])
    unrelated = [
        backup_dir / "README.txt",
        backup_dir / "notes",
        backup_dir / "old-export.zip",
        backup_dir / "00000000_000000.txt",
    ]
    unrelated[0].write_text("keep", encoding="utf-8")
    unrelated[1].mkdir()
    unrelated[2].write_bytes(b"PK")
    unrelated[3].write_text("keep", encoding="utf-8")

    _make_snapshots(23)
    assert len(sg_data.list_backups()) == 20
    for path in unrelated:
        assert path.exists()


def test_restore_of_the_oldest_on_a_full_list(backup_env):
    backup_dir = Path(backup_env["backup_dir"])
    names = _make_snapshots(20)
    oldest = names[0]

    restored = sg_data.restore_from_backup(oldest, create_safety=True)

    assert restored["ok"] is True
    assert "favorites.json" in restored["restored"]
    # The target survived the call, the safety snapshot exists, the limit holds.
    assert (backup_dir / oldest).is_dir()
    assert (backup_dir / f"{oldest}.zip").is_file()
    listed = [b["name"] for b in sg_data.list_backups()]
    assert oldest in listed
    assert restored["safety_snapshot"] in listed
    assert len(listed) == sg_data.BACKUP_KEEP_SNAPSHOTS
    # The next oldest made room instead.
    assert names[1] not in listed


def test_list_backups_route_reports_the_limit(backup_env, monkeypatch):
    from fastapi import FastAPI
    from starlette.testclient import TestClient

    from stylegrid import routes

    monkeypatch.setattr(routes, "list_backups", lambda: [])
    monkeypatch.setattr(routes, "thumbnails_dir_size", lambda: 0)
    app = FastAPI()
    routes.register_api(None, app)
    with TestClient(app, base_url="http://127.0.0.1:7860") as client:
        body = client.get("/style_grid/backups").json()
    assert body["keep_snapshots"] == sg_data.BACKUP_KEEP_SNAPSHOTS == 20


@pytest.mark.parametrize(
    "arcname",
    [
        "scripts/style_grid.py",
        "stylegrid/routes.py",
        "install.py",
        "styles/../scripts/x.py",
        "styles\\..\\scripts\\x.py",
        "styles/sub/x.csv",
        "styles/x.py",
        "styles/",
        "C:/Windows/x.csv",
        "/etc/x.csv",
        "samples/x.csv",
        "external/foo/x.csv",
        "thumbnails/../x.webp",
        "thumbnails/abc.webp",
        "thumbnails/" + "a" * 32 + ".png",
        "thumbnails/sub/" + "a" * 32 + ".webp",
        "styles/a:b.csv",
        "",
    ],
)
def test_resolve_restore_dest_rejects_non_whitelist(backup_env, arcname):
    assert sg_data._resolve_restore_dest(arcname) is None


def test_resolve_restore_dest_allows_styles_and_thumbs(backup_env):
    style_dest = sg_data._resolve_restore_dest("styles/my.csv")
    assert style_dest == os.path.join(sg_data.EXT_DIR, "styles", "my.csv")

    thumb_leaf = "0123456789abcdef" * 2 + ".webp"
    thumb_dest = sg_data._resolve_restore_dest("thumbnails/" + thumb_leaf)
    assert thumb_dest == os.path.join(sg_data.THUMBNAILS_DIR, thumb_leaf)


@pytest.mark.parametrize(
    "basename",
    ["presets.json", "category_order.json", "favorites.json", "recent.json"],
)
def test_resolve_restore_dest_metadata_basenames(backup_env, basename):
    meta = dict(sg_data.metadata_backup_files())
    assert sg_data._resolve_restore_dest(basename) == meta[basename]


def test_restore_skips_non_whitelist_members(backup_env):
    snap_name = "20260101_000000"
    zip_path = Path(backup_env["backup_dir"]) / f"{snap_name}.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("styles/ok.csv", "name,prompt,negative_prompt,description,category\r\n")
        zf.writestr("scripts/evil.py", "print('evil')\n")
        zf.writestr("samples/s.csv", "name,prompt,negative_prompt,description,category\r\n")

    result = sg_data.restore_from_backup(snap_name, create_safety=False)
    assert "styles/ok.csv" in result["restored"]
    assert "scripts/evil.py" in result["skipped"]
    assert "samples/s.csv" in result["skipped"]
    assert not (backup_env["tmp"] / "scripts" / "evil.py").exists()
    assert not (backup_env["tmp"] / "samples" / "s.csv").exists()
