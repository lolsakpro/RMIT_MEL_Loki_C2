import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useKadsAuth } from "./lib/auth";
import { apiRequest } from "./lib/api";
import {
  COUNSELLOR_NOTE_TAG,
  decodeCiphertext,
  encodeCiphertext,
  WELLBEING_TAG,
} from "./lib/encryption";
import {
  decryptForRecord,
  encryptForRecord,
  signRelationshipPolicy,
} from "./lib/tide/relationship";
import type {
  AccessEvent,
  CounsellorNote,
  Counsellor,
  Entry,
  EntryMetadata,
  ShareRequest,
  SharedEntry,
} from "./lib/types";

function App() {
  const { isInitializing, initError, isCallback, isProcessing, callbackError, authenticated } = useKadsAuth();

  if (isCallback) {
    if (callbackError) {
      return <main className="center-screen"><ErrorNotice message={callbackError.message} /></main>;
    }
    return <main className="center-screen"><p>{isProcessing ? "Completing secure sign-in..." : "Finishing sign-in..."}</p></main>;
  }

  if (isInitializing) {
    return <main className="center-screen"><p>Connecting to TideCloak...</p></main>;
  }

  if (initError) {
    return (
      <main className="center-screen">
        <section className="panel setup-error">
          <p className="eyebrow">TideCloak setup needed</p>
          <h1>Secure sign-in is not configured yet.</h1>
          <p className="muted">Export the adapter JSON for this realm to <code>client/public/tidecloak.json</code>, then reload KADS. Sign-in is disabled until TideCloak connects.</p>
          <ErrorNotice message="TideCloak could not load a valid adapter JSON. Confirm the export is present at /tidecloak.json and matches the target realm." />
        </section>
      </main>
    );
  }

  return (
    authenticated ? <RoleDashboard /> : <LoginPage />
  );
}

function LoginPage() {
  const { login, mode, selectDemoRole } = useKadsAuth();
  const [demoRole, setDemoRole] = useState<"student" | "counsellor" | "admin">("student");

  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">K</span>
          <span>KADS</span>
        </div>
        {mode === "demo" && <p className="demo-banner">DEMO MODE · Simulated sign-in and demo-only encryption. Never enter real wellbeing data.</p>}
        <p className="eyebrow">A private space for students</p>
        <h1>Your thoughts belong to you.</h1>
        <p className="muted">
          Write privately, and choose exactly which note to share if you want support.
          Notes are encrypted in your browser before they reach the app.
        </p>
        {mode === "demo" && (
          <label className="demo-role-picker" htmlFor="demo-role">
            Preview as
            <select id="demo-role" value={demoRole} onChange={(event) => {
              const role = event.target.value as typeof demoRole;
              setDemoRole(role);
            }}>
              <option value="student">Student</option>
              <option value="counsellor">Counsellor</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
        )}
        <button
          className="button button-primary button-wide"
          onClick={mode === "demo" ? () => selectDemoRole(demoRole) : login}
        >
          {mode === "demo" ? "Enter demo" : "Continue securely"}
        </button>
        <p className="privacy-note">{mode === "demo"
          ? "Switch to TideCloak by setting VITE_AUTH_MODE=tide after adding the exported adapter."
          : "TideCloak protects sign-in and note encryption. Sharing requires an approved, time-limited access grant."}</p>
      </section>
    </main>
  );
}

