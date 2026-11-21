/**
 * Style Grid host — panel geometry: pure math and storage, no DOM.
 * Geometry = { left, top, width, height } in CSS px, relative to the viewport.
 */
"use strict";

const PANEL_MIN_WIDTH = 600;
const PANEL_MIN_HEIGHT = 400;
const PANEL_DEFAULT_WIDTH = 1000;
const PANEL_DEFAULT_HEIGHT = 650;
const PANEL_DEFAULT_TOP = 80;
/** Default gap between the panel's right edge and the viewport's right edge. */
const PANEL_DEFAULT_RIGHT_GAP = 16;
/** The panel never comes closer than this to a viewport edge. */
const VIEWPORT_MARGIN = 8;
/** Thickness of an edge resize handle. */
const EDGE_HIT_PX = 6;
/** Side of a square corner resize handle. */
const CORNER_HIT_PX = 12;
/** One geometry for both tabs (txt2img, img2img). */
const PANEL_GEOMETRY_STORAGE_KEY = "sg_panel_geometry_v1";
/** Compass names: n/s/e/w edges, ne/nw/se/sw corners. */
const PANEL_HANDLES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const PANEL_MIN_SIZE = { width: PANEL_MIN_WIDTH, height: PANEL_MIN_HEIGHT };

function isFiniteNumber(value) {
    return typeof value === "number" && isFinite(value);
}

function copyGeometry(geom) {
    return { left: geom.left, top: geom.top, width: geom.width, height: geom.height };
}

function handleHas(handle, side) {
    return typeof handle === "string" && handle.indexOf(side) !== -1;
}

/**
 * Geometry after dragging `handle` by (dx, dy) from `geom`.
 * The opposite edge stays where it was; the size never goes below `min`.
 * @param {{left:number, top:number, width:number, height:number}} geom geometry at drag start
 * @param {string} handle one of PANEL_HANDLES
 * @param {number} dx pointer travel on x since drag start
 * @param {number} dy pointer travel on y since drag start
 * @param {{width:number, height:number}} [min]
 */
function applyHandleDelta(geom, handle, dx, dy, min) {
    var minSize = min || PANEL_MIN_SIZE;
    var next = copyGeometry(geom);
    var right = geom.left + geom.width;
    var bottom = geom.top + geom.height;

    if (handleHas(handle, "e")) {
        next.width = Math.max(minSize.width, geom.width + dx);
    } else if (handleHas(handle, "w")) {
        next.width = Math.max(minSize.width, geom.width - dx);
        next.left = right - next.width;
    }

    if (handleHas(handle, "s")) {
        next.height = Math.max(minSize.height, geom.height + dy);
    } else if (handleHas(handle, "n")) {
        next.height = Math.max(minSize.height, geom.height - dy);
        next.top = bottom - next.height;
    }

    return next;
}

/**
 * Stop the dragged edge at the viewport margin without moving the opposite edge.
 * Used on every frame of a resize drag, after applyHandleDelta.
 */
function limitResizeToViewport(geom, handle, vw, vh, margin) {
    var m = isFiniteNumber(margin) ? margin : VIEWPORT_MARGIN;
    var next = copyGeometry(geom);

    if (handleHas(handle, "e")) {
        next.width = Math.min(next.width, vw - m - next.left);
    } else if (handleHas(handle, "w") && next.left < m) {
        next.width -= m - next.left;
        next.left = m;
    }

    if (handleHas(handle, "s")) {
        next.height = Math.min(next.height, vh - m - next.top);
    } else if (handleHas(handle, "n") && next.top < m) {
        next.height -= m - next.top;
        next.top = m;
    }

    return next;
}

/**
 * Fit a geometry into the viewport: shrink to the available space (never below
 * the minimum size), then move it inside the margins. When the viewport is
 * smaller than the minimum panel, the panel keeps its minimum size and is
 * pinned to the top-left margin.
 */
function clampToViewport(geom, vw, vh, margin) {
    var m = isFiniteNumber(margin) ? margin : VIEWPORT_MARGIN;
    var maxWidth = Math.max(PANEL_MIN_WIDTH, vw - 2 * m);
    var maxHeight = Math.max(PANEL_MIN_HEIGHT, vh - 2 * m);
    var width = Math.min(Math.max(geom.width, PANEL_MIN_WIDTH), maxWidth);
    var height = Math.min(Math.max(geom.height, PANEL_MIN_HEIGHT), maxHeight);
    var maxLeft = Math.max(m, vw - m - width);
    var maxTop = Math.max(m, vh - m - height);
    return {
        left: Math.min(Math.max(geom.left, m), maxLeft),
        top: Math.min(Math.max(geom.top, m), maxTop),
        width: width,
        height: height,
    };
}

