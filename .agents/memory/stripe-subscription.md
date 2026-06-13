---
name: Stripe subscription architecture
description: How the Stripe payment and subscription flow is wired in Sumsuma
---

## Top-up (one-time)
- Server creates PaymentIntent with `payment_method_types: ['card']` (not automatic_payment_methods)
- Client uses PaymentElement with deferred intent creation (mode='payment', no clientSecret on mount)
- On "Pay": elements.submit() → POST /api/payments/create-intent → stripe.confirmPayment({ redirect: 'if_required' })
- Idempotency key: optional caller-supplied key (no Date.now() — that was a bug)

## Subscription
- Server: getOrCreateCustomer → stripe_customers/{userId} in Firestore
- SetupIntent flow: POST /api/payments/setup-intent → PaymentElement → confirmSetup → POST /api/payments/subscribe
- Webhook syncs subscription state to Firestore (authoritative source, not client)
- Plan price ID set via EXPO_PUBLIC_STRIPE_PREMIUM_PRICE_ID env var (must match Stripe Dashboard)
- SubscriptionScreen.tsx → navigated from Profile > "Manage Plan"

**Why:** Payment status must never be trusted from client — only webhook events update wallet/subscription state.

**How to apply:** Any new payment feature must go through webhook handlers, not client-side confirmation results.
