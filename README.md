# RMIT_MEL_Loki_C2
rmit hackathon challenge 2 (vibecode an app with TideCloak)

# RMIT_MEL_Loki_C2: Private Wellbeing Notes (TideCloak)

> **For GitHub Copilot and teammates:** read this whole file before writing any code. It explains what we are building, how we are building it, and which tools to use. If something here conflicts with a guess you were about to make, follow this file.

## 1. What we are building

A web app where students can write **private wellbeing notes** (for example: "I'm struggling with the workload in my unit"). The notes are **encrypted**, so even the system admin or someone who breaks into the database cannot read them. A student can **choose to share** a single entry with a counsellor, and **revoke** that access later.

**The pitch in one line:** nobody can read a student's notes unless the student lets them, not even us.

**Why not just email a lecturer?** Email is a copy you lose control of. Our app is a private record the student owns: encrypted storage, per-entry sharing, revoking access, and an access log.

## 2. Hackathon requirement

The app **must be built with TideCloak** (Tide Foundation's identity, access and encryption system, built on top of Keycloak). The demo should clearly show TideCloak doing real work: login, roles, and encryption. It should not be just a login bolted on.

## 3. Roles

| Role | Can do | Cannot do |
|------|--------|-----------|
| `student` | Write entries, view own entries, share/revoke an entry with a counsellor | See other students' entries |
| `counsellor` | Read entries a student has shared with them, add their own notes | Read anything not shared with them |
| `admin` | Manage accounts, see that entries exist (metadata only) | **Read entry content (key demo moment)** |

## 4. Features

**Minimum version (build this first):**
1. Log in with TideCloak, with role-based landing pages
2. Student creates an entry, stored **encrypted**
3. Student shares an entry with a counsellor
4. Student revokes access
5. Access log, e.g. "Counsellor X viewed this entry on Tuesday"

**Nice to have (only if time allows):**
- Counsellor "request access" flow that the student approves
- Urgent flag
- Mood check-in chart

## 5. Tech stack

- **Frontend:** React 18 + Vite + TypeScript
- **Auth and encryption:** TideCloak, via the `@tidecloak/react` SDK
- **Backend:** Node.js + Express (keep it simple)
- **Storage:** SQLite or a JSON file (hackathon scale)

> If the team changes the stack, update this section so Copilot stays in sync.

## 6. Using the TideCloak MCP in VS Code

We have the **TideCloak MCP server** (Tide's MCP, also referred to as Raziel) installed in VS Code. **Use it instead of guessing.**

**Rules for Copilot:**
- Use **Agent mode** in Copilot Chat, since MCP tools are only available there.
- Before answering any question about TideCloak setup, configuration, realms, clients, roles, the SDK, or encryption, **first check which MCP tools are available and use them**. Do not invent TideCloak APIs, config fields or function names from memory.
- If the MCP cannot answer something, say so clearly rather than making up code. Then point to the official docs: https://github.com/tide-foundation/tidecloak-gettingstarted
- When the MCP and this README disagree, **trust the MCP and tell the team** so we can update this file.

**For teammates, if the MCP is not working:**
1. Open the Command Palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows)
2. Run **MCP: List Servers** and check the TideCloak server is listed and **started**
3. If it is stopped, start or restart it from that list
4. Open Copilot Chat, switch to **Agent mode**, and check the tools icon shows the TideCloak tools

## 7. Setup (do these in order)

### Step 1: Run TideCloak locally (needs Docker Desktop)
Follow the official guide: https://github.com/tide-foundation/tidecloak-gettingstarted

In short: run the `tideorg/tidecloak-dev:latest` Docker image, open the admin console at `http://localhost:8080`, and activate your TideCloak license in the Tide identity provider settings.

> **One teammate does this first and writes the exact commands they used below**, so the others can copy them.

```
(paste the working commands here)
```

### Step 2: Create the React app

```bash
npm create vite@latest tidecloak-react -- --template react-ts
cd tidecloak-react
npm install @tidecloak/react
```

Export your realm/client settings from the TideCloak admin console as `tidecloak.json`, then wrap the app with `TideCloakContextProvider`:

```tsx
import { TideCloakContextProvider } from '@tidecloak/react'
import tidecloakConfig from '../tidecloak.json'
```

Use the `Authenticated` and `Unauthenticated` components and the `useTideCloak` hook for login state.

### Step 3: Create roles and test users
In the TideCloak admin console, create the roles `student`, `counsellor`, `admin`, then create one test user per role for demos.

### Step 4: Encryption
The SDK exposes `doEncrypt(data)` and `doDecrypt(data)`. Encrypting a string returns something that decrypts back to a string.

Flow:
1. Student types an entry
2. App calls `doEncrypt`, and only scrambled data leaves the browser
3. Backend stores the encrypted data
4. App calls `doDecrypt` when reading it

### Step 5: Backend
A small Express server that only stores and returns **encrypted** entries, plus a table of "entry X is shared with counsellor Y" and an access log. **The backend must never see plaintext notes.**

## 8. Open risk: per-entry sharing (test this on day one)

We have confirmed encrypt and decrypt exist, but we have **not confirmed** whether a counsellor can decrypt an entry a student encrypted. Test this first:

1. Log in as a student, encrypt a test string
2. Log in as a counsellor, try to decrypt it
3. Record the result here:

```
(result goes here)
```

**If it fails:** ask the TideCloak MCP how encryption relates to roles/permissions, and check with a mentor. **Fallback:** enforce sharing in our backend (access rules) and be honest in the pitch about what is enforced at the encryption level and what is enforced by our app.

## 9. Suggested folder structure

```
RMIT_MEL_Loki_C2/
├── client/          # React app (Vite)
├── server/          # Express API
├── tidecloak.json   # TideCloak settings (do NOT commit secrets)
└── README.md
```

## 10. Coding rules (for Copilot)

- TypeScript for the frontend; keep components small and named clearly
- Never store or log plaintext note content on the server
- Never hardcode secrets or tokens; use `.env` and keep it out of git
- Check the user's **role** before showing role-specific screens
- Use `px` units in CSS
- Explain new code in plain English with a concrete example when asked

## 11. Build order

1. TideCloak running + React login working (highest risk, do first)
2. Roles and test users
3. Student: write and list entries (encrypted)
4. Counsellor: view shared entries
5. Share and revoke
6. Access log
7. Demo polish

## 12. Team split

| Person | Focus |
|--------|-------|
| 1 | TideCloak setup and login |
| 2 | Student screens |
| 3 | Counsellor and admin screens |
| 4 | Backend, database, demo and slides |

## 13. Git workflow

- One branch per feature: `feature/login`, `feature/student-ui`, and so on
- Open a pull request into `main`; don't push straight to `main`
- Pull before you start: `git pull origin main`
- Pushing over HTTPS needs a **Personal Access Token** as the password (GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → tick `repo`)
- Make sure you have accepted the collaborator invite to `lolsakpro/RMIT_MEL_Loki_C2`

## 14. Demo script (2 minutes)

1. Student logs in and writes an entry
2. Show the database as the admin sees it: **only scrambled data**
3. Student shares the entry, and the counsellor reads it
4. Student revokes access, and the counsellor loses it
5. Show the access log

## 15. Application foundation

The initial implementation is in `client/` and `server/`:

- TideCloak login with role-specific student, counsellor, and admin views
- Students encrypt notes in their browser with the `wellbeing` tag before sending them to the API
- The API verifies the Tide JWT using the adapter's embedded key and requires a valid DPoP proof
- The API stores ciphertext only; a student can list and decrypt only their own entries
- Admins can see entry IDs and timestamps, never ciphertext or note content
- A student-owned access log is available for their entries

**Counsellor sharing and revocation are deliberately not enabled yet.** Tide's verified
`RelationshipAttestation:1` flow requires a signed per-entry policy, `_tide_encryptor` and
`_tide_decryptor` roles, and an admin approval. A backend sharing row by itself would not grant
cryptographic access. Keep notes private until that policy workflow has been configured and tested.

### Run the app after installing Node.js 18+

1. Start local Docker (Docker Desktop or a Docker-compatible runtime such as Colima), then run this
   bootstrap from `client/` in a regular Mac Terminal:

   ```bash
   cp ../.tide-pack/templates/shared/.env.template .env
   # Set KC_BOOTSTRAP_ADMIN_PASSWORD and the previously supplied TIDE_LICENSE_EMAIL /
   # TIDE_TERMS_ACCEPTED=yes in this ignored file.
   ADAPTER_OUTPUT=public/tidecloak.json CLIENT_APP_URL=http://localhost:5173 \
     bash ../.tide-pack/templates/shared/bootstrap-tidecloak.sh
   ```

   The bootstrap needs Docker, curl, and jq. The Tide script uses `sudo` for local data permissions,
   so run it in Terminal and enter your Mac administrator password when prompted. This is not a
   Docker Hub or Node account. It prints an invite link that you must open yourself. Do not put the
   Tide master-admin password in source control or in a shell command.
2. From `client/`, install dependencies and start Vite:

   ```bash
   cd client
   npm install
   npm run dev
   ```

3. In a second terminal, copy `server/.env.example` to `server/.env`, then start the API:

   ```bash
   cd server
   cp .env.example .env
   npm install
   npm run dev
   ```

4. Before logging in, export the Tide adapter to `client/public/tidecloak.json`. The API expects
   this same adapter and rejects requests unless JWT and DPoP verification both pass.
5. Create the `student`, `counsellor`, and `admin` realm roles. For private note encryption, also
   configure `_tide_wellbeing.selfencrypt` and `_tide_wellbeing.selfdecrypt` per the Tide E2EE
   playbook. Do not assign counsellor decryption access until the per-entry sharing policy flow is
   implemented and tested.

The Vite dev and preview servers include the Tide DPoP relay route and its required response
headers. A production static host still needs the matching `/tide_dpop/:path*` rewrite and relay
headers from the Tide DPoP asset guidance.