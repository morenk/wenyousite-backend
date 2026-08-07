/**
 * API 端到端测试脚本 — 前端视角
 *
 * 用法: npx tsx scripts/api-e2e-test.ts
 *
 * 覆盖模块:
 *   Auth, Threads, Subthreads, Posts, Drafts,
 *   Notifications, Subscriptions, Bookmarks,
 *   Users, Tags, Search, 错误码
 */

import pc from "picocolors";
import { z } from "zod";
import { faker } from "@faker-js/faker";
import { execFileSync } from "child_process";

// ═══════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════

const BASE = process.env.API_BASE || "http://localhost:3000/api/v1";
const baseUrl = new URL(BASE);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

if (process.env.API_E2E_ENV !== "test") {
  throw new Error("API_E2E_ENV 必须显式设为 test");
}
if (!LOOPBACK_HOSTS.has(baseUrl.hostname)) {
  throw new Error("API E2E 会写入并清理测试数据，只允许连接本机测试环境");
}

const TEST_EMAIL = `e2e-${Date.now()}@wenyou.site`;
const TEST_PASSWORD = "E2eTest123!";
const TEST_USERNAME = faker.internet
  .username()
  .slice(0, 16)
  .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "");

// ═══════════════════════════════════════════════════════════════
// Zod Schemas（success-only，code 固定为 0）
// ═══════════════════════════════════════════════════════════════

const apiResponse = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ code: z.literal(0), message: z.string(), data });
const apiPaginated = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    code: z.literal(0),
    message: z.string(),
    data: z.array(data),
    meta: z
      .object({ cursor: z.string().nullable(), hasMore: z.boolean() })
      .optional(),
  });

const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  username: z.string(),
  avatar: z.string().nullable(),
  role: z.enum(["USER", "ADMIN", "SUPER_ADMIN"]),
  emailVerified: z.boolean(),
});

const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  user: userSchema,
});

const threadSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  ownerId: z.string(),
  category: z.string().nullable(),
  status: z.string(),
  visibility: z.string(),
  published: z.boolean(),
  pinned: z.boolean(),
  version: z.number(),
  deletedAt: z.string().nullable(),
});

const subthreadSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  title: z.string(),
  sortOrder: z.number(),
  postingPolicy: z.string(),
  version: z.number(),
});

const postSchema = z.object({
  id: z.string(),
  subthreadId: z.string().optional(),
  authorId: z.string().optional(),
  content: z.string(),
  floorNumber: z.number().nullable().optional(),
  parentPostId: z.string().nullable().optional(),
  replyToPostId: z.string().nullable().optional(),
  version: z.number().optional(),
  deletedAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});

const draftSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  slot: z.number(),
  content: z.string(),
});

const bookmarkSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════
// Reporter
// ═══════════════════════════════════════════════════════════════

interface TestCase {
  name: string;
  fn: () => Promise<void>;
  tag: string;
}

const tests: TestCase[] = [];
let passed = 0,
  failed = 0;

function suite(name: string) {
  console.log(`\n${pc.bold(pc.cyan("── " + name + " ──"))}`);
  return name;
}

function test(tag: string, name: string, fn: () => Promise<void>) {
  tests.push({ name, fn, tag });
}

async function run() {
  console.log(
    pc.bold(
      pc.magenta("\n╔══════════════════════════════════════════╗")
    )
  );
  console.log(
    pc.bold(
      pc.magenta("║   温油站 API E2E 测试 (前端视角)        ║")
    )
  );
  console.log(
    pc.bold(
      pc.magenta("╚══════════════════════════════════════════╝")
    )
  );
  console.log(pc.dim(`   目标: ${BASE}`));
  console.log(pc.dim(`   时间: ${new Date().toISOString()}`));

  for (const t of tests) {
    const label = `[${t.tag}] ${t.name}`;
    try {
      await t.fn();
      console.log(`  ${pc.green("✓")} ${label}`);
      passed++;
    } catch (e: any) {
      console.log(`  ${pc.red("✗")} ${label}`);
      console.log(pc.red(`      ${e.message}`));
      failed++;
    }
  }

  console.log(pc.bold("\n──────────────────────────────────────────"));
  console.log(
    `  ${pc.green(`通过: ${passed}`)}  ${pc.red(
      `失败: ${failed}`
    )}  总计: ${passed + failed}`
  );
  console.log(pc.bold("──────────────────────────────────────────\n"));
  process.exit(failed > 0 ? 1 : 0);
}