function RoleDashboard() {
  const { hasRealmRole, logout, getValueFromIdToken, mode, selectDemoRole } = useKadsAuth();
  const displayName = getValueFromIdToken("preferred_username");
  const roles = ["student", "counsellor", "admin"].filter(hasRealmRole);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="KADS home">
          <span className="brand-mark" aria-hidden="true">K</span>
          <span>KADS <span className="brand-subtitle">PRIVATE WELLBEING NOTES</span></span>
        </a>
        <div className="account-menu">
          {mode === "demo" && (
            <label className="demo-switcher">
              <span>Demo:</span>
              <select
                aria-label="Switch demo role"
                value={["student", "counsellor", "admin"].find(hasRealmRole) ?? "student"}
                onChange={(event) => selectDemoRole(event.target.value as "student" | "counsellor" | "admin")}
              >
                <option value="student">Student</option>
                <option value="counsellor">Counsellor</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          )}
          <span className="role-pill">{roles.join(" · ") || "member"}</span>
          <span className="account-name">{typeof displayName === "string" ? displayName : "Signed in"}</span>
          <button className="button button-quiet" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="content">
        {hasRealmRole("student") && <StudentDashboard />}
        {hasRealmRole("counsellor") && <CounsellorDashboard />}
        {hasRealmRole("admin") && <AdminDashboard />}
        {roles.length === 0 && (
          <section className="panel">
            <p className="eyebrow">Account setup</p>
            <h1>Your account needs a role</h1>
            <p className="muted">Ask the TideCloak administrator to assign your student, counsellor, or admin role.</p>
          </section>
        )}
      </main>
    </div>
  );
}

