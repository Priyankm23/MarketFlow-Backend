-- CreateEnum
CREATE TYPE "OfferApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "approvalStatus" "OfferApprovalStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "endAt" TIMESTAMP(3),
ADD COLUMN     "isFlashDeal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "startAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Offer_isFlashDeal_approvalStatus_startAt_endAt_idx" ON "Offer"("isFlashDeal", "approvalStatus", "startAt", "endAt");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
