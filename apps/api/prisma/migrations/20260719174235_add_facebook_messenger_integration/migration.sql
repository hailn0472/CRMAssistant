-- AlterEnum
ALTER TYPE "Channel" ADD VALUE 'FACEBOOK';

-- CreateTable
CREATE TABLE "ChannelConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactChannelIdentity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactChannelIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelConnection_tenantId_idx" ON "ChannelConnection"("tenantId");

-- CreateIndex
CREATE INDEX "ChannelConnection_tenantId_channel_idx" ON "ChannelConnection"("tenantId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_tenantId_channel_externalId_key" ON "ChannelConnection"("tenantId", "channel", "externalId");

-- CreateIndex
CREATE INDEX "ContactChannelIdentity_tenantId_idx" ON "ContactChannelIdentity"("tenantId");

-- CreateIndex
CREATE INDEX "ContactChannelIdentity_contactId_idx" ON "ContactChannelIdentity"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactChannelIdentity_tenantId_channel_externalId_key" ON "ContactChannelIdentity"("tenantId", "channel", "externalId");

-- AddForeignKey
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactChannelIdentity" ADD CONSTRAINT "ContactChannelIdentity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
