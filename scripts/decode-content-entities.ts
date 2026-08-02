import { PrismaClient } from '@prisma/client';
import { decodeEntities } from '../src/common/utils/decode-html-entities';

/**
 * 一次性迁移脚本：将入库时被 HTML 转义的存量内容还原为原始 markdown。
 *
 * 背景：旧版后端用 sanitize-html 对 content 做转义，导致 `>` `<` `&`
 * 被存成 `&gt;` `&lt;` `&amp;`，破坏 markdown。本次已移除入库转义，
 * 此脚本对存量数据做一次「单遍实体解码」（单遍解码是单遍编码的逆操作，
 * `&amp;gt;` → `&gt;`、`&gt;` → `>`，不会递归解码用户原本输入的实体）。
 *
 * 涉及表：posts.content / drafts.content / notifications.content / users.bio
 *
 * 用法：
 *   npx tsx scripts/decode-content-entities.ts --dry-run   # 预览受影响行数，不写库
 *   npx tsx scripts/decode-content-entities.ts             # 真正执行
 */

const prisma = new PrismaClient();
const isDryRun = process.argv.includes('--dry-run');

interface ModelMeta {
  label: string;
  rows: { id: string; content: string }[];
}

async function main() {
  const [posts, drafts, notifications, users] = await Promise.all([
    prisma.post.findMany({ select: { id: true, content: true } }),
    prisma.draft.findMany({ select: { id: true, content: true } }),
    prisma.notification.findMany({ select: { id: true, content: true } }),
    prisma.user.findMany({
      where: { bio: { not: null } },
      select: { id: true, bio: true },
    }),
  ]);

  const models: { label: string; rows: { id: string; content: string }[] }[] = [
    { label: 'posts', rows: posts },
    { label: 'drafts', rows: drafts },
    { label: 'notifications', rows: notifications },
    {
      label: 'users.bio',
      rows: users.map((u) => ({ id: u.id, content: u.bio ?? '' })),
    },
  ];

  let totalAffected = 0;

  for (const model of models) {
    let affected = 0;
    for (const row of model.rows) {
      const decoded = decodeEntities(row.content);
      if (decoded === row.content) continue;
      affected += 1;
      if (!isDryRun) {
        if (model.label === 'users.bio') {
          await prisma.user.update({
            where: { id: row.id },
            data: { bio: decoded },
          });
        } else {
          // posts / drafts / notifications 用对应单数 delegate 更新
          const delegate =
            model.label === 'posts'
              ? prisma.post
              : model.label === 'drafts'
                ? prisma.draft
                : prisma.notification;
          await delegate.update({
            where: { id: row.id },
            data: { content: decoded },
          });
        }
      }
    }
    console.log(
      `${model.label}: ${isDryRun ? '预计' : '已'}更新 ${affected} 行${isDryRun ? '（dry-run）' : ''}`,
    );
    totalAffected += affected;
  }

  console.log(
    isDryRun ? `总计预计受影响：${totalAffected} 行` : `迁移完成，共更新：${totalAffected} 行`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
