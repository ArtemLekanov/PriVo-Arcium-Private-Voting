-- CreateTable
CREATE TABLE "Poll" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "authority" TEXT NOT NULL,
    "pollId" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" BIGINT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Poll_authority_pollId_key" ON "Poll"("authority", "pollId");

-- CreateIndex
CREATE INDEX "Poll_authority_idx" ON "Poll"("authority");
