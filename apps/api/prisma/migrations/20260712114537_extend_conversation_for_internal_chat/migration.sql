-- AlterEnum
ALTER TYPE "Channel" ADD VALUE 'LIVE_CHAT';

-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'INTERNAL_NOTE';

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_contactId_fkey";

-- AlterTable
ALTER TABLE "Conversation" ALTER COLUMN "contactId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "internalNote" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
