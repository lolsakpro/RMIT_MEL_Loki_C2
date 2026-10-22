import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export interface StoredEntry {
  id: string;
  encryptedContent: string;
  createdAt: string;
}

export interface EntryMetadata {
  id: string;
  createdAt: string;
}

export interface AccessEvent {
  actorSub: string;
  action: string;
  occurredAt: string;
}

export function createStore(databasePath: string) {
  const absolutePath = resolve(process.cwd(), databasePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const db = new Database(absolutePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      owner_sub TEXT NOT NULL,
      encrypted_content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      actor_sub TEXT NOT NULL,
      action TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
  `);

  const insertEntry = db.prepare(`
    INSERT INTO entries (id, owner_sub, encrypted_content, created_at)
    VALUES (?, ?, ?, ?)
  `);
  const findOwnerEntries = db.prepare(`
    SELECT id, encrypted_content AS encryptedContent, created_at AS createdAt
    FROM entries WHERE owner_sub = ? ORDER BY created_at DESC
  `);
  const findEntryByOwner = db.prepare(`
    SELECT id FROM entries WHERE id = ? AND owner_sub = ?
  `);
  const insertAccessEvent = db.prepare(`
    INSERT INTO access_log (entry_id, actor_sub, action, occurred_at)
    VALUES (?, ?, ?, ?)
  `);
  const findAccessLog = db.prepare(`
    SELECT actor_sub AS actorSub, action, occurred_at AS occurredAt
    FROM access_log
    WHERE entry_id = ? AND entry_id IN (SELECT id FROM entries WHERE owner_sub = ?)
    ORDER BY occurred_at DESC
  `);
  const findAllMetadata = db.prepare(`
    SELECT id, created_at AS createdAt
    FROM entries ORDER BY created_at DESC
  `);

  return {
    createEntry(ownerSub: string, encryptedContent: string): StoredEntry {
      const entry = {
        id: randomUUID(),
        encryptedContent,
        createdAt: new Date().toISOString(),
      };
      insertEntry.run(entry.id, ownerSub, encryptedContent, entry.createdAt);
      return entry;
    },
    listOwnerEntries(ownerSub: string): StoredEntry[] {
      return findOwnerEntries.all(ownerSub) as StoredEntry[];
    },
    recordAccess(entryId: string, ownerSub: string, actorSub: string, action: string): boolean {
      if (!findEntryByOwner.get(entryId, ownerSub)) return false;
      insertAccessEvent.run(entryId, actorSub, action, new Date().toISOString());
      return true;
    },
    listAccessLog(entryId: string, ownerSub: string): AccessEvent[] | null {
      if (!findEntryByOwner.get(entryId, ownerSub)) return null;
      return findAccessLog.all(entryId, ownerSub) as AccessEvent[];
    },
    listMetadata(): EntryMetadata[] {
      return findAllMetadata.all() as EntryMetadata[];
    },
    close(): void {
      db.close();
    },
  };
}

export type EntryStore = ReturnType<typeof createStore>;
