"""Red/green tests for --listen/--share write protection."""

from __future__ import annotations

import os

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


def test_public_listen_form_urlencoded_rejected(client, public_cmd, tmp_csv):
    # Guard runs after FastAPI body parsing, so framework validation may reject with 422 first; the status depends on the host FastAPI version.
    # Endpoint writes styles.csv via save_style_to_csv — assert that file is unchanged.
    before = tmp_csv.read_bytes()
    token = write_auth.get_session_token()
    r = client.post(
        "/style_grid/style/save",
        data={"name": "Form Post", "prompt": "p", "source": "styles.csv"},
        headers={write_auth.WRITE_TOKEN_HEADER: token},
    )
    assert r.status_code in (403, 422)
    assert tmp_csv.read_bytes() == before


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


def test_localhost_form_encoded_post_is_rejected(client, localhost_cmd, tmp_csv):
    # Guard runs after FastAPI body parsing, so framework validation may reject with 422 first; the status depends on the host FastAPI version.
    # Endpoint deletes from styles.csv via delete_style_from_csv — assert that file is unchanged.
    before = tmp_csv.read_bytes()
    r = client.post(
        "/style_grid/style/delete",
        data={"name": "Test Style B", "source": "styles.csv"},
        headers={"Host": "127.0.0.1:7860"},
    )
    assert r.status_code in (403, 422)
    assert tmp_csv.read_bytes() == before


def test_localhost_bodyless_post_is_rejected(client, localhost_cmd, tmp_csv):
    # Guard runs after FastAPI body parsing, so framework validation may reject with 422 first; the status depends on the host FastAPI version.
    # Endpoint deletes from styles.csv via delete_style_from_csv — assert that file is unchanged.
    before = tmp_csv.read_bytes()
    r = client.post(
        "/style_grid/style/delete",
        headers={"Host": "127.0.0.1:7860"},
    )
    assert r.status_code in (403, 422)
    assert tmp_csv.read_bytes() == before


def test_localhost_form_encoded_post_to_request_only_handler_is_403(
    client, localhost_cmd, tmp_csv
):
    # /style_grid/import takes only Request (no typed body), so the guard runs before JSON parsing.
    # Endpoint may write presets.json / favorites.json / recent.json or imported_*.csv under EXT_DIR/styles.
    from stylegrid import config as sg_config

    styles_dir = tmp_csv.parent
    import_styles_dir = os.path.join(sg_config.EXT_DIR, "styles")
    data_paths = (
        sg_config.PRESETS_FILE,
        sg_config.FAVORITES_FILE,
        sg_config.RECENT_FILE,
    )

    def _snapshot_dir(path: str) -> dict[str, bytes]:
        if not os.path.isdir(path):
            return {}
        return {
            name: open(os.path.join(path, name), "rb").read()
            for name in sorted(os.listdir(path))
            if os.path.isfile(os.path.join(path, name))
        }

    before_csv = tmp_csv.read_bytes()
    before_styles = _snapshot_dir(str(styles_dir))
    before_import_styles = _snapshot_dir(import_styles_dir)
    before_data = {
        path: (open(path, "rb").read() if os.path.isfile(path) else None)
        for path in data_paths
    }
    r = client.post(
        "/style_grid/import",
        data={"presets": "{}"},
        headers={"Host": "127.0.0.1:7860"},
    )
    assert r.status_code == 403
    assert r.json() == {"ok": False, "error": "Content-Type must be application/json"}
    assert tmp_csv.read_bytes() == before_csv
    assert _snapshot_dir(str(styles_dir)) == before_styles
    assert _snapshot_dir(import_styles_dir) == before_import_styles
    for path, before in before_data.items():
        after = open(path, "rb").read() if os.path.isfile(path) else None
        assert after == before, path


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


