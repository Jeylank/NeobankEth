---
name: Stripe API version
description: Which Stripe API version to use and why
---

Pin to `'2025-01-27.acacia'` (stable Acacia release, default for SDK v20.x).

**Why:** `'2026-02-25.clover'` was a future preview/beta version — caused potential instability and broke type safety.

**How to apply:** Any new Stripe client instantiation in stripeClient.ts must use `'2025-01-27.acacia'` or let the SDK default (do not use `.clover` or `.acacia` preview channels).
