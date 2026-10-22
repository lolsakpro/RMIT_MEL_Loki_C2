import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [sourcePath, expectedRealm] = process.argv.slice(2);

if (!sourcePath || !expectedRealm) {
  console.error("Usage: node scripts/install-tidecloak-adapter.mjs <export-file> <expected-realm>");
  process.exit(2);
}

const source = resolve(sourcePath);
let adapter;
try {
  adapter = JSON.parse(readFileSync(source, "utf8"));
} catch (error) {
  console.error(`Could not read a valid TideCloak adapter export from ${source}.`);
  if (error instanceof Error) console.error(error.message);
  process.exit(1);
}

if (
  typeof adapter !== "object" ||
  adapter === null ||
  typeof adapter.realm !== "string" ||
  adapter.realm !== expectedRealm ||
  typeof adapter["auth-server-url"] !== "string" ||
  typeof adapter.resource !== "string" ||
  typeof adapter.vendorId !== "string" ||
  !adapter.vendorId ||
  !Array.isArray(adapter.jwk?.keys) ||
  adapter.jwk.keys.length === 0
) {
  console.error("Adapter validation failed. Confirm the expected realm, client, embedded JWK, and vendorId in the export.");
  process.exit(1);
}

try {
  const authServerUrl = new URL(adapter["auth-server-url"]);
  if (authServerUrl.protocol !== "http:" && authServerUrl.protocol !== "https:") {
    throw new Error();
  }
} catch {
  console.error("Adapter validation failed: auth-server-url must be an absolute HTTP(S) URL.");
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(repoRoot, "client/public/tidecloak.json");
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.info(`Installed validated adapter for realm "${expectedRealm}" at client/public/tidecloak.json.`);
console.info("The adapter file is gitignored. Switch VITE_AUTH_MODE=tide and ENABLE_DEMO_AUTH=false only when ready.");
