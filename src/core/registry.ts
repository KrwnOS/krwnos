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
 */

import type {
  KrwnModule,
  PermissionDescriptor,
  PermissionKey,
} from "@/types/kernel";

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
}

export const registry = new ModuleRegistry();
