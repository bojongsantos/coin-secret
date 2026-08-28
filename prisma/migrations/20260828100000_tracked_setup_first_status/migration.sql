-- AlterTable
ALTER TABLE "TrackedSetup" ADD COLUMN     "firstStatus" TEXT NOT NULL DEFAULT '';

-- A setup waiting at its limit right now is, by observation, one we published
-- before it filled. Recording that is not a guess about the past; it is what
-- the column means, established at the only moment it can still be checked.
--
-- Everything already filled stays blank on purpose. We cannot know whether it
-- was published in advance, and assuming so would let the archive imply the
-- scanner called entries it never called.
UPDATE "TrackedSetup"
SET "firstStatus" = 'Limit Order'
WHERE "firstStatus" = '' AND "status" = 'Limit Order';
