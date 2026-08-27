-- Corrects the backfill in 20260827090000, whose guard allowed at most nine
-- digits while an epoch second is ten. Nothing matched, so every row stayed at
-- zero and no setup could be re-read.
--
-- Rows whose trailing field is a price belong to the older identity scheme and
-- are deliberately left at zero: their zone cannot be located, so a fresh setup
-- is chosen for that symbol instead of pinning the reader to a plan we cannot
-- find on the chart.
UPDATE "TrackedSetup"
SET "zoneBaseTime" = CAST(split_part("signature", '|', 4) AS BIGINT)
WHERE "zoneBaseTime" = 0
  AND split_part("signature", '|', 4) ~ '^[0-9]{1,10}$'
  AND CAST(split_part("signature", '|', 4) AS BIGINT) <= 2147483647;
