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

  /** Simulates a network error event (real browsers always follow this with a close event). */
  triggerError(): void {
    this.onerror?.();
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

// Source constants (MIN_DELAY_MS / MAX_DELAY_MS) aren't exported — mirrored
// here from useWebSocket.ts so the backoff-timing tests stay readable and
// don't depend on magic numbers scattered across assertions.
const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
// Comfortably past the 30s cap, with room for several would-be retries —
// used to prove "no further reconnect attempts", not just "not yet".
const WELL_PAST_MAX_DELAY_MS = MAX_DELAY_MS * 4;

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
    // Fake timers + advancing WELL past MAX_DELAY_MS is load-bearing here:
    // a regression that schedules a delayed reconnect (setTimeout >= 1s)
    // would be invisible to a test that only drains microtasks with real
    // timers, since the timer callback would simply never fire during the
    // test's lifetime. Advancing past the cap gives every possible retry
    // (including ones queued by a broken backoff that never resets) a
    // chance to fire before we assert none did.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    issueWsTicketSpy.mockResolvedValue({ ticket: 't1', expires_in: 60 });

    const hookA = renderHook(() => useWebSocket({ onMessage: vi.fn() }));
    const hookB = renderHook(() => useWebSocket({ onMessage: vi.fn() }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0];
    act(() => socket.open());

    act(() => hookA.unmount());
    expect(socket.closed).toBe(false);

    act(() => hookB.unmount());
    expect(socket.closed).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WELL_PAST_MAX_DELAY_MS);
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
    // Same "invisible delayed reconnect" gap as test 3 — see its comment.
    // This is what mobile logout relies on: no session recovery UI, so a
    // ghost reconnect after `enabled` flips to false would silently keep
    // a revoked session's socket alive.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    issueWsTicketSpy.mockResolvedValue({ ticket: 't1', expires_in: 60 });

    const { rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) => useWebSocket({ enabled, onMessage: vi.fn() }),
      { initialProps: { enabled: false } }
    );

    expect(issueWsTicketSpy).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);

    rerender({ enabled: true });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => FakeWebSocket.instances[0].open());

    rerender({ enabled: false });
    expect(FakeWebSocket.instances[0].closed).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WELL_PAST_MAX_DELAY_MS);
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(issueWsTicketSpy).toHaveBeenCalledTimes(1);

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

  it('9. a rejected ticket retries with exponential backoff 1s→2s→4s→8s→16s, capped at 30s, and resets to 1s after a successful open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    issueWsTicketSpy
      .mockRejectedValueOnce(new Error('401'))
      .mockRejectedValueOnce(new Error('401'))
      .mockRejectedValueOnce(new Error('401'))
      .mockRejectedValueOnce(new Error('401'))
      .mockRejectedValueOnce(new Error('401'))
      .mockRejectedValueOnce(new Error('401'))
      .mockResolvedValueOnce({ ticket: 't7', expires_in: 60 });

    renderHook(() => useWebSocket({ onMessage: vi.fn() }));

    // Attempt 1 (immediate) fails and schedules a retry at 1s.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(issueWsTicketSpy).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(0); // ticket never resolved, no socket

    // Each failing attempt's OWN delay before the NEXT attempt: 1s, 2s, 4s,
    // 8s, 16s, then 30s (uncapped math would want 32s here — this last step
    // is the one that actually exercises MAX_DELAY_MS).
    const delays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
    for (let i = 0; i < delays.length; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delays[i]);
      });
      expect(issueWsTicketSpy).toHaveBeenCalledTimes(i + 2);
    }

    // Attempt 7 (fired after the capped 30s wait) succeeds.
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => FakeWebSocket.instances[0].open());

    // Force an unexpected close. If the backoff had kept growing instead
    // of resetting on success, nothing would fire at 1s.
    act(() => FakeWebSocket.instances[0].serverClose());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(issueWsTicketSpy).toHaveBeenCalledTimes(7); // not yet — still short of 1s

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(issueWsTicketSpy).toHaveBeenCalledTimes(8); // reset to MIN_DELAY_MS
  });

  it('10. no further retries after the last subscriber leaves during a pending backoff', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    issueWsTicketSpy.mockRejectedValue(new Error('401'));

    const { unmount } = renderHook(() => useWebSocket({ onMessage: vi.fn() }));

    // First attempt fails; a retry is now pending 1s in the future.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(issueWsTicketSpy).toHaveBeenCalledTimes(1);

    // Unmount while that reconnect is still pending.
    act(() => unmount());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WELL_PAST_MAX_DELAY_MS);
    });

    expect(issueWsTicketSpy).toHaveBeenCalledTimes(1); // no more retries
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('11. a socket abandoned before it opens (last subscriber left while still connecting) is inert: a late open event does not reconnect or report connected', async () => {
    // Exercises the OBSERVABLE guarantee behind the ws.onopen stale-
    // generation branch. Note: under this module's subscribe/unsubscribe
    // design, generation only changes on a 0<->1 subscriber transition,
    // and stop() always proactively nulls the currently-assigned socket's
    // handlers before closing it — so by the time a "late" open event
    // could fire, onopen is already null and the internal
    // `myGeneration !== generation` check inside it is unreachable dead
    // code via the public API. What's still real and worth pinning: a
    // late open event on an abandoned socket must be a no-op — no
    // 'connected' state, no reconnect, no new ticket, no new socket.
    const deferred = createDeferred<{ ticket: string; expires_in: number }>();
    issueWsTicketSpy.mockReturnValue(deferred.promise);

    const { unmount } = renderHook(() => useWebSocket({ onMessage: vi.fn() }));

    await act(async () => {
      deferred.resolve({ ticket: 't1', expires_in: 60 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    const abandoned = FakeWebSocket.instances[0];
    expect(abandoned.closed).toBe(false); // still CONNECTING, never opened

    unmount(); // last subscriber leaves before the socket ever opened

    expect(abandoned.closed).toBe(true); // stop() closed it proactively

    // A "late" open event slipping through must be inert.
    act(() => abandoned.open());

    expect(issueWsTicketSpy).toHaveBeenCalledTimes(1); // no reconnect attempt
    expect(FakeWebSocket.instances).toHaveLength(1); // no new socket
  });

  it('12. onerror closes the socket, which then reconnects after the backoff delay', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    issueWsTicketSpy.mockResolvedValue({ ticket: 't1', expires_in: 60 });

    renderHook(() => useWebSocket({ onMessage: vi.fn() }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0];
    act(() => socket.open());

    act(() => socket.triggerError());
    expect(socket.closed).toBe(true); // onerror must close the socket

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_DELAY_MS);
    });

    expect(issueWsTicketSpy).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("13. connectionState is shared: 'idle' before any subscriber, 'connecting'→'connected', 'disconnected' after the last subscriber leaves, and a disabled consumer observes it too", async () => {
    const deferred = createDeferred<{ ticket: string; expires_in: number }>();
    issueWsTicketSpy.mockReturnValue(deferred.promise);

    // A disabled consumer never subscribes but still reads the shared state.
    const disabled = renderHook(() => useWebSocket({ enabled: false, onMessage: vi.fn() }));
    expect(disabled.result.current.connectionState).toBe('idle');

    const active = renderHook(() => useWebSocket({ onMessage: vi.fn() }));
    expect(active.result.current.connectionState).toBe('connecting');
    await waitFor(() => expect(disabled.result.current.connectionState).toBe('connecting'));

    await act(async () => {
      deferred.resolve({ ticket: 't1', expires_in: 60 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => FakeWebSocket.instances[0].open());

    await waitFor(() => expect(active.result.current.connectionState).toBe('connected'));
    await waitFor(() => expect(disabled.result.current.connectionState).toBe('connected'));

    act(() => active.unmount());

    // active's own snapshot is stale post-unmount (it no longer
    // re-renders); the still-mounted `disabled` instance is the reliable
    // witness of the shared state.
    await waitFor(() => expect(disabled.result.current.connectionState).toBe('disconnected'));

    disabled.unmount();
  });
});
