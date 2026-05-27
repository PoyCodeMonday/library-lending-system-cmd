const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { config } = require("dotenv");

const args = process.argv.slice(2);
const fallbackIndex = args.indexOf("--fallback-url");
const allowFallbackUrl = fallbackIndex >= 0;
if (allowFallbackUrl) {
  args.splice(fallbackIndex, 1);
}

for (const file of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(file)) {
    config({ path: file, override: false, quiet: true });
  }
}

if (!process.env.DATABASE_URL && allowFallbackUrl) {
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/library_lending";
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Set it in Vercel or in the repo root .env file.");
  process.exit(1);
}

if (args.length === 0) {
  console.error("Missing command.");
  process.exit(1);
}

const result = spawnSync(args[0], args.slice(1), {
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32"
});

process.exit(result.status ?? 1);
