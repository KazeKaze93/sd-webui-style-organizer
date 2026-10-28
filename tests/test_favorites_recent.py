"""Server-side favorites/recent: migrate-once and subsequent reads."""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from stylegrid.routes import register_api


@pytest.fixture
def fav_recent_env(tmp_path, monkeypatch):
    from stylegrid import config as sg_config
    from stylegrid import data_files as sg_data

    fav_path = tmp_path / "favorites.json"
    recent_path = tmp_path / "recent.json"
    monkeypatch.setattr(sg_data, "FAVORITES_FILE", str(fav_path))
    monkeypatch.setattr(sg_data, "RECENT_FILE", str(recent_path))
    monkeypatch.setattr(sg_config, "FAVORITES_FILE", str(fav_path))
    monkeypatch.setattr(sg_config, "RECENT_FILE", str(recent_path))
    return sg_data, fav_path, recent_path


@pytest.fixture
def fav_client(fav_recent_env, tmp_csv, monkeypatch):
    _sg_data, _fav_path, _recent_path = fav_recent_env
    tmp_dir = str(tmp_csv.parent)

    def fake_get_styles_dirs():
        return [tmp_dir]

    def fake_get_all_styles_file_paths():
        return [str(tmp_csv)]

    from stylegrid import cache as sg_cache
    from stylegrid import config as sg_config
    from stylegrid import csv_io as sg_csv_io
    from stylegrid import thumbnails as sg_thumbs

    monkeypatch.setattr(sg_config, "get_styles_dirs", fake_get_styles_dirs)
    monkeypatch.setattr(sg_thumbs, "get_styles_dirs", fake_get_styles_dirs)
    monkeypatch.setattr(sg_config, "get_all_styles_file_paths", fake_get_all_styles_file_paths)
    monkeypatch.setattr(sg_csv_io, "get_all_styles_file_paths", fake_get_all_styles_file_paths)
    monkeypatch.setattr(sg_cache, "get_all_styles_file_paths", fake_get_all_styles_file_paths)

    from stylegrid.cache import invalidate_styles_cache

    invalidate_styles_cache()

    app = FastAPI()
    register_api(None, app)
    with TestClient(app, base_url="http://127.0.0.1:7860") as client:
        yield client


def test_migrate_favorites_once_then_server_read(fav_recent_env):
    sg_data, fav_path, _recent_path = fav_recent_env
    key = "D:/packs/a.csv\0BODY_Ears"

    items, persisted = sg_data.load_favorites()
    assert items == []
    assert persisted is False
    assert not fav_path.exists()

    migrated_items, migrated = sg_data.migrate_favorites_once([key, key, ""])
    assert migrated is True
    assert migrated_items == [key]
    assert fav_path.is_file()

    # Second migrate must not overwrite an existing server file.
    other = "D:/packs/b.csv\0BODY_Ears"
    again_items, again_migrated = sg_data.migrate_favorites_once([other])
    assert again_migrated is False
    assert again_items == [key]

    loaded, persisted2 = sg_data.load_favorites()
    assert persisted2 is True
    assert loaded == [key]
    on_disk = json.loads(fav_path.read_text(encoding="utf-8"))
    assert on_disk == {"items": [key]}


def test_migrate_recent_once_caps_and_subsequent_read(fav_recent_env):
    sg_data, _fav_path, recent_path = fav_recent_env
    keys = [f"src\0style_{i}" for i in range(15)]

    items, migrated = sg_data.migrate_recent_once(keys)
    assert migrated is True
    assert items == keys[:10]
    assert recent_path.is_file()

    loaded, persisted = sg_data.load_recent()
    assert persisted is True
    assert loaded == keys[:10]

    # Existing file wins over a later migrate attempt.
    items2, migrated2 = sg_data.migrate_recent_once(["src\0other"])
    assert migrated2 is False
    assert items2 == keys[:10]


