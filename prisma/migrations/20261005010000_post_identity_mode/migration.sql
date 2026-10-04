-- 保留原请求的身份模式，供成功创建后的幂等重试比对；旧数据保持 NULL。
ALTER TABLE "posts" ADD COLUMN "identity_create_mode" VARCHAR(7);