/** Default panel: 1000x650, 80px from the top, 16px from the right edge, fitted to the viewport. */
function defaultGeometry(vw, vh) {
    return clampToViewport(
        {
            left: vw - PANEL_DEFAULT_RIGHT_GAP - PANEL_DEFAULT_WIDTH,
            top: PANEL_DEFAULT_TOP,
            width: PANEL_DEFAULT_WIDTH,
            height: PANEL_DEFAULT_HEIGHT,
        },
        vw,
        vh,
        VIEWPORT_MARGIN
    );
}

/**
 * Parse a stored value. Returns null for anything that is not a complete,
 * finite geometry. Only a JSON syntax error is swallowed.
 * @param {unknown} raw
 */
function parseStoredGeometry(raw) {
    if (typeof raw !== "string" || raw === "") return null;
    var data;
    try {
        data = JSON.parse(raw);
    } catch (err) {
        if (err instanceof SyntaxError) return null;
        throw err;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    if (
        !isFiniteNumber(data.left) ||
        !isFiniteNumber(data.top) ||
        !isFiniteNumber(data.width) ||
        !isFiniteNumber(data.height)
    ) {
        return null;
    }
    if (data.width <= 0 || data.height <= 0) return null;
    return { left: data.left, top: data.top, width: data.width, height: data.height };
}

/** Storage access can be denied or over quota; both surface as DOMException. */
function isStorageAccessError(err) {
    return typeof DOMException !== "undefined" && err instanceof DOMException;
}

function readRawGeometry(storage) {
    if (!storage) return null;
    try {
        return storage.getItem(PANEL_GEOMETRY_STORAGE_KEY);
    } catch (err) {
        if (!isStorageAccessError(err)) throw err;
        return null;
    }
}

/**
 * True when a usable custom geometry is stored. False means the panel follows
 * the default, which is recomputed for whatever the viewport currently is.
 * @param {{getItem: function(string): (string|null)} | null | undefined} storage
 */
function hasStoredGeometry(storage) {
    return parseStoredGeometry(readRawGeometry(storage)) !== null;
}

/**
 * Stored geometry fitted to the current viewport; the default when nothing
 * usable is stored (missing, corrupt, or storage unavailable).
 * @param {{getItem: function(string): (string|null)} | null | undefined} storage
 */
function readStoredGeometry(storage, vw, vh) {
    var parsed = parseStoredGeometry(readRawGeometry(storage));
    if (!parsed) return defaultGeometry(vw, vh);
    return clampToViewport(parsed, vw, vh, VIEWPORT_MARGIN);
}

/**
 * Forget the custom geometry: the panel goes back to the default. Removing the
 * key (rather than storing the default as computed now) keeps "default" meaning
 * 1000x650 at the right edge on any later viewport, not the size it was
 * clamped to at reset time. Returns false when storage refused.
 * @param {{removeItem: function(string): void} | null | undefined} storage
 */
function clearStoredGeometry(storage) {
    if (!storage) return false;
    try {
        storage.removeItem(PANEL_GEOMETRY_STORAGE_KEY);
    } catch (err) {
        if (!isStorageAccessError(err)) throw err;
        return false;
    }
    return true;
}

/**
 * Persist a geometry (rounded to whole px). Returns false when storage refused it.
 * @param {{setItem: function(string, string): void} | null | undefined} storage
 */
function writeStoredGeometry(storage, geom) {
    if (!storage) return false;
    var value = JSON.stringify({
        left: Math.round(geom.left),
        top: Math.round(geom.top),
        width: Math.round(geom.width),
        height: Math.round(geom.height),
    });
    try {
        storage.setItem(PANEL_GEOMETRY_STORAGE_KEY, value);
    } catch (err) {
        if (!isStorageAccessError(err)) throw err;
        return false;
    }
    return true;
}

export {
    PANEL_MIN_WIDTH,
    PANEL_MIN_HEIGHT,
    PANEL_MIN_SIZE,
    PANEL_DEFAULT_WIDTH,
    PANEL_DEFAULT_HEIGHT,
    PANEL_DEFAULT_TOP,
    PANEL_DEFAULT_RIGHT_GAP,
    VIEWPORT_MARGIN,
    EDGE_HIT_PX,
    CORNER_HIT_PX,
    PANEL_GEOMETRY_STORAGE_KEY,
    PANEL_HANDLES,
    applyHandleDelta,
    limitResizeToViewport,
    clampToViewport,
    defaultGeometry,
    parseStoredGeometry,
    hasStoredGeometry,
    readStoredGeometry,
    writeStoredGeometry,
    clearStoredGeometry,
};
