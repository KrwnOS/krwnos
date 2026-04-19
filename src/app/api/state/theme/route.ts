/**
 * `/api/state/theme` — Theme Engine REST.
 * ------------------------------------------------------------
 * GET   — любой гражданин читает текущую тему (прозрачность дизайна
 *         такой же базовый принцип, как прозрачность налогов).
 * PATCH — только Суверен или держатель core `state.configure` меняет
 *         `State.themeConfig`.
 *
 * Поле `themeConfig` живёт прямо на модели `State`, поэтому мы не
 * ходим через `StateConfigService` — тема меняется через небольшой
 * inline-хэндлер: валидация в `validateThemeConfig`, один
 * `prisma.state.update`.
 *
 * Транспорт совпадает с `/api/state/constitution`: Bearer-токен CLI,
 * `loadStateContext` из `../_context.ts` даёт нам access-context с
 * правами.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { StateConfigError, StateConfigPermissions } from "@/core";
import type { PermissionKey } from "@/types/kernel";
import {
  DEFAULT_THEME_CONFIG,
  ThemeValidationError,
  normaliseThemeConfig,
  validateThemeConfig,
  type ThemeConfig,
} from "@/core/theme";
import {
  loadStateContext,
  serialiseForWire,
  stateErrorResponse,
} from "../_context";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { stateId } = await loadStateContext(req);
    const theme = await readTheme(stateId);
    return NextResponse.json({ theme: serialiseForWire(theme) });
  } catch (err) {
    return stateErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { stateId, access } = await loadStateContext(req);
    requireConfigurePermission(access.isOwner, access.permissions);

    const body = (await req.json()) as unknown;
    let nextTheme: ThemeConfig;
    try {
      nextTheme = validateThemeConfig(body);
    } catch (err) {
      if (err instanceof ThemeValidationError) {
        return NextResponse.json(
          { error: err.message, code: "invalid_input" },
          { status: 400 },
        );
      }
      throw err;
    }

    await (prisma as unknown as {
      state: {
        update: (args: {
          where: { id: string };
          data: { themeConfig: unknown };
        }) => Promise<unknown>;
      };
    }).state.update({
      where: { id: stateId },
      data: { themeConfig: nextTheme as unknown },
    });

    return NextResponse.json({ theme: serialiseForWire(nextTheme) });
  } catch (err) {
    return stateErrorResponse(err);
  }
}

async function readTheme(stateId: string): Promise<ThemeConfig> {
  const row = (await (prisma as unknown as {
    state: {
      findUnique: (args: {
        where: { id: string };
        select: { themeConfig: true };
      }) => Promise<{ themeConfig: unknown } | null>;
    };
  }).state.findUnique({
    where: { id: stateId },
    select: { themeConfig: true },
  })) as { themeConfig: unknown } | null;

  if (!row) return DEFAULT_THEME_CONFIG;
  return normaliseThemeConfig(row.themeConfig);
}

function requireConfigurePermission(
  isOwner: boolean,
  permissions: ReadonlySet<PermissionKey>,
): void {
  if (isOwner) return;
  if (hasPermission(permissions, StateConfigPermissions.Configure)) return;
  throw new StateConfigError(
    `Missing permission "${StateConfigPermissions.Configure}".`,
    "forbidden",
  );
}

function hasPermission(
  held: ReadonlySet<PermissionKey>,
  required: PermissionKey,
): boolean {
  if (held.has("*" as PermissionKey)) return true;
  if (held.has(required)) return true;
  const [domain] = required.split(".");
  if (!domain) return false;
  return held.has(`${domain}.*` as PermissionKey);
}
