import { describe, expect, it } from 'vitest';
import type { Conversation } from '@shared/types';
import { deriveConversationRows } from './MessagesShell';

const ME = 'user-1';
const OTHER = 'user-2';

function conversation(overrides: Partial<Conversation>): Conversation {
  return {
    id: 'msg-1',
    sender_id: OTHER,
    receiver_id: ME,
    content: 'hola',
    is_read: true,
    created_at: '2026-10-07T12:00:00Z',
    unread_count: 0,
    ...overrides,
  };
}

// The unread dot comes from the conversation's unread_count, never from its
// latest message. "Mark unread" un-reads the latest RECEIVED message, which is
// older than my own reply when I answered last: reading the latest message left
// that conversation without a dot while the navbar badge counted it.
describe('deriveConversationRows — punto de no leído', () => {
  it('marca sin leer aunque el último mensaje sea mío, si la conversación tiene no leídos', () => {
    const [row] = deriveConversationRows(
      [conversation({ sender_id: ME, receiver_id: OTHER, content: 'mi respuesta', unread_count: 1 })],
      ME,
      'unknown',
    );

    expect(row.fromMe).toBe(true);
    expect(row.unread).toBe(true);
  });

  // The count wins over the latest message's own flag: the server is the one
  // that knows what is still unread across every message of the conversation.
  it('no marca sin leer cuando la conversación no tiene no leídos, diga lo que diga el último mensaje', () => {
    const [row] = deriveConversationRows(
      [conversation({ is_read: false, unread_count: 0 })],
      ME,
      'unknown',
    );

    expect(row.unread).toBe(false);
  });

  it('marca sin leer cuando el último mensaje es del otro y la conversación tiene no leídos', () => {
    const [row] = deriveConversationRows(
      [conversation({ is_read: false, unread_count: 2 })],
      ME,
      'unknown',
    );

    expect(row.fromMe).toBe(false);
    expect(row.unread).toBe(true);
  });
});
