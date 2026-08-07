# 阶段 1：依赖安装 + 构建
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

# 安装依赖
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm install --frozen-lockfile --prod=false

# 复制源码并构建
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
RUN pnpm prisma:generate && pnpm build

# 阶段 2：生产镜像
FROM node:24-alpine AS runner
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

# 仅安装生产依赖
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# 复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/main.js"]
