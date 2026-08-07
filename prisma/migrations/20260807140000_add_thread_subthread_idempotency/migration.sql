ALTER TABLE "threads"
  ADD COLUMN "client_request_id" UUID,
  ADD COLUMN "create_request_hash" TEXT;

ALTER TABLE "subthreads"
  ADD COLUMN "client_request_id" UUID,
  ADD COLUMN "create_request_hash" TEXT;

CREATE UNIQUE INDEX "threads_owner_id_client_request_id_key"
  ON "threads"("owner_id", "client_request_id");

CREATE UNIQUE INDEX "subthreads_thread_id_client_request_id_key"
  ON "subthreads"("thread_id", "client_request_id");
