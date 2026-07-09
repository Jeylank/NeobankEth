---
name: Admin data aggregation pattern
description: How admin screens (Transfers, Users) pull cross-collection Firestore data without composite indexes, and the auth/rate-limit conventions they share.
---

Admin read screens (Transfers, Users, Dashboard) follow the same recipe:

- Query each Firestore collection filtered on a single field only (e.g. `where('userId', '==', uid)`), then sort/aggregate/filter further in memory. This avoids needing to provision Firestore composite indexes for every admin query shape.
- Auth: a local `requireAdminOrApiKey` middleware (duplicated per route file) accepts either a Firebase admin ID token or an `X-API-Key` header, so both the real admin UI and QA/simulation scripts can hit the same endpoints.
- Rate limiting: reads use `readLimiter`, writes/destructive actions use `writeLimiter`/stricter limiter from `server/middleware/rateLimiter.ts`.
- Free-text search over Firebase Auth users has no native substring query — exact uid/email get a fast path via `adminAuth.getUser`/`getUserByEmail`; anything else falls back to a bounded `listUsers` scan (capped, e.g. 2000 users) filtered in memory. This is fine at current scale but will need a real search index (e.g. Algolia/Typesense or a Firestore-mirrored search collection) if the user base grows large.

**Why:** Composite indexes require manual Firestore console setup per query shape, which doesn't fit a fast-iteration QA/simulation workflow; in-memory filtering keeps admin endpoints deployable without extra Firebase console steps.

**How to apply:** When adding a new admin aggregation endpoint (e.g. a future "Admin Campaigns" or "Admin Agents" screen), reuse this same pattern: single-field `where` filters, in-memory sort/aggregate, and the `requireAdminOrApiKey` + rate-limiter combo already used in `adminTransfers.ts`, `adminUsers.ts`, and `dashboard.ts`.

**Unified audit trail (multi-source normalization):** The Audit Logs screen (`auditLogService.ts`) extends this pattern one step further — it merges events from several *different-shaped* collections (transactions, timeline entries, KYC docs, admin action logs, plus a new `login_events` collection) into one normalized `{id, type, timestamp, userId, actorId, description, metadata}` shape, then sorts/filters/paginates the merged array in memory. Some sources (e.g. `transfer_timeline`) don't carry `userId` directly — resolve it by joining against the owning collection (e.g. `sim_transactions.txId`) only for the rows that need it, not eagerly for every row. Firebase Auth has no built-in login history, so login events must be explicitly logged by the client calling a dedicated endpoint right after sign-in succeeds — don't assume it exists already.
