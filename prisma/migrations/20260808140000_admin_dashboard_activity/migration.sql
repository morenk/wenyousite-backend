CREATE TABLE "user_daily_activities" (
  "user_id" TEXT NOT NULL,
  "date_key" VARCHAR(10) NOT NULL,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_daily_activities_pkey" PRIMARY KEY ("user_id", "date_key")
);

CREATE INDEX "user_daily_activities_date_key_user_id_idx"
  ON "user_daily_activities"("date_key", "user_id");

ALTER TABLE "user_daily_activities"
  ADD CONSTRAINT "user_daily_activities_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
