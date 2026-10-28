"""HTTP tests for /style_grid/host StaticFiles mount."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from stylegrid.routes import register_api


@pytest.fixture
def host_client():
    app = FastAPI()
    register_api(None, app)
    with TestClient(app, base_url="http://127.0.0.1:7860") as client:
        yield client


def test_host_state_js_no_cache(host_client):
    r = host_client.get("/style_grid/host/state.js")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/javascript")
    assert r.headers["cache-control"] == "no-cache"


def test_host_state_js_etag_304(host_client):
    r = host_client.get("/style_grid/host/state.js")
    assert r.status_code == 200
    etag = r.headers.get("etag")
    assert etag
    r2 = host_client.get(
        "/style_grid/host/state.js",
        headers={"If-None-Match": etag},
    )
    assert r2.status_code == 304
    assert r2.headers.get("cache-control") == "no-cache"


def test_host_rejects_path_escape(host_client):
    for path in (
        "/style_grid/host/../scripts/style_grid.py",
        "/style_grid/host/%2e%2e/x.js",
    ):
        r = host_client.get(path)
        assert r.status_code != 200, path


def test_host_rejects_non_js(host_client):
    r = host_client.get("/style_grid/host/README.md")
    assert r.status_code == 404
