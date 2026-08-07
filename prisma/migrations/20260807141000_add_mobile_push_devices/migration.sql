CREATE TYPE "MobilePlatform" AS ENUM ('ANDROID', 'IOS');

CREATE TABLE "mobile_devices" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "push_token" TEXT NOT NULL,
  "platform" "MobilePlatform" NOT NULL,
  "app_version" TEXT,
  "locale" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mobile_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mobile_devices_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mobile_devices_push_token_key" ON "mobile_devices"("push_token");
CREATE UNIQUE INDEX "mobile_devices_user_id_session_id_key"
  ON "mobile_devices"("user_id", "session_id");
CREATE INDEX "mobile_devices_user_id_enabled_idx" ON "mobile_devices"("user_id", "enabled");
