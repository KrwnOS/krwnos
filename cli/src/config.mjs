/**
 * Config store: $XDG_CONFIG_HOME/krwnos/config.json
 * (falls back to ~/.krwnos/config.json)
 *
 * Shape:
 *   {
 *     defaultProfile: "home",
 *     profiles: {
 *       "home": { host, token, stateSlug }
 *     }
 *   }
 */
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

function configPath() {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg
    ? join(xdg, "krwnos")
    : join(homedir(), ".config", "krwnos");
  return join(base, "config.json");
}

const empty = () => ({ defaultProfile: null, profiles: {} });

export async function loadConfig() {
  const path = configPath();
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    return {
      path,
      ...empty(),
      ...parsed,
      save: (next) => saveConfig(next),
      activeProfile: () => resolveActive(parsed),
    };
  } catch {
    return {
      path,
      ...empty(),
      save: (next) => saveConfig(next),
      activeProfile: () => null,
    };
  }
}

export async function saveConfig(config) {
  const path = configPath();
  const { path: _ignored, save, activeProfile, ...rest } = config;
  void _ignored;
  void save;
  void activeProfile;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(rest, null, 2), "utf8");
  // 0600 — только владелец.
  try {
    await chmod(path, 0o600);
  } catch {
    /* windows noop */
  }
  return path;
}

function resolveActive(cfg) {
  if (!cfg?.defaultProfile) return null;
  return cfg.profiles?.[cfg.defaultProfile] ?? null;
}

export function requireProfile(config) {
  const active = config.activeProfile();
  if (!active?.host || !active?.token) {
    throw new Error(
      "No active profile. Run `krwn login --host <url> --token <raw>` first.",
    );
  }
  return active;
}
