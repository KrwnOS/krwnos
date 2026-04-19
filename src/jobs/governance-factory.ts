/**
 * Builds `GovernanceService` for non-HTTP contexts (CLI / job worker).
 * Mirrors `buildGovernanceService` in `src/app/api/governance/_context.ts`
 * without Next.js or CLI auth.
 */
import { prisma } from "@/lib/prisma";
import {
  StateConfigService,
  createPrismaStateConfigRepository,
  eventBus,
} from "@/core";
import {
  GovernanceService,
  createPrismaGovernanceRepository,
} from "@/modules/governance";

export function buildGovernanceServiceForJobs(): GovernanceService {
  return new GovernanceService({
    repo: createPrismaGovernanceRepository(prisma),
    stateConfig: new StateConfigService({
      repo: createPrismaStateConfigRepository(prisma),
      bus: eventBus,
    }),
    bus: eventBus,
  });
}
