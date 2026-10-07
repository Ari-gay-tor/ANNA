-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "origin" TEXT NOT NULL,
    "evidenceQuote" TEXT,
    "sourceConversationId" TEXT,
    "sourceMessageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
