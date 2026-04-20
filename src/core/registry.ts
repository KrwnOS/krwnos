/**
 * Module Registry — центральный реестр плагинов KrwnOS.
 * ------------------------------------------------------------
 * Ответственность:
 *   * Регистрация модулей по уникальному slug.
 *   * Сбор заявленных permissions (для Vertical editor).
 *   * Выдача модулей по slug / списка установленных в State.
 *
 * Ядро НЕ импортирует конкретные модули — их подключает
 * bootstrap-слой (`src/modules/index.ts`) через `register()`.
 *
 * Helpers:
 *   * `exchangeService()` — ленивый синглтон `ExchangeService`
 *     (Krwn Exchange Engine). Живёт в ядре, потому что операция
 *     пересекает границы State и ни один модуль этого делать не
 *     должен. Реализация — в `src/core/exchange.ts`.
 */

import { prisma } from "@/lib/prisma";
import type {
  KrwnModule,
  PermissionDescriptor,
  PermissionKey,
} from "@/types/kernel";
import {
  ExchangeService,
  exchangePermissionDescriptors,
  type ExchangeServiceDeps,
} from "./exchange";
import { createPrismaExchangeRepository } from "./exchange-prisma";
import { credentialsPermissionDescriptors } from "./credentials-permissions";
import { stateConfigPermissionDescriptors } from "./state-config";
import { membershipAdminPermissionDescriptors } from "./membership-admin-permissions";

interface RegistryEntry {
  module: KrwnModule;
  permissions: PermissionDescriptor[];
}

export class ModuleRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly permissionIndex = new Map<PermissionKey, PermissionDescriptor>();

  async register(mod: KrwnModule): Promise<void> {
    if (this.entries.has(mod.slug)) {
      throw new Error(`[KrwnOS] Module "${mod.slug}" is already registered.`);
    }

    const result = await mod.init();
    for (const perm of result.permissions) {
      if (perm.owner !== mod.slug && perm.owner !== "core") {
        throw new Error(
          `[KrwnOS] Module "${mod.slug}" tried to declare permission "${perm.key}" owned by "${perm.owner}".`,
        );
      }
      if (this.permissionIndex.has(perm.key)) {
        throw new Error(`[KrwnOS] Permission "${perm.key}" is already declared.`);
      }
      this.permissionIndex.set(perm.key, perm);
    }

    this.entries.set(mod.slug, { module: mod, permissions: result.permissions });
  }

  get(slug: string): KrwnModule | undefined {
    return this.entries.get(slug)?.module;
  }

  list(): KrwnModule[] {
    return [...this.entries.values()].map((e) => e.module);
  }

  listForState(installedSlugs: readonly string[]): KrwnModule[] {
    return installedSlugs
      .map((slug) => this.entries.get(slug)?.module)
      .filter((m): m is KrwnModule => Boolean(m));
  }

  allPermissions(): PermissionDescriptor[] {
    return [...this.permissionIndex.values()];
  }

  describePermission(key: PermissionKey): PermissionDescriptor | undefined {
    return this.permissionIndex.get(key);
  }

  /**
   * Register a core-owned permission (`owner === "core"`) without
   * going through a module's `init()`. Used by the kernel itself
   * for cross-State services like the Krwn Exchange Engine whose
   * permission keys still need to be visible to the Vertical
   * editor. Silently no-ops on duplicates so that repeated bootstrap
   * calls (HMR, tests) remain idempotent — unlike `register()`,
   * which must throw when a module is redeclared.
   */
  registerCorePermission(descriptor: PermissionDescriptor): void {
    if (descriptor.owner !== "core") {
      throw new Error(
        `[KrwnOS] registerCorePermission: descriptor.owner must be "core", got "${descriptor.owner}".`,
      );
    }
    if (this.permissionIndex.has(descriptor.key)) return;
    this.permissionIndex.set(descriptor.key, descriptor);
  }
}

export const registry = new ModuleRegistry();

// ============================================================
// Krwn Exchange Engine — межгосударственный сервис в ядре.
// ------------------------------------------------------------
// `ExchangeService` сознательно не регистрируется как модуль:
// его операции (upsertPair / crossStateTransfer / getForeignBalance)
// пересекают границы State, а модули по контракту живут внутри
// одного государства. Сервис выставляется как ленивый синглтон —
// так route handlers и CLI могут взять его одним вызовом, а тесты
// продолжают собирать свой `new ExchangeService(...)` на мокнутом
// репозитории.
//
// Permissions этого сервиса (`core.exchange.manage_pairs`,
// `core.exchange.view_foreign`, `core.exchange.swap`) собираются
// через `registerCorePermissions()` при старте приложения — чтобы
// Vertical editor мог их показать Суверену наравне с ключами
// модулей.
// ============================================================

let _exchangeService: ExchangeService | null = null;

/** Returns the process-wide Exchange service (lazy, Prisma-backed). */
export function exchangeService(deps?: Partial<ExchangeServiceDeps>): ExchangeService {
  if (_exchangeService && !deps) return _exchangeService;
  const svc = new ExchangeService({
    repo: deps?.repo ?? createPrismaExchangeRepository(prisma),
    bus: deps?.bus,
    engine: deps?.engine,
  });
  if (!deps) _exchangeService = svc;
  return svc;
}

/**
 * Register the core-owned permission keys (Exchange Engine today)
 * into the ModuleRegistry's permission index so the Vertical
 * editor surfaces them to Sovereigns. Call once at bootstrap —
 * duplicate registrations throw by design.
 */
export function registerCorePermissions(): void {
  for (const perm of exchangePermissionDescriptors) {
    registry.registerCorePermission(perm);
  }
  // Палата Указов — `state.configure` / `state.view_settings`.
  // Сами настройки живут в `src/core/state-config.ts`, но ключи
  // нужны Vertical editor-у наравне с остальными core-правами.
  for (const perm of stateConfigPermissionDescriptors) {
    registry.registerCorePermission(perm);
  }
  for (const perm of membershipAdminPermissionDescriptors) {
    registry.registerCorePermission(perm);
  }
  for (const perm of credentialsPermissionDescriptors) {
    registry.registerCorePermission(perm);
  }
}
