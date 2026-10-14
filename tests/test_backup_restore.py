"""Backup membership (metadata + optional thumbs) and restore with safety snapshot."""

from __future__ import annotations

import json
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
