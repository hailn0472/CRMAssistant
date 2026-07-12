/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,name]` on the table `SavedSegment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,resourceType,resourceId,sharedWithUserId]` on the table `SharingRule` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,resourceType,resourceId,sharedWithTeamId]` on the table `SharingRule` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('INTERNAL');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'FILE', 'LOCATION', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('AGENT', 'CONTACT', 'SYSTEM');

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL DEFAULT 'INTERNAL',
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assignedTo" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderType" "SenderType" NOT NULL,
    "content" TEXT NOT NULL,
    "messageType" "MessageType" NOT NULL DEFAULT 'TEXT',
    "metadata" JSONB,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_tenantId_idx" ON "Conversation"("tenantId");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_status_idx" ON "Conversation"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_channel_idx" ON "Conversation"("tenantId", "channel");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_assignedTo_idx" ON "Conversation"("tenantId", "assignedTo");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_contactId_idx" ON "Conversation"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSegment_tenantId_name_key" ON "SavedSegment"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SharingRule_tenantId_resourceType_resourceId_sharedWithUser_key" ON "SharingRule"("tenantId", "resourceType", "resourceId", "sharedWithUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SharingRule_tenantId_resourceType_resourceId_sharedWithTeam_key" ON "SharingRule"("tenantId", "resourceType", "resourceId", "sharedWithTeamId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