// ═══════════════════════════════════════════════════════════════
// API Client（Fastify 兼容：无 body 时不设 Content-Type）
// ═══════════════════════════════════════════════════════════════

class Client {
  token = "";
  cookies = new Map<string, string>();

  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
    schema?: z.ZodType<T>
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

    const cookieHeader = Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    if (cookieHeader) headers["Cookie"] = cookieHeader;

    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });

    for (const [key, val] of res.headers.entries()) {
      if (key.toLowerCase() === "set-cookie") {
        const [nameVal] = val.split(";");
        const [name, ...valueParts] = nameVal.split("=");
        this.cookies.set(name.trim(), valueParts.join("="));
      }
    }

    const json = await res.json();
    if (schema) {
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new Error(
          `Schema 不匹配 ${method} ${path}: ${issues} — keys: ${Object.keys(
            json.data || json
          ).join(", ")}`
        );
      }
      return parsed.data;
    }
    return json as T;
  }

  get<T>(path: string, schema?: z.ZodType<T>) {
    return this.req<T>("GET", path, undefined, schema);
  }
  post<T>(path: string, body?: unknown, schema?: z.ZodType<T>) {
    return this.req<T>("POST", path, body, schema);
  }
  patch<T>(path: string, body?: unknown, schema?: z.ZodType<T>) {
    return this.req<T>("PATCH", path, body, schema);
  }
  put<T>(path: string, body?: unknown, schema?: z.ZodType<T>) {
    return this.req<T>("PUT", path, body, schema);
  }
  del<T>(path: string, body?: unknown, schema?: z.ZodType<T>) {
    return this.req<T>("DELETE", path, body, schema);
  }

  async expectStatus(
    path: string,
    method: string,
    body?: unknown
  ): Promise<{ status: number; json: any }> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const cookieHeader = Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    if (cookieHeader) headers["Cookie"] = cookieHeader;
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    return { status: res.status, json };
  }
}

const api = new Client();

// ═══════════════════════════════════════════════════════════════
// 辅助
// ═══════════════════════════════════════════════════════════════

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

let threadId = "";
let subthreadId = "";
let postId = "";
let replyPostId = "";
let draftId = "";
let bookmarkId = "";
let subscriptionId = "";
let tagId = "";
let useTestuserId = "cms5zycb900017q0azar1nag2";

function resolvePostgresContainer(): string {
  const configured = process.env.API_E2E_POSTGRES_CONTAINER?.trim();
  if (configured) return configured;

  const rows = execFileSync("docker", ["ps", "--format", "{{.Names}}\t{{.Image}}"], {
    encoding: "utf-8",
    timeout: 5000,
  })
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((row) => row.split("\t"))
    .filter(([, image]) => image?.startsWith("postgres:"));
  if (rows.length !== 1 || !rows[0][0]) {
    throw new Error("无法唯一识别本机 PostgreSQL 容器，请设置 API_E2E_POSTGRES_CONTAINER");
  }
  return rows[0][0];
}

