// ============================================================
// SearchPet — useWebSocket
// Manages a single WebSocket connection per component mount.
// Handles ticket issuance, connection upgrade, and exponential
// backoff reconnect (1s → 2s → 4s … capped at 30s).
// ============================================================

import { useEffect, useRef, useCallback, useState } from 'react';
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

// --- Hook ---

const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export interface UseWebSocketOptions {
  /** Set to false to skip connecting (e.g. user not authenticated). Default: true */
  enabled?: boolean;
  /** Called for every incoming envelope. Stable ref — updates without re-connecting. */
  onMessage: (envelope: WsEnvelope) => void;
}

export function useWebSocket({ enabled = true, onMessage }: UseWebSocketOptions): {
  connectionState: WsConnectionState;
  sendEnvelope: (env: WsEnvelope) => void;
} {
  const [connectionState, setConnectionState] = useState<WsConnectionState>('idle');

  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);
  const retryDelayRef = useRef(MIN_DELAY_MS);
  const onMessageRef = useRef(onMessage);
  // Keep the callback ref up to date on every render — avoids stale closure.
  onMessageRef.current = onMessage;

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;

    try {
      setConnectionState('connecting');

      const { ticket } = await apiClient.issueWsTicket();
      if (!mountedRef.current) return;

      // Convert http(s) → ws(s)
      const wsBase = API_BASE_URL.replace(/^http/, 'ws');
      const ws = new WebSocket(`${wsBase}/api/ws?ticket=${ticket}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close();
          return;
        }
        setConnectionState('connected');
        retryDelayRef.current = MIN_DELAY_MS; // reset backoff on success
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const envelope = JSON.parse(event.data) as WsEnvelope;
          onMessageRef.current(envelope);
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!mountedRef.current) return;
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onerror is always followed by onclose; let onclose handle reconnect.
        ws.close();
      };
    } catch {
      // Ticket issuance failed (e.g. 401 or network error) — schedule retry.
      if (!mountedRef.current) return;
      scheduleReconnect();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    setConnectionState('reconnecting');
    const delay = retryDelayRef.current;
    retryDelayRef.current = Math.min(delay * 2, MAX_DELAY_MS);
    setTimeout(connect, delay);
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    retryDelayRef.current = MIN_DELAY_MS;

    if (enabled) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnectionState('disconnected');
    };
  }, [enabled, connect]);

  const sendEnvelope = useCallback((env: WsEnvelope) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(env));
    }
  }, []);

  return { connectionState, sendEnvelope };
}
