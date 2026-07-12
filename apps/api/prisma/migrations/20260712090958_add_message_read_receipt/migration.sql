-- CreateTable
CREATE TABLE "MessageReadReceipt" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReadReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageReadReceipt_messageId_idx" ON "MessageReadReceipt"("messageId");

-- CreateIndex
CREATE INDEX "MessageReadReceipt_userId_idx" ON "MessageReadReceipt"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageReadReceipt_messageId_userId_key" ON "MessageReadReceipt"("messageId", "userId");

-- AddForeignKey
ALTER TABLE "MessageReadReceipt" ADD CONSTRAINT "MessageReadReceipt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReadReceipt" ADD CONSTRAINT "MessageReadReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
