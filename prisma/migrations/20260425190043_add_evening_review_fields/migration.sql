-- AlterTable
ALTER TABLE "DailyPlan" ADD COLUMN     "originalPlanJson" TEXT,
ADD COLUMN     "pinnedIds" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "threadId" TEXT;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "threadId" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "eveningWindowEnd" TEXT NOT NULL DEFAULT '23:00',
ADD COLUMN     "eveningWindowStart" TEXT NOT NULL DEFAULT '20:00';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "postponedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- AddForeignKey
ALTER TABLE "DailyPlan" ADD CONSTRAINT "DailyPlan_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
