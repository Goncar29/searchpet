-- Migration 000011 UP: reset like_count on all success stories to 0.
-- Rationale: historical counts were inflated by the old unconditional-increment
-- bug (no per-user tracking). The new story_likes table starts empty, so the
-- counter-equals-row-count invariant (0 = 0 rows) holds immediately after this
-- migration runs.
UPDATE success_stories SET like_count = 0;
