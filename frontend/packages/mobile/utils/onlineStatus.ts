/**
 * Bridges the device's connectivity into React Query's `onlineManager`.
 *
 * WHY THIS EXISTS
 *
 * `components/list/ListState.tsx` has an offline branch. It renders when
 * `query.isPaused`, and React Query only pauses a query while
 * `onlineManager.isOnline()` is false. On a device that never happened:
 *
 * - query-core's default listener subscribes to the DOM `online`/`offline`
 *   events (`onlineManager.js`, verified at 5.100.14),
 * - `polyfills/domEvents` provides `addEventListener`, so the subscription
 *   succeeds and looks healthy,
 * - and nothing in React Native ever dispatches those two events.
 *
 * So the listener registered and waited forever. `fetchStatus` was never
 * `'paused'`, the offline card was copy no user could reach, and the test
 * covering it passed only because the mock set `isPaused: true` by hand — a
 * test asserting a state its own production code cannot produce.
 *
 * WHY `isConnected !== false` AND NOT `!!state.isConnected`
 *
 * `isConnected` is `boolean | null`, where null means "not known yet".
 * React Query's own example uses `!!state.isConnected`, which reads null as
 * offline. That is the wrong direction for this app.
 *
 * Telling someone on WiFi that they have no connection is the exact class of
 * lie `ListState` exists to kill, and being wrong the other way is cheap: the
 * query runs, fails, and the user gets the honest "we could not read this"
 * card. Fail open, never closed.
 *
 * `isInternetReachable` is deliberately not consulted. It is the result of a
 * reachability probe and stays null until that probe answers — which is
 * precisely the moment the app cold-starts, so reading it would pause every
 * first load behind a network round trip.
 *
 * WHERE IT IS IMPORTED
 *
 * `app/_layout.tsx`, next to the polyfills. Route modules are all evaluated
 * while expo-router builds the tree, and a query cannot fetch before something
 * renders, so no query can outrun this install. If one ever did, the failure is
 * bounded in the safe direction: `onlineManager` defaults to online, so that
 * query fetches instead of pausing.
 */

import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';

// Replaces the DOM-events listener query-core installed by default. The setter
// runs `setup` immediately and keeps its unsubscribe, which also means the
// later `onSubscribe()` will not put the dead default back.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    setOnline(state.isConnected !== false);
  }),
);

export {};
