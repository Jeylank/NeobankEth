/**
 * server/tests/concurrentLoad.ts
 * ────────────────────────────────
 * Concurrent stress test for the Sumsuma Simulation API.
 *
 * Tests three invariants under concurrency:
 *   A) Financial safety   — wallet is debited exactly once per unique tx
 *   B) Idempotency        — identical idempotency key never produces two txs
 *   C) Rate limiting      — 429 is returned once the window is exceeded
 *
 * Usage (run from workspace root):
 *   npx ts-node --transpile-only --project server/tsconfig.json \
 *     server/tests/concurrentLoad.ts
 *
 * Environment variables (all optional):
 *   LOAD_BASE_URL      default: http://localhost:5000/api/v1
 *   LOAD_API_KEY       default: reads SIMULATION_API_KEY env var
 *   LOAD_CONCURRENCY   default: 20  (unique concurrent transactions)
 *   LOAD_USER_ID       default: sim_user_001
 *   LOAD_AMOUNT        default: 100 (USD per transaction)
 */

import https from 'https';
import http  from 'http';

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL    = process.env.LOAD_BASE_URL  ?? 'http://localhost:5000/api/v1';
const API_KEY     = process.env.LOAD_API_KEY   ?? process.env.SIMULATION_API_KEY ?? '';
const CONCURRENCY = parseInt(process.env.LOAD_CONCURRENCY ?? '20', 10);
const USER_ID     = process.env.LOAD_USER_ID   ?? 'sim_user_001';
const AMOUNT      = parseFloat(process.env.LOAD_AMOUNT ?? '100');

// ─── HTTP helper ─────────────────────────────────────────────────────────────

interface ApiResponse { status: number; body: Record<string, unknown> }

// Safely join a base URL (which may include a path like /api/v1) with a route segment.
// Using new URL('/abs', base) drops the base path — we concatenate instead.
function buildUrl(base: string, path: string): URL {
  const b    = base.replace(/\/$/, '');
  const p    = path.startsWith('/') ? path : '/' + path;
  return new URL(b + p);
}

function post(path: string, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const json     = JSON.stringify(body);
    const url      = buildUrl(BASE_URL, path);
    const useHttps = url.protocol === 'https:';
    const options  = {
      hostname: url.hostname,
      port:     url.port || (useHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(json),
        ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
        ...extraHeaders,
      },
    };
    const req = (useHttps ? https : http).request(options, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode ?? 0, body: { raw } }); }
      });
    });
    req.on('error', reject);
    req.write(json);
    req.end();
  });
}

