-- CreateTable
CREATE TABLE "user_read_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subthread_id" TEXT NOT NULL,
    "post_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_read_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_read_progress_user_id_subthread_id_key" ON "user_read_progress"("user_id", "subthread_id");

-- AddForeignKey
ALTER TABLE "user_read_progress" ADD CONSTRAINT "user_read_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_read_progress" ADD CONSTRAINT "user_read_progress_subthread_id_fkey" FOREIGN KEY ("subthread_id") REFERENCES "subthreads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
