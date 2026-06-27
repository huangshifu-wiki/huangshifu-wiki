CREATE OR REPLACE FUNCTION "ensure_user_display_name_rules"()
RETURNS trigger AS $$
BEGIN
  NEW."displayName" := btrim(NEW."displayName");

  IF NEW."displayName" IS NULL OR NEW."displayName" = '' THEN
    RAISE EXCEPTION 'User displayName cannot be empty'
      USING ERRCODE = '23514', CONSTRAINT = 'User_displayName_no_whitespace';
  END IF;

  IF NEW."displayName" ~ '\s' THEN
    RAISE EXCEPTION 'User displayName cannot contain whitespace'
      USING ERRCODE = '23514', CONSTRAINT = 'User_displayName_no_whitespace';
  END IF;

  IF NEW."deletedAt" IS NULL
    AND NEW."status" = 'active'
    AND (
      TG_OP = 'INSERT'
      OR NEW."displayName" IS DISTINCT FROM OLD."displayName"
      OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt"
      OR OLD."status" IS DISTINCT FROM NEW."status"
    )
  THEN
    PERFORM pg_advisory_xact_lock(hashtext(lower(NEW."displayName")));

    IF EXISTS (
      SELECT 1
      FROM "User"
      WHERE "deletedAt" IS NULL
        AND "status" = 'active'
        AND lower("displayName") = lower(NEW."displayName")
        AND "uid" <> NEW."uid"
    ) THEN
      RAISE EXCEPTION 'User displayName already exists'
        USING ERRCODE = '23505', CONSTRAINT = 'User_displayName_unique_active';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "User_displayName_rules_trigger" ON "User";

CREATE TRIGGER "User_displayName_rules_trigger"
BEFORE INSERT OR UPDATE OF "displayName", "deletedAt", "status" ON "User"
FOR EACH ROW
EXECUTE FUNCTION "ensure_user_display_name_rules"();