@pytest.fixture
def gradio_auth_cmd(monkeypatch):
    """--gradio-auth user:pass with public bind so token HTML would otherwise leak."""
    import sys

    shared = sys.modules["modules"].shared
    monkeypatch.setattr(shared.cmd_opts, "gradio_auth", "alice:secret", raising=False)
    monkeypatch.setattr(shared.cmd_opts, "gradio_auth_path", None, raising=False)
    monkeypatch.setattr(shared.cmd_opts, "listen", True, raising=False)
    monkeypatch.setattr(shared.cmd_opts, "share", False, raising=False)
    monkeypatch.setattr(shared.cmd_opts, "ngrok", None, raising=False)
    monkeypatch.setattr(shared.cmd_opts, "server_name", None, raising=False)
    write_auth.reset_write_auth_for_tests()
    yield
    write_auth.reset_write_auth_for_tests()


def test_gradio_auth_http_gates_ui_and_write(tmp_csv, monkeypatch, gradio_auth_cmd):
    """Real HTTP: anonymous /style_grid/ui + write → 401; Gradio /login → 200."""
    from stylegrid import cache as sg_cache
    from stylegrid import config as sg_config
    from stylegrid import csv_io as sg_csv_io
    from stylegrid import routes as sg_routes
    from stylegrid import thumbnails as sg_thumbs
    from stylegrid.cache import invalidate_styles_cache
    from stylegrid.gradio_session import install_gradio_compat_auth

    tmp_dir = str(tmp_csv.parent)
    monkeypatch.setattr(sg_config, "get_styles_dirs", lambda: [tmp_dir])
    monkeypatch.setattr(sg_thumbs, "get_styles_dirs", lambda: [tmp_dir])
    monkeypatch.setattr(sg_config, "get_all_styles_file_paths", lambda: [str(tmp_csv)])
    monkeypatch.setattr(sg_csv_io, "get_all_styles_file_paths", lambda: [str(tmp_csv)])
    monkeypatch.setattr(sg_cache, "get_all_styles_file_paths", lambda: [str(tmp_csv)])
    invalidate_styles_cache()

    stub_html = (
        "<html><head></head><body>style-grid-ui</body></html>"
    )
    monkeypatch.setattr(sg_routes, "_get_ui_html", lambda: write_auth.inject_write_token_script(stub_html))

    app = FastAPI()
    # Gradio 3.x (Reforge): fixed cookie names, no cookie_id suffix.
    install_gradio_compat_auth(app, {"alice": "secret"})
    register_api(None, app)

    with TestClient(app, base_url="http://127.0.0.1:7860") as client:
        anon_ui = client.get("/style_grid/ui")
        assert anon_ui.status_code in (401, 302, 303, 307), (
            f"anonymous /style_grid/ui must not be open; got {anon_ui.status_code}"
        )
        assert anon_ui.status_code != 200
        body = anon_ui.text or ""
        assert write_auth.WRITE_TOKEN_JS_GLOBAL not in body
        assert write_auth.get_session_token() not in body

        garbage = client.get(
            "/style_grid/ui",
            headers={"Cookie": "access-token-unsecure=garbage123"},
        )
        assert garbage.status_code in (401, 302, 303, 307), (
            f"garbage Gradio cookie must not authenticate; got {garbage.status_code}"
        )

        anon_write = client.post(
            "/style_grid/style/save",
            json={
                "name": "Anon",
                "prompt": "p",
                "negative_prompt": "",
                "description": "",
                "source": "styles.csv",
            },
            headers={write_auth.WRITE_TOKEN_HEADER: write_auth.get_session_token()},
        )
        assert anon_write.status_code in (401, 302, 303, 307), (
            f"anonymous write must not succeed; got {anon_write.status_code}"
        )
        assert anon_write.status_code != 200

        login = client.post(
            "/login",
            data={"username": "alice", "password": "secret"},
        )
        assert login.status_code == 200, login.text
        assert "access-token" in (login.headers.get("set-cookie") or "").lower() or any(
            "access-token" in (c or "") for c in login.cookies.keys()
        )

        authed_ui = client.get("/style_grid/ui")
        assert authed_ui.status_code == 200
        assert "style-grid-ui" in authed_ui.text
        # Public bind: token is issued only inside an authenticated Gradio session.
        assert write_auth.WRITE_TOKEN_JS_GLOBAL in authed_ui.text
        assert write_auth.get_session_token() in authed_ui.text

        authed_write = client.post(
            "/style_grid/style/save",
            json={
                "name": "Authed",
                "prompt": "p",
                "negative_prompt": "",
                "description": "",
                "source": "styles.csv",
            },
            headers={write_auth.WRITE_TOKEN_HEADER: write_auth.get_session_token()},
        )
        assert authed_write.status_code == 200
        assert authed_write.json().get("ok") is True


