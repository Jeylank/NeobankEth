---
name: Unmounted route files pattern
description: server/routes/ contains files never wired into server/index.ts; causes silent 404s for features that look implemented
---

Several Express route files in `server/routes/` (e.g. userApi.ts, remittances.ts) existed fully implemented but were never `import`ed or `app.use()`'d in `server/index.ts`. Their endpoints returned the generic `{ error: 'Endpoint not found' }` 404 handler, which looks like a routing bug rather than a missing feature.

**Why:** Easy to assume a route "exists" because the file is present and looks complete; the only way to know it's live is to check `server/index.ts` imports + `app.use()` calls.

**How to apply:** When the client gets "Endpoint not found" for a path, grep `server/index.ts` for the router being imported AND mounted (not just check if a matching route file exists in server/routes/). Also watch for duplicate handlers across files for the same path (e.g. transactions.ts vs userApi.ts both defined GET /transactions) — mount order determines which one wins; prefer the one without `orderBy` (avoids Firestore composite index requirements) as the source of truth.
