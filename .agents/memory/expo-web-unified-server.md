---
name: Expo web build & unified server
description: How the Expo web app and Admin API are served together from port 5000
---

## Architecture
- Single workflow "Start application" runs `npm run server:admin` on port 5000 (webview type)
- `server/index.ts` serves `dist/` (built Expo web bundle) as static files AFTER mounting all `/api/*` routes
- SPA fallback: non-API 404s send `dist/index.html` so React Navigation deep-links work
- API status page moved from `GET /` to `GET /api-docs`
- `dist/` is built by running: `npx expo export --platform web` (outputs to `dist/`)

## Build cadence
- `dist/` persists across server restarts — no rebuild needed unless frontend code changes
- To rebuild: run `npx expo export --platform web` in the shell, then restart the workflow
- Do NOT include the build step in the workflow command — the build takes ~90s and the workflow times out waiting for port 5000

**Why:** Only port 5000 can be a webview in Replit. Running build + server in one workflow command exceeds the port-open timeout.

**How to apply:** Keep workflow command as just `npm run server:admin`. Rebuild dist manually when frontend changes are made.
