"""Resolve Gradio cookie sessions for Style Grid routes.

Gradio only attaches ``Depends(login_check)`` to its own routes. Extension
routes registered via ``on_app_started`` are otherwise anonymous even when
``--gradio-auth`` is set. We re-check the same cookies Gradio sets on ``/login``.
"""

from __future__ import annotations

import secrets

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm

# Gradio 3.x (Reforge): fixed names. Newer Gradio may suffix cookie_id.
ACCESS_TOKEN = "access-token"
ACCESS_TOKEN_UNSECURE = "access-token-unsecure"
ACCESS_TOKEN_PREFIX = "access-token-"
ACCESS_TOKEN_UNSECURE_PREFIX = "access-token-unsecure-"


def _cookie_names(cookie_id: str | None) -> tuple[str, ...]:
    names = [ACCESS_TOKEN, ACCESS_TOKEN_UNSECURE]
    if cookie_id:
        names.extend(
            (
                f"{ACCESS_TOKEN_PREFIX}{cookie_id}",
                f"{ACCESS_TOKEN_UNSECURE_PREFIX}{cookie_id}",
            )
        )
    return tuple(names)


def get_gradio_username(request: Request) -> str | None:
    """Return the Gradio-authenticated username, or None if anonymous."""
    app = request.app
    tokens = getattr(app, "tokens", None)
    if not isinstance(tokens, dict):
        return None
    raw_id = getattr(app, "cookie_id", None)
    cookie_id = raw_id if isinstance(raw_id, str) and raw_id else None
    for name in _cookie_names(cookie_id):
        token = request.cookies.get(name)
        if not token:
            continue
        user = tokens.get(token)
        if isinstance(user, str):
            return user
    return None


def require_gradio_session(request: Request) -> JSONResponse | None:
    """When --gradio-auth is configured, reject anonymous Style Grid access."""
    from stylegrid.write_auth import gradio_auth_enabled

    if not gradio_auth_enabled():
        return None
    if get_gradio_username(request) is not None:
        return None
    return JSONResponse(
        {"ok": False, "error": "Not authenticated"},
        status_code=401,
    )


def install_gradio_compat_auth(
    app: FastAPI,
    credentials: dict[str, str],
    *,
    cookie_id: str | None = None,
) -> None:
    """Install Gradio-compatible ``/login`` + cookie session on a plain FastAPI app.

    Cookie names match Gradio 3.x (``access-token`` / ``access-token-unsecure``)
    unless ``cookie_id`` is set (newer Gradio-style ``access-token-{id}``).
    """
    app.cookie_id = cookie_id or ""
    app.tokens = {}  # token -> username
    app.auth = dict(credentials)
    names = _cookie_names(cookie_id if cookie_id else None)

    @app.post("/login")
    @app.post("/login/")
    async def login(form_data: OAuth2PasswordRequestForm = Depends()) -> JSONResponse:
        username = form_data.username.strip()
        password = form_data.password
        expected = app.auth.get(username)
        if expected is not None and secrets.compare_digest(password, expected):
            token = secrets.token_urlsafe(16)
            app.tokens[token] = username
            response = JSONResponse({"success": True})
            # Unsecure first (HTTP), then secure — same pair Gradio sets.
            response.set_cookie(key=names[1], value=token, httponly=True)
            response.set_cookie(key=names[0], value=token, httponly=True, samesite="lax")
            return response
        return JSONResponse({"detail": "Incorrect credentials."}, status_code=400)
