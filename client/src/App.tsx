import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Authenticated,
  Unauthenticated,
  useAuthCallback,
  useTideCloak,
} from "@tidecloak/react";
import { apiRequest } from "./lib/api";
import {
  decodeCiphertext,
  encodeCiphertext,
  WELLBEING_TAG,
} from "./lib/encryption";
import type { AccessEvent, Entry, EntryMetadata } from "./lib/types";

function App() {
  const { isInitializing } = useTideCloak();
  const { isCallback, isProcessing, error: callbackError } = useAuthCallback({
    onSuccess: (returnUrl) => {
      window.location.assign(returnUrl || "/");
    },
    onMissingVerifierRedirectTo: "/",
  });

  if (isCallback) {
    if (callbackError) {
      return <main className="center-screen"><ErrorNotice message={callbackError.message} /></main>;
    }
    return <main className="center-screen"><p>{isProcessing ? "Completing secure sign-in..." : "Finishing sign-in..."}</p></main>;
  }

  if (isInitializing) {
    return <main className="center-screen"><p>Connecting to TideCloak...</p></main>;
  }

  return (
    <>
      <Authenticated><RoleDashboard /></Authenticated>
      <Unauthenticated><LoginPage /></Unauthenticated>
    </>
  );
}

function LoginPage() {
  const { login } = useTideCloak();

  return (
    <main className="login-screen">
      <section className="login-card">
        <p className="eyebrow">RMIT student support</p>
        <h1>A private space to check in with yourself.</h1>
        <p className="muted">
          Your wellbeing notes are encrypted in your browser. Sign in with TideCloak to continue.
        </p>
        <button className="button button-primary" onClick={login}>Sign in securely</button>
        <p className="privacy-note">Only you can read your notes until a secure sharing policy is approved.</p>
      </section>
    </main>
  );
}

function RoleDashboard() {
  const { hasRealmRole, logout, getValueFromIdToken } = useTideCloak();
  const displayName = getValueFromIdToken("preferred_username");

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Private Wellbeing Notes home">
          <span className="brand-mark">W</span>
          <span>Wellbeing Notes</span>
        </a>
        <div className="account-menu">
          <span className="account-name">{typeof displayName === "string" ? displayName : "Signed in"}</span>
          <button className="button button-quiet" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="content">
        {hasRealmRole("student") && <StudentDashboard />}
        {hasRealmRole("counsellor") && <CounsellorDashboard />}
        {hasRealmRole("admin") && <AdminDashboard />}
        {!hasRealmRole("student") && !hasRealmRole("counsellor") && !hasRealmRole("admin") && (
          <section className="panel">
            <h1>Your account needs a role</h1>
            <p className="muted">Ask the TideCloak administrator to assign your student, counsellor, or admin role.</p>
          </section>
        )}
      </main>
    </div>
  );
}

function StudentDashboard() {
  const { doEncrypt, doDecrypt, IAMService, token } = useTideCloak();
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadEntries = useCallback(async () => {
    if (!token) return;
    setError("");
    setLoading(true);
    try {
      const stored = await apiRequest<Entry[]>(IAMService.secureFetch.bind(IAMService), token, "/api/entries");
      if (stored.length === 0) {
        setEntries([]);
        return;
      }
      const decrypted = await doDecrypt(stored.map((entry) => ({
        encrypted: decodeCiphertext(entry.encryptedContent),
        tags: [WELLBEING_TAG],
      })));
      setEntries(stored.map((entry, index) => ({
        ...entry,
        content: typeof decrypted[index] === "string"
          ? decrypted[index] as string
          : new TextDecoder().decode(decrypted[index] as Uint8Array),
      })));
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

  return (
    <section className="dashboard-grid">
      <div className="page-heading">
        <p className="eyebrow">Your private journal</p>
        <h1>How are you feeling?</h1>
        <p className="muted">Write what is on your mind. The server receives only encrypted content.</p>
      </div>

      <form className="panel compose-panel" onSubmit={saveEntry}>
        <label htmlFor="note-content">A note for yourself</label>
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

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Your notes</h2>
            <p className="muted">Only your account can decrypt these entries.</p>
          </div>
          <button className="button button-quiet" onClick={() => void loadEntries()} disabled={loading}>
            Refresh
          </button>
        </div>
        {error && <ErrorNotice message={error} />}
        {loading ? <p className="muted">Loading encrypted notes...</p> : entries.length === 0 ? (
          <p className="empty-state">Your private journal is empty. Add a note whenever you are ready.</p>
        ) : (
          <div className="entry-list">
            {entries.map((entry) => <EntryCard entry={entry} key={entry.id} />)}
          </div>
        )}
      </section>

      <section className="sharing-notice">
        <strong>Sharing is not enabled yet.</strong>
        <span>
          Counsellor access needs a Tide-signed, per-entry policy. Until that workflow is set up,
          these notes remain private and no counsellor can decrypt them.
        </span>
      </section>
    </section>
  );
}

function EntryCard({ entry }: { entry: Entry }) {
  const { IAMService, token, getValueFromIdToken } = useTideCloak();
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

  return (
    <article className="entry-card">
      <p className="entry-date">{formatDate(entry.createdAt)}</p>
      <p className="entry-content">{entry.content}</p>
      <details className="entry-audit" onToggle={(event) => {
        if (event.currentTarget.open) void loadAccessLog();
      }}>
        <summary>Access log</summary>
        {error && <ErrorNotice message={error} />}
        {events === null && !error ? <p className="muted small">Loading access history...</p> : null}
        {events?.length === 0 && <p className="muted small">No access events recorded yet.</p>}
        {events?.map((event, index) => (
          <p className="audit-event" key={`${event.occurredAt}-${index}`}>
            {event.actorSub === currentUserSub ? "You" : "Another authenticated user"} · {describeAccess(event.action)} · {formatDate(event.occurredAt)}
          </p>
        ))}
      </details>
    </article>
  );
}

function CounsellorDashboard() {
  return (
    <section className="panel">
      <p className="eyebrow">Counsellor workspace</p>
      <h1>Shared notes</h1>
      <p className="muted">
        No shared notes are available. Per-entry Tide policies must be configured before this view
        can grant access to student content.
      </p>
    </section>
  );
}

function AdminDashboard() {
  const { IAMService, token } = useTideCloak();
  const [entries, setEntries] = useState<EntryMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadMetadata = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      setEntries(await apiRequest<EntryMetadata[]>(
        IAMService.secureFetch.bind(IAMService),
        token,
        "/api/admin/entries",
      ));
    } catch (err) {
      setError(errorMessage(err, "Could not load entry metadata."));
    } finally {
      setLoading(false);
    }
  }, [IAMService, token]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  return (
    <section className="panel">
      <p className="eyebrow">Administration</p>
      <h1>Entry metadata</h1>
      <p className="muted">This view intentionally excludes note content and ciphertext.</p>
      {error && <ErrorNotice message={error} />}
      {loading ? <p className="muted">Loading metadata...</p> : entries.length === 0 ? (
        <p className="empty-state">No entries have been created.</p>
      ) : (
        <div className="metadata-list">
          {entries.map((entry) => (
            <div className="metadata-row" key={entry.id}>
              <code>{entry.id}</code>
              <span>{formatDate(entry.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return <p className="error-notice" role="alert">{message}</p>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function describeAccess(action: string): string {
  if (action === "owner-read-ciphertext") return "viewed this private entry";
  if (action === "owner-viewed-access-log") return "opened this access log";
  return "accessed this entry";
}

export default App;