function StudentDashboard() {
  const { doEncrypt, doDecrypt, IAMService, token } = useKadsAuth();
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [counsellors, setCounsellors] = useState<Counsellor[]>([]);
  const [shareEntryId, setShareEntryId] = useState("");
  const [selectedCounsellor, setSelectedCounsellor] = useState("");
  const [shareExpiry, setShareExpiry] = useState(86400);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [revokingId, setRevokingId] = useState("");
  const [error, setError] = useState("");
  const [auditWarning, setAuditWarning] = useState("");

  const loadEntries = useCallback(async () => {
    if (!token) return;
    setError("");
    setAuditWarning("");
    setLoading(true);
    try {
      const stored = await apiRequest<Entry[]>(IAMService.secureFetch.bind(IAMService), token, "/api/entries");
      const decrypted: Entry[] = [];
      for (const entry of stored) {
        const serialized = decodeCiphertext(entry.encryptedContent);
        let content: string;
        if (entry.encryptionMode === "relationship") {
          if (!entry.ownerPolicyB64 || typeof serialized !== "string") {
            throw new Error(`The relationship policy for entry ${entry.id} is missing or invalid.`);
          }
          content = await decryptForRecord(serialized, entry.id, entry.ownerPolicyB64);
        } else {
          const [plaintext] = await doDecrypt([{ encrypted: serialized, tags: [WELLBEING_TAG] }]);
          content = typeof plaintext === "string" ? plaintext : new TextDecoder().decode(plaintext as Uint8Array);
        }

        let loadedEntry = { ...entry, content };
        if (entry.shareStatus === "approved_pending_rewrap" && entry.ownerPolicyB64) {
          try {
            const relationshipCipher = await encryptForRecord(content, entry.id, entry.ownerPolicyB64);
            await apiRequest(
              IAMService.secureFetch.bind(IAMService),
              token,
              `/api/entries/${encodeURIComponent(entry.id)}/share-rewrap`,
              { method: "POST", body: JSON.stringify({ encryptedContent: encodeCiphertext(relationshipCipher) }) },
            );
            loadedEntry = { ...loadedEntry, encryptionMode: "relationship", shareStatus: "active" };
          } catch (err) {
            setAuditWarning(`The share is approved, but this note is still private until re-encryption succeeds: ${errorMessage(err, "Tide encryption failed.")}`);
          }
        }

        try {
          await apiRequest(
            IAMService.secureFetch.bind(IAMService),
            token,
            `/api/entries/${encodeURIComponent(entry.id)}/access-events`,
            { method: "POST", body: JSON.stringify({ action: "opened" }) },
          );
        } catch {
          setAuditWarning("A note opened, but KADS could not record that access event. Refresh and check your connection.");
        }
        decrypted.push(loadedEntry);
      }
      setEntries(decrypted);
    } catch (err) {
      setError(errorMessage(err, "Could not load your encrypted notes."));
    } finally {
      setLoading(false);
    }
  }, [IAMService, doDecrypt, token]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !note.trim()) return;
    setSaving(true);
    setError("");
    try {
      const [encrypted] = await doEncrypt([{ data: note.trim(), tags: [WELLBEING_TAG] }]);
      await apiRequest(
        IAMService.secureFetch.bind(IAMService),
        token,
        "/api/entries",
        {
          method: "POST",
          body: JSON.stringify({ encryptedContent: encodeCiphertext(encrypted) }),
        },
      );
      setNote("");
      await loadEntries();
    } catch (err) {
      setError(errorMessage(err, "Could not save the note. Check that your Tide encryption role is configured."));
    } finally {
      setSaving(false);
    }
  }

  async function openShareDialog(entryId: string) {
    if (!token) return;
    setError("");
    try {
      const available = await apiRequest<Counsellor[]>(
        IAMService.secureFetch.bind(IAMService),
        token,
        "/api/counsellors",
      );
      setCounsellors(available);
      setSelectedCounsellor(available[0]?.sub ?? "");
      setShareExpiry(86400);
      setShareEntryId(entryId);
    } catch (err) {
      setError(errorMessage(err, "Could not load the counsellor list."));
    }
  }

  async function submitShareRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !shareEntryId || !selectedCounsellor) return;
    setSharing(true);
    setError("");
    try {
      await apiRequest(
        IAMService.secureFetch.bind(IAMService),
        token,
        `/api/entries/${encodeURIComponent(shareEntryId)}/share-requests`,
        {
          method: "POST",
          body: JSON.stringify({ counsellorSub: selectedCounsellor, expiresInSeconds: shareExpiry }),
        },
      );
      setShareEntryId("");
      await loadEntries();
    } catch (err) {
      setError(errorMessage(err, "Could not request access for this entry."));
    } finally {
      setSharing(false);
    }
  }

  async function revokeShare(entry: Entry) {
    if (!token || !entry.shareId) return;
    setRevokingId(entry.id);
    setError("");
    try {
      const encryptedContent = entry.encryptionMode === "relationship"
        ? encodeCiphertext((await doEncrypt([{ data: entry.content ?? "", tags: [WELLBEING_TAG] }]))[0])
        : undefined;
      await apiRequest(
        IAMService.secureFetch.bind(IAMService),
        token,
        `/api/entries/${encodeURIComponent(entry.id)}/shares/${encodeURIComponent(entry.shareId)}/revoke`,
        {
          method: "POST",
          body: JSON.stringify({ encryptedContent }),
        },
      );
      await loadEntries();
    } catch (err) {
      setError(errorMessage(err, "Could not revoke counsellor access."));
    } finally {
      setRevokingId("");
    }
  }

  return (
    <section className="dashboard-grid">
      <div className="page-heading">
        <p className="eyebrow">Your private journal</p>
        <h1>A moment for yourself.</h1>
        <p className="muted">Write what is on your mind. Your note is encrypted in this browser before it is sent to KADS.</p>
      </div>

      <div className="privacy-banner">
        <span className="privacy-icon" aria-hidden="true">✳</span>
        <div>
          <strong>Private by default</strong>
          <p>To share: choose “Share this entry,” submit a time-limited request, have an administrator approve it, then refresh your journal to activate the encrypted share. The counsellor can then refresh their page to read it.</p>
        </div>
      </div>

      <form className="panel compose-panel" onSubmit={saveEntry}>
        <label htmlFor="note-content">What would you like to note today?</label>
        <textarea
          id="note-content"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Take a moment to write what you want to remember..."
          rows={6}
          maxLength={10000}
          required
        />
        <div className="compose-footer">
          <span className="muted small">Private to you · encrypted before upload</span>
          <button className="button button-primary" disabled={saving || !note.trim()}>
            {saving ? "Encrypting and saving..." : "Save private note"}
          </button>
        </div>
      </form>

      {error && <ErrorNotice message={error} />}
      {auditWarning && <p className="warning-notice" role="status">{auditWarning}</p>}

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Your journal</p>
            <h2>Your notes</h2>
            <p className="muted">Only your Tide identity can decrypt private entries.</p>
          </div>
          <button className="button button-quiet" onClick={() => void loadEntries()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {loading ? <p className="muted">Loading encrypted notes...</p> : entries.length === 0 ? (
          <p className="empty-state">Your journal is empty. Add a note whenever you are ready.</p>
        ) : (
          <div className="entry-list">
            {entries.map((entry) => (
              <EntryCard
                entry={entry}
                key={entry.id}
                onShare={() => void openShareDialog(entry.id)}
                onRevoke={() => void revokeShare(entry)}
                revoking={revokingId === entry.id}
              />
            ))}
          </div>
        )}
      </section>

      {shareEntryId && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShareEntryId("");
        }}>
          <section className="modal panel" role="dialog" aria-modal="true" aria-labelledby="share-title">
            <button className="modal-close" aria-label="Close share dialog" onClick={() => setShareEntryId("")}>×</button>
            <p className="eyebrow">One entry only</p>
            <h2 id="share-title">Share with a counsellor</h2>
            <p className="muted">This sends an access request, not the note in plaintext. An administrator must approve it. After approval, return here and refresh so your browser can activate the encrypted share; the counsellor can then refresh their page.</p>
            {counsellors.length === 0 ? (
              <p className="empty-state">No counsellor accounts are available yet. Ask them to sign in to KADS first.</p>
            ) : (
              <form className="modal-form" onSubmit={submitShareRequest}>
                <label htmlFor="counsellor-select">Counsellor</label>
                <select id="counsellor-select" value={selectedCounsellor} onChange={(event) => setSelectedCounsellor(event.target.value)} required>
                  {counsellors.map((counsellor) => (
                    <option key={counsellor.sub} value={counsellor.sub}>{counsellor.displayName}</option>
                  ))}
                </select>
                <label htmlFor="share-expiry">Access expires after</label>
                <select id="share-expiry" value={shareExpiry} onChange={(event) => setShareExpiry(Number(event.target.value))}>
                  <option value={3600}>1 hour</option>
                  <option value={86400}>24 hours</option>
                  <option value={604800}>7 days</option>
                </select>
                <div className="sharing-notice">
                  <strong>Before you share</strong>
                  <span>Revoking blocks new access through KADS and returns the current note to your private encryption. A counsellor may retain a copy they already opened.</span>
                </div>
                <button className="button button-primary button-wide" disabled={sharing || !selectedCounsellor}>
                  {sharing ? "Sending request..." : "Request one-entry access"}
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

function EntryCard({
  entry,
  onShare,
  onRevoke,
  revoking,
}: {
  entry: Entry;
  onShare: () => void;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const { IAMService, token, getValueFromIdToken } = useKadsAuth();
  const currentUserSub = getValueFromIdToken("sub");
  const [events, setEvents] = useState<AccessEvent[] | null>(null);
  const [error, setError] = useState("");

  async function loadAccessLog() {
    if (!token || events) return;
    setError("");
    try {
      setEvents(await apiRequest<AccessEvent[]>(
        IAMService.secureFetch.bind(IAMService),
        token,
        `/api/entries/${encodeURIComponent(entry.id)}/access-log`,
      ));
    } catch (err) {
      setError(errorMessage(err, "Could not load the access log."));
    }
  }

  const shareInProgress = entry.shareStatus === "pending" || entry.shareStatus === "approved_pending_rewrap";
  const shareActive = entry.shareStatus === "active";

  return (
    <article className="entry-card">
      <div className="entry-card-heading">
        <p className="entry-date">{formatDate(entry.createdAt)}</p>
        <span className={`status-pill ${shareActive ? "status-shared" : ""}`}>
          {shareActive ? "Shared · expires " + formatDate(entry.shareExpiresAt ?? "") : "Private"}
        </span>
      </div>
      <p className="entry-content">{entry.content}</p>
      <div className="entry-actions">
        {shareActive ? (
          <button className="button button-danger-quiet" onClick={onRevoke} disabled={revoking}>
            {revoking ? "Revoking..." : "Revoke access"}
          </button>
        ) : shareInProgress ? (
          <span className="muted small">{entry.shareStatus === "pending"
            ? "Request sent. An administrator must approve it; then refresh your journal to activate sharing."
            : "Approved. Refresh your journal to finish encrypting and activate this share."}</span>
        ) : (
          <button className="button button-quiet" onClick={onShare}>Share this entry</button>
        )}
        {entry.shareStatus === "expired" && <span className="muted small">The share expired; this entry is private again.</span>}
      </div>
      <details className="entry-audit" onToggle={(event) => {
        if (event.currentTarget.open) void loadAccessLog();
      }}>
        <summary>Access history</summary>
        {error && <ErrorNotice message={error} />}
        {events === null && !error ? <p className="muted small">Loading access history...</p> : null}
        {events?.length === 0 && <p className="muted small">No access events recorded yet.</p>}
        {events?.map((event, index) => (
          <p className="audit-event" key={`${event.occurredAt}-${index}`}>
            {event.actorSub === currentUserSub ? "You" : event.actorName ?? "A counsellor"} · {describeAccess(event.action)} · {formatDate(event.occurredAt)}
          </p>
        ))}
      </details>
    </article>
  );
}

interface DisplaySharedEntry extends SharedEntry {
  content?: string;
  counsellorNotes: CounsellorNote[];
  privateNotesError?: string;
  decryptionError?: string;
  auditError?: string;
}

function CounsellorDashboard() {
  const { IAMService, token, doDecrypt } = useKadsAuth();
  const [entries, setEntries] = useState<DisplaySharedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadEntries = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const stored = await apiRequest<SharedEntry[]>(
        IAMService.secureFetch.bind(IAMService),
        token,
        "/api/counsellor/entries",
      );
      const opened = await Promise.all(stored.map(async (entry): Promise<DisplaySharedEntry> => {
        try {
          const serialized = decodeCiphertext(entry.encryptedContent);
          if (typeof serialized !== "string") throw new Error("The shared entry is not in a supported format.");
          const content = await decryptForRecord(serialized, entry.id, entry.policyB64);
          let counsellorNotes: CounsellorNote[] = [];
          let privateNotesError: string | undefined;
          try {
            const storedNotes = await apiRequest<CounsellorNote[]>(
              IAMService.secureFetch.bind(IAMService),
              token,
              `/api/counsellor/entries/${encodeURIComponent(entry.id)}/notes`,
            );
            const notes = storedNotes.length > 0
              ? await doDecrypt(storedNotes.map((privateNote) => ({
                encrypted: decodeCiphertext(privateNote.encryptedContent),
                tags: [COUNSELLOR_NOTE_TAG],
              })))
              : [];
            counsellorNotes = storedNotes.map((privateNote, index) => ({
              ...privateNote,
              content: typeof notes[index] === "string"
                ? notes[index] as string
                : new TextDecoder().decode(notes[index] as Uint8Array),
            }));
          } catch (err) {
            privateNotesError = errorMessage(err, "Could not load your private counsellor notes.");
          }
          let auditError: string | undefined;
          try {
            await apiRequest(
              IAMService.secureFetch.bind(IAMService),
              token,
              `/api/entries/${encodeURIComponent(entry.id)}/access-events`,
              { method: "POST", body: JSON.stringify({ action: "opened" }) },
            );
          } catch {
            auditError = "KADS could not record this opening. Refresh and check your connection.";
          }
          return { ...entry, content, counsellorNotes, privateNotesError, auditError };
        } catch (err) {
          return { ...entry, counsellorNotes: [], decryptionError: errorMessage(err, "Could not decrypt this entry.") };
        }
      }));
      setEntries(opened);
    } catch (err) {
      setError(errorMessage(err, "Could not load shared entries."));
    } finally {
      setLoading(false);
    }
  }, [IAMService, token]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  return (
    <section className="dashboard-grid">
      <div className="page-heading">
        <p className="eyebrow">Counsellor workspace</p>
        <h1>Shared with you.</h1>
        <p className="muted">Only entries a student has shared with your Tide identity appear here.</p>
      </div>
      <div className="privacy-banner">
        <span className="privacy-icon" aria-hidden="true">⌁</span>
        <div>
          <strong>Read-only, per-entry access</strong>
          <p>Access expires at the time shown. Refresh to check whether a student has revoked a share.</p>
        </div>
      </div>
      <section className="panel">
        <div className="section-heading">
          <div><h2>Shared entries</h2><p className="muted">Opening an entry is recorded in the student's access history.</p></div>
          <button className="button button-quiet" onClick={() => void loadEntries()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {error && <ErrorNotice message={error} />}
        {loading ? <p className="muted">Checking your active shares...</p> : entries.length === 0 ? (
          <p className="empty-state">No active entries have been shared with you.</p>
        ) : (
          <div className="entry-list">
            {entries.map((entry) => (
              <CounsellorEntryCard entry={entry} key={entry.id} />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function CounsellorEntryCard({ entry }: { entry: DisplaySharedEntry }) {
  const { IAMService, token, doEncrypt } = useKadsAuth();
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState(entry.counsellorNotes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function saveCounsellorNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !note.trim()) return;
    setSaving(true);
    setError("");
    try {
      const [encrypted] = await doEncrypt([{ data: note.trim(), tags: [COUNSELLOR_NOTE_TAG] }]);
      const saved = await apiRequest<CounsellorNote>(
        IAMService.secureFetch.bind(IAMService),
        token,
        `/api/counsellor/entries/${encodeURIComponent(entry.id)}/notes`,
        { method: "POST", body: JSON.stringify({ encryptedContent: encodeCiphertext(encrypted) }) },
      );
      setNotes((current) => [{ ...saved, content: note.trim() }, ...current]);
      setNote("");
    } catch (err) {
      setError(errorMessage(err, "Could not save your private counsellor note."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="entry-card" key={entry.id}>
      <div className="entry-card-heading">
        <p className="entry-date">From {entry.ownerName} · {formatDate(entry.createdAt)}</p>
        <span className="status-pill status-shared">Shared with you</span>
      </div>
      {entry.decryptionError
        ? <ErrorNotice message={entry.decryptionError} />
        : <p className="entry-content">{entry.content}</p>}
      {entry.auditError && <p className="warning-notice" role="status">{entry.auditError}</p>}
      {!entry.decryptionError && (
        <div className="counsellor-notes">
          <p className="eyebrow">Your private notes</p>
          <p className="muted small">Encrypted to your Tide identity. The student and KADS administrators cannot read these notes.</p>
          {entry.privateNotesError && <ErrorNotice message={entry.privateNotesError} />}
          {notes.map((privateNote) => (
            <div className="private-note" key={privateNote.id}>
              <p>{privateNote.content}</p>
              <span className="muted small">{formatDate(privateNote.createdAt)}</span>
            </div>
          ))}
          <form className="counsellor-note-form" onSubmit={saveCounsellorNote}>
            <label htmlFor={`counsellor-note-${entry.id}`}>Add a private note</label>
            <textarea
              id={`counsellor-note-${entry.id}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={5000}
              placeholder="For your own follow-up..."
              required
            />
            {error && <ErrorNotice message={error} />}
            <button className="button button-quiet" disabled={saving || !note.trim()}>
              {saving ? "Encrypting..." : "Save private note"}
            </button>
          </form>
        </div>
      )}
    </article>
  );
}

function AdminDashboard() {
  const { IAMService, token, hasClientRole, mode } = useKadsAuth();
  const [entries, setEntries] = useState<EntryMetadata[]>([]);
  const [requests, setRequests] = useState<ShareRequest[]>([]);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState("");
  const [error, setError] = useState("");
  const canSignPolicies = hasClientRole("tide-realm-admin", "realm-management");

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [metadata, queue] = await Promise.all([
        apiRequest<EntryMetadata[]>(IAMService.secureFetch.bind(IAMService), token, "/api/admin/entries"),
        apiRequest<{ requests: ShareRequest[]; vendorId: string | null }>(
          IAMService.secureFetch.bind(IAMService),
          token,
          "/api/admin/share-requests",
        ),
      ]);
      setEntries(metadata);
      setRequests(queue.requests);
      setVendorId(queue.vendorId);
    } catch (err) {
      setError(errorMessage(err, "Could not load administrator data."));
    } finally {
      setLoading(false);
    }
  }, [IAMService, token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function approveRequest(request: ShareRequest) {
    if (!token || !vendorId) {
      setError("The exported Tide adapter must include vendorId before a share can be approved.");
      return;
    }
    setApprovingId(request.id);
    setError("");
    try {
      const adminPolicy = mode === "demo"
        ? new Uint8Array([1])
        : base64ToBytes((await apiRequest<{ policy: string }>(
          IAMService.secureFetch.bind(IAMService),
          token,
          "/api/admin/relationship-admin-policy",
        )).policy);
      const ownerPolicyB64 = await signRelationshipPolicy({
        vendorId: mode === "demo" ? "kads-demo-vendor" : vendorId,
        subject: { type: "User", id: request.ownerTideUserKey },
        recordId: request.entryId,
        access: "read-write",
      }, adminPolicy);
      const counsellorPolicyB64 = await signRelationshipPolicy({
        vendorId: mode === "demo" ? "kads-demo-vendor" : vendorId,
        subject: { type: "User", id: request.counsellorTideUserKey },
        recordId: request.entryId,
        access: "read",
        expiry: Math.floor(Date.parse(request.expiresAt) / 1000),
      }, adminPolicy);
      await apiRequest(
        IAMService.secureFetch.bind(IAMService),
        token,
        `/api/admin/share-requests/${encodeURIComponent(request.id)}/approve`,
        {
          method: "POST",
          body: JSON.stringify({ ownerPolicyB64, counsellorPolicyB64 }),
        },
      );
      await loadData();
    } catch (err) {
      setError(errorMessage(err, "Could not approve this share. Check the Tide realm and policy roles."));
    } finally {
      setApprovingId("");
    }
  }

  return (
    <section className="dashboard-grid">
      <div className="page-heading">
        <p className="eyebrow">Administration</p>
        <h1>Privacy governance.</h1>
        <p className="muted">Account and sharing metadata only. KADS does not decrypt notes for administrators.</p>
      </div>
      <div className="privacy-banner">
        <span className="privacy-icon" aria-hidden="true">◇</span>
        <div>
          <strong>Approvals are explicit</strong>
          <p>Each grant is limited to one entry and one counsellor. Tide policy signing requires the separate realm-management <code>tide-realm-admin</code> role.</p>
        </div>
      </div>
      {error && <ErrorNotice message={error} />}
      <section className="panel">
        <div className="section-heading">
          <div><p className="eyebrow">Governance queue</p><h2>Share requests</h2></div>
          <button className="button button-quiet" onClick={() => void loadData()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {loading ? <p className="muted">Loading requests...</p> : requests.length === 0 ? (
          <p className="empty-state">No pending share requests.</p>
        ) : (
          <div className="request-list">
            {requests.map((request) => (
              <article className="request-card" key={request.id}>
                <div>
                  <p className="eyebrow">One-entry request</p>
                  <h3>{request.ownerName} → {request.counsellorName}</h3>
                  <p className="muted small">Entry <code>{request.entryId}</code> · expires {formatDate(request.expiresAt)}</p>
                </div>
                <button
                  className="button button-primary"
                  onClick={() => void approveRequest(request)}
                  disabled={approvingId === request.id || !canSignPolicies || !vendorId}
                  title={!canSignPolicies ? "Requires the tide-realm-admin client role" : undefined}
                >
                  {approvingId === request.id ? "Signing policies..." : "Review and approve"}
                </button>
              </article>
            ))}
          </div>
        )}
        {!canSignPolicies && requests.length > 0 && (
          <p className="warning-notice">You can review requests, but signing requires the Tide realm administrator role.</p>
        )}
      </section>
      <section className="panel">
        <div className="section-heading">
          <div><p className="eyebrow">Metadata only</p><h2>Entries in KADS</h2></div>
          <span className="status-pill">No note content</span>
        </div>
        {loading ? <p className="muted">Loading metadata...</p> : entries.length === 0 ? (
          <p className="empty-state">No entries have been created.</p>
        ) : (
          <div className="metadata-list">
            {entries.map((entry) => (
              <div className="metadata-row" key={entry.id}>
                <code>{entry.id}</code>
                <span>{formatDate(entry.createdAt)}</span>
                <span className="status-pill">{entry.shareStatus ?? "private"}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return <p className="error-notice" role="alert">{message}</p>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "an unknown time";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function describeAccess(action: string): string {
  if (action === "opened") return "opened this entry";
  if (action === "share-activated") return "shared this entry";
  if (action === "share-revoked") return "revoked sharing";
  return "accessed this entry";
}

export default App;
