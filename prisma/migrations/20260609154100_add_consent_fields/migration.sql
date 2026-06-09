-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "consentArt9" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "consentGivenAt" TIMESTAMP(3),
ADD COLUMN     "consentVersion" TEXT;
