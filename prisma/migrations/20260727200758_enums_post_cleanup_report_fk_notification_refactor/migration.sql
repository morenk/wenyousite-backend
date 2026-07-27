/*
  Warnings:

  - You are about to drop the column `reference_id` on the `notifications` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `posts` table. All the data in the column will be lost.
  - The `status` column on the `threads` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `category` column on the `threads` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "ThreadCategory" AS ENUM ('DEDUCTION', 'NATION', 'RPG');

-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('RECRUITING', 'CLOSED', 'FINISHED');

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "reference_id",
ADD COLUMN     "from_user_id" TEXT,
ADD COLUMN     "post_id" TEXT,
ADD COLUMN     "thread_id" TEXT;

-- AlterTable
ALTER TABLE "posts" DROP COLUMN "status";

-- AlterTable
ALTER TABLE "threads" DROP COLUMN "status",
ADD COLUMN     "status" "ThreadStatus" NOT NULL DEFAULT 'RECRUITING',
DROP COLUMN "category",
ADD COLUMN     "category" "ThreadCategory" NOT NULL DEFAULT 'DEDUCTION';

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
