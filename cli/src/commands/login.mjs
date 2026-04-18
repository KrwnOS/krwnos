import { parseArgs } from "node:util";
import { saveConfig } from "../config.mjs";

export async function loginCommand(argv, config) {
  const { values } = parseArgs({
    args: argv,
    options: {
      host: { type: "string" },
      token: { type: "string" },
      profile: { type: "string", default: "default" },
      state: { type: "string" },
    },
    strict: true,
  });

  if (!values.host || !values.token) {
    throw new Error("`--host` and `--token` are required.");
  }

  const next = {
    ...config,
    defaultProfile: values.profile,
    profiles: {
      ...config.profiles,
      [values.profile]: {
        host: values.host.replace(/\/$/, ""),
        token: values.token,
        stateSlug: values.state ?? null,
      },
    },
  };

  const path = await saveConfig(next);
  process.stdout.write(
    `Saved profile "${values.profile}" → ${values.host}\nConfig: ${path}\n`,
  );
}
