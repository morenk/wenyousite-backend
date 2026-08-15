-- 注册验证码通过后才创建 User；旧的未验证 User 不再是有效账号状态。
BEGIN;

CREATE TEMP TABLE _legacy_unverified_users ON COMMIT DROP AS
SELECT id
FROM users
WHERE email_verified = false;

UPDATE refresh_tokens
SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
WHERE user_id IN (SELECT id FROM _legacy_unverified_users);

UPDATE users
SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)
WHERE id IN (SELECT id FROM _legacy_unverified_users);

DELETE FROM email_verifications
WHERE type = 'EMAIL_VERIFY';

-- 已验证筛选等价于无筛选；未验证待发送计划不能在条件删除后扩大为全站广播。
UPDATE system_notification_campaigns
SET status = 'CANCELED',
    canceled_at = COALESCE(canceled_at, CURRENT_TIMESTAMP),
    failure_message = COALESCE(failure_message, '受众中的邮箱验证条件已移除')
WHERE status = 'SCHEDULED'
  AND audience->>'emailVerified' = 'false';

UPDATE system_notification_campaigns
SET audience = audience - 'emailVerified'
WHERE audience ? 'emailVerified';

ALTER TABLE users DROP COLUMN email_verified;

COMMIT;
