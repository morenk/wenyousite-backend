-- 增量登记账号改名前的标签；不从角色别名推断账号旧名。
CREATE TABLE "user_mention_aliases" (
  "userId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  CONSTRAINT "user_mention_aliases_pkey" PRIMARY KEY ("userId", "username"),
  CONSTRAINT "user_mention_aliases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
