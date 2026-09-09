-- 首帧产物只有上传成功后才登记；历史媒体保持未知，不回填或改写对象。
ALTER TABLE "media" ADD COLUMN "poster_url" TEXT;
CREATE INDEX "media_url_idx" ON "media"("url");
