/**
 * krwn CLI — command router.
 *
 * Usage:
 *   krwn login --host https://my.krwnos.app --token <raw>
 *   krwn module install <slug>
 *   krwn module list
 *   krwn vertical add "<title>" [--parent <nodeId>] [--type position|department|rank]
 *   krwn vertical list
 *   krwn invite --node <nodeId> [--label "Recruit"] [--max-uses 10] [--ttl 7d]
 *   krwn backup [--out ./state.json]
 *   krwn backup list
 *   krwn status
 */

import { loadConfig } from "./config.mjs";
import { loginCommand } from "./commands/login.mjs";
import { moduleCommand } from "./commands/module.mjs";
import { verticalCommand } from "./commands/vertical.mjs";
import { inviteCommand } from "./commands/invite.mjs";
import { backupCommand } from "./commands/backup.mjs";
import { statusCommand } from "./commands/status.mjs";
import { tokenCommand } from "./commands/token.mjs";
import { printHelp } from "./help.mjs";

export async function run(argv) {
  const [first, ...rest] = argv;

  if (!first || first === "--help" || first === "-h" || first === "help") {
    printHelp();
    return;
  }

  if (first === "--version" || first === "-v") {
    const pkg = await import("../package.json", { with: { type: "json" } });
    process.stdout.write(`krwn ${pkg.default.version}\n`);
    return;
  }

  const config = await loadConfig();

  switch (first) {
    case "login":
      return loginCommand(rest, config);
    case "module":
      return moduleCommand(rest, config);
    case "vertical":
      return verticalCommand(rest, config);
    case "invite":
      return inviteCommand(rest, config);
    case "backup":
      return backupCommand(rest, config);
    case "status":
      return statusCommand(rest, config);
    case "token":
      return tokenCommand(rest, config);
    default:
      throw new Error(`Unknown command: "${first}". Run \`krwn help\` for usage.`);
  }
}
