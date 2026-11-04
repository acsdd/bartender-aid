const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { startRecipeSync } = require('./recipeSync');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PORT = Number(process.env.PORT) || 5000;

app.use(cors());
app.use(express.json({ limit: '16kb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Bartender Aid API is running!' });
});

app.get('/api/ingredients', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, category FROM ingredients ORDER BY category NULLS LAST, name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch ingredients:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/match', async (req, res) => {
  const { ingredientIds } = req.body || {};

  if (!Array.isArray(ingredientIds) || ingredientIds.length === 0) {
    return res.status(400).json({ error: 'Please provide a non-empty array of ingredientIds' });
  }

  if (!ingredientIds.every((id) => Number.isSafeInteger(id) && id > 0)) {
    return res.status(400).json({ error: 'ingredientIds must contain positive integers' });
  }

  try {
    const result = await pool.query(
      `SELECT c.id, c.name, c.instructions, c.glassware, c.image_url, c.source_url,
              COUNT(*)::int AS total_required,
              COUNT(*) FILTER (WHERE ci.ingredient_id = ANY($1::int[]))::int AS matched_count,
              json_agg(json_build_object(
                'id', i.id,
                'name', i.name,
                'amount', ci.amount,
                'hasIt', ci.ingredient_id = ANY($1::int[])
              ) ORDER BY i.name) AS recipe_ingredients
       FROM cocktails c
       JOIN cocktail_ingredients ci ON ci.cocktail_id = c.id
       JOIN ingredients i ON i.id = ci.ingredient_id
       GROUP BY c.id
       HAVING COUNT(*) FILTER (WHERE ci.ingredient_id = ANY($1::int[])) > 0
       ORDER BY matched_count DESC, total_required ASC, c.name`,
      [[...new Set(ingredientIds)]]
    );
    res.json(result.rows.map((cocktail) => ({
      ...cocktail,
      isReady: cocktail.matched_count === cocktail.total_required,
      missingCount: cocktail.total_required - cocktail.matched_count,
    })));
  } catch (err) {
    console.error('Failed to match cocktails:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required. Set it in backend/.env before starting the API.');
    process.exitCode = 1;
  } else {
    app.listen(PORT, () => {
      console.log(`Bartender Aid API listening on port ${PORT}`);
      startRecipeSync(pool);
    });
  }
}

module.exports = { app, pool };