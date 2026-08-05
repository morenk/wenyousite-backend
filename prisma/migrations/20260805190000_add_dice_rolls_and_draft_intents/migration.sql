-- Add pending dice intentions to unpublished posts and reusable cloud drafts.
BEGIN;

ALTER TABLE "posts"
ADD COLUMN "pending_dice_notations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "drafts"
ADD COLUMN "pending_dice_notations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "posts"
ADD CONSTRAINT "posts_pending_dice_notations_limit"
CHECK (cardinality("pending_dice_notations") <= 20);

ALTER TABLE "drafts"
ADD CONSTRAINT "drafts_pending_dice_notations_limit"
CHECK (cardinality("pending_dice_notations") <= 20);

-- Official results are append-only application records owned by a post.
CREATE TABLE "dice_rolls" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "protocol_version" INTEGER NOT NULL DEFAULT 1,
    "notation" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sides" INTEGER NOT NULL,
    "modifier" INTEGER NOT NULL DEFAULT 0,
    "results" INTEGER[] NOT NULL,
    "total" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dice_rolls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dice_rolls_sequence_check" CHECK ("sequence" BETWEEN 1 AND 20),
    CONSTRAINT "dice_rolls_quantity_check" CHECK ("quantity" BETWEEN 1 AND 100),
    CONSTRAINT "dice_rolls_sides_check" CHECK ("sides" BETWEEN 2 AND 1000),
    CONSTRAINT "dice_rolls_modifier_check" CHECK ("modifier" BETWEEN -10000 AND 10000),
    CONSTRAINT "dice_rolls_results_count_check" CHECK (cardinality("results") = "quantity")
);

CREATE UNIQUE INDEX "dice_rolls_post_id_sequence_key"
ON "dice_rolls"("post_id", "sequence");

CREATE INDEX "dice_rolls_post_id_created_at_idx"
ON "dice_rolls"("post_id", "created_at");

ALTER TABLE "dice_rolls"
ADD CONSTRAINT "dice_rolls_post_id_fkey"
FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
