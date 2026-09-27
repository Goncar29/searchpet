// ============================================================
// SearchPet — useWebSocket
//
// ONE shared WebSocket connection per session (per browser tab / app
// process), NOT one per component mount. A module-level connection
// manager below owns the actual socket, the ticket issuance, and the
// exponential backoff reconnect (1s → 2s → 4s … capped at 30s); each
// hook instance is just a subscriber that registers an `onMessage`
// listener while `enabled` is true and unregisters on cleanup.
//
// Why shared and not per-mount: MainLayout (always mounted while
// logged in) plus whatever screen also calls this hook (ChatPage,
// MessagesPage, the mobile chat/messages screens) used to each open
// their own socket — 2-3 real connections for a single logged-in
// person, each with its own ticket and its own backoff. That's extra
// load on Render/Neon for no benefit, and it makes Hub-side presence
// lie about how many people are actually online.
// ============================================================

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { apiClient } from '../api/client';
import { API_BASE_URL } from '../api/baseURL';

// --- Envelope types (mirror Go websocket package) ---

export type WsMsgType =
  | 'chat_message'
  | 'typing_start'
  | 'typing_stop'
  | 'read_receipt'
  | 'badge_update'
  | 'delivered'
  | 'error';

export interface WsEnvelope {
  type: WsMsgType;
  payload: unknown;
}

export interface WsChatMessage {
  id: string;
  from: string;
  to: string;
  body?: string;
  photo_url?: string;
  timestamp: string;
}

export interface WsTypingEvent {
  from: string;
  to: string;
}

export interface WsReadReceipt {
  from: string;
  to: string;
  message_ids: string[];
}

export interface WsBadgeUpdate {
  user_id: string;
  unread_count: number;
}

export interface WsDeliveredAck {
  message_id: string;
  to: string;
}

export type WsConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';

// --- Shared connection manager ---
//
// Module-scoped singleton: every `useWebSocket()` instance running in
// this JS runtime (one browser tab, one RN process) talks to the SAME
// socket through this manager, instead of opening its own.

const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

type EnvelopeListener = (envelope: WsEnvelope) => void;
type StoreListener = () => void;

let socket: WebSocket | null = null;
let connectionState: WsConnectionState = 'idle';
let retryDelay = MIN_DELAY_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Bumped on every start()/stop(). An in-flight async connect() (and
// every handler on a socket it opened) checks this before acting and
// bails if it's stale.
//
// This is what fixes the StrictMode leak: React mounts an effect,
// cleans it up, then mounts it again (mount → cleanup → mount) to
// surface non-idempotent effects. With a naive "am I still mounted"
// boolean, the second mount flips it back to true before the FIRST
// mount's `issueWsTicket()` call resolves, so that stale connect()
// still sees "mounted" and opens an orphan socket nobody ever closes.
// A monotonically increasing generation counter can't be un-staled by
// a later mount the way a shared boolean can.
let generation = 0;

const subscribers = new Set<EnvelopeListener>();
const stateListeners = new Set<StoreListener>();

function setConnectionState(next: WsConnectionState): void {
  connectionState = next;
  stateListeners.forEach((listener) => listener());
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(myGeneration: number): void {
  // A newer start()/stop() already superseded this attempt, or the
  // last subscriber left while we were waiting — don't reconnect into
  // an empty room.
  if (myGeneration !== generation || subscribers.size === 0) return;

  setConnectionState('reconnecting');
  const delay = retryDelay;
  retryDelay = Math.min(delay * 2, MAX_DELAY_MS);
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    void connect(myGeneration);
  }, delay);
}

async function connect(myGeneration: number): Promise<void> {
  if (myGeneration !== generation || subscribers.size === 0) return;

  try {
    setConnectionState('connecting');
    const { ticket } = await apiClient.issueWsTicket();
    // Re-check after the await: a stop()/start() (last unsubscribe, or
    // a StrictMode remount) may have happened while the ticket request
    // was in flight — see the `generation` comment above.
    if (myGeneration !== generation || subscribers.size === 0) return;

    const wsBase = API_BASE_URL.replace(/^http/, 'ws');
    const ws = new WebSocket(`${wsBase}/api/ws?ticket=${ticket}`);
    socket = ws;

    ws.onopen = () => {
      if (myGeneration !== generation) {
        ws.onclose = null; // intentional close — do not schedule a reconnect
        ws.close();
        return;
      }
      setConnectionState('connected');
      retryDelay = MIN_DELAY_MS; // reset backoff on success
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      if (myGeneration !== generation) return;
      let envelope: WsEnvelope;
      try {
        envelope = JSON.parse(event.data) as WsEnvelope;
      } catch {
        return; // ignore malformed frames
      }
      subscribers.forEach((listener) => {
        try {
          listener(envelope);
        } catch {
          // A subscriber throwing must not stop the others from
          // receiving the same envelope (e.g. MainLayout's badge
          // handler must not swallow ChatPage's message handler).
        }
      });
    };

    ws.onclose = () => {
      if (socket === ws) socket = null;
      if (myGeneration !== generation) return;
      scheduleReconnect(myGeneration);
    };

    ws.onerror = () => {
      // onerror is always followed by onclose; let onclose handle reconnect.
      ws.close();
    };
  } catch {
    // Ticket issuance failed (e.g. 401 or network error) — retry with
    // the same backoff used for an unexpected close.
    if (myGeneration !== generation || subscribers.size === 0) return;
    scheduleReconnect(myGeneration);
  }
}

