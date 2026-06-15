-- Migration 000012 DOWN: drop the story_likes foreign keys.
ALTER TABLE story_likes DROP CONSTRAINT IF EXISTS fk_story_likes_user;
ALTER TABLE story_likes DROP CONSTRAINT IF EXISTS fk_story_likes_story;
