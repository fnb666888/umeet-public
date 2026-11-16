-- CreateTable
CREATE TABLE `School` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `emailDomains` JSON NOT NULL,
    `treeholeEnabled` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Campus` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `nickname` VARCHAR(191) NOT NULL,
    `avatar` VARCHAR(2048) NOT NULL DEFAULT '',
    `openid` VARCHAR(191) COLLATE utf8mb4_bin NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'STUDENT',
    `adminSchoolId` VARCHAR(191) COLLATE utf8mb4_bin NULL,
    `banned` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `sessionVersion` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_openid_key`(`openid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Membership` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `userId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `schoolId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'UNVERIFIED',
    `expiresAt` DATETIME(3) NULL,

    UNIQUE INDEX `Membership_userId_schoolId_key`(`userId`, `schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Verification` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `userId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `schoolId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `email` VARCHAR(255) NULL,
    `codeHash` VARCHAR(191) COLLATE utf8mb4_bin NULL,
    `codeExpiresAt` DATETIME(3) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `materialId` VARCHAR(191) COLLATE utf8mb4_bin NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `reason` VARCHAR(1000) NOT NULL DEFAULT '',
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Verification_schoolId_status_idx`(`schoolId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Post` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `authorId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `schoolId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `campusId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `anonymous` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `businessStatus` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `priceFen` INTEGER NULL,
    `marketType` VARCHAR(191) NULL DEFAULT 'SELL',
    `condition` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `happenedAt` DATETIME(3) NULL,
    `lostType` VARCHAR(191) NULL,
    `contact` VARCHAR(191) NULL,
    `moderationReason` VARCHAR(1000) NOT NULL DEFAULT '',
    `version` INTEGER NOT NULL DEFAULT 1,
    `requestKey` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `requestHash` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Post_schoolId_campusId_status_createdAt_id_idx`(`schoolId`, `campusId`, `status`, `createdAt`, `id`),
    UNIQUE INDEX `Post_authorId_requestKey_key`(`authorId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Comment` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `postId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `authorId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `parentId` VARCHAR(191) COLLATE utf8mb4_bin NULL,
    `content` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `reason` VARCHAR(1000) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Comment_postId_status_createdAt_idx`(`postId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Reaction` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `userId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `postId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Reaction_userId_postId_type_key`(`userId`, `postId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Media` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `userId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `postId` VARCHAR(191) COLLATE utf8mb4_bin NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `mime` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Report` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `userId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `postId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `commentId` VARCHAR(191) COLLATE utf8mb4_bin NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `snapshot` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `resolution` VARCHAR(191) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Report_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `userId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `eventId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `postId` VARCHAR(191) COLLATE utf8mb4_bin NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Notification_eventId_key`(`eventId`),
    INDEX `Notification_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubscriptionDelivery` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `notificationId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `consentId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `platformCode` INTEGER NULL,
    `error` VARCHAR(1000) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SubscriptionDelivery_notificationId_key`(`notificationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Outbox` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error` VARCHAR(1000) NOT NULL DEFAULT '',
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Outbox_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Audit` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `actorId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `detail` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Block` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `userId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `blockedId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Block_userId_blockedId_key`(`userId`, `blockedId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Feedback` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `userId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `content` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Consent` (
    `id` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `userId` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `templateId` VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Consent_userId_templateId_state_createdAt_idx`(`userId`, `templateId`, `state`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Campus` ADD CONSTRAINT `Campus_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Verification` ADD CONSTRAINT `Verification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Verification` ADD CONSTRAINT `Verification_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Post` ADD CONSTRAINT `Post_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Post` ADD CONSTRAINT `Post_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Post` ADD CONSTRAINT `Post_campusId_fkey` FOREIGN KEY (`campusId`) REFERENCES `Campus`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Comment` ADD CONSTRAINT `Comment_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Comment` ADD CONSTRAINT `Comment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reaction` ADD CONSTRAINT `Reaction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reaction` ADD CONSTRAINT `Reaction_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Media` ADD CONSTRAINT `Media_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Media` ADD CONSTRAINT `Media_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Report` ADD CONSTRAINT `Report_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Report` ADD CONSTRAINT `Report_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Report` ADD CONSTRAINT `Report_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `Comment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubscriptionDelivery` ADD CONSTRAINT `SubscriptionDelivery_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `Notification`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Feedback` ADD CONSTRAINT `Feedback_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Consent` ADD CONSTRAINT `Consent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
