-- Add enrichment fields to Contact for 360° profile
ALTER TABLE "Contact" ADD COLUMN     "addressCity" TEXT,
ADD COLUMN     "addressCountry" TEXT,
ADD COLUMN     "addressStreet" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "linkedin" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "twitter" TEXT;
