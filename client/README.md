# Private Wellbeing Notes client

React 18 + Vite client for the TideCloak-backed student wellbeing notes app.

## Requirements

- Node.js 22 LTS (Node.js 18+ is the minimum runtime)
- Local TideCloak realm configured with IGA
- Exported adapter JSON at `public/tidecloak.json`
- Express API running at `http://localhost:4000` (override with `VITE_API_BASE_URL`)

## Run

```bash
npm install
npm run dev
```

The app uses TideCloak login with DPoP, and encrypts private notes in the browser before calling
the API. The Vite dev/preview config serves the Tide DPoP relay at the expected path with its
required headers. Production static hosting must provide the same rewrite and headers.

The counselor screen intentionally does not decrypt entries yet. Per-entry sharing needs Tide's
signed relationship-policy workflow and must be implemented and tested before access is granted.
