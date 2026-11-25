-- Admin-controlled, time-limited student accounts.
-- Adds the DELETION_PENDING lifecycle state and per-student access/expiry fields.
-- Additive and idempotent: never drops or rewrites existing data.

-- New lifecycle state. ADD VALUE IF NOT EXISTS is safe to re-run; the value is
-- not USED in this migration, so it is fine inside the migration transaction.
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'DELETION_PENDING';

-- Per-student access-control columns (all nullable; existing rows unaffected).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "studentIdNo" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accessStartAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accessExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletionStartedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adminNotes" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "createdByAdminId" TEXT;

-- Self-FK: who created the student. Keep the row if the admin is later removed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'User_createdByAdminId_fkey'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_createdByAdminId_fkey"
      FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

-- Indexes for the expiry sweep and admin listing.
CREATE INDEX IF NOT EXISTS "User_accessExpiresAt_idx" ON "User"("accessExpiresAt");
CREATE INDEX IF NOT EXISTS "User_status_accessExpiresAt_idx" ON "User"("status", "accessExpiresAt");
