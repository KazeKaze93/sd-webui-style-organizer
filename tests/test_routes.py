"""
HTTP tests for stylegrid.routes (FastAPI).

Patches get_all_styles_file_paths so CSV reads/writes use tmp_csv. Because
stylegrid modules bind that name at import time, config.get_all_styles_file_paths
alone is not enough — csv_io and cache are patched the same way. Thumbnails still
use get_styles_dirs (directory list), so that binding is patched separately.

GET /style_grid/styles returns {"categories": {...}, "usage": {...}}; style
dicts live under each category key (not a top-level JSON array).

Dependencies: pip install pytest fastapi starlette httpx
"""
import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from stylegrid.routes import register_api


def _flatten_styles(payload: dict) -> list:
    categories = payload.get("categories") or {}
    out = []
    for styles in categories.values():
        if isinstance(styles, list):
            out.extend(styles)
    return out


@pytest.fixture
def style_grid_client(tmp_csv, monkeypatch):
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
    with TestClient(app) as client:
        yield client


def test_get_styles_200_json_with_names(style_grid_client):
    r = style_grid_client.get("/style_grid/styles")
    assert r.status_code == 200
    data = r.json()
    styles = _flatten_styles(data)
    assert len(styles) >= 1
    for s in styles:
        assert "name" in s
        assert isinstance(s["name"], str)


def test_get_thumbnails_list_200_json(style_grid_client):
    r = style_grid_client.get("/style_grid/thumbnails/list")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict)
    assert "has_thumbnail" in data
    assert isinstance(data["has_thumbnail"], list)


