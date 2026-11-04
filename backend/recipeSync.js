const SOURCE_KEY = 'thecocktaildb';
const API_KEY = process.env.COCKTAILDB_API_KEY || '1';
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_CANDIDATES_PER_RUN = 5;
const MAX_ATTEMPTS = 15;

function normalizeName(name) {
  return String(name || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function extractCandidate(drink) {
  if (!drink?.idDrink || !drink?.strDrink || !drink?.strInstructions) return null;
  const sourceId = String(drink.idDrink).trim();
  const sourceUrl = `https://www.thecocktaildb.com/drink/${encodeURIComponent(sourceId)}`;
  return {
    sourceId,
    sourceUrl,
    name: drink.strDrink.trim(),
    normalizedName: normalizeName(drink.strDrink),
    sourcePayload: drink,
  };
}

async function fetchRandomDrink() {
  const url = `https://www.thecocktaildb.com/api/json/v1/${encodeURIComponent(API_KEY)}/random.php`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`CocktailDB request failed with status ${response.status}`);
  const payload = await response.json();
  return extractCandidate(payload.drinks?.[0]);
}

async function stageCandidate(client, candidate, allowedUse) {
  const exactSource = await client.query(
    'SELECT id FROM recipe_candidates WHERE source_key = $1 AND source_id = $2',
    [SOURCE_KEY, candidate.sourceId]
  );
  if (exactSource.rows.length) return false;

  const duplicate = await client.query(
    `SELECT id FROM recipe_candidates WHERE normalized_name = $1 AND status <> 'rejected'
     UNION ALL SELECT id FROM cocktails WHERE LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', ' ', 'g')) = $2
     LIMIT 1`,
    [candidate.normalizedName, candidate.normalizedName]
  );
  const status = !allowedUse ? 'blocked_license' : duplicate.rows.length ? 'duplicate' : 'new';
  await client.query(
    `INSERT INTO recipe_candidates
      (source_key, source_id, source_url, name, normalized_name, status, duplicate_of, source_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (source_key, source_id) DO NOTHING`,
    [SOURCE_KEY, candidate.sourceId, candidate.sourceUrl, candidate.name, candidate.normalizedName,
      status, duplicate.rows[0]?.id || null, JSON.stringify(candidate.sourcePayload)]
  );
  return true;
}

async function discoverCandidates(pool) {
  const source = await pool.query('SELECT allowed_use FROM source_registry WHERE source_key = $1', [SOURCE_KEY]);
  if (!source.rows[0]?.allowed_use) {
    console.log('Recipe discovery paused: TheCocktailDB use has not been reviewed and enabled in the source registry.');
    return 0;
  }

  const client = await pool.connect();
  let added = 0;
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO recipe_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    const state = await client.query('SELECT last_attempt_at FROM recipe_sync_state WHERE id = 1 FOR UPDATE');
    const lastAttempt = state.rows[0]?.last_attempt_at;
    if (lastAttempt && Date.now() - new Date(lastAttempt).getTime() < SYNC_INTERVAL_MS) {
      await client.query('COMMIT');
      return 0;
    }
    await client.query('UPDATE recipe_sync_state SET last_attempt_at = NOW() WHERE id = 1');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS && added < MAX_CANDIDATES_PER_RUN; attempt += 1) {
    try {
      const candidate = await fetchRandomDrink();
      if (!candidate) continue;
      const transaction = await pool.connect();
      try {
        await transaction.query('BEGIN');
        if (await stageCandidate(transaction, candidate, true)) added += 1;
        await transaction.query('COMMIT');
      } catch (error) {
        await transaction.query('ROLLBACK');
        throw error;
      } finally {
        transaction.release();
      }
    } catch (error) {
      console.error('Recipe discovery attempt failed:', error.message);
    }
  }
  return added;
}

function startRecipeSync(pool) {
  const run = async () => {
    try {
      const added = await discoverCandidates(pool);
      if (added > 0) console.log(`Discovered ${added} recipe candidate(s) for review`);
    } catch (error) {
      console.error('Recipe candidate discovery failed:', error.message);
    }
  };
  const startup = setTimeout(run, 5000);
  const daily = setInterval(run, SYNC_INTERVAL_MS);
  startup.unref();
  daily.unref();
}

module.exports = { startRecipeSync, discoverCandidates, extractCandidate, normalizeName };
