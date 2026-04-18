-- CreateTable
CREATE TABLE "ChatChannel" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "nodeId" TEXT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "isDirective" BOOLEAN NOT NULL DEFAULT false,
    "directiveFromNode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatDirectiveAck" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "viaNodeId" TEXT,
    "requiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackedAt" TIMESTAMP(3),

    CONSTRAINT "ChatDirectiveAck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatChannel_stateId_idx" ON "ChatChannel"("stateId");

-- CreateIndex
CREATE INDEX "ChatChannel_nodeId_idx" ON "ChatChannel"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_stateId_slug_key" ON "ChatChannel"("stateId", "slug");

-- CreateIndex
CREATE INDEX "ChatMessage_channelId_createdAt_idx" ON "ChatMessage"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_authorId_idx" ON "ChatMessage"("authorId");

-- CreateIndex
CREATE INDEX "ChatMessage_isDirective_idx" ON "ChatMessage"("isDirective");

-- CreateIndex
CREATE INDEX "ChatDirectiveAck_userId_ackedAt_idx" ON "ChatDirectiveAck"("userId", "ackedAt");

-- CreateIndex
CREATE INDEX "ChatDirectiveAck_messageId_idx" ON "ChatDirectiveAck"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatDirectiveAck_messageId_userId_key" ON "ChatDirectiveAck"("messageId", "userId");

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "VerticalNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatDirectiveAck" ADD CONSTRAINT "ChatDirectiveAck_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

