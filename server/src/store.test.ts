import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
    assert.deepEqual(store.listMetadata(), [{ id: entry.id, createdAt: entry.createdAt }]);
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