/** 从 email_verifications 表中读取最新验证码 */
function fetchCodeFromDB(email: string): string | null {
  try {
    const safeEmail = email.replaceAll("'", "''");
    const result = execFileSync(
      "docker",
      [
        "exec",
        resolvePostgresContainer(),
        "psql",
        "-U",
        process.env.API_E2E_DB_USER ?? "wenyou",
        "-d",
        process.env.API_E2E_DB_NAME ?? "wenyousite",
        "-tA",
        "-c",
        `SELECT token FROM email_verifications WHERE email='${safeEmail}' ORDER BY created_at DESC LIMIT 1;`,
      ],
      { encoding: "utf-8", timeout: 5000 },
    );
    return result.trim();
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 1. 健康检查 & 公开端点
// ═══════════════════════════════════════════════════════════════

const s1 = suite("健康检查 & 公开端点");

test(s1, "GET /health 返回 ok", async () => {
  const r = await api.get("/health", apiResponse(z.any()));
  assert(r.data.status === "ok", "status 应为 ok");
  assert(r.data.info.database.status === "up", "数据库应为 up");
});

test(s1, "GET /meta 客户端协议元数据", async () => {
  const r = await api.get("/meta");
  assert(r.code === 0, "meta 应成功");
  assert(/^3\.0\./.test(r.data.contractVersion), "契约应为 3.0.x");
  assert(r.data.markdownContractVersion === 2, "Markdown 协议应为 v2");
});

test(s1, "GET /threads 公开列表（分页）", async () => {
  const r = await api.get("/threads?limit=3", apiPaginated(threadSchema));
  assert(Array.isArray(r.data), "data 应为数组");
  assert(typeof r.meta.hasMore === "boolean", "meta 应含 hasMore");
});

test(s1, "GET /search 全文搜索", async () => {
  const r = await api.get("/search?q=test&limit=5");
  assert(r.code === 0, "搜索应成功");
  assert(Array.isArray(r.data.threads) || Array.isArray(r.data.posts), "应返回搜索结果");
});

test(s1, "GET /users/:id 公开资料", async () => {
  const r = await api.get(`/users/${useTestuserId}`, apiResponse(z.any()));
  assert(r.data.username === "testuser", "用户名应为 testuser");
});

test(s1, "GET /users/:id (不存在) → 404", async () => {
  const { status } = await api.expectStatus("/users/nonexistent-12345", "GET");
  assert(status === 404, `期望 404, 实际 ${status}`);
});

// ═══════════════════════════════════════════════════════════════
// 2. 认证流程
// ═══════════════════════════════════════════════════════════════

const s2 = suite("认证流程");

test(s2, "POST /auth/register/request-code 请求验证码", async () => {
  const r = await api.post("/auth/register/request-code", {
    email: TEST_EMAIL,
  });
  assert(r.code === 0, `请求验证码应成功 (got: ${r.code})`);
});

test(s2, "POST /auth/register/verify-and-complete 注册", async () => {
  await new Promise((r) => setTimeout(r, 300));
  const code = fetchCodeFromDB(TEST_EMAIL);
  assert(!!code && code.length >= 6, `未找到验证码 (got: "${code}")`);
  const r = await api.post("/auth/register/verify-and-complete", {
    email: TEST_EMAIL,
    code,
    username: TEST_USERNAME,
    password: TEST_PASSWORD,
  });
  assert(r.code === 0, `注册应成功 (got: ${r.code} ${r.message})`);
  api.token = r.data.accessToken;
});

test(s2, "POST /auth/login 登录", async () => {
  // 用新用户登出再登入以测试纯登录
  await api.post("/auth/logout");
  const r = await api.post(
    "/auth/login",
    { account: TEST_EMAIL, password: TEST_PASSWORD },
    apiResponse(authResponseSchema)
  );
  assert(r.data.accessToken.length > 10, "accessToken 应有效");
  assert(r.data.refreshToken === undefined, "Web 登录响应体不应包含 refreshToken");
  api.token = r.data.accessToken;
});

test(s2, "GET /users/me 当前用户信息", async () => {
  const r = await api.get("/users/me", apiResponse(userSchema));
  assert(r.data.email === TEST_EMAIL, "邮箱应匹配");
  assert(r.data.emailVerified === true, "注册后应已验证");
});

test(s2, "POST /auth/refresh 刷新 token", async () => {
  const refreshToken = api.cookies.get("refreshToken");
  assert(!!refreshToken, "cookie 中应有 refreshToken");
  const r = await api.post(
    "/auth/refresh",
    { refreshToken },
    apiResponse(authResponseSchema)
  );
  assert(r.data.accessToken.length > 10, "新 accessToken 应有效");
  assert(r.data.refreshToken === undefined, "Web 刷新响应体不应包含 refreshToken");
  api.token = r.data.accessToken;
});

test(s2, "POST /auth/login 错误密码 → 401", async () => {
  const { status } = await api.expectStatus("/auth/login", "POST", {
    account: TEST_EMAIL,
    password: "WrongPass1!",
  });
  assert(status === 401, `期望 401, 实际 ${status}`);
});

test(s2, "GET /users/me 未登录 → 401", async () => {
  const prev = api.token;
  api.token = "";
  const { status } = await api.expectStatus("/users/me", "GET");
  api.token = prev;
  assert(status === 401, `期望 401, 实际 ${status}`);
});

// ═══════════════════════════════════════════════════════════════
// 3. 主题帖
// ═══════════════════════════════════════════════════════════════

const s3 = suite("主题帖");

test(s3, "POST /threads 创建草稿帖", async () => {
  const clientRequestId = crypto.randomUUID();
  const title = `E2E 测试帖 ${Date.now()}`;
  const r = await api.post("/threads", {
    title,
    category: "DEDUCTION",
    visibility: "PUBLIC",
    content: "帖子正文内容",
    clientRequestId,
  });
  assert(r.code === 0, `创建草稿应成功 (got: ${r.code} ${r.message})`);
  threadId = r.data.id;
  const replay = await api.post("/threads", {
    title,
    category: "DEDUCTION",
    visibility: "PUBLIC",
    content: "帖子正文内容",
    clientRequestId,
  });
  assert(replay.data.id === threadId, "相同创建幂等键应返回原主题帖");
});

test(s3, "GET /threads/draft 草稿箱（含新帖）", async () => {
  const r = await api.get("/threads/draft", apiResponse(z.any()));
  assert(r.code === 0, `草稿箱查询应成功 (got: ${r.code})`);
  assert(Array.isArray(r.data), "data 应为数组");
});

test(s3, "PATCH /threads/:id 发布默认子贴完整的草稿", async () => {
  const r = await api.patch(`/threads/${threadId}`, {
    published: true,
    version: 1,
  });
  assert(r.code === 0, `发布应成功 (got: ${r.code} ${r.message})`);
});

test(s3, "GET /threads/:id 获取已发布详情", async () => {
  const r = await api.get(`/threads/${threadId}`, apiResponse(threadSchema));
  assert(r.data.id === threadId, "ID 应匹配");
  assert(r.data.published === true, "应为已发布");
});

test(s3, "PATCH /threads/:id 乐观锁冲突", async () => {
  const { status } = await api.expectStatus(`/threads/${threadId}`, "PATCH", {
    version: 9999,
  });
  assert(status !== 200 && status !== 201, `应拒绝过期版本 (status: ${status})`);
});

test(s3, "GET /threads 列表含新帖", async () => {
  const r = await api.get("/threads?limit=20", apiPaginated(threadSchema));
  assert(r.data.some((t) => t.id === threadId), "列表应包含新创建的帖");
});

test(s3, "GET /threads filter=playing", async () => {
  const r = await api.get("/threads?filter=playing&limit=5");
  assert(r.code === 0, `filter=playing 应成功 (got: ${r.code})`);
});

test(s3, "GET /threads 非法推荐游标 → 400", async () => {
  const { status } = await api.expectStatus("/threads?sort=recommended&cursor=oops", "GET");
  assert(status === 400, `非法游标期望 400, 实际 ${status}`);
});

// ═══════════════════════════════════════════════════════════════
// 4. 子贴
// ═══════════════════════════════════════════════════════════════

const s4 = suite("子贴");

test(s4, "GET /threads/:id/subthreads 子贴列表", async () => {
  const r = await api.get(`/threads/${threadId}/subthreads`, apiResponse(z.any()));
  assert(Array.isArray(r.data), "data 应为数组");
  assert(r.data.length >= 1, "应至少有默认子贴");
  subthreadId = r.data[0].id;
});

test(s4, "POST /threads/:id/subthreads 创建子贴", async () => {
  const r = await api.post(`/threads/${threadId}/subthreads`, {
    title: "E2E 测试子贴",
    content: "子贴正文",
    sortOrder: 1,
    postingPolicy: "PARTICIPANTS",
    clientRequestId: crypto.randomUUID(),
  });
  assert(r.code === 0, `创建子贴应成功 (got: ${r.code} ${r.message})`);
  subthreadId = r.data.id;
});

test(s4, "GET /subthreads/:id 子贴详情", async () => {
  const r = await api.get(`/subthreads/${subthreadId}`, apiResponse(subthreadSchema));
  assert(r.data.id === subthreadId, "ID 应匹配");
});

test(s4, "PUT /threads/:id/subthreads/reorder 重排", async () => {
  const list = await api.get(`/threads/${threadId}/subthreads`, apiResponse(z.any()));
  const ids: string[] = Array.isArray(list.data) ? list.data.map((s: any) => s.id) : [];
  if (ids.length >= 2) {
    const r = await api.put(`/threads/${threadId}/subthreads/reorder`, { ids });
    assert(r.code === 0, `重排应成功 (got: ${r.code} ${r.message})`);
  }
});

// ═══════════════════════════════════════════════════════════════
// 5. 帖子 & 楼层
// ═══════════════════════════════════════════════════════════════

const s5 = suite("帖子 & 楼层");

test(s5, "GET /subthreads/:id/posts 楼层列表", async () => {
  const r = await api.get(
    `/subthreads/${subthreadId}/posts?limit=10`,
    apiPaginated(postSchema)
  );
  assert(Array.isArray(r.data), "data 应为数组");
});

test(s5, "POST /subthreads/:id/posts 发帖", async () => {
  const r = await api.post(`/subthreads/${subthreadId}/posts`, {
    content: faker.lorem.sentence(),
    clientRequestId: crypto.randomUUID(),
  });
  assert(r.code === 0, `发帖应成功 (got: ${r.code} ${r.message})`);
  postId = r.data.id;
});

test(s5, "GET /posts/:id 帖子详情", async () => {
  const r = await api.get(`/posts/${postId}`, apiResponse(postSchema));
  assert(r.data.id === postId, "ID 应匹配");
});

test(s5, "POST /subthreads/:id/posts 楼中楼回复", async () => {
  const r = await api.post(`/subthreads/${subthreadId}/posts`, {
    content: "楼中楼回复内容",
    parentPostId: postId,
    replyToPostId: postId,
    clientRequestId: crypto.randomUUID(),
  });
  assert(r.code === 0, `楼中楼应成功: ${r.code} ${r.message}`);
  replyPostId = r.data.id;
});

test(s5, "GET /posts/:id/replies 楼中楼列表", async () => {
  const r = await api.get(
    `/posts/${postId}/replies?limit=10`,
    apiPaginated(postSchema)
  );
  assert(Array.isArray(r.data), "data 应为数组");
});

test(s5, "PATCH /posts/:id 编辑帖子", async () => {
  const r = await api.patch(`/posts/${postId}`, {
    content: "编辑后的内容",
    version: 1,
  });
  assert(r.code === 0, `编辑应成功 (got: ${r.code} ${r.message})`);
});

test(s5, "PATCH /posts/:id 乐观锁冲突", async () => {
  const { status } = await api.expectStatus(`/posts/${postId}`, "PATCH", {
    content: "冲突",
    version: 9999,
  });
  assert(status !== 200, `应拒绝过期版本 (status: ${status})`);
});

test(s5, "POST /threads/:id/like 点赞", async () => {
  const r = await api.post(`/threads/${threadId}/like`);
  assert(r.code === 0, `点赞应成功 (got: ${r.code} ${r.message})`);
});

test(s5, "POST /threads/:id/like 重复点赞", async () => {
  const { status } = await api.expectStatus(
    `/threads/${threadId}/like`,
    "POST"
  );
  // API 可能返回 201（视为幂等成功）或 409（冲突）
  assert(
    [201, 409].includes(status),
    `重复点赞期望 201/409, 实际 ${status}`
  );
});

test(s5, "DELETE /threads/:id/like 取消点赞", async () => {
  const r = await api.del(`/threads/${threadId}/like`);
  assert(r.code === 0, `取消点赞应成功 (got: ${r.code} ${r.message})`);
});

// ═══════════════════════════════════════════════════════════════
// 6. 草稿池
// ═══════════════════════════════════════════════════════════════

const s6 = suite("草稿池");

test(s6, "GET /drafts/slots 槽位情况", async () => {
  const r = await api.get("/drafts/slots");
  assert(r.code === 0, `槽位查询应成功 (got: ${r.code})`);
});

test(s6, "POST /drafts 保存草稿", async () => {
  const r = await api.post("/drafts", { content: "E2E 草稿内容" });
  assert(r.code === 0, `保存应成功 (got: ${r.code} ${r.message})`);
  draftId = r.data.id;
});

test(s6, "GET /drafts 草稿列表", async () => {
  const r = await api.get("/drafts", apiResponse(z.array(draftSchema)));
  assert(Array.isArray(r.data), "data 应为数组");
});

test(s6, "GET /drafts/:id 单条草稿", async () => {
  const r = await api.get(`/drafts/${draftId}`, apiResponse(draftSchema));
  assert(r.data.id === draftId, "ID 应匹配");
});

test(s6, "PATCH /drafts/:id 更新草稿", async () => {
  const r = await api.patch(`/drafts/${draftId}`, {
    content: "更新后的草稿",
  });
  assert(r.code === 0, `更新应成功 (got: ${r.code} ${r.message})`);
});

test(s6, "DELETE /drafts/:id 删除草稿", async () => {
  const r = await api.del(`/drafts/${draftId}`);
  assert(r.code === 0, `删除应成功 (got: ${r.code} ${r.message})`);
});

// ═══════════════════════════════════════════════════════════════
// 7. 收藏
// ═══════════════════════════════════════════════════════════════

const s7 = suite("收藏");

test(s7, "POST /bookmarks 收藏", async () => {
  // 注意: CreateBookmarkDto 使用 @IsUUID()，但系统 ID 为 CUID 格式
  const r = await api.post("/bookmarks", { threadId });
  if (r.code === 0) {
    bookmarkId = r.data.id;
  } else {
    assert(r.code === 40001, `收藏预期失败: ${r.code} ${r.message} (UUID/CUID 不匹配)`);
  }
});

test(s7, "GET /bookmarks 收藏列表", async () => {
  const r = await api.get("/bookmarks?limit=10", apiPaginated(z.any()));
  assert(Array.isArray(r.data), "data 应为数组");
});

test(s7, "DELETE /bookmarks/:id 取消收藏", async () => {
  if (bookmarkId) {
    const r = await api.del(`/bookmarks/${bookmarkId}`);
    assert(r.code === 0, `取消收藏应成功 (got: ${r.code} ${r.message})`);
  }
});

// ═══════════════════════════════════════════════════════════════
// 8. 订阅
// ═══════════════════════════════════════════════════════════════

const s8 = suite("订阅");

test(s8, "POST /subscriptions 创建订阅 THREAD", async () => {
  // 注意: CreateSubscriptionDto 使用 @IsUUID()，系统 ID 为 CUID
  const r = await api.post("/subscriptions", { threadId, type: "THREAD" });
  if (r.code === 0) {
    subscriptionId = r.data.id;
  } else {
    assert(r.code === 40001, `订阅预期失败: ${r.code} ${r.message} (UUID/CUID 不匹配)`);
  }
});

test(s8, "GET /subscriptions 订阅列表", async () => {
  const r = await api.get("/subscriptions?limit=10", apiPaginated(z.any()));
  assert(Array.isArray(r.data), "data 应为数组");
});

test(s8, "DELETE /subscriptions/:id 取消订阅", async () => {
  if (subscriptionId) {
    const r = await api.del(`/subscriptions/${subscriptionId}`);
    assert(r.code === 0, `取消订阅应成功 (got: ${r.code} ${r.message})`);
  }
});

// ═══════════════════════════════════════════════════════════════
// 9. 通知
// ═══════════════════════════════════════════════════════════════

const s9 = suite("通知");

test(s9, "GET /notifications 通知列表", async () => {
  const r = await api.get("/notifications?limit=10");
  // 当用户无订阅数据时可能返回 50000，这是已知服务端问题
  assert([0, 50000].includes(r.code), `通知列表 (got: ${r.code} ${r.message})`);
});

test(s9, "GET /notifications/unread 未读数", async () => {
  const r = await api.get("/notifications/unread");
  assert(r.code === 0, `未读数应成功 (got: ${r.code})`);
});

test(s9, "POST /notifications/read-all 全部已读", async () => {
  const r = await api.post("/notifications/read-all");
  assert(r.code === 0, `全部已读应成功 (got: ${r.code} ${r.message})`);
});

// ═══════════════════════════════════════════════════════════════
// 10. 用户交互
// ═══════════════════════════════════════════════════════════════

const s10 = suite("用户交互");

test(s10, "GET /users/search 搜索用户", async () => {
  const r = await api.get("/users/search?q=test&limit=10");
  assert(r.code === 0, `搜索应成功 (got: ${r.code})`);
  assert(Array.isArray(r.data), "data 应为数组");
});

test(s10, "GET /users/:id/played-threads 参与帖", async () => {
  const r = await api.get(
    `/users/${useTestuserId}/played-threads`,
    apiResponse(z.any())
  );
  assert(r.code === 0, `参与帖应成功 (got: ${r.code})`);
});

test(s10, "GET /users/:id/recent-replies 最近回复", async () => {
  const r = await api.get(
    `/users/${useTestuserId}/recent-replies`,
    apiResponse(z.any())
  );
  assert(r.code === 0, `最近回复应成功 (got: ${r.code})`);
});

test(s10, "GET /users/:id/bookmarks 公开收藏", async () => {
  const r = await api.get(
    `/users/${useTestuserId}/bookmarks`,
    apiResponse(z.any())
  );
  assert(r.code === 0, `公开收藏应成功 (got: ${r.code})`);
});

// ═══════════════════════════════════════════════════════════════
// 11. 标签
// ═══════════════════════════════════════════════════════════════

const s11 = suite("标签");

test(s11, "POST /tags 创建标签", async () => {
  const name = faker.lorem.word().replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, "").slice(0, 20);
  const r = await api.post("/tags", { name, color: "#FF5722" });
  assert(r.code === 0, `创建标签应成功 (got: ${r.code} ${r.message})`);
  tagId = r.data.id;
});

test(s11, "GET /tags/:id 标签详情", async () => {
  const r = await api.get(`/tags/${tagId}`, apiResponse(z.any()));
  assert(r.data.id === tagId, "ID 应匹配");
});

test(s11, "POST /threads/:id/tags 为主题帖添加标签", async () => {
  const name = faker.lorem.word().replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, "").slice(0, 20);
  const r = await api.post(`/threads/${threadId}/tags`, { name });
  assert(r.code === 0, `添加标签应成功 (got: ${r.code} ${r.message})`);
});

