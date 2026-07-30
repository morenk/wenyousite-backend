# 用户旅程：认证

> 注册、登录、Token 刷新、邮箱验证、修改/重置密码、登出、会话管理。

## AI 执行摘要

- **涉及页面**：注册页 / 登录页 / 验证码输入页 / 修改密码页 / 忘记密码页 / 会话管理页
- **涉及接口**：
  - 注册：`POST /auth/register/request-code`、`POST /auth/register/verify-and-complete`
  - 登录：`POST /auth/login`
  - 刷新：`POST /auth/refresh`
  - 邮箱验证：`POST /auth/resend-verification`、`POST /auth/verify-email`
  - 密码：`POST /auth/change-password`、`POST /auth/forgot-password`、`POST /auth/reset-password`
  - 邮箱更换：`POST /auth/change-email/request-code`、`POST /auth/change-email/verify`
  - 登出/会话：`POST /auth/logout`、`GET /auth/sessions`、`DELETE /auth/sessions/:id`
- **关键状态**：accessToken（15 分钟）/ refreshToken（Web 7 天 / Mobile 30 天）
- **常见错误**：`40100` 未登录/令牌失效、`40001` 验证码错误/过期、`40900` 用户名占用

---

## 双 Token 模型

| Token | 有效期 | 存储位置 | 用途 |
|-------|--------|----------|------|
| `accessToken` | 15 分钟 | 前端内存 / localStorage | 请求时放 `Authorization: Bearer <token>` |
| `refreshToken` | Web 7 天 / Mobile 30 天 | httpOnly Cookie（自动）+ 响应体 | 刷新 accessToken |

**Cookie 优先**：后端优先从 Cookie 读取 refreshToken，响应体中的 `refreshToken` 是移动端的备选。

**前端要求**：
- 每次请求必须带 `Authorization: Bearer <accessToken>`。
- 服务端 refresh 后返回新的 refreshToken，前端需要更新本地存储的副本。

---

## 注册流程

### 第一步：请求验证码

```http
POST /api/v1/auth/register/request-code
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**响应**：

```json
{
  "code": 0,
  "data": {
    "emailSent": true,
    "codeExpiresIn": 900
  }
}
```

**前端行为**：
- 显示"验证码已发送，请查收邮箱"。
- 倒计时 60 秒后才能再次点击"重新发送"。
- 后端限流 1 次/分钟。

### 第二步：提交验证码 + 用户名 + 密码

```http
POST /api/v1/auth/register/verify-and-complete
Content-Type: application/json
X-Client-Platform: web

{
  "email": "user@example.com",
  "token": "123456",
  "username": "zhangsan",
  "password": "SecurePass123!"
}
```

**响应**：

```json
{
  "code": 0,
  "data": {
    "accessToken": "eyJhbG...",
    "refreshToken": "a1b2c3d4...",
    "user": {
      "id": "clx...",
      "email": "user@example.com",
      "username": "zhangsan",
      "avatar": null,
      "role": "USER",
      "emailVerified": true
    }
  },
  "message": "注册成功"
}
```

**注册完成后**：
- `emailVerified` 为 `true`，用户可立即使用全部功能。
- 前端保存 accessToken，后端自动设置 refreshToken Cookie。

### 用户名规则

- 2-24 位
- 允许字母、数字、中文
- 不允许标点符号和特殊字符
- 唯一，不能与他人重复

### 密码规则

- 至少 8 位
- 必须包含至少一个字母和一个数字

---

## 登录流程

```http
POST /api/v1/auth/login
Content-Type: application/json
X-Client-Platform: web

{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**响应**：与注册第二步相同，返回双 Token + 用户信息。

**错误处理**：
- 邮箱或密码错误：返回 401。
- 连续 5 次失败：账号锁定 15 分钟。

---

## Token 刷新

当 accessToken 即将过期或已过期时调用：

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refreshToken": "a1b2c3d4..."
}
```

Cookie 中有 refreshToken 时可以不传 body。

**响应**：新的双 Token + 用户信息。

**前端建议**：
- 在请求拦截器中检测 401，自动调用 refresh。
- refresh 成功后重试原请求。
- refresh 失败（Cookie 过期/被盗用）则跳转登录页。

**盗用检测**：
- 如果服务端检测到已撤销的 refreshToken 被重放，会吊销该设备 family 下所有 token。
- 前端收到"令牌已失效，请重新登录"时，必须清除本地 token 并跳转登录。

---

## 邮箱验证

注册后已经是 `emailVerified=true`，但以下场景可能需要手动验证：

### 重发验证邮件

```http
POST /api/v1/auth/resend-verification
Content-Type: application/json

