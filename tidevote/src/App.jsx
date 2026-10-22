import { useCallback, useEffect, useState } from 'react';
import { useTideCloak } from '@tidecloak/react';
import './App.css';

const EMOJI = { Pizza: '🍕', Sushi: '🍣', Burgers: '🍔' };

function VotingPage() {
  const { token } = useTideCloak(); // token stays in memory (SDK state), never localStorage
  const [poll, setPoll] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const call = useCallback(
    async (path, options = {}) => {
      const res = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      return data;
    },
    [token]
  );

  useEffect(() => {
    if (!token) return;
    call('/api/poll').then(setPoll).catch((e) => setError(e.message));
  }, [token, call]);

  const vote = async (option) => {
    setBusy(true);
    setError('');
    try {
      setPoll(await call('/api/vote', { method: 'POST', body: JSON.stringify({ option }) }));
    } catch (e) {
      setError(e.message);
      // If we were already counted (e.g. voted in another tab), refresh state.
      call('/api/poll').then(setPoll).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  if (!poll) return <p className="muted">{error || 'Loading poll…'}</p>;

  return (
    <section className="card">
      <h2>{poll.question}</h2>
      {error && <p className="error">{error}</p>}

      {!poll.hasVoted ? (
        <div className="options">
          {poll.options.map((o) => (
            <button key={o} className="option" disabled={busy} onClick={() => vote(o)}>
              <span className="emoji">{EMOJI[o]}</span> {o}
            </button>
          ))}
        </div>
      ) : (
        <>
          <p className="muted">
            You voted for <strong>{poll.myVote}</strong>. Total votes: <strong>{poll.total}</strong>
          </p>
          {poll.options.map((o) => {
            const n = poll.results[o] || 0;
            const pct = poll.total ? Math.round((n / poll.total) * 100) : 0;
            return (
              <div key={o} className="result">
                <div className="result-head">
                  <span>{EMOJI[o]} {o}</span>
                  <span>{n} ({pct}%)</span>
                </div>
                <div className="bar"><div className="fill" style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

export default function App() {
  const { authenticated, isInitializing, initError, login, logout, getValueFromIdToken } =
    useTideCloak();

  let username = '';
  try { username = getValueFromIdToken('preferred_username') || ''; } catch { /* optional */ }

  return (
    <div className="page">
      <header className="nav">
        <span className="brand">🗳️ TideVote</span>
        {authenticated && (
          <div className="nav-right">
            {username && <span className="muted">{username}</span>}
            <button className="btn ghost" onClick={logout}>Log out</button>
          </div>
        )}
      </header>

      <main>
        {isInitializing ? (
          <p className="muted">Connecting to TideCloak…</p>
        ) : initError ? (
          <p className="error">TideCloak error: {String(initError.message || initError)}</p>
        ) : authenticated ? (
          <VotingPage />
        ) : (
          <section className="hero">
            <h1>TideVote</h1>
            <p>Secure group voting, signed in with TideCloak.</p>
            <button className="btn" onClick={login}>Log in to vote</button>
            <p className="note">
              Small group-voting prototype — not a production election system.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
