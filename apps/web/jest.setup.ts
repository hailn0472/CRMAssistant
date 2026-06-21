import '@testing-library/jest-dom'

// jsdom does not implement ResizeObserver, which is used by cmdk (via
// @radix-ui/react-dialog). Provide a minimal stub so tests don't crash.
global.ResizeObserver = class ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// jsdom does not implement scrollIntoView, which is used by cmdk during
// keyboard navigation of command items. Provide a minimal stub.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = jest.fn()
}
