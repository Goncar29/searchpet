// ============================================================
// Tests for useWebSocket.ts — shared WebSocket connection manager
// Runner: Vitest (vitest.shared.config.ts), environment: node with a
// minimal JSDOM polyfill (see vitest.shared.setup.ts) so
// @testing-library/react's renderHook works.
//
// Stubs a fake WebSocket class on globalThis (jsdom does not ship a
// WebSocket implementation) and mocks apiClient.issueWsTicket with
// controllable deferred promises, so each test can drive the
// connect/backoff/reconnect sequence by hand instead of racing a real
// socket or real timers.
//
// WHY THIS FILE EXISTS: `useWebSocket` used to open one connection
// PER COMPONENT MOUNT (own ticket, own socket, own backoff) — see
// odd/tasks/websocket-compartido.md. These tests pin the replacement
// contract: one shared connection per session, refcounted by
// subscriber count, immune to the React.StrictMode mount → cleanup →
// mount race that used to leak an orphan socket.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { apiClient } from '../api/client';
import { useWebSocket, __resetWsConnectionForTests } from './useWebSocket';
import type { WsEnvelope } from './useWebSocket';

// --- Fake WebSocket ----------------------------------------------------
// jsdom (used via vitest.shared.setup.ts) does not implement WebSocket,
// so tests stub their own on globalThis and drive it by hand.

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emit(data: string): void {
    this.onmessage?.({ data });
  }

  /** Simulates the server (or the network) dropping the connection. */
  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.closed = true;
    this.onclose?.();
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.closed = true;
    this.onclose?.();
  }

  send(data: string): void {
    this.sent.push(data);
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let issueWsTicketSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  issueWsTicketSpy = vi.spyOn(apiClient, 'issueWsTicket');
  // Optional call: `__resetWsConnectionForTests` doesn't exist yet on the
  // pre-refactor (per-mount) implementation — guard it so the RED run
  // fails on real assertions instead of a missing-export TypeError.
  __resetWsConnectionForTests?.();
});

