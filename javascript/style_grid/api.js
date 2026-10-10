/** Style Grid host — API client (moved from style_grid.js). */
"use strict";

function styleGridWriteToken() {
        try {
            if (typeof window.__STYLE_GRID_WRITE_TOKEN__ === "string" && window.__STYLE_GRID_WRITE_TOKEN__) {
                return window.__STYLE_GRID_WRITE_TOKEN__;
            }
            if (window.parent && window.parent !== window
                && typeof window.parent.__STYLE_GRID_WRITE_TOKEN__ === "string") {
                return window.parent.__STYLE_GRID_WRITE_TOKEN__ || "";
            }
        } catch (_e) { /* cross-origin parent */ }
        return "";
    }

function styleGridWriteHeaders() {
        var headers = { "Content-Type": "application/json" };
        var token = styleGridWriteToken();
        if (token) headers["X-StyleGrid-Token"] = token;
        return headers;
    }

function parseApiResponse(r) {
        return r.text().then(function (text) {
            var body = {};
            if (text) {
                try {
                    body = JSON.parse(text);
                } catch (_e) {
                    if (!r.ok) {
                        return Promise.reject(new Error("HTTP " + r.status));
                    }
                    return Promise.reject(new Error("Invalid JSON in response"));
                }
            }
            if (!r.ok) {
                var msg = (body && body.error) || (typeof body.detail === "string" ? body.detail : null);
                if (!msg && body && Array.isArray(body.detail)) {
                    msg = body.detail.map(function (d) { return (d && d.msg) ? d.msg : ""; }).filter(Boolean).join("; ");
                }
                return Promise.reject(new Error(msg || ("HTTP " + r.status)));
            }
            return body;
        });
    }

function apiPost(endpoint, data) {
        return fetch(endpoint, {
            method: "POST",
            headers: styleGridWriteHeaders(),
            body: JSON.stringify(data || {}),
        }).then(parseApiResponse);
    }

function apiDelete(endpoint) {
        return fetch(endpoint, {
            method: "DELETE",
            headers: styleGridWriteHeaders(),
        }).then(parseApiResponse);
    }

function assertNoApiError(result) {
        if (result && result.error) {
            return Promise.reject(new Error(result.error));
        }
        return result;
    }

function apiGet(endpoint) {
        return fetch(endpoint).then(function (r) { return r.json(); });
    }

function thumbIdentityKey(name, sourceFile) {
        return String(name) + "::" + String(sourceFile || "");
    }

export {
    styleGridWriteToken,
    styleGridWriteHeaders,
    apiPost,
    apiDelete,
    assertNoApiError,
    apiGet,
    thumbIdentityKey,
};
