-- AlterTable
ALTER TABLE "ContactChannelIdentity" ADD COLUMN     "channelConnectionId" TEXT;

-- CreateIndex
CREATE INDEX "ContactChannelIdentity_channelConnectionId_idx" ON "ContactChannelIdentity"("channelConnectionId");

-- AddForeignKey
ALTER TABLE "ContactChannelIdentity" ADD CONSTRAINT "ContactChannelIdentity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactChannelIdentity" ADD CONSTRAINT "ContactChannelIdentity_channelConnectionId_fkey" FOREIGN KEY ("channelConnectionId") REFERENCES "ChannelConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
