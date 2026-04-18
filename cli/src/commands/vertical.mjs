import { parseArgs } from "node:util";
import { requireProfile } from "../config.mjs";
import { call } from "../http.mjs";

export async function verticalCommand(argv, config) {
  const [sub, ...rest] = argv;
  const profile = requireProfile(config);

  switch (sub) {
    case "add":
      return add(rest, profile);
    case "list":
      return list(profile);
    default:
      throw new Error(
        `Unknown vertical sub-command: "${sub ?? ""}". Expected: add | list.`,
      );
  }
}

async function add(argv, profile) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      parent: { type: "string" },
      type: { type: "string", default: "position" },
    },
    strict: true,
  });

  const title = positionals.join(" ").trim();
  if (!title) {
    throw new Error(
      'Usage: krwn vertical add "<title>" [--parent <nodeId>] [--type position|department|rank]',
    );
  }

  const res = await call(profile, "/api/cli/vertical", {
    method: "POST",
    body: {
      title,
      parentId: values.parent ?? null,
      type: values.type,
    },
  });

  process.stdout.write(
    `✓ node ${res.node.id}  ${res.node.type.padEnd(10)}  ${res.node.title}\n`,
  );
}

async function list(profile) {
  const res = await call(profile, "/api/cli/vertical");
  const byParent = new Map();
  for (const n of res.nodes) {
    const key = n.parentId ?? "__root__";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }
  const print = (parentKey, depth) => {
    const rows = byParent.get(parentKey) ?? [];
    for (const n of rows) {
      const pad = "  ".repeat(depth);
      process.stdout.write(`${pad}▸ ${n.title}  \x1b[90m[${n.id}]\x1b[0m\n`);
      print(n.id, depth + 1);
    }
  };
  print("__root__", 0);
}
