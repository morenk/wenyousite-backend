"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    const email = process.argv[2];
    if (!email) {
        console.log('用法: tsx scripts/set-admin.ts <用户邮箱>');
        console.log('示例: tsx scripts/set-admin.ts admin@wenyouzhan.com');
        process.exit(1);
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        console.log(`用户 ${email} 不存在`);
        process.exit(1);
    }
    await prisma.user.update({
        where: { email },
        data: { role: 'ADMIN' },
    });
    console.log(`用户 ${user.username} (${email}) 已升级为 ADMIN`);
    await prisma.$disconnect();
}
main().catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
});
//# sourceMappingURL=set-admin.js.map