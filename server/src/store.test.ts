import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Models } from "@tideorg/js";
import { validateRelationshipPolicy } from "./relationshipPolicy.js";
import { createStore } from "./store.js";

function withStore(run: (directory: string, store: ReturnType<typeof createStore>) => void) {
  const directory = mkdtempSync(join(tmpdir(), "wellbeing-notes-"));
  const store = createStore(join(directory, "notes.sqlite"));
  try {
    run(directory, store);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("entries are scoped to their owner and admin metadata omits ciphertext", () => {
  withStore((_directory, store) => {
    const cipher = JSON.stringify({ encoding: "text", value: "opaque-ciphertext" });
    const entry = store.createEntry("student-a", cipher);

    assert.deepEqual(store.listOwnerEntries("student-a"), [entry]);
    assert.deepEqual(store.listOwnerEntries("student-b"), []);
    assert.deepEqual(store.listMetadata(), [{ id: entry.id, createdAt: entry.createdAt, shareStatus: null }]);
  });
});

test("only the entry owner can read its access log", () => {
  withStore((_directory, store) => {
    const entry = store.createEntry("student-a", "ciphertext");
    assert.equal(store.recordAccess(entry.id, "student-a", "student-a", "owner-read-ciphertext"), true);
    const accessLog = store.listAccessLog(entry.id, "student-a");
    assert.equal(accessLog?.length, 1);
    assert.equal(accessLog?.[0].actorSub, "student-a");
    assert.equal(accessLog?.[0].action, "owner-read-ciphertext");
    assert.equal(store.listAccessLog(entry.id, "student-b"), null);
  });
});

test("a counsellor receives only an approved active share and revocation re-encrypts it privately", () => {
  withStore((_directory, store) => {
    store.upsertUser({
      sub: "student-a",
      tideUserKey: "student-key",
      displayName: "Student A",
      roles: ["student"],
    });
    store.upsertUser({
      sub: "counsellor-a",
      tideUserKey: "counsellor-key",
      displayName: "Counsellor A",
      roles: ["counsellor"],
    });
    const entry = store.createEntry("student-a", "self-encrypted-content");
    const request = store.createShareRequest(
      entry.id,
      "student-a",
      "counsellor-a",
      new Date(Date.now() + 60_000).toISOString(),
    );

    assert.ok(request);
    assert.deepEqual(store.listCounsellorEntries("counsellor-a"), []);
    assert.equal(store.recordUserAccess(entry.id, "counsellor-a", "opened"), false);

    assert.equal(store.approveShareRequest(request, "owner-policy", "counsellor-policy"), "approved_pending_rewrap");
    assert.equal(store.listOwnerEntries("student-a")[0].ownerPolicyB64, "owner-policy");
    assert.deepEqual(store.listCounsellorEntries("counsellor-a"), []);

    assert.equal(store.completeShareRewrap(entry.id, "student-a", "relationship-encrypted-content"), true);
    assert.equal(store.listOwnerEntries("student-a")[0].encryptionMode, "relationship");
    assert.equal(store.listCounsellorEntries("counsellor-a")[0].policyB64, "counsellor-policy");
    assert.equal(store.createCounsellorNote(entry.id, "counsellor-a", "encrypted-counsellor-note")?.encryptedContent, "encrypted-counsellor-note");
    assert.equal(store.listCounsellorNotes(entry.id, "counsellor-a").length, 1);
    assert.equal(store.listCounsellorNotes(entry.id, "counsellor-b").length, 0);
    assert.equal(store.recordUserAccess(entry.id, "counsellor-a", "opened"), true);

    assert.equal(store.revokeShare(entry.id, request.id, "student-a", "new-self-encrypted-content"), true);
    assert.deepEqual(store.listCounsellorEntries("counsellor-a"), []);
    const privateEntry = store.listOwnerEntries("student-a")[0];
    assert.equal(privateEntry.encryptionMode, "self");
    assert.equal(privateEntry.encryptedContent, "new-self-encrypted-content");
    assert.equal(privateEntry.shareStatus, "revoked");
    assert.equal(privateEntry.ownerPolicyB64, null);
    assert.equal(store.recordUserAccess(entry.id, "counsellor-a", "opened"), false);
    assert.equal(store.listCounsellorNotes(entry.id, "counsellor-a").length, 0);
    assert.equal(store.createCounsellorNote(entry.id, "counsellor-a", "new-note"), null);
    assert.ok(store.createShareRequest(
      entry.id,
      "student-a",
      "counsellor-a",
      new Date(Date.now() + 60_000).toISOString(),
    ));
  });
});

test("share requests accept only registered counsellors and one current grant per entry", () => {
  withStore((_directory, store) => {
    store.upsertUser({
      sub: "student-a",
      tideUserKey: "student-key",
      displayName: "Student A",
      roles: ["student"],
    });
    store.upsertUser({
      sub: "student-b",
      tideUserKey: "student-b-key",
      displayName: "Student B",
      roles: ["student"],
    });
    store.upsertUser({
      sub: "counsellor-a",
      tideUserKey: "counsellor-key",
      displayName: "Counsellor A",
      roles: ["counsellor"],
    });
    const entry = store.createEntry("student-a", "ciphertext");
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    assert.equal(store.createShareRequest(entry.id, "student-b", "counsellor-a", expiresAt), null);
    assert.equal(store.createShareRequest(entry.id, "student-a", "student-b", expiresAt), null);
    assert.ok(store.createShareRequest(entry.id, "student-a", "counsellor-a", expiresAt));
    assert.equal(store.createShareRequest(entry.id, "student-a", "counsellor-a", expiresAt), null);
  });
});

function makePolicy(subjectId: string, roles: string[], expiry?: number): string {
  const policy = new Models.Policy({
    version: Models.Policy.latestVersion,
    contractId: "RelationshipAttestation:1",
    modelId: ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"],
    keyId: "vendor-key",
    approvalType: Models.ApprovalType.IMPLICIT,
    executionType: Models.ExecutionType.PRIVATE,
    params: new Map([
      ["subjectType", "User"],
      ["subjectId", subjectId],
      ["assignmentId", "entry-123"],
      ["roles", JSON.stringify(roles)],
    ]),
    ...(expiry ? { expiry } : {}),
  });
  policy.signature = new Uint8Array([1, 2, 3]);
  return Buffer.from(policy.toBytes()).toString("base64");
}

test("relationship policies must be signed for the expected user, entry, roles, and expiry", () => {
  const expiresAt = new Date(Date.now() + 60_000);
  const expiry = Math.floor(expiresAt.getTime() / 1000);
  const counsellorPolicy = makePolicy("counsellor-key", ["_tide_decryptor"], expiry);

  assert.doesNotThrow(() => validateRelationshipPolicy(counsellorPolicy, {
    vendorId: "vendor-key",
    subjectId: "counsellor-key",
    recordId: "entry-123",
    access: "read",
    expiresAt: expiresAt.toISOString(),
  }));
  assert.throws(() => validateRelationshipPolicy(counsellorPolicy, {
    vendorId: "vendor-key",
    subjectId: "another-user",
    recordId: "entry-123",
    access: "read",
    expiresAt: expiresAt.toISOString(),
  }), /does not match/);
  assert.throws(() => validateRelationshipPolicy(makePolicy(
    "counsellor-key",
    ["_tide_encryptor", "_tide_decryptor"],
    expiry,
  ), {
    vendorId: "vendor-key",
    subjectId: "counsellor-key",
    recordId: "entry-123",
    access: "read",
    expiresAt: expiresAt.toISOString(),
  }), /does not match/);
});
