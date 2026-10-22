# Private Wellbeing Notes client

React 18 + Vite client for the TideCloak-backed student wellbeing notes app.

## Local demo mode

During Vite development, the client and API default to simulated authentication when no live
TideCloak export is configured. The login screen lets you choose a student, counsellor, or admin
demo identity. The API and Vite development/preview servers bind to `localhost`.

## Run

```bash
npm install
npm run dev
```

Demo mode uses mock role headers and a public, hardcoded browser encryption key. It is only for
exercising the prototype flow: never enter real wellbeing data or expose this API publicly.

### Demo a shared entry

1. As the student, save a note and choose **Share this entry** on its card.
2. Choose **Sam Taylor** and submit the time-limited request.
3. Switch the demo role to **Admin**, open the pending request, and approve it.
4. Switch back to **Student** and refresh the journal. This finishes the demo re-encryption step.
5. Switch to **Counsellor** and refresh **Shared entries** to read the note.

The demo server seeds these three local identities so the share flow is available immediately.
The real TideCloak flow requires real accounts and realm policies; demo approval is simulated.

## TideCloak mode

Use Node.js 22 LTS (Node.js 18+ minimum), a configured TideCloak realm with IGA, the Express API,
and an adapter export at `public/tidecloak.json`. Install an export with
`node ../scripts/install-tidecloak-adapter.mjs <export-file> <expected-realm>` from the client
directory (or use the repository-root path shown in the main README). The installer requires the
realm name as an explicit check and verifies the embedded key and `vendorId`.
The API defaults to `localhost:4000` (override with `VITE_API_BASE_URL`). Set `VITE_AUTH_MODE=tide`
in the client environment and `ENABLE_DEMO_AUTH=false` in the server environment.

The app uses TideCloak login with DPoP and encrypts private notes in the browser before calling
the API. Sharing uses Tide's built-in `RelationshipAttestation:1` contract: the student requests
one counsellor, a Tide realm administrator signs per-entry policies, and the student re-encrypts
the entry in their browser before the counsellor can read it. Share expiry is limited to 1 hour,
24 hours, or 7 days.

The API stores ciphertext and signed policies only. Revocation immediately blocks future delivery
through KADS and the student's browser re-encrypts the current entry to the student's private key.
A counsellor who already downloaded ciphertext may retain the ability to decrypt that copy until
the signed policy expires; plaintext already seen cannot be recalled. The access history records
app-reported successful openings, not an independently verifiable proof of reading.

## Tide realm requirements

- The configured ORK network must include `RelationshipAttestation:1`.
- IGA must be enabled; an approver needs `tide-realm-admin` on `realm-management`.
- Students need `student`, `_tide_wellbeing.selfencrypt`, `_tide_wellbeing.selfdecrypt`,
  `_tide_encryptor`, and `_tide_decryptor`.
- Counsellors need `counsellor` and `_tide_decryptor`.
- For counsellor-authored private notes, also grant `_tide_counsellor-notes.selfencrypt` and
  `_tide_counsellor-notes.selfdecrypt`.
- Platform admins need `admin`; only the realm approvers need the separate `tide-realm-admin` role.
- Each student and counsellor must sign in once so KADS can associate their Tide user key with the
  account. Role grants take effect after approval and a token refresh/sign-in.
- Export `public/tidecloak.json` with the embedded verification key and `vendorId`. Do not commit
  deployment credentials or secrets.
- There is currently no adapter export in this repository, so its realm/client/issuer cannot yet
  be verified against the intended TideCloak realm.

The Vite dev/preview config serves the Tide DPoP relay with its required headers. Production static
hosting must provide the same rewrite and headers. End-to-end policy signing and decryption must be
tested against the target realm before using real wellbeing data.
