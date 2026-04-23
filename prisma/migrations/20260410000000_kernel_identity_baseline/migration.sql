-- Kernel identity baseline: `User`, `State`, `VerticalNode`.
-- Fresh `migrate deploy` had no table that creates these; later migrations
-- (e.g. core_chat, wallet) reference "State" and "VerticalNode" with FKs.
-- User columns match pre-20260422120000 (email digest fields added there).
-- State omits `themeConfig` (added in 20260421000000_theme_engine).

-- CreateEnum
CREATE TYPE "VerticalNodeType" AS ENUM ('position', 'department', 'rank');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "handle" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "State" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "State_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerticalNode" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "type" "VerticalNodeType" NOT NULL DEFAULT 'position',
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "order" INTEGER NOT NULL DEFAULT 0,
    "isLobby" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerticalNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");
CREATE INDEX "User_handle_idx" ON "User"("handle");

CREATE UNIQUE INDEX "State_slug_key" ON "State"("slug");
CREATE INDEX "State_ownerId_idx" ON "State"("ownerId");

CREATE INDEX "VerticalNode_stateId_idx" ON "VerticalNode"("stateId");
CREATE INDEX "VerticalNode_parentId_idx" ON "VerticalNode"("parentId");
CREATE INDEX "VerticalNode_stateId_parentId_idx" ON "VerticalNode"("stateId", "parentId");

-- AddForeignKey
ALTER TABLE "State" ADD CONSTRAINT "State_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerticalNode" ADD CONSTRAINT "VerticalNode_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerticalNode" ADD CONSTRAINT "VerticalNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "VerticalNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
