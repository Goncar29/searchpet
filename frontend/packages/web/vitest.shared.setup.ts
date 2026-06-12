// Minimal DOM polyfill for the shared test suite (environment: 'node').
//
// TODO: remove this file once Vitest 4 fixes the jsdom + custom-root +
// Windows path-resolution bug described below, and `environment: 'jsdom'`
// can be used directly.
//
// `environment: 'jsdom'` is broken in this config (custom `root` outside the
// package directory triggers a Vitest/jsdom path-resolution bug on Windows:
// "Cannot find module '/<file>.test.ts'"). Instead we stay in `environment:
// 'node'` and install a minimal JSDOM-backed `document`/`window`/`navigator`
// globally, which is enough for @testing-library/react's `render`/`renderHook`
// to work in tests like `hooks/index.test.ts`.
import { JSDOM } from 'jsdom';

if (typeof globalThis.document === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });

  globalThis.window = dom.window as unknown as typeof globalThis.window;
  globalThis.document = dom.window.document;
  // Node 21+ defines a read-only `navigator` getter on globalThis — redefine
  // it so @testing-library/react sees the JSDOM navigator.
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  // Keep Event/CustomEvent/EventTarget in the same realm as `window` —
  // otherwise `window.dispatchEvent(new CustomEvent(...))` (api/client.ts)
  // throws "parameter 1 is not of type 'Event'" because Node's global
  // CustomEvent and JSDOM's window.CustomEvent are different classes.
  globalThis.Event = dom.window.Event;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.EventTarget = dom.window.EventTarget;
}
