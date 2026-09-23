import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist", "index.js");
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");

// Prefer IPv4 — IPv6 to Telegram often gets ECONNRESET on some ISPs
const env = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--dns-result-order=ipv4first"]
    .filter(Boolean)
    .join(" "),
};

console.log("Building...");
const build = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
  cwd: root,
  stdio: "inherit",
  env,
});
if (build.status !== 0) process.exit(build.status ?? 1);

const run = spawnSync(process.execPath, [dist], {
  cwd: root,
  stdio: "inherit",
  env,
});
process.exit(run.status ?? 1);
