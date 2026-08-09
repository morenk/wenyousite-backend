# 移动推送模块

## 职责

`mobile-push` 将 FCM registration token 绑定到当前原生移动登录终端，并异步投递隐私安全的通知。推送是提示通道，不替代通知、私聊和未读数 API。

## 端点

| Method | Path | 认证 | 说明 |
|---|---|---|---|
| PUT | `/mobile/devices/current` | AuthRead + mobile session | 注册或更新当前终端 FCM token |
| DELETE | `/mobile/devices/current` | AuthRead + mobile session | 停用当前终端推送 |

同一 FCM token 只归属一个用户/终端；重新注册会清理旧归属。记录保存平台、应用版本、locale、最近活跃时间和 enabled 状态，不保存设备广告 ID。

FCM `data` 使用独立的 [`mobile-push-v1.schema.json`](../../contracts/mobile-push-v1.schema.json) 机器契约和 [`mobile-push-v1-fixtures.json`](../../contracts/mobile-push-v1-fixtures.json) 黄金样例。`notification` 只携带 `notificationId`，`direct_message` 只携带 `conversationId` 和 `messageId`；所有值均为字符串，不得放入通知或私聊正文。

## 投递链路

```text
可靠领域事件 / 通知消费者
  → MobilePushProducer（稳定 jobId 去重）
  → BullMQ mobile-push（退避重试）
  → MobilePushProcessor（复查用户、终端与 token）
  → Firebase Admin SDK
```

私聊事件在消息事务中写入 Outbox，通知事件在通知落库后入队。发送前再次确认 mobile refresh-token family 仍活跃；退出登录、同端新登录、token 失效或清理任务停用记录后不再投递。FCM 报告 token 无效时永久停用，瞬时错误才重试。

通知按 `notificationId`、私聊按 `conversationId` 设置 Android/APNs collapse key。TTL 由 `MOBILE_PUSH_TTL_SECONDS` 配置，默认 86400 秒、允许 60 秒至 28 天。折叠、延迟和丢失属于正常提示通道语义，客户端必须重新读取通知、私聊和未读数 API，不能把每条推送当作可靠事件日志。

`PUSH_ENABLED=false` 是安全默认值。启用时必须配置 Firebase project 与应用默认凭据；`/meta.capabilities.pushNotifications` 同步反映运行能力。消息正文只使用通用提示与最小导航 data，避免在锁屏泄露私聊或通知内容。
