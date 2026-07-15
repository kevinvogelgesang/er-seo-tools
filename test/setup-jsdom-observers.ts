// test/setup-jsdom-observers.ts — jsdom lacks ResizeObserver and
// IntersectionObserver, which @floating-ui's autoUpdate + size middleware
// call. Import at the top of any Explainer-bearing jsdom test.
class Noop {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = Noop as unknown as typeof ResizeObserver
}
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = Noop as unknown as typeof IntersectionObserver
}
export {}
