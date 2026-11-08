/**
 * Keeps the deployed API (and its Neon compute) warm while you work.
 *
 * Render free services sleep after 15 minutes without traffic, and Neon
 * suspends an idle compute, so the first request after a quiet period can take
 * 20+ seconds. Run this in a terminal while testing the mobile app:
 *
 *   npm run warm              # ping until Ctrl+C
 *   npm run warm -- 30        # stop after 30 minutes
 *   API_HEALTH_URL=http://192.168.1.50:5000/api/health npm run warm
 *
 * The interval defaults to 10 minutes; override it with
 * KEEPALIVE_INTERVAL_MS (minimum 5000).
 */
const url =
  process.env.API_HEALTH_URL || 'https://bartender-aid.onrender.com/api/health';
const minutes = Math.max(0, Number(process.argv[2] || process.env.KEEPALIVE_MINUTES) || 0);
const intervalMs = Math.max(5000, Number(process.env.KEEPALIVE_INTERVAL_MS) || 10 * 60 * 1000);
const deadline = minutes > 0 ? Date.now() + minutes * 60 * 1000 : Infinity;

let stopped = false;

async function ping() {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const body = await response.json().catch(() => ({}));
    const database = body.db ? ` db=${body.db}` : '';
    console.log(`${new Date().toISOString()} HTTP ${response.status}${database} ${Date.now() - startedAt}ms`);
  } catch (error) {
    console.error(`${new Date().toISOString()} ping failed: ${error.message}`);
  }
}

async function loop() {
  await ping();
  if (stopped) return stop();
  if (Date.now() >= deadline) return stop();
  setTimeout(loop, intervalMs);
}

function stop() {
  console.log('Keep-alive stopped.');
  process.exit(0);
}

process.on('SIGINT', () => {
  stopped = true;
  stop();
});

console.log(
  `Keeping ${url} warm${minutes > 0 ? ` for ${minutes} minute(s)` : ''} every ` +
    `${Math.round(intervalMs / 1000)}s. Press Ctrl+C to stop.`
);
void loop();
