# TideVote – Secure Group Voting

RMIT Hackathon 2026 · Challenge 2: TIDE Unlocked – Vibe Coding

TideVote is a small group-voting web app. Users sign in with **TideCloak**, then cast **one vote** in a single fixed poll: *"Where should we eat tonight?"* (Pizza, Sushi, Burgers). After voting they see total votes and results as progress bars.

> **Prototype notice:** TideVote is a small group-voting prototype. It is **not** a production election system.

## Stack
- Frontend: React + Vite + `@tidecloak/react`
- Backend: Node.js + Express + SQLite (`better-sqlite3`) + `@tidecloak/verify`
- Identity: local TideCloak server (Docker)

## Security features
- **Real TideCloak login/logout** via the official React SDK. No fake login.
- **Tokens are not stored in localStorage.** The access token lives in the SDK's in-memory state and is sent as `Authorization: Bearer`.
- **Backend verifies every token** (signature, issuer, authorized party) with `verifyTideCloakToken` using the existing `tidecloak.json`, before returning or accepting any poll data.
- **Voter ID comes from the verified token** (`sub`), never from a request field. Any `voterId` in a request body is ignored.
- **One vote per account**, enforced by `UNIQUE (poll_id, voter_id)` in SQLite; a duplicate returns HTTP 409.
- **No way to change another user's vote:** there is no update or delete endpoint, and inserts only ever use the caller's own verified ID.
- **Server-side option whitelist** and a 1 KB request body limit.
- **Results are only returned to users who have already voted.**

## Limitations (honest scope)
- TideCloak authenticates users; it does **not** automatically prevent database tampering. Anyone with access to `server/votes.db` or the server process can edit votes.
- The backend and database are a trusted central component.
- Votes are **not anonymous**: the database links each voter ID to their choice.
- One vote per *account*, not per person; anyone able to create accounts could vote more than once.
- No rate limiting, audit log, HTTPS or backups.

## Run locally
1. Start TideCloak in Docker and keep `tidecloak.json` in the project root (the same file used by the frontend).
2. Backend (terminal 1):
   ```
   cd server
   npm install
   npm start
   ```
3. Frontend (terminal 2, project root):
   ```
   npm install
   npm run dev
   ```
4. Open http://localhost:5173

## Test with two accounts
1. Log in as User A, vote, confirm results appear, reload and confirm you can't vote again.
2. Log out, log in as User B in the same browser (or a private window), vote, and confirm totals now show 2.
3. Try an API call without a token: `curl http://localhost:3001/api/poll` should return 401.
4. Try a duplicate vote (e.g. second tab) and confirm a 409 "already voted" error.