def _patch_styles_paths(tmp_csv, monkeypatch):
    tmp_dir = str(tmp_csv.parent)

    from stylegrid import cache as sg_cache
    from stylegrid import config as sg_config
    from stylegrid import csv_io as sg_csv_io
    from stylegrid import thumbnails as sg_thumbs
    from stylegrid.cache import invalidate_styles_cache

    monkeypatch.setattr(sg_config, "get_styles_dirs", lambda: [tmp_dir])
    monkeypatch.setattr(sg_thumbs, "get_styles_dirs", lambda: [tmp_dir])
    monkeypatch.setattr(sg_config, "get_all_styles_file_paths", lambda: [str(tmp_csv)])
    monkeypatch.setattr(sg_csv_io, "get_all_styles_file_paths", lambda: [str(tmp_csv)])
    monkeypatch.setattr(sg_cache, "get_all_styles_file_paths", lambda: [str(tmp_csv)])
    invalidate_styles_cache()


def test_route_audit_write_guarded_covers_mutating_style_grid(tmp_csv, monkeypatch):
    _patch_styles_paths(tmp_csv, monkeypatch)
    app = FastAPI()
    register_api(None, app)

    mutating: set[tuple[str, str]] = set()
    guarded: set[tuple[str, str]] = set()
    for route in app.routes:
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        endpoint = getattr(route, "endpoint", None)
        if not path or not str(path).startswith("/style_grid") or not methods:
            continue
        for method in methods:
            if method in ("POST", "PUT", "PATCH", "DELETE"):
                mutating.add((method, path))
            if getattr(endpoint, "__write_guarded__", False):
                guarded.add((method, path))

    assert mutating <= guarded
    expected = {("POST", p) for p in write_auth.WRITE_ROUTE_PATHS} | {
        ("DELETE", "/style_grid/thumbnail"),
        ("GET", "/style_grid/ui"),
    }
    assert guarded == expected


def test_register_api_after_middleware_stack_built(tmp_csv, monkeypatch, localhost_cmd):
    _patch_styles_paths(tmp_csv, monkeypatch)
    app = FastAPI()
    with TestClient(app, base_url="http://127.0.0.1:7860") as client:
        assert client.get("/nonexistent").status_code == 404
        register_api(None, app)
        r = client.get("/style_grid/ui")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/html")


def test_register_api_after_middleware_stack_built_gradio_auth(
    tmp_csv, monkeypatch, gradio_auth_cmd
):
    from stylegrid import routes as sg_routes
    from stylegrid.gradio_session import install_gradio_compat_auth

    _patch_styles_paths(tmp_csv, monkeypatch)
    stub_html = "<html><head></head><body>style-grid-ui</body></html>"
    monkeypatch.setattr(
        sg_routes, "_get_ui_html", lambda: write_auth.inject_write_token_script(stub_html)
    )

    app = FastAPI()
    install_gradio_compat_auth(app, {"alice": "secret"})
    with TestClient(app, base_url="http://127.0.0.1:7860") as client:
        assert client.get("/nonexistent").status_code == 404
        register_api(None, app)
        r = client.get("/style_grid/ui")
        assert r.status_code == 401
        assert r.json().get("ok") is False
        assert r.status_code != 404


def test_write_guarded_typed_body_save_style(client, localhost_cmd):
    r = client.post(
        "/style_grid/style/save",
        json={
            "name": "Typed Body Save",
            "prompt": "p",
            "negative_prompt": "",
            "description": "",
            "source": "styles.csv",
        },
    )
    assert r.status_code == 200
    assert r.json().get("ok") is True
