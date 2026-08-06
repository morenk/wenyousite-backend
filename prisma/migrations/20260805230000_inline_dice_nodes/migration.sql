-- 当前仅为开发数据：旧版骰子没有正文位置，按产品决定清除旧结果和待掷数组。
DELETE FROM "dice_rolls";

DROP INDEX "dice_rolls_post_id_sequence_key";

ALTER TABLE "posts" DROP COLUMN "pending_dice_notations";
ALTER TABLE "drafts" DROP COLUMN "pending_dice_notations";
ALTER TABLE "dice_rolls" DROP COLUMN "sequence";
ALTER TABLE "dice_rolls" ADD COLUMN "node_id" UUID NOT NULL;

CREATE UNIQUE INDEX "dice_rolls_post_id_node_id_key" ON "dice_rolls"("post_id", "node_id");
