-- CreateTable
CREATE TABLE "BugReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expected" TEXT,
    "severityUser" TEXT NOT NULL,
    "reproducibility" TEXT NOT NULL,
    "context" TEXT NOT NULL DEFAULT '{}',
    "appVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "priority" TEXT,
    "adminNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BugReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetaFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "answers" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentResponse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instrument" TEXT NOT NULL,
    "wave" TEXT NOT NULL,
    "itemScores" TEXT NOT NULL DEFAULT '{}',
    "totalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subscales" TEXT,
    "completedAt" TIMESTAMP(3),
    "administeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BugReport_userId_idx" ON "BugReport"("userId");

-- CreateIndex
CREATE INDEX "BugReport_status_idx" ON "BugReport"("status");

-- CreateIndex
CREATE INDEX "BetaFeedback_userId_kind_idx" ON "BetaFeedback"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "BetaFeedback_userId_kind_day_key" ON "BetaFeedback"("userId", "kind", "day");

-- CreateIndex
CREATE INDEX "AssessmentResponse_userId_wave_idx" ON "AssessmentResponse"("userId", "wave");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentResponse_userId_instrument_wave_key" ON "AssessmentResponse"("userId", "instrument", "wave");

-- AddForeignKey
ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetaFeedback" ADD CONSTRAINT "BetaFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentResponse" ADD CONSTRAINT "AssessmentResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
