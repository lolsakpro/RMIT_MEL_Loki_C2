import "dotenv/config";
import express from "express";
import { createAuthenticator, createDemoAuthenticator, requireClientRole, requireRealmRole } from "./auth/authenticate.js";
import { loadTideConfig } from "./auth/tideConfig.js";
import { validateRelationshipPolicy } from "./relationshipPolicy.js";
import { createStore } from "./store.js";

const port = Number(process.env.PORT ?? 4000);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const demoAuthEnabled = process.env.ENABLE_DEMO_AUTH === "true"
  || (process.env.ENABLE_DEMO_AUTH !== "false" && process.env.NODE_ENV === "development");
if (demoAuthEnabled && process.env.NODE_ENV === "production") {
  throw new Error("ENABLE_DEMO_AUTH cannot be enabled when NODE_ENV=production.");
}
const adapter = demoAuthEnabled ? null : loadTideConfig();
const authenticate = demoAuthEnabled ? createDemoAuthenticator() : createAuthenticator(adapter!);
const store = createStore(process.env.DATABASE_PATH ?? "./data/wellbeing.sqlite");
const app = express();
const allowedClientOrigins = new Set([new URL(clientOrigin).origin]);
if (process.env.NODE_ENV === "development") {
  const configuredOrigin = new URL(clientOrigin);
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (loopbackHosts.has(configuredOrigin.hostname)) {
    for (const hostname of loopbackHosts) {
      const localOrigin = new URL(configuredOrigin);
      localOrigin.hostname = hostname;
      allowedClientOrigins.add(localOrigin.origin);
    }
  }
}

if (demoAuthEnabled) {
  console.warn("KADS DEMO AUTH IS ENABLED. Do not use this mode with real data or expose this API publicly.");
  for (const demoUser of [
    { sub: "demo-student", tideUserKey: "demo-key-student", displayName: "Alex Morgan", roles: ["student"] },
    { sub: "demo-counsellor", tideUserKey: "demo-key-counsellor", displayName: "Sam Taylor", roles: ["counsellor"] },
    { sub: "demo-admin", tideUserKey: "demo-key-admin", displayName: "KADS Administrator", roles: ["admin"] },
  ]) {
    store.upsertUser(demoUser);
  }
}

app.disable("x-powered-by");
app.use((req, res, next) => {
  const origin = req.get("origin");
  const isAllowedOrigin = origin !== undefined && allowedClientOrigins.has(origin);
  if (isAllowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, DPoP, X-KADS-Demo-Role, X-KADS-Demo-Sub, X-KADS-Demo-Name, X-KADS-Demo-Tide-User-Key",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(isAllowedOrigin ? 204 : 403);
    return;
  }
  next();
});
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", authenticate);
app.use("/api", (req, res, next) => {
  const auth = req.auth!;
  const roles = auth.realm_access?.roles ?? [];
  const displayName = typeof auth.name === "string" && auth.name
    ? auth.name
    : typeof auth.preferred_username === "string" && auth.preferred_username
      ? auth.preferred_username
      : roles.includes("counsellor")
        ? "Counsellor"
        : roles.includes("admin")
          ? "Administrator"
          : "Student";
  store.upsertUser({
    sub: auth.sub,
    tideUserKey: typeof auth.tideuserkey === "string" ? auth.tideuserkey : "",
    displayName,
    roles,
  });
  next();
});

app.get("/api/entries", requireRealmRole("student"), (req, res) => {
  res.json(store.listOwnerEntries(req.auth!.sub));
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
  res.status(201).json(store.createEntry(req.auth!.sub, encryptedContent));
});

app.get("/api/counsellors", requireRealmRole("student"), (req, res) => {
  res.json(store.listCounsellors(req.auth!.sub));
});

app.post("/api/entries/:entryId/share-requests", requireRealmRole("student"), (req, res) => {
  if (!req.auth!.tideuserkey) {
    res.status(409).json({ error: "Your Tide user key is missing from this login. Confirm the tideUserKey mapper and sign in again." });
    return;
  }
  const counsellorSub = req.body?.counsellorSub;
  const expiresInSeconds = req.body?.expiresInSeconds;
  if (typeof counsellorSub !== "string" || !counsellorSub) {
    res.status(400).json({ error: "Choose a counsellor to share this entry with." });
    return;
  }
  if (![3600, 86400, 604800].includes(expiresInSeconds)) {
    res.status(400).json({ error: "Choose an expiry of 1 hour, 24 hours, or 7 days." });
    return;
  }
  const request = store.createShareRequest(
    req.params.entryId,
    req.auth!.sub,
    counsellorSub,
    new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
  );
  if (!request) {
    res.status(404).json({ error: "Entry or counsellor not found, or this entry already has a pending or active share." });
    return;
  }
  res.status(201).json({
    id: request.id,
    entryId: request.entryId,
    counsellorSub: request.counsellorSub,
    counsellorName: request.counsellorName,
    status: request.status,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
  });
});

