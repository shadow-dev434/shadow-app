-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "occurrenceDate" TEXT,
ADD COLUMN     "recurringTemplateId" TEXT;

-- CreateTable
CREATE TABLE "RecurringTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'general',
    "urgency" INTEGER NOT NULL DEFAULT 3,
    "importance" INTEGER NOT NULL DEFAULT 3,
    "size" INTEGER NOT NULL DEFAULT 3,
    "frequency" TEXT NOT NULL,
    "weekdays" TEXT NOT NULL DEFAULT '[]',
    "monthDay" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringTask_userId_active_idx" ON "RecurringTask"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Task_recurringTemplateId_occurrenceDate_key" ON "Task"("recurringTemplateId", "occurrenceDate");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "RecurringTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringTask" ADD CONSTRAINT "RecurringTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