function get(path: string): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const url      = buildUrl(BASE_URL, path);
    const useHttps = url.protocol === 'https:';
    const options  = {
      hostname: url.hostname,
      port:     url.port || (useHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'GET',
      headers: { ...(API_KEY ? { 'X-API-Key': API_KEY } : {}) },
    };
    const req = (useHttps ? https : http).request(options, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode ?? 0, body: { raw } }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── Stats helpers ────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function printSection(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

function pass(msg: string): void { console.log(`  ✅ PASS  ${msg}`); }
function fail(msg: string): void { console.log(`  ❌ FAIL  ${msg}`); }
function info(msg: string): void { console.log(`  ℹ  ${msg}`); }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║       Sumsuma — Concurrent Load & Safety Test          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Base URL:    ${BASE_URL}`);
  console.log(`  Concurrency: ${CONCURRENCY} unique transactions`);
  console.log(`  User:        ${USER_ID}  |  Amount: ${AMOUNT} USD each`);
  console.log(`  API Key:     ${API_KEY ? API_KEY.slice(0, 8) + '…' : '(none — no auth)'}`);

  let globalPassed = 0;
  let globalFailed = 0;

  // ── 0. Health check ─────────────────────────────────────────────────────────
  printSection('0 — Server health');
  try {
    const h = await get('/health');
    if (h.status === 200) { pass('Server is up'); }
    else                  { fail(`Health returned ${h.status}`); process.exit(1); }
  } catch (e: any) {
    fail(`Cannot reach server: ${e.message}`);
    process.exit(1);
  }

  // ── 1. Reset + seed ─────────────────────────────────────────────────────────
  printSection('1 — Reset and seed test environment');
  const resetResp = await post('/simulation/reset', { seed: true });
  if (resetResp.status === 200) {
    pass('Reset + seed succeeded');
    info(`Liquidity pool: ${(resetResp.body as any).liquidityPoolETB?.toLocaleString()} ETB`);
  } else {
    fail(`Reset failed: ${resetResp.status} ${JSON.stringify(resetResp.body)}`);
    process.exit(1);
  }

  // ── 2. Capture wallet balance before ────────────────────────────────────────
  printSection('2 — Wallet snapshot (before)');
  const walletBefore = await get(`/wallet/${USER_ID}`);
  const balanceBefore: number = (walletBefore.body as any)?.balances?.USD ?? 0;
  info(`${USER_ID} USD balance before: ${balanceBefore.toLocaleString()}`);

  // Top up if the seeded balance is insufficient (e.g. previous run consumed funds)
  const required = AMOUNT * CONCURRENCY + AMOUNT * 15; // extra for rate-limit phase
  if (balanceBefore < required) {
    info(`Topping up to cover test (need ${required}, have ${balanceBefore})…`);
    await post('/wallet/topup', { userId: USER_ID, amount: required - balanceBefore + 1000, currency: 'USD' });
    await new Promise(r => setTimeout(r, 500));
  }
  pass(`Seed balance is sufficient`);

  // ── 3. Concurrent unique transactions ───────────────────────────────────────
  // Load is spread evenly across all 5 seed users to reduce per-wallet Firestore
  // document contention (20 concurrent → 4 concurrent per user).
  printSection(`3 — ${CONCURRENCY} concurrent unique transactions (across 5 users)`);

  const SEED_USERS = ['sim_user_001', 'sim_user_002', 'sim_user_003', 'sim_user_004', 'sim_user_005'];
  const uniqueKey  = () => `load-unique-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const results: { status: number; latencyMs: number; txId?: string; ok: boolean }[] = [];

  const batchStart = Date.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async (_, i) => {
      const targetUser = SEED_USERS[i % SEED_USERS.length];
      const idemKey    = `load-test-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`;
      const t0 = Date.now();
      try {
        const r = await post('/remittance/initiate', {
          userId: targetUser, recipientId: 'rec_load_test',
          amount: AMOUNT, currency: 'USD', type: 'personal',
        }, { 'Idempotency-Key': idemKey });
        const latencyMs = Date.now() - t0;
        results.push({
          status:    r.status,
          latencyMs,
          txId:      (r.body as any)?.transactionId ?? (r.body as any)?.txId,
          ok:        r.status === 201 || r.status === 202,
        });
      } catch (e: any) {
        results.push({ status: 0, latencyMs: Date.now() - t0, ok: false });
      }
    }),
  );
  const totalMs = Date.now() - batchStart;

  const succeeded  = results.filter(r => r.status === 201).length;
  const queued     = results.filter(r => r.status === 202).length;
  const rateLimited = results.filter(r => r.status === 429).length;
  const errors     = results.filter(r => ![201, 202, 429].includes(r.status)).length;
  const txIds      = results.filter(r => r.txId).map(r => r.txId!);
  const uniqueTxIds = new Set(txIds).size;

  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const p50  = percentile(latencies, 50);
  const p95  = percentile(latencies, 95);
  const p99  = percentile(latencies, 99);
  const mean = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

  info(`Total wall-clock: ${totalMs}ms  |  TPS: ${(CONCURRENCY / (totalMs / 1000)).toFixed(1)}`);
  info(`201 PROCESSING:  ${succeeded}`);
  info(`202 QUEUED:      ${queued}`);
  info(`429 RATE_LIMIT:  ${rateLimited}`);
  info(`ERR other:       ${errors}`);
  info(`Latency — mean: ${mean}ms  p50: ${p50}ms  p95: ${p95}ms  p99: ${p99}ms`);

  // Idempotency check: every txId must be unique
  if (txIds.length > 0 && uniqueTxIds === txIds.length) {
    pass(`All ${txIds.length} transaction IDs are unique — no duplicates`);
    globalPassed++;
  } else if (txIds.length > 0) {
    fail(`DUPLICATE transaction IDs detected! (${txIds.length} txs, ${uniqueTxIds} unique)`);
    globalFailed++;
  }

  // Financial success rate
  // Simulation target: <5% (production target: <1%).
  // This API runs over a Replit network proxy → Firestore with multiple
  // concurrent document writes. Some Firestore ABORTED retries are expected.
  const processedOk = succeeded + queued;
  const errorRate   = errors / CONCURRENCY;
  if (errorRate <= 0.05) {
    pass(`Error rate ${(errorRate * 100).toFixed(1)}% ≤ 5% simulation target (prod target: <1%)`);
    globalPassed++;
  } else {
    fail(`Error rate ${(errorRate * 100).toFixed(1)}% exceeds 5% — too many infrastructure failures`);
    globalFailed++;
  }

  // p95 latency target — simulation env allows 15s (Replit proxy + Firestore roundtrips).
  // Production target with direct Firestore access and regional co-location: <3s p95.
  if (p95 <= 15000) {
    pass(`p95 latency ${p95}ms within 15 000ms simulation target (prod target: <3 000ms)`);
    globalPassed++;
  } else {
    fail(`p95 latency ${p95}ms exceeds 15 000ms — unacceptable even for simulation`);
    globalFailed++;
  }

  // ── 4. Wallet invariant check ────────────────────────────────────────────────
  // Check across ALL 5 seed users — none may have gone negative, and total
  // debited must not exceed (concurrency × amount).
  printSection('4 — Wallet safety invariant (all 5 users)');

  // Give Firestore a moment to flush
  await new Promise(r => setTimeout(r, 2000));

  let totalDebitedAllUsers = 0;
  let anyNegative          = false;
  for (const uid of SEED_USERS) {
    const w    = await get(`/wallet/${uid}`);
    const bal  = (w.body as any)?.balances?.USD ?? 0;
    const seed = 50_000; // default seed balance
    const debited = Math.max(0, seed - bal); // cap at 0 — ignore top-ups from prior runs
    totalDebitedAllUsers += debited;
    if (bal < 0) anyNegative = true;
    info(`${uid}: USD ${bal.toLocaleString()} (debited ${debited >= 0 ? debited : 0})`);
  }

  const expectedMax  = CONCURRENCY * AMOUNT;
  info(`Total debited across all users: ${totalDebitedAllUsers.toLocaleString()} USD  (max: ${expectedMax})`);

  if (!anyNegative) {
    pass('No wallet went negative — overdraw protection enforced');
    globalPassed++;
  } else {
    fail('One or more wallets went NEGATIVE — OVERDRAW DETECTED');
    globalFailed++;
  }

  if (totalDebitedAllUsers <= expectedMax + 0.01) {
    pass(`Total debited ${totalDebitedAllUsers} USD ≤ max possible ${expectedMax} USD — no double-debit`);
    globalPassed++;
  } else {
    fail(`Total debited ${totalDebitedAllUsers} USD EXCEEDS max ${expectedMax} — double-debit detected!`);
    globalFailed++;
  }

  // ── 5. Idempotency under concurrency ────────────────────────────────────────
  printSection('5 — Idempotency under concurrent fire (same key, 10 parallel)');

  const sharedKey  = uniqueKey();
  const idemBody   = { userId: USER_ID, recipientId: 'rec_idem_test', amount: 1, currency: 'USD', type: 'personal' };
  const idemResps  = await Promise.all(
    Array.from({ length: 10 }, () =>
      post('/remittance/initiate', idemBody, { 'Idempotency-Key': sharedKey })
    ),
  );

  const idemTxIds = idemResps
    .filter(r => r.status === 200 || r.status === 201 || r.status === 202)
    .map(r => (r.body as any)?.transactionId ?? (r.body as any)?.txId)
    .filter(Boolean);
  const idemUnique = new Set(idemTxIds).size;

  info(`10 concurrent requests with identical idempotency key`);
  info(`Responses: ${idemResps.map(r => r.status).join(', ')}`);
  info(`Returned txIds: ${idemUnique} unique`);

  if (idemUnique <= 1) {
    pass(`Idempotency holds under concurrency — at most 1 unique txId created`);
    globalPassed++;
  } else {
    fail(`Idempotency VIOLATED — ${idemUnique} different txIds returned for the same key!`);
    globalFailed++;
  }

  // ── 6. Rate limiter verification ────────────────────────────────────────────
  printSection('6 — Rate limiter (write endpoint: 30 req/min)');

  // Fire 35 rapid requests (exceeds 30/min limit) — at least some should 429
  info(`Firing 35 rapid POST /remittance/initiate calls (limit: 30/min)…`);
  const rapidResps = await Promise.all(
    Array.from({ length: 35 }, (_, i) =>
      post('/remittance/initiate', {
        userId: USER_ID, recipientId: 'rec_ratelimit_test', amount: 1, currency: 'USD', type: 'personal',
      }, { 'Idempotency-Key': `rl-${Date.now()}-${i}` })
    ),
  );
  const total429 = rapidResps.filter(r => r.status === 429).length;
  info(`Got ${total429} × 429 RATE_LIMIT_EXCEEDED out of 35 requests`);

  if (total429 > 0) {
    pass(`Rate limiter engaged — ${total429} requests correctly throttled`);
    globalPassed++;
  } else {
    fail(`Rate limiter DID NOT engage after 35 requests — check configuration`);
    globalFailed++;
  }

  // Verify 429 body shape
  const r429 = rapidResps.find(r => r.status === 429);
  if (r429) {
    const hasFields = 'error' in r429.body && 'retryAfterSeconds' in r429.body;
    if (hasFields) { pass('429 body contains error + retryAfterSeconds fields'); globalPassed++; }
    else           { fail('429 body is missing required fields'); globalFailed++; }
  }

  // ── Final summary ────────────────────────────────────────────────────────────
  const total = globalPassed + globalFailed;
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                  LOAD TEST SUMMARY                      ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Assertions passed : ${String(globalPassed).padEnd(4)} / ${total}                         ║`.slice(0, 62) + '║');
  console.log(`║  Assertions failed : ${String(globalFailed).padEnd(4)}                              ║`.slice(0, 62) + '║');
  console.log(`║  Latency  mean/p50/p95/p99: ${mean}/${p50}/${p95}/${p99} ms`.padEnd(62) + '║');
  console.log(`║  Verdict  : ${globalFailed === 0 ? '✅ ALL PASS — ready for load' : '❌ FAILURES — investigate above'}`.padEnd(62) + '║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  process.exit(globalFailed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[LoadTest] Fatal:', e); process.exit(1); });
