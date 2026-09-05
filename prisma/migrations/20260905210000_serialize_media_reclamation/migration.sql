ALTER TABLE "media" ADD COLUMN "deletion_claimed_at" TIMESTAMP(3);
CREATE INDEX "media_deletion_claimed_at_idx" ON "media"("deletion_claimed_at");

-- Every foreign-key attachment takes the same row lock as the reclamation claim.
-- The check runs before the FK write, so a claimant can never delete a newly bound object.
CREATE FUNCTION guard_media_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  media_id text;
  claimed_at timestamp;
BEGIN
  media_id := to_jsonb(NEW) ->> TG_ARGV[0];
  IF media_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) ->> TG_ARGV[0]) IS NOT DISTINCT FROM media_id THEN
    RETURN NEW;
  END IF;
  SELECT deletion_claimed_at INTO claimed_at FROM media WHERE id = media_id FOR UPDATE;
  IF claimed_at IS NOT NULL THEN
    RAISE EXCEPTION 'media_deletion_claimed' USING ERRCODE = '23514', CONSTRAINT = 'media_deletion_claimed';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE ref record;
BEGIN
  FOR ref IN
    SELECT c.conrelid::regclass AS relation, a.attname AS column_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'media'::regclass
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %s FOR EACH ROW EXECUTE FUNCTION guard_media_attachment(%L)',
      'guard_media_' || ref.column_name, ref.column_name, ref.relation, ref.column_name
    );
  END LOOP;
END;
$$;

CREATE FUNCTION guard_media_deletion_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deletion_claimed_at IS NOT NULL AND
     (NEW.deletion_claimed_at IS NULL OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'media_deletion_claimed' USING ERRCODE = '23514', CONSTRAINT = 'media_deletion_claimed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_media_deletion_claim BEFORE UPDATE ON media
FOR EACH ROW EXECUTE FUNCTION guard_media_deletion_claim();
