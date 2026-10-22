import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export type SharingStatus =
  | "pending"
  | "approved_pending_rewrap"
  | "active"
  | "revoked"
  | "expired";

export interface StoredEntry {
  id: string;
  encryptedContent: string;
  createdAt: string;
  encryptionMode: "self" | "relationship";
  shareStatus: SharingStatus | null;
  shareId: string | null;
  shareExpiresAt: string | null;
  ownerPolicyB64: string | null;
}

export interface EntryMetadata {
  id: string;
  createdAt: string;
  shareStatus: SharingStatus | null;
}

export interface AccessEvent {
  actorSub: string;
  actorName: string | null;
  action: string;
  occurredAt: string;
}

export interface UserProfile {
  sub: string;
  tideUserKey: string;
  displayName: string;
  isCounsellor: boolean;
  isAdmin: boolean;
}

export interface ShareRequest {
  id: string;
  entryId: string;
  ownerSub: string;
  ownerName: string;
  ownerTideUserKey: string;
  counsellorSub: string;
  counsellorName: string;
  counsellorTideUserKey: string;
  status: SharingStatus;
  createdAt: string;
  expiresAt: string;
}

export interface CounsellorNote {
  id: string;
  encryptedContent: string;
  createdAt: string;
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
      created_at TEXT NOT NULL,
      encryption_mode TEXT NOT NULL DEFAULT 'self'
    );
    CREATE TABLE IF NOT EXISTS access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      actor_sub TEXT NOT NULL,
      action TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      sub TEXT PRIMARY KEY,
      tide_user_key TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL,
      roles_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entry_shares (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      owner_sub TEXT NOT NULL,
      counsellor_sub TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_current_share_per_entry
      ON entry_shares(entry_id)
      WHERE status IN ('pending', 'approved_pending_rewrap', 'active');
    CREATE TABLE IF NOT EXISTS entry_policies (
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      subject_sub TEXT NOT NULL,
      policy_b64 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (entry_id, subject_sub)
    );
    CREATE TABLE IF NOT EXISTS counsellor_notes (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      counsellor_sub TEXT NOT NULL,
      encrypted_content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const entryColumns = db.pragma("table_info(entries)") as { name: string }[];
  if (!entryColumns.some((column) => column.name === "encryption_mode")) {
    db.exec("ALTER TABLE entries ADD COLUMN encryption_mode TEXT NOT NULL DEFAULT 'self'");
  }

  const upsertUser = db.prepare(`
    INSERT INTO users (sub, tide_user_key, display_name, roles_json, updated_at)
    VALUES (@sub, @tideUserKey, @displayName, @rolesJson, @updatedAt)
    ON CONFLICT(sub) DO UPDATE SET
      tide_user_key = CASE WHEN excluded.tide_user_key = '' THEN users.tide_user_key ELSE excluded.tide_user_key END,
      display_name = excluded.display_name,
      roles_json = excluded.roles_json,
      updated_at = excluded.updated_at
  `);
  const findUser = db.prepare(`
    SELECT sub, tide_user_key AS tideUserKey, display_name AS displayName, roles_json AS rolesJson
    FROM users WHERE sub = ?
  `);
  const insertEntry = db.prepare(`
    INSERT INTO entries (id, owner_sub, encrypted_content, created_at, encryption_mode)
    VALUES (?, ?, ?, ?, 'self')
  `);
  const findOwnerEntries = db.prepare(`
    SELECT id, encrypted_content AS encryptedContent, created_at AS createdAt,
      encryption_mode AS encryptionMode
    FROM entries WHERE owner_sub = ? ORDER BY created_at DESC
  `);
  const findEntryByOwner = db.prepare(`
    SELECT id, encryption_mode AS encryptionMode FROM entries WHERE id = ? AND owner_sub = ?
  `);
  const insertAccessEvent = db.prepare(`
    INSERT INTO access_log (entry_id, actor_sub, action, occurred_at)
    VALUES (?, ?, ?, ?)
  `);
  const findAccessLog = db.prepare(`
    SELECT l.actor_sub AS actorSub, u.display_name AS actorName, l.action, l.occurred_at AS occurredAt
    FROM access_log l LEFT JOIN users u ON u.sub = l.actor_sub
    WHERE l.entry_id = ? AND l.entry_id IN (SELECT id FROM entries WHERE owner_sub = ?)
    ORDER BY l.occurred_at DESC
  `);
  const findAllMetadata = db.prepare(`
    SELECT e.id, e.created_at AS createdAt,
      (SELECT s.status FROM entry_shares s WHERE s.entry_id = e.id ORDER BY s.updated_at DESC LIMIT 1) AS shareStatus,
      (SELECT s.expires_at FROM entry_shares s WHERE s.entry_id = e.id ORDER BY s.updated_at DESC LIMIT 1) AS shareExpiresAt
    FROM entries e ORDER BY e.created_at DESC
  `);
  const findLatestShare = db.prepare(`
    SELECT id, status, expires_at AS expiresAt
    FROM entry_shares
    WHERE entry_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const findCurrentShare = db.prepare(`
    SELECT id, status, expires_at AS expiresAt
    FROM entry_shares
    WHERE entry_id = ? AND status IN ('pending', 'approved_pending_rewrap', 'active')
    LIMIT 1
  `);
  const findOwnerPolicy = db.prepare(`
    SELECT policy_b64 AS policyB64 FROM entry_policies
    WHERE entry_id = ? AND subject_sub = ?
  `);

  function userProfile(sub: string): UserProfile | null {
    const row = findUser.get(sub) as {
      sub: string;
      tideUserKey: string;
      displayName: string;
      rolesJson: string;
    } | undefined;
    if (!row) return null;
    const roles = JSON.parse(row.rolesJson) as string[];
    return {
      sub: row.sub,
      tideUserKey: row.tideUserKey,
      displayName: row.displayName,
      isCounsellor: roles.includes("counsellor"),
      isAdmin: roles.includes("admin"),
    };
  }

  return {
    upsertUser(profile: { sub: string; tideUserKey: string; displayName: string; roles: string[] }): void {
      upsertUser.run({
        ...profile,
        rolesJson: JSON.stringify(profile.roles),
        updatedAt: new Date().toISOString(),
      });
    },

    listCounsellors(excludeSub: string): Pick<UserProfile, "sub" | "displayName">[] {
      const rows = db.prepare(`
        SELECT sub, display_name AS displayName, tide_user_key AS tideUserKey, roles_json AS rolesJson
        FROM users WHERE sub != ? ORDER BY display_name
      `).all(excludeSub) as { sub: string; displayName: string; tideUserKey: string; rolesJson: string }[];
      return rows
        .filter((row) => row.tideUserKey && (JSON.parse(row.rolesJson) as string[]).includes("counsellor"))
        .map(({ sub, displayName }) => ({ sub, displayName }));
    },

    createEntry(ownerSub: string, encryptedContent: string): StoredEntry {
      const entry = {
        id: randomUUID(),
        encryptedContent,
        createdAt: new Date().toISOString(),
        encryptionMode: "self" as const,
        shareStatus: null,
        shareId: null,
        shareExpiresAt: null,
        ownerPolicyB64: null,
      };
      insertEntry.run(entry.id, ownerSub, encryptedContent, entry.createdAt);
      return entry;
    },

    listOwnerEntries(ownerSub: string): StoredEntry[] {
      const rows = findOwnerEntries.all(ownerSub) as Omit<StoredEntry, "shareStatus" | "shareId" | "shareExpiresAt" | "ownerPolicyB64">[];
      return rows.map((entry) => {
        const share = findLatestShare.get(entry.id) as { id: string; status: SharingStatus; expiresAt: string } | undefined;
        const shareIsLive = share && ["pending", "approved_pending_rewrap", "active"].includes(share.status);
        const isCurrent = shareIsLive && Date.parse(share.expiresAt) > Date.now();
        return {
          ...entry,
          shareStatus: share?.status === "revoked" || share?.status === "expired"
            ? share.status
            : isCurrent ? share.status : share ? "expired" : null,
          shareId: isCurrent ? share.id : null,
          shareExpiresAt: share?.expiresAt ?? null,
          ownerPolicyB64: entry.encryptionMode === "relationship"
            || (isCurrent && share && ["approved_pending_rewrap", "active"].includes(share.status))
            ? (findOwnerPolicy.get(entry.id, ownerSub) as { policyB64: string } | undefined)?.policyB64 ?? null
            : null,
        };
      });
    },

    listAccessLog(entryId: string, ownerSub: string): AccessEvent[] | null {
      if (!findEntryByOwner.get(entryId, ownerSub)) return null;
      return findAccessLog.all(entryId, ownerSub) as AccessEvent[];
    },

    recordAccess(entryId: string, ownerSub: string, actorSub: string, action: string): boolean {
      if (actorSub !== ownerSub) {
        const shared = db.prepare(`
          SELECT 1 FROM entry_shares
          WHERE entry_id = ? AND owner_sub = ? AND counsellor_sub = ?
            AND status = 'active' AND expires_at > ?
        `).get(entryId, ownerSub, actorSub, new Date().toISOString());
        if (!shared) return false;
      } else if (!findEntryByOwner.get(entryId, ownerSub)) {
        return false;
      }
      insertAccessEvent.run(entryId, actorSub, action, new Date().toISOString());
      return true;
    },

    recordUserAccess(entryId: string, actorSub: string, action: string): boolean {
      const entry = db.prepare("SELECT owner_sub AS ownerSub FROM entries WHERE id = ?").get(entryId) as { ownerSub: string } | undefined;
      if (!entry) return false;
      if (entry.ownerSub !== actorSub) {
        const shared = db.prepare(`
          SELECT 1 FROM entry_shares
          WHERE entry_id = ? AND owner_sub = ? AND counsellor_sub = ?
            AND status = 'active' AND expires_at > ?
        `).get(entryId, entry.ownerSub, actorSub, new Date().toISOString());
        if (!shared) return false;
      }
      insertAccessEvent.run(entryId, actorSub, action, new Date().toISOString());
      return true;
    },

    createShareRequest(
      entryId: string,
      ownerSub: string,
      counsellorSub: string,
      expiresAt: string,
    ): ShareRequest | null {
      const entry = findEntryByOwner.get(entryId, ownerSub);
      const owner = userProfile(ownerSub);
      const counsellor = userProfile(counsellorSub);
      if (!entry || !owner?.tideUserKey || !counsellor?.tideUserKey || !counsellor.isCounsellor || counsellorSub === ownerSub) return null;
      db.prepare(`
        UPDATE entry_shares SET status = 'expired', updated_at = ?
        WHERE entry_id = ? AND status IN ('pending', 'approved_pending_rewrap', 'active') AND expires_at <= ?
      `).run(new Date().toISOString(), entryId, new Date().toISOString());
      const existing = findCurrentShare.get(entryId) as { expiresAt: string } | undefined;
      if (existing && Date.parse((existing as { expiresAt: string }).expiresAt) > Date.now()) return null;

      const request: ShareRequest = {
        id: randomUUID(),
        entryId,
        ownerSub,
        ownerName: owner.displayName,
        ownerTideUserKey: owner.tideUserKey,
        counsellorSub,
        counsellorName: counsellor.displayName,
        counsellorTideUserKey: counsellor.tideUserKey,
        status: "pending",
        createdAt: new Date().toISOString(),
        expiresAt,
      };
      db.prepare(`
        INSERT INTO entry_shares (id, entry_id, owner_sub, counsellor_sub, status, created_at, expires_at, updated_at)
        VALUES (@id, @entryId, @ownerSub, @counsellorSub, @status, @createdAt, @expiresAt, @createdAt)
      `).run(request);
      return request;
    },

    listOwnerShareRequests(entryId: string, ownerSub: string): Omit<ShareRequest, "ownerTideUserKey" | "counsellorTideUserKey">[] | null {
      if (!findEntryByOwner.get(entryId, ownerSub)) return null;
      return db.prepare(`
        SELECT s.id, s.entry_id AS entryId, s.owner_sub AS ownerSub, owner.display_name AS ownerName,
          s.counsellor_sub AS counsellorSub, counsellor.display_name AS counsellorName,
          s.status, s.created_at AS createdAt, s.expires_at AS expiresAt
        FROM entry_shares s
        JOIN users owner ON owner.sub = s.owner_sub
        JOIN users counsellor ON counsellor.sub = s.counsellor_sub
        WHERE s.entry_id = ? AND s.owner_sub = ?
        ORDER BY s.created_at DESC
      `).all(entryId, ownerSub) as Omit<ShareRequest, "ownerTideUserKey" | "counsellorTideUserKey">[];
    },

    listPendingShareRequests(): ShareRequest[] {
      return db.prepare(`
        SELECT s.id, s.entry_id AS entryId, s.owner_sub AS ownerSub, owner.display_name AS ownerName,
          owner.tide_user_key AS ownerTideUserKey, s.counsellor_sub AS counsellorSub,
          counsellor.display_name AS counsellorName, counsellor.tide_user_key AS counsellorTideUserKey,
          s.status, s.created_at AS createdAt, s.expires_at AS expiresAt
        FROM entry_shares s
        JOIN users owner ON owner.sub = s.owner_sub
        JOIN users counsellor ON counsellor.sub = s.counsellor_sub
        WHERE s.status = 'pending' AND s.expires_at > ?
        ORDER BY s.created_at
      `).all(new Date().toISOString()) as ShareRequest[];
    },

    getShareRequest(shareId: string): ShareRequest | null {
      return (db.prepare(`
        SELECT s.id, s.entry_id AS entryId, s.owner_sub AS ownerSub, owner.display_name AS ownerName,
          owner.tide_user_key AS ownerTideUserKey, s.counsellor_sub AS counsellorSub,
          counsellor.display_name AS counsellorName, counsellor.tide_user_key AS counsellorTideUserKey,
          s.status, s.created_at AS createdAt, s.expires_at AS expiresAt
        FROM entry_shares s
        JOIN users owner ON owner.sub = s.owner_sub
        JOIN users counsellor ON counsellor.sub = s.counsellor_sub
        WHERE s.id = ?
      `).get(shareId) as ShareRequest | undefined) ?? null;
    },

    approveShareRequest(share: ShareRequest, ownerPolicyB64: string, counsellorPolicyB64: string): "approved_pending_rewrap" | "active" | null {
      const entry = findEntryByOwner.get(share.entryId, share.ownerSub) as { id: string; encryptionMode: string } | undefined;
      const current = db.prepare("SELECT status FROM entry_shares WHERE id = ?").get(share.id) as { status: string } | undefined;
      if (!entry || current?.status !== "pending" || Date.parse(share.expiresAt) <= Date.now()) return null;
      const status = entry.encryptionMode === "self" ? "approved_pending_rewrap" : "active";
      const now = new Date().toISOString();
      const insertPolicy = db.prepare(`
        INSERT INTO entry_policies (entry_id, subject_sub, policy_b64, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(entry_id, subject_sub) DO UPDATE SET policy_b64 = excluded.policy_b64, created_at = excluded.created_at
      `);
      const commit = db.transaction(() => {
        const result = db.prepare(`
          UPDATE entry_shares SET status = ?, updated_at = ?
          WHERE id = ? AND status = 'pending'
        `).run(status, now, share.id);
        if (result.changes !== 1) return false;
        insertPolicy.run(share.entryId, share.ownerSub, ownerPolicyB64, now);
        insertPolicy.run(share.entryId, share.counsellorSub, counsellorPolicyB64, now);
        return true;
      });
      return commit() ? status : null;
    },

    completeShareRewrap(entryId: string, ownerSub: string, encryptedContent: string): boolean {
      const pending = db.prepare(`
        SELECT id FROM entry_shares
        WHERE entry_id = ? AND owner_sub = ? AND status = 'approved_pending_rewrap' AND expires_at > ?
      `).get(entryId, ownerSub, new Date().toISOString());
      if (!pending || !findOwnerPolicy.get(entryId, ownerSub)) return false;
      const now = new Date().toISOString();
      const commit = db.transaction(() => {
        const result = db.prepare("UPDATE entry_shares SET status = 'active', updated_at = ? WHERE id = ? AND status = 'approved_pending_rewrap'")
          .run(now, (pending as { id: string }).id);
        if (result.changes !== 1) return false;
        db.prepare("UPDATE entries SET encrypted_content = ?, encryption_mode = 'relationship' WHERE id = ? AND owner_sub = ?")
          .run(encryptedContent, entryId, ownerSub);
        insertAccessEvent.run(entryId, ownerSub, "share-activated", now);
        return true;
      });
      return commit();
    },

    revokeShare(entryId: string, shareId: string, ownerSub: string, encryptedContent: string): boolean {
      const share = db.prepare(`
        SELECT id FROM entry_shares
        WHERE id = ? AND entry_id = ? AND owner_sub = ?
          AND status IN ('approved_pending_rewrap', 'active')
      `).get(shareId, entryId, ownerSub) as { id: string } | undefined;
      const entry = findEntryByOwner.get(entryId, ownerSub) as { id: string; encryptionMode: string } | undefined;
      if (!share || !entry || (entry.encryptionMode === "relationship" && !encryptedContent)) return false;
      const now = new Date().toISOString();
      const commit = db.transaction(() => {
        const result = db.prepare("UPDATE entry_shares SET status = 'revoked', updated_at = ? WHERE id = ? AND status IN ('approved_pending_rewrap', 'active')")
          .run(now, share.id);
        if (result.changes !== 1) return false;
        if (entry.encryptionMode === "relationship") {
          db.prepare("UPDATE entries SET encrypted_content = ?, encryption_mode = 'self' WHERE id = ? AND owner_sub = ?")
            .run(encryptedContent, entryId, ownerSub);
        }
        db.prepare("DELETE FROM entry_policies WHERE entry_id = ?").run(entryId);
        insertAccessEvent.run(entryId, ownerSub, "share-revoked", now);
        return true;
      });
      return commit();
    },

    listCounsellorEntries(counsellorSub: string): {
      id: string;
      encryptedContent: string;
      createdAt: string;
      ownerName: string;
      policyB64: string;
    }[] {
      return db.prepare(`
        SELECT e.id, e.encrypted_content AS encryptedContent, e.created_at AS createdAt,
          owner.display_name AS ownerName, p.policy_b64 AS policyB64
        FROM entry_shares s
        JOIN entries e ON e.id = s.entry_id
        JOIN users owner ON owner.sub = s.owner_sub
        JOIN entry_policies p ON p.entry_id = s.entry_id AND p.subject_sub = s.counsellor_sub
        WHERE s.counsellor_sub = ? AND s.status = 'active'
          AND s.expires_at > ? AND e.encryption_mode = 'relationship'
        ORDER BY e.created_at DESC
      `).all(counsellorSub, new Date().toISOString()) as {
        id: string;
        encryptedContent: string;
        createdAt: string;
        ownerName: string;
        policyB64: string;
      }[];
    },

    listCounsellorNotes(entryId: string, counsellorSub: string): CounsellorNote[] {
      return db.prepare(`
        SELECT n.id, n.encrypted_content AS encryptedContent, n.created_at AS createdAt
        FROM counsellor_notes n
        JOIN entry_shares s ON s.entry_id = n.entry_id
        WHERE n.entry_id = ? AND n.counsellor_sub = ? AND s.counsellor_sub = ?
          AND s.status = 'active' AND s.expires_at > ?
        ORDER BY n.created_at DESC
      `).all(entryId, counsellorSub, counsellorSub, new Date().toISOString()) as CounsellorNote[];
    },

    createCounsellorNote(entryId: string, counsellorSub: string, encryptedContent: string): CounsellorNote | null {
      const activeShare = db.prepare(`
        SELECT 1 FROM entry_shares
        WHERE entry_id = ? AND counsellor_sub = ? AND status = 'active' AND expires_at > ?
      `).get(entryId, counsellorSub, new Date().toISOString());
      if (!activeShare) return null;
      const note = { id: randomUUID(), encryptedContent, createdAt: new Date().toISOString() };
      db.prepare(`
        INSERT INTO counsellor_notes (id, entry_id, counsellor_sub, encrypted_content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(note.id, entryId, counsellorSub, encryptedContent, note.createdAt);
      return note;
    },

    listMetadata(): EntryMetadata[] {
      const rows = findAllMetadata.all() as (EntryMetadata & { shareExpiresAt: string | null })[];
      return rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        shareStatus: row.shareExpiresAt && Date.parse(row.shareExpiresAt) <= Date.now()
          && ["pending", "approved_pending_rewrap", "active"].includes(row.shareStatus ?? "")
          ? "expired"
          : row.shareStatus,
      }));
    },

    close(): void {
      db.close();
    },
  };
}

export type EntryStore = ReturnType<typeof createStore>;
