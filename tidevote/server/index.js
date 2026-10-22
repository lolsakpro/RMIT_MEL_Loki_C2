// TideVote backend: Express + SQLite + TideCloak token verification.
const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { verifyTideCloakToken } = require('@tidecloak/verify');

// Reuse the SAME tidecloak.json your React app already uses (project root).
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'tidecloak.json'), 'utf8')
);

const PORT = process.env.PORT || 3001;

// One fixed poll. Options are a server-side whitelist.
const POLL = {
  id: 'dinner-1',
  question: 'Where should we eat tonight?',
  options: ['Pizza', 'Sushi', 'Burgers'],
};

const db = new Database(path.join(__dirname, 'votes.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS votes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id    TEXT NOT NULL,
    voter_id   TEXT NOT NULL,
    option     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (poll_id, voter_id)   -- one vote per account per poll, enforced by the DB
  )
`);

const insertVote = db.prepare(
  'INSERT INTO votes (poll_id, voter_id, option) VALUES (?, ?, ?)'
);
const findVote = db.prepare(
  'SELECT option FROM votes WHERE poll_id = ? AND voter_id = ?'
);
const countVotes = db.prepare(
  'SELECT option, COUNT(*) AS n FROM votes WHERE poll_id = ? GROUP BY option'
);

function getResults() {
  const results = Object.fromEntries(POLL.options.map((o) => [o, 0]));
  for (const row of countVotes.all(POLL.id)) {
    if (row.option in results) results[row.option] = row.n;
  }
  const total = Object.values(results).reduce((a, b) => a + b, 0);
  return { results, total };
}

// Verify the TideCloak access token; voter identity comes ONLY from the verified token.
async function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  try {
    const payload = await verifyTideCloakToken(config, token);
    if (!payload || !payload.sub) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.voterId = payload.sub; // never read from body/query/headers
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

const app = express();
app.use(express.json({ limit: '1kb' }));

// Protected: poll info. Results are only returned after the caller has voted.
app.get('/api/poll', requireAuth, (req, res) => {
  const mine = findVote.get(POLL.id, req.voterId);
  const body = {
    id: POLL.id,
    question: POLL.question,
    options: POLL.options,
    hasVoted: !!mine,
  };
  if (mine) {
    body.myVote = mine.option;
    Object.assign(body, getResults());
  }
  res.json(body);
});

// Protected: cast a vote. There is deliberately no update/delete endpoint.
app.post('/api/vote', requireAuth, (req, res) => {
  const option = req.body && req.body.option;
  if (typeof option !== 'string' || !POLL.options.includes(option)) {
    return res.status(400).json({ error: 'Invalid option' });
  }
  try {
    insertVote.run(POLL.id, req.voterId, option); // voter id from verified token
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'You have already voted' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
  res.status(201).json({
    id: POLL.id,
    question: POLL.question,
    options: POLL.options,
    hasVoted: true,
    myVote: option,
    ...getResults(),
  });
});

app.listen(PORT, () => console.log(`TideVote API on http://localhost:${PORT}`));
