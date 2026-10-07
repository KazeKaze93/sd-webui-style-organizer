/**
 * Legacy import path for vitest characterization + tests/test_js.html.
 * Single implementation: style_grid/prompt-utils.js (via bridge).
 *
 * Note: Forge injects javascript/*.js as classic scripts. This file uses ESM
 * `import` and will be skipped by the classic loader; the host entry
 * style_grid.mjs imports the bridge itself.
 */
import "./style_grid/prompt-utils-bridge.js";
