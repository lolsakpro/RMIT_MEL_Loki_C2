export interface Entry {
  id: string;
  encryptedContent: string;
  createdAt: string;
  content?: string;
  encryptionMode: "self" | "relationship";
  shareStatus: "pending" | "approved_pending_rewrap" | "active" | "revoked" | "expired" | null;
  shareId: string | null;
  shareExpiresAt: string | null;
  ownerPolicyB64: string | null;
}

export interface EntryMetadata {
  id: string;
  createdAt: string;
  shareStatus: string | null;
}

export interface AccessEvent {
  actorSub: string;
  actorName: string | null;
  action: string;
  occurredAt: string;
}

export interface Counsellor {
  sub: string;
  displayName: string;
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
  status: "pending" | "approved_pending_rewrap" | "active" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;
}

export interface SharedEntry {
  id: string;
  encryptedContent: string;
  createdAt: string;
  ownerName: string;
  policyB64: string;
}

export interface CounsellorNote {
  id: string;
  encryptedContent: string;
  createdAt: string;
  content?: string;
}