function start(): void {
  generation += 1;
  retryDelay = MIN_DELAY_MS;
  void connect(generation);
}

function stop(): void {
  generation += 1; // invalidate any in-flight connect() / socket handler
  clearReconnectTimer();
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null; // detach BEFORE closing so it does NOT reconnect
    socket.onerror = null;
    socket.close();
    socket = null;
  }
  // 'disconnected' (not 'idle'): the connection was actually torn down
  // because the last subscriber left. 'idle' is reserved for "nobody has
  // ever subscribed yet" (the module-init value) and for the test-only
  // reset below — keeping them distinct preserves the value set the old
  // per-mount hook emitted on its own unmount cleanup.
  setConnectionState('disconnected');
}

function subscribe(listener: EnvelopeListener): () => void {
  subscribers.add(listener);
  if (subscribers.size === 1) start(); // 0 → 1 subscriber: connect
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) stop(); // last subscriber left: disconnect
  };
}

function subscribeState(listener: StoreListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

function getConnectionState(): WsConnectionState {
  return connectionState;
}

function sendOnSharedSocket(env: WsEnvelope): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(env));
  }
}

/**
 * Test-only: tears down the shared connection and clears every
 * subscriber/listener so each test starts from a clean slate. Never
 * call this from application code.
 */
export function __resetWsConnectionForTests(): void {
  generation += 1;
  clearReconnectTimer();
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close();
    } catch {
      // best-effort cleanup between tests
    }
    socket = null;
  }
  subscribers.clear();
  stateListeners.clear();
  connectionState = 'idle';
  retryDelay = MIN_DELAY_MS;
}

// --- Hook ---

export interface UseWebSocketOptions {
  /**
   * Set to false to skip connecting (e.g. user not authenticated).
   * Default: true. Only affects THIS instance's own subscription — it
   * does not close the shared connection if other consumers are still
   * subscribed, and it does not stop this instance from observing the
   * shared `connectionState` other consumers' subscriptions produce.
   */
  enabled?: boolean;
  /** Called for every incoming envelope. Stable ref — updates without re-subscribing. */
  onMessage: (envelope: WsEnvelope) => void;
}

/**
 * `connectionState` is SHARED across every `useWebSocket()` instance in
 * this runtime — it reflects the one underlying socket, not "is THIS
 * component's listener registered". A consumer with `enabled: false`
 * still observes whatever state other consumers' subscriptions produced
 * (e.g. 'connected' if another screen already has one open); it just
 * doesn't affect it itself.
 *
 * Values: 'idle' (nobody has subscribed yet, or a test reset ran),
 * 'connecting', 'connected', 'disconnected' (the last subscriber left
 * and the socket was torn down), 'reconnecting' (backoff in progress
 * after an unexpected close or a ticket-issuance failure).
 */
export function useWebSocket({ enabled = true, onMessage }: UseWebSocketOptions): {
  connectionState: WsConnectionState;
  sendEnvelope: (env: WsEnvelope) => void;
} {
  const onMessageRef = useRef(onMessage);
  // Keep the callback ref up to date on every render — avoids stale closure.
  onMessageRef.current = onMessage;

  const connectionState = useSyncExternalStore(subscribeState, getConnectionState, getConnectionState);

  useEffect(() => {
    if (!enabled) return undefined;

    const listener: EnvelopeListener = (envelope) => onMessageRef.current(envelope);
    return subscribe(listener);
  }, [enabled]);

  const sendEnvelope = useCallback((env: WsEnvelope) => {
    sendOnSharedSocket(env);
  }, []);

  return { connectionState, sendEnvelope };
}
