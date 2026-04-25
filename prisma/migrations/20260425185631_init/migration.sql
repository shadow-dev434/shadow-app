-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "importance" INTEGER NOT NULL DEFAULT 3,
    "urgency" INTEGER NOT NULL DEFAULT 3,
    "deadline" TIMESTAMP(3),
    "resistance" INTEGER NOT NULL DEFAULT 3,
    "size" INTEGER NOT NULL DEFAULT 3,
    "delegable" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL DEFAULT 'general',
    "context" TEXT NOT NULL DEFAULT 'any',
    "avoidanceCount" INTEGER NOT NULL DEFAULT 0,
    "lastAvoidedAt" TIMESTAMP(3),
    "quadrant" TEXT NOT NULL DEFAULT 'unclassified',
    "priorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "decision" TEXT NOT NULL DEFAULT 'unclassified',
    "decisionReason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'inbox',
    "microSteps" TEXT NOT NULL DEFAULT '[]',
    "microStepsRaw" TEXT NOT NULL DEFAULT '',
    "currentStepIdx" INTEGER NOT NULL DEFAULT 0,
    "executionMode" TEXT NOT NULL DEFAULT 'none',
    "sessionFormat" TEXT NOT NULL DEFAULT 'standard',
    "sessionDuration" INTEGER NOT NULL DEFAULT 25,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "delegatedToId" TEXT,
    "delegationNote" TEXT NOT NULL DEFAULT '',
    "delegationStatus" TEXT NOT NULL DEFAULT '',
    "reminderAt" TIMESTAMP(3),
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "calendarEventId" TEXT NOT NULL DEFAULT '',
    "aiClassified" BOOLEAN NOT NULL DEFAULT false,
    "aiClassificationData" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "actionUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Streak" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "tasksPlanned" INTEGER NOT NULL DEFAULT 0,
    "completionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Streak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "top3Ids" TEXT NOT NULL DEFAULT '[]',
    "doNowIds" TEXT NOT NULL DEFAULT '[]',
    "scheduleIds" TEXT NOT NULL DEFAULT '[]',
    "delegateIds" TEXT NOT NULL DEFAULT '[]',
    "postponeIds" TEXT NOT NULL DEFAULT '[]',
    "energyLevel" INTEGER NOT NULL DEFAULT 3,
    "timeAvailable" INTEGER NOT NULL DEFAULT 480,
    "currentContext" TEXT NOT NULL DEFAULT 'any',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPlanTask" (
    "id" TEXT NOT NULL,
    "dailyPlanId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,

    CONSTRAINT "DailyPlanTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "whatDone" TEXT NOT NULL DEFAULT '',
    "whatAvoided" TEXT NOT NULL DEFAULT '',
    "whatBlocked" TEXT NOT NULL DEFAULT '',
    "restartFrom" TEXT NOT NULL DEFAULT '',
    "mood" INTEGER NOT NULL DEFAULT 3,
    "energyEnd" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewTask" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "ReviewTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPattern" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "avoidedCategories" TEXT NOT NULL DEFAULT '[]',
    "difficultTimeSlots" TEXT NOT NULL DEFAULT '[]',
    "problematicCategories" TEXT NOT NULL DEFAULT '[]',
    "effectiveFormats" TEXT NOT NULL DEFAULT '[]',
    "averageResistance" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "averageCompletion" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "totalTasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "totalTasksAvoided" INTEGER NOT NULL DEFAULT 0,
    "streakDays" INTEGER NOT NULL DEFAULT 0,
    "lastActiveDate" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultEnergy" INTEGER NOT NULL DEFAULT 3,
    "defaultContext" TEXT NOT NULL DEFAULT 'any',
    "defaultDuration" INTEGER NOT NULL DEFAULT 25,
    "defaultFormat" TEXT NOT NULL DEFAULT 'standard',
    "wakeTime" TEXT NOT NULL DEFAULT '07:00',
    "sleepTime" TEXT NOT NULL DEFAULT '23:00',
    "productiveSlots" TEXT NOT NULL DEFAULT '["morning"]',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reminderMinutes" INTEGER NOT NULL DEFAULT 15,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "onboardingAnswers" TEXT NOT NULL DEFAULT '{}',
    "onboardingAnswersVersion" INTEGER NOT NULL DEFAULT 1,
    "tourCompleted" BOOLEAN NOT NULL DEFAULT false,
    "tourStep" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT NOT NULL DEFAULT '',
    "occupation" TEXT NOT NULL DEFAULT '',
    "age" INTEGER NOT NULL DEFAULT 0,
    "livingSituation" TEXT NOT NULL DEFAULT '',
    "hasChildren" BOOLEAN NOT NULL DEFAULT false,
    "householdManager" BOOLEAN NOT NULL DEFAULT false,
    "mainResponsibilities" TEXT NOT NULL DEFAULT '[]',
    "difficultAreas" TEXT NOT NULL DEFAULT '[]',
    "dailyRoutine" TEXT NOT NULL DEFAULT '',
    "cognitiveLoad" INTEGER NOT NULL DEFAULT 3,
    "responsibilityLoad" INTEGER NOT NULL DEFAULT 3,
    "timeConstraints" TEXT NOT NULL DEFAULT '',
    "lifeContext" TEXT NOT NULL DEFAULT '',
    "executionStyle" TEXT NOT NULL DEFAULT '',
    "preferredSessionLength" INTEGER NOT NULL DEFAULT 25,
    "focusModeDefault" TEXT NOT NULL DEFAULT 'soft',
    "blockedApps" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrictModeSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "triggerType" TEXT NOT NULL DEFAULT 'manual',
    "taskId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "exitedAt" TIMESTAMP(3),
    "exitAttempts" INTEGER NOT NULL DEFAULT 0,
    "exitReason" TEXT NOT NULL DEFAULT '',
    "exitConfirmationText" TEXT NOT NULL DEFAULT '',
    "blockedApps" TEXT NOT NULL DEFAULT '[]',
    "blockedSites" TEXT NOT NULL DEFAULT '[]',
    "plannedDurationMinutes" INTEGER NOT NULL DEFAULT 25,
    "actualDurationMinutes" INTEGER NOT NULL DEFAULT 0,
    "taskCompletedDuringSession" BOOLEAN NOT NULL DEFAULT false,
    "distractionsBlocked" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrictModeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdaptiveProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "executiveLoad" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "familyResponsibilityLoad" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "domesticBurden" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "workStudyCentrality" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "rewardSensitivity" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "noveltySeeking" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "avoidanceProfile" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "activationDifficulty" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "frictionSensitivity" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "shameFrustrationSensitivity" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "preferredTaskStyle" TEXT NOT NULL DEFAULT 'guided',
    "preferredPromptStyle" TEXT NOT NULL DEFAULT 'direct',
    "optimalSessionLength" INTEGER NOT NULL DEFAULT 25,
    "bestTimeWindows" TEXT NOT NULL DEFAULT '[]',
    "worstTimeWindows" TEXT NOT NULL DEFAULT '[]',
    "interruptionVulnerability" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "motivationProfile" TEXT NOT NULL DEFAULT '{}',
    "taskPreferenceMap" TEXT NOT NULL DEFAULT '{}',
    "energyRhythm" TEXT NOT NULL DEFAULT '{}',
    "averageStartRate" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "averageCompletionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "averageAvoidanceRate" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "strictModeEffectiveness" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "recoverySuccessRate" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "preferredDecompositionGranularity" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "predictedBlockLikelihood" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "predictedSuccessProbability" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "commonFailureReasons" TEXT NOT NULL DEFAULT '[]',
    "commonSuccessConditions" TEXT NOT NULL DEFAULT '[]',
    "categorySuccessRates" TEXT NOT NULL DEFAULT '{}',
    "categoryBlockRates" TEXT NOT NULL DEFAULT '{}',
    "categoryAvgResistance" TEXT NOT NULL DEFAULT '{}',
    "contextPerformanceRates" TEXT NOT NULL DEFAULT '{}',
    "timeSlotPerformance" TEXT NOT NULL DEFAULT '{}',
    "nudgeTypeEffectiveness" TEXT NOT NULL DEFAULT '{}',
    "decompositionStyleEffectiveness" TEXT NOT NULL DEFAULT '{}',
    "totalSignals" INTEGER NOT NULL DEFAULT 0,
    "lastUpdatedFrom" TEXT NOT NULL DEFAULT 'initialization',
    "confidenceLevel" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdaptiveProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "taskId" TEXT,
    "category" TEXT,
    "context" TEXT,
    "timeSlot" TEXT,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MicroFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "feedbackType" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MicroFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memoryType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidence" INTEGER NOT NULL DEFAULT 1,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "title" TEXT,
    "contextJson" TEXT,
    "relatedTaskId" TEXT,
    "relatedSessionId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastTurnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "payloadJson" TEXT,
    "modelUsed" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Streak_userId_date_key" ON "Streak"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPlan_userId_date_key" ON "DailyPlan"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Review_userId_date_key" ON "Review"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_userId_key" ON "PushSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdaptiveProfile_userId_key" ON "AdaptiveProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserMemory_userId_memoryType_category_key_key" ON "UserMemory"("userId", "memoryType", "category", "key");

-- CreateIndex
CREATE INDEX "ChatThread_userId_state_idx" ON "ChatThread"("userId", "state");

-- CreateIndex
CREATE INDEX "ChatThread_userId_mode_startedAt_idx" ON "ChatThread"("userId", "mode", "startedAt");

-- CreateIndex
CREATE INDEX "ChatThread_userId_lastTurnAt_idx" ON "ChatThread"("userId", "lastTurnAt");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_delegatedToId_fkey" FOREIGN KEY ("delegatedToId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Streak" ADD CONSTRAINT "Streak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarToken" ADD CONSTRAINT "CalendarToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPlan" ADD CONSTRAINT "DailyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPlanTask" ADD CONSTRAINT "DailyPlanTask_dailyPlanId_fkey" FOREIGN KEY ("dailyPlanId") REFERENCES "DailyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPlanTask" ADD CONSTRAINT "DailyPlanTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPattern" ADD CONSTRAINT "UserPattern_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrictModeSession" ADD CONSTRAINT "StrictModeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdaptiveProfile" ADD CONSTRAINT "AdaptiveProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSignal" ADD CONSTRAINT "LearningSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MicroFeedback" ADD CONSTRAINT "MicroFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMemory" ADD CONSTRAINT "UserMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
