/** 清理专用测试账号 testuser 在验收过程中产生的主题帖和正文草稿。 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_USERNAME = "testuser";

async function main() {
  const user = await prisma.user.findUnique({
    where: { username: TEST_USERNAME },
    select: { id: true, username: true },
  });

  if (!user) {
    throw new Error(`测试账号 ${TEST_USERNAME} 不存在，已停止清理`);
  }

  const [threadCount, draftCount] = await Promise.all([
    prisma.thread.count({ where: { ownerId: user.id } }),
    prisma.draft.count({ where: { userId: user.id } }),
  ]);

  const [deletedThreads, deletedDrafts] = await prisma.$transaction([
    // Thread 的关联子贴、楼层、成员、标签等由数据库级联删除。
    prisma.thread.deleteMany({ where: { ownerId: user.id } }),
    prisma.draft.deleteMany({ where: { userId: user.id } }),
  ]);

  console.log(
    JSON.stringify(
      {
        username: user.username,
        threads: { before: threadCount, deleted: deletedThreads.count },
        drafts: { before: draftCount, deleted: deletedDrafts.count },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