def test_post_save_valid_200_no_error_key(style_grid_client):
    r = style_grid_client.post(
        "/style_grid/style/save",
        json={
            "name": "Route Save OK",
            "prompt": "p1",
            "negative_prompt": "n1",
            "description": "d1",
            "source": "styles.csv",
            "category": "CAT",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert "error" not in body
    assert body.get("ok") is True


def test_post_save_missing_name_error_or_422(style_grid_client):
    r = style_grid_client.post(
        "/style_grid/style/save",
        json={"prompt": "only prompt"},
    )
    assert r.status_code in (200, 422)
    if r.status_code == 200:
        assert "error" in r.json()
    # Current handler returns 200 + {"error": "Name required"} for empty name.


def test_post_save_duplicate_name_second_updates(style_grid_client, tmp_csv):
    n = "Dup Route Style"
    style_grid_client.post(
        "/style_grid/style/save",
        json={
            "name": n,
            "prompt": "first",
            "negative_prompt": "",
            "description": "",
            "source": "styles.csv",
        },
    )
    style_grid_client.post(
        "/style_grid/style/save",
        json={
            "name": n,
            "prompt": "second",
            "negative_prompt": "",
            "description": "",
            "source": "styles.csv",
        },
    )
    from stylegrid import csv_io

    rows = [s for s in csv_io.parse_styles_csv(str(tmp_csv)) if s["name"] == n]
    assert len(rows) == 1
    assert rows[0]["prompt"] == "second"


def test_post_delete_existing_removes_from_styles(style_grid_client):
    r = style_grid_client.post(
        "/style_grid/style/delete",
        json={"name": "Test Style B", "source": "styles.csv"},
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True
    r2 = style_grid_client.get("/style_grid/styles")
    assert r2.status_code == 200
    names = {s["name"] for s in _flatten_styles(r2.json())}
    assert "Test Style B" not in names


def test_post_delete_nonexistent_graceful(style_grid_client):
    r = style_grid_client.post(
        "/style_grid/style/delete",
        json={"name": "Absolutely No Such Style 404", "source": "styles.csv"},
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True


# --- POST /style_grid/style/rename ---


def test_post_rename_success_renames_csv_row(style_grid_client, tmp_csv):
    r = style_grid_client.post(
        "/style_grid/style/rename",
        json={
            "old_name": "Test Style B",
            "new_name": "Renamed Style B",
            "source": "styles.csv",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert "error" not in body
    from stylegrid import csv_io

    names = [s["name"] for s in csv_io.parse_styles_csv(str(tmp_csv))]
    assert "Renamed Style B" in names
    assert "Test Style B" not in names


def test_post_rename_applies_field_updates(style_grid_client, tmp_csv):
    r = style_grid_client.post(
        "/style_grid/style/rename",
        json={
            "old_name": "Test Style A",
            "new_name": "Style A Renamed",
            "source": "styles.csv",
            "prompt": "updated_prompt",
            "negative_prompt": "updated_neg",
            "description": "updated_desc",
            "category": "NEWCAT",
        },
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True
    from stylegrid import csv_io

    row = next(
        s for s in csv_io.parse_styles_csv(str(tmp_csv)) if s["name"] == "Style A Renamed"
    )
    assert row["prompt"] == "updated_prompt"
    assert row["negative_prompt"] == "updated_neg"
    assert row["description"] == "updated_desc"
    assert row["category_explicit"] == "NEWCAT"


def test_post_rename_omitted_fields_preserved(style_grid_client, tmp_csv):
    from stylegrid import csv_io

    before = next(
        s for s in csv_io.parse_styles_csv(str(tmp_csv)) if s["name"] == "Test Style A"
    )
    r = style_grid_client.post(
        "/style_grid/style/rename",
        json={
            "old_name": "Test Style A",
            "new_name": "Test Style A2",
            "source": "styles.csv",
        },
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True
    after = next(
        s for s in csv_io.parse_styles_csv(str(tmp_csv)) if s["name"] == "Test Style A2"
    )
    assert after["prompt"] == before["prompt"]
    assert after["negative_prompt"] == before["negative_prompt"]
    assert after["description"] == before["description"]
    assert after["category_explicit"] == before["category_explicit"]


def test_post_rename_missing_old_name_error(style_grid_client, tmp_csv):
    before = tmp_csv.read_bytes()
    r = style_grid_client.post(
        "/style_grid/style/rename",
        json={"new_name": "Whatever", "source": "styles.csv"},
    )
    assert r.status_code in (200, 422)
    if r.status_code == 200:
        assert "error" in r.json()
    assert tmp_csv.read_bytes() == before


def test_post_rename_missing_new_name_error(style_grid_client, tmp_csv):
    before = tmp_csv.read_bytes()
    r = style_grid_client.post(
        "/style_grid/style/rename",
        json={"old_name": "Test Style A", "source": "styles.csv"},
    )
    assert r.status_code in (200, 422)
    if r.status_code == 200:
        assert "error" in r.json()
    assert tmp_csv.read_bytes() == before


def test_post_rename_not_found_400_leaves_csv(style_grid_client, tmp_csv):
    before = tmp_csv.read_bytes()
    r = style_grid_client.post(
        "/style_grid/style/rename",
        json={
            "old_name": "No Such Style",
            "new_name": "Nope",
            "source": "styles.csv",
        },
    )
    assert r.status_code == 400
    body = r.json()
    assert body.get("ok") is False
    assert "error" in body
    assert tmp_csv.read_bytes() == before


def test_post_rename_collision_400_leaves_csv(style_grid_client, tmp_csv):
    before = tmp_csv.read_bytes()
    r = style_grid_client.post(
        "/style_grid/style/rename",
        json={
            "old_name": "Test Style A",
            "new_name": "Test Style B",
            "source": "styles.csv",
        },
    )
    assert r.status_code == 400
    body = r.json()
    assert body.get("ok") is False
    assert "error" in body
    assert tmp_csv.read_bytes() == before


def test_post_rename_ambiguous_400_leaves_csv(style_grid_client, tmp_csv):
    tmp_csv.write_text(
        "name,prompt,negative_prompt,description,category\n"
        "Dup,old1,,,\n"
        "Dup,old2,,,\n"
        "Other,x,,,\n",
        encoding="utf-8",
    )
    from stylegrid.cache import invalidate_styles_cache

    invalidate_styles_cache()
    before = tmp_csv.read_bytes()
    r = style_grid_client.post(
        "/style_grid/style/rename",
        json={
            "old_name": "Dup",
            "new_name": "DupRenamed",
            "source": "styles.csv",
        },
    )
    assert r.status_code == 400
    body = r.json()
    assert body.get("ok") is False
    assert "error" in body
    assert tmp_csv.read_bytes() == before


def test_post_rename_lora_400(style_grid_client, tmp_csv):
    from stylegrid.lora_scan import LORA_SOURCE

    before = tmp_csv.read_bytes()
    r = style_grid_client.post(
        "/style_grid/style/rename",
        json={
            "old_name": "AnyLoRA",
            "new_name": "OtherLoRA",
            "source": LORA_SOURCE,
        },
    )
    assert r.status_code == 400
    body = r.json()
    assert body.get("ok") is False
    assert "lora" in body.get("error", "").lower()
    assert tmp_csv.read_bytes() == before


def test_post_rename_moves_thumbnail(style_grid_client, tmp_csv, monkeypatch):
    from pathlib import Path

    from stylegrid import routes as sg_routes
    from stylegrid import thumbnails as sg_thumbs

    thumbs_dir = tmp_csv.parent / "thumbs"
    thumbs_dir.mkdir()
    monkeypatch.setattr(sg_thumbs, "THUMBNAILS_DIR", str(thumbs_dir))
    monkeypatch.setattr(sg_routes, "get_all_styles_file_paths", lambda: [str(tmp_csv)])

    source_path = str(tmp_csv)
    old_path = Path(sg_thumbs.get_thumbnail_path("Test Style B", source_path))
    old_path.write_bytes(b"fake-webp-bytes")
    assert old_path.is_file()

    r = style_grid_client.post(
        "/style_grid/style/rename",
        json={
            "old_name": "Test Style B",
            "new_name": "Renamed Style B",
            "source": "styles.csv",
        },
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True

    new_path = Path(sg_thumbs.get_thumbnail_path("Renamed Style B", source_path))
    assert new_path.is_file()
    assert new_path.read_bytes() == b"fake-webp-bytes"
    assert not old_path.is_file()


def test_post_rename_succeeds_without_thumbnail(style_grid_client, tmp_csv, monkeypatch):
    from stylegrid import routes as sg_routes
    from stylegrid import thumbnails as sg_thumbs

    thumbs_dir = tmp_csv.parent / "thumbs"
    thumbs_dir.mkdir()
    monkeypatch.setattr(sg_thumbs, "THUMBNAILS_DIR", str(thumbs_dir))
    monkeypatch.setattr(sg_routes, "get_all_styles_file_paths", lambda: [str(tmp_csv)])

    r = style_grid_client.post(
        "/style_grid/style/rename",
        json={
            "old_name": "Test Style B",
            "new_name": "Renamed No Thumb",
            "source": "styles.csv",
        },
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True
    from stylegrid import csv_io

    names = [s["name"] for s in csv_io.parse_styles_csv(str(tmp_csv))]
    assert "Renamed No Thumb" in names
    assert "Test Style B" not in names


def test_post_rename_ok_when_thumbnail_move_fails(style_grid_client, tmp_csv, monkeypatch):
    from pathlib import Path

    from stylegrid import routes as sg_routes
    from stylegrid import thumbnails as sg_thumbs

    thumbs_dir = tmp_csv.parent / "thumbs"
    thumbs_dir.mkdir()
    monkeypatch.setattr(sg_thumbs, "THUMBNAILS_DIR", str(thumbs_dir))
    monkeypatch.setattr(sg_routes, "get_all_styles_file_paths", lambda: [str(tmp_csv)])

    source_path = str(tmp_csv)
    old_path = Path(sg_thumbs.get_thumbnail_path("Test Style B", source_path))
    old_path.write_bytes(b"orphan-thumb")

    def boom(*_a, **_k):
        raise OSError("simulated thumbnail move failure")

    monkeypatch.setattr(sg_routes.os, "replace", boom)

    r = style_grid_client.post(
        "/style_grid/style/rename",
        json={
            "old_name": "Test Style B",
            "new_name": "Renamed Despite Thumb Fail",
            "source": "styles.csv",
        },
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True
    from stylegrid import csv_io

    names = [s["name"] for s in csv_io.parse_styles_csv(str(tmp_csv))]
    assert "Renamed Despite Thumb Fail" in names
    assert "Test Style B" not in names
    # Move failed: old key file may remain; rename must still have succeeded.
    assert old_path.is_file()


# --- POST /style_grid/style/rename — preset remap ---


def _seed_presets_file(monkeypatch, tmp_path, presets_obj):
    """Point data_files.PRESETS_FILE at a temp JSON file with the given content."""
    import json

    from stylegrid import data_files as sg_data

    path = tmp_path / "presets.json"
    path.write_text(json.dumps(presets_obj, indent=2, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(sg_data, "PRESETS_FILE", str(path))
    return path


def test_post_rename_rewrites_preset_member_with_basename_source(
    style_grid_client, tmp_csv, tmp_path, monkeypatch
):
    """Frontend sends basename (existingStyle.source); CSV must resolve so presets remap."""
    import json

    from stylegrid import csv_io
    from stylegrid import data_files as sg_data
    from stylegrid import routes as sg_routes

    monkeypatch.setattr(sg_routes, "get_all_styles_file_paths", lambda: [str(tmp_csv)])
    abs_sf = csv_io.normalize_source_path(str(tmp_csv))
    other_sf = csv_io.normalize_source_path(str(tmp_path / "other_dir" / "styles.csv"))

    presets = {
        "Alpha": {
            "styles": [
                {"name": "Test Style B", "source_file": abs_sf},
                {"name": "Test Style A", "source_file": abs_sf},
            ]
        },
        "Beta": {
            "styles": [
                {"name": "Style With Spaces", "source_file": abs_sf},
            ]
        },
        "Gamma": {
            "styles": [
                {"name": "Test Style B", "source_file": other_sf},
            ]
        },
    }
    presets_path = _seed_presets_file(monkeypatch, tmp_path, presets)
    before_keys = list(json.loads(presets_path.read_text(encoding="utf-8")).keys())

    r = style_grid_client.post(
        "/style_grid/style/rename",
        json={
            "old_name": "Test Style B",
            "new_name": "Renamed Style B",
            "source": "styles.csv",
        },
    )
    assert r.status_code == 200, (
        "rename with basename source must succeed; "
        f"got {r.status_code} {r.text}"
    )
    assert r.json().get("ok") is True

    loaded = sg_data.load_presets()
    assert list(loaded.keys()) == before_keys == ["Alpha", "Beta", "Gamma"]

    alpha = loaded["Alpha"]["styles"]
    assert alpha[0]["name"] == "Renamed Style B", (
        "CRITICAL: basename source + discoverable CSV must remap the matching "
        f"preset member; got {alpha[0]!r}. Route received source='styles.csv'; "
        f"member source_file={abs_sf!r}."
    )
    assert alpha[0]["source_file"] == abs_sf
    assert alpha[1] == {"name": "Test Style A", "source_file": abs_sf}

    assert loaded["Beta"]["styles"] == [
        {"name": "Style With Spaces", "source_file": abs_sf},
    ]
    assert loaded["Gamma"]["styles"] == [
        {"name": "Test Style B", "source_file": other_sf},
    ]


def test_post_rename_no_preset_refs_does_not_rewrite_file(
    style_grid_client, tmp_csv, tmp_path, monkeypatch
):
    from stylegrid import csv_io
    from stylegrid import routes as sg_routes

    monkeypatch.setattr(sg_routes, "get_all_styles_file_paths", lambda: [str(tmp_csv)])
    abs_sf = csv_io.normalize_source_path(str(tmp_csv))
    presets_path = _seed_presets_file(
        monkeypatch,
        tmp_path,
        {
            "OnlyOther": {
                "styles": [
                    {"name": "Test Style A", "source_file": abs_sf},
                ]
            }
        },
    )
    before = presets_path.read_bytes()

    r = style_grid_client.post(
        "/style_grid/style/rename",
        json={
            "old_name": "Test Style B",
            "new_name": "Renamed Style B",
            "source": "styles.csv",
        },
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True
    assert presets_path.read_bytes() == before


def test_post_rename_ok_when_preset_save_fails(
    style_grid_client, tmp_csv, tmp_path, monkeypatch
):
    from stylegrid import csv_io
    from stylegrid import routes as sg_routes

    monkeypatch.setattr(sg_routes, "get_all_styles_file_paths", lambda: [str(tmp_csv)])
    abs_sf = csv_io.normalize_source_path(str(tmp_csv))
    _seed_presets_file(
        monkeypatch,
        tmp_path,
        {
            "Hit": {
                "styles": [
                    {"name": "Test Style B", "source_file": abs_sf},
                ]
            }
        },
    )

    def boom(*_a, **_k):
        raise OSError("simulated preset save failure")

    monkeypatch.setattr(sg_routes, "save_presets", boom)

    r = style_grid_client.post(
        "/style_grid/style/rename",
        json={
            "old_name": "Test Style B",
            "new_name": "Renamed Despite Preset Fail",
            "source": "styles.csv",
        },
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True
    names = [s["name"] for s in csv_io.parse_styles_csv(str(tmp_csv))]
    assert "Renamed Despite Preset Fail" in names
    assert "Test Style B" not in names