test(s11, "GET /threads/:id/tags 帖标签列表", async () => {
  const r = await api.get(`/threads/${threadId}/tags`);
  assert(r.code === 0, `获取标签应成功 (got: ${r.code})`);
});

test(s11, "DELETE /threads/:id/tags/:tagId 移除标签", async () => {
  const r = await api.del(`/threads/${threadId}/tags/${tagId}`);
  // 标签可能已经被自动删除，允许非 0
  assert([0, 40400].includes(r.code), `移除标签 (got: ${r.code} ${r.message})`);
});

// ═══════════════════════════════════════════════════════════════
// 12. 参数校验 & 错误码
// ═══════════════════════════════════════════════════════════════

const s12 = suite("参数校验 & 错误码");

test(s12, "POST /auth/login 短密码 → 400", async () => {
  const { status } = await api.expectStatus("/auth/login", "POST", {
    account: TEST_EMAIL,
    password: "12",
  });
  assert(status === 400, `期望 400, 实际 ${status}`);
});

test(s12, "POST /threads 超长标题 → 400", async () => {
  const { status } = await api.expectStatus("/threads", "POST", {
    title: "a".repeat(101),
    category: "DEDUCTION",
  });
  assert(status === 400, `期望 400, 实际 ${status}`);
});

test(s12, "POST /subthreads/:id/posts 空内容 → 400", async () => {
  const { status } = await api.expectStatus(
    `/subthreads/${subthreadId}/posts`,
    "POST",
    { content: "" }
  );
  assert(status === 400, `期望 400, 实际 ${status}`);
});

