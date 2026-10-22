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
| `student` | Write entries, view own entries, request a one-entry share, revoke it | See other students' entries |
| `counsellor` | Read entries a student has shared with them; write private encrypted counsellor notes | Read anything not shared with them, or read another counsellor's private notes |
| `admin` | Review share requests and see entry metadata | **Read entry content** |

## 4. Features

**Prototype features:**
1. Log in with TideCloak, with role-based landing pages
2. Student creates an entry, stored **encrypted**
3. Student requests access for one counsellor; a Tide realm administrator approves the per-entry policy
4. Student revokes access; the current note is returned to the student's private encryption
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

## 7. Tide per-entry sharing model

KADS uses Tide's built-in `RelationshipAttestation:1` contract, not a custom contract. The policy binds a Tide user to one entry ID:

- Notes begin with Tide self-encryption. Plaintext is encrypted in the student's browser.
- A student submits a share request for one counsellor and chooses an expiry (1 hour, 24 hours, or 7 days).
- A separate Tide realm administrator approves two signed policies: read/write for the student and read-only for that counsellor. The student then re-encrypts the entry under the per-entry policy in their browser.
- The server stores only ciphertext and the signed policies. The counsellor API returns ciphertext only while the app share is active and unexpired; the counsellor decrypts in their browser.
- On revocation, the API immediately stops returning the shared entry and the student's browser re-encrypts the current note back to private self-encryption. The signed counsellor policy may still work against a copy already downloaded until its expiry; no system can retract plaintext already seen or copied.

The target ORK must include `RelationshipAttestation:1` (available on ORK `main`, verified 2026-10-16; older deployments may not include it). The target realm also needs IGA and the role `tide-realm-admin` for approvers. A database sharing row or UI state is not cryptographic authorization.

## 8. Setup and test users

Use the Tide relationship-attestation scenario bootstrap instructions before provisioning a realm. Choose hosting before starting TideCloak, confirm the target ORK includes the built-in contract, and configure a licensed realm with IGA. Export the adapter to `client/public/tidecloak.json`; it must include its embedded verification key and `vendorId`. The API rejects tokens unless JWT and DPoP verification both pass.

Create the realm roles `student`, `counsellor`, `admin`, `_tide_wellbeing.selfencrypt`, and `_tide_wellbeing.selfdecrypt`. Also declare the contract roles `_tide_encryptor` and `_tide_decryptor` as realm roles. Grant:

- Students: `student`, private-note self-encrypt/decrypt, and `_tide_encryptor` + `_tide_decryptor` so they can migrate a note to a relationship policy after approval.
- Counsellors: `counsellor`, `_tide_decryptor`, `_tide_counsellor-notes.selfencrypt`, and `_tide_counsellor-notes.selfdecrypt`. Do not grant `_tide_encryptor` unless they need to write shared records.
- Platform administrators: `admin`; the people who approve relationship policies additionally need `tide-realm-admin` on `realm-management`.

Users must sign in once before KADS can create a per-user grant for them. Role changes require IGA approval and a token refresh/sign-in before they take effect.

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

1. Confirm the ORK contract, hosting choice, and Tide realm configuration
2. TideCloak login, IGA roles, and test users
3. Student: write and list self-encrypted entries
4. Admin: approve a per-entry relationship policy
5. Student: re-encrypt the approved entry; counsellor: read it
6. Student: revoke, return the current note to self-encryption, and review access history

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

## 14. Current implementation

- React/Vite client, Express API, and SQLite storage.
- TideCloak login, role-specific student/counsellor/admin views, and browser-side encryption/decryption.
- JWT signature, role, and DPoP proof validation on protected API routes.
- One counsellor share request per entry, admin policy-signing UI, read-only access to student entries, expiry, and student revocation.
- Counsellors can add separate notes encrypted to their own Tide identity; students and admins do not receive or decrypt those notes.
- Admin metadata view excludes note content and ciphertext.
- Student access history records app-reported successful note openings; it is not proof against a malicious client.

For a local prototype, install dependencies in `client/` and `server/`, and run `npm run dev` in each directory. The server's development script defaults to simulated demo auth until explicitly disabled; the demo API binds only to localhost. Demo mode uses mock role headers and a public client-side encryption key; never enter real wellbeing data. This is not TideCloak authentication or encryption.

For TideCloak mode, export the adapter JSON from the intended realm and install it with `node scripts/install-tidecloak-adapter.mjs <export-file> <expected-realm>`. The scaffold checks the realm name, client, embedded verification key, and `vendorId`, then copies the export to the ignored `client/public/tidecloak.json` path. Set `VITE_AUTH_MODE=tide` for the client and `ENABLE_DEMO_AUTH=false` for the server. No live adapter export is present in this repository, so the realm cannot yet be verified. Never commit deployment credentials or secrets.

The Vite development and preview servers include Tide's DPoP relay route and required headers. Production hosting must provide the matching `/tide_dpop/:path*` rewrite and relay headers. Exercise the full login, grant, re-encryption, counsellor decryption, and revoke flow against the target TideCloak/ORK before using real wellbeing data.

"YOU NEED TO HAVE BACKGROUUND SHELL RUNNING FOR IT TO WORK"
