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
