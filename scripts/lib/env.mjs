// Load API keys, first match wins:
//   1. .env in the CURRENT project (any project can override)
//   2. .env next to the plugin itself (the dev-checkout case)
//   3. ~/.ccexplainer/.env — the user-global home for keys; survives
//      marketplace installs, which clone the repo WITHOUT .env (git-ignored).
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export function loadEnv() {
  try {
    process.loadEnvFile();
    return;
  } catch {}
  try {
    process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env"));
    return;
  } catch {}
  try {
    process.loadEnvFile(join(homedir(), ".ccexplainer", ".env"));
  } catch {}
}
