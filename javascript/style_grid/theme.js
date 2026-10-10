/** Style Grid host - light/dark detection of the Gradio page for the iframe. */
"use strict";

const LIGHT_LUMINANCE_THRESHOLD = 0.4;
/** Minimum alpha for a computed background to count as an opaque theme signal. */
const MIN_OPAQUE_ALPHA = 0.5;
const THEME_DEBOUNCE_MS = 100;
const THEME_LIGHT = "light";
const THEME_DARK = "dark";
const SG_THEME_TYPE = "SG_THEME";
const BACKGROUND_SOURCE_SELECTORS = ["gradio-app", ".gradio-container"];
const THEME_ATTRIBUTES = ["class", "style", "data-theme"];
const COLOR_SCHEME_LIGHT_QUERY = "(prefers-color-scheme: light)";
const RGB_CHANNEL_MAX = 255;
const SRGB_LINEAR_CUTOFF = 0.03928;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_GAMMA_OFFSET = 0.055;
const SRGB_GAMMA_DIVISOR = 1.055;
const SRGB_GAMMA_EXPONENT = 2.4;
const LUMA_RED = 0.2126;
const LUMA_GREEN = 0.7152;
const LUMA_BLUE = 0.0722;
const CSS_RGB_RE =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i;

/** @returns {{ r: number, g: number, b: number, a: number } | null} */
function parseCssColor(str) {
    if (typeof str !== "string") return null;
    const trimmed = str.trim();
    if (!trimmed) return null;
    if (trimmed.toLowerCase() === "transparent") {
        return { r: 0, g: 0, b: 0, a: 0 };
    }
    const match = trimmed.match(CSS_RGB_RE);
    if (!match) return null;
    const alpha = match[4] === undefined
        ? 1
        : (match[4].endsWith("%") ? parseFloat(match[4]) / 100 : parseFloat(match[4]));
    if (!Number.isFinite(alpha)) return null;
    const r = parseFloat(match[1]);
    const g = parseFloat(match[2]);
    const b = parseFloat(match[3]);
    if (![r, g, b].every(Number.isFinite)) return null;
    return { r: r, g: g, b: b, a: alpha };
}

/** Relative luminance for sRGB channels in 0-255. */
function relativeLuminance(rgb) {
    const channels = [rgb.r, rgb.g, rgb.b].map(function (raw) {
        const c = raw / RGB_CHANNEL_MAX;
        return c <= SRGB_LINEAR_CUTOFF
            ? c / SRGB_LINEAR_DIVISOR
            : Math.pow((c + SRGB_GAMMA_OFFSET) / SRGB_GAMMA_DIVISOR, SRGB_GAMMA_EXPONENT);
    });
    return LUMA_RED * channels[0] + LUMA_GREEN * channels[1] + LUMA_BLUE * channels[2];
}

/**
 * Pick light/dark from candidate CSS background strings.
 * Skips transparent / a===0 / 0<a<MIN_OPAQUE_ALPHA; uses first a>=MIN_OPAQUE_ALPHA.
 * Falls back to prefersDark when no opaque candidate remains.
 */
function pickModeFromBackgrounds(colors, prefersDark) {
    const list = Array.isArray(colors) ? colors : [];
    for (let i = 0; i < list.length; i++) {
        const raw = list[i];
        if (typeof raw !== "string") continue;
        if (raw.trim().toLowerCase() === "transparent") continue;
        const parsed = parseCssColor(raw);
        if (!parsed) continue;
        if (parsed.a === 0) continue;
        if (parsed.a < MIN_OPAQUE_ALPHA) continue;
        return relativeLuminance(parsed) >= LIGHT_LUMINANCE_THRESHOLD
            ? THEME_LIGHT
            : THEME_DARK;
    }
    return prefersDark ? THEME_DARK : THEME_LIGHT;
}

/** Bridge contract: HostMessage `{ type: 'SG_THEME'; mode }` (ui/src/bridge.ts). */
function buildThemeMessage(mode) {
    return { type: SG_THEME_TYPE, mode: mode };
}

function collectBackgroundCandidates() {
    const sources = BACKGROUND_SOURCE_SELECTORS
        .map(function (selector) { return document.querySelector(selector); })
        .concat([document.body, document.documentElement]);
    const colors = [];
    const computed = typeof getComputedStyle === "function" ? getComputedStyle : null;
    for (let i = 0; i < sources.length; i++) {
        const el = sources[i];
        if (!el || !computed) continue;
        try {
            colors.push(computed(el).backgroundColor);
        } catch (_e) { /* detached / cross-doc node */ }
    }
    return colors;
}

function hostPrefersDark() {
    return !(window.matchMedia && window.matchMedia(COLOR_SCHEME_LIGHT_QUERY).matches);
}

function detectHostThemeMode() {
    return pickModeFromBackgrounds(collectBackgroundCandidates(), hostPrefersDark());
}

/** Calls onChange(mode) when the detected mode changes; returns a stop function. */
function watchHostThemeMode(onChange) {
    let lastMode = detectHostThemeMode();
    let timer = null;

    function check() {
        timer = null;
        const mode = detectHostThemeMode();
        if (mode === lastMode) return;
        lastMode = mode;
        onChange(mode);
    }
    function schedule() {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(check, THEME_DEBOUNCE_MS);
    }

    const observer = new MutationObserver(schedule);
    const observed = [document.documentElement, document.body];
    observed.forEach(function (node) {
        if (!node) return;
        observer.observe(node, {
            attributes: true,
            attributeFilter: THEME_ATTRIBUTES,
            subtree: false,
        });
    });
    const media = window.matchMedia ? window.matchMedia(COLOR_SCHEME_LIGHT_QUERY) : null;
    if (media) media.addEventListener("change", schedule);

    return function stop() {
        observer.disconnect();
        if (media) media.removeEventListener("change", schedule);
        if (timer !== null) clearTimeout(timer);
        timer = null;
    };
}

export {
    parseCssColor,
    relativeLuminance,
    pickModeFromBackgrounds,
    buildThemeMessage,
    detectHostThemeMode,
    watchHostThemeMode,
    MIN_OPAQUE_ALPHA,
};
