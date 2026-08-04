-- 固化签发上传凭证时声明的 MIME，供 upload-done 与对象存储实际元数据核对。
ALTER TABLE "media" ADD COLUMN "content_type" TEXT;
