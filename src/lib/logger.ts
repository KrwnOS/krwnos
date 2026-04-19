/**
 * Structured logging (pino). Use `childLoggerFromRequest` in Route Handlers
 * so entries carry `requestId` from `x-request-id` (set in `src/middleware.ts`).
 */
import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";

export const logger = pino({
  level,
  base: { service: "krwnos" },
});

export function childLoggerFromRequest(request: Request) {
  const requestId =
    request.headers.get("x-request-id") ??
    request.headers.get("X-Request-Id") ??
    undefined;
  return requestId ? logger.child({ requestId }) : logger;
}
