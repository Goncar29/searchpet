-- Migration 000012 UP: add ON DELETE CASCADE foreign keys to story_likes.
-- Rationale: story_likes had no referential integrity at the DB level. These
-- FKs guarantee every like points at a real story and user, and cascade-remove
-- the dependent likes if a story or user is ever hard-deleted. Stories normally
-- soft-delete, so the cascade is defensive integrity rather than a routine path.
-- Runs after AutoMigrate has already created the story_likes table
-- (main.go order: Connect -> RunAutoMigrate -> RunMigrations).

-- Defensive cleanup: ADD CONSTRAINT validates every existing row and fails the
-- whole migration (boot-time, fail-closed) if any like references a story or
-- user that no longer exists. App-created likes can't orphan (AddLike checks the
-- story exists; stories/users soft-delete), but a manual/admin hard delete could
-- have left strays. Purge any such meaningless rows first so the ALTERs are a
-- no-op on a clean DB and can never block a deploy.
DELETE FROM story_likes WHERE story_id NOT IN (SELECT id FROM success_stories);
DELETE FROM story_likes WHERE user_id NOT IN (SELECT id FROM users);

ALTER TABLE story_likes
  ADD CONSTRAINT fk_story_likes_story
  FOREIGN KEY (story_id) REFERENCES success_stories (id) ON DELETE CASCADE;

ALTER TABLE story_likes
  ADD CONSTRAINT fk_story_likes_user
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
