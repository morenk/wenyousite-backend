# 前端错误处理指南

> 统一错误码含义、前端提示文案建议、重试策略。

## 统一响应格式

```json
{
  "code": 0,
  "message": "ok",
  "data": { ... },
  "meta": { ... }
}
```

- `code = 0` 表示成功。
- `code != 0` 表示业务异常，此时 `data` 通常为 null。
- HTTP 状态码：200（成功）、400（参数错误）、401（未认证）、403（无权限）、404（不存在）、409（冲突）、429（限流）、500（服务器错误）。

## 错误码速查

| code | HTTP | 含义 | 典型场景 | 前端提示建议 |
|------|------|------|----------|-------------|
| `0` | 200 | 成功 | — | — |
| `40000` | 400 | 参数校验失败 | 字段长度/格式不符合 DTO | 按字段显示校验错误 |
| `40001` | 400 | 业务逻辑错误 | 缺标题/分类/正文、重复发布 | 直接显示后端 message |
| `40100` | 401 | 未登录 | Token 缺失或无效 | 跳转登录页 |
| `40300` | 403 | 权限不足 | 非 OWNER 修改、未验证邮箱 | 提示无权限或引导验证邮箱 |
| `40400` | 404 | 资源不存在 | 帖/子贴/用户不存在 | 显示 404 页面或"内容不存在" |
| `40401` | 404 | 私密帖不可访问 | PRIVATE 帖非成员 | "该私密帖不可访问" |
| `40900` | 409 | 冲突 | 重复收藏、用户名占用、乐观锁冲突 | "内容已被修改，请刷新后重试" |
| `42900` | 429 | 限流 | 超过频率限制 | "操作太频繁，请稍后再试" |
| `50000` | 500 | 服务器错误 | 内部异常 | "服务器开小差了，请稍后重试" |

## 分类处理策略

### 认证类（40100 / 40300）

```typescript
if (code === 40100) {
  clearToken();
  redirect('/login');
}

if (code === 40300) {
  // 区分是未验证邮箱还是无权限
  if (message.includes('邮箱')) {
    showConfirm('请先验证邮箱', () => redirect('/verify-email'));
  } else {
    toast('暂无权限执行此操作');
  }
}
```

### 业务校验类（40001）

通常直接显示后端 message：

```typescript
if (code === 40001) {
  toast(message);
  // 如果是发布相关错误，滚动到对应字段
}
```

### 乐观锁冲突（40900）

不可自动重试，应提示用户刷新：

```typescript
if (code === 40900) {
  toast('内容已被其他设备修改，请刷新后重试');
  // 重新拉取最新数据
  await refetch();
}
```

### 限流（42900）

指数退避重试或提示等待：

```typescript
if (code === 42900) {
  toast('操作太频繁，请稍后再试');
}
```

### 网络错误

除了后端返回的错误码，还要处理网络层错误：

```typescript
try {
  await api.post('/threads', dto);
} catch (err) {
  if (err.name === 'TypeError' || err.message === 'Failed to fetch') {
    toast('网络连接失败，请检查网络');
  }
}
```

## 发布流程错误处理示例

```typescript
async function handlePublish(threadId: string, version: number) {
  try {
    const res = await api.patch(`/threads/${threadId}`, {
      published: true,
      version,
    });

    if (res.code === 0) {
      toast('发布成功');
      router.push(`/threads/${threadId}`);
      return;
    }

    switch (res.code) {
      case 40001:
        toast(res.message); // "请填写主题帖标题后再发布"
        break;
      case 40900:
        toast('内容已被修改，请刷新后重试');
        await fetchThread(threadId); // 刷新 version
        break;
      case 40100:
        redirect('/login');
        break;
      case 40300:
        toast('暂无发布权限');
        break;
      default:
        toast('发布失败，请稍后重试');
    }
  } catch (err) {
    toast('网络异常，请检查网络');
  }
}
```

## 全局请求拦截器建议

### Next.js / TypeScript

```typescript
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      clearToken();
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);
```

### Flutter

```dart
// 在 Dio 拦截器中统一处理 401
dio.interceptors.add(
  InterceptorsWrapper(
    onError: (e, handler) {
      if (e.response?.statusCode == 401) {
        authService.logout();
        navigator.pushReplacementNamed('/login');
      }
      handler.next(e);
    },
  ),
);
```

## 提示文案规范

- 对用户友好，不使用技术术语。
- 同一类错误在不同场景使用一致文案。
- 能给出下一步操作建议的，不要只显示"错误"。

| 场景 | 推荐文案 |
|------|---------|
| 未登录 | "请先登录" |
| 未验证邮箱 | "请先验证邮箱后再发布" |
| 发布缺标题 | "请填写主题帖标题后再发布" |
| 乐观锁冲突 | "内容已被修改，请刷新后重试" |
| 网络失败 | "网络连接失败，请检查网络后重试" |
| 限流 | "操作太频繁，请稍后再试" |
