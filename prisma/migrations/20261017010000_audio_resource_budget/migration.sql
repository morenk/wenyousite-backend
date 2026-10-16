ALTER TABLE media ADD COLUMN audio_input_bytes INTEGER, ADD COLUMN audio_upload_lease_until TIMESTAMP(3);
ALTER TABLE media ADD CONSTRAINT media_audio_input_bytes_positive CHECK (audio_input_bytes IS NULL OR audio_input_bytes BETWEEN 1 AND 31457280);
-- 在途记录的 size 仍是输入；完成记录已转码，不能伪造历史输入字节。
UPDATE media SET audio_input_bytes = size
WHERE purpose = 'RICH_CONTENT_AUDIO' AND status IN ('UPLOADING', 'PROCESSING') AND size BETWEEN 1 AND 31457280;
CREATE INDEX media_audio_admission_idx ON media(user_id, purpose, created_at);
