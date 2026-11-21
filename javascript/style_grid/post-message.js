/**
 * Host ↔ iframe postMessage helpers: same-origin target, source checks, SG_* guards.
 */
"use strict";

/** @returns {string} */
export function bridgeOrigin() {
    return window.location.origin;
}

/**
 * Post a message into an iframe (or directly to a Window).
 * @param {HTMLIFrameElement | Window | null | undefined} frameOrWindow
 * @param {object} msg
 */
export function postToFrame(frameOrWindow, msg) {
    if (!frameOrWindow) return;
    var target =
        typeof frameOrWindow.postMessage === "function"
            ? frameOrWindow
            : frameOrWindow.contentWindow;
    if (!target || typeof target.postMessage !== "function") return;
    target.postMessage(msg, bridgeOrigin());
}

/**
 * @param {MessageEvent} event
 * @param {HTMLIFrameElement | null | undefined} frame
 * @returns {boolean}
 */
export function isTrustedIframeEvent(event, frame) {
    if (!event || !frame || !frame.contentWindow) return false;
    if (event.origin !== bridgeOrigin()) return false;
    if (event.source !== frame.contentWindow) return false;
    return true;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
    return typeof value === "string" && value.length > 0;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isOptionalString(value) {
    return value === undefined || typeof value === "string";
}

/**
 * @param {unknown} kind
 * @returns {boolean}
 */
function isWildcardKind(kind) {
    return kind === undefined || kind === "sg" || kind === "sgd";
}

/**
 * Runtime guard for iframe → host FrameMessage shapes (SG_*).
 * Unknown types and malformed payloads return null.
 * @param {unknown} data
 * @returns {Record<string, unknown> | null}
 */
export function parseFrameMessage(data) {
    if (!isRecord(data)) return null;
    var type = data.type;
    if (typeof type !== "string" || !type.startsWith("SG_")) return null;

    switch (type) {
        case "SG_READY":
        case "SG_CLOSE_REQUEST":
        case "SG_CLEAR_ALL":
            return { type: type };

        case "SG_REFRESH":
            // quiet_vanished: the iframe removed a style on purpose (delete), so
            // the "no longer in the library" toast must not appear.
            if (data.quiet_vanished !== undefined && typeof data.quiet_vanished !== "boolean") {
                return null;
            }
            return { type: type, quiet_vanished: data.quiet_vanished === true };

        case "SG_APPLY":
            if (!isNonEmptyString(data.styleId)) return null;
            if (typeof data.prompt !== "string") return null;
            if (typeof data.neg !== "string") return null;
            if (typeof data.source_file !== "string") return null;
            return {
                type: type,
                styleId: data.styleId,
                prompt: data.prompt,
                neg: data.neg,
                source_file: data.source_file,
            };

        case "SG_UNAPPLY":
            if (!isNonEmptyString(data.styleId)) return null;
            if (!isOptionalString(data.source_file)) return null;
            return {
                type: type,
                styleId: data.styleId,
                source_file: data.source_file,
            };

        case "SG_GENERATE_PREVIEW":
        case "SG_UPLOAD_PREVIEW":
            if (!isNonEmptyString(data.styleId)) return null;
            if (typeof data.source !== "string") return null;
            return { type: type, styleId: data.styleId, source: data.source };

        case "SG_WILDCARD_CATEGORY":
            if (!isNonEmptyString(data.category)) return null;
            if (!isWildcardKind(data.kind)) return null;
            return { type: type, category: data.category, kind: data.kind };

        case "SG_WILDCARD_SLICE":
        case "SG_REMOVE_WILDCARD":
            if (!isNonEmptyString(data.category)) return null;
            if (typeof data.spec !== "string") return null;
            if (!isWildcardKind(data.kind)) return null;
            return {
                type: type,
                category: data.category,
                spec: data.spec,
                kind: data.kind,
            };

        case "SG_GENERATE_CATEGORY_PREVIEWS":
            if (!isNonEmptyString(data.category)) return null;
            if (typeof data.missingCount !== "number") return null;
            if (!isOptionalString(data.source)) return null;
            return {
                type: type,
                category: data.category,
                missingCount: data.missingCount,
                source: data.source,
            };

        case "SG_REORDER_STYLES":
            if (!Array.isArray(data.styleIds)) return null;
            if (!data.styleIds.every(function (id) { return typeof id === "string"; })) {
                return null;
            }
            return { type: type, styleIds: data.styleIds };

        case "SG_REORDER_WILDCARDS":
            if (!Array.isArray(data.categories)) return null;
            return { type: type, categories: data.categories };

        case "SG_SOURCE_CHANGE":
            if (!(data.source === null || typeof data.source === "string")) return null;
            return { type: type, source: data.source };

        case "SG_SET_FULLSCREEN":
            if (typeof data.fullscreen !== "boolean") return null;
            return { type: type, fullscreen: data.fullscreen };

        case "SG_STYLE_RENAMED":
            if (!isNonEmptyString(data.old_name)) return null;
            if (!isNonEmptyString(data.new_name)) return null;
            if (typeof data.source_file !== "string") return null;
            return {
                type: type,
                old_name: data.old_name,
                new_name: data.new_name,
                source_file: data.source_file,
            };

        default:
            return null;
    }
}
