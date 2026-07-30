/**
 * Minimal DOM event target on the global object, for React Native.
 *
 * WHY THIS EXISTS
 *
 * `shared/api/client.ts` announces a rejected token by dispatching a DOM event,
 * because that is what the web client listens for. React Native does not provide
 * the APIs that needs:
 *
 * - `react-native/Libraries/Core/setUpGlobals.js` sets `global.window = global`,
 *   so `typeof window !== 'undefined'` is TRUE on a device — the obvious guard
 *   does not protect anything here.
 * - `InitializeCore` polyfills only `Blob`, `File`, `FileReader`, `FormData`,
 *   `Headers`, `Request`, `Response`, `URL`, `URLSearchParams`, `WebSocket`,
 *   `XMLHttpRequest` and `fetch`. `CustomEvent`, `addEventListener` and
 *   `dispatchEvent` are NOT among them. RN 0.76.5 ships a `CustomEvent.js`
 *   module for its own Fabric event system, but never installs it as a global.
 *
 * Verified against `node_modules/react-native` at 0.76.5, not assumed.
 *
 * WHERE IT MUST BE IMPORTED
 *
 * First import of `app/_layout.tsx`, the root layout. Global setup belongs at the
 * app entry, and it has to be evaluated before anything registers a listener or
 * fires a request. Do not move it into a store or a screen: patching globals as a
 * side effect of importing a state module is invisible to whoever reads that
 * module later.
 *
 * The shared client degrades to a no-op when these APIs are missing, so a missed
 * import costs the session-expiry notification — not a crash.
 */

type Listener = (event: { type: string; detail?: unknown }) => void;

const globalScope = globalThis as unknown as {
  window?: unknown;
  CustomEvent?: new (type: string, params?: { detail?: unknown }) => unknown;
  addEventListener?: (type: string, listener: Listener) => void;
  removeEventListener?: (type: string, listener: Listener) => void;
  dispatchEvent?: (event: { type: string; detail?: unknown }) => boolean;
};

if (typeof globalScope.window === 'undefined') {
  globalScope.window = globalScope;
}

if (typeof globalScope.CustomEvent !== 'function') {
  class CustomEventPolyfill<T = unknown> {
    type: string;
    detail: T | undefined;
    constructor(type: string, params?: { detail?: T }) {
      this.type = type;
      this.detail = params?.detail;
    }
  }
  globalScope.CustomEvent = CustomEventPolyfill as unknown as typeof globalScope.CustomEvent;
}

if (typeof globalScope.addEventListener !== 'function') {
  const listenersByType = new Map<string, Set<Listener>>();

  globalScope.addEventListener = (type, listener) => {
    if (!listenersByType.has(type)) listenersByType.set(type, new Set());
    listenersByType.get(type)!.add(listener);
  };

  globalScope.removeEventListener = (type, listener) => {
    listenersByType.get(type)?.delete(listener);
  };

  globalScope.dispatchEvent = (event) => {
    // Copied before iterating: a listener that removes itself would otherwise
    // mutate the set mid-iteration.
    const listeners = listenersByType.get(event.type);
    if (listeners) {
      [...listeners].forEach((listener) => listener(event));
    }
    return true;
  };
}

export {};
