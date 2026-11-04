const express = require('express');
const { normalizeName } = require('./recipeSync');

const ALLOWED_METHODS = new Set(['shake', 'stir', 'build', 'blend', 'layer', 'throw']);
const GLASS_ALIASES = new Map([
  ['highball glass', 'highball'], ['highball', 'highball'], ['rocks glass', 'rocks'],
  ['old-fashioned glass', 'rocks'], ['old fashioned glass', 'rocks'], ['rocks', 'rocks'],
  ['cocktail glass', 'cocktail'], ['martini glass', 'cocktail'], ['margarita glass', 'margarita'],
  ['coupe glass', 'coupe'], ['coupe', 'coupe'], ['wine glass', 'wine'], ['shot glass', 'shot'],
  ['hurricane glass', 'hurricane'], ['collins glass', 'collins'], ['pint glass', 'pint'],
  ['champagne flute', 'flute'], ['flute', 'flute'], ['irish coffee cup', 'irish_coffee'],
]);
const UNIT_TO_ML = { oz: 29.5735, ounce: 29.5735, ounces: 29.5735, ml: 1, cl: 10, tsp: 4.92892, teaspoon: 4.92892, tbsp: 14.7868, tablespoon: 14.7868, cup: 236.588 };

function fractionToNumber(text) {
  const fraction = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) + Number(fraction[2]) / Number(fraction[3]);
  const simple = text.match(/^(\d+)\/(\d+)$/);
  if (simple) return Number(simple[1]) / Number(simple[2]);
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function parseAmount(amount) {
  const original = String(amount || '').trim();
  if (!original) return { quantity: null, unit: 'directive', originalText: original, issue: 'Missing measure' };
  if (/\b(dash|dashes)\b/i.test(original)) return { quantity: null, unit: 'dash', originalText: original };
  const match = original.match(/^(\d+(?:\s+\d+\/\d+|\/\d+)?|\d+\/\d+)\s*(fl\.?\s*oz|oz|ounces?|ml|cl|tsp|teaspoons?|tbsp|tablespoons?|cups?)\b/i);
  if (match) {
    const quantity = fractionToNumber(match[1].replace(/\s+/g, ' ').trim());
    const rawUnit = match[2].toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ');
    const unitKey = rawUnit.startsWith('fl') ? 'oz' : rawUnit.replace(/s$/, '');
    if (quantity !== null && quantity > 0 && UNIT_TO_ML[unitKey]) {
      return { quantity: Math.round(quantity * UNIT_TO_ML[unitKey] * 1000) / 1000, unit: 'ml', originalText: original };
    }
  }
  if (/^(top|to taste|as needed|for the rim|garnish|splash|squeeze|wedge|leaf|leaves)\b/i.test(original)) {
    return { quantity: null, unit: 'directive', originalText: original };
  }
  return { quantity: null, unit: 'unparsed', originalText: original, issue: `Unrecognized measure: ${original}` };
}

