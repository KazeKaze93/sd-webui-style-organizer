/**
 * Logger interface for Style Grid UI. Use instead of console.log.
 * Can be replaced or disabled in production.
 */
const noop = () => {};

function makeLogger(prefix) {
  return {
    debug: (...args) => (typeof console !== "undefined" && console.debug) ? console.debug(prefix, ...args) : noop(),
    info: (...args) => (typeof console !== "undefined" && console.info) ? console.info(prefix, ...args) : noop(),
    warn: (...args) => (typeof console !== "undefined" && console.warn) ? console.warn(prefix, ...args) : noop(),
    error: (...args) => (typeof console !== "undefined" && console.error) ? console.error(prefix, ...args) : noop(),
  };
}

export const logger = makeLogger("[Style Grid]");
