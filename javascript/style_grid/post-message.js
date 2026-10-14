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
        case "SG_BACKUP":
        case "SG_IMPORT_EXPORT":
        case "SG_CLEAR_ALL":
        case "SG_REFRESH":
            return { type: type };

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
        case "SG_EDIT_STYLE":
        case "SG_DUPLICATE_STYLE":
        case "SG_MOVE_TO_CATEGORY":
        case "SG_DELETE_STYLE":
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

        case "SG_NEW_STYLE":
            if (!isOptionalString(data.sourceFile)) return null;
            return { type: type, sourceFile: data.sourceFile };

        case "SG_SOURCE_CHANGE":
            if (!(data.source === null || typeof data.source === "string")) return null;
            return { type: type, source: data.source };

        default:
            return null;
    }
}
