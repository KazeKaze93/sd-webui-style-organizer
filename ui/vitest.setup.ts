/** Minimal localStorage for store modules that read it at import time. */
const data: Record<string, string> = {}

const localStorageMock = {
  getItem: (key: string) => (key in data ? data[key] : null),
  setItem: (key: string, value: string) => {
    data[key] = String(value)
  },
  removeItem: (key: string) => {
    delete data[key]
  },
  clear: () => {
    for (const key of Object.keys(data)) delete data[key]
  },
  get length() {
    return Object.keys(data).length
  },
  key(index: number) {
    const keys = Object.keys(data)
    return index >= 0 && index < keys.length ? keys[index] : null
  },
}

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
})

// React 19 act() / concurrent updates under Vitest.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** jsdom lacks ResizeObserver; grid virtualizer observes container width. */
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_cb: ResizeObserverCallback) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub
}
