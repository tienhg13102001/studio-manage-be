/**
 * API Benchmark Script — measures average response time per endpoint.
 * Usage: node benchmark.mjs [label]
 */
import { performance } from 'perf_hooks';

const BASE_URL = 'http://localhost:5002/api';
const ITERATIONS = 10; // requests per endpoint
const LOGIN_CREDENTIALS = { username: 'superadmin', password: 'Admin@1234' };

let token = '';

async function request(method, path, body) {
  const start = performance.now();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const elapsed = performance.now() - start;
  const status = res.status;
  // consume body
  try { await res.json(); } catch {}
  return { elapsed, status };
}

async function benchmark(label, method, path, body) {
  const times = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const { elapsed, status } = await request(method, path, body);
    if (status >= 200 && status < 500) times.push(elapsed);
  }
  if (times.length === 0) return { label, avg: null, min: null, max: null, error: true };
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  return { label, avg, min, max };
}

async function login() {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(LOGIN_CREDENTIALS),
  });
  const data = await res.json();
  token = data.token ?? data.data?.token ?? '';
  if (!token) {
    console.error('Login failed:', JSON.stringify(data));
    process.exit(1);
  }
  console.log('Logged in successfully.');
}

// Get a sample resource ID from the first item in a collection
async function getFirstId(path) {
  const res = await fetch(`${BASE_URL}${path}?limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const items = data.data ?? data;
  if (Array.isArray(items) && items.length > 0) return items[0]._id;
  return null;
}

async function main() {
  const label = process.argv[2] ?? 'BASELINE';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  BENCHMARK: ${label}`);
  console.log(`  Iterations per endpoint: ${ITERATIONS}`);
  console.log(`${'='.repeat(60)}\n`);

  await login();

  // Discover sample IDs
  const customerId = await getFirstId('/customers');
  const scheduleId = await getFirstId('/schedules');
  const transactionId = await getFirstId('/transactions');
  const studentId = await getFirstId('/students');
  const packageId = await getFirstId('/packages');
  const seasonId = await getFirstId('/seasons');

  console.log('Sample IDs:', { customerId, scheduleId, transactionId, studentId, packageId, seasonId });
  console.log();

  const suites = [
    // Auth
    ['POST /auth/login', 'POST', '/auth/login', LOGIN_CREDENTIALS],

    // Customers
    ['GET /customers (page 1)', 'GET', '/customers?page=1&limit=20'],
    ['GET /customers (with search)', 'GET', '/customers?search=a&limit=20'],
    ...(seasonId ? [['GET /customers (by season)', 'GET', `/customers?season=${seasonId}&limit=20`]] : []),
    ...(customerId ? [['GET /customers/:id', 'GET', `/customers/${customerId}`]] : []),

    // Schedules
    ['GET /schedules (page 1)', 'GET', '/schedules?page=1&limit=20'],
    ...(seasonId ? [['GET /schedules (by season)', 'GET', `/schedules?season=${seasonId}&limit=20`]] : []),
    ...(scheduleId ? [['GET /schedules/:id', 'GET', `/schedules/${scheduleId}`]] : []),

    // Transactions
    ['GET /transactions (page 1)', 'GET', '/transactions?page=1&limit=20'],
    ...(seasonId ? [['GET /transactions (by season)', 'GET', `/transactions?season=${seasonId}&limit=20`]] : []),
    ...(transactionId ? [['GET /transactions/:id', 'GET', `/transactions/${transactionId}`]] : []),

    // Students
    ['GET /students (page 1)', 'GET', '/students?page=1&limit=50'],
    ...(customerId ? [['GET /students (by customer)', 'GET', `/students?customer=${customerId}&limit=50`]] : []),
    ...(studentId ? [['GET /students/:id', 'GET', `/students/${studentId}`]] : []),

    // Dashboard
    ['GET /dashboard (no filter)', 'GET', '/dashboard'],
    ...(seasonId ? [['GET /dashboard (by season)', 'GET', `/dashboard?season=${seasonId}`]] : []),

    // Packages
    ['GET /packages', 'GET', '/packages'],

    // Seasons
    ['GET /seasons', 'GET', '/seasons'],

    // Categories
    ['GET /categories', 'GET', '/categories'],

    // Users
    ['GET /users', 'GET', '/users'],
  ];

  const results = [];
  for (const [name, method, path, body] of suites) {
    process.stdout.write(`  Benchmarking ${name} ... `);
    const r = await benchmark(name, method, path, body);
    results.push(r);
    if (r.error) {
      console.log('ERROR (skipped)');
    } else {
      console.log(`avg=${r.avg.toFixed(1)}ms  min=${r.min.toFixed(1)}ms  max=${r.max.toFixed(1)}ms`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  RESULTS SUMMARY — ${label}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  ${'Endpoint'.padEnd(45)} ${'Avg(ms)'.padStart(8)} ${'Min(ms)'.padStart(8)} ${'Max(ms)'.padStart(8)}`);
  console.log(`  ${'-'.repeat(73)}`);

  let totalAvg = 0;
  let count = 0;
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.label.padEnd(45)} ${'ERROR'.padStart(8)}`);
    } else {
      console.log(
        `  ${r.label.padEnd(45)} ${r.avg.toFixed(1).padStart(8)} ${r.min.toFixed(1).padStart(8)} ${r.max.toFixed(1).padStart(8)}`
      );
      totalAvg += r.avg;
      count++;
    }
  }
  const overallAvg = count > 0 ? totalAvg / count : 0;
  console.log(`  ${'-'.repeat(73)}`);
  console.log(`  ${'Overall average'.padEnd(45)} ${overallAvg.toFixed(1).padStart(8)}ms`);
  console.log(`${'='.repeat(60)}\n`);

  // Output JSON for comparison
  const output = { label, results, overallAvg };
  const fs = await import('fs');
  fs.writeFileSync(`benchmark_${label.toLowerCase().replace(/\s+/g,'_')}.json`, JSON.stringify(output, null, 2));
  console.log(`Results saved to benchmark_${label.toLowerCase().replace(/\s+/g,'_')}.json`);
}

main().catch(console.error);
