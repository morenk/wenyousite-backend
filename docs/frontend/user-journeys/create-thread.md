# 用户旅程：创建主题帖

> 从用户点击进入"创建主题帖"页面，到成功生成一份可编辑的沙盒草稿，完整接口调用与状态变化。

## AI 执行摘要

- **涉及页面**：创建主题帖页 / 草稿箱页
- **涉及接口**：`POST /threads`、`GET /threads/draft`、`GET /threads/:id`、`PATCH /threads/:id`、`DELETE /threads/:id`
- **关键状态**：`published=false` 的沙盒草稿，仅 owner 可见
- **常见错误**：`40100` 未登录、`40300` 邮箱未验证、`40001` 业务校验失败（发布阶段）

---

## 问题澄清：进入沙盒草稿箱的一瞬间，就已经 post 了吗？

**没有正式发布，但已经在服务端落了一条 Thread 记录。**

- 用户点进创建页后，前端应立即调用 `POST /threads`。
- 后端会在一个事务里创建：
  1. `Thread` 记录（`published=false`）
  2. `ThreadMember` 楼主身份（`role=OWNER`，`playerMarked=true`）
  3. 一个默认子贴（`sortOrder=0`）
  4. 如果请求带了 `content`，还会创建默认子贴的首楼 `Post`
- 此时帖子处于**沙盒草稿态**：
  - 不出现在 `GET /threads` 列表
  - 不出现在搜索结果
  - 非 owner 访问 `GET /threads/:id` 会返回 404
  - 不触发任何通知
- 真正的"发布"是之后的 `PATCH /threads/:id { published: true }`。

## 推荐的前端交互流程

### 方案 A：进入创建页即自动创建草稿（推荐）

```
用户点击"创建主题帖"按钮
        ↓
前端展示创建页骨架屏，同时调用 POST /threads（可只传空对象）
        ↓
后端返回 thread 对象（含 threadId、默认子贴 defaultSubthreadId）
        ↓
前端进入编辑态，所有改动都关联到这个 threadId
        ↓
用户可继续编辑标题/分类/标签/正文，或退出（草稿保留在"我的草稿箱"）
```

**优点**：
- 与后端"草稿 → 发布"的两阶段模型完全对齐。
- 用户随时退出都不会丢内容。
- 可以支持多子贴、多楼层的复杂创建流程。

**缺点**：
- 如果用户只是点进来看看就退出，会在数据库留下空草稿。
- 需要设计"放弃创建"入口，调用 `DELETE /threads/:id` 清理。

### 方案 B：用户填写内容后手动保存草稿

```
用户点击"创建主题帖"按钮
        ↓
前端展示创建页，但不调用接口
        ↓
用户输入标题或正文后，防抖调用 POST /threads
        ↓
后续同方案 A
```

**优点**：
- 减少空草稿数量。

**缺点**：
- 首次保存前没有 threadId，无法使用子贴、楼层等后续功能。
- 实现更复杂，需要处理"未保存状态"与"已保存状态"的切换。

## 建议

**MVP 阶段使用方案 A**：进入创建页即自动创建草稿。原因：
1. 实现最简单，符合后端设计假设。
2. 文字游戏论坛的创作流程本身较长，用户很少会点进来看看就走。
3. 定时任务会清理超过 7 天未发布的草稿，脏数据可控。

后续可以优化：在草稿箱列表提供"清空废弃草稿"或 30 分钟无操作自动清理的交互。

---

## 接口调用顺序

### 步骤 1：创建草稿

```http
POST /api/v1/threads
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "title": "我的第一个主题帖",
  "category": "RPG",
  "visibility": "PUBLIC",
  "subthreadTitle": "主帖",
  "content": "这里是开场白...",
  "tagNames": ["无限流", "穿越"]
}
```

**所有字段都是可选的**。如果用户什么都没填，可以传空对象 `{}`，后端会生成：
- `title`: `"未命名草稿"`
- `category`: `"DEDUCTION"`
- `visibility`: `"PUBLIC"`
- `subthreadTitle`: 同 title
- `content`: 空（默认子贴没有首楼正文）

**响应关键字段**：

```json
{
  "code": 0,
  "data": {
    "id": "clx...",
    "title": "我的第一个主题帖",
    "published": false,
    "defaultSubthreadId": "clx...",
    "defaultSubthread": {
      "id": "clx...",
      "title": "主帖"
    },
    "owner": { ... },
    "topicTags": [ ... ],
    "_count": { "subthreads": 1, "posts": 1 }
  }
}
```

