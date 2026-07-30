# Flutter 与 Web 端跨平台提示

> 两端共用同一套 REST API，但 UI/UX 实现上有差异。本文档列出关键差异点。

## 技术栈确认

| 平台 | 技术栈 | API 客户端 |
|------|--------|-----------|
| 移动端 | Flutter | `openapi_generator` 生成 Dart 客户端 |
| Web 端 | Next.js 15 + TypeScript | `openapi-typescript` + `openapi-fetch` |

## 共用的业务规则

以下规则两端完全一致，文档中不再重复：

- 认证流程（双 Token）
- 分页方式（Cursor/偏移量）
- 主题帖草稿 → 发布两阶段模型
- @提及规则
- 发帖权限策略
- 错误码含义

## 平台差异

### 1. 创建主题帖

| 场景 | Flutter | Web |
|------|---------|-----|
| 入口 | FAB 或首页"+"按钮 | 顶部导航"创建"按钮 |
| 编辑器 | 简化 Markdown 编辑器，底部固定工具栏 | 完整 Markdown 编辑器，支持双栏预览 |
| 自动创建草稿 | 进入创建页即调 `POST /threads` | 同左 |
| 发布按钮 | 顶部 AppBar 右侧 | 顶部工具栏 + Ctrl+Enter 快捷键 |
| 图片上传 | 调相册或相机 → S3 预签名直传 | 拖拽上传 / 粘贴上传 → S3 预签名直传 |

### 2. 列表与详情

| 场景 | Flutter | Web |
|------|---------|-----|
| 列表刷新 | 下拉刷新 + 上拉加载更多 | 下拉刷新 + 滚动加载更多 |
| 详情页 | 从底部滑入的 Sheet 或新页面 | 新页面，右侧显示子贴目录 |
| 楼层回复 | 底部固定回复框 | 内联回复或底部回复框 |
| @提及建议 | 输入 @ 弹出底部用户列表 | 输入 @ 弹出浮动用户列表 |

### 3. 长文编辑

Web 端更适合长文编辑，原因：

- 大屏幕可展示双栏预览。
- 浏览器原生支持复制粘贴大段文字。
- 可集成成熟 Markdown 编辑器（Editor.md、Milkdown、TipTap）。

Flutter 端长文编辑建议：

- 使用 `flutter_markdown` 预览。
- 提供快速插入 Markdown 语法的工具栏。
- 重要长文引导用户到 Web 端编辑。

### 4. 通知

| 场景 | Flutter | Web |
|------|---------|-----|
| 推送 | 接入 FCM / 极光推送 | 使用 Service Worker 接收 Web Push |
| 红点 | App 图标红点 + 站内红点 | 站内红点 |
| 通知列表 | 单独页面 | 下拉菜单或单独页面 |

### 5. 认证与 Token

| Token | Flutter | Web |
|------|---------|-----|
| accessToken | 存储在 secure_storage | 存储在 memory 或 localStorage |
| refreshToken | 由后端通过 httpOnly Cookie 自动管理 | 同左 |

## API 调用示例对比

### 创建主题帖草稿

**Flutter**

```dart
final client = DefaultApi(dio);
final res = await client.threadsControllerCreate(
  createThreadDto: CreateThreadDto(
    title: '我的主题帖',
    category: 'RPG',
    visibility: 'PUBLIC',
  ),
);
final threadId = res.data!.id;
```

**Next.js**

```typescript
const { data, error } = await client.POST('/threads', {
  body: {
    title: '我的主题帖',
    category: 'RPG',
    visibility: 'PUBLIC',
  },
});
const threadId = data!.id;
```

## 图片上传差异

图片上传流程两端一致：

1. 后端 `POST /media/presigned-url` 获取预签名 URL。
2. 客户端直传 S3。
3. 调 `POST /media/upload-done` 确认。

差异在于文件来源：

- Flutter：`image_picker` 选择相册/相机。
- Web：`<input type="file">` 或拖拽或粘贴。

## 路由建议

### Flutter 路由

```
/threads                    首页列表
/threads/create             创建主题帖
/threads/:id                主题帖详情
/threads/:id/edit           编辑主题帖
/drafts                     我的草稿箱
/notifications              通知列表
/me                         我的
```

### Web 路由

```
/                           首页列表
/threads/create             创建主题帖
/threads/:id                主题帖详情
/threads/:id/edit           编辑主题帖
/drafts                     我的草稿箱
/notifications              通知列表
/users/:id                  用户主页
```

## 性能注意

- 列表接口默认返回 20 条，移动端可酌情减少到 10-15 条。
- 详情页不返回正文，需要单独拉取子贴楼层列表。
- 图片使用 WebP 缩略图（300x300）预览，点击后再加载原图。