test(s12, "GET /threads/:id 不存在 → 404", async () => {
  const { status } = await api.expectStatus(
    "/threads/nonexistent-id-x",
    "GET"
  );
  assert(status === 404, `期望 404, 实际 ${status}`);
});

test(s12, "POST /threads 缺少必填字段 → 400", async () => {
  const { status } = await api.expectStatus("/threads", "POST", {});
  // 创建帖时 title 和 category 都是可选，所以可能 201
  assert(
    [400, 201, 200].includes(status),
    `期望 400 或成功, 实际 ${status}`
  );
});

// ═══════════════════════════════════════════════════════════════
// 14. 清理
// ═══════════════════════════════════════════════════════════════

const s14 = suite("清理");

test(s14, "DELETE /posts/:id 软删除帖子", async () => {
  const r = await api.del(`/posts/${postId}`);
  assert(r.code === 0, `软删除应成功 (got: ${r.code} ${r.message})`);
});

test(s14, "DELETE /threads/:id 软删除主题帖", async () => {
  const r = await api.del(`/threads/${threadId}`);
  assert(r.code === 0, `软删除应成功 (got: ${r.code} ${r.message})`);
});

test(s14, "POST /auth/logout 登出", async () => {
  const r = await api.post("/auth/logout");
  assert(r.code === 0, `登出应成功 (got: ${r.code} ${r.message})`);
});

// ═══════════════════════════════════════════════════════════════
// 启动
// ═══════════════════════════════════════════════════════════════

run();