function inferMethod(instructions) {
  const text = String(instructions || '').toLowerCase();
  const methods = [
    ['shake', /\b(shake|shaken|shaker)\b/], ['stir', /\b(stir|stirred|mix in a mixing glass)\b/],
    ['build', /\b(build|built|pour into (?:a )?(?:glass|mug)|add .* to (?:a )?(?:glass|mug))\b/],
    ['blend', /\b(blend|blended)\b/], ['layer', /\b(layer|layered|float)\b/], ['throw', /\b(throw|thrown)\b/],
  ];
  return methods.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function slugify(text) {
  return String(text).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
}

async function normalizeCandidate(client, candidateId) {
  const result = await client.query(
    `SELECT c.*, s.allowed_use, s.license FROM recipe_candidates c
     JOIN source_registry s ON s.source_key = c.source_key WHERE c.id = $1 FOR UPDATE`, [candidateId]
  );
  const candidate = result.rows[0];
  if (!candidate) return { error: 'Candidate not found', status: 404 };
  if (!candidate.allowed_use) return { error: 'Source use has not been approved', status: 409 };
  if (['duplicate', 'blocked_license', 'rejected', 'published'].includes(candidate.status)) {
    return { error: `Cannot normalize a ${candidate.status} candidate`, status: 409 };
  }
  const drink = candidate.source_payload;
  const issues = [];
  const sourceIngredients = [];
  for (let index = 1; index <= 15; index += 1) {
    const rawName = String(drink[`strIngredient${index}`] || '').trim();
    if (!rawName) continue;
    const amount = parseAmount(drink[`strMeasure${index}`]);
    const alias = await client.query(
      `SELECT i.id, i.name, i.category, i.is_alcoholic FROM ingredient_aliases a
       JOIN ingredients i ON i.id = a.ingredient_id WHERE a.normalized_alias = $1`, [normalizeName(rawName)]
    );
    if (!alias.rows[0]) issues.push(`Unmapped ingredient: ${rawName}`);
    if (amount.issue) issues.push(`${rawName}: ${amount.issue}`);
    sourceIngredients.push({
      raw: rawName, ingredientId: alias.rows[0]?.id || null, ingredient: alias.rows[0]?.name || null,
      category: alias.rows[0]?.category || null, isAlcoholic: alias.rows[0]?.is_alcoholic || false,
      quantity: amount.quantity, unit: amount.unit, originalText: amount.originalText,
      optional: false, garnish: /garnish/i.test(rawName), sortOrder: index,
    });
  }
  if (!sourceIngredients.length) issues.push('Recipe has no ingredients');
  if (!sourceIngredients.some((ingredient) => ingredient.isAlcoholic)) issues.push('No canonical alcoholic base ingredient; review alcohol classification');
  const method = inferMethod(drink.strInstructions);
  if (!method || !ALLOWED_METHODS.has(method)) issues.push('Could not map instructions to an allowed preparation method');
  const rawGlass = String(drink.strGlass || '').trim().toLowerCase();
  const glass = GLASS_ALIASES.get(rawGlass);
  if (!glass) issues.push(`Unrecognized glassware: ${drink.strGlass || '(missing)'}`);
  const payload = {
    name: candidate.name,
    slug: slugify(candidate.name),
    family: drink.strCategory?.trim() || null,
    baseSpirit: sourceIngredients.find((ingredient) => ingredient.isAlcoholic)?.ingredient || null,
    glass: glass || null,
    method: method || null,
    serving: drink.strAlcoholic?.trim() || null,
    instructions: String(drink.strInstructions || '').trim(),
    imageUrl: drink.strDrinkThumb?.trim() || null,
    sourceType: 'imported',
    confidence: issues.length ? 0.5 : 0.9,
    needsHumanReview: issues.length > 0,
    issues,
    ingredients: sourceIngredients,
    source: { key: candidate.source_key, sourceId: candidate.source_id, url: candidate.source_url, license: candidate.license, retrievedAt: new Date().toISOString() },
    tags: drink.strTags ? String(drink.strTags).split(',').map((tag) => tag.trim()).filter(Boolean) : [],
    alcoholicClassification: drink.strAlcoholic?.trim() || null,
    allergens: [],
  };
  const versionResult = await client.query(
    'SELECT COALESCE(MAX(version), 0) + 1 AS version FROM recipe_versions WHERE candidate_id = $1', [candidateId]
  );
  const status = issues.length ? 'needs_review' : 'validated';
  await client.query(
    `INSERT INTO recipe_versions (candidate_id, version, payload_json, status)
     VALUES ($1, $2, $3::jsonb, $4)`, [candidateId, versionResult.rows[0].version, JSON.stringify(payload), status]
  );
  await client.query('UPDATE recipe_candidates SET status = $2, updated_at = NOW() WHERE id = $1', [candidateId, status]);
  return { candidateId: Number(candidateId), version: versionResult.rows[0].version, status, issues, payload };
}

function createAdminRouter(pool) {
  const router = express.Router();
  router.use((req, res, next) => {
    const expected = process.env.ADMIN_API_KEY;
    const supplied = req.get('x-admin-api-key');
    if (!expected || !supplied || supplied !== expected) return res.status(401).json({ error: 'Admin authentication required' });
    next();
  });

  router.get('/sources', async (req, res) => {
    try {
      const result = await pool.query('SELECT source_key, domain, license, trust_tier, allowed_use, last_checked_at, reviewed_at FROM source_registry ORDER BY source_key');
      res.json(result.rows);
    } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
  });

  router.post('/sources/:sourceKey/allow', async (req, res) => {
    const { confirmed, license } = req.body || {};
    if (confirmed !== true || typeof license !== 'string' || !license.trim()) {
      return res.status(400).json({ error: 'Confirm permitted use and provide the applicable license/terms note' });
    }
    try {
      const result = await pool.query(
        `UPDATE source_registry SET allowed_use = TRUE, license = $2, reviewed_at = NOW(), updated_at = NOW()
         WHERE source_key = $1 RETURNING source_key, allowed_use, license, reviewed_at`, [req.params.sourceKey, license.trim()]
      );
      if (!result.rows[0]) return res.status(404).json({ error: 'Source not found' });
      res.json(result.rows[0]);
    } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
  });

  router.get('/candidates', async (req, res) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : null;
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      const result = await pool.query(
        `SELECT c.id, c.source_key, c.source_id, c.source_url, c.name, c.status, c.duplicate_of, c.discovered_at,
                v.version, v.status AS version_status, v.payload_json
         FROM recipe_candidates c LEFT JOIN LATERAL
           (SELECT version, status, payload_json FROM recipe_versions WHERE candidate_id = c.id ORDER BY version DESC LIMIT 1) v ON TRUE
         WHERE ($1::text IS NULL OR c.status = $1) ORDER BY c.discovered_at DESC LIMIT $2`, [status, limit]
      );
      res.json(result.rows);
    } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
  });

  router.put('/ingredients/aliases', async (req, res) => {
    const { alias, ingredientId } = req.body || {};
    const normalized = normalizeName(alias);
    if (!normalized || !Number.isSafeInteger(ingredientId) || ingredientId <= 0) {
      return res.status(400).json({ error: 'Provide an alias and a positive integer ingredientId' });
    }
    try {
      const result = await pool.query(
        `INSERT INTO ingredient_aliases (alias, normalized_alias, ingredient_id) VALUES ($1, $2, $3)
         ON CONFLICT (normalized_alias) DO UPDATE SET alias = EXCLUDED.alias, ingredient_id = EXCLUDED.ingredient_id
         RETURNING id, alias, normalized_alias, ingredient_id`, [String(alias).trim(), normalized, ingredientId]
      );
      res.status(200).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23503') return res.status(404).json({ error: 'Ingredient not found' });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/candidates/:id/normalize', async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await normalizeCandidate(client, req.params.id);
      if (result.error) { await client.query('ROLLBACK'); return res.status(result.status).json({ error: result.error }); }
      await client.query('COMMIT');
      res.json(result);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Candidate normalization failed:', error.message);
      res.status(500).json({ error: 'Could not normalize candidate' });
    } finally { client.release(); }
  });

  router.post('/candidates/:id/approve', async (req, res) => {
    const reviewer = typeof req.body?.reviewer === 'string' ? req.body.reviewer.trim() : '';
    if (!reviewer) return res.status(400).json({ error: 'Provide reviewer name or identifier' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT c.status, v.id AS version_id, v.status AS version_status
         FROM recipe_candidates c JOIN LATERAL
          (SELECT id, status FROM recipe_versions WHERE candidate_id = c.id ORDER BY version DESC LIMIT 1) v ON TRUE
         WHERE c.id = $1 FOR UPDATE OF c`, [req.params.id]
      );
      if (!current.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Candidate or draft not found' }); }
      if (current.rows[0].status !== 'validated' || current.rows[0].version_status !== 'validated') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Only a validated draft can be approved; resolve all review issues and normalize again' });
      }
      await client.query("UPDATE recipe_candidates SET status = 'approved', updated_at = NOW() WHERE id = $1", [req.params.id]);
      await client.query("UPDATE recipe_versions SET status = 'approved', reviewer = $2 WHERE id = $1", [current.rows[0].version_id, reviewer]);
      await client.query('COMMIT');
      res.json({ candidateId: Number(req.params.id), status: 'approved', reviewer });
    } catch (error) {
      await client.query('ROLLBACK'); res.status(500).json({ error: 'Could not approve candidate' });
    } finally { client.release(); }
  });

  router.post('/candidates/:id/publish', async (req, res) => {
    const reviewer = typeof req.body?.reviewer === 'string' ? req.body.reviewer.trim() : '';
    if (!reviewer) return res.status(400).json({ error: 'Provide reviewer name or identifier' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query(
        `SELECT c.*, s.allowed_use, s.license, v.id AS version_id, v.version, v.payload_json, v.status AS version_status
         FROM recipe_candidates c JOIN source_registry s ON s.source_key = c.source_key
         JOIN LATERAL (SELECT id, version, payload_json, status FROM recipe_versions WHERE candidate_id = c.id ORDER BY version DESC LIMIT 1) v ON TRUE
         WHERE c.id = $1 FOR UPDATE OF c`, [req.params.id]
      );
      const row = selected.rows[0];
      if (!row) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Candidate or draft not found' }); }
      if (!row.allowed_use) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Source use is not approved' }); }
      if (row.status !== 'approved' || row.version_status !== 'approved') {
        await client.query('ROLLBACK'); return res.status(409).json({ error: 'Candidate must be approved before publishing' });
      }
      const draft = row.payload_json;
      if (!draft.ingredients?.length || draft.issues?.length || draft.ingredients.some((item) => !item.ingredientId)) {
        await client.query('ROLLBACK'); return res.status(409).json({ error: 'Draft does not pass publication validation' });
      }
      const cocktailResult = await client.query(
        `INSERT INTO cocktails (name, instructions, glassware, image_url, source_id, source_url)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [draft.name, draft.instructions, draft.glass, draft.imageUrl, row.source_id, row.source_url]
      );
      const cocktailId = cocktailResult.rows[0].id;
      const recipeResult = await client.query(
        `INSERT INTO recipes (cocktail_id, slug, name, family, base_spirit, glass, method, serving,
          instructions, status, source_type, confidence, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published', 'imported', $10, NOW()) RETURNING id`,
        [cocktailId, draft.slug, draft.name, draft.family, draft.baseSpirit, draft.glass, draft.method,
          draft.serving, draft.instructions, draft.confidence]
      );
      const recipeId = recipeResult.rows[0].id;
      for (const item of draft.ingredients) {
        await client.query(
          'INSERT INTO cocktail_ingredients (cocktail_id, ingredient_id, amount) VALUES ($1, $2, $3)',
          [cocktailId, item.ingredientId, item.originalText || null]
        );
        await client.query(
          `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit, original_text, optional, garnish, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [recipeId, item.ingredientId, item.quantity, item.unit, item.originalText, item.optional, item.garnish, item.sortOrder]
        );
      }
      await client.query(
        'INSERT INTO recipe_sources (recipe_id, url, publisher, license, retrieved_at) VALUES ($1, $2, $3, $4, $5)',
        [recipeId, draft.source.url, row.source_key, row.license, draft.source.retrievedAt]
      );
      await client.query("UPDATE recipe_candidates SET status = 'published', updated_at = NOW() WHERE id = $1", [row.id]);
      await client.query("UPDATE recipe_versions SET status = 'published', recipe_id = $2, reviewer = $3 WHERE id = $1", [row.version_id, recipeId, reviewer]);
      await client.query('COMMIT');
      res.status(201).json({ candidateId: Number(row.id), recipeId: Number(recipeId), cocktailId, status: 'published' });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'A recipe with this name or source ID already exists; mark the candidate as duplicate' });
      console.error('Recipe publication failed:', error.message);
      res.status(500).json({ error: 'Could not publish recipe' });
    } finally { client.release(); }
  });

  return router;
}

module.exports = { createAdminRouter, parseAmount, inferMethod, normalizeCandidate };
