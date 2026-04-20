/**
 * Wires Web Push fan-out to Event Bus (directive ACK, governance votes).
 * Idempotent per process via `globalThis` (same pattern as activity feed).
 */
import { eventBus } from "@/core";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  notifyDirectiveAcknowledged,
  notifyProposalVoteCast,
} from "@/lib/web-push-delivery";
import {
  CHAT_EVENTS,
  type ChatDirectiveAckedEvent,
} from "@/modules/chat";
import {
  GOVERNANCE_EVENTS,
  type VoteCastEvent,
} from "@/modules/governance";

const globalPush = globalThis as unknown as {
  __krwnPushBoot?: true;
};

function wire(): void {
  if (globalPush.__krwnPushBoot) return;
  globalPush.__krwnPushBoot = true;

  eventBus.on<ChatDirectiveAckedEvent>(
    CHAT_EVENTS.DirectiveAcknowledged,
    (evt) => {
      if (!evt) return;
      void notifyDirectiveAcknowledged(prisma, {
        stateId: evt.stateId,
        messageId: evt.messageId,
        ackUserId: evt.ack.userId,
      }).catch((err: unknown) => {
        logger.warn({ err }, "push_boot: directive_ack failed");
      });
    },
  );

  eventBus.on<VoteCastEvent>(GOVERNANCE_EVENTS.VoteCast, (evt) => {
    if (!evt) return;
    void notifyProposalVoteCast(prisma, {
      stateId: evt.stateId,
      proposalId: evt.proposalId,
      voterUserId: evt.userId,
      choice: evt.choice,
    }).catch((err: unknown) => {
      logger.warn({ err }, "push_boot: vote_cast failed");
    });
  });
}

wire();
