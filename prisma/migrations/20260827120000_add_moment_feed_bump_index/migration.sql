-- Support the feed's latest-visible-comment lookup without coupling bumps to
-- likes, bookmarks, tips, or edits of the parent moment.
CREATE INDEX "moment_comments_feed_bump_idx"
  ON "moment_comments"("moment_id", "deleted_at", "created_at" DESC, "id" DESC);
