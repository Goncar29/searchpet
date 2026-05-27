CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages (
        LEAST(sender_id::text, receiver_id::text),
        GREATEST(sender_id::text, receiver_id::text),
        created_at DESC
    );
