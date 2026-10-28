-- Add event-level pending/postponed time states and backfill events without a usable time.
CREATE TYPE "EventTimeStatus" AS ENUM ('pending', 'postponed');

ALTER TABLE "Event"
ADD COLUMN "timeStatus" "EventTimeStatus";

UPDATE "Event"
SET
  "timeSlots" = '[]'::jsonb,
  "timeStatus" = 'pending',
  "sortStart" = NULL,
  "sortEnd" = NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof("timeSlots") = 'array' THEN "timeSlots"
      ELSE '[]'::jsonb
    END
  ) AS slot
  WHERE jsonb_typeof(slot->'start') = 'string'
    AND jsonb_typeof(slot->'type') = 'string'
    AND (
      (
        slot->>'type' = 'date'
        AND slot->>'start' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      )
      OR (
        slot->>'type' = 'datetime'
        AND slot->>'start' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'
      )
    )
);

ALTER TABLE "Event"
ADD CONSTRAINT "Event_time_presence_check"
CHECK (
  "timeStatus" IS NOT NULL
  OR jsonb_array_length(
    CASE
      WHEN jsonb_typeof("timeSlots") = 'array' THEN "timeSlots"
      ELSE '[]'::jsonb
    END
  ) > 0
);
