"""Red/green tests for --listen/--share write protection."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from stylegrid import write_auth
from stylegrid.routes import register_api


@pytest.fixture
def public_cmd(monkeypatch):
    import sys

    shared = sys.modules["modules"].shared
    monkeypatch.setattr(shared.cmd_opts, "listen", True, raising=False)
    monkeypatch.setattr(shared.cmd_opts, "share", False, raising=False)
    monkeypatch.setattr(shared.cmd_opts, "ngrok", None, raising=False)
    monkeypatch.setattr(shared.cmd_opts, "server_name", None, raising=False)
    write_auth.reset_write_auth_for_tests()
    yield
    write_auth.reset_write_auth_for_tests()


@pytest.fixture
def localhost_cmd(monkeypatch):
    import sys

    shared = sys.modules["modules"].shared
    monkeypatch.setattr(shared.cmd_opts, "listen", False, raising=False)
    monkeypatch.setattr(shared.cmd_opts, "share", False, raising=False)
    monkeypatch.setattr(shared.cmd_opts, "ngrok", None, raising=False)
    monkeypatch.setattr(shared.cmd_opts, "server_name", None, raising=False)
    write_auth.reset_write_auth_for_tests()
    yield
    write_auth.reset_write_auth_for_tests()


@pytest.fixture
def client(tmp_csv, monkeypatch, request):
    tmp_dir = str(tmp_csv.parent)

    def fake_get_styles_dirs():
        return [tmp_dir]

    def fake_get_all_styles_file_paths():
        return [str(tmp_csv)]

    from stylegrid import cache as sg_cache
    from stylegrid import config as sg_config
    from stylegrid import csv_io as sg_csv_io
    from stylegrid import thumbnails as sg_thumbs
    from stylegrid.cache import invalidate_styles_cache

    monkeypatch.setattr(sg_config, "get_styles_dirs", fake_get_styles_dirs)
    monkeypatch.setattr(sg_thumbs, "get_styles_dirs", fake_get_styles_dirs)
    monkeypatch.setattr(sg_config, "get_all_styles_file_paths", fake_get_all_styles_file_paths)
    monkeypatch.setattr(sg_csv_io, "get_all_styles_file_paths", fake_get_all_styles_file_paths)
    monkeypatch.setattr(sg_cache, "get_all_styles_file_paths", fake_get_all_styles_file_paths)
    invalidate_styles_cache()

    app = FastAPI()
    register_api(None, app)
    # base_url sets Host to 127.0.0.1:7860 so localhost DNS-rebinding checks pass.
    with TestClient(app, base_url="http://127.0.0.1:7860") as test_client:
        yield test_client


def test_public_listen_save_without_token_is_403(client, public_cmd):
    r = client.post(
        "/style_grid/style/save",
        json={
            "name": "No Token",
            "prompt": "p",
            "negative_prompt": "",
            "description": "",
            "source": "styles.csv",
        },
    )
    assert r.status_code == 403


def test_public_listen_save_with_token_ok(client, public_cmd):
    token = write_auth.get_session_token()
    r = client.post(
        "/style_grid/style/save",
        json={
            "name": "With Token",
            "prompt": "p",
            "negative_prompt": "",
            "description": "",
            "source": "styles.csv",
        },
        headers={write_auth.WRITE_TOKEN_HEADER: token},
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True


def test_public_listen_form_urlencoded_rejected(client, public_cmd):
    token = write_auth.get_session_token()
    r = client.post(
        "/style_grid/style/save",
        data={"name": "Form Post", "prompt": "p", "source": "styles.csv"},
        headers={write_auth.WRITE_TOKEN_HEADER: token},
    )
    assert r.status_code == 403


def test_localhost_save_unchanged_without_token(client, localhost_cmd):
    r = client.post(
        "/style_grid/style/save",
        json={
            "name": "Local Save",
            "prompt": "p",
            "negative_prompt": "",
            "description": "",
            "source": "styles.csv",
        },
        headers={"Host": "127.0.0.1:7860"},
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True


def test_localhost_form_encoded_post_is_403(client, localhost_cmd):
    r = client.post(
        "/style_grid/style/delete",
        data={"name": "Test Style B", "source": "styles.csv"},
        headers={"Host": "127.0.0.1:7860"},
    )
    assert r.status_code == 403


def test_localhost_bodyless_post_is_403(client, localhost_cmd):
    r = client.post(
        "/style_grid/style/delete",
        headers={"Host": "127.0.0.1:7860"},
    )
    assert r.status_code == 403


def test_localhost_evil_host_header_is_403(localhost_cmd):
    # httpx forbids overriding Host on TestClient; exercise the check directly.
    class _Url:
        path = "/style_grid/style/save"

    class _Req:
        url = _Url()
        method = "POST"
        headers = {
            "content-type": "application/json",
            "host": "evil.example",
        }

    denied = write_auth.check_write_request(_Req())  # type: ignore[arg-type]
    assert denied is not None
    assert denied.status_code == 403


def test_allowed_localhost_hosts():
    assert write_auth.is_allowed_localhost_host("127.0.0.1:7860") is True
    assert write_auth.is_allowed_localhost_host("localhost:7860") is True
    assert write_auth.is_allowed_localhost_host("[::1]:7860") is True
    assert write_auth.is_allowed_localhost_host("evil.example") is False
    assert write_auth.is_allowed_localhost_host("evil.example:7860") is False


def test_public_thumbnail_generate_without_token_is_403(client, public_cmd):
    r = client.post(
        "/style_grid/thumbnail/generate",
        json={"name": "Test Style A", "source": "styles.csv"},
    )
    assert r.status_code == 403


def test_public_import_without_token_is_403(client, public_cmd):
    r = client.post("/style_grid/import", json={"presets": {}})
    assert r.status_code == 403


def test_share_without_gradio_auth_logs_warning(localhost_cmd, monkeypatch, caplog):
    import logging
    import sys

    shared = sys.modules["modules"].shared
    monkeypatch.setattr(shared.cmd_opts, "share", True, raising=False)
    monkeypatch.setattr(shared.cmd_opts, "listen", False, raising=False)
    monkeypatch.setattr(shared.cmd_opts, "gradio_auth", None, raising=False)
    monkeypatch.setattr(shared.cmd_opts, "gradio_auth_path", None, raising=False)
    with caplog.at_level(logging.WARNING):
        write_auth.warn_if_share_unauthenticated()
    assert any("share link" in rec.message.lower() or "write routes" in rec.message.lower()
               for rec in caplog.records)


def test_gradio_auth_detected_when_configured(monkeypatch):
    import sys

    shared = sys.modules["modules"].shared
    monkeypatch.setattr(shared.cmd_opts, "gradio_auth", "user:pass", raising=False)
    monkeypatch.setattr(shared.cmd_opts, "gradio_auth_path", None, raising=False)
    assert write_auth.gradio_auth_enabled() is True
    # Gradio BasicAuth wraps the whole ASGI app before FastAPI routes, so
    # /style_grid/ui (token HTML) is only reachable after login when auth is set.
    assert write_auth.token_html_inherits_gradio_auth() is True