app.get("/api/entries/:entryId/share-requests", requireRealmRole("student"), (req, res) => {
  const requests = store.listOwnerShareRequests(req.params.entryId, req.auth!.sub);
  if (!requests) {
    res.status(404).json({ error: "Entry not found." });
    return;
  }
  res.json(requests);
});

app.post("/api/entries/:entryId/share-rewrap", requireRealmRole("student"), (req, res) => {
  const encryptedContent = req.body?.encryptedContent;
  if (typeof encryptedContent !== "string" || encryptedContent.length === 0) {
    res.status(400).json({ error: "Encrypted content is required." });
    return;
  }
  if (encryptedContent.length > 1_500_000) {
    res.status(413).json({ error: "Encrypted note is too large." });
    return;
  }
  if (!store.completeShareRewrap(req.params.entryId, req.auth!.sub, encryptedContent)) {
    res.status(409).json({ error: "This entry is not waiting for an approved share to be encrypted." });
    return;
  }
  res.json({ status: "active" });
});

app.post("/api/entries/:entryId/shares/:shareId/revoke", requireRealmRole("student"), (req, res) => {
  const encryptedContent = req.body?.encryptedContent;
  if (encryptedContent !== undefined && (typeof encryptedContent !== "string" || encryptedContent.length > 1_500_000)) {
    res.status(400).json({ error: "Encrypted content is invalid or too large." });
    return;
  }
  const revoked = store.revokeShare(
    req.params.entryId,
    req.params.shareId,
    req.auth!.sub,
    typeof encryptedContent === "string" ? encryptedContent : "",
  );
  if (!revoked) {
    res.status(409).json({ error: "The share could not be revoked. Refresh the entry and try again." });
    return;
  }
  res.json({ status: "revoked" });
});

app.get("/api/entries/:entryId/access-log", requireRealmRole("student"), (req, res) => {
  const accessLog = store.listAccessLog(req.params.entryId, req.auth!.sub);
  if (!accessLog) {
    res.status(404).json({ error: "Entry not found." });
    return;
  }
  res.json(accessLog);
});

app.post("/api/entries/:entryId/access-events", (req, res) => {
  if (req.body?.action !== "opened") {
    res.status(400).json({ error: "Only note-opened events can be recorded." });
    return;
  }
  if (!store.recordUserAccess(req.params.entryId, req.auth!.sub, "opened")) {
    res.status(403).json({ error: "You no longer have access to this entry." });
    return;
  }
  res.status(201).json({ recorded: true });
});

app.get("/api/counsellor/entries", requireRealmRole("counsellor"), (req, res) => {
  res.json(store.listCounsellorEntries(req.auth!.sub));
});

app.get("/api/counsellor/entries/:entryId/notes", requireRealmRole("counsellor"), (req, res) => {
  res.json(store.listCounsellorNotes(req.params.entryId, req.auth!.sub));
});

app.post("/api/counsellor/entries/:entryId/notes", requireRealmRole("counsellor"), (req, res) => {
  const encryptedContent = req.body?.encryptedContent;
  if (typeof encryptedContent !== "string" || !encryptedContent) {
    res.status(400).json({ error: "Encrypted counsellor note is required." });
    return;
  }
  if (encryptedContent.length > 1_500_000) {
    res.status(413).json({ error: "Encrypted counsellor note is too large." });
    return;
  }
  const note = store.createCounsellorNote(req.params.entryId, req.auth!.sub, encryptedContent);
  if (!note) {
    res.status(403).json({ error: "Counsellor notes can be added only while this share is active." });
    return;
  }
  res.status(201).json(note);
});

app.get("/api/admin/share-requests", requireRealmRole("admin"), (_req, res) => {
  res.json({
    requests: store.listPendingShareRequests(),
    vendorId: demoAuthEnabled ? "kads-demo-vendor" : adapter?.vendorId ?? null,
  });
});

