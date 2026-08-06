CREATE TABLE "domain_outbox" (
  "id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT,
  "event_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "domain_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "domain_outbox_event_key_key"
  ON "domain_outbox"("event_key");

CREATE INDEX "domain_outbox_pending_idx"
  ON "domain_outbox"("processed_at", "available_at", "created_at");
