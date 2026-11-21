/**
 * Style Grid host — panel frame behaviour: resize handles, stored geometry,
 * viewport clamping and fullscreen. DOM side of ./panel-geometry.js.
 */
"use strict";

import {
    PANEL_MIN_WIDTH,
    PANEL_MIN_HEIGHT,
    PANEL_MIN_SIZE,
    VIEWPORT_MARGIN,
    EDGE_HIT_PX,
    CORNER_HIT_PX,
    PANEL_HANDLES,
    applyHandleDelta,
    limitResizeToViewport,
    clampToViewport,
    defaultGeometry,
    hasStoredGeometry,
    readStoredGeometry,
    writeStoredGeometry,
    clearStoredGeometry,
} from "./panel-geometry.js";

const PANEL_BORDER_RADIUS = "12px";
const PANEL_BOX_SHADOW = "0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)";
const FULLSCREEN_ATTR = "data-sg-fullscreen";
const RESIZING_ATTR = "data-sg-resizing";
const HANDLE_CLASS = "sg-resize-handle";
/** Sizes the iframe writes when it toggles fullscreen itself (ui/src/App.tsx toggleFullscreen). */
const LEGACY_FULLSCREEN_WIDTH = "100vw";
const LEGACY_FULLSCREEN_HEIGHT = "100vh";

function viewportWidth() {
    var el = document.documentElement;
    return (el && el.clientWidth) || window.innerWidth;
}

function viewportHeight() {
    var el = document.documentElement;
    return (el && el.clientHeight) || window.innerHeight;
}

function panelStorage() {
    try {
        return window.localStorage;
    } catch (err) {
        // Reading the property itself throws when storage is blocked.
        if (typeof DOMException !== "undefined" && err instanceof DOMException) return null;
        throw err;
    }
}

/**
 * Give `wrapper` resize handles on every edge and corner, a stored geometry
 * and host-side fullscreen. Returns the controller used by the message bridge.
 * @param {HTMLElement} wrapper panel frame (position: fixed)
 * @param {HTMLIFrameElement} frame the iframe inside it
 */
