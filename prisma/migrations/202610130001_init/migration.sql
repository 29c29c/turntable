-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "timerCapMinutes" INTEGER NOT NULL DEFAULT 120,
    "goalTasks" INTEGER,
    "goalMinutes" INTEGER,
    "pendingGoalTasks" INTEGER,
    "pendingGoalMinutes" INTEGER,
    "goalEffectiveDay" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '#a9c4fa',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Day" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "goalTasks" INTEGER,
    "goalMinutes" INTEGER,

    CONSTRAINT "Day_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyItem" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "deadline" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeHint" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteRedemption" (
    "id" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Task_userId_archived_idx" ON "Task"("userId", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "Day_userId_date_key" ON "Day"("userId", "date");

-- CreateIndex
CREATE INDEX "DailyItem_dayId_status_idx" ON "DailyItem"("dayId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DailyItem_dayId_taskId_key" ON "DailyItem"("dayId", "taskId");

-- CreateIndex
CREATE INDEX "Segment_itemId_idx" ON "Segment"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_codeHash_key" ON "Invite"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "InviteRedemption_inviteId_userId_key" ON "InviteRedemption"("inviteId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Operation_userId_key_key" ON "Operation"("userId", "key");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Day" ADD CONSTRAINT "Day_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyItem" ADD CONSTRAINT "DailyItem_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "Day"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyItem" ADD CONSTRAINT "DailyItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DailyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteRedemption" ADD CONSTRAINT "InviteRedemption_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "Invite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteRedemption" ADD CONSTRAINT "InviteRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Defense in depth: application transactions also lock the owning user.
CREATE UNIQUE INDEX "DailyItem_one_active_per_day" ON "DailyItem"("dayId") WHERE "status" IN ('RUNNING', 'PAUSED');
CREATE UNIQUE INDEX "Segment_one_open_per_item" ON "Segment"("itemId") WHERE "endedAt" IS NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_role_check" CHECK ("role" IN ('USER', 'ADMIN'));
ALTER TABLE "User" ADD CONSTRAINT "User_timer_cap_check" CHECK ("timerCapMinutes" BETWEEN 15 AND 240);
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_usage_check" CHECK ("maxUses" > 0 AND "usedCount" >= 0 AND "usedCount" <= "maxUses");
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_dates_check" CHECK ("expiresAt" > "startsAt");
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_times_check" CHECK ("deadline" >= "startedAt" AND ("endedAt" IS NULL OR ("endedAt" >= "startedAt" AND "endedAt" <= "deadline")));
ALTER TABLE "DailyItem" ADD CONSTRAINT "DailyItem_status_check" CHECK ("status" IN ('PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'EXPIRED'));