app.get(
  "/api/admin/relationship-admin-policy",
  requireRealmRole("admin"),
  requireClientRole("realm-management", "tide-realm-admin"),
  async (req, res) => {
    if (demoAuthEnabled) {
      res.json({ policy: Buffer.from("local-demo-admin-approval").toString("base64") });
      return;
    }
    if (!req.auth) {
      res.status(401).json({ error: "An authenticated Tide administrator is required." });
      return;
    }
    const authServerUrl = adapter!["auth-server-url"].replace(/\/+$/, "");
    const url = new URL(
      `${authServerUrl}/admin/realms/${encodeURIComponent(adapter!.realm)}/iga/role-policies/name/tide-realm-admin`,
    );
    try {
      const policyResponse = await fetch(url, {
        headers: { Authorization: `Bearer ${req.get("authorization")?.replace(/^DPoP\s+/i, "") ?? ""}` },
      });
      if (!policyResponse.ok) {
        res.status(502).json({ error: `TideCloak could not return the realm admin policy (${policyResponse.status}).` });
        return;
      }
      const body = await policyResponse.json() as { policy?: unknown };
      if (typeof body.policy !== "string" || !body.policy) {
        res.status(502).json({ error: "TideCloak returned no realm admin policy." });
        return;
      }
      res.json({ policy: body.policy });
    } catch (error) {
      console.error("Could not fetch Tide realm admin policy:", error instanceof Error ? error.message : "Unknown error.");
      res.status(502).json({ error: "Could not connect to TideCloak to retrieve the realm admin policy." });
    }
  },
);

app.post(
  "/api/admin/share-requests/:shareId/approve",
  requireRealmRole("admin"),
  requireClientRole("realm-management", "tide-realm-admin"),
  (req, res) => {
    const share = store.getShareRequest(req.params.shareId);
    if (!share || share.status !== "pending") {
      res.status(404).json({ error: "Pending share request not found." });
      return;
    }
    if (!demoAuthEnabled && !adapter?.vendorId) {
      res.status(503).json({ error: "The Tide adapter is missing vendorId; export the current adapter before approving shares." });
      return;
    }
    if (!share.ownerTideUserKey || !share.counsellorTideUserKey) {
      res.status(409).json({ error: "Both users must sign in to TideCloak before a per-user share can be approved." });
      return;
    }
    try {
      if (demoAuthEnabled) {
        validateDemoPolicy(req.body?.ownerPolicyB64, share.entryId, "read-write");
        validateDemoPolicy(req.body?.counsellorPolicyB64, share.entryId, "read");
      } else {
        validateRelationshipPolicy(req.body?.ownerPolicyB64, {
          vendorId: adapter!.vendorId!,
          subjectId: share.ownerTideUserKey,
          recordId: share.entryId,
          access: "read-write",
        });
        validateRelationshipPolicy(req.body?.counsellorPolicyB64, {
          vendorId: adapter!.vendorId!,
          subjectId: share.counsellorTideUserKey,
          recordId: share.entryId,
          access: "read",
          expiresAt: share.expiresAt,
        });
      }
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "The signed policy was invalid." });
      return;
    }
    const status = store.approveShareRequest(share, req.body.ownerPolicyB64, req.body.counsellorPolicyB64);
    if (!status) {
      res.status(409).json({ error: "The request expired or was approved by another administrator." });
      return;
    }
    res.json({ status });
  },
);

app.get("/api/admin/entries", requireRealmRole("admin"), (_req, res) => {
  res.json(store.listMetadata());
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled API error:", error instanceof Error ? error.message : "Unknown error.");
  res.status(500).json({ error: "The API could not complete the request." });
});

const onListening = () => {
  console.info(`Wellbeing Notes API listening on localhost:${port}`);
};
const server = process.env.NODE_ENV === "production"
  ? app.listen(port, onListening)
  : app.listen(port, "localhost", onListening);

function validateDemoPolicy(value: unknown, entryId: string, access: "read" | "read-write"): void {
  if (typeof value !== "string") throw new Error("A demo relationship policy is required.");
  let policy: { demo?: boolean; recordId?: string; access?: string };
  try {
    policy = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as typeof policy;
  } catch {
    throw new Error("The demo relationship policy is invalid.");
  }
  if (!policy.demo || policy.recordId !== entryId || policy.access !== access) {
    throw new Error("The demo relationship policy does not match this share.");
  }
}

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
