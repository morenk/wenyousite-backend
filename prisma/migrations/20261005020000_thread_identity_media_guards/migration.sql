-- 帖内当前头像与历史发言头像参与同一媒体回收锁，领取删除后禁止新增绑定。
CREATE TRIGGER guard_media_avatar_media_id
BEFORE INSERT OR UPDATE OF avatar_media_id ON thread_identities
FOR EACH ROW EXECUTE FUNCTION guard_media_attachment('avatar_media_id');

CREATE TRIGGER guard_media_identity_avatar_media_id
BEFORE INSERT OR UPDATE OF identity_avatar_media_id ON posts
FOR EACH ROW EXECUTE FUNCTION guard_media_attachment('identity_avatar_media_id');
