-- CreateTable
CREATE TABLE "registration_drafts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "verification_code" TEXT NOT NULL,
    "code_expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "registration_drafts_email_key" ON "registration_drafts"("email");

-- CreateIndex
CREATE INDEX "registration_drafts_email_idx" ON "registration_drafts"("email");
