CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver_created
    ON messages (sender_id, receiver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread
    ON messages (receiver_id, read_at)
    WHERE read_at IS NULL;
