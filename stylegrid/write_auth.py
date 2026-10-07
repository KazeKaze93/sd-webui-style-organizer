"""Write-route auth for Style Grid (CSRF / DNS-rebinding / public bind)."""

from __future__ import annotations

import logging
import re
import secrets

from fastapi import Request
from fastapi.responses import JSONResponse

log = logging.getLogger(__name__)

WRITE_TOKEN_HEADER = "X-StyleGrid-Token"
WRITE_TOKEN_JS_GLOBAL = "__STYLE_GRID_WRITE_TOKEN__"

# Mutating endpoints that must not be CSRF'd / anonymously hit under --listen/--share.
WRITE_ROUTE_PATHS = frozenset({
    "/style_grid/style/save",
    "/style_grid/style/delete",
    "/style_grid/style/rename",
    "/style_grid/import",
    "/style_grid/thumbnail/generate",
    "/style_grid/thumbnail/upload",
    "/style_grid/thumbnail/cancel",
    "/style_grid/thumbnails/cleanup",
    "/style_grid/presets/save",
    "/style_grid/presets/delete",
    "/style_grid/presets/rename",
    "/style_grid/presets/touch",
    "/style_grid/category_order/save",
    "/style_grid/category_order",
    "/style_grid/backup",
    "/style_grid/usage/increment",
    "/style_grid/lora/rescan",
    "/style_grid/lora/fetch_titles",
    "/style_grid/reload",
})

_LOCAL_HOST_NAMES = frozenset({"localhost", "127.0.0.1", "[::1]", "::1"})
_HOST_PORT_RE = re.compile(
    r"^(?P<name>localhost|127\.0\.0\.1|\[::1\]|::1)(?::(?P<port>\d+))?$",
    re.IGNORECASE,
)

_session_token: str | None = None


def reset_write_auth_for_tests() -> None:
    global _session_token
    _session_token = None


def get_session_token() -> str:
    global _session_token
    if _session_token is None:
        _session_token = secrets.token_urlsafe(32)
    return _session_token


def _cmd_opts():
    try:
        from modules import shared  # type: ignore[reportMissingImports]
    except Exception:
        return None
    return getattr(shared, "cmd_opts", None)


def is_public_bind() -> bool:
    """True when the WebUI accepts non-localhost connections (--listen/--share/ngrok)."""
    cmd = _cmd_opts()
    if cmd is None:
        return False
    if bool(getattr(cmd, "share", False)):
        return True
    if getattr(cmd, "ngrok", None):
        return True
    if bool(getattr(cmd, "listen", False)):
        return True
    server_name = getattr(cmd, "server_name", None) or ""
    if isinstance(server_name, str) and server_name.strip():
        host = server_name.strip().lower()
        if host not in ("127.0.0.1", "localhost", "::1"):
            return True
    return False


def gradio_auth_enabled() -> bool:
    cmd = _cmd_opts()
    if cmd is None:
        return False
    if getattr(cmd, "gradio_auth", None):
        return True
    if getattr(cmd, "gradio_auth_path", None):
        return True
    return False


def warn_if_share_unauthenticated() -> None:
    cmd = _cmd_opts()
    if cmd is None:
        return
    if not bool(getattr(cmd, "share", False)):
        return
    if gradio_auth_enabled():
        return
    log.warning(
        "Style Grid write routes are reachable by anyone with the share link "
        "(--share without --gradio-auth). The per-session write token only blocks "
        "blind CSRF/scanners, not anyone who can open the Gradio UI."
    )


def expected_server_port() -> int:
    cmd = _cmd_opts()
    port = getattr(cmd, "port", None) if cmd is not None else None
    # Only accept real ints/digit-strings — MagicMock.__int__ can yield junk (e.g. 1).
    if type(port) is int and 1 <= port <= 65535:
        return port
    if type(port) is str and port.isdigit():
        value = int(port)
        if 1 <= value <= 65535:
            return value
    return 7860


