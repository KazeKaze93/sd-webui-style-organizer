"""
HTTP tests for stylegrid.routes (FastAPI).

Patches get_styles_dirs so CSV reads/writes use tmp_csv's directory. Because
stylegrid modules bind get_styles_dirs at import time, config.get_styles_dirs
alone is not enough — csv_io, cache, and thumbnails are patched the same way.

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

    from stylegrid import cache as sg_cache
    from stylegrid import config as sg_config
    from stylegrid import csv_io as sg_csv_io
    from stylegrid import thumbnails as sg_thumbs

    monkeypatch.setattr(sg_config, "get_styles_dirs", fake_get_styles_dirs)
    monkeypatch.setattr(sg_csv_io, "get_styles_dirs", fake_get_styles_dirs)
    monkeypatch.setattr(sg_cache, "get_styles_dirs", fake_get_styles_dirs)
    monkeypatch.setattr(sg_thumbs, "get_styles_dirs", fake_get_styles_dirs)

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