function installPanelResize(wrapper, frame) {
    /** What the user chose (stored); `current` is that, fitted to the viewport. */
    var desired = readStoredGeometry(panelStorage(), viewportWidth(), viewportHeight());
    var current = desired;
    /** No custom geometry stored: follow the default as the viewport changes. */
    var usingDefault = !hasStoredGeometry(panelStorage());
    var fullscreen = false;
    /** True when the iframe entered fullscreen by writing wrapper styles itself. */
    var fullscreenByIframe = false;
    var wasVisible = wrapper.style.display === "block";
    var drag = null;
    var rafId = 0;

    // Handle sizes live in style.css; the numbers come from the geometry constants.
    wrapper.style.setProperty("--sg-resize-edge", EDGE_HIT_PX + "px");
    wrapper.style.setProperty("--sg-resize-corner", CORNER_HIT_PX + "px");

    function applyGeometry(geom) {
        current = geom;
        var s = wrapper.style;
        s.left = Math.round(geom.left) + "px";
        s.top = Math.round(geom.top) + "px";
        s.right = "auto";
        s.width = Math.round(geom.width) + "px";
        s.height = Math.round(geom.height) + "px";
        s.minWidth = PANEL_MIN_WIDTH + "px";
        s.minHeight = PANEL_MIN_HEIGHT + "px";
        s.maxWidth = "none";
        s.maxHeight = "none";
        s.transform = "none";
        s.borderRadius = PANEL_BORDER_RADIUS;
        s.boxShadow = PANEL_BOX_SHADOW;
        s.resize = "none";
    }

    function applyDesired() {
        if (usingDefault) desired = defaultGeometry(viewportWidth(), viewportHeight());
        applyGeometry(clampToViewport(desired, viewportWidth(), viewportHeight(), VIEWPORT_MARGIN));
    }

    function applyFullscreenStyles() {
        var s = wrapper.style;
        s.top = "0";
        s.left = "0";
        s.right = "auto";
        s.transform = "none";
        s.width = LEGACY_FULLSCREEN_WIDTH;
        s.height = LEGACY_FULLSCREEN_HEIGHT;
        s.minWidth = "";
        s.minHeight = "";
        s.maxWidth = "";
        s.maxHeight = "";
        s.borderRadius = "0";
        s.boxShadow = "none";
        s.resize = "none";
    }

    function isFullscreen() {
        return fullscreen;
    }

    /** Host-driven fullscreen (SG_SET_FULLSCREEN). */
    function setFullscreen(on) {
        var next = !!on;
        if (next === fullscreen && !fullscreenByIframe) return fullscreen;
        if (drag) endDrag(false);
        fullscreen = next;
        fullscreenByIframe = false;
        if (fullscreen) {
            wrapper.setAttribute(FULLSCREEN_ATTR, "true");
            applyFullscreenStyles();
        } else {
            wrapper.removeAttribute(FULLSCREEN_ATTR);
            applyDesired();
        }
        return fullscreen;
    }

    function flushDrag() {
        rafId = 0;
        if (!drag) return;
        var geom = applyHandleDelta(drag.startGeom, drag.handle, drag.dx, drag.dy, PANEL_MIN_SIZE);
        geom = limitResizeToViewport(geom, drag.handle, viewportWidth(), viewportHeight(), VIEWPORT_MARGIN);
        applyGeometry(geom);
    }

    function endDrag(persist) {
        if (!drag) return;
        var ended = drag;
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
        }
        if (persist) flushDrag();
        drag = null;
        frame.style.pointerEvents = "";
        wrapper.removeAttribute(RESIZING_ATTR);
        ended.el.removeEventListener("pointermove", onPointerMove);
        ended.el.removeEventListener("pointerup", onPointerUp);
        ended.el.removeEventListener("pointercancel", onPointerCancel);
        ended.el.removeEventListener("lostpointercapture", onPointerCancel);
        if (ended.el.hasPointerCapture && ended.el.hasPointerCapture(ended.pointerId)) {
            ended.el.releasePointerCapture(ended.pointerId);
        }
        if (persist) {
            desired = current;
            usingDefault = false;
            writeStoredGeometry(panelStorage(), desired);
        } else {
            applyDesired();
        }
    }

    function onPointerMove(e) {
        if (!drag || e.pointerId !== drag.pointerId) return;
        drag.dx = e.clientX - drag.startX;
        drag.dy = e.clientY - drag.startY;
        if (!rafId) rafId = requestAnimationFrame(flushDrag);
    }

    function onPointerUp(e) {
        if (!drag || e.pointerId !== drag.pointerId) return;
        drag.dx = e.clientX - drag.startX;
        drag.dy = e.clientY - drag.startY;
        endDrag(true);
    }

    function onPointerCancel(e) {
        if (!drag || e.pointerId !== drag.pointerId) return;
        endDrag(false);
    }

    function onPointerDown(e) {
        if (fullscreen || drag) return;
        if (e.button !== 0) return;
        var el = e.currentTarget;
        var handle = el.getAttribute("data-sg-handle");
        if (PANEL_HANDLES.indexOf(handle) === -1) return;
        e.preventDefault();
        drag = {
            el: el,
            handle: handle,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            dx: 0,
            dy: 0,
            startGeom: current,
        };
        // The iframe would swallow pointer events as soon as the pointer is over it.
        el.setPointerCapture(e.pointerId);
        frame.style.pointerEvents = "none";
        wrapper.setAttribute(RESIZING_ATTR, "true");
        el.addEventListener("pointermove", onPointerMove);
        el.addEventListener("pointerup", onPointerUp);
        el.addEventListener("pointercancel", onPointerCancel);
        el.addEventListener("lostpointercapture", onPointerCancel);
    }

    function onDoubleClick(e) {
        if (fullscreen) return;
        e.preventDefault();
        if (drag) endDrag(false);
        // Reset = forget the custom geometry; the stored state is "default".
        usingDefault = true;
        clearStoredGeometry(panelStorage());
        applyDesired();
    }

    PANEL_HANDLES.forEach(function (handle) {
        var el = document.createElement("div");
        el.className = HANDLE_CLASS + " " + HANDLE_CLASS + "--" + handle;
        el.setAttribute("data-sg-handle", handle);
        el.setAttribute("aria-hidden", "true");
        el.addEventListener("pointerdown", onPointerDown);
        el.addEventListener("dblclick", onDoubleClick);
        wrapper.appendChild(el);
    });

    window.addEventListener("resize", function () {
        if (fullscreen) return;
        if (drag) endDrag(false);
        applyDesired();
    });

    /**
     * The wrapper's inline style is also written from outside this module:
     * - render.js shows / hides the panel (display);
     * - TRANSITIONAL: the iframe still toggles fullscreen by writing wrapper
     *   styles directly (ui/src/App.tsx). Detect that, hide the handles while
     *   it lasts, and restore the stored geometry when it ends. Remove this
     *   branch once the iframe sends SG_SET_FULLSCREEN instead.
     */
    function syncFromWrapperStyle() {
        var s = wrapper.style;
        var visible = s.display === "block";
        var becameVisible = visible && !wasVisible;
        wasVisible = visible;

        var iframeFullscreen =
            s.width === LEGACY_FULLSCREEN_WIDTH && s.height === LEGACY_FULLSCREEN_HEIGHT;
        if (iframeFullscreen && !fullscreen) {
            if (drag) endDrag(false);
            fullscreen = true;
            fullscreenByIframe = true;
            wrapper.setAttribute(FULLSCREEN_ATTR, "true");
            return;
        }
        if (!iframeFullscreen && fullscreen && fullscreenByIframe) {
            fullscreen = false;
            fullscreenByIframe = false;
            wrapper.removeAttribute(FULLSCREEN_ATTR);
            applyDesired();
            return;
        }
        if (becameVisible && !fullscreen) {
            // The other tab's panel may have changed the shared geometry meanwhile.
            usingDefault = !hasStoredGeometry(panelStorage());
            desired = readStoredGeometry(panelStorage(), viewportWidth(), viewportHeight());
            applyDesired();
        }
    }

    if (typeof MutationObserver === "function") {
        new MutationObserver(syncFromWrapperStyle).observe(wrapper, {
            attributes: true,
            attributeFilter: ["style"],
        });
    }

    applyGeometry(current);

    return {
        isFullscreen: isFullscreen,
        setFullscreen: setFullscreen,
    };
}

export {
    installPanelResize,
};
