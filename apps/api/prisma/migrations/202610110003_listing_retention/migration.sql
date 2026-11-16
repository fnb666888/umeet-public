-- AlterTable
ALTER TABLE "Verification" ADD COLUMN     "reviewedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "marketType" TEXT DEFAULT 'SELL';
