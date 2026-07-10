---
name: Production API base URL must be relative on web
description: Why the deployed (published) app showed "Error/Retry" on every screen after publishing, and how it was fixed.
---

The unified Expo-web + Express server serves the frontend and API from the same origin in both dev and production. The frontend read `EXPO_PUBLIC_API_BASE_URL` from a **shared** (not per-environment) env var, which had been set to the dev preview's `*.replit.dev` domain. Expo inlines env vars at build time, so the production web build baked in a request target of the dev domain instead of its own production origin — every API call from the published app failed, surfacing as generic "Error / Retry" on all screens (admin dashboards included).

**Why:** `EXPO_PUBLIC_*` vars are compiled into the JS bundle at build time; a "shared" env var value from dev leaks into prod builds unless the code defaults to something environment-relative.

**How to apply:** `src/services/api.ts` now defaults `API_BASE_URL` to `window.location.origin` on web when no explicit `EXPO_PUBLIC_API_BASE_URL`/`EXPO_PUBLIC_API_URL` override is set (native still falls back to an absolute URL, since there's no origin on-device). Do not reintroduce an absolute dev-domain value into the shared env scope for `EXPO_PUBLIC_API_BASE_URL` — leave it unset unless a genuinely different API host is required. After any fix to this file, the **production deployment must be republished** to rebuild the bundle; restarting the dev workflow does not update the already-published build.
