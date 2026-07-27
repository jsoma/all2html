// Rejects npm/yarn installs — this repo is pnpm-only (workspace protocol,
// lockfile, and the panel workspace all assume it). Runs as preinstall, so
// `npm install` fails with one sentence instead of mangling the lockfile.
const ua = process.env.npm_config_user_agent ?? "";
if (!ua.startsWith("pnpm/")) {
  console.error("This repo is pnpm-only. Use `pnpm install` (see package.json packageManager).");
  process.exit(1);
}