**前端需要保存**：
- `threadId` → 后续所有操作都依赖它
- `defaultSubthreadId` → 默认子贴的首楼正文直接写在这里
- `version` → 发布时需要带上（乐观锁）

### 步骤 2：编辑标题/分类/标签

```http
PATCH /api/v1/threads/:id
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "title": "修改后的标题",
  "category": "DEDUCTION",
  "visibility": "PRIVATE",
  "version": 1
}
```

**注意**：
- `version` 必填，且必须等于当前 Thread 的 `version`。
- 如果并发修改会返回 `40900` 乐观锁冲突。
- 发布前可以无限次修改。

### 步骤 3：编辑默认子贴首楼正文

如果创建时已经传了 `content`，则默认子贴已经有首楼 `Post`。

后续修改正文：

```http
PATCH /api/v1/posts/:postId
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "content": "修改后的正文",
  "version": 1
}
```

如果创建时没有传 `content`，则默认子贴没有首楼，需要调用 `POST /subthreads/:id/posts` 创建首楼：

```http
POST /api/v1/subthreads/:defaultSubthreadId/posts
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "content": "这里是开场白..."
}
```

### 步骤 4：添加更多子贴（可选）

详见 `user-journeys/post-and-reply.md`。

### 步骤 5：保存/退出

用户点击"保存并退出"或"稍后继续"：

- 不需要调用任何接口（前面的修改已经实时保存）。
- 直接跳转首页或草稿箱。

### 步骤 6：发布

详见 `user-journeys/publish-thread.md`。

### 步骤 7：放弃创建（可选）

如果用户明确点击"放弃"，调用：

```http
DELETE /api/v1/threads/:id
Authorization: Bearer <accessToken>
```

- 未发布帖会**硬删除**（级联删除所有子贴、楼层、成员）。
- 已发布帖只能由 OWNER 软删除，且需要单独确认。

---

## 状态机

```
[点击创建] ──POST /threads──> [草稿态 published=false]
                                     │
                                     ├─ PATCH 编辑标题/分类/标签
                                     ├─ POST/PATCH 编辑子贴和楼层
                                     │
                                     ▼
                         PATCH /threads/:id { published: true, version }
                                     │
                                     ├─ 校验通过 ──> [已发布 published=true]
                                     │
                                     └─ 校验失败 ──> [保持草稿态，提示用户]
```

---

## 草稿箱入口

"我的草稿箱"页面调用：

```http
GET /api/v1/threads/draft
Authorization: Bearer <accessToken>
```

响应只返回当前用户的 `published=false` 主题帖。

前端展示建议：
- 显示标题（无标题时显示"未命名草稿"）
- 显示最后更新时间
- 显示子贴数和楼层数（`_count`）
- 提供"继续编辑"和"删除"操作

---

## 前端实现注意事项

1. **一进入创建页就调 `POST /threads`**，不要等到用户点保存。这是与后端模型对齐的最简单方式。
2. **创建请求失败要降级处理**：如果网络失败，提示"无法创建草稿，请检查网络"，不要卡住用户。
3. **拿到 `threadId` 后再显示完整编辑器**。如果创建请求还在进行中，可以显示骨架屏。
4. **标题为空时前端不要阻拦**，后端允许空标题，发布时再校验。
5. **分类未选时默认 `"DEDUCTION"`**，但发布时必须让用户明确选择。
6. **注意区分"沙盒草稿帖"和"全局草稿池"**：
   - 主题帖创建流程使用 Thread 级沙盒草稿。
   - 全局 5 槽位草稿池用于编辑器临时缓存，与本流程无关。

---

## 常见问题

### Q1：为什么创建草稿时会同时创建一个默认子贴？

后端强制每个 Thread 有一个默认子贴，作为帖子的"主内容区"。列表卡片预览也来自默认子贴的首楼正文。

### Q2：用户没有写任何内容就退出，会留下脏数据吗？

会。如果采用方案 A，会产生一个只有默认子贴但没有正文的空 Thread。建议：
- 在草稿箱列表允许用户一键删除空草稿。
- 后端定时任务每天清理超过 7 天未发布的草稿。

### Q3：草稿阶段可以邀请别人协作吗？

不可以。邀请链接、自由加入、成员管理都只在 `published=true` 后可用。

### Q4：草稿阶段可以@别人吗？

可以写 `@username` 文本，但**不会触发通知**。通知会在发布时统一回放。