{
  "email": "user@example.com"
}
```

### 提交验证码

```http
POST /api/v1/auth/verify-email
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "token": "123456"
}
```

---

## 修改密码

```http
POST /api/v1/auth/change-password
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "oldPassword": "SecurePass123!",
  "newPassword": "NewPass456!"
}
```

**副作用**：所有设备 refresh token 被吊销，所有端强制登出。

**前端提示**："密码修改成功，请重新登录"。

---

## 忘记/重置密码

### 第一步：发送重置邮件

```http
POST /api/v1/auth/forgot-password
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**反枚举**：无论邮箱是否注册，都返回相同成功消息。前端不要提示"该邮箱未注册"。

### 第二步：重置密码

```http
POST /api/v1/auth/reset-password
Content-Type: application/json

{
  "email": "user@example.com",
  "token": "123456",
  "newPassword": "NewPass456!"
}
```

**副作用**：所有设备 refresh token 被吊销。

**前端提示**："密码重置成功，请重新登录"。

---

## 更换邮箱

### 第一步：向新邮箱发送验证码

```http
POST /api/v1/auth/change-email/request-code
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "newEmail": "new@example.com"
}
```

### 第二步：验证新邮箱

```http
POST /api/v1/auth/change-email/verify
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "newEmail": "new@example.com",
  "code": "123456"
}
```

---

## 登出

```http
POST /api/v1/auth/logout
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "refreshToken": "a1b2c3d4..."
}
```

**前端行为**：
- 清除本地 accessToken。
- 后端会清除 refreshToken Cookie。

---

## 会话管理

### 获取会话列表

```http
GET /api/v1/auth/sessions
Authorization: Bearer <accessToken>
```

**响应**：

```json
{
  "code": 0,
  "data": [
    {
      "id": "clx...",
      "platform": "web",
      "deviceInfo": "Chrome 132 / Windows",
      "isCurrent": true,
      "createdAt": "...",
      "expiresAt": "..."
    },
    {
      "id": "clx...",
      "platform": "mobile",
      "deviceInfo": "iOS App 1.2",
      "isCurrent": false,
      "createdAt": "...",
      "expiresAt": "..."
    }
  ]
}
```

### 撤销指定会话

```http
DELETE /api/v1/auth/sessions/:id
Authorization: Bearer <accessToken>
```

**用途**：在 Web 端看到异常移动端登录时，可以远程踢除。

---

## 前端实现建议

### 1. 请求拦截器

```typescript
// Next.js / TypeScript 示例
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

### 2. 响应拦截器处理 401

```typescript
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const { data } = await api.post('/auth/refresh');
        setAccessToken(data.data.accessToken);
        return api(original);
      } catch {
        clearTokens();
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);
```

### 3. 平台头

所有认证相关请求建议带 `X-Client-Platform: web|mobile`，后端据此决定 refreshToken 有效期。

### 4. Flutter 中的 token 存储

```dart
// accessToken 存 secure_storage
await FlutterSecureStorage().write(key: 'accessToken', value: token);

// refreshToken 由后端 httpOnly Cookie 管理， dio 自动处理
```

---

## 错误处理速查

| 场景 | 错误码/提示 | 前端处理 |
|------|------------|----------|
| 验证码错误 | 40001 | 提示"验证码错误"，失败 5 次后要求重新获取 |
| 验证码过期 | 40001 | 提示"验证码已过期，请重新获取" |
| 用户名被占用 | 40900 | 提示"用户名已被占用" |
| 邮箱已注册 | 40900 | 跳转登录页或提示"该邮箱已注册" |
| 登录失败 | 40100 | 提示"邮箱或密码错误"，记录失败次数 |
| 账号锁定 | 40100 | 提示"失败次数过多，请 15 分钟后重试" |
| 令牌失效 | 40100 | 清除 token，跳转登录 |

---

## 状态机

```
[未登录]
   │
   ├─ 注册 ──> [验证码] ──> [注册完成] ──> [已登录]
   │
   ├─ 登录 ──> [已登录]
   │
   └─ 忘记密码 ──> [重置邮件] ──> [重置密码] ──> [需重新登录]

[已登录]
   │
   ├─ accessToken 过期 ──> /auth/refresh ──> [已登录]
   │
   ├─ refreshToken 过期/被盗 ──> [未登录]
   │
   ├─ 修改密码 ──> [所有设备登出]
   │
   └─ 主动登出 ──> [未登录]
```
