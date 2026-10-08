-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "replyText" TEXT NOT NULL,
    "userText" TEXT NOT NULL DEFAULT '',
    "contextJson" TEXT NOT NULL DEFAULT '[]',
    "operations" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- CreateIndex
CREATE INDEX "Feedback_messageId_idx" ON "Feedback"("messageId");