def is_allowed_localhost_host(host_header: str, port: int | None = None) -> bool:
    """Reject DNS-rebinding Host values when bound to localhost only."""
    raw = (host_header or "").strip()
    if not raw:
        return False
    match = _HOST_PORT_RE.match(raw)
    if not match:
        return False
    name = match.group("name").lower()
    if name not in {n.lower() for n in _LOCAL_HOST_NAMES}:
        return False
    header_port = match.group("port")
    expected = port if port is not None else expected_server_port()
    if header_port is None:
        # Browsers omit the port only for 80/443; Gradio is rarely there.
        return expected in (80, 443)
    try:
        return int(header_port) == expected
    except ValueError:
        return False


def is_write_route(path: str, method: str) -> bool:
    if method.upper() == "DELETE" and path == "/style_grid/thumbnail":
        return True
    if method.upper() not in ("POST", "PUT", "PATCH", "DELETE"):
        return False
    return path in WRITE_ROUTE_PATHS


def check_write_request(request: Request) -> JSONResponse | None:
    """Return an error response when the write request must be rejected; else None."""
    if not is_write_route(request.url.path, request.method):
        return None

    # Always require JSON on mutating POSTs — blocks simple cross-site form CSRF
    # even when the server only listens on localhost.
    content_type = (request.headers.get("content-type") or "").lower()
    if request.method.upper() in ("POST", "PUT", "PATCH") and "application/json" not in content_type:
        return JSONResponse(
            {"ok": False, "error": "Content-Type must be application/json"},
            status_code=403,
        )

    if not is_public_bind():
        host = request.headers.get("host") or ""
        if not is_allowed_localhost_host(host):
            return JSONResponse(
                {"ok": False, "error": "invalid Host header"},
                status_code=403,
            )
        return None

    expected = get_session_token()
    provided = request.headers.get(WRITE_TOKEN_HEADER) or ""
    if not provided or not secrets.compare_digest(provided, expected):
        return JSONResponse(
            {"ok": False, "error": "missing or invalid write token"},
            status_code=403,
        )
    return None


def _needs_gradio_session(path: str, method: str) -> bool:
    """UI shell (token HTML) and mutating routes require a Gradio login when auth is on."""
    if path == "/style_grid/ui" and method.upper() == "GET":
        return True
    return is_write_route(path, method)


def install_write_auth(app) -> None:
    warn_if_share_unauthenticated()

    @app.middleware("http")
    async def style_grid_write_auth(request: Request, call_next):
        # Gradio only Depends(login_check) its own routes; extension paths are open
        # unless we re-check the same access-token-* cookies here.
        if _needs_gradio_session(request.url.path, request.method):
            from stylegrid.gradio_session import require_gradio_session

            denied_session = require_gradio_session(request)
            if denied_session is not None:
                return denied_session
        denied = check_write_request(request)
        if denied is not None:
            return denied
        return await call_next(request)


def inject_write_token_script(html: str) -> str:
    """Embed the per-session token into served UI HTML when publicly bound.

    ``GET /style_grid/ui`` is gated on the Gradio cookie session when
    ``--gradio-auth`` is set, so the token is only issued after login. With
    ``--share`` and no auth, anyone with the link can read the token (same as
    the rest of the Gradio UI).
    """
    token = get_session_token() if is_public_bind() else ""
    snippet = (
        f'<script>window.{WRITE_TOKEN_JS_GLOBAL}={token!r};</script>'
    )
    lower = html.lower()
    idx = lower.find("<head>")
    if idx >= 0:
        insert_at = idx + len("<head>")
        return html[:insert_at] + snippet + html[insert_at:]
    return snippet + html


def write_token_headers() -> dict[str, str]:
    """Headers the extension JS should send on write requests."""
    if not is_public_bind():
        return {"Content-Type": "application/json"}
    return {
        "Content-Type": "application/json",
        WRITE_TOKEN_HEADER: get_session_token(),
    }