afterEach(() => {
  __resetWsConnectionForTests?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useWebSocket — shared connection', () => {
  it('1. opens exactly one WebSocket and issues exactly one ticket for two enabled consumers', async () => {
    const deferred = createDeferred<{ ticket: string; expires_in: number }>();
    issueWsTicketSpy.mockReturnValue(deferred.promise);

    renderHook(() => useWebSocket({ onMessage: vi.fn() }));
    renderHook(() => useWebSocket({ onMessage: vi.fn() }));

    expect(issueWsTicketSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve({ ticket: 't1', expires_in: 60 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('2. delivers an envelope emitted once to both consumers onMessage', async () => {
    const onMessageA = vi.fn();
    const onMessageB = vi.fn();
    issueWsTicketSpy.mockResolvedValue({ ticket: 't1', expires_in: 60 });

    renderHook(() => useWebSocket({ onMessage: onMessageA }));
    renderHook(() => useWebSocket({ onMessage: onMessageB }));

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.open());

    const envelope: WsEnvelope = { type: 'typing_start', payload: { from: 'a', to: 'b' } };
    act(() => socket.emit(JSON.stringify(envelope)));

    expect(onMessageA).toHaveBeenCalledWith(envelope);
    expect(onMessageB).toHaveBeenCalledWith(envelope);
  });

  it('3. keeps the socket open when one of two consumers unmounts, and closes without reconnecting when the last one does', async () => {
    issueWsTicketSpy.mockResolvedValue({ ticket: 't1', expires_in: 60 });

    const hookA = renderHook(() => useWebSocket({ onMessage: vi.fn() }));
    const hookB = renderHook(() => useWebSocket({ onMessage: vi.fn() }));

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.open());

    act(() => hookA.unmount());
    expect(socket.closed).toBe(false);

    act(() => hookB.unmount());
    expect(socket.closed).toBe(true);

    // Give an incorrect reconnect attempt a chance to fire.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(issueWsTicketSpy).toHaveBeenCalledTimes(1);
  });

  it('4. Same-instance remount race — cleanup then re-subscribe while the first ticket is still pending — ends with exactly one open socket', async () => {
    // Mirrors React.StrictMode's mount → cleanup → mount of the SAME
    // component instance (what web/src/main.tsx triggers in dev): the
    // effect's cleanup (unsubscribe) runs, then the effect re-runs
    // (subscribe again) on the SAME fiber, all before the FIRST
    // subscribe's issueWsTicket() call has resolved. Toggling
    // `enabled` off then back on drives that exact cleanup → effect
    // sequence on one instance deterministically — verified
    // separately that this Vitest/React setup does NOT actually
    // double-invoke StrictMode effects (so asserting on a literal
    // <StrictMode> wrapper here would silently test nothing).
    const deferredA = createDeferred<{ ticket: string; expires_in: number }>();
    const deferredB = createDeferred<{ ticket: string; expires_in: number }>();
    issueWsTicketSpy.mockReturnValueOnce(deferredA.promise).mockReturnValueOnce(deferredB.promise);

    const { rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) => useWebSocket({ enabled, onMessage: vi.fn() }),
      { initialProps: { enabled: true } }
    );

    expect(issueWsTicketSpy).toHaveBeenCalledTimes(1);

    rerender({ enabled: false }); // cleanup: unsubscribe
    rerender({ enabled: true }); // effect reruns: subscribe again

    expect(issueWsTicketSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      deferredA.resolve({ ticket: 'stale', expires_in: 60 });
      deferredB.resolve({ ticket: 'fresh', expires_in: 60 });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const notClosed = FakeWebSocket.instances.filter((s) => !s.closed);
    expect(notClosed).toHaveLength(1);

    unmount();
  });

  it('5. enabled=false never connects; flipping to true connects; flipping back to false (as the only consumer) closes without reconnecting', async () => {
    issueWsTicketSpy.mockResolvedValue({ ticket: 't1', expires_in: 60 });

    const { rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) => useWebSocket({ enabled, onMessage: vi.fn() }),
      { initialProps: { enabled: false } }
    );

    expect(issueWsTicketSpy).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);

    rerender({ enabled: true });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => FakeWebSocket.instances[0].open());

    rerender({ enabled: false });
    expect(FakeWebSocket.instances[0].closed).toBe(true);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeWebSocket.instances).toHaveLength(1);

    unmount();
  });

  it('6. reconnects after the backoff delay on an unexpected close while a subscriber remains', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    issueWsTicketSpy.mockResolvedValue({ ticket: 't1', expires_in: 60 });

    renderHook(() => useWebSocket({ onMessage: vi.fn() }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => FakeWebSocket.instances[0].open());

    act(() => FakeWebSocket.instances[0].serverClose());
    expect(FakeWebSocket.instances).toHaveLength(1); // not reconnected yet

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(issueWsTicketSpy).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('7. sendEnvelope sends on the shared socket when open, and is a no-op otherwise', async () => {
    issueWsTicketSpy.mockResolvedValue({ ticket: 't1', expires_in: 60 });

    const hookA = renderHook(() => useWebSocket({ onMessage: vi.fn() }));
    const hookB = renderHook(() => useWebSocket({ onMessage: vi.fn() }));

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];

    // Not open yet — no-op.
    act(() => hookA.result.current.sendEnvelope({ type: 'typing_start', payload: {} }));
    expect(socket.sent).toHaveLength(0);

    act(() => socket.open());
    act(() => hookB.result.current.sendEnvelope({ type: 'typing_stop', payload: {} }));

    expect(socket.sent).toEqual([JSON.stringify({ type: 'typing_stop', payload: {} })]);
  });

  it('8. a subscriber that throws does not stop another subscriber from receiving the envelope', async () => {
    issueWsTicketSpy.mockResolvedValue({ ticket: 't1', expires_in: 60 });
    const throwing = vi.fn(() => {
      throw new Error('boom');
    });
    const ok = vi.fn();

    renderHook(() => useWebSocket({ onMessage: throwing }));
    renderHook(() => useWebSocket({ onMessage: ok }));

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    act(() => socket.open());

    const envelope: WsEnvelope = { type: 'delivered', payload: { message_id: 'm1', to: 'u1' } };
    expect(() => act(() => socket.emit(JSON.stringify(envelope)))).not.toThrow();

    expect(throwing).toHaveBeenCalledWith(envelope);
    expect(ok).toHaveBeenCalledWith(envelope);
  });
});
