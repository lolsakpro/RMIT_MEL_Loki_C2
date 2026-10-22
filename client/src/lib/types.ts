export interface Entry {
  id: string;
  encryptedContent: string;
  createdAt: string;
  content?: string;
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