def test_save_favorites_then_get_route(fav_client, fav_recent_env):
    _sg_data, fav_path, _recent_path = fav_recent_env
    key = "styles.csv\0Test Style A"

    r0 = fav_client.get("/style_grid/favorites")
    assert r0.status_code == 200
    assert r0.json() == {"items": [], "persisted": False, "ambiguous": []}

    r_mig = fav_client.post("/style_grid/favorites/migrate", json={"items": [key]})
    assert r_mig.status_code == 200
    body = r_mig.json()
    assert body["ok"] is True
    assert body["migrated"] is True
    assert body["items"] == [key]
    assert fav_path.is_file()

    r1 = fav_client.get("/style_grid/favorites")
    assert r1.status_code == 200
    body1 = r1.json()
    assert body1["items"] == [key]
    assert body1["persisted"] is True
    assert body1["ambiguous"] == []

    r_mig2 = fav_client.post(
        "/style_grid/favorites/migrate",
        json={"items": ["other\0X"]},
    )
    assert r_mig2.json()["migrated"] is False
    assert r_mig2.json()["items"] == [key]

    r_save = fav_client.post(
        "/style_grid/favorites/save",
        json={"items": [key, "styles.csv\0Test Style B"]},
    )
    assert r_save.status_code == 200
    assert r_save.json()["items"] == [key, "styles.csv\0Test Style B"]

    r2 = fav_client.get("/style_grid/favorites")
    assert r2.json()["items"] == [key, "styles.csv\0Test Style B"]


def test_recent_save_and_get_route(fav_client):
    keys = [f"src\0n{i}" for i in range(3)]
    r = fav_client.post("/style_grid/recent/save", json={"items": keys})
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["items"] == keys

    r2 = fav_client.get("/style_grid/recent")
    assert r2.status_code == 200
    assert r2.json() == {"items": keys, "persisted": True, "ambiguous": []}


def test_export_and_import_include_favorites_recent(fav_client, fav_recent_env):
    _sg_data, fav_path, recent_path = fav_recent_env
    fav_key = "styles.csv\0Test Style A"
    recent_key = "styles.csv\0Test Style B"
    assert fav_client.post("/style_grid/favorites/save", json={"items": [fav_key]}).status_code == 200
    assert fav_client.post("/style_grid/recent/save", json={"items": [recent_key]}).status_code == 200

    exported = fav_client.get("/style_grid/export").json()
    assert exported["favorites"] == [fav_key]
    assert exported["recent"] == [recent_key]
    assert "usage" not in exported
    assert "exported_at" in exported

    # Wipe server files, then import the export payload.
    fav_path.unlink()
    recent_path.unlink()
    assert fav_client.get("/style_grid/favorites").json()["persisted"] is False

    r_imp = fav_client.post(
        "/style_grid/import",
        json={
            "favorites": exported["favorites"],
            "recent": exported["recent"],
        },
    )
    assert r_imp.status_code == 200
    assert r_imp.json().get("ok") is True
    assert fav_client.get("/style_grid/favorites").json() == {
        "items": [fav_key],
        "persisted": True,
        "ambiguous": [],
    }
    assert fav_client.get("/style_grid/recent").json() == {
        "items": [recent_key],
        "persisted": True,
        "ambiguous": [],
    }


def test_import_ignores_legacy_usage_key(fav_client, fav_recent_env):
    """Old export JSON with a usage map still imports favorites/recent successfully."""
    _sg_data, fav_path, recent_path = fav_recent_env
    fav_key = "styles.csv\0Test Style A"
    recent_key = "styles.csv\0Test Style B"
    fav_path.unlink(missing_ok=True)
    recent_path.unlink(missing_ok=True)

    r_imp = fav_client.post(
        "/style_grid/import",
        json={
            "favorites": [fav_key],
            "recent": [recent_key],
            "usage": {
                "Legacy Style": {
                    "count": 99,
                    "last_used": "2026-01-01T00:00:00",
                    "first_used": "2025-01-01T00:00:00",
                }
            },
        },
    )
    assert r_imp.status_code == 200
    assert r_imp.json().get("ok") is True
    assert fav_client.get("/style_grid/favorites").json() == {
        "items": [fav_key],
        "persisted": True,
        "ambiguous": [],
    }
    assert fav_client.get("/style_grid/recent").json() == {
        "items": [recent_key],
        "persisted": True,
        "ambiguous": [],
    }
    assert not (fav_path.parent / "usage.json").exists()
