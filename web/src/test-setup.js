import '@testing-library/jest-dom/vitest'

// ReactFlow (@xyflow/react) needs ResizeObserver in jsdom.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock

