-- ============================================================
-- State Pulse (Пульс Государства / Activity Feed).
-- ------------------------------------------------------------
-- Создаёт таблицу `ActivityLog` — единую ленту событий, куда
-- каждый модуль пишет через `ActivityFeedService.record()`
-- (см. `src/core/activity-feed.ts`). Подписчики Event Bus
-- крутятся в том же сервисе и переводят канонические события
-- модулей (Wallet/Chat/Governance/State) в строки этой таблицы.
--
-- Фильтрация в UI — per-row:
--   * visibility = 'public'     → все граждане state
--   * visibility = 'node'       → члены nodeId + все предки
--   * visibility = 'audience'   → только audienceUserIds
--   * visibility = 'sovereign'  → только владелец State
-- ============================================================

CREATE TABLE "ActivityLog" (
    "id"              TEXT        NOT NULL,
    "stateId"         TEXT        NOT NULL,

    "event"           TEXT        NOT NULL,
    "category"        TEXT        NOT NULL,

    "titleKey"        TEXT        NOT NULL,
    "titleParams"     JSONB       NOT NULL DEFAULT '{}',

    "actorId"         TEXT,
    "nodeId"          TEXT,

    "visibility"      TEXT        NOT NULL DEFAULT 'public',
    "audienceUserIds" TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],

    "metadata"        JSONB       NOT NULL DEFAULT '{}',

    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActivityLog_stateId_createdAt_idx"
    ON "ActivityLog"("stateId", "createdAt");

CREATE INDEX "ActivityLog_stateId_category_createdAt_idx"
    ON "ActivityLog"("stateId", "category", "createdAt");

CREATE INDEX "ActivityLog_stateId_visibility_idx"
    ON "ActivityLog"("stateId", "visibility");

CREATE INDEX "ActivityLog_actorId_idx"
    ON "ActivityLog"("actorId");

CREATE INDEX "ActivityLog_nodeId_idx"
    ON "ActivityLog"("nodeId");

ALTER TABLE "ActivityLog"
    ADD CONSTRAINT "ActivityLog_stateId_fkey"
    FOREIGN KEY ("stateId") REFERENCES "State"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityLog"
    ADD CONSTRAINT "ActivityLog_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ActivityLog"
    ADD CONSTRAINT "ActivityLog_nodeId_fkey"
    FOREIGN KEY ("nodeId") REFERENCES "VerticalNode"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
