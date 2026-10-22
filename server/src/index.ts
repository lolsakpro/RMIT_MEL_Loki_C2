import "dotenv/config";
import express from "express";
import { createAuthenticator, requireRealmRole } from "./auth/authenticate.js";
import { loadTideConfig } from "./auth/tideConfig.js";
import { createStore } from "./store.js";

const port = Number(process.env.PORT ?? 4000);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const adapter = loadTideConfig();
const authenticate = createAuthenticator(adapter);
const store = createStore(process.env.DATABASE_PATH ?? "./data/wellbeing.sqlite");
const app = express();

app.disable("x-powered-by");
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin === clientOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, DPoP");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(origin === clientOrigin ? 204 : 403);
    return;
  }
  next();
});
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", authenticate);

app.get("/api/entries", requireRealmRole("student"), (req, res) => {
  const ownerSub = req.auth!.sub;
  const entries = store.listOwnerEntries(ownerSub);
  for (const entry of entries) {
    store.recordAccess(entry.id, ownerSub, ownerSub, "owner-read-ciphertext");
  }
  res.json(entries);
});

app.post("/api/entries", requireRealmRole("student"), (req, res) => {
  const encryptedContent = req.body?.encryptedContent;
  if (typeof encryptedContent !== "string" || encryptedContent.length === 0) {
    res.status(400).json({ error: "encryptedContent must be a non-empty string." });
    return;
  }
  if (encryptedContent.length > 1_500_000) {
    res.status(413).json({ error: "Encrypted note is too large." });
    return;
  }
  const entry = store.createEntry(req.auth!.sub, encryptedContent);
  res.status(201).json(entry);
});

app.get("/api/entries/:entryId/access-log", requireRealmRole("student"), (req, res) => {
  const ownerSub = req.auth!.sub;
  const accessLog = store.listAccessLog(req.params.entryId, ownerSub);
  if (!accessLog) {
    res.status(404).json({ error: "Entry not found." });
    return;
  }
  store.recordAccess(req.params.entryId, ownerSub, ownerSub, "owner-viewed-access-log");
  res.json(accessLog);
});

app.get("/api/admin/entries", requireRealmRole("admin"), (_req, res) => {
  res.json(store.listMetadata());
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled API error:", error instanceof Error ? error.message : "Unknown error.");
  res.status(500).json({ error: "The API could not complete the request." });
});

const server = app.listen(port, () => {
  console.info(`Wellbeing Notes API listening on http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
