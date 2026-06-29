-- Drop legacy 'name' column now that data has been migrated to firstName + lastName
ALTER TABLE "User" DROP COLUMN IF EXISTS "name";
