// Load API keys: prefer a .env in the CURRENT project (lets any project
// override), fall back to the .env sitting next to the plugin itself — so
// the plugin works from any directory with keys configured only once.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadEnv() {
  try {
    process.loadEnvFile();
    return;
  } catch {}
  try {
    process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env"));
  } catch {}
}
