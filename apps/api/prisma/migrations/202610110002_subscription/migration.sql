-- CreateTable
CREATE TABLE "SubscriptionDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "platformCode" INTEGER,
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionDelivery_notificationId_key" ON "SubscriptionDelivery"("notificationId");

-- AddForeignKey
ALTER TABLE "SubscriptionDelivery" ADD CONSTRAINT "SubscriptionDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
