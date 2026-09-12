-- Align the existing marketplace table with the Prisma schema. Legacy rows
-- stored major currency units as DOUBLE PRECISION; the runtime uses exact minor units.
ALTER TABLE "TusListing"
  ALTER COLUMN "price" TYPE BIGINT
  USING ROUND("price" * 100)::BIGINT;
