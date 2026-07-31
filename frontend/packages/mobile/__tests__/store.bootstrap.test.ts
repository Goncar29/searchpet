// Regression guard for the session-expiry listener REGISTERING AT ALL.
//
// `store.test.ts` already covers what the listener does once registered, but it
// cannot cover whether it registers, and neither can any other test in this suite:
// `jest.setup.js` requires `polyfills/domEvents` before anything else, so the
// globals are always present by the time a test imports the store. A device is not
// so kind. expo-router calls `loadRoute()` eagerly for every layout while building
// the route tree, and Metro sorts the context keys, so `app/(tabs)/_layout.tsx`
// ('(' = 0x28) is evaluated BEFORE `app/_layout.tsx` ('_' = 0x5F). That group
// layout imports the store, so the store used to evaluate against a global scope
// the root layout had not patched yet, take the `else` branch, and never register
// — permanently, with no retry. The suite stayed green throughout.
//
// So this test strips the globals `jest.setup.js` installed and re-imports the
// store from a clean module registry, which is the one condition the harness
// otherwise hides. It fails if the `../polyfills/domEvents` import is dropped from
// the top of `store/index.ts`.

const PATCHED_GLOBALS = [
  'addEventListener',
  'removeEventListener',
  'dispatchEvent',
  'CustomEvent',
] as const;

type MutableScope = Record<string, unknown>;

describe('store bootstrap — listener registration without a pre-patched global scope', () => {
  it('installs the DOM event globals itself instead of trusting the root layout', () => {
    const scope = globalThis as unknown as MutableScope;
    const saved: MutableScope = {};

    for (const key of PATCHED_GLOBALS) {
      saved[key] = scope[key];
      delete scope[key];
    }

    try {
      // Precondition: we really are reproducing a bare scope, not testing a
      // scope jest.setup.js already furnished.
      expect(typeof scope.addEventListener).toBe('undefined');
      expect(typeof scope.dispatchEvent).toBe('undefined');

      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useAuthStore } = require('../store');

      // Re-arm the SecureStore mock inside the fresh registry: resetModules gives
      // back bare jest.fn()s, and the listener calls `.catch()` on the result.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const SecureStore = require('expo-secure-store');
      SecureStore.deleteItemAsync.mockResolvedValue(undefined);

      // The store must have installed these on its own way in.
      expect(typeof scope.addEventListener).toBe('function');
      expect(typeof scope.dispatchEvent).toBe('function');
      expect(typeof scope.CustomEvent).toBe('function');

      useAuthStore.setState({
        user: { id: 'user-1', email: 'carlos@example.com', name: 'Carlos' },
        token: 'a-revoked-token',
        isLoading: false,
        isAuthenticated: true,
      });

      const CustomEventCtor = scope.CustomEvent as new (
        type: string,
        params?: { detail?: unknown },
      ) => unknown;
      const dispatch = scope.dispatchEvent as (event: unknown) => boolean;

      dispatch(
        new CustomEventCtor('auth:session-expired', { detail: { code: 'session_expired' } }),
      );

      // The listener ran: this is the whole point — on a device this assertion
      // failed because nothing was listening.
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().user).toBeNull();
    } finally {
      for (const key of PATCHED_GLOBALS) {
        scope[key] = saved[key];
      }
      jest.resetModules();
    }
  });
});
